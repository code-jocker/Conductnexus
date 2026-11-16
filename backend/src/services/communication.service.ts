import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { Types } from 'mongoose'
import { getSettings } from '../models/core.js'
import { GuardianLink, Parent, Student } from '../models/school.js'
import { Incident } from '../models/discipline.js'
import { Letter, MessageQueue, NotificationTemplate, WhatsappSession } from '../models/communications.js'
import { ApiError } from '../shared/errors.js'
import { logger } from '../shared/logger.js'
import { env, whatsappEnabled } from '../config/env.js'
import { extractPlaceholders } from '../data/templateLibrary.js'

const execFileAsync = promisify(execFile)

export type ParentMessageInput = {
  studentId: string | Types.ObjectId
  templateKey: string
  incidentId?: string | Types.ObjectId
  letterId?: string | Types.ObjectId
  extraVars?: Record<string, string | number>
  dedupeSuffix?: string
  createdBy?: Types.ObjectId
  onlyParentId?: string | Types.ObjectId
}

export function renderTemplate(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => String(vars[key] ?? ''))
}

/** Placeholders still present in already-rendered text. */
export function unresolvedPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))]
}

/**
 * Placeholders a template declares that the caller supplied no value for.
 *
 * Rendering replaces unknown placeholders with an empty string, so a rendered
 * body cannot be inspected after the fact — the check has to run against the
 * template text and the supplied variables.
 */
export function missingPlaceholders(text: string, vars: Record<string, string | number | undefined>): string[] {
  return extractPlaceholders(text).filter((p) => vars[p] === undefined)
}

/**
 * A message must never reach a guardian with an unfilled placeholder: it reads
 * as a system fault and destroys trust in official communication. Rendering is
 * validated before anything is queued, and the offending placeholders are named
 * so the operator can fix the data or the template.
 */
export function assertNoUnresolvedPlaceholders(missing: string[], label: string): void {
  if (missing.length) {
    throw ApiError.badRequest(
      `${label} has unresolved placeholders (${[...new Set(missing)].join(', ')}); provide the missing values before sending.`,
    )
  }
}

/**
 * Parent communication is WhatsApp-only. When the WhatsApp session is not
 * connected the message is skipped rather than silently downgraded to SMS
 * or email, so guardians never receive a channel the school did not choose.
 */
function channelFor(parent: InstanceType<typeof Parent>): 'whatsapp' | null {
  const settings = getSettingsSync()
  if (!settings) return null
  const phone = String(parent.phone ?? '').trim()
  if (phone && parent.whatsappConsent && settings.comms.whatsappEnabled) return 'whatsapp'
  return null
}

let cachedSettings: Awaited<ReturnType<typeof getSettings>> | null = null
function getSettingsSync() {
  return cachedSettings
}
export async function refreshCommsSettings() {
  cachedSettings = await getSettings()
}

function quietHoursNextAttempt(): Date {
  const settings = cachedSettings
  if (!settings) return new Date()
  const start = settings.comms.quietHoursStart
  const end = settings.comms.quietHoursEnd
  const now = new Date()
  const kigaliHour = (now.getUTCHours() + 2) % 24
  const inQuiet = start > end ? kigaliHour >= start || kigaliHour < end : kigaliHour >= start && kigaliHour < end
  if (!inQuiet) return now
  const next = new Date(now)
  const hoursUntil = (end - kigaliHour + 24) % 24 || 1
  next.setUTCHours(next.getUTCHours() + hoursUntil, 5, 0, 0)
  return next
}

