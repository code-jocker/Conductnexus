import { env, smsConfigured } from '../config/env.js'
import { logger } from '../shared/logger.js'

const PROVIDER = 'africastalking'
const LIVE_URL = 'https://api.africastalking.com/version1/messaging'
const SANDBOX_URL = 'https://api.sandbox.africastalking.com/version1/messaging'
const SUCCESS_CODES = new Set([100, 101, 102])
const MAX_LENGTH = 918

export type SmsResult = { ok: boolean; error?: string; messageId?: string; provider: string }

export function normalizePhone(raw: string): string | null {
  const cleaned = String(raw ?? '').replace(/[\s()\-.]/g, '')
  let digits = cleaned.replace(/[^\d+]/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`
  if (digits.startsWith('+')) return /^\+\d{9,15}$/.test(digits) ? digits : null
  if (/^07\d{8}$/.test(digits)) digits = `250${digits.slice(1)}`
  return /^\d{9,15}$/.test(digits) ? `+${digits}` : null
}

function maskPhone(phone: string): string {
  return phone.length > 4 ? `${phone.slice(0, phone.length - 4)}****` : '****'
}

function endpoint(): string {
  if (env.AT_SMS_URL) return env.AT_SMS_URL
  return env.AT_USERNAME === 'sandbox' ? SANDBOX_URL : LIVE_URL
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  if (!smsConfigured) {
    return {
      ok: false,
      provider: PROVIDER,
      error: "SMS is enabled but Africa's Talking credentials are missing (AT_USERNAME, AT_API_KEY)",
    }
  }
  const number = normalizePhone(to)
  if (!number) return { ok: false, provider: PROVIDER, error: `Invalid phone number "${maskPhone(String(to ?? ''))}"` }
  const message = body.trim().slice(0, MAX_LENGTH)
  if (!message) return { ok: false, provider: PROVIDER, error: 'SMS body is empty' }

  const form = new URLSearchParams({ username: env.AT_USERNAME, to: number, message })
  if (env.AT_SENDER_ID) form.set('from', env.AT_SENDER_ID)

  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        apiKey: env.AT_API_KEY,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    })
    const text = await res.text()
    let payload: {
      SMSMessageData?: {
        Message?: string
        Recipients?: Array<{ statusCode?: number; status?: string; messageId?: string }>
      }
    } = {}
    try {
      payload = JSON.parse(text)
    } catch {
      // Africa's Talking returns HTML for some gateway/auth failures.
    }
    const data = payload.SMSMessageData
    const recipient = data?.Recipients?.[0]
    if (res.ok && recipient && SUCCESS_CODES.has(Number(recipient.statusCode))) {
      logger.info({ to: maskPhone(number), messageId: recipient.messageId }, 'SMS sent via Africa\'s Talking')
      return { ok: true, provider: PROVIDER, messageId: recipient.messageId }
    }
    const error = recipient?.status ?? data?.Message ?? `Africa's Talking returned HTTP ${res.status}`
    logger.warn({ status: res.status, to: maskPhone(number), error }, 'SMS delivery failed')
    return { ok: false, provider: PROVIDER, error: String(error) }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'SMS request failed'
    logger.error({ err, to: maskPhone(number) }, 'SMS request error')
    return { ok: false, provider: PROVIDER, error }
  }
}
