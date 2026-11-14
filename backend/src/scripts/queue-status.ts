import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { Incident } from '../models/discipline.js'
import { MessageQueue, WhatsappSession } from '../models/communications.js'
import { GuardianLink } from '../models/school.js'

type ParentLike = {
  name: string
  phone: string
  email?: string
  whatsappConsent: boolean
  preferredChannel: string
}

async function main() {
  await connectDatabase()
  const sessions = await WhatsappSession.find().select('sessionName status lastConnectedAt lastError').lean()
  console.log('WhatsApp sessions:')
  for (const s of sessions) {
    console.log(`  ${s.sessionName}: ${s.status} lastConnected=${s.lastConnectedAt?.toISOString() ?? '-'} error=${s.lastError ?? '-'}`)
  }

  const rows = await MessageQueue.find()
    .sort({ createdAt: -1 })
    .limit(20)
    .populate('studentId', 'fullName')
    .lean()
  console.log(`\nLatest ${rows.length} queue row(s):`)
  for (const r of rows) {
    const student = r.studentId as unknown as { fullName?: string } | null
    console.log(
      `  ${String(r.channel).padEnd(8)} ${String(r.status).padEnd(13)} ${r.to}  ${student?.fullName ?? ''}  ${r.templateKey ?? ''}  attempts=${r.attempts}/${r.maxAttempts}  ${r.lastError ?? ''}`,
    )
  }

  const incidents = await Incident.find({ status: 'approved', 'offenceSnapshot.notifyParent': true })
    .sort({ occurredAt: -1 })
    .limit(10)
    .select('incidentNumber studentId studentSnapshot parentNotificationStatus occurredAt')
    .lean()
  console.log(`\nApproved incidents that should notify parents (${incidents.length}):`)
  for (const i of incidents) {
    console.log(`  ${i.incidentNumber}  ${i.studentSnapshot?.fullName}  ${i.studentSnapshot?.studentId}  notify=${i.parentNotificationStatus}`)
    const guardians = await GuardianLink.find({ studentId: i.studentId }).populate<{ parentId: ParentLike }>('parentId').lean()
    for (const g of guardians) {
      const p = g.parentId
      if (!p) continue
      console.log(
        `      guardian ${p.name}  ${p.phone}  whatsappConsent=${p.whatsappConsent}  email=${p.email ?? '-'}  preferred=${p.preferredChannel}`,
      )
    }
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => disconnectDatabase())