export async function queueParentMessage(input: ParentMessageInput): Promise<{ queued: number; skipped: number }> {
  await refreshCommsSettings()
  const settings = cachedSettings!
  const student = await Student.findById(input.studentId)
  if (!student) throw ApiError.notFound('Student not found')
  // Kinyarwanda variant is preferred when the school language is rw; otherwise
  // fall back to the English template so messages are never dropped.
  const preferredKey = settings.academic.language === 'rw' ? `${input.templateKey}_rw` : input.templateKey
  const template =
    (await NotificationTemplate.findOne({ key: preferredKey, active: true })) ??
    (await NotificationTemplate.findOne({ key: input.templateKey, active: true }))
  if (!template) throw ApiError.badRequest(`Notification template "${input.templateKey}" is not configured`)

  let parents = await GuardianLink.find({ studentId: student._id }).populate<{ parentId: InstanceType<typeof Parent> }>('parentId')
  if (input.onlyParentId) parents = parents.filter((p) => String(p.parentId?._id) === String(input.onlyParentId))

  const incident = input.incidentId ? await Incident.findById(input.incidentId) : null
  const letter = input.letterId ? await Letter.findById(input.letterId) : null
  const portalUrl = `${env.APP_URL.replace(/\/$/, '')}/portal`
  const vars: Record<string, string | number | undefined> = {
    studentName: student.fullName,
    studentId: student.studentId,
    className: (student as unknown as { className?: string }).className ?? '',
    balance: student.currentBalance,
    offenceName: incident?.offenceSnapshot?.name ?? '',
    deduction: incident ? Math.abs(incident.offenceSnapshot?.deduction ?? 0) : '',
    incidentDate: incident ? new Date(incident.occurredAt).toLocaleDateString('en-RW', { timeZone: 'Africa/Kigali' }) : '',
    incidentNumber: incident?.incidentNumber ?? '',
    schoolName: settings.school.name,
    portalUrl,
    letterType: letter?.type ?? input.templateKey,
    ...input.extraVars,
  }
  const renderedBody = renderTemplate(template.body, vars)
  const renderedSubject = template.subject ? renderTemplate(template.subject, vars) : ''
  // Refuse to queue anything with an unfilled placeholder. Failing here is
  // deliberate: a half-rendered message is worse than a delayed one.
  assertNoUnresolvedPlaceholders(
    missingPlaceholders(template.body, vars),
    `Template "${input.templateKey}" body`,
  )
  if (template.subject) {
    assertNoUnresolvedPlaceholders(
      missingPlaceholders(template.subject, vars),
      `Template "${input.templateKey}" subject`,
    )
  }
  // Every parent-facing (WhatsApp) message carries the parent-portal link so
  // guardians can review authorised, linked-child details.
  const body = template.channel === 'whatsapp' ? `${renderedBody}\n\nParent portal: ${portalUrl}` : renderedBody

  let queued = 0
  let skipped = 0
  for (const link of parents) {
    const parent = link.parentId
    if (!parent) continue
    const channel = channelFor(parent)
    if (!channel) {
      skipped++
      continue
    }
    const to = parent.phone
    const dedupeKey = `${input.templateKey}:${input.incidentId ?? input.letterId ?? input.dedupeSuffix ?? Date.now()}:${parent._id}`
    try {
      await MessageQueue.create({
        channel,
        to,
        parentId: parent._id,
        studentId: student._id,
        incidentId: input.incidentId,
        letterId: input.letterId,
        templateKey: input.templateKey,
        subject: renderedSubject || undefined,
        body,
        status: 'queued',
        maxAttempts: settings.comms.retryLimit,
        nextAttemptAt: quietHoursNextAttempt(),
        dedupeKey,
        createdBy: input.createdBy,
      })
      queued++
    } catch (err) {
      if ((err as { code?: number }).code === 11000) skipped++
      else throw err
    }
  }

  if (incident) {
    incident.parentNotificationStatus = queued > 0 ? 'queued' : parents.length ? 'failed' : 'not_required'
    await incident.save()
  }
  if (letter) {
    letter.deliveryStatus = queued > 0 ? 'queued' : 'failed'
    await letter.save()
  }
  if (queued > 0) kickMessageQueue()
  return { queued, skipped }
}

// ── WhatsApp adapter ───────────────────────────────────────────────────────

type WaState = {
  client: any
  status: string
  initPromise?: Promise<void>
}

const wa: WaState = { client: null, status: 'disconnected' }
let initializedModule = false
/** Bounded exponential backoff so a dropped link recovers without an admin click. */
let reconnectTimer: NodeJS.Timeout | null = null
let reconnectAttempts = 0
const RECONNECT_MAX_ATTEMPTS = 6
const RECONNECT_BASE_MS = 30_000

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

