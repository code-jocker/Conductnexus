import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { emailConfigured, mailjetConfigured } from '../config/env.js'
import { sendMail, twoFactorEmail } from '../services/email.service.js'

async function main() {
  const to = process.argv[2]?.trim()
  if (!to) {
    console.error('Usage: npm run mail:test -- you@example.com')
    process.exitCode = 1
    return
  }
  if (!emailConfigured) {
    console.error('No email transport is configured. Set MAILJET_API_KEY + MAILJET_API_SECRET,')
    console.error('GMAIL_* OAuth2 values, or SMTP_HOST + SMTP_USER + SMTP_PASS.')
    process.exitCode = 1
    return
  }

  await connectDatabase()
  const template = twoFactorEmail('Test recipient', '123456')
  const result = await sendMail({ to, subject: `[test] ${template.subject}`, html: template.html })
  console.log(`Transport: ${mailjetConfigured ? 'mailjet' : 'smtp'}`)
  console.log(`Delivered: ${result.delivered}  stored: ${result.stored}  id: ${result.id ?? '-'}`)
  if (!result.delivered) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => disconnectDatabase())
