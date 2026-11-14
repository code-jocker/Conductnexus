import { api } from './client'
import { deviceInfo } from '../auth/storage'
import type {
  ApiEnvelope,
  Approval,
  DashboardPayload,
  IncidentSummary,
  LedgerEntry,
  MePayload,
  NotificationItem,
  Offence,
  PageMeta,
  PortalChild,
  PortalChildDetail,
  SessionPayload,
  SessionView,
  Student,
  StudentProfile,
  SyncDraft,
  SyncResult,
} from './types'

async function unwrap<T>(promise: Promise<{ data: ApiEnvelope<T>; headers: unknown }>): Promise<T> {
  const res = await promise
  return res.data.data
}

// ── Auth ───────────────────────────────────────────────────────────────────

export async function nativeLogin(email: string, password: string): Promise<SessionPayload> {
  const device = await deviceInfo()
  const res = await api.post<ApiEnvelope<SessionPayload>>('/auth/native/login', { email, password, device })
  return res.data.data
}

export async function nativeGoogle(idToken: string): Promise<SessionPayload> {
  const device = await deviceInfo()
  const res = await api.post<ApiEnvelope<SessionPayload>>('/auth/native/google', { idToken, device })
  return res.data.data
}

export async function nativeRefresh(refreshToken: string): Promise<SessionPayload> {
  const device = await deviceInfo()
  const res = await api.post<ApiEnvelope<SessionPayload>>('/auth/native/refresh', { refreshToken, device })
  return res.data.data
}

export async function nativeLogout(refreshToken?: string | null): Promise<void> {
  if (!refreshToken) return
  await api.post('/auth/native/logout', { refreshToken })
}

export async function fetchMe(): Promise<MePayload> {
  return unwrap(api.get<ApiEnvelope<MePayload>>('/auth/me'))
}

export async function forgotPassword(email: string): Promise<{ delivered: boolean; devCode?: string; message: string }> {
  const res = await api.post<ApiEnvelope<{ delivered: boolean; devCode?: string; message: string }>>('/auth/forgot-password', { email })
  return res.data.data
}

export async function resetPassword(input: { email: string; code: string; newPassword: string }): Promise<void> {
  await api.post('/auth/reset-password', input)
}

export async function changePassword(input: { currentPassword: string; newPassword: string }): Promise<void> {
  await api.post('/auth/change-password', input)
}

// ── Sessions and devices ───────────────────────────────────────────────────

export async function listSessions(): Promise<SessionView[]> {
  const res = await api.get<ApiEnvelope<{ sessions: SessionView[] }>>('/auth/sessions')
  return res.data.data.sessions
}

export async function revokeSession(id: string): Promise<void> {
  await api.delete(`/auth/sessions/${id}`)
}

export async function logoutOtherSessions(): Promise<void> {
  await api.post('/auth/logout-others')
}

export async function registerPushToken(token: string, platform: string): Promise<void> {
  await api.post('/auth/push-token', { token, platform })
}