/** Absolute path of the browser profile that holds the saved WhatsApp link. */
function whatsappProfileDir(): string {
  return path.resolve(process.cwd(), 'storage/whatsapp-session', `session-${env.WHATSAPP_SESSION}`)
}

/**
 * Kill browser processes still holding the WhatsApp profile.
 *
 * The profile directory can only be used by one browser. If the previous
 * process was killed abruptly (SIGKILL, crash, container stop) its browser is
 * orphaned and keeps the profile locked, so the saved link cannot be restored
 * and the gateway falls back to demanding a QR scan. Reaping the orphans is what
 * lets a restart reconnect without re-linking.
 */
async function reapOrphanedWhatsappBrowsers(): Promise<number> {
  const profile = whatsappProfileDir()
  try {
    const script =
      process.platform === 'win32'
        ? [
            `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |`,
            `Where-Object { $_.CommandLine -like '*${profile}*' } |`,
            `ForEach-Object { $_.ProcessId }`,
          ].join(' ')
        : `pgrep -f ${JSON.stringify(profile)} || true`
    const { stdout } = await execFileAsync(script, { shell: true, timeout: 20_000 })
    const pids = String(stdout)
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    for (const pid of pids) {
      try {
        if (process.platform === 'win32') await execFileAsync(`taskkill /PID ${pid} /T /F`, { timeout: 20_000 })
        else process.kill(pid, 'SIGKILL')
      } catch (err) {
        logger.debug({ err, pid }, 'Could not reap orphaned WhatsApp browser')
      }
    }
    if (pids.length > 0) {
      logger.warn({ reaped: pids.length, profile }, 'Cleared orphaned WhatsApp browser processes')
    }
    return pids.length
  } catch (err) {
    logger.debug({ err }, 'Orphan scan skipped')
    return 0
  }
}

/**
 * Drop a client without leaving its browser behind.
 *
 * Every failure path used to clear `wa.client` instead of destroying it, which
 * leaked a Chrome process per attempt — the direct cause of the QR loop.
 */
async function retireClient(client: unknown) {
  if (wa.client === client) wa.client = null
  try {
    await (client as { destroy?: () => Promise<void> } | null)?.destroy?.()
  } catch (err) {
    logger.warn({ err }, 'WhatsApp browser destroy failed')
  }
}

function scheduleReconnect() {
  if (!whatsappEnabled) return
  if (reconnectTimer) return
  if (reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
    logger.warn(
      { attempts: reconnectAttempts },
      'WhatsApp reconnect attempts exhausted; an administrator must re-link the phone',
    )
    return
  }
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, 10 * 60_000)
  reconnectAttempts += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    logger.info({ attempt: reconnectAttempts, delayMs: delay }, 'Retrying WhatsApp session')
    startWhatsapp()
      .then(() => undefined)
      .catch((err) => logger.error({ err }, 'WhatsApp reconnect attempt failed'))
  }, delay)
  reconnectTimer.unref?.()
}

async function persistStatus(status: string, extra: Record<string, unknown> = {}) {
  wa.status = status
  await WhatsappSession.findOneAndUpdate(
    { sessionName: env.WHATSAPP_SESSION },
    { $set: { status, ...extra } },
    { upsert: true },
  )
}

/**
 * whatsapp-web.js surfaces puppeteer's raw wait errors ("Waiting failed") when
 * the Web client never reaches a usable state. Translate the known ones so an
 * administrator sees the next action instead of a library string.
 */
const WA_ERROR_HINTS: Array<{ test: RegExp; hint: string }> = [
  {
    test: /waiting failed|timed? ?out|timeout/i,
    hint: 'WhatsApp Web did not finish loading. Re-link the phone (WhatsApp → Linked devices → Link a device) and keep the school phone online.',
  },
  {
    test: /conflict|stream.*(conflict|replace)|replaced/i,
    hint: 'This number was linked somewhere else, which replaced the session. Scan the QR code again on the school phone.',
  },
  {
    test: /not.?authorized|logged out|401|403/i,
    hint: 'The link was revoked or expired. Scan the QR code again on the school phone.',
  },
  {
    test: /enotfound|econnrefused|net::err|network|socket hang up/i,
    hint: 'The server cannot reach WhatsApp Web. Check outbound HTTPS to web.whatsapp.com from this host.',
  },
  {
    test: /target closed|browser.*closed|protocol error/i,
    hint: 'The browser session closed unexpectedly. Restarting the gateway now.',
  },
]

