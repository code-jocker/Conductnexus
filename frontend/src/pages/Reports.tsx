import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download, FileSpreadsheet, Filter, ShieldAlert, Users } from 'lucide-react'
import { apiError, downloadFile, get } from '../lib/api'
import { useStructure } from '../lib/hooks'
import { formatDate, titleCase } from '../lib/utils'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  RiskBadge,
  Select,
  StatCard,
  StatusBadge,
  Tabs,
} from '../components/ui'
import { useToast } from '../components/toast'

type ReportKind = 'term' | 'year-end' | 'high-risk' | 'class' | 'teacher-activity' | 'communication'

type FeeRow = { classId: string; name: string; students: number; incidents: number; averageBalance: number; risk: Record<string, number> }

type TermReport = {
  term: { name: string; academicYear: string } | null
  studentCount: number
  totalIncidents: number
  totalDeductions: number
  totalRewards: number
  goodStanding: number
  attention: number
  highRisk: number
  criticalRisk: number
  riskDistribution: Record<string, number>
  pendingCases: number
  resolvedCases: number
  rejectedCases: number
  offenceBreakdown: { name: string; count: number; marks: number }[]
  classStats: FeeRow[]
  generatedAt: string
}

type YearEndReport = {
  academicYear: { name: string; startDate: string; endDate: string; status: string } | null
  terms: TermReport[]
  comparisons: { term: string; incidents: number; deductions: number; rewards: number; highRisk: number; critical: number; averageConduct: number }[]
  classComparisons?: { name: string; students: number; averageBalance: number; highRisk: number }[]
  streamComparisons?: { name: string; students: number; averageBalance: number; highRisk: number }[]
  dormitoryComparisons?: { name: string; students: number; averageBalance: number; highRisk: number }[]
}

type HighRiskReport = {
  students: {
    studentId: string
    name: string
    admissionNumber: string
    balance: number
    risk: string
    incidentCount: number
    lastIncident?: string
    intervention?: { title: string; assignedTo?: string } | null
    nextFollowUp?: string
  }[]
  total: number
}

type ClassReport = {
  classes: {
    class: string
    classId: string
    students: number
    incidents: number
    averageConduct: number
    risk: Record<string, number>
    outstandingCases: number
    topOffences: { name: string; count: number }[]
  }[]
}

type TeacherReport = {
  teachers: { name: string; email: string; submitted: number; approved: number; rejected: number; pending: number }[]
}

type CommunicationReport = {
  summary: { queued: number; sent: number; failed: number; deadLetter: number; manualReview: number }
  byChannel: Record<string, number>
  recent: { id: string; channel: string; to: string; status: string; attempts: number; sentAt?: string; createdAt: string; lastError?: string }[]
  total: number
}

const KINDS: { key: ReportKind; label: string }[] = [
  { key: 'term', label: 'Term report' },
  { key: 'year-end', label: 'Year-end' },
  { key: 'high-risk', label: 'High-risk students' },
  { key: 'class', label: 'Class analysis' },
  { key: 'teacher-activity', label: 'Teacher activity' },
  { key: 'communication', label: 'Communication' },
]

const balanceTone = (value: number) =>
  value >= 32 ? 'text-emerald-600' : value >= 25 ? 'text-amber-600' : value >= 15 ? 'text-orange-600' : 'text-red-600'

