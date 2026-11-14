import { connectDatabase, disconnectDatabase } from '../config/db.js'
import { Incident } from '../models/discipline.js'
import { MessageQueue } from '../models/communications.js'
import { GuardianLink, Parent, Student } from '../models/school.js'
import { queueParentMessage } from '../services/communication.service.js'

const CONFIRM = process.argv.includes('--confirm')
const ENABLE_CONSENT = process.argv.includes('--enable-whatsapp-consent')
const incidentArg = process.argv.find((a) => a.startsWith('--incident='))?.split('=')[1]

async function main() {
  await connectDatabase()
  const filter: Record<string, unknown> = { status: 'approved', 'offenceSnapshot.notifyParent': true }
  if (incidentArg) filter.incidentNumber = incidentArg
  const incidents = await Incident.find(filter).sort({ occurredAt: -1 })
  if (!incidents.length) {
    console.log('No approved incidents with parent notification are available to resend.')
    return
  }

  for (const incident of incidents) {
    const student = await Student.findById(incident.studentId)
    if (!student) {
      console.log(`${incident.incidentNumber}: student missing, skipped`)
      continue
    }
    if (ENABLE_CONSENT) {
      const links = await GuardianLink.find({ studentId: student._id }).select('parentId').lean()
      const result = await Parent.updateMany(
        { _id: { $in: links.map((l) => l.parentId) } },
        { $set: { whatsappConsent: true, smsConsent: false, emailConsent: false, preferredChannel: 'whatsapp' } },
      )
      console.log(`${incident.incidentNumber}: enabled WhatsApp consent on ${result.modifiedCount} guardian(s)`)
    }

    const templateKey = ['serious', 'critical'].includes(incident.severity) ? 'serious_incident' : 'incident_deduction'
    console.log(
      `${incident.incidentNumber} → ${student.fullName} (${student.studentId}) template=${templateKey} previous=${incident.parentNotificationStatus}`,
    )
    if (!CONFIRM) continue

    const removed = await MessageQueue.deleteMany({
      incidentId: incident._id,
      status: { $in: ['queued', 'failed', 'dead_letter', 'manual_review'] },
    })
    const result = await queueParentMessage({
      studentId: student._id,
      incidentId: incident._id,
      templateKey,
      dedupeSuffix: `resend-${Date.now()}`,
      extraVars: { balance: student.currentBalance },
    })
    console.log(`   cleared ${removed.deletedCount} old row(s); queued=${result.queued} skipped=${result.skipped}`)
    if (result.skipped && !result.queued) {
      console.log('   Skipped because the guardian has no WhatsApp consent, phone number or WhatsApp is disabled in settings.')
    }
  }

  if (!CONFIRM) {
    console.log('\nDry run only. Add --confirm to re-queue, and --enable-whatsapp-consent to switch the stored guardians to WhatsApp.')
  } else {
    console.log('\nMessages queued. The running backend sends them on its next queue tick (or immediately when WhatsApp is ready).')
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => disconnectDatabase())