export function explainWhatsAppError(raw: unknown): string {
  const message = (raw instanceof Error ? raw.message : String(raw ?? '')).trim()
  if (!message) return ''
  const match = WA_ERROR_HINTS.find((entry) => entry.test.test(message))
  return match ? `${message} — ${match.hint}` : message
}

export async function startWhatsapp(phoneNumber?: string): Promise<{ status: string; message: string }> {
  if (!whatsappEnabled) {
    await persistStatus('disabled')
    return { status: 'disabled', message: 'WhatsApp is disabled. Enable ENABLE_WHATSAPP after installing whatsapp-web.js.' }
  }
  const pairPhone = String(phoneNumber ?? env.WHATSAPP_PAIR_PHONE ?? '').replace(/[^\d]/g, '')
  if (wa.client) {
    if (!pairPhone || wa.status === 'ready') {
      return { status: wa.status, message: 'WhatsApp session already initialized.' }
    }
    // Switching an unlinked session to phone pairing: restart the browser cleanly.
    await stopWhatsapp()
  }
  // A manual connect supersedes any scheduled retry.
  clearReconnectTimer()
  // Clear browsers left behind by an abrupt previous exit so the saved link can
  // be restored instead of demanding a fresh QR scan.
  await reapOrphanedWhatsappBrowsers()

  try {
    const spec = 'whatsapp-web.js'
    const mod: any = await import(spec)
    const { Client, LocalAuth } = mod.default ?? mod
    const QRCode = (await import('qrcode')).default as any
    const chromeArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-quic',
      '--disable-features=DnsOverHttps,AsyncDns',
    ]
    if (env.WHATSAPP_RESOLVER_IP) {
      chromeArgs.push(`--host-resolver-rules=MAP static.whatsapp.net ${env.WHATSAPP_RESOLVER_IP}`)
    }
    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: 'storage/whatsapp-session', clientId: env.WHATSAPP_SESSION }),
      authTimeoutMs: 300_000,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
      ...(pairPhone
        ? { pairWithPhoneNumber: { phoneNumber: pairPhone, showNotification: true, intervalMs: 180_000 } }
        : {}),
      puppeteer: {
        headless: true,
        executablePath: env.WHATSAPP_EXECUTABLE_PATH || undefined,
        args: chromeArgs,
      },
    })
    wa.client = client
    initializedModule = true
    await persistStatus('initializing', {
      lastError: null,
      qrDataUrl: null,
      pairingCode: null,
      pairingPhone: pairPhone || null,
    })

    const isCurrent = () => wa.client === client
    client.on('qr', async (qr: string) => {
      if (!isCurrent()) return
      try {
        const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 })
        await persistStatus('qr', { qrDataUrl: dataUrl, lastQrAt: new Date(), lastError: null, pairingCode: null })
      } catch (err) {
        logger.warn({ err }, 'QR generation failed')
      }
    })
    client.on('code', async (code: string) => {
      if (!isCurrent()) return
      await persistStatus('pairing', { pairingCode: code, qrDataUrl: null, lastError: null })
      logger.info('WhatsApp pairing code issued')
    })
    client.on('ready', async () => {
      if (!isCurrent()) return
      const info = client.info
      reconnectAttempts = 0
      clearReconnectTimer()
      await persistStatus('ready', {
        lastConnectedAt: new Date(),
        qrDataUrl: null,
        pairingCode: null,
        lastError: null,
        info: { pushname: info?.pushname, number: info?.wid?.user },
      })
      logger.info('WhatsApp session ready')
      // Messages parked while the channel was down must not wait for the next
      // worker tick to start flowing again.
      void processMessageQueue().catch((err) => logger.error({ err }, 'Queue flush after WhatsApp ready failed'))
    })
    client.on('auth_failure', async (msg: string) => {
      if (!isCurrent()) return
      await retireClient(client)
      await persistStatus('auth_failure', { lastError: explainWhatsAppError(msg) })
      scheduleReconnect()
    })
    client.on('disconnected', async (reason: string) => {
      if (!isCurrent()) return
      await retireClient(client)
      await persistStatus('disconnected', { lastError: explainWhatsAppError(reason) })
      scheduleReconnect()
    })

    wa.initPromise = client.initialize().catch(async (err: Error) => {
      logger.error({ err }, 'WhatsApp initialization failed')
      if (!isCurrent()) return
      await retireClient(client)
      await persistStatus('failed', { lastError: explainWhatsAppError(err) })
      scheduleReconnect()
    })
    return {
      status: 'initializing',
      message: pairPhone
        ? 'Connecting to WhatsApp. A pairing code will appear shortly.'
        : 'Connecting to WhatsApp. A QR code will appear shortly.',
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'whatsapp-web.js is not installed'
    await persistStatus('not_installed', { lastError: message })
    return {
      status: 'not_installed',
      message: 'whatsapp-web.js is not installed. Run "npm --prefix backend install whatsapp-web.js" and enable WhatsApp in settings.',
    }
  }
}

