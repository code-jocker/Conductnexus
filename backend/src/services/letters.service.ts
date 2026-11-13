import PDFDocument from 'pdfkit'
import type { Request } from 'express'
import { getSettings } from '../models/core.js'
import { Letter, LetterTemplate, type ILetter } from '../models/communications.js'
import { Incident } from '../models/discipline.js'
import { ClassModel, Parent, GuardianLink, Student } from '../models/school.js'
import { HIGH_IMPACT_LETTER_TYPES } from '../shared/permissions.js'
import { nextRef } from '../shared/refs.js'
import { ApiError } from '../shared/errors.js'
import { writeAudit } from './audit.service.js'
import { createApproval } from './approvals.util.js'
import { notifyPermission, notifyUsers } from './notification.service.js'
import { assertStudentAccess, type AuthContext } from './rbac.service.js'
import { queueParentMessage } from './communication.service.js'
import { renderTemplate } from './communication.service.js'

export async function createLetter(
  ctx: AuthContext,
  input: {
    type: ILetter['type']
    studentId: string
    incidentId?: string
    templateId?: string
    subject?: string
    body?: string
  },
  req?: Request,
) {
  const student = await assertStudentAccess(ctx, input.studentId)
  const cls = await ClassModel.findById(student.classId)
  const settings = await getSettings()
  const incident = input.incidentId ? await Incident.findById(input.incidentId) : null
  const primaryLink = await GuardianLink.findOne({ studentId: student._id, isPrimary: true })
  const parent = primaryLink ? await Parent.findById(primaryLink.parentId) : null
  const template = input.templateId ? await LetterTemplate.findById(input.templateId) : null

  const vars: Record<string, string | number> = {
    schoolName: settings.school.name,
    parentName: parent?.name ?? 'Parent/Guardian',
    studentName: student.fullName,
    studentId: student.studentId,
    className: cls?.name ?? '',
    incidentNumber: incident?.incidentNumber ?? '',
    offenceName: incident?.offenceSnapshot?.name ?? '',
    incidentDate: incident ? new Date(incident.occurredAt).toLocaleDateString('en-RW', { timeZone: 'Africa/Kigali' }) : '',
    deduction: incident?.offenceSnapshot?.deduction ?? 0,
    balance: student.currentBalance,
    termName: '',
    startingMarks: settings.academic.startingMarks,
    reviewDate: '',
    supportStaff: '',
  }
  if (parent) vars.parentName = parent.name

  const body = input.body ?? (template ? renderTemplate(template.body, vars) : '')
  if (!body.trim()) throw ApiError.badRequest('A letter body is required')
  const subject = input.subject ?? (template ? renderTemplate(template.subject, vars) : 'Official school letter')

  const letter = await Letter.create({
    reference: await nextRef('LTR', 5),
    type: input.type,
    studentId: student._id,
    incidentId: input.incidentId,
    subject,
    body,
    status: 'draft',
    preparedBy: ctx.userId,
    templateId: template?._id,
    confidentiality: HIGH_IMPACT_LETTER_TYPES.has(input.type) ? 'restricted' : 'standard',
    studentSnapshot: {
      fullName: student.fullName,
      studentId: student.studentId,
      className: cls?.name ?? '',
    },
    history: [{ at: new Date(), by: ctx.userId, action: 'created' }],
  })
  await writeAudit({ req, actor: ctx, action: 'letter.created', resourceType: 'Letter', resourceId: String(letter._id), after: { type: input.type, reference: letter.reference } })
  return letter
}

