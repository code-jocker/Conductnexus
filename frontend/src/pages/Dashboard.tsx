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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={data?.roleLabel ? `${data.roleLabel} workspace` : 'Overview'}
        title={`${greeting}, ${firstName}`}
        subtitle="Live conduct posture across your school — reviewed, approved and fully auditable."
        actions={
          <Badge tone="slate">
            {data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString('en-RW', { hour: '2-digit', minute: '2-digit' })}` : 'Loading'}
          </Badge>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Students on roll"
          value={metrics?.students ?? '—'}
          icon={Users}
          hint="Active students this term"
          tone="brand"
          onClick={() => navigate('/students')}
        />
        <StatCard
          label="Open incidents"
          value={metrics?.incidents ?? '—'}
          icon={ClipboardList}
          hint={`${metrics?.myIncidents ?? 0} reported by you`}
          tone="ochre"
          onClick={() => navigate('/incidents')}
        />
        <StatCard
          label="Awaiting review"
          value={metrics?.pendingReview ?? '—'}
          icon={ShieldCheck}
          hint={`${metrics?.pendingApprovals ?? 0} approvals pending`}
          tone="amber"
          onClick={() => navigate('/approvals')}
        />
        <StatCard
          label="High / critical risk"
          value={(metrics?.highRisk ?? 0) + (metrics?.critical ?? 0)}
          icon={ShieldAlert}
          hint={`${metrics?.critical ?? 0} critical cases`}
          tone="red"
          onClick={() => navigate('/risk')}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader
            title="Incident & deduction trend"
            subtitle="Last 30 days"
            icon={TrendingDown}
            actions={
              <Link to="/reports" className="link text-xs font-semibold">
                Full reports
              </Link>
            }
          />
          <div className="h-64 px-2 pb-4 pt-2">
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

        <Card>
          <CardHeader title="Risk distribution" subtitle="Students by conduct risk band" icon={AlertTriangle} />
          <div className="h-48">
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
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
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

        <div className="space-y-5">
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
        </div>
      </div>

      <Card>
        <CardHeader title="Class conduct averages" subtitle="Average balance by class this term" icon={GraduationCap} />
        <div className="h-56 px-2 pb-4">
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

      <p className="text-center text-[11px] text-slate-400">{t('common.loading').replace('…', '')} — conduct data is recalculated automatically.</p>
    </div>
  )
}
