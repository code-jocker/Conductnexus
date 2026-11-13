import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { logger } from '../shared/logger.js'
import { seedAdminFromEnv, seedRbac, seedSchoolDefaults } from '../services/seed.service.js'

async function main() {
  await connectDatabase()
  await seedRbac()
  await seedSchoolDefaults()
  await seedAdminFromEnv()
  logger.info('Base seed complete')
  await disconnectDatabase()
}

main().catch(async (err) => {
  logger.fatal({ err }, 'Seed failed')
  await disconnectDatabase().catch(() => undefined)
  process.exit(1)
})
