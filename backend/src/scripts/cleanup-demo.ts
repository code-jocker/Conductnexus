import fs from 'node:fs'
import path from 'node:path'
import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { logger } from '../shared/logger.js'

const DEMO_STUDENT_ID = /^STD-\d{4}-00(0[1-9]|1[0-9]|2[0-4])$/
const DEMO_PHONES = Array.from({ length: 8 }, (_, i) => `+25078100000${i}`)
const CONFIRM = process.argv.includes('--confirm')

async function main() {
  await connectDatabase()
  const db = mongoose.connection.db as unknown as {
    listCollections: () => { toArray: () => Promise<{ name: string }[]> }
    collection: (name: string) => any
  }

  const students = await db.collection('students').find({ studentId: DEMO_STUDENT_ID }).toArray()
  if (!students.length) {
    console.log('No demo-seeded students found. Nothing to do.')
    return
  }
  const studentIds = students.map((s: any) => s._id)
  const parents = await db.collection('parents').find({ phone: { $in: DEMO_PHONES } }).toArray()
  const parentIds = parents.map((p: any) => p._id)

  const related: { collection: string; docs: any[] }[] = []
  for (const { name } of await db.listCollections().toArray()) {
    if (name === 'students' || name === 'studentguardians') continue
    const docs = await db.collection(name).find({
      $or: [{ studentId: { $in: studentIds } }, { studentIds: { $in: studentIds } }],
    }).toArray()
    if (docs.length) related.push({ collection: name, docs })
  }
  const links = await db.collection('studentguardians').find({
    $or: [{ studentId: { $in: studentIds } }, { parentId: { $in: parentIds } }],
  }).toArray()

  console.log('\nDemo cleanup plan')
  console.log(`  students:          ${students.length}`)
  console.log(`  demo guardians:    ${parents.length}`)
  console.log(`  guardian links:    ${links.length}`)
  for (const entry of related) console.log(`  ${entry.collection.padEnd(19)} ${entry.docs.length}`)
  console.log(`\nStudents kept:`)
  const kept = await db.collection('students').find({ _id: { $nin: studentIds } }).project({ studentId: 1, fullName: 1 }).toArray()
  for (const s of kept) console.log(`  ${s.studentId}  ${s.fullName}`)

  if (!CONFIRM) {
    console.log('\nDry run only. Re-run with --confirm to delete the demo records.')
    return
  }

  const dir = path.resolve(process.cwd(), 'storage/backups')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `demo-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), students, parents, links, related }, null, 2))
  console.log(`\nExported affected records to ${file}`)

  for (const entry of related) {
    await db.collection(entry.collection).deleteMany({ _id: { $in: entry.docs.map((d: any) => d._id) } })
  }
  await db.collection('studentguardians').deleteMany({ _id: { $in: links.map((l: any) => l._id) } })
  const orphanParents: any[] = []
  for (const parent of parents) {
    if ((await db.collection('studentguardians').countDocuments({ parentId: parent._id })) === 0) orphanParents.push(parent)
  }
  if (orphanParents.length) {
    await db.collection('parents').deleteMany({ _id: { $in: orphanParents.map((p: any) => p._id) } })
  }
  await db.collection('students').deleteMany({ _id: { $in: studentIds } })

  await db.collection('auditlogs').insertOne({
    actorName: 'System (demo cleanup)',
    actorRoles: ['SYSTEM'],
    action: 'demo.students_removed',
    resourceType: 'Student',
    after: {
      students: students.map((s: any) => ({ studentId: s.studentId, fullName: s.fullName })),
      related: Object.fromEntries(related.map((r) => [r.collection, r.docs.length])),
      exportFile: file,
    },
    createdAt: new Date(),
  })

  const remaining = await db.collection('students').countDocuments()
  console.log(`\nDeleted ${students.length} demo students and ${orphanParents.length} orphaned demo guardians.`)
  console.log(`Students remaining: ${remaining}`)
  logger.info({ deleted: students.length, exportFile: file }, 'Demo student cleanup complete')
}

main()
  .catch((err) => {
    logger.fatal({ err }, 'Demo cleanup failed')
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => undefined)
  })
