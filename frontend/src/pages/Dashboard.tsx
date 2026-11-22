import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  ClipboardList,
  GraduationCap,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Users,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { get } from '../lib/api'
import type { Dashboard } from '../lib/types'
import { formatDate, titleCase } from '../lib/utils'
import { Badge, Card, CardHeader, EmptyState, PageHeader, RiskBadge, StatCard, StatusBadge } from '../components/ui'
import { useI18n } from '../lib/i18n'
import { roleDashboardFor, type StatTone, type WidgetKey } from '../lib/roleDashboards'

const RISK_COLORS: Record<string, string> = {
  green: '#16a34a',
  yellow: '#eab308',
  orange: '#f97316',
  red: '#dc2626',
}

function actorName(value: { name?: string } | string | undefined): string {
  if (!value) return 'Unassigned'
  return typeof value === 'string' ? value : value.name ?? 'Unassigned'
}

/** Reads a numeric field from one permission-gated `extra` block of the dashboard payload. */
function extraNumber(block: Record<string, unknown>, key: string, field: string): number {
  const section = block[key]
  if (!section || typeof section !== 'object') return 0
  const value = (section as Record<string, unknown>)[field]
  return typeof value === 'number' ? value : Number(value ?? 0)
}

export function DashboardPage() {
  const { me } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => get<Dashboard>('/analytics/dashboard'),
  })

  const isParent = me?.roles.includes('PARENT') && !me?.roles.some((r) => ['ADMIN', 'HEADTEACHER', 'TEACHER', 'DEPUTY_DISCIPLINE'].includes(r))
  const metrics = data?.metrics
  const firstName = me?.user.name.split(' ')[0] ?? 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  if (isParent) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Parent portal"
          title={`${greeting}, ${firstName}`}
          subtitle="A clear view of your child's conduct, recognition and school communication."
        />
        <Card>
          <CardHeader title="My children" subtitle="Current conduct balance and risk status" icon={GraduationCap} />
          {data?.portalChildren?.length ? (
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {data.portalChildren.map((child) => (
                <Link
                  key={child.id}
                  to="/portal"
                  className="group rounded-xl border border-line p-4 transition hover:border-brand-300 hover:shadow-card dark:border-[#26374f] dark:hover:border-brand-700"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-display text-lg font-semibold">{child.name}</p>
                      <p className="text-xs text-slate-500">
                        {child.studentId} · {child.className}
                      </p>
                    </div>
                    <RiskBadge risk={child.risk} />
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-slate-400">Conduct balance</p>
                      <p className="font-mono text-2xl font-semibold text-brand-600">{child.balance}</p>
                    </div>
                    <span className="flex items-center gap-1 text-xs font-semibold text-brand-600 opacity-0 transition group-hover:opacity-100">
                      Open <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No children linked yet"
              message="Ask the school office to link your children to your parent account."
              icon={Users}
            />
          )}
        </Card>
        <Card>
          <CardHeader title="Recent school messages" subtitle="Notifications sent to you" icon={ShieldCheck} />
          <div className="p-5 text-sm text-slate-500 dark:text-slate-400">
            <Link to="/communications" className="link font-semibold">
              Open your communication centre →
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  const riskEntries = Object.entries(data?.charts.riskDistribution ?? {})
  const totalRisk = riskEntries.reduce((sum, [, v]) => sum + Number(v), 0)

  const config = roleDashboardFor(me?.roles, data?.role)
  const widgets = new Set<WidgetKey>(config.widgets)
  const stats = data ? config.stats(data) : []
  const extra = (data?.extra ?? {}) as Record<string, unknown>
  const meetings = (extra.upcomingMeetings ?? []) as { _id: string; title: string; scheduledAt: string }[]
  const recentAudit = (extra.recentAudit ?? []) as { _id: string; actorName: string; action: string; createdAt: string }[]
  const letters = (extra.letters ?? []) as { _id: string; reference: string; type: string; status: string; createdAt: string }[]
  const recognition = (extra.recentRecognition ?? []) as { _id: string; title: string; studentId?: { fullName?: string } }[]
  const queue = (extra.queue ?? {}) as Record<string, number>
  const whatsapp = extra.whatsapp as { status?: string; info?: { pushname?: string; number?: string } } | undefined
  const safeguarding = extra.safeguarding as { open?: number; critical?: number } | undefined
  const investigations = extra.investigations as { open?: number } | undefined
  const appeals = extra.appeals as { pending?: number } | undefined

  const TONE_CLASS: Record<StatTone, StatTone> = {
    brand: 'brand',
    ochre: 'ochre',
    amber: 'amber',
    red: 'red',
    emerald: 'emerald',
    slate: 'slate',
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={config.eyebrow}
        title={`${greeting}, ${firstName}`}
        subtitle={config.subtitle}
        actions={
          <Badge tone="slate">
            {data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString('en-RW', { hour: '2-digit', minute: '2-digit' })}` : 'Loading'}
          </Badge>
        }
      />

      {config.quickActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {config.quickActions.map((action) => (
            <Link
              key={action.href + action.label}
              to={action.href}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-brand-400 hover:text-brand-700 dark:border-[#26374f] dark:bg-[#111d31] dark:text-slate-200"
            >
              {action.label}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={isLoading ? '—' : stat.value}
            icon={Users}
            hint={stat.hint}
            tone={TONE_CLASS[stat.tone]}
            onClick={() => navigate(stat.href)}
          />
        ))}
      </div>

      {widgets.has('trend') && (
        <div className="grid gap-5 md:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader
              title="Incident & deduction trend"
              subtitle="Last 14 days, scoped to what you may see"
              icon={TrendingDown}
              actions={
                <Link to="/reports" className="link text-xs font-semibold">
                  Full reports
                </Link>
              }
            />
            <div className="h-48 md:h-64 px-2 pb-4 pt-2">
              {isLoading ? (
                <div className="skeleton h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data?.charts.trend ?? []} margin={{ top: 10, right: 16, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="incidentFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="deductionFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#d97c3b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#d97c3b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, borderColor: '#e2e8f0', fontSize: 12 }}
                      labelFormatter={(v) => formatDate(String(v))}
                    />
                    <Area type="monotone" dataKey="incidents" name="Incidents" stroke="#2563eb" fill="url(#incidentFill)" strokeWidth={2} />
                    <Area type="monotone" dataKey="deductions" name="Deductions" stroke="#d97c3b" fill="url(#deductionFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          {widgets.has('risk') && (
            <Card>
              <CardHeader title="Risk distribution" subtitle="Students by conduct risk band" icon={AlertTriangle} />
              <div className="h-40 md:h-48">
                {riskEntries.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={riskEntries.map(([key, value]) => ({ name: titleCase(key), key, value }))} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={3}>
                        {riskEntries.map(([key]) => (
                          <Cell key={key} fill={RISK_COLORS[key] ?? '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="grid h-full place-items-center text-sm text-slate-400">No risk data yet</div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-line p-4 dark:border-[#26374f]">
                {riskEntries.length ? (
                  riskEntries.map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                        <span className="h-2 w-2 rounded-full" style={{ background: RISK_COLORS[key] ?? '#94a3b8' }} />
                        {titleCase(key)}
                      </span>
                      <span className="font-mono font-semibold">{totalRisk ? Math.round((Number(value) / totalRisk) * 100) : 0}%</span>
                    </div>
                  ))
                ) : (
                  <p className="col-span-2 text-xs text-slate-400">Recalculate risk from the Risk &amp; support page.</p>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-[1.6fr_1fr]">
        {widgets.has('recentIncidents') && (
          <Card>
          <CardHeader
            title="Recent incidents"
            subtitle="Latest recorded conduct events"
            icon={ClipboardList}
            actions={
              <Link to="/incidents" className="link text-xs font-semibold">
                View all
              </Link>
            }
          />
          {data?.lists.recentIncidents?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                    <th className="px-5 py-2 font-semibold">Student</th>
                    <th className="px-3 py-2 font-semibold">Offence</th>
                    <th className="px-3 py-2 font-semibold">Severity</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-5 py-2 text-right font-semibold">Logged</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lists.recentIncidents.slice(0, 6).map((incident) => (
                    <tr
                      key={incident._id}
                      onClick={() => navigate(`/incidents/${incident._id}`)}
                      className="row-hover cursor-pointer border-b border-line/60 last:border-0 dark:border-[#1f2f49]"
                    >
                      <td className="px-5 py-3">
                        <p className="font-medium">{incident.studentSnapshot?.fullName}</p>
                        <p className="text-xs text-slate-400">
                          {incident.studentSnapshot?.className ?? '—'} · {incident.incidentNumber}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                        {incident.offenceSnapshot?.name}
                        <span className="ml-1 font-mono text-xs text-risk-red">−{incident.offenceSnapshot?.deduction}</span>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={incident.severity === 'critical' ? 'red' : incident.severity === 'high' ? 'orange' : 'slate'}>
                          {titleCase(incident.severity)}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={incident.status} />
                      </td>
                      <td className="px-5 py-3 text-right text-xs text-slate-400">{formatDate(incident.occurredAt ?? incident.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No incidents recorded" message="Newly recorded incidents will appear here." icon={Sparkles} />
          )}
          </Card>
        )}

        <div className="space-y-5">
          {widgets.has('highRisk') && (
          <Card>
            <CardHeader
              title="High-risk students"
              subtitle="Needs care team attention"
              icon={ShieldAlert}
              actions={
                <Link to="/risk" className="link text-xs font-semibold">
                  Open
                </Link>
              }
            />
            {data?.lists.highRiskStudents?.length ? (
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {data.lists.highRiskStudents.slice(0, 5).map((student) => (
                  <li key={student._id} className="flex items-center justify-between px-5 py-3">
                    <Link to={`/students/${student._id}`} className="min-w-0">
                      <p className="truncate text-sm font-medium hover:text-brand-600">{student.fullName}</p>
                      <p className="text-xs text-slate-400">{student.studentId}</p>
                    </Link>
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-mono text-sm font-semibold ${
                          student.currentBalance <= 15 ? 'text-risk-red' : student.currentBalance <= 25 ? 'text-risk-orange' : 'text-risk-yellow'
                        }`}
                      >
                        {student.currentBalance}
                      </span>
                      <RiskBadge risk={student.riskLevel} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No high-risk students" message="The conduct climate is stable." icon={ShieldCheck} />
            )}
          </Card>
          )}

          {widgets.has('approvals') && (
          <Card>
            <CardHeader title="Pending approvals" subtitle="Independent decisions required" icon={ShieldCheck} />
            {data?.lists.pendingApprovals?.length ? (
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {data.lists.pendingApprovals.slice(0, 4).map((approval) => (
                  <li key={approval._id} className="px-5 py-3">
                    <Link to="/approvals" className="group flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium group-hover:text-brand-600">{approval.title}</p>
                        <p className="text-xs text-slate-400">
                          {titleCase(approval.type)} · {actorName(approval.requestedBy)}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">{formatDate(approval.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing waiting" message="All approvals are decided." icon={ShieldCheck} />
            )}
          </Card>
          )}

          {widgets.has('followUps') && (
          <Card>
            <CardHeader
              title="Follow-ups due"
              subtitle="Check-ins assigned to you"
              icon={CalendarClock}
              actions={
                <Link to="/risk" className="link text-xs font-semibold">
                  Open
                </Link>
              }
            />
            {data?.lists.upcomingFollowUps?.length ? (
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {data.lists.upcomingFollowUps.slice(0, 4).map((followUp) => (
                  <li key={followUp._id} className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm">{titleCase(followUp.type)}</span>
                    <span className="text-xs text-slate-400">{formatDate(followUp.dueDate)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No follow-ups due" message="Nothing scheduled for you." icon={ShieldCheck} />
            )}
          </Card>
          )}
        </div>
      </div>

      {widgets.has('classAverages') && (
      <Card>
        <CardHeader title="Class conduct averages" subtitle="Average balance by class this term" icon={GraduationCap} />
        <div className="h-48 md:h-56 px-2 pb-4">
          {data?.charts.classAverages?.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.classAverages} margin={{ top: 10, right: 16, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 40]} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="average" name="Average" radius={[6, 6, 0, 0]} barSize={34}>
                  {data.charts.classAverages.map((row) => (
                    <Cell key={row.name} fill={row.average >= 30 ? '#2563eb' : '#d97c3b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="grid h-full place-items-center text-sm text-slate-400">No class averages available yet</div>
          )}
        </div>
      </Card>
      )}

      {(widgets.has('users') ||
        widgets.has('audit') ||
        widgets.has('queue') ||
        widgets.has('whatsapp') ||
        widgets.has('safeguarding') ||
        widgets.has('investigations') ||
        widgets.has('appeals') ||
        widgets.has('letters') ||
        widgets.has('parents') ||
        widgets.has('recognition') ||
        widgets.has('meetings') ||
        widgets.has('notifications')) && (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {widgets.has('users') && (
            <Card>
              <CardHeader title="User accounts" subtitle="Active roles and accounts" icon={Users} actions={<Link to="/users" className="link text-xs font-semibold">Manage</Link>} />
              <dl className="grid grid-cols-3 gap-3 p-5">
                {[
                  ['Active', extraNumber(extra, 'users', 'active')],
                  ['Total', extraNumber(extra, 'users', 'total')],
                  ['Roles', extraNumber(extra, 'users', 'roles')],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-[11px] uppercase tracking-wider text-slate-400">{label}</dt>
                    <dd className="font-mono text-xl font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {widgets.has('queue') && (
            <Card>
              <CardHeader title="Message queue health" subtitle="Delivery backlog by status" icon={ClipboardList} actions={<Link to="/communications" className="link text-xs font-semibold">Open</Link>} />
              {Object.keys(queue).length ? (
                <dl className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
                  {Object.entries(queue)
                    .filter(([, value]) => typeof value === 'number')
                    .map(([state, value]) => (
                      <div key={state}>
                        <dt className="text-[11px] uppercase tracking-wider text-slate-400">{titleCase(state)}</dt>
                        <dd className={`font-mono text-xl font-semibold ${state === 'failed' && Number(value) > 0 ? 'text-risk-red' : ''}`}>
                          {Number(value)}
                        </dd>
                      </div>
                    ))}
                </dl>
              ) : (
                <EmptyState title="No queued messages" message="Nothing waiting for delivery." icon={ClipboardList} />
              )}
            </Card>
          )}

          {widgets.has('whatsapp') && (
            <Card>
              <CardHeader title="WhatsApp session" subtitle="Notification channel status" icon={ClipboardList} actions={<Link to="/communications" className="link text-xs font-semibold">Open</Link>} />
              <div className="space-y-2 p-5 text-sm">
                <Badge tone={whatsapp?.status === 'ready' ? 'green' : whatsapp?.status ? 'amber' : 'slate'}>
                  {whatsapp?.status ? titleCase(whatsapp.status) : 'Not configured'}
                </Badge>
                {whatsapp?.info && typeof whatsapp.info === 'object' ? (
                  <p className="text-xs text-slate-400">
                    {titleCase(String((whatsapp.info as Record<string, unknown>).pushname ?? 'Connected device'))}
                    {(whatsapp.info as Record<string, unknown>).wid
                      ? ` · ${String((whatsapp.info as Record<string, unknown>).wid).replace('@c.us', '')}`
                      : ''}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400">No active WhatsApp session.</p>
                )}
              </div>
            </Card>
          )}

          {widgets.has('safeguarding') && (
            <Card>
              <CardHeader title="Safeguarding" subtitle="Open cases" icon={ShieldAlert} actions={<Link to="/safeguarding" className="link text-xs font-semibold">Open</Link>} />
              <dl className="grid grid-cols-2 gap-3 p-5">
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Open</dt>
                  <dd className="font-mono text-xl font-semibold">{safeguarding?.open ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Critical</dt>
                  <dd className="font-mono text-xl font-semibold text-risk-red">{safeguarding?.critical ?? 0}</dd>
                </div>
              </dl>
            </Card>
          )}

          {widgets.has('investigations') && (
            <Card>
              <CardHeader title="Investigations" subtitle="Under review" icon={ClipboardList} actions={<Link to="/investigations" className="link text-xs font-semibold">Open</Link>} />
              <div className="p-5">
                <p className="font-mono text-2xl font-semibold">{investigations?.open ?? 0}</p>
                <p className="text-xs text-slate-400">Open investigations</p>
              </div>
            </Card>
          )}

          {widgets.has('appeals') && (
            <Card>
              <CardHeader title="Appeals" subtitle="Awaiting decision" icon={ShieldCheck} actions={<Link to="/approvals" className="link text-xs font-semibold">Open</Link>} />
              <div className="p-5">
                <p className="font-mono text-2xl font-semibold">{appeals?.pending ?? 0}</p>
                <p className="text-xs text-slate-400">Pending appeals</p>
              </div>
            </Card>
          )}

          {widgets.has('letters') && (
            <Card>
              <CardHeader title="Recent letters" subtitle="Issued correspondence" icon={ClipboardList} actions={<Link to="/communications" className="link text-xs font-semibold">Open</Link>} />
              {letters.length ? (
                <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                  {letters.slice(0, 5).map((letter) => (
                    <li key={letter._id} className="flex items-center justify-between px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{letter.reference}</p>
                        <p className="text-xs text-slate-400">{titleCase(letter.type)}</p>
                      </div>
                      <StatusBadge status={letter.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No letters issued" message="Issued letters appear here." icon={Sparkles} />
              )}
            </Card>
          )}

          {widgets.has('parents') && (
            <Card>
              <CardHeader title="Parent records" subtitle="Guardians on file" icon={Users} actions={<Link to="/communications" className="link text-xs font-semibold">Open</Link>} />
              <div className="p-5">
                <p className="font-mono text-2xl font-semibold">{extraNumber(extra, 'parents', 'total')}</p>
                <p className="text-xs text-slate-400">Contactable guardians</p>
              </div>
            </Card>
          )}

          {widgets.has('recognition') && (
            <Card>
              <CardHeader title="Recent recognition" subtitle="Awards issued" icon={Sparkles} actions={<Link to="/students" className="link text-xs font-semibold">Open</Link>} />
              {recognition.length ? (
                <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                  {recognition.slice(0, 5).map((item) => (
                    <li key={item._id} className="flex items-center justify-between px-5 py-3">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      {item.studentId?.fullName ? <span className="ml-3 shrink-0 text-xs text-slate-400">{item.studentId.fullName}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No recognition yet" message="Positive awards will appear here." icon={Sparkles} />
              )}
            </Card>
          )}

          {widgets.has('meetings') && (
            <Card>
              <CardHeader title="Upcoming meetings" subtitle="Scheduled on the calendar" icon={CalendarClock} actions={<Link to="/meetings" className="link text-xs font-semibold">Open</Link>} />
              {meetings.length ? (
                <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                  {meetings.slice(0, 5).map((meeting) => (
                    <li key={meeting._id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <p className="truncate text-sm font-medium">{meeting.title}</p>
                      <span className="shrink-0 text-xs text-slate-400">{formatDate(meeting.scheduledAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No meetings scheduled" message="Scheduled meetings appear here." icon={CalendarClock} />
              )}
            </Card>
          )}

          {widgets.has('notifications') && (
            <Card>
              <CardHeader title="Notification centre" subtitle="Your inbox" icon={ClipboardList} actions={<Link to="/communications" className="link text-xs font-semibold">Open</Link>} />
              <div className="p-5">
                <p className="font-mono text-2xl font-semibold">{typeof extra.unreadNotifications === 'number' ? extra.unreadNotifications : 0}</p>
                <p className="text-xs text-slate-400">Unread notifications</p>
              </div>
            </Card>
          )}

          {widgets.has('audit') && (
            <Card className="md:col-span-2 xl:col-span-1">
              <CardHeader title="Recent audit activity" subtitle="Latest security-relevant events" icon={ClipboardList} actions={<Link to="/audit" className="link text-xs font-semibold">View all</Link>} />
              {recentAudit.length ? (
                <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                  {recentAudit.slice(0, 5).map((entry) => (
                    <li key={entry._id} className="px-5 py-3">
                      <p className="truncate text-sm font-medium">{entry.actorName}</p>
                      <p className="text-xs text-slate-400">
                        {titleCase(entry.action)} · {formatDate(entry.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No audit activity" message="Security events appear here." icon={ShieldCheck} />
              )}
            </Card>
          )}
        </div>
      )}

      <p className="text-center text-[11px] text-slate-400">{t('common.loading').replace('…', '')} — conduct data is recalculated automatically.</p>
    </div>
  )
}
