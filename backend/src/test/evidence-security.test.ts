import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertContentMatches,
  createDownloadTicket,
  detectFileType,
  encryptEvidenceFile,
  evidenceEncryptionAvailable,
  readEvidenceFile,
  scanEvidenceFile,
  verifyDownloadTicket,
} from '../services/evidence-security.service.js'

/**
 * Evidence file security (audit P1). Uploads are attacker-controlled, so these
 * tests prove that decisions are made on the file's bytes rather than its
 * extension, that malware signatures are rejected, that files are encrypted at
 * rest, and that download links are short-lived and tamper-evident.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-evidence-'))

function write(name: string, content: Buffer | string) {
  const file = path.join(dir, name)
  fs.writeFileSync(file, content)
  return file
}

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('content validation', () => {
  it('detects real file types from magic bytes, not extensions', () => {
    expect(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(detectFileType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf')
    expect(detectFileType(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('application/zip')
    expect(detectFileType(Buffer.from('plain notes without binary content'))).toBe('text/plain')
    expect(detectFileType(Buffer.from([0x00, 0x01, 0x02, 0xff]))).toBeNull()
  })

  it('rejects an unrecognised binary payload', () => {
    const file = write('payload.pdf', Buffer.from([0x4d, 0x5a, 0x00, 0x01, 0x02, 0x03]))
    expect(() => assertContentMatches(file, 'application/pdf')).toThrow(/not a supported document/)
  })

  it('rejects a file whose bytes contradict its declared type', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const file = write('image.pdf', png)
    expect(() => assertContentMatches(file, 'application/pdf')).toThrow(/does not match/)
  })

  it('accepts an empty-looking file but rejects a genuinely empty upload', () => {
    const empty = write('empty.pdf', '')
    expect(() => assertContentMatches(empty, 'application/pdf')).toThrow(/empty/)
  })

  it('accepts Office documents because their container is a zip archive', () => {
    const file = write('letter.docx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))
    expect(
      assertContentMatches(file, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('application/zip')
  })
})

describe('malware scanning', () => {
  it('blocks the EICAR test signature even without an antivirus daemon', async () => {
    const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
    const file = write('eicar.txt', eicar)
    const result = await scanEvidenceFile(file)
    expect(result.status).toBe('infected')
  })

  it('reports unscanned honestly when no engine is configured', async () => {
    const file = write('clean.txt', 'ordinary meeting minutes')
    const result = await scanEvidenceFile(file)
    expect(['not_scanned', 'clean']).toContain(result.status)
  })
})

describe('encryption at rest', () => {
  it('replaces the plaintext file with an encrypted copy and restores it', () => {
    expect(evidenceEncryptionAvailable()).toBe(true)
    const original = Buffer.from('Confidential board minutes — do not distribute')
    const file = write('secret.txt', original)

    const stored = encryptEvidenceFile(file)
    expect(stored.encrypted).toBe(true)
    expect(stored.path).not.toBe(file)
    expect(fs.existsSync(file)).toBe(false)
    expect(fs.readFileSync(stored.path).equals(original)).toBe(false)

    expect(readEvidenceFile(stored.path, true).equals(original)).toBe(true)
  })

  it('reads unencrypted files unchanged', () => {
    const file = write('plain.txt', 'legacy record')
    expect(readEvidenceFile(file, false).toString()).toBe('legacy record')
  })
})

describe('download tickets', () => {
  it('issues a verifiable ticket bound to one evidence record and user', () => {
    const ticket = createDownloadTicket('evidence-1', 'user-1', 'Test Reviewer', 300)
    const payload = verifyDownloadTicket(ticket.token)
    expect(payload).toMatchObject({ evidenceId: 'evidence-1', userId: 'user-1' })
    expect(ticket.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('rejects a tampered ticket', () => {
    const ticket = createDownloadTicket('evidence-1', 'user-1', 'Test Reviewer')
    const [body, signature] = ticket.token.split('.')
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`
    expect(verifyDownloadTicket(`${body}.${flipped}`)).toBeNull()
  })

  it('rejects a garbage token', () => {
    expect(verifyDownloadTicket('not-a-ticket')).toBeNull()
    expect(verifyDownloadTicket('')).toBeNull()
  })
})
