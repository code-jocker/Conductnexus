import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { MessageQueue } from '../models/communications.js'

const CONFIRM = process.argv.includes('--confirm')
const filter = {
  channel: { $in: ['sms', 'email'] },
  status: { $in: ['failed', 'dead_letter', 'manual_review'] },
}

async function main() {
  await connectDatabase()
  const rows = await MessageQueue.find(filter).select('channel status to lastError createdAt').lean()
  console.log(`Found ${rows.length} failed non-WhatsApp queue message(s):`)
  for (const row of rows) {
    console.log(`  ${row.channel.padEnd(5)} ${String(row.status).padEnd(13)} ${row.to}  ${row.createdAt?.toISOString() ?? ''}  ${row.lastError ?? ''}`)
  }
  if (!CONFIRM) {
    console.log('\nDry run only. Re-run with --confirm to delete these messages.')
    return
  }
  const result = await MessageQueue.deleteMany(filter)
  console.log(`Deleted ${result.deletedCount} message(s). Parent messaging is now WhatsApp only.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => disconnectDatabase())