export async function submitLetter(ctx: AuthContext, letterId: string, req?: Request) {
  const letter = await Letter.findById(letterId)
  if (!letter) throw ApiError.notFound('Letter not found')
  if (!['draft', 'rejected'].includes(letter.status)) throw ApiError.badRequest('This letter cannot be submitted')
  if (String(letter.preparedBy) !== String(ctx.userId) && !ctx.permissions.has('letters.approve')) {
    throw ApiError.forbidden('Only the preparer can submit this letter')
  }
  const highImpact = HIGH_IMPACT_LETTER_TYPES.has(letter.type)
  letter.status = 'pending_approval'
  letter.history.push({ at: new Date(), by: ctx.userId, action: 'submitted', note: 'Submitted for approval' })
  await letter.save()
  const approval = await createApproval({
    type: 'letter',
    refId: letter._id,
    studentId: letter.studentId,
    title: `${highImpact ? 'High-impact ' : ''}Letter approval — ${letter.reference}`,
    summary: `${letter.studentSnapshot.fullName}: ${letter.subject}`,
    requestedBy: ctx.userId,
    requiredPermission: 'letters.approve',
    requiredRole: highImpact ? 'HEADTEACHER' : undefined,
  })
  await notifyPermission(
    'letters.approve',
    {
      type: 'letter.approval_required',
      title: 'Letter awaiting approval',
      message: `${letter.reference} — ${letter.studentSnapshot.fullName}`,
      link: '/letters',
      data: { letterId: String(letter._id), approvalId: String(approval._id) },
    },
    { excludeUserId: String(ctx.userId) },
  )
  await writeAudit({ req, actor: ctx, action: 'letter.submitted', resourceType: 'Letter', resourceId: String(letter._id) })
  return { letter, approval }
}

export async function issueLetter(ctx: AuthContext, letterId: string, req?: Request) {
  const letter = await Letter.findById(letterId)
  if (!letter) throw ApiError.notFound('Letter not found')
  if (letter.status !== 'approved') throw ApiError.badRequest('Only approved letters can be issued')
  if (!ctx.permissions.has('letters.issue')) throw ApiError.forbidden('Missing permission: letters.issue')
  letter.status = 'issued'
  letter.issuedAt = new Date()
  letter.history.push({ at: new Date(), by: ctx.userId, action: 'issued' })
  await letter.save()
  try {
    await queueParentMessage({
      studentId: letter.studentId,
      letterId: letter._id,
      templateKey: 'warning_letter',
      createdBy: ctx.userId,
      extraVars: { letterType: letter.type.replace(/_/g, ' ') },
    })
  } catch {
    letter.deliveryStatus = 'failed'
    await letter.save()
  }
  await notifyUsers([letter.preparedBy], {
    type: 'letter.issued',
    title: 'Letter issued',
    message: `${letter.reference} has been issued.`,
    link: '/letters',
  })
  await writeAudit({ req, actor: ctx, action: 'letter.issued', resourceType: 'Letter', resourceId: String(letter._id) })
  return letter
}

export async function generateLetterPdf(letterId: string): Promise<Buffer> {
  const letter = await Letter.findById(letterId)
  if (!letter) throw ApiError.notFound('Letter not found')
  const settings = await getSettings()
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fillColor('#0b1b33').fontSize(18).font('Helvetica-Bold').text(settings.school.name || 'ConductNexus School')
    doc.fillColor('#64748b').fontSize(9).font('Helvetica').text(settings.school.address || '')
    doc.text(settings.school.phone ? `Tel: ${settings.school.phone}` : '')
    doc.text(settings.school.email || '')
    doc.moveDown(0.6)
    doc.strokeColor('#d97c3b').lineWidth(3).moveTo(56, doc.y).lineTo(539, doc.y).stroke()
    doc.moveDown(1)
    doc.fillColor('#172033').fontSize(10).text(`Reference: ${letter.reference}`)
    doc.text(`Date: ${new Date(letter.issuedAt ?? letter.createdAt).toLocaleDateString('en-RW', { timeZone: 'Africa/Kigali' })}`)
    doc.text(`Student: ${letter.studentSnapshot.fullName} (${letter.studentSnapshot.studentId})`)
    doc.moveDown(1)
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#0b1b33').text(letter.subject)
    doc.moveDown(0.8)
    doc.fontSize(11).font('Helvetica').fillColor('#172033').text(letter.body, { lineGap: 3 })
    doc.moveDown(2)
    doc.fontSize(10).text('Yours sincerely,')
    doc.moveDown(2)
    doc.font('Helvetica-Bold').text('Headteacher')
    doc.font('Helvetica').fillColor('#64748b').fontSize(8).text(settings.school.name)
    doc.moveDown(2)
    doc.fillColor('#94a3b8').fontSize(7).text('Generated by ConductNexus — Building Better Behaviour Through Connected School Discipline. Powered by Shyaka clever prince a.k.a Code jocker.')
    doc.end()
  })
}
