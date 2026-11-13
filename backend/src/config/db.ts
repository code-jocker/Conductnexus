import mongoose from 'mongoose'
import { env } from './env.js'
import { logger } from '../shared/logger.js'

export async function connectDatabase(uri = env.MONGODB_URI): Promise<void> {
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, maxPoolSize: 20 })
  logger.info({ uri: uri.replace(/\/\/[^@]*@/, '//***@') }, 'MongoDB connected')
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect()
}

export function databaseState(): string {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] ?? 'unknown'
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await mongoose.connection.db?.admin().ping()
    return true
  } catch {
    return false
  }
}
