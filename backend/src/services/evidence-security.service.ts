import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import { env } from '../config/env.js'
import { ApiError } from '../shared/errors.js'
import { logger } from '../shared/logger.js'

/**
 * Evidence file security.
 *
 * The upload's declared MIME type and extension are both attacker-controlled,
 * so content is inspected instead: the file must actually look like what it
 * claims to be. Files are then scanned (signature rules always, ClamAV when
 * configured) and encrypted at rest with a key held outside the database.
 */

export type DetectedType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'application/pdf'
  | 'application/zip'
  | 'application/msword'
  | 'text/plain'
  | null

const ZIP_DOCUMENTS = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

function startsWith(buffer: Buffer, signature: number[] | string) {
  if (typeof signature === 'string') {
    return buffer.subarray(0, signature.length).toString('latin1') === signature
  }
  if (buffer.length < signature.length) return false
  return signature.every((byte, index) => buffer[index] === byte)
}

export function detectFileType(buffer: Buffer): DetectedType {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(buffer, 'RIFF') && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  if (startsWith(buffer, '%PDF-')) return 'application/pdf'
  if (startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'application/msword'
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip'
  if (buffer.length && !buffer.subarray(0, 4096).includes(0)) {
    const text = buffer.subarray(0, 4096).toString('utf8')
    if (!text.includes('\uFFFD')) return 'text/plain'
  }
  return null
}

export function assertContentMatches(filePath: string, declaredMime: string): DetectedType {
  const buffer = fs.readFileSync(filePath)
  if (!buffer.length) throw ApiError.badRequest('The uploaded file is empty')
  const detected = detectFileType(buffer)
  if (!detected) throw ApiError.badRequest('The file content is not a supported document, image or text file')
  const ok =
    detected === declaredMime ||
    (detected === 'application/zip' && ZIP_DOCUMENTS.has(declaredMime)) ||
    (declaredMime === 'text/plain' && detected === 'text/plain')
  if (!ok) {
    throw ApiError.badRequest(
      `The file content (${detected}) does not match the declared type (${declaredMime}). Upload a genuine document.`,
    )
  }
  return detected
}

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

export type ScanResult = { status: 'clean' | 'infected' | 'not_scanned' | 'failed'; detail?: string }

/** ClamAV INSTREAM scan; only attempted when the daemon is configured. */
async function scanWithClamav(filePath: string): Promise<ScanResult | null> {
  if (!env.CLAMAV_HOST) return null
  return new Promise<ScanResult | null>((resolve) => {
    const socket = net.createConnection({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT }, () => {
      socket.write('zINSTREAM\0')
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })
      stream.on('data', (chunk: string | Buffer) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const size = Buffer.alloc(4)
        size.writeUInt32BE(data.length, 0)
        socket.write(size)
        socket.write(data)
      })
      stream.on('end', () => {
        socket.write(Buffer.from([0, 0, 0, 0]))
      })
      stream.on('error', (err) => {
        logger.warn({ err, filePath }, 'ClamAV stream read failed')
        socket.destroy()
        resolve({ status: 'failed', detail: 'The file could not be scanned' })
      })
    })
    let response = ''
    const timeout = setTimeout(() => {
      socket.destroy()
      resolve({ status: 'failed', detail: 'The malware scanner timed out' })
    }, 30_000)
    socket.on('data', (data) => {
      response += data.toString()
    })
    socket.on('end', () => {
      clearTimeout(timeout)
      if (/FOUND/.test(response)) resolve({ status: 'infected', detail: response.trim() })
      else if (/OK/.test(response)) resolve({ status: 'clean' })
      else resolve({ status: 'failed', detail: response.trim() || 'Unexpected scanner response' })
    })
    socket.on('error', (err) => {
      clearTimeout(timeout)
      logger.warn({ err }, 'ClamAV scan unavailable')
      resolve({ status: 'failed', detail: 'The malware scanner is unavailable' })
    })
  })
}

export async function scanEvidenceFile(filePath: string): Promise<ScanResult> {
  const buffer = fs.readFileSync(filePath)
  if (buffer.includes(Buffer.from(EICAR))) return { status: 'infected', detail: 'EICAR test signature' }
  const clam = await scanWithClamav(filePath)
  if (clam) return clam
  // Without an antivirus engine this is honestly reported as unscanned rather
  // than being presented as a clean result.
  return { status: 'not_scanned', detail: 'No antivirus engine is configured on this server' }
}

function evidenceKey(): Buffer | null {
  const raw = (env.EVIDENCE_ENCRYPTION_KEY || env.BACKUP_ENCRYPTION_KEY || '').trim()
  if (!raw) return null
  return crypto.createHash('sha256').update(raw).digest()
}

export function evidenceEncryptionAvailable(): boolean {
  return Boolean(evidenceKey())
}

/**
 * Encrypts the stored file in place (AES-256-GCM). The original plaintext is
 * removed when encryption succeeds so only the encrypted copy remains.
 */
export function encryptEvidenceFile(filePath: string): { path: string; encrypted: boolean } {
  const key = evidenceKey()
  if (!key) return { path: filePath, encrypted: false }
  const plaintext = fs.readFileSync(filePath)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  const target = `${filePath}.enc`
  fs.writeFileSync(target, Buffer.concat([iv, tag, ciphertext]))
  fs.unlinkSync(filePath)
  return { path: target, encrypted: true }
}

export function readEvidenceFile(storagePath: string, encrypted: boolean): Buffer {
  const raw = fs.readFileSync(storagePath)
  if (!encrypted) return raw
  const key = evidenceKey()
  if (!key) throw ApiError.internal('Evidence encryption key is not configured; the file cannot be decrypted')
  if (raw.length < 29) throw ApiError.internal('The encrypted evidence file is corrupted')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const ciphertext = raw.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

type TicketPayload = { evidenceId: string; userId: string; name: string; exp: number }

function ticketSecret(): string {
  return env.JWT_ACCESS_SECRET
}

/**
 * Short-lived, single-purpose download ticket. It avoids putting a long-lived
 * access token in a URL while keeping the actual authorization decision on the
 * server: the ticket is only issued after the normal access checks pass.
 */
export function createDownloadTicket(
  evidenceId: string,
  userId: string,
  name: string,
  ttlSeconds = 300,
): { token: string; expiresAt: Date } {
  const exp = Math.floor(Date.now() / 1000) + Math.max(30, Math.min(ttlSeconds, 900))
  const payload: TicketPayload = { evidenceId, userId, name, exp }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = crypto.createHmac('sha256', ticketSecret()).update(body).digest('base64url')
  return { token: `${body}.${signature}`, expiresAt: new Date(exp * 1000) }
}

export function verifyDownloadTicket(token: string): TicketPayload | null {
  const [body, signature] = String(token ?? '').split('.')
  if (!body || !signature) return null
  const expected = crypto.createHmac('sha256', ticketSecret()).update(body).digest('base64url')
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TicketPayload
    if (!payload.evidenceId || !payload.userId) return null
    if (payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
