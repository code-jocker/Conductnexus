import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { env } from '../config/env.js'
import { logger } from '../shared/logger.js'
import { getSettings } from '../models/core.js'
import { seedAdminFromEnv, seedRbac, seedSchoolDefaults } from '../services/seed.service.js'

async function main() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env before running setup')
  }
  await connectDatabase()
  await seedRbac()
  await seedSchoolDefaults({ schoolName: env.SCHOOL_NAME || undefined })
  await seedAdminFromEnv()
  const settings = await getSettings()
  if (!settings.setupCompleted) {
    settings.setupCompleted = true
    await settings.save()
  }
  logger.info({ school: settings.school.name, admin: env.ADMIN_EMAIL }, 'Initial setup complete — you can sign in now')
  await disconnectDatabase()
}

main().catch(async (err) => {
  logger.fatal({ err }, 'Setup failed')
  await disconnectDatabase().catch(() => undefined)
  process.exit(1)
})
