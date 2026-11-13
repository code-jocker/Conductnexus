import { Types } from 'mongoose'
import { AcademicYear, Term } from '../models/school.js'
import { ApiError } from '../shared/errors.js'

export async function getActiveAcademicYear() {
  const year = await AcademicYear.findOne({ isActive: true })
  if (!year) throw ApiError.badRequest('No active academic year is configured. An administrator must activate one.')
  return year
}

export async function getActiveTerm() {
  const term = await Term.findOne({ isActive: true })
  if (!term) throw ApiError.badRequest('No active term is configured. An administrator must activate a term.')
  return term
}

export async function resolveTerm(termId?: string | Types.ObjectId | null) {
  if (termId) {
    const term = await Term.findById(termId)
    if (!term) throw ApiError.badRequest('Term not found')
    return term
  }
  return getActiveTerm()
}
