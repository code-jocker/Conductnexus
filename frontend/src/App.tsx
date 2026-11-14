import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, type ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { ThemeProvider } from './lib/theme'
import { I18nProvider } from './lib/i18n'
import { ToastProvider } from './components/toast'
import { AppShell } from './components/layout/AppShell'
import { PwaBanner } from './components/PwaBanner'
import { LoadingBlock } from './components/ui'

const LoginPage = lazy(() => import('./pages/auth/Login').then((m) => ({ default: m.LoginPage })))
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPassword').then((m) => ({ default: m.ForgotPasswordPage })))
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPassword').then((m) => ({ default: m.ResetPasswordPage })))
const VerifyEmailPage = lazy(() => import('./pages/auth/VerifyEmail').then((m) => ({ default: m.VerifyEmailPage })))
const SetupPage = lazy(() => import('./pages/auth/Setup').then((m) => ({ default: m.SetupPage })))
const ChangePasswordPage = lazy(() => import('./pages/auth/ChangePassword').then((m) => ({ default: m.ChangePasswordPage })))
const DashboardPage = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.DashboardPage })))
const StudentsPage = lazy(() => import('./pages/Students').then((m) => ({ default: m.StudentsPage })))
const StudentProfilePage = lazy(() => import('./pages/StudentProfile').then((m) => ({ default: m.StudentProfilePage })))
const PromotionsPage = lazy(() => import('./pages/Promotions').then((m) => ({ default: m.PromotionsPage })))
const IncidentsPage = lazy(() => import('./pages/Incidents').then((m) => ({ default: m.IncidentsPage })))
const IncidentNewPage = lazy(() => import('./pages/IncidentNew').then((m) => ({ default: m.IncidentNewPage })))
const IncidentDetailPage = lazy(() => import('./pages/IncidentDetail').then((m) => ({ default: m.IncidentDetailPage })))
const ApprovalsPage = lazy(() => import('./pages/Approvals').then((m) => ({ default: m.ApprovalsPage })))
const RiskPage = lazy(() => import('./pages/Risk').then((m) => ({ default: m.RiskPage })))
const SafeguardingPage = lazy(() => import('./pages/Safeguarding').then((m) => ({ default: m.SafeguardingPage })))
const InvestigationsPage = lazy(() => import('./pages/Investigations').then((m) => ({ default: m.InvestigationsPage })))
const AppealsPage = lazy(() => import('./pages/Appeals').then((m) => ({ default: m.AppealsPage })))
const EvidencePage = lazy(() => import('./pages/Evidence').then((m) => ({ default: m.EvidencePage })))
const EvidenceCasePage = lazy(() => import('./pages/EvidenceCase').then((m) => ({ default: m.EvidenceCasePage })))
const PoliciesPage = lazy(() => import('./pages/Policies').then((m) => ({ default: m.PoliciesPage })))
const MeetingsPage = lazy(() => import('./pages/Meetings').then((m) => ({ default: m.MeetingsPage })))
const CommunicationsPage = lazy(() => import('./pages/Communications').then((m) => ({ default: m.CommunicationsPage })))
const ReportsPage = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportsPage })))
const DraftsPage = lazy(() => import('./pages/Drafts').then((m) => ({ default: m.DraftsPage })))
const StructurePage = lazy(() => import('./pages/Structure').then((m) => ({ default: m.StructurePage })))
const UsersPage = lazy(() => import('./pages/Users').then((m) => ({ default: m.UsersPage })))
const DataProtectionPage = lazy(() => import('./pages/DataProtection').then((m) => ({ default: m.DataProtectionPage })))
const AuditPage = lazy(() => import('./pages/Audit').then((m) => ({ default: m.AuditPage })))
const MonitoringPage = lazy(() => import('./pages/Monitoring').then((m) => ({ default: m.MonitoringPage })))
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })))
const PortalPage = lazy(() => import('./pages/Portal').then((m) => ({ default: m.PortalPage })))
const ProfilePage = lazy(() => import('./pages/Profile').then((m) => ({ default: m.ProfilePage })))
const PrivacyPage = lazy(() => import('./pages/Privacy').then((m) => ({ default: m.PrivacyPage })))
const NotFoundPage = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFoundPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
})

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingBlock label="Starting your session…" />
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (me.user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }
  return <>{children}</>
}

function RequirePermission({ permission, children }: { permission: string | string[]; children: ReactNode }) {
  const { has } = useAuth()
  if (!has(permission)) return <NoAccess />
  return <>{children}</>
}

