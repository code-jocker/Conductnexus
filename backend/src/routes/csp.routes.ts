import { Router } from 'express'
import { logger } from '../shared/logger.js'

export const cspRouter = Router()

cspRouter.post('/', (_req, res) => {
  const report = _req.body
  logger.warn(
    { cspReport: report },
    'Content-Security-Policy violation reported (report-only mode)',
  )
  res.status(204).end()
})