export function ReportsPage() {
  const { success, error: toastError } = useToast()
  const { data: structure } = useStructure()
  const [kind, setKind] = useState<ReportKind>('term')
  const [filters, setFilters] = useState({ termId: '', classId: '', from: '', to: '' })

  const params = useMemo(
    () => ({
      termId: filters.termId || undefined,
      classId: filters.classId || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    }),
    [filters],
  )

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['report', kind, params],
    queryFn: () => get<unknown>(`/reports/${kind}`, params),
  })

  const exportCsv = async () => {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString()
    try {
      await downloadFile(`/reports/${kind}/export${query ? `?${query}` : ''}`, `conductnexus-${kind}-${new Date().toISOString().slice(0, 10)}.csv`)
      success('Report exported as CSV')
    } catch (err) {
      toastError(apiError(err))
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Insight"
        title="Reports & analytics"
        subtitle="Term, year-end, class, teacher and communication reporting with CSV export for leadership meetings and inspectors."
        actions={
          <Button variant="secondary" icon={Download} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />

      <Tabs<ReportKind> tabs={KINDS} active={kind} onChange={setKind} />

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Filter className="h-3.5 w-3.5" /> Filters
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Term">
            <Select value={filters.termId} onChange={(e) => setFilters({ ...filters, termId: e.target.value })}>
              <option value="">Active / all</option>
              {(structure?.terms ?? []).map((t) => (
                <option key={t._id} value={t._id}>{t.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Class">
            <Select value={filters.classId} onChange={(e) => setFilters({ ...filters, classId: e.target.value })}>
              <option value="">All classes</option>
              {(structure?.classes ?? []).map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </Field>
          <Field label="To">
            <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </Field>
        </div>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Running report…" />
      ) : isError ? (
        <Alert tone="danger" title="Could not run report">{apiError(error)}</Alert>
      ) : !data ? (
        <EmptyState icon={BarChart3} title="No data" message="No records matched the selected filters." />
      ) : (
        <div className="space-y-4">
          {kind === 'term' && <TermView report={data as TermReport} />}
          {kind === 'year-end' && <YearEndView report={data as YearEndReport} />}
          {kind === 'high-risk' && <HighRiskView report={data as HighRiskReport} />}
          {kind === 'class' && <ClassView report={data as ClassReport} />}
          {kind === 'teacher-activity' && <TeacherView report={data as TeacherReport} />}
          {kind === 'communication' && <CommunicationView report={data as CommunicationReport} />}
        </div>
      )}
    </div>
  )
}

function TermView({ report }: { report: TermReport }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Students" value={report.studentCount} icon={Users} tone="brand" hint={report.term ? `${report.term.name} · ${report.term.academicYear}` : 'All active students'} />
        <StatCard label="Incidents" value={report.totalIncidents} icon={ShieldAlert} tone="ochre" hint={`${report.pendingCases} still open`} />
        <StatCard label="Marks deducted" value={`−${report.totalDeductions}`} tone="red" hint={`+${report.totalRewards} rewarded`} />
        <StatCard label="High / critical" value={`${report.highRisk} / ${report.criticalRisk}`} tone="amber" hint={`${report.goodStanding} in good standing`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader icon={Users} title="Class performance" subtitle="Average conduct and incident volume by class" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Class</th>
                  <th className="px-4 py-2.5">Students</th>
                  <th className="px-4 py-2.5">Incidents</th>
                  <th className="px-4 py-2.5">Avg conduct</th>
                  <th className="px-4 py-2.5">At risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                {report.classStats.map((row) => (
                  <tr key={row.classId}>
                    <td className="px-4 py-2.5 font-medium">{row.name}</td>
                    <td className="px-4 py-2.5">{row.students}</td>
                    <td className="px-4 py-2.5">{row.incidents}</td>
                    <td className={`px-4 py-2.5 font-semibold ${balanceTone(row.averageBalance)}`}>{row.averageBalance}</td>
                    <td className="px-4 py-2.5">{(row.risk?.orange ?? 0) + (row.risk?.red ?? 0)}</td>
                  </tr>
                ))}
                {!report.classStats.length && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No class data for this period.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader icon={BarChart3} title="Top offences" subtitle="Most frequent rules broken in this period" />
          <div className="space-y-3 p-4">
            {report.offenceBreakdown.length ? (
              report.offenceBreakdown.map((row) => {
                const max = Math.max(...report.offenceBreakdown.map((r) => r.count), 1)
                return (
                  <div key={row.name}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{row.name}</span>
                      <span className="text-slate-500">{row.count} · −{row.marks} marks</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                      <div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-cyan-accent" style={{ width: `${(row.count / max) * 100}%` }} />
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="py-6 text-center text-sm text-slate-400">No offences recorded.</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="p-4 text-xs text-slate-500">
        Generated {formatDate(report.generatedAt, 'dd MMM yyyy · HH:mm')}. Deductions and rewards are drawn from the immutable conduct ledger.
      </Card>
    </>
  )
}

function YearEndView({ report }: { report: YearEndReport }) {
  if (!report.academicYear) return <EmptyState icon={FileSpreadsheet} title="No academic year" message="Set up an academic year in Structure to run a year-end report." />
  return (
    <>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-semibold">{report.academicYear.name}</p>
          <p className="text-xs text-slate-500">{formatDate(report.academicYear.startDate)} — {formatDate(report.academicYear.endDate)}</p>
        </div>
        <StatusBadge status={report.academicYear.status} />
      </Card>

      <Card>
        <CardHeader icon={BarChart3} title="Term comparison" subtitle="Incident volume, conduct and risk across the year" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5">Term</th>
                <th className="px-4 py-2.5">Incidents</th>
                <th className="px-4 py-2.5">Deductions</th>
                <th className="px-4 py-2.5">Rewards</th>
                <th className="px-4 py-2.5">Avg conduct</th>
                <th className="px-4 py-2.5">High risk</th>
                <th className="px-4 py-2.5">Critical</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
              {report.comparisons.map((row) => (
                <tr key={row.term}>
                  <td className="px-4 py-2.5 font-medium">{row.term}</td>
                  <td className="px-4 py-2.5">{row.incidents}</td>
                  <td className="px-4 py-2.5 text-red-600">−{row.deductions}</td>
                  <td className="px-4 py-2.5 text-emerald-600">+{row.rewards}</td>
                  <td className={`px-4 py-2.5 font-semibold ${balanceTone(row.averageConduct)}`}>{row.averageConduct}</td>
                  <td className="px-4 py-2.5">{row.highRisk}</td>
                  <td className="px-4 py-2.5">{row.critical}</td>
                </tr>
              ))}
              {!report.comparisons.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No terms for this academic year.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {[
          { title: 'Classes', rows: report.classComparisons ?? [] },
          { title: 'Streams', rows: report.streamComparisons ?? [] },
          { title: 'Dormitories', rows: report.dormitoryComparisons ?? [] },
        ].map((group) => (
          <Card key={group.title}>
            <CardHeader title={group.title} subtitle="Average conduct and high-risk count" />
            <ul className="divide-y divide-line text-sm dark:divide-[#1f2f49]">
              {group.rows.map((row) => (
                <li key={row.name} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span>
                    <span className="font-medium">{row.name}</span>
                    <span className="ml-1 text-xs text-slate-400">({row.students})</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs">
                    <span className={`font-semibold ${balanceTone(row.averageBalance)}`}>{row.averageBalance}</span>
                    <Badge tone="amber">{row.highRisk} at risk</Badge>
                  </span>
                </li>
              ))}
              {!group.rows.length && <li className="px-4 py-6 text-center text-slate-400">No data</li>}
            </ul>
          </Card>
        ))}
      </div>
    </>
  )
}

function HighRiskView({ report }: { report: HighRiskReport }) {
  return (
    <Card>
      <CardHeader icon={ShieldAlert} title="High-risk students" subtitle={`${report.total} students at high or critical risk`} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2.5">Student</th>
              <th className="px-4 py-2.5">Balance</th>
              <th className="px-4 py-2.5">Risk</th>
              <th className="px-4 py-2.5">Incidents</th>
              <th className="px-4 py-2.5">Last incident</th>
              <th className="px-4 py-2.5">Intervention</th>
              <th className="px-4 py-2.5">Follow-up</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
            {report.students.map((row) => (
              <tr key={row.studentId}>
                <td className="px-4 py-2.5">
                  <p className="font-medium">{row.name}</p>
                  <p className="text-xs text-slate-400">{row.admissionNumber}</p>
                </td>
                <td className={`px-4 py-2.5 font-semibold ${balanceTone(row.balance)}`}>{row.balance}</td>
                <td className="px-4 py-2.5"><RiskBadge risk={row.risk} /></td>
                <td className="px-4 py-2.5">{row.incidentCount}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{row.lastIncident ? formatDate(row.lastIncident) : '—'}</td>
                <td className="px-4 py-2.5 text-xs">{row.intervention ? `${row.intervention.title}${row.intervention.assignedTo ? ` · ${row.intervention.assignedTo}` : ''}` : '—'}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{row.nextFollowUp ? formatDate(row.nextFollowUp) : '—'}</td>
              </tr>
            ))}
            {!report.students.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No high-risk students 🎉</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function ClassView({ report }: { report: ClassReport }) {
  return (
    <Card>
      <CardHeader icon={Users} title="Class analysis" subtitle="Conduct, open cases and top offences by class" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2.5">Class</th>
              <th className="px-4 py-2.5">Students</th>
              <th className="px-4 py-2.5">Incidents</th>
              <th className="px-4 py-2.5">Avg conduct</th>
              <th className="px-4 py-2.5">Risk split (G/Y/O/R)</th>
              <th className="px-4 py-2.5">Outstanding</th>
              <th className="px-4 py-2.5">Top offences</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
            {report.classes.map((row) => (
              <tr key={row.classId}>
                <td className="px-4 py-2.5 font-medium">{row.class}</td>
                <td className="px-4 py-2.5">{row.students}</td>
                <td className="px-4 py-2.5">{row.incidents}</td>
                <td className={`px-4 py-2.5 font-semibold ${balanceTone(row.averageConduct)}`}>{row.averageConduct}</td>
                <td className="px-4 py-2.5 text-xs">{row.risk?.green ?? 0}/{row.risk?.yellow ?? 0}/{row.risk?.orange ?? 0}/{row.risk?.red ?? 0}</td>
                <td className="px-4 py-2.5">{row.outstandingCases}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{row.topOffences.map((o) => `${o.name} (${o.count})`).join(', ') || '—'}</td>
              </tr>
            ))}
            {!report.classes.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No classes configured.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function TeacherView({ report }: { report: TeacherReport }) {
  return (
    <Card>
      <CardHeader icon={Users} title="Teacher activity" subtitle="Incident submissions and approval outcomes by staff member" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2.5">Teacher</th>
              <th className="px-4 py-2.5">Submitted</th>
              <th className="px-4 py-2.5">Approved</th>
              <th className="px-4 py-2.5">Rejected</th>
              <th className="px-4 py-2.5">Pending</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
            {report.teachers.map((row) => (
              <tr key={row.email}>
                <td className="px-4 py-2.5">
                  <p className="font-medium">{row.name}</p>
                  <p className="text-xs text-slate-400">{row.email}</p>
                </td>
                <td className="px-4 py-2.5 font-semibold">{row.submitted}</td>
                <td className="px-4 py-2.5 text-emerald-600">{row.approved}</td>
                <td className="px-4 py-2.5 text-red-600">{row.rejected}</td>
                <td className="px-4 py-2.5 text-amber-600">{row.pending}</td>
              </tr>
            ))}
            {!report.teachers.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No incidents recorded for this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function CommunicationView({ report }: { report: CommunicationReport }) {
  const s = report.summary
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Queued" value={s.queued} tone="brand" />
        <StatCard label="Sent" value={s.sent} tone="emerald" />
        <StatCard label="Failed" value={s.failed} tone="red" />
        <StatCard label="Manual review" value={s.manualReview} tone="amber" />
        <StatCard label="Dead letter" value={s.deadLetter} tone="slate" />
      </div>
      <Card>
        <CardHeader icon={FileSpreadsheet} title="Recent messages" subtitle={`${report.total} messages in this period · ${Object.entries(report.byChannel).map(([k, v]) => `${titleCase(k)} ${v}`).join(' · ')}`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5">Recipient</th>
                <th className="px-4 py-2.5">Channel</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Attempts</th>
                <th className="px-4 py-2.5">Created</th>
                <th className="px-4 py-2.5">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
              {report.recent.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.to}</td>
                  <td className="px-4 py-2.5">{titleCase(row.channel)}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={row.status} /></td>
                  <td className="px-4 py-2.5">{row.attempts}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(row.createdAt)}</td>
                  <td className="max-w-[220px] truncate px-4 py-2.5 text-xs text-red-600">{row.lastError ?? '—'}</td>
                </tr>
              ))}
              {!report.recent.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No messages in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
