import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { seedRbac } from '../services/seed.service.js'

async function main() {
  await connectDatabase()
  await seedRbac()
  await disconnectDatabase()
  console.log('RBAC permissions and role grants are up to date')
}

main().catch(async (err) => {
  console.error(err)
  await disconnectDatabase().catch(() => undefined)
  process.exit(1)
})
