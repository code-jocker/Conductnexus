import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { emailConfigured, mailjetConfigured } from '../config/env.js'
import { resetEmail, sendMail, twoFactorEmail, verificationEmail } from '../services/email.service.js'

async function main() {
  const to = process.argv[2]?.trim()
  const template = (process.argv[3] ?? '2fa').toLowerCase()
  if (!to) {
    console.error('Usage: npm run mail:test -- you@example.com [2fa|verification|reset]')
    process.exitCode = 1
    return
  }
  if (!emailConfigured) {
    console.error('No email transport is configured. Set MAILJET_API_KEY + MAILJET_API_SECRET,')
    console.error('GMAIL_* OAuth2 values, or SMTP_HOST + SMTP_USER + SMTP_PASS.')
    process.exitCode = 1
    return
  }

  const site = process.env.APP_URL?.trim() || 'https://e-visitors-d4830.web.app'
  const content =
    template === 'verification'
      ? verificationEmail('Test recipient', `${site}/verify-email?token=test-token`)
      : template === 'reset'
        ? resetEmail('Test recipient', '123456', `${site}/reset-password?token=test-token`)
        : twoFactorEmail('Test recipient', '123456')

  await connectDatabase()
  const result = await sendMail({ to, subject: `[test] ${content.subject}`, html: content.html })
  console.log(`Transport: ${mailjetConfigured ? 'mailjet' : 'smtp'}`)
  console.log(`Template: ${template}`)
  console.log(`Delivered: ${result.delivered}  stored: ${result.stored}  id: ${result.id ?? '-'}`)
  if (!result.delivered) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => disconnectDatabase())