export async function stopWhatsapp() {
  // An admin-initiated disconnect is final until they connect again.
  clearReconnectTimer()
  reconnectAttempts = 0
  if (wa.client) {
    try {
      await wa.client.destroy()
    } catch (err) {
      logger.warn({ err }, 'WhatsApp destroy failed')
    }
    wa.client = null
  }
  await persistStatus('disconnected', { qrDataUrl: null, pairingCode: null, lastError: null })
}

export async function whatsappStatus() {
  const session = await WhatsappSession.findOne({ sessionName: env.WHATSAPP_SESSION })
  return {
    status: wa.status === 'ready' ? 'ready' : session?.status ?? 'disabled',
    qrDataUrl: session?.qrDataUrl,
    pairingCode: session?.pairingCode,
    pairingPhone: session?.pairingPhone,
    lastConnectedAt: session?.lastConnectedAt,
    lastError: session?.lastError,
    info: session?.info,
    enabled: whatsappEnabled,
    moduleInitialized: initializedModule,
  }
}

async function sendWhatsapp(to: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!wa.client || wa.status !== 'ready') return { ok: false, error: 'WhatsApp is not connected' }
  try {
    const number = to.replace(/[^\d]/g, '')
    await wa.client.sendMessage(`${number}@c.us`, body)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'WhatsApp send failed' }
  }
}

// ── Queue worker ───────────────────────────────────────────────────────────

let workerRunning = false
let pendingKick = false
export let lastWorkerRun: Date | null = null
export let workerProcessed = 0
export let workerRecovered = 0
/** Why the worker skipped a cycle, or null when it ran normally. */
export let workerBlockedReason: string | null = null
export let workerBlockedAt: Date | null = null
/** Rate-limits the "queue paused" warning to one line every five minutes. */
let lastBlockedLog: Date | null = null

/**
 * Plain-language reason a WhatsApp message cannot be sent yet.
 *
 * The queue is intentionally not failed when the channel is down — the message
 * must survive until the phone is linked — but a silently parked message is
 * indistinguishable from a broken worker, so the reason is recorded and surfaced.
 */
export function deliveryBlockReason(): { ready: boolean; status: string; enabled: boolean; reason: string | null } {
  const status = wa.status
  const enabled = whatsappEnabled
  if (status === 'ready') return { ready: true, status, enabled, reason: null }
  if (!enabled) {
    return {
      ready: false,
      status,
      enabled,
      reason:
        'WhatsApp is disabled. Set ENABLE_WHATSAPP=true, restart the API, then link the phone by scanning the QR code.',
    }
  }
  const reasons: Record<string, string> = {
    qr: 'WhatsApp is waiting for the phone to scan the QR code in Settings → WhatsApp.',
    pairing: 'WhatsApp is waiting for the pairing code to be entered on the phone.',
    connecting: 'WhatsApp is connecting to the phone.',
    disconnected: 'The WhatsApp session is disconnected. Re-link the phone if this persists.',
    disabled: 'The WhatsApp session is disabled.',
  }
  return {
    ready: false,
    status,
    enabled,
    reason: reasons[status] ?? `The WhatsApp session is "${status}". Re-link the phone if this persists.`,
  }
}

