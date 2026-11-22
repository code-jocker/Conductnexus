import crypto from 'node:crypto'
import express, { type Request, type Response } from 'express'
import compression from 'compression'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { pinoHttp } from 'pino-http'
import swaggerUi from 'swagger-ui-express'
import { env, isProd } from './config/env.js'
import { logger } from './shared/logger.js'
import { apiRouter } from './routes/index.js'
import { openApiDocument } from './docs/openapi.js'
import { cspRouter } from './routes/csp.routes.js'
import { globalLimiter, errorHandler, notFoundHandler } from './middleware/error.js'
import { databaseState } from './config/db.js'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  )
  // Content-Security-Policy-Report-Only: collect client-side violations before
  // enforcing. Reports POST to /api/v1/csp-report. Enforcement (switch to the
  // Content-Security-Policy header) happens once reports show no surprises.
  app.use((_req, res, next) => {
    const policy = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "report-uri /api/v1/csp-report",
    ].join('; ')
    res.setHeader('Content-Security-Policy-Report-Only', policy)
    next()
  })
  // JSON payloads (permissions, dashboards) are mostly text; gzip cuts them
  // by ~80% on the slow mobile links this app is deployed onto.
  app.use(compression())

  const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return callback(null, true)
        return callback(new Error('Origin is not allowed'))
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'Idempotent-Replay'],
    }),
  )

  app.use(cookieParser())
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: true, limit: '1mb' }))

  app.use((req, res, next) => {
    const id = req.header('x-request-id') || crypto.randomUUID()
    req.requestId = id
    res.setHeader('X-Request-Id', id)
    next()
  })

  app.use(
    pinoHttp({
      logger,
      quietReqLogger: true,
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/api/v1/health',
      },
      genReqId: (req) => (req as Request).requestId ?? crypto.randomUUID(),
    }),
  )

  const health = async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
        service: 'ConductNexus API',
        environment: env.NODE_ENV,
        database: databaseState(),
        uptimeSeconds: Math.round(process.uptime()),
        time: new Date().toISOString(),
      },
    })
  }
  app.get('/health', health)
  app.get('/api/v1/health', health)

  app.get('/api/docs.json', (_req, res) => {
    res.json(openApiDocument)
  })
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument as never, { customSiteTitle: 'ConductNexus API' }))

  // CSP reports are sent by browsers without auth tokens, so this route sits
  // directly on the app (before apiRouter) and requires no authentication.
  app.use('/api/v1/csp-report', cspRouter)

  app.use('/api/v1', globalLimiter, apiRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  if (isProd) {
    app.set('etag', 'strong')
  }

  return app
}