export async function removePushToken(): Promise<void> {
  await api.delete('/auth/push-token')
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export async function fetchDashboard(): Promise<DashboardPayload> {
  return unwrap(api.get<ApiEnvelope<DashboardPayload>>('/analytics/dashboard'))
}

// ── Students ───────────────────────────────────────────────────────────────

export async function listStudents(params: {
  q?: string
  page?: number
  pageSize?: number
  risk?: string
}): Promise<{ items: Student[]; meta: PageMeta }> {
  const res = await api.get<ApiEnvelope<Student[]>>('/students', { params })
  return {
    items: res.data.data,
    meta: {
      page: res.data.meta?.page ?? 1,
      pageSize: res.data.meta?.pageSize ?? params.pageSize ?? 20,
      total: res.data.meta?.total ?? res.data.data.length,
      totalPages: res.data.meta?.totalPages ?? 1,
    },
  }
}

export async function fetchStudent(id: string): Promise<Student & { guardians?: unknown[] }> {
  return unwrap(api.get<ApiEnvelope<Student & { guardians?: unknown[] }>>(`/students/${id}`))
}

export async function fetchStudentProfile(id: string): Promise<StudentProfile> {
  return unwrap(api.get<ApiEnvelope<StudentProfile>>(`/students/${id}/profile`))
}

export async function fetchStudentHistory(id: string): Promise<{
  student: { id: string; fullName: string }
  incidents: IncidentSummary[]
  ledger: LedgerEntry[]
  assessments: Record<string, unknown>[]
  recognitions: Record<string, unknown>[]
}> {
  return unwrap(api.get(`/students/${id}/history`))
}

// ── Discipline ─────────────────────────────────────────────────────────────

export async function listOffences(): Promise<Offence[]> {
  return unwrap(api.get<ApiEnvelope<Offence[]>>('/offences', { params: { active: 'true' } }))
}

export async function listIncidents(params: {
  q?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ items: IncidentSummary[]; meta: PageMeta }> {
  const res = await api.get<ApiEnvelope<IncidentSummary[]>>('/incidents', { params })
  return {
    items: res.data.data,
    meta: {
      page: res.data.meta?.page ?? 1,
      pageSize: res.data.meta?.pageSize ?? params.pageSize ?? 20,
      total: res.data.meta?.total ?? res.data.data.length,
      totalPages: res.data.meta?.totalPages ?? 1,
    },
  }
}

export async function fetchIncident(id: string): Promise<IncidentSummary> {
  return unwrap(api.get<ApiEnvelope<IncidentSummary>>(`/incidents/${id}`))
}

export async function createIncident(input: {
  studentId: string
  offenceId: string
  description: string
  occurredAt: string
  location: string
  safeguardingFlag?: boolean
  clientSubmissionId?: string
}): Promise<IncidentSummary> {
  return unwrap(api.post<ApiEnvelope<IncidentSummary>>('/incidents', input))
}

export async function updateIncident(id: string, input: Record<string, unknown>): Promise<IncidentSummary> {
  return unwrap(api.patch<ApiEnvelope<IncidentSummary>>(`/incidents/${id}`, input))
}

export async function submitIncident(id: string): Promise<IncidentSummary> {
  return unwrap(api.post<ApiEnvelope<IncidentSummary>>(`/incidents/${id}/submit`))
}

export async function reviewIncident(
  id: string,
  decision: 'approve' | 'reject' | 'request_info',
  comments?: string,
): Promise<IncidentSummary> {
  return unwrap(api.post<ApiEnvelope<IncidentSummary>>(`/incidents/${id}/review`, { decision, comments }))
}

export async function syncDrafts(drafts: SyncDraft[]): Promise<{ results: SyncResult[]; syncedAt: string }> {
  return unwrap(api.post('/sync/incidents', { drafts }))
}

// ── Approvals ──────────────────────────────────────────────────────────────

export async function listApprovals(status = 'pending'): Promise<{ items: Approval[]; pendingCount: number }> {
  const res = await api.get<ApiEnvelope<Approval[]>>('/approvals', { params: { status, pageSize: 50 } })
  return { items: res.data.data, pendingCount: res.data.meta?.pendingCount ?? res.data.data.length }
}

export async function decideApproval(
  id: string,
  decision: 'approve' | 'reject' | 'request_info',
  notes: string,
): Promise<unknown> {
  const path =
    decision === 'approve' ? 'approve' : decision === 'reject' ? 'reject' : 'request-info'
  const body = decision === 'approve' ? { notes } : decision === 'reject' ? { reason: notes } : { notes }
  return unwrap(api.post(`/approvals/${id}/${path}`, body))
}

// ── Notifications ──────────────────────────────────────────────────────────

export async function listNotifications(unreadOnly = false): Promise<{ items: NotificationItem[]; unread: number }> {
  const res = await api.get<ApiEnvelope<NotificationItem[]>>('/notifications', {
    params: { pageSize: 50, ...(unreadOnly ? { unread: 'true' } : {}) },
  })
  return { items: res.data.data, unread: res.data.meta?.unread ?? 0 }
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.post(`/notifications/${id}/read`)
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('/notifications/read-all')
}

// ── Parent portal ──────────────────────────────────────────────────────────

export async function fetchPortalChildren(): Promise<{
  parent: { name: string; phone?: string; email?: string }
  children: PortalChild[]
}> {
  return unwrap(api.get('/portal/children'))
}

export async function fetchPortalChild(id: string): Promise<PortalChildDetail> {
  return unwrap(api.get(`/portal/children/${id}`))
}

export type PortalConsent = {
  whatsappConsent: boolean
  smsConsent: boolean
  emailConsent: boolean
  preferredChannel: 'whatsapp' | 'sms' | 'email'
}

export async function fetchPortalConsent(): Promise<PortalConsent> {
  return unwrap(api.get<ApiEnvelope<PortalConsent>>('/portal/consent'))
}

export async function updatePortalConsent(input: Partial<PortalConsent>): Promise<PortalConsent> {
  return unwrap(api.patch<ApiEnvelope<PortalConsent>>('/portal/consent', input))
}

export async function submitPortalDataRequest(input: {
  type: 'correction' | 'access' | 'objection' | 'erasure'
  studentId?: string
  details: string
}): Promise<{ requestNumber: string; status: string; dueDate: string }> {
  return unwrap(api.post('/portal/data-requests', input))
}
