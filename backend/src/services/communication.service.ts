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
import {
  emailConfigured,
  env,
  smsConfigured,
  whatsappAvailable,
  whatsappEnabled,
  whatsappGatewayConfigured,
} from '../config/env.js'
import { extractPlaceholders } from '../data/templateLibrary.js'
import { sendMail } from './email.service.js'
import { sendSms } from './sms.service.js'
import { escapeHtml } from '../shared/utils.js'

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
  /** Safeguarding alerts bypass quiet hours and are queued immediately. */
  critical?: boolean
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
 * Delivery channels this guardian has actively consented to, preferred channel
 * first. A missing consent is a no, never an implicit yes. Email and SMS are
 * offered only when their provider is configured, so the queue never fills with
 * messages that cannot physically be delivered.
 */
function channelsFor(parent: InstanceType<typeof Parent>): Array<'whatsapp' | 'email' | 'sms'> {
  const settings = getSettingsSync()
  if (!settings) return []
  const enabled: Array<'whatsapp' | 'email' | 'sms'> = []
  if (settings.comms.whatsappEnabled && parent.whatsappConsent && String(parent.phone ?? '').trim()) {
    enabled.push('whatsapp')
  }
  if (emailConfigured && parent.emailConsent && String(parent.email ?? '').trim()) {
    enabled.push('email')
  }
  if (settings.comms.smsEnabled && smsConfigured && parent.smsConsent && String(parent.phone ?? '').trim()) {
    enabled.push('sms')
  }
  const preferred = parent.preferredChannel as 'whatsapp' | 'email' | 'sms' | 'call'
  if (preferred !== 'call' && enabled.includes(preferred)) {
    return [preferred, ...enabled.filter((channel) => channel !== preferred)]
  }
  return enabled
}

