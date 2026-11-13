import { connectDatabase, disconnectDatabase } from './config/db.js'
import { logger } from './shared/logger.js'
import { env } from './config/env.js'
import { processMessageQueue, refreshCommsSettings } from './services/communication.service.js'

const INTERVAL_MS = 60_000

async function main() {
  await connectDatabase()
  await refreshCommsSettings()
  logger.info({ env: env.NODE_ENV }, 'Message queue worker started')

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const result = await processMessageQueue()
      if (result.processed > 0) logger.info(result, 'Queue batch processed')
    } catch (err) {
      logger.error({ err }, 'Queue worker tick failed')
    } finally {
      running = false
    }
  }

  await tick()
  const timer = setInterval(() => void tick(), INTERVAL_MS)

  const shutdown = async () => {
    clearInterval(timer)
    await disconnectDatabase().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start')
  process.exit(1)
})
