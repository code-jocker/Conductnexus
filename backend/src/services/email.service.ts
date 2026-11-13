import nodemailer, { type Transporter } from 'nodemailer'
import { env, smtpConfigured } from '../config/env.js'
import { MailMessage } from '../models/core.js'
import { logger } from '../shared/logger.js'
import { escapeHtml } from '../shared/utils.js'

let transporter: Transporter | null = null
function getTransporter(): Transporter | null {
  if (!smtpConfigured) return null
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    })
  }
  return transporter
}

export type MailResult = { delivered: boolean; stored: boolean; id?: string }

export async function sendMail(input: { to: string; subject: string; html: string; text?: string }): Promise<MailResult> {
  const record = await MailMessage.create({
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    status: 'queued',
    provider: smtpConfigured ? 'smtp' : 'outbox',
  })

  const tx = getTransporter()
  if (!tx) {
    record.status = 'stored'
    await record.save()
    logger.info({ to: input.to, subject: input.subject }, 'SMTP not configured — email stored in dev outbox')
    if (env.NODE_ENV !== 'production') {
      logger.debug({ html: input.html }, 'Outbox email body')
    }
    return { delivered: false, stored: true, id: String(record._id) }
  }

  try {
    await tx.sendMail({
      from: env.MAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    })
    record.status = 'sent'
    await record.save()
    return { delivered: true, stored: false, id: String(record._id) }
  } catch (err) {
    record.status = 'failed'
    record.error = err instanceof Error ? err.message : 'Unknown SMTP error'
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
