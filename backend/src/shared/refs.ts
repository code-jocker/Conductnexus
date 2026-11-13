import { Schema, model, type Model } from 'mongoose'

interface CounterDoc {
  key: string
  seq: number
}

const counterSchema = new Schema<CounterDoc>(
  { key: { type: String, required: true, unique: true }, seq: { type: Number, default: 0 } },
  { versionKey: false },
)

const Counter = model<CounterDoc>('Counter', counterSchema)

export async function nextRef(prefix: string, width = 5): Promise<string> {
  const year = new Date().getFullYear()
  const key = `${prefix}-${year}`
  const doc = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  return `${key}-${String(doc.seq).padStart(width, '0')}`
}

export { Counter }
export type { CounterDoc, Model }