export async function processMessageQueue(limit = 20): Promise<{ processed: number; sent: number; failed: number }> {
  if (workerRunning) return { processed: 0, sent: 0, failed: 0 }
  workerRunning = true
  let sent = 0
  let failed = 0
  try {
    await refreshCommsSettings()
    await rerouteStrandedSms()
    // Keep messages queued while the phone is offline instead of burning
    // attempts against a session that cannot deliver yet.
    const delivery = deliveryBlockReason()
    if (!delivery.ready) {
      workerBlockedReason = delivery.reason
      workerBlockedAt = new Date()
      const sinceLastLog = lastBlockedLog ? Date.now() - lastBlockedLog.getTime() : Number.POSITIVE_INFINITY
      if (sinceLastLog > 5 * 60_000) {
        lastBlockedLog = new Date()
        logger.warn({ reason: delivery.reason, status: delivery.status, enabled: delivery.enabled }, 'Message queue paused: WhatsApp is not ready')
      }
      return { processed: 0, sent: 0, failed: 0 }
    }
    workerBlockedReason = null
    workerBlockedAt = null
    const now = new Date()
    // A worker that crashed after claiming a message would leave it in
    // 'sending' forever. Reclaim expired leases before processing.
    const recovered = await MessageQueue.updateMany(
      { status: 'sending', leaseUntil: { $lt: now } },
      {
        $set: {
          status: 'failed',
          lastError: 'Delivery worker stopped before confirming the send; queued for another attempt.',
          nextAttemptAt: now,
        },
        $unset: { leaseUntil: 1 },
        $inc: { attempts: 1 },
      },
    )
    if (recovered.modifiedCount) workerRecovered += recovered.modifiedCount
    for (let i = 0; i < limit; i++) {
      const msg = await MessageQueue.findOneAndUpdate(
        { status: { $in: ['queued', 'failed'] }, nextAttemptAt: { $lte: now } },
        { $set: { status: 'sending', leaseUntil: new Date(now.getTime() + 5 * 60_000) } },
        { new: true, sort: { nextAttemptAt: 1 } },
      )
      if (!msg) break

      try {
        let result: { ok: boolean; error?: string; provider?: string } = { ok: false, error: 'Unknown channel' }
        if (msg.channel !== 'whatsapp') {
          msg.status = 'manual_review'
          msg.lastError = 'Parent messaging is WhatsApp only. This legacy channel was not sent.'
          msg.leaseUntil = undefined
          await msg.save()
          failed++
          continue
        }
        result = await sendWhatsapp(msg.to, msg.body)

        if (result.ok) {
          msg.status = 'sent'
          msg.sentAt = new Date()
          msg.provider = result.provider ?? msg.channel
          msg.leaseUntil = undefined
          await msg.save()
          sent++
          if (msg.incidentId) await Incident.updateOne({ _id: msg.incidentId }, { $set: { parentNotificationStatus: 'sent' } })
          if (msg.letterId) await Letter.updateOne({ _id: msg.letterId }, { $set: { deliveryStatus: 'sent' } })
        } else {
          msg.attempts += 1
          msg.lastError = result.error
          if (msg.attempts >= msg.maxAttempts) {
            msg.status = 'dead_letter'
          } else {
            msg.status = 'failed'
            msg.nextAttemptAt = new Date(Date.now() + msg.attempts * 5 * 60_000)
          }
          msg.leaseUntil = undefined
          await msg.save()
          failed++
          if (msg.incidentId) await Incident.updateOne({ _id: msg.incidentId }, { $set: { parentNotificationStatus: 'failed' } })
        }
      } catch (err) {
        msg.status = 'failed'
        msg.lastError = err instanceof Error ? err.message : 'Delivery error'
        msg.attempts += 1
        msg.leaseUntil = undefined
        await msg.save().catch(() => undefined)
        failed++
      }
    }
  } finally {
    workerRunning = false
    lastWorkerRun = new Date()
    workerProcessed += sent + failed
    if (pendingKick) {
      pendingKick = false
      setTimeout(() => kickMessageQueue(), 250)
    }
  }
  return { processed: sent + failed, sent, failed }
}

