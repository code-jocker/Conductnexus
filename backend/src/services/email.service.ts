import nodemailer, { type Transporter } from 'nodemailer'
import {
  env,
  gmailOAuthConfigured,
  mailFrom,
  mailjetConfigured,
  parseMailFrom,
} from '../config/env.js'
import { MailMessage } from '../models/core.js'
import { logger } from '../shared/logger.js'
import { escapeHtml } from '../shared/utils.js'

const smtpCredentialsConfigured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)

let transporter: Transporter | null = null
function getTransporter(): Transporter | null {
  if (!gmailOAuthConfigured && !smtpCredentialsConfigured) return null
  if (!transporter) {
    transporter = gmailOAuthConfigured
      ? nodemailer.createTransport({
          service: 'gmail',
          auth: {
            type: 'OAuth2',
            user: env.GMAIL_USER,
            clientId: env.GMAIL_CLIENT_ID,
            clientSecret: env.GMAIL_CLIENT_SECRET,
            refreshToken: env.GMAIL_REFRESH_TOKEN,
          },
        })
      : nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
        })
  }
  return transporter
}

export type MailResult = { delivered: boolean; stored: boolean; id?: string }

type MailjetMessage = {
  Status?: string
  Errors?: unknown
  To?: Array<{ MessageID?: string }>
}

const htmlToText = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

async function sendViaMailjet(input: { to: string; subject: string; html: string; text?: string }): Promise<void> {
  const from = parseMailFrom(mailFrom)
  const auth = Buffer.from(`${env.MAILJET_API_KEY}:${env.MAILJET_API_SECRET}`).toString('base64')
  const response = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: from.email, Name: from.name },
          To: [{ Email: input.to }],
          Subject: input.subject,
          HTMLPart: input.html,
          TextPart: input.text ?? htmlToText(input.html),
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const raw = await response.text()
  if (!response.ok) {
    throw new Error(`Mailjet rejected the request (${response.status}): ${raw.slice(0, 300)}`)
  }
  let message: MailjetMessage | undefined
  try {
    message = (JSON.parse(raw) as { Messages?: MailjetMessage[] }).Messages?.[0]
  } catch {
    // 2xx with a non-JSON body is still an accepted delivery.
    return
  }
  if (message?.Status === 'error') {
    throw new Error(`Mailjet rejected the message: ${JSON.stringify(message.Errors ?? {}).slice(0, 300)}`)
  }
}

export async function sendMail(input: { to: string; subject: string; html: string; text?: string }): Promise<MailResult> {
  const transport = mailjetConfigured ? 'mailjet' : getTransporter() ? 'smtp' : 'outbox'
  const record = await MailMessage.create({
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    status: 'queued',
    provider: transport === 'outbox' ? 'outbox' : transport,
  })

  if (transport === 'outbox') {
    record.status = 'stored'
    await record.save()
    logger.info({ to: input.to, subject: input.subject }, 'Email transport not configured — email stored in outbox')
    if (env.NODE_ENV !== 'production') {
      logger.debug({ html: input.html }, 'Outbox email body')
    }
    return { delivered: false, stored: true, id: String(record._id) }
  }

  try {
    if (transport === 'mailjet') {
      await sendViaMailjet(input)
    } else {
      await getTransporter()!.sendMail({
        from: mailFrom,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      })
    }
    record.status = 'sent'
    await record.save()
    return { delivered: true, stored: false, id: String(record._id) }
  } catch (err) {
    record.status = 'failed'
    record.error = err instanceof Error ? err.message : 'Unknown email delivery error'
    await record.save()
    logger.error({ err }, 'Email delivery failed')
    return { delivered: false, stored: true, id: String(record._id) }
  }
}

