import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, ClipboardList, HeartHandshake, MessageSquare, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { get } from '../lib/api'
import { formatDate, formatDateTime, titleCase } from '../lib/utils'
import { refName } from '../lib/hooks'
import { Badge, Card, CardHeader, EmptyState, LoadingBlock, PageHeader, RiskBadge, StatCard, StatusBadge, Tabs } from '../components/ui'

type ProfileResponse = {
  student: {
    id: string
    fullName: string
    studentId: string
    admissionNumber: string
    gender: string
    dateOfBirth?: string
    status: string
    currentBalance: number
    riskLevel: string
    admissionDate?: string
    notes?: string
  }
  class?: { name?: string }
  stream?: { name?: string } | null
  dormitory?: { name?: string } | null
  guardians: { relationship?: string; isPrimary?: boolean; parentId?: { name?: string; phone?: string; email?: string; preferredChannel?: string; whatsappConsent?: boolean; smsConsent?: boolean; emailConsent?: boolean } }[]
  conduct: { startingMarks: number; totalDeductions: number; totalRewards: number; currentBalance: number; term?: { name?: string } }
  incidents: {
    _id: string
    incidentNumber: string
    offenceSnapshot?: { name?: string; deduction?: number }
    severity: string
    status: string
    occurredAt: string
    description: string
    reportedBy?: { name?: string } | string
  }[]
  assessments: { _id: string; riskLevel: string; score?: number; reason?: string; createdAt: string }[]
  interventions: { _id: string; type: string; title: string; status: string; startDate?: string; assignedTo?: { name?: string } | string }[]
  followUps: { _id: string; type: string; dueDate: string; status: string }[]
  recognitions: { _id: string; title: string; points?: number; awardedAt: string; notes?: string }[]
}

type TabKey = 'overview' | 'incidents' | 'interventions' | 'recognition'

