import { Types } from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { GuardianLink, Parent, Student } from '../models/school.js'
import { DisciplineLedger } from '../models/discipline.js'
import { PromotionBatch } from '../models/promotion.js'
import { AuditLog } from '../models/governance.js'
import { User, UserRole } from '../models/core.js'

async function main() {
  await connectDatabase()
  const students = await Student.find({ firstName: 'Smoke', lastName: /^Learner/ }).select('_id').lean()
  const ids = students.map((s) => s._id)
  for (const id of ids) {
    const links = await GuardianLink.find({ studentId: id }).lean()
    for (const link of links) {
      await GuardianLink.deleteOne({ _id: link._id })
      const remaining = await GuardianLink.countDocuments({ parentId: link.parentId })
      if (remaining === 0) await Parent.deleteOne({ _id: link.parentId })
    }
    await DisciplineLedger.collection.deleteMany({ studentId: new Types.ObjectId(id) })
    await AuditLog.deleteMany({ resourceId: String(id) })
  }
  await Student.deleteMany({ _id: { $in: ids } })

  const batches = await PromotionBatch.find({ title: /^Smoke batch/ }).select('_id').lean()
  for (const batch of batches) await AuditLog.deleteMany({ resourceId: String(batch._id) })
  await PromotionBatch.deleteMany({ _id: { $in: batches.map((b) => b._id) } })

  const heads = await User.find({ email: /^smoke\.head\./ }).select('_id').lean()
  const headIds = heads.map((u) => u._id)
  await UserRole.deleteMany({ userId: { $in: headIds } })
  await User.deleteMany({ _id: { $in: headIds } })

  console.log(`Removed ${ids.length} smoke student(s), ${batches.length} batch(es), ${headIds.length} temp user(s)`)
  await disconnectDatabase()
}

main().catch(async (err) => {
  console.error(err)
  await disconnectDatabase().catch(() => undefined)
  process.exit(1)
})
