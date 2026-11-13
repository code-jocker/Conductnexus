import http from 'node:http'
import cron from 'node-cron'
import { Server as SocketServer } from 'socket.io'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { connectDatabase, disconnectDatabase } from './config/db.js'
import { logger } from './shared/logger.js'
import { verifyAccessToken } from './services/auth.service.js'
import { setSocketServer, feedRoom } from './services/notification.service.js'
import { refreshCommsSettings, processMessageQueue, startWhatsapp, stopWhatsapp } from './services/communication.service.js'
import { startBackupSchedule } from './services/backup.service.js'
import { ensureBackupDir } from './services/backup.service.js'

async function main() {
  await connectDatabase()
  await ensureBackupDir()
  await refreshCommsSettings()

  const app = createApp()
  const server = http.createServer(app)

  const io = new SocketServer(server, {
    path: '/socket.io',
    cors: {
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
    },
  })

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ||
      (typeof socket.handshake.query.token === 'string' ? socket.handshake.query.token : undefined)
    if (!token) return next(new Error('Authentication required'))
    try {
      const userId = verifyAccessToken(token)
      socket.data.userId = userId
      return next()
    } catch {
      return next(new Error('Authentication failed'))
    }
  })

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string
    socket.join(feedRoom(userId))
    socket.emit('connected', { userId, at: new Date().toISOString() })
  })

  setSocketServer(io)

  startBackupSchedule(cron).catch((err) => logger.error({ err }, 'Could not register backup schedule'))

  const workerInterval = setInterval(() => {
    processMessageQueue().catch((err) => logger.error({ err }, 'Message queue worker failed'))
  }, 60_000)

  if (env.ENABLE_WHATSAPP) {
    startWhatsapp()
      .then((r) => logger.info(r, 'WhatsApp worker start requested'))
      .catch((err) => logger.error({ err }, 'Failed to start WhatsApp session'))
  }

  server.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, docs: `http://localhost:${env.PORT}/api/docs` },
      'ConductNexus API listening',
    )
  })

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'Shutting down')
    clearInterval(workerInterval)
    setTimeout(() => process.exit(1), 15_000).unref()
    try {
      await stopWhatsapp().catch(() => undefined)
      await new Promise<void>((resolve) => io.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await disconnectDatabase()
      process.exit(0)
    } catch (err) {
      logger.error({ err }, 'Graceful shutdown failed')
      process.exit(1)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Unhandled promise rejection'))
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception')
    void shutdown('uncaughtException')
  })
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error')
  process.exit(1)
})