export function NoAccess() {
  return (
    <div className="surface mx-auto max-w-lg p-8 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-ochre-500">403 — Restricted</p>
      <h1 className="mt-2 text-2xl font-semibold">You do not have access to this area</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Your role does not include the permission required for this page. Ask an administrator to review your
        permissions in Users &amp; roles if you believe this is a mistake.
      </p>
      <a href="/" className="mt-5 inline-flex text-sm font-semibold text-brand-600 hover:underline">
        Return to dashboard
      </a>
    </div>
  )
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth()
  if (loading) return <LoadingBlock label="Checking your session…" />
  if (me && !me.user.mustChangePassword) return <Navigate to="/" replace />
  return <>{children}</>
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>
            <AuthProvider>
              <BrowserRouter>
                <Suspense fallback={<LoadingBlock label="Loading page…" />}>
                  <Routes>
                  <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
                  <Route path="/forgot-password" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/verify-email" element={<VerifyEmailPage />} />
                  <Route path="/setup" element={<SetupPage />} />
                  <Route path="/privacy" element={<PrivacyPage />} />

                  <Route
                    element={
                      <RequireAuth>
                        <AppShell />
                      </RequireAuth>
                    }
                  >
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/change-password" element={<ChangePasswordPage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/students" element={<RequirePermission permission="students.view"><StudentsPage /></RequirePermission>} />
                    <Route path="/students/:id" element={<RequirePermission permission="students.view"><StudentProfilePage /></RequirePermission>} />
                    <Route path="/promotions" element={<RequirePermission permission="students.view"><PromotionsPage /></RequirePermission>} />
                    <Route path="/incidents" element={<RequirePermission permission="incidents.view"><IncidentsPage /></RequirePermission>} />
                    <Route path="/incidents/new" element={<RequirePermission permission="incidents.create"><IncidentNewPage /></RequirePermission>} />
                    <Route path="/incidents/:id" element={<RequirePermission permission="incidents.view"><IncidentDetailPage /></RequirePermission>} />
                    <Route path="/incidents/:id/evidence" element={<RequirePermission permission="evidence.view"><EvidenceCasePage /></RequirePermission>} />
                    <Route path="/approvals" element={<ApprovalsPage />} />
                    <Route path="/risk" element={<RequirePermission permission="risk.view"><RiskPage /></RequirePermission>} />
                    <Route path="/safeguarding" element={<RequirePermission permission="safeguarding.view"><SafeguardingPage /></RequirePermission>} />
                    <Route path="/investigations" element={<RequirePermission permission="investigations.view"><InvestigationsPage /></RequirePermission>} />
                    <Route path="/appeals" element={<RequirePermission permission="appeals.view"><AppealsPage /></RequirePermission>} />
                    <Route path="/evidence" element={<RequirePermission permission="evidence.view"><EvidencePage /></RequirePermission>} />
                    <Route path="/policies" element={<RequirePermission permission="policies.view"><PoliciesPage /></RequirePermission>} />
                    <Route path="/meetings" element={<RequirePermission permission="meetings.view"><MeetingsPage /></RequirePermission>} />
                    <Route path="/communications" element={<RequirePermission permission="notifications.view"><CommunicationsPage /></RequirePermission>} />
                    <Route path="/reports" element={<RequirePermission permission="reports.view"><ReportsPage /></RequirePermission>} />
                    <Route path="/drafts" element={<RequirePermission permission="incidents.create"><DraftsPage /></RequirePermission>} />
                    <Route path="/structure" element={<RequirePermission permission={['classes.view', 'academic_years.manage', 'dormitories.view']}><StructurePage /></RequirePermission>} />
                    <Route path="/users" element={<RequirePermission permission="users.view"><UsersPage /></RequirePermission>} />
                    <Route path="/data-protection" element={<RequirePermission permission="data_protection.view"><DataProtectionPage /></RequirePermission>} />
                    <Route path="/audit" element={<RequirePermission permission="audit.view"><AuditPage /></RequirePermission>} />
                    <Route path="/monitoring" element={<RequirePermission permission="system.monitor"><MonitoringPage /></RequirePermission>} />
                    <Route path="/settings" element={<RequirePermission permission="settings.manage"><SettingsPage /></RequirePermission>} />
                    <Route path="/portal" element={<PortalPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                  </Routes>
                </Suspense>
                <PwaBanner />
              </BrowserRouter>
            </AuthProvider>
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
