import { Types } from 'mongoose'
import { getSettings } from '../models/core.js'
import { GuardianLink, Parent, Student } from '../models/school.js'
import { Incident } from '../models/discipline.js'
import { Letter, MessageQueue, NotificationTemplate, WhatsappSession } from '../models/communications.js'
import { ApiError } from '../shared/errors.js'
import { logger } from '../shared/logger.js'
import { sendMail } from './email.service.js'
import { env, whatsappEnabled } from '../config/env.js'

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

function channelFor(parent: InstanceType<typeof Parent>): 'whatsapp' | 'sms' | 'email' | null {
  const settings = getSettingsSync()
  const order: ('whatsapp' | 'sms' | 'email')[] =
    parent.preferredChannel === 'email' ? ['email', 'sms', 'whatsapp'] : parent.preferredChannel === 'call' ? ['sms', 'whatsapp', 'email'] : [parent.preferredChannel, 'sms', 'whatsapp', 'email']
  for (const ch of order) {
    if (ch === 'whatsapp' && parent.whatsappConsent && settings?.comms.whatsappEnabled) return 'whatsapp'
    if (ch === 'sms' && parent.smsConsent && settings?.comms.smsEnabled) return 'sms'
    if (ch === 'email' && parent.emailConsent && parent.email) return 'email'
  }
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
  const template = await NotificationTemplate.findOne({ key: input.templateKey, active: true })
  if (!template) throw ApiError.badRequest(`Notification template "${input.templateKey}" is not configured`)

  let parents = await GuardianLink.find({ studentId: student._id }).populate<{ parentId: InstanceType<typeof Parent> }>('parentId')
  if (input.onlyParentId) parents = parents.filter((p) => String(p.parentId?._id) === String(input.onlyParentId))

  const incident = input.incidentId ? await Incident.findById(input.incidentId) : null
  const letter = input.letterId ? await Letter.findById(input.letterId) : null
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
    letterType: letter?.type ?? input.templateKey,
    ...input.extraVars,
  }

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
    const to = channel === 'email' ? parent.email! : parent.phone
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
        subject: template.subject ? renderTemplate(template.subject, vars) : undefined,
        body: renderTemplate(template.body, vars),
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

async function persistStatus(status: string, extra: Record<string, unknown> = {}) {
  wa.status = status
  await WhatsappSession.findOneAndUpdate(
    { sessionName: env.WHATSAPP_SESSION },
    { $set: { status, ...extra } },
    { upsert: true },
  )
}

export async function startWhatsapp(): Promise<{ status: string; message: string }> {
  if (!whatsappEnabled) {
    await persistStatus('disabled')
    return { status: 'disabled', message: 'WhatsApp is disabled. Enable ENABLE_WHATSAPP after installing whatsapp-web.js.' }
  }
  if (wa.client) return { status: wa.status, message: 'WhatsApp session already initialized.' }

  try {
    const spec = 'whatsapp-web.js'
    const mod: any = await import(spec)
    const { Client, LocalAuth } = mod.default ?? mod
    const QRCode = (await import('qrcode')).default as any
    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: 'storage/whatsapp-session', clientId: env.WHATSAPP_SESSION }),
      puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
    })
    wa.client = client
    initializedModule = true
    await persistStatus('initializing')

    client.on('qr', async (qr: string) => {
      try {
        const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 })
        await persistStatus('qr', { qrDataUrl: dataUrl, lastQrAt: new Date() })
      } catch (err) {
        logger.warn({ err }, 'QR generation failed')
      }
    })
    client.on('ready', async () => {
      const info = client.info
      await persistStatus('ready', {
        lastConnectedAt: new Date(),
        qrDataUrl: null,
        info: { pushname: info?.pushname, number: info?.wid?.user },
      })
      logger.info('WhatsApp session ready')
    })
    client.on('auth_failure', async (msg: string) => persistStatus('auth_failure', { lastError: msg }))
    client.on('disconnected', async (reason: string) => {
      await persistStatus('disconnected', { lastError: String(reason) })
      wa.client = null
    })

    wa.initPromise = client.initialize().catch(async (err: Error) => {
      logger.error({ err }, 'WhatsApp initialization failed')
      await persistStatus('failed', { lastError: err.message })
      wa.client = null
    })
    return { status: 'initializing', message: 'Connecting to WhatsApp. A QR code will appear shortly.' }
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
  if (wa.client) {
    try {
      await wa.client.destroy()
    } catch (err) {
      logger.warn({ err }, 'WhatsApp destroy failed')
    }
    wa.client = null
  }
  await persistStatus('disconnected')
}