const shell = (title: string, body: string) => `
<!doctype html><html><body style="margin:0;background:#f5f7fb;font-family:Segoe UI,Arial,sans-serif;color:#172033">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
        <tr><td style="background:#0b1b33;padding:20px 28px;color:#fff">
          <div style="font-size:20px;font-weight:700;letter-spacing:.3px">Conduct<span style="color:#06b6d4">Nexus</span></div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px">Building Better Behaviour Through Connected School Discipline</div>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="font-size:18px;margin:0 0 14px">${escapeHtml(title)}</h1>
          <div style="font-size:14px;line-height:1.65;color:#334155">${body}</div>
        </td></tr>
        <tr><td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b">
          This is an automated message from ConductNexus. If you did not request it, contact your school administrator.
          <br/>Powered by Shyaka clever prince a.k.a Code jocker
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

export function verificationEmail(name: string, link: string) {
  return {
    subject: 'Verify your ConductNexus email address',
    html: shell(
      `Hello ${name},`,
      `<p>Confirm your email address to activate all features of your ConductNexus account.</p>
       <p style="margin:22px 0"><a href="${link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">Verify email address</a></p>
       <p style="font-size:12px;color:#64748b">Or copy this link: <br/>${link}</p>
       <p style="font-size:12px;color:#64748b">This link expires in 24 hours.</p>`,
    ),
  }
}

export function resetEmail(name: string, code: string, link: string) {
  return {
    subject: 'Reset your ConductNexus password',
    html: shell(
      `Hello ${name},`,
      `<p>We received a request to reset your password. Use the verification code below or the secure link.</p>
       <div style="margin:18px 0;font-size:30px;letter-spacing:8px;font-weight:700;color:#0b1b33;background:#f1f5f9;border-radius:8px;padding:14px;text-align:center">${code}</div>
       <p style="margin:20px 0"><a href="${link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">Set a new password</a></p>
       <p style="font-size:12px;color:#64748b">The code and link expire in 20 minutes. If you did not request a reset, ignore this email.</p>`,
    ),
  }
}

export function inviteEmail(name: string, link: string, temporaryPassword?: string) {
  return {
    subject: 'Your ConductNexus account is ready',
    html: shell(
      `Hello ${name},`,
      `<p>An account has been created for you on ConductNexus, your school's conduct and discipline platform.</p>
       ${temporaryPassword ? `<p>Temporary password: <strong style="font-family:Consolas,monospace">${temporaryPassword}</strong></p>` : ''}
       <p>You can sign in with your email and password, or use Google Sign-In with this same email address.</p>
       <p style="margin:22px 0"><a href="${link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">Open ConductNexus</a></p>
        <p style="font-size:12px;color:#64748b">Please change your password after your first sign-in.</p>`,
    ),
  }
}

export function accessReceivedEmail(name: string, roleName: string) {
  return {
    subject: 'We received your ConductNexus access request',
    html: shell(
      `Hello ${name},`,
      `<p>Your request for <strong>${escapeHtml(roleName)}</strong> access to ConductNexus has been received.</p>
       <p>A school administrator will review it. Once approved, you will receive another email and a WhatsApp message with your sign-in details.</p>
       <p style="font-size:12px;color:#64748b">No further action is needed right now. If you already have an account, sign in or use the Forgot password option instead.</p>`,
    ),
  }
}

export function accessApprovedEmail(name: string, roleName: string, link: string, temporaryPassword?: string) {
  return {
    subject: 'Your ConductNexus access was approved',
    html: shell(
      `Hello ${name},`,
      `<p>Your ConductNexus access request was approved. You have been granted the <strong>${escapeHtml(roleName)}</strong> role.</p>
       ${temporaryPassword ? `<p>Temporary password: <strong style="font-family:Consolas,monospace">${temporaryPassword}</strong></p>` : '<p>Use your existing password to sign in.</p>'}
       <p style="margin:22px 0"><a href="${link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">Sign in to ConductNexus</a></p>
       <p style="font-size:12px;color:#64748b">Please change your password after signing in for the first time.</p>`,
    ),
  }
}

export function accessRejectedEmail(name: string, note?: string) {
  return {
    subject: 'Update on your ConductNexus access request',
    html: shell(
      `Hello ${name},`,
      `<p>Your request for ConductNexus access was reviewed and could not be approved at this time.</p>
       ${note ? `<p>Note from the school: ${escapeHtml(note)}</p>` : ''}
       <p>If you believe this is a mistake, contact the school office directly so they can confirm your details.</p>`,
    ),
  }
}

export function twoFactorEmail(name: string, code: string) {
  return {
    subject: 'Your ConductNexus verification code',
    html: shell(
      `Hello ${name},`,
      `<p>Use the verification code below to finish signing in to your ConductNexus account.</p>
       <div style="margin:18px 0;font-size:32px;letter-spacing:10px;font-weight:700;color:#0b1b33;background:#f1f5f9;border-radius:8px;padding:16px;text-align:center">${code}</div>
       <p style="font-size:12px;color:#64748b">This code expires in 10 minutes. If you did not try to sign in, ignore this email and contact your school administrator.</p>`,
    ),
  }
}
