import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { seedNotificationTemplates } from '../services/seed.service.js'

async function main() {
  await connectDatabase()
  await seedNotificationTemplates()
  await disconnectDatabase()
  console.log('Notification templates synced')
}

main().catch(async (err) => {
  console.error(err)
  await disconnectDatabase().catch(() => undefined)
  process.exit(1)
})