export async function whatsappStatus() {
  const session = await WhatsappSession.findOne({ sessionName: env.WHATSAPP_SESSION })
  return {
    status: wa.status === 'ready' ? 'ready' : session?.status ?? 'disabled',
    qrDataUrl: session?.qrDataUrl,
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
export let lastWorkerRun: Date | null = null
export let workerProcessed = 0

export async function processMessageQueue(limit = 20): Promise<{ processed: number; sent: number; failed: number }> {
  if (workerRunning) return { processed: 0, sent: 0, failed: 0 }
  workerRunning = true
  let sent = 0
  let failed = 0
  try {
    await refreshCommsSettings()
    const now = new Date()
    for (let i = 0; i < limit; i++) {
      const msg = await MessageQueue.findOneAndUpdate(
        { status: { $in: ['queued', 'failed'] }, nextAttemptAt: { $lte: now } },
        { $set: { status: 'sending' } },
        { new: true, sort: { nextAttemptAt: 1 } },
      )
      if (!msg) break

      try {
        let result: { ok: boolean; error?: string } = { ok: false, error: 'Unknown channel' }
        if (msg.channel === 'whatsapp') {
          result = await sendWhatsapp(msg.to, msg.body)
        } else if (msg.channel === 'email') {
          const mail = await sendMail({ to: msg.to, subject: msg.subject ?? 'ConductNexus notification', html: msg.body.replace(/\n/g, '<br/>') })
          result = { ok: mail.delivered, error: mail.delivered ? undefined : 'Email was stored but not delivered (SMTP not configured)' }
        } else if (msg.channel === 'sms') {
          result = { ok: false, error: 'SMS provider is not configured' }
        }

        if (result.ok) {
          msg.status = 'sent'
          msg.sentAt = new Date()
          msg.provider = msg.channel
          await msg.save()
          sent++
          if (msg.incidentId) await Incident.updateOne({ _id: msg.incidentId }, { $set: { parentNotificationStatus: 'sent' } })
          if (msg.letterId) await Letter.updateOne({ _id: msg.letterId }, { $set: { deliveryStatus: 'sent' } })
        } else {
          msg.attempts += 1
          msg.lastError = result.error
          if (msg.attempts >= msg.maxAttempts || msg.channel === 'sms') {
            msg.status = 'dead_letter'
          } else {
            msg.status = 'failed'
            msg.nextAttemptAt = new Date(Date.now() + msg.attempts * 5 * 60_000)
          }
          await msg.save()
          failed++
          if (msg.incidentId) await Incident.updateOne({ _id: msg.incidentId }, { $set: { parentNotificationStatus: 'failed' } })
        }
      } catch (err) {
        msg.status = 'failed'
        msg.lastError = err instanceof Error ? err.message : 'Delivery error'
        msg.attempts += 1
        await msg.save().catch(() => undefined)
        failed++
      }
    }
  } finally {
    workerRunning = false
    lastWorkerRun = new Date()
    workerProcessed += sent + failed
  }
  return { processed: sent + failed, sent, failed }
}

export async function retryMessage(id: string) {
  const msg = await MessageQueue.findById(id)
  if (!msg) throw ApiError.notFound('Message not found')
  if (!['failed', 'dead_letter', 'manual_review'].includes(msg.status)) {
    throw ApiError.badRequest('Only failed or dead-letter messages can be retried')
  }
  msg.status = 'queued'
  msg.attempts = 0
  msg.nextAttemptAt = new Date()
  msg.lastError = undefined
  await msg.save()
  return msg
}

export async function queueStatusCounts() {
  const rows = await MessageQueue.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  return Object.fromEntries(rows.map((r) => [r._id as string, r.count as number]))
}
