import { Types } from 'mongoose'
import { Approval, type IApproval } from '../models/discipline.js'
import { nextRef } from '../shared/refs.js'

export async function createApproval(input: {
  type: IApproval['type']
  refId: Types.ObjectId
  studentId?: Types.ObjectId
  title: string
  summary?: string
  requestedBy: Types.ObjectId
  requiredPermission: string
  requiredRole?: string
}): Promise<IApproval> {
  const approvalNumber = await nextRef('APR', 4)
  return Approval.create({ ...input, approvalNumber, status: 'pending' })
}
