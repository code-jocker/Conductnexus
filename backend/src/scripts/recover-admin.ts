import crypto from 'node:crypto'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { env } from '../config/env.js'
import { User, Role, UserRole } from '../models/core.js'
import { hashPassword, passwordSchema } from '../services/auth.service.js'
import { logger } from '../shared/logger.js'

async function main() {
  await connectDatabase()
  const email = (process.argv[2] || env.ADMIN_EMAIL || '').toLowerCase()
  if (!email) throw new Error('Pass an admin email: npm run recover-admin -- admin@school.rw')

  let user = await User.findOne({ email }).select('+passwordHash')
  if (!user) {
    throw new Error(`No user found with email ${email}`)
  }

  const supplied = process.argv[3] || env.ADMIN_PASSWORD
  const password = supplied && passwordSchema(supplied) ? supplied : `Cn-${crypto.randomBytes(4).toString('hex')}9!`
  user.passwordHash = await hashPassword(password)
  user.status = 'active'
  user.emailVerified = true
  user.failedLoginCount = 0
  user.lockUntil = undefined
  user.mustChangePassword = true
  await user.save()

  const adminRole = await Role.findOne({ key: 'ADMIN' })
  if (adminRole) {
    await UserRole.updateOne(
      { userId: user._id, roleId: adminRole._id },
      { $setOnInsert: { userId: user._id, roleId: adminRole._id, assignedAt: new Date() } },
      { upsert: true },
    )
  }

  logger.info({ email, temporaryPassword: password }, 'Admin recovered. Sign in and change this password immediately.')
  console.log(`\nTemporary password for ${email}: ${password}\n`)
  await disconnectDatabase()
}

main().catch(async (err) => {
  logger.fatal({ err }, 'Admin recovery failed')
  await disconnectDatabase().catch(() => undefined)
  process.exit(1)
})
