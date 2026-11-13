import fs from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import { pingDatabase } from '../config/db.js'
import { env, firebaseConfigured, smtpConfigured, whatsappEnabled } from '../config/env.js'
import { getSettings } from '../models/core.js'
import { Approval, DisciplineLedger, Incident } from '../models/discipline.js'
import { BackupRecord, ErrorLog } from '../models/governance.js'
import { MessageQueue, WhatsappSession } from '../models/communications.js'
import { lastWorkerRun, queueStatusCounts, whatsappStatus, workerProcessed } from './communication.service.js'

function dirSize(dir: string): Promise<number> {
  return new Promise((resolve) => {
    let total = 0
    fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
      if (err) return resolve(0)
      let pending = entries.length
      if (!pending) return resolve(0)
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          dirSize(full).then((size) => {
            total += size
            if (--pending === 0) resolve(total)
          })
        } else {
          fs.stat(full, (statErr, stat) => {
            if (!statErr) total += stat.size
            if (--pending === 0) resolve(total)
          })
        }
      }
    })
  })
}

export async function systemSnapshot() {
  const [dbOk, settings, queueCounts, wa, backups, errors] = await Promise.all([
    pingDatabase(),
    getSettings(),
    queueStatusCounts(),
    whatsappStatus(),
    BackupRecord.find().sort({ createdAt: -1 }).limit(5).lean(),
    ErrorLog.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86_400_000) } }),
  ])
  const [pendingApprovals, openIncidents, deadLetters] = await Promise.all([
    Approval.countDocuments({ status: 'pending' }),
    Incident.countDocuments({ status: { $in: ['submitted', 'under_review', 'escalated'] } }),
    MessageQueue.countDocuments({ status: 'dead_letter' }),
  ])

  const storage = await dirSize(path.resolve(process.cwd(), 'storage'))
  const backupsDir = await dirSize(path.resolve(process.cwd(), 'storage/backups'))
  const memory = process.memoryUsage()
  const dbStats = mongoose.connection.db ? await mongoose.connection.db.stats().catch(() => null) : null
  const lastBackup = backups[0]

  return {
    status: dbOk ? 'operational' : 'degraded',
    checkedAt: new Date(),
    application: {
      name: 'ConductNexus API',
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
      memoryMb: { used: Math.round(memory.rss / 1_048_576), heap: Math.round(memory.heapUsed / 1_048_576) },
    },
    database: {
      status: dbOk ? 'connected' : 'unavailable',
      name: dbStats?.db ?? null,
      collections: dbStats?.collections ?? 0,
      objects: dbStats?.objects ?? 0,
      dataSizeMb: dbStats ? Math.round((dbStats.dataSize / 1_048_576) * 10) / 10 : 0,
    },
    worker: {
      status: lastWorkerRun && Date.now() - lastWorkerRun.getTime() < 5 * 60_000 ? 'running' : 'idle',
      lastRun: lastWorkerRun,
      processed: workerProcessed,
    },
    queue: {
      counts: queueCounts,
      deadLetters,
      total: Object.values(queueCounts).reduce((s, n) => s + n, 0),
    },
    whatsapp: wa,
    backups: {
      lastRunAt: settings.backup.lastRunAt,
      lastStatus: settings.backup.lastStatus,
      retentionDays: settings.backup.retentionDays,
      rpoHours: settings.backup.rpoHours,
      rtoHours: settings.backup.rtoHours,
      recent: backups,
      storageBytes: backupsDir,
    },
    storage: { usedBytes: storage },
    integrations: {
      mongodb: dbOk,
      smtp: smtpConfigured,
      firebase: firebaseConfigured,
      whatsappEnabled,
      whatsappConnected: wa.status === 'ready',
    },
    errors: { last24h: errors },
    cases: { pendingApprovals, openIncidents },
    settings: {
      timezone: settings.academic.timezone,
      language: settings.academic.language,
      schoolName: settings.school.name,
    },
  }
}

export async function whatsappSessionStatus() {
  return whatsappStatus()
}

export async function recentErrors(limit = 50) {
  return ErrorLog.find().sort({ createdAt: -1 }).limit(limit).lean()
}

export async function pendingQueueFailures(limit = 50) {
  return MessageQueue.find({ status: { $in: ['failed', 'dead_letter', 'manual_review'] } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()
}

export async function whatsappSessionDoc() {
  return WhatsappSession.findOne({ sessionName: env.WHATSAPP_SESSION }).lean()
}

export async function ledgerHealth() {
  const [posted, recent] = await Promise.all([
    DisciplineLedger.countDocuments(),
    DisciplineLedger.find().sort({ createdAt: -1 }).limit(10).lean(),
  ])
  return { totalTransactions: posted, recent }
}