/** Dispatch queued parent messages immediately after an approval or send action. */
export function kickMessageQueue(): void {
  if (workerRunning) {
    pendingKick = true
    return
  }
  void processMessageQueue().catch((err) => logger.error({ err }, 'Message queue dispatch failed'))
}

export async function retryMessage(id: string) {
  const msg = await MessageQueue.findById(id)
  if (!msg) throw ApiError.notFound('Message not found')
  if (!['failed', 'dead_letter', 'manual_review'].includes(msg.status)) {
    throw ApiError.badRequest('Only failed or dead-letter messages can be retried')
  }
  if (msg.channel !== 'whatsapp') {
    const settings = getSettingsSync()
    if (!settings?.comms.whatsappEnabled || wa.status !== 'ready') {
      throw ApiError.badRequest('Reconnect WhatsApp before retrying. SMS and email delivery are disabled.')
    }
    if (!/^[+\d][\d\s-]{7,}$/.test(msg.to.trim())) {
      throw ApiError.badRequest('This message has no phone number. Delete it instead of retrying.')
    }
    msg.channel = 'whatsapp'
  }
  msg.status = 'queued'
  msg.attempts = 0
  msg.nextAttemptAt = new Date()
  msg.lastError = undefined
  msg.leaseUntil = undefined
  await msg.save()
  return msg
}

/**
 * Parent messaging is WhatsApp-only, so any unsent SMS rows left over from
 * before that decision are moved onto WhatsApp once the session is ready.
 */
export async function rerouteStrandedSms(force = false): Promise<{ rerouted: number; reason?: string }> {
  const settings = getSettingsSync()
  if (!settings?.comms.whatsappEnabled) return { rerouted: 0, reason: 'WhatsApp is disabled in Settings → Communications.' }
  if (wa.status !== 'ready') return { rerouted: 0, reason: 'WhatsApp is not connected.' }
  const filter = {
    channel: 'sms',
    status: { $in: ['queued', 'failed', 'dead_letter', 'manual_review'] },
  }
  const result = await MessageQueue.updateMany(filter, {
    $set: { channel: 'whatsapp', status: 'queued', attempts: 0, nextAttemptAt: new Date() },
    $unset: { lastError: 1 },
  })
  if (result.modifiedCount) logger.info({ count: result.modifiedCount, force }, 'Re-routed unsent SMS messages to WhatsApp')
  return { rerouted: result.modifiedCount }
}

/** Remove failed SMS/email queue rows so only WhatsApp remains in the queue. */
export async function purgeNonWhatsappFailures(): Promise<{ purged: number; byChannel: Record<string, number> }> {
  const rows = await MessageQueue.aggregate<{ _id: string; count: number }>([
    { $match: { channel: { $in: ['sms', 'email'] }, status: { $in: ['failed', 'dead_letter', 'manual_review'] } } },
    { $group: { _id: '$channel', count: { $sum: 1 } } },
  ])
  const result = await MessageQueue.deleteMany({
    channel: { $in: ['sms', 'email'] },
    status: { $in: ['failed', 'dead_letter', 'manual_review'] },
  })
  const byChannel = Object.fromEntries(rows.map((r) => [r._id, r.count]))
  if (result.deletedCount) logger.info({ count: result.deletedCount, byChannel }, 'Purged failed non-WhatsApp messages')
  return { purged: result.deletedCount, byChannel }
}

export async function queueStatusCounts() {
  const rows = await MessageQueue.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  return Object.fromEntries(rows.map((r) => [r._id as string, r.count as number]))
}