export function StudentProfilePage() {
  const { id } = useParams()
  const { has } = useAuth()
  const [tab, setTab] = useState<TabKey>('overview')

  const { data, isLoading, error } = useQuery({
    queryKey: ['student-profile', id],
    queryFn: () => get<ProfileResponse>(`/students/${id}/profile`),
    enabled: Boolean(id),
  })

  if (isLoading) return <LoadingBlock label="Loading student profile…" />
  if (error || !data) {
    return (
      <EmptyState
        title="Student not available"
        message="You may not have permission to view this student, or the record no longer exists."
        action={
          <Link to="/students" className="link font-semibold">
            Back to students
          </Link>
        }
      />
    )
  }

  const s = data.student
  const conduct = data.conduct

  return (
    <div className="space-y-5">
      <Link to="/students" className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to students
      </Link>

      <PageHeader
        eyebrow={`${data.class?.name ?? 'Unplaced'}${data.stream?.name ? ` · ${data.stream.name}` : ''}${data.dormitory?.name ? ` · ${data.dormitory.name}` : ''}`}
        title={s.fullName}
        subtitle={`${s.studentId} · Admission ${s.admissionNumber} · ${titleCase(s.status)}`}
        actions={
          <>
            <RiskBadge risk={s.riskLevel} />
            {has('incidents.create') && (
              <Link
                to={`/incidents/new?studentId=${s.id}`}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-500 px-3.5 text-sm font-semibold text-white hover:bg-brand-600"
              >
                <ClipboardList className="h-4 w-4" /> Record incident
              </Link>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Current balance" value={s.currentBalance} icon={ShieldCheck} hint={`${conduct.term?.name ?? 'Term'} · starts at ${conduct.startingMarks}`} tone={s.currentBalance <= 25 ? 'red' : 'brand'} />
        <StatCard label="Total deductions" value={conduct.totalDeductions} icon={TrendingDown} tone="ochre" hint="Approved deductions this term" />
        <StatCard label="Rewards" value={conduct.totalRewards} icon={TrendingUp} tone="emerald" hint="Recognition points restored" />
        <StatCard label="Open follow-ups" value={data.followUps.length} icon={CalendarDays} tone="amber" hint="Care team actions pending" />
      </div>

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'incidents', label: 'Incidents', count: data.incidents.length },
          { key: 'interventions', label: 'Support', count: data.interventions.length },
          { key: 'recognition', label: 'Recognition', count: data.recognitions.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-5">
            <Card>
              <CardHeader title="Learner details" subtitle="Identity and placement" icon={ShieldCheck} />
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Gender</dt>
                  <dd className="mt-0.5 font-medium">{titleCase(s.gender)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Date of birth</dt>
                  <dd className="mt-0.5 font-medium">{formatDate(s.dateOfBirth)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Admitted</dt>
                  <dd className="mt-0.5 font-medium">{formatDate(s.admissionDate)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Class</dt>
                  <dd className="mt-0.5 font-medium">{data.class?.name ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Stream</dt>
                  <dd className="mt-0.5 font-medium">{data.stream?.name ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">Dormitory</dt>
                  <dd className="mt-0.5 font-medium">{data.dormitory?.name ?? 'Day student'}</dd>
                </div>
                {s.notes && (
                  <div className="col-span-2 sm:col-span-3">
                    <dt className="text-[11px] uppercase tracking-wider text-slate-400">Notes</dt>
                    <dd className="mt-0.5 text-slate-600 dark:text-slate-300">{s.notes}</dd>
                  </div>
                )}
              </dl>
            </Card>

            <Card>
              <CardHeader title="Guardians & consent" subtitle="Communication preferences are honoured automatically" icon={MessageSquare} />
              {data.guardians.length ? (
                <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                  {data.guardians.map((g, i) => (
                    <li key={i} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                      <div>
                        <p className="font-medium">
                          {g.parentId?.name ?? 'Guardian'}
                          {g.isPrimary && <Badge tone="brand" className="ml-2">Primary</Badge>}
                        </p>
                        <p className="text-xs text-slate-500">
                          {g.relationship ?? 'Guardian'} · {g.parentId?.phone ?? 'No phone'} {g.parentId?.email ? `· ${g.parentId.email}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={g.parentId?.whatsappConsent ? 'emerald' : 'slate'}>WhatsApp {g.parentId?.whatsappConsent ? 'yes' : 'no'}</Badge>
                        <Badge tone={g.parentId?.smsConsent ? 'emerald' : 'slate'}>SMS {g.parentId?.smsConsent ? 'yes' : 'no'}</Badge>
                        <Badge tone={g.parentId?.emailConsent ? 'emerald' : 'slate'}>Email {g.parentId?.emailConsent ? 'yes' : 'no'}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No guardian linked" message="Link a guardian so parent communication can be delivered." />
              )}
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Risk assessments" subtitle="Most recent determinations" icon={HeartHandshake} />
              {data.assessments.length ? (
                <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                  {data.assessments.slice(0, 6).map((a) => (
                    <li key={a._id} className="flex items-start justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="text-sm">{a.reason ?? 'Recalculated from conduct signals'}</p>
                        <p className="text-xs text-slate-400">{formatDateTime(a.createdAt)}</p>
                      </div>
                      <RiskBadge risk={a.riskLevel} />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No assessments yet" message="Risk is recalculated as conduct transactions are approved." />
              )}
            </Card>

            <Card>
              <CardHeader title="Pending follow-ups" subtitle="Care team commitments" icon={CalendarDays} />
              {data.followUps.length ? (
                <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                  {data.followUps.map((f) => (
                    <li key={f._id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <span>{titleCase(f.type)}</span>
                      <span className="text-xs text-slate-400">Due {formatDate(f.dueDate)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nothing pending" message="Follow-ups will appear here when scheduled." />
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === 'incidents' && (
        <Card>
          <CardHeader title="Incident history" subtitle="Latest 20 recorded conduct events" icon={ClipboardList} />
          {data.incidents.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                    <th className="px-5 py-2.5 font-semibold">Incident</th>
                    <th className="px-3 py-2.5 font-semibold">Offence</th>
                    <th className="px-3 py-2.5 font-semibold">Severity</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Reported by</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.incidents.map((incident) => (
                    <tr key={incident._id} className="row-hover border-b border-line/60 last:border-0 dark:border-[#1f2f49]">
                      <td className="px-5 py-3">
                        <Link to={`/incidents/${incident._id}`} className="font-medium hover:text-brand-600">
                          {incident.incidentNumber}
                        </Link>
                        <p className="max-w-xs truncate text-xs text-slate-400">{incident.description}</p>
                      </td>
                      <td className="px-3 py-3">
                        {incident.offenceSnapshot?.name}
                        <span className="ml-1 font-mono text-xs text-risk-red">−{incident.offenceSnapshot?.deduction}</span>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={incident.severity === 'critical' ? 'red' : incident.severity === 'serious' ? 'orange' : 'slate'}>{titleCase(incident.severity)}</Badge>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={incident.status} />
                      </td>
                      <td className="px-3 py-3 text-slate-500">{refName(incident.reportedBy)}</td>
                      <td className="px-5 py-3 text-right text-xs text-slate-400">{formatDate(incident.occurredAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No incidents recorded" message="This student has no conduct events this year." icon={ShieldCheck} />
          )}
        </Card>
      )}

      {tab === 'interventions' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Support plans" subtitle="Interventions and mentoring" icon={HeartHandshake} />
            {data.interventions.length ? (
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {data.interventions.map((intervention) => (
                  <li key={intervention._id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{intervention.title}</p>
                        <p className="text-xs text-slate-500">
                          {titleCase(intervention.type)} · {refName(intervention.assignedTo)} · started {formatDate(intervention.startDate)}
                        </p>
                      </div>
                      <StatusBadge status={intervention.status} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No support plans" message="Create an intervention from the Risk & support page." />
            )}
          </Card>
          <Card>
            <CardHeader title="Follow-ups" subtitle="Behaviour checks and meetings" icon={CalendarDays} />
            {data.followUps.length ? (
              <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
                {data.followUps.map((f) => (
                  <li key={f._id} className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm">{titleCase(f.type)}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Due {formatDate(f.dueDate)}</span>
                      <StatusBadge status={f.status} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No open follow-ups" message="Follow-ups become visible here once scheduled." />
            )}
          </Card>
        </div>
      )}

      {tab === 'recognition' && (
        <Card>
          <CardHeader title="Recognition & rewards" subtitle="Positive conduct entries" icon={TrendingUp} />
          {data.recognitions.length ? (
            <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
              {data.recognitions.map((r) => (
                <li key={r._id} className="flex items-start justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="font-medium">{r.title}</p>
                    <p className="text-xs text-slate-400">{formatDate(r.awardedAt)}</p>
                    {r.notes && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{r.notes}</p>}
                  </div>
                  {typeof r.points === 'number' && <Badge tone="emerald">+{r.points} marks</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No recognition yet" message="Recognition entries celebrate improvement and positive conduct." icon={TrendingUp} />
          )}
        </Card>
      )}
    </div>
  )
}