function recipientFor(parent: InstanceType<typeof Parent>, channel: 'whatsapp' | 'email' | 'sms'): string {
  return channel === 'email' ? String(parent.email ?? '') : String(parent.phone ?? '')
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
  // Every parent-facing message carries the parent-portal link so guardians can
  // review authorised, linked-child details, whichever channel was chosen.
  const body = `${renderedBody}\n\nParent portal: ${portalUrl}`
  const nextAttemptAt = input.critical ? new Date() : quietHoursNextAttempt()
  const subject = renderedSubject || `${settings.school.name || 'ConductNexus'} — ${template.name}`

  let queued = 0
  let skipped = 0
  for (const link of parents) {
    const parent = link.parentId
    if (!parent) continue
    const [channel] = channelsFor(parent)
    if (!channel) {
      skipped++
      continue
    }
    const to = recipientFor(parent, channel)
    if (!to) {
      skipped++
      continue
    }
    const dedupeKey = `${input.templateKey}:${input.incidentId ?? input.letterId ?? input.dedupeSuffix ?? Date.now()}:${parent._id}:${channel}`
    try {
      await MessageQueue.create({
        channel,
        to,
        parentId: parent._id,
        studentId: student._id,
        incidentId: input.incidentId,
        letterId: input.letterId,
        templateKey: input.templateKey,
        subject: channel === 'whatsapp' ? undefined : subject,
        body,
        status: 'queued',
        maxAttempts: settings.comms.retryLimit,
        nextAttemptAt,
        dedupeKey,
        priority: input.critical ? 'critical' : 'normal',
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

type GatewaySnapshot = {
  status: string
  qrDataUrl?: string | null
  pairingCode?: string | null
  pairingPhone?: string | null
  lastQrAt?: string | null
  lastConnectedAt?: string | null
  lastError?: string | null
  info?: { pushname?: string; number?: string } | null
}

// The gateway owns the linked phone; this process only keeps the last poll so
// the queue can decide whether WhatsApp rows may run without a network call.
let gatewaySnapshot: GatewaySnapshot | null = null
let gatewayError: string | null = null
let gatewaySnapshotAt: number | null = null
const GATEWAY_STATUS_CACHE_TTL_MS = 8_000

async function gatewayRequest<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const base = env.WHATSAPP_GATEWAY_URL.replace(/\/+$/, '')
  const maxRetries = 3
  let lastError: unknown = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${base}${pathname}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.WHATSAPP_GATEWAY_TOKEN}`,
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(pathname === '/status' ? 4_000 : 10_000),
    })

    // Rate limited — honor Retry-After and retry.
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfter = response.headers.get('retry-after')
      const delayMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : Math.min(1000 * 2 ** attempt, 10_000)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      lastError = new Error(`WhatsApp gateway rate limited (attempt ${attempt + 1}/${maxRetries + 1})`)
      continue
    }

    const payload = (await response.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `WhatsApp gateway returned ${response.status}`)
    }
    return payload as T
  }

  throw lastError ?? new Error('WhatsApp gateway request failed after retries')
}

async function refreshGatewaySnapshot(): Promise<GatewaySnapshot | null> {
  const now = Date.now()
  if (gatewaySnapshot && gatewaySnapshotAt && now - gatewaySnapshotAt < GATEWAY_STATUS_CACHE_TTL_MS) {
    return gatewaySnapshot
  }
  try {
    gatewaySnapshot = await gatewayRequest<GatewaySnapshot>('/status')
    gatewayError = null
    gatewaySnapshotAt = now
  } catch (err) {
    gatewaySnapshot = null
    gatewayError = err instanceof Error ? err.message : 'WhatsApp gateway is unreachable'
    gatewaySnapshotAt = now
  }
  return gatewaySnapshot
}

export function whatsappGatewayReady(): boolean {
  return whatsappGatewayConfigured && gatewaySnapshot?.status === 'ready'
}

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
    // Run PowerShell directly. Going through `shell: true` on Windows launches
    // cmd.exe, where the Get-CimInstance cmdlet does not exist.
    const { stdout } =
      process.platform === 'win32'
        ? await execFileAsync(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              [
                `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |`,
                `Where-Object { $_.CommandLine -like '*${profile}*' } |`,
                `ForEach-Object { $_.ProcessId }`,
              ].join(' '),
            ],
            { timeout: 20_000 },
          )
        : await execFileAsync('pgrep', ['-f', profile], { timeout: 20_000 })
    const pids = String(stdout)
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    for (const pid of pids) {
      try {
        if (process.platform === 'win32') await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 20_000 })
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
  if (whatsappGatewayConfigured) {
    try {
      const result = await gatewayRequest<{ status: string; message: string }>('/connect', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber }),
      })
      void refreshGatewaySnapshot()
      return result
    } catch (err) {
      return {
        status: 'failed',
        message: err instanceof Error ? err.message : 'WhatsApp gateway is unreachable',
      }
    }
  }
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
        const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 224 })
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
    client.on('message_ack', (message: { id?: { _serialized?: string } }, ack: number) => {
      const id = message?.id?._serialized
      if (id) void recordWhatsappReceipt(id, ack)
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
  if (whatsappGatewayConfigured) {
    try {
      await gatewayRequest('/disconnect', { method: 'POST' })
    } catch (err) {
      logger.warn({ err }, 'WhatsApp gateway disconnect failed')
    }
    gatewaySnapshot = null
    gatewayError = null
    await persistStatus('disconnected', { qrDataUrl: null, pairingCode: null, lastError: null })
    return
  }
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
  if (whatsappGatewayConfigured) {
    const settings = await getSettings()
    const snapshot = await refreshGatewaySnapshot()
    const status = snapshot?.status ?? (gatewayError ? 'gateway_unavailable' : 'disconnected')
    return {
      status,
      qrDataUrl: status === 'qr' ? snapshot?.qrDataUrl ?? null : null,
      pairingCode: snapshot?.pairingCode ?? null,
      pairingPhone: snapshot?.pairingPhone ?? null,
      lastConnectedAt: snapshot?.lastConnectedAt ?? null,
      lastError: gatewayError ?? snapshot?.lastError ?? null,
      info: snapshot?.info ?? null,
      // The gateway is the WhatsApp capability for this deployment; the school
      // may still keep the channel switched off for recipients in Settings.
      enabled: true,
      settingsEnabled: settings.comms.whatsappEnabled,
      moduleInitialized: Boolean(snapshot),
      gateway: true,
      gatewayUrl: env.WHATSAPP_GATEWAY_URL,
    }
  }
  const [session, settings] = await Promise.all([
    WhatsappSession.findOne({ sessionName: env.WHATSAPP_SESSION }),
    getSettings(),
  ])
  return {
    status: wa.status === 'ready' ? 'ready' : session?.status ?? 'disabled',
    qrDataUrl: session?.qrDataUrl,
    pairingCode: session?.pairingCode,
    pairingPhone: session?.pairingPhone,
    lastConnectedAt: session?.lastConnectedAt,
    lastError: session?.lastError,
    info: session?.info,
    // `enabled` is the server's capability (ENABLE_WHATSAPP); the school may
    // still have the channel switched on in Settings for another host.
    enabled: whatsappEnabled,
    settingsEnabled: settings.comms.whatsappEnabled,
    moduleInitialized: initializedModule,
  }
}

type DeliveryResult = {
  ok: boolean
  error?: string
  provider?: string
  providerMessageId?: string
}

async function sendWhatsapp(to: string, body: string): Promise<DeliveryResult> {
  if (whatsappGatewayConfigured) {
    try {
      const result = await gatewayRequest<{ providerMessageId?: string }>('/send', {
        method: 'POST',
        body: JSON.stringify({ to, body }),
      })
      return { ok: true, provider: 'whatsapp', providerMessageId: result.providerMessageId }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'WhatsApp gateway send failed',
      }
    }
  }
  if (!wa.client || wa.status !== 'ready') return { ok: false, error: 'WhatsApp is not connected' }
  try {
    const number = to.replace(/[^\d]/g, '')
    const message = await wa.client.sendMessage(`${number}@c.us`, body)
    // The serialized id is what the message_ack event reports back, so it is the
    // key a delivery receipt can be matched against later.
    const providerMessageId: string | undefined =
      message?.id?._serialized ?? (message?.id?.id ? String(message.id.id) : undefined)
    return { ok: true, provider: 'whatsapp', providerMessageId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'WhatsApp send failed' }
  }
}

/**
 * Direct text delivery for time-critical messages such as sign-in codes.
 *
 * The normal parent queue retries on a schedule, but a login code expires in ten
 * minutes, so it must be sent now and fail loudly when WhatsApp is offline.
 */
export async function sendWhatsAppText(to: string, body: string): Promise<DeliveryResult> {
  if (!whatsappAvailable) return { ok: false, error: 'WhatsApp is disabled on this server' }
  return sendWhatsapp(to, body)
}

const WHATSAPP_ACK_LABELS: Record<number, string> = {
  0: 'failed',
  1: 'pending',
  2: 'server',
  3: 'delivered',
  4: 'read',
}

/**
 * Records a WhatsApp delivery acknowledgement against the queued message.
 *
 * whatsapp-web.js reports acknowledgements through an event, not the send call,
 * so the provider id captured at send time is the only way to link "delivered"
 * or "read" back to the row an administrator is looking at.
 */
export async function recordWhatsappReceipt(providerMessageId: string, ack: number | string): Promise<void> {
  const label = typeof ack === 'number' ? WHATSAPP_ACK_LABELS[ack] ?? `ack_${ack}` : String(ack)
  const now = new Date()
  const set: Record<string, unknown> = { ackStatus: label }
  if (label === 'delivered' || label === 'read') set.deliveredAt = now
  if (label === 'read') set.readAt = now
  try {
    await MessageQueue.updateOne(
      { providerMessageId },
      { $set: set, $push: { receipts: { at: now, status: label } } },
    )
  } catch (err) {
    logger.debug({ err, providerMessageId, label }, 'Could not record WhatsApp receipt')
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
  const enabled = whatsappAvailable
  const status = whatsappGatewayConfigured
    ? gatewaySnapshot?.status ?? (gatewayError ? 'gateway_unavailable' : 'connecting')
    : wa.status
  if (status === 'ready') return { ready: true, status, enabled, reason: null }
  if (whatsappGatewayConfigured && gatewayError) {
    return {
      ready: false,
      status,
      enabled,
      reason: `The WhatsApp gateway is unreachable (${gatewayError}). Check that the gateway service is running.`,
    }
  }
  if (!enabled) {
    return {
      ready: false,
      status,
      enabled,
      reason:
        'WhatsApp is disabled. Set ENABLE_WHATSAPP=true or configure WHATSAPP_GATEWAY_URL, restart the API, then link the phone by scanning the QR code.',
    }
  }
  const reasons: Record<string, string> = {
    qr: 'WhatsApp is waiting for the phone to scan the QR code in Settings → WhatsApp.',
    pairing: 'WhatsApp is waiting for the pairing code to be entered on the phone.',
    connecting: 'WhatsApp is connecting to the phone.',
    disconnected: 'The WhatsApp session is disconnected. Re-link the phone if this persists.',
    disabled: 'The WhatsApp session is disabled.',
    gateway_unavailable: 'The WhatsApp gateway is unreachable. Check that the gateway service is running.',
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
    if (whatsappGatewayConfigured) await refreshGatewaySnapshot()
    await rerouteStrandedSms()
    // WhatsApp readiness gates WhatsApp rows only. Email and SMS keep flowing
    // while the phone is unlinked, so one broken channel cannot freeze the queue.
    const delivery = deliveryBlockReason()
    if (!delivery.ready) {
      workerBlockedReason = delivery.reason
      workerBlockedAt = new Date()
      const sinceLastLog = lastBlockedLog ? Date.now() - lastBlockedLog.getTime() : Number.POSITIVE_INFINITY
      if (sinceLastLog > 5 * 60_000) {
        lastBlockedLog = new Date()
        logger.warn(
          { reason: delivery.reason, status: delivery.status, enabled: delivery.enabled },
          'WhatsApp messages are parked until the phone is linked; email and SMS continue',
        )
      }
    } else {
      workerBlockedReason = null
      workerBlockedAt = null
    }
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
    // Critical safeguarding alerts are picked up before routine messaging.
    const claimable: Record<string, unknown> = {
      status: { $in: ['queued', 'failed'] },
      nextAttemptAt: { $lte: now },
    }
    if (!delivery.ready) claimable.channel = { $ne: 'whatsapp' }
    for (let i = 0; i < limit; i++) {
      const msg = await MessageQueue.findOneAndUpdate(claimable, {
        $set: { status: 'sending', leaseUntil: new Date(now.getTime() + 5 * 60_000) },
      }, { new: true, sort: { priority: -1, nextAttemptAt: 1 } })
      if (!msg) break

      try {
        let result: DeliveryResult = { ok: false, error: `Unsupported channel "${msg.channel}"` }
        if (msg.channel === 'whatsapp') {
          result = await sendWhatsapp(msg.to, msg.body)
        } else if (msg.channel === 'email') {
          const mail = await sendMail({
            to: msg.to,
            subject: msg.subject || 'ConductNexus notification',
            html: `<p>${escapeHtml(msg.body).replace(/\n/g, '<br/>')}</p>`,
            text: msg.body,
          })
          result = mail.delivered
            ? { ok: true, provider: 'smtp', providerMessageId: mail.id }
            : { ok: false, error: 'Email could not be delivered; check the SMTP configuration and the stored outbox.' }
        } else if (msg.channel === 'sms') {
          const sms = await sendSms(msg.to, msg.body)
          result = sms.ok
            ? { ok: true, provider: sms.provider, providerMessageId: sms.messageId }
            : { ok: false, error: sms.error }
        }

        if (result.ok) {
          msg.status = 'sent'
          msg.sentAt = new Date()
          msg.provider = result.provider ?? msg.channel
          msg.providerMessageId = result.providerMessageId
          msg.leaseUntil = undefined
          await msg.save()
          sent++
          if (msg.incidentId) await Incident.updateOne({ _id: msg.incidentId }, { $set: { parentNotificationStatus: 'sent' } })
          if (msg.letterId) await Letter.updateOne({ _id: msg.letterId }, { $set: { deliveryStatus: 'sent' } })
        } else {
          const permanent = isPermanentDeliveryError(result.error)
          msg.attempts += 1
          msg.lastError = result.error
          if (permanent || msg.attempts >= msg.maxAttempts) {
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

/**
 * Errors that will not fix themselves on the next tick. They still land in the
 * dead-letter queue, where an administrator can retry them after changing the
 * number, provider credentials or settings.
 */
function isPermanentDeliveryError(error?: string): boolean {
  const text = String(error ?? '').toLowerCase()
  if (!text) return false
  return /invalid phone|no phone|not a valid|credentials are missing|smtp configuration|not configured/.test(text)
}

/** Dispatch queued parent messages immediately after an approval or send action. */
export function kickMessageQueue(): void {
  if (workerRunning) {
    pendingKick = true
    return
  }
  void processMessageQueue().catch((err) => logger.error({ err }, 'Message queue dispatch failed'))
}

/**
 * A retry keeps the channel the guardian actually consented to. Silently
 * switching a failed email or SMS onto WhatsApp would bypass that consent.
 */
export async function retryMessage(id: string) {
  const msg = await MessageQueue.findById(id)
  if (!msg) throw ApiError.notFound('Message not found')
  if (!['failed', 'dead_letter', 'manual_review'].includes(msg.status)) {
    throw ApiError.badRequest('Only failed or dead-letter messages can be retried')
  }
  const settings = getSettingsSync()
  if (msg.channel === 'whatsapp') {
    if (wa.status !== 'ready') throw ApiError.badRequest('Reconnect WhatsApp before retrying this message.')
    if (!/^[+\d][\d\s-]{7,}$/.test(msg.to.trim())) {
      throw ApiError.badRequest('This message has no phone number. Delete it instead of retrying.')
    }
  } else if (msg.channel === 'email') {
    if (!emailConfigured) throw ApiError.badRequest('Configure SMTP before retrying this email.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.to.trim())) {
      throw ApiError.badRequest('This message has no valid email address. Delete it instead of retrying.')
    }
  } else if (msg.channel === 'sms') {
    if (!settings?.comms.smsEnabled || !smsConfigured) {
      throw ApiError.badRequest('Enable SMS and add Africa\'s Talking credentials before retrying this message.')
    }
  } else {
    throw ApiError.badRequest(`Unsupported channel "${msg.channel}"`)
  }
  msg.status = 'queued'
  msg.attempts = 0
  msg.nextAttemptAt = new Date()
  msg.lastError = undefined
  msg.leaseUntil = undefined
  await msg.save()
  kickMessageQueue()
  return msg
}

/** Requeues every dead-letter row in one operation so recovery is not one-by-one. */
export async function retryDeadLetters(input: { channel?: string; limit?: number } = {}) {
  const filter: Record<string, unknown> = {
    status: 'dead_letter',
    ...(input.channel ? { channel: input.channel } : {}),
  }
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000)
  const rows = await MessageQueue.find(filter).sort({ createdAt: 1 }).limit(limit).select('_id channel').lean()
  if (!rows.length) return { retried: 0, byChannel: {} as Record<string, number> }
  const ids = rows.map((row) => row._id)
  await MessageQueue.updateMany(
    { _id: { $in: ids } },
    { $set: { status: 'queued', attempts: 0, nextAttemptAt: new Date() }, $unset: { lastError: 1, leaseUntil: 1 } },
  )
  const byChannel = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.channel] = (acc[row.channel] ?? 0) + 1
    return acc
  }, {})
  kickMessageQueue()
  return { retried: rows.length, byChannel }
}

/**
 * Moves unsent SMS rows onto WhatsApp only when SMS cannot be delivered at all
 * (provider or setting missing) and the guardian has WhatsApp consent. When SMS
 * is configured the rows are delivered as SMS — rerouting would ignore consent.
 */
export async function rerouteStrandedSms(force = false): Promise<{ rerouted: number; reason?: string }> {
  const settings = getSettingsSync()
  if (settings?.comms.smsEnabled && smsConfigured) {
    return { rerouted: 0, reason: 'SMS is configured; stranded SMS messages are delivered directly.' }
  }
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

/**
 * Clears failed rows for channels that cannot currently deliver. A configured
 * SMS or email channel is left alone — those messages are retryable and
 * deleting them would destroy a guardian's only notice.
 */
export async function purgeNonWhatsappFailures(): Promise<{ purged: number; byChannel: Record<string, number> }> {
  const settings = getSettingsSync()
  const unavailable: string[] = []
  if (!settings?.comms.smsEnabled || !smsConfigured) unavailable.push('sms')
  if (!emailConfigured) unavailable.push('email')
  if (!unavailable.length) return { purged: 0, byChannel: {} }
  const match = {
    channel: { $in: unavailable },
    status: { $in: ['failed', 'dead_letter', 'manual_review'] },
  }
  const rows = await MessageQueue.aggregate<{ _id: string; count: number }>([
    { $match: match },
    { $group: { _id: '$channel', count: { $sum: 1 } } },
  ])
  const result = await MessageQueue.deleteMany(match)
  const byChannel = Object.fromEntries(rows.map((r) => [r._id, r.count]))
  if (result.deletedCount) logger.info({ count: result.deletedCount, byChannel }, 'Purged failures on unavailable channels')
  return { purged: result.deletedCount, byChannel }
}

export async function queueStatusCounts() {
  const rows = await MessageQueue.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  return Object.fromEntries(rows.map((r) => [r._id as string, r.count as number]))
}

export type DeliveryAnalytics = {
  windowDays: number
  totals: Record<string, number>
  byChannel: Record<string, Record<string, number>>
  deliveryRate: number | null
  readRate: number | null
  pendingNow: number
  recentFailures: Array<{ channel: string; to: string; templateKey?: string; error?: string; at: Date }>
  topFailureReasons: Array<{ reason: string; count: number }>
}

/**
 * Delivery picture for the communications dashboard: what was attempted per
 * channel, what actually landed, what is stuck, and why it failed.
 */
export async function deliveryAnalytics(windowDays = 7): Promise<DeliveryAnalytics> {
  const days = Math.min(Math.max(Math.trunc(windowDays) || 7, 1), 90)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const [rows, pendingNow, readCount, recentFailures, reasons] = await Promise.all([
    MessageQueue.aggregate<{ _id: { channel: string; status: string }; count: number }>([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { channel: '$channel', status: '$status' }, count: { $sum: 1 } } },
    ]),
    MessageQueue.countDocuments({ status: { $in: ['queued', 'sending', 'failed'] } }),
    MessageQueue.countDocuments({ createdAt: { $gte: since }, readAt: { $exists: true } }),
    MessageQueue.find({ status: { $in: ['failed', 'dead_letter', 'manual_review'] } })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('channel to templateKey lastError createdAt')
      .lean(),
    MessageQueue.aggregate<{ _id: string; count: number }>([
      { $match: { createdAt: { $gte: since }, lastError: { $type: 'string', $ne: '' } } },
      { $group: { _id: '$lastError', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
  ])

  const totals: Record<string, number> = {}
  const byChannel: Record<string, Record<string, number>> = {}
  for (const row of rows) {
    const channel = row._id.channel
    byChannel[channel] ??= {}
    byChannel[channel][row._id.status] = row.count
    totals[row._id.status] = (totals[row._id.status] ?? 0) + row.count
  }
  const attempted = (totals.sent ?? 0) + (totals.failed ?? 0) + (totals.dead_letter ?? 0)
  const deliveryRate = attempted ? Math.round(((totals.sent ?? 0) / attempted) * 1000) / 10 : null
  const readRate = totals.sent ? Math.round((readCount / totals.sent) * 1000) / 10 : null
  return {
    windowDays: days,
    totals,
    byChannel,
    deliveryRate,
    readRate,
    pendingNow,
    recentFailures: recentFailures.map((row) => {
      const contact = String(row.to ?? '')
      return {
        channel: row.channel,
        to: contact.length > 5 ? `${contact.slice(0, 2)}****${contact.slice(-2)}` : '****',
        templateKey: row.templateKey,
        error: row.lastError,
        at: row.createdAt,
      }
    }),
    topFailureReasons: reasons.map((row) => ({ reason: row._id, count: row.count })),
  }
}
