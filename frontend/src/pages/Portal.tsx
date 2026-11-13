import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Award, Bell, CalendarDays, FileText, GraduationCap, HeartHandshake, Lock, Mail, Phone, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, patch, post } from '../lib/api'
import { formatDate, formatDateTime, titleCase } from '../lib/utils'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  LoadingBlock,
  Modal,
  PageHeader,
  RiskBadge,
  Select,
  StatCard,
  StatusBadge,
  Tabs,
  Textarea,
  Toggle,
} from '../components/ui'
import { useToast } from '../components/toast'

type Child = {
  id: string
  fullName: string
  admissionNumber: string
  className: string
  dormitory: string
  balance: number
  risk: string
  status: string
  relationship: string
  primary: boolean
}

type ChildDetail = {
  student: { id: string; fullName: string; admissionNumber: string; gender: string; className: string; level: string; dormitory: string; status: string; balance: number; risk: string }
  conduct: {
    startingMarks: number
    totalDeductions: number
    totalRewards: number
    balance: number
    transactions: { id: string; type: string; change: number; newBalance: number; reason: string; at: string }[]
  }
  incidents: { id: string; reference: string; offence: string; description: string; occurredAt: string; status: string; deduction?: number }[]
  letters: { _id: string; reference: string; type: string; subject: string; issuedAt?: string }[]
  meetings: { _id: string; reference: string; title: string; scheduledAt: string; location?: string; type: string }[]
  recognition: { _id: string; title: string; description?: string; points?: number; awardedAt: string }[]
  riskHistory: { _id: string; riskLevel: string; createdAt: string; reasons?: string[] }[]
}

type Consent = { whatsappConsent: boolean; smsConsent: boolean; emailConsent: boolean; preferredChannel: 'whatsapp' | 'sms' | 'email' }
type TabKey = 'overview' | 'conduct' | 'communication' | 'consent'

export function PortalPage() {
  const { me } = useAuth()
  const queryClient = useQueryClient()
  const { success, error: toastError } = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [dataRequestOpen, setDataRequestOpen] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['portal-children'],
    queryFn: () => get<{ parent: { name: string; phone?: string; email?: string }; children: Child[] }>('/portal/children'),
  })

  const children = data?.children ?? []
  const activeId = selectedId ?? children[0]?.id ?? null
  const active = children.find((c) => c.id === activeId)

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['portal-child', activeId],
    queryFn: () => get<ChildDetail>(`/portal/children/${activeId}`),
    enabled: Boolean(activeId),
  })

  if (isError) {
    return (
      <div className="surface mx-auto max-w-xl p-8 text-center">
        <ShieldCheck className="mx-auto h-10 w-10 text-ochre-500" />
        <h1 className="mt-3 text-xl font-semibold">Parent portal</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {apiError(error)} Staff accounts can review a learner's full record from the student register, while this portal is reserved for linked guardians.
        </p>
      </div>
    )
  }

  if (isLoading) return <LoadingBlock label="Loading your family portal…" />

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Parent portal"
        title={`Muraho, ${data?.parent.name?.split(' ')[0] ?? me?.user.name?.split(' ')[0] ?? 'Parent'}`}
        subtitle="Follow your child's conduct, receive school letters and manage how the school contacts you."
        actions={
          <Button variant="secondary" icon={Lock} onClick={() => setDataRequestOpen(true)}>
            Data request
          </Button>
        }
      />

      {!children.length ? (
        <Card><EmptyState icon={GraduationCap} title="No linked children" message="Ask the school office to link your account to your child's guardian record." /></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => setSelectedId(child.id)}
                className={`surface p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lift ${child.id === activeId ? 'ring-2 ring-brand-500' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{child.fullName}</p>
                    <p className="text-xs text-slate-400">{child.admissionNumber} · {child.className}</p>
                  </div>
                  <RiskBadge risk={child.risk} />
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Conduct marks</p>
                    <p className={`text-2xl font-semibold ${child.balance >= 32 ? 'text-emerald-600' : child.balance >= 25 ? 'text-amber-600' : 'text-red-600'}`}>{child.balance}</p>
                  </div>
                  <Badge tone={child.primary ? 'brand' : 'slate'}>{child.primary ? 'Primary guardian' : titleCase(child.relationship)}</Badge>
                </div>
              </button>
            ))}
          </div>

          {active && (
            <>
              <Tabs<TabKey>
                active={tab}
                onChange={setTab}
                tabs={[
                  { key: 'overview', label: 'Overview' },
                  { key: 'conduct', label: 'Conduct history' },
                  { key: 'communication', label: 'Letters & meetings' },
                  { key: 'consent', label: 'Contact preferences' },
                ]}
              />

              {tab === 'overview' && (
                detailLoading || !detail ? (
                  <LoadingBlock />
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <StatCard label="Current balance" value={detail.conduct.balance} icon={TrendingUp} tone={detail.conduct.balance >= 32 ? 'emerald' : detail.conduct.balance >= 25 ? 'amber' : 'red'} hint={`Started at ${detail.conduct.startingMarks}`} />
                      <StatCard label="Deducted" value={`−${detail.conduct.totalDeductions}`} icon={ShieldCheck} tone="ochre" hint="This term" />
                      <StatCard label="Rewarded" value={`+${detail.conduct.totalRewards}`} icon={Sparkles} tone="emerald" hint="Recognition points" />
                      <StatCard label="Risk level" value={titleCase(detail.student.risk === 'orange' ? 'high' : detail.student.risk === 'red' ? 'critical' : detail.student.risk)} icon={HeartHandshake} tone="brand" hint={detail.student.className + (detail.student.dormitory ? ` · ${detail.student.dormitory}` : '')} />
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Card>
                        <CardHeader icon={Award} title="Recent recognition" subtitle="Positive behaviour noticed by staff" />
                        {detail.recognition.length ? (
                          <ul className="divide-y divide-line text-sm dark:divide-[#1f2f49]">
                            {detail.recognition.map((r) => (
                              <li key={r._id} className="px-4 py-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="font-medium">{r.title}</p>
                                  <Badge tone="emerald">+{r.points ?? 0}</Badge>
                                </div>
                                <p className="text-xs text-slate-500">{r.description ?? formatDate(r.awardedAt)}</p>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <EmptyState title="No recognition yet" message="Teachers can award positive points for effort, kindness and leadership." />
                        )}
                      </Card>

                      <Card>
                        <CardHeader icon={CalendarDays} title="Upcoming meetings" subtitle="Invitations from the school" />
                        {detail.meetings.length ? (
                          <ul className="divide-y divide-line text-sm dark:divide-[#1f2f49]">
                            {detail.meetings.map((m) => (
                              <li key={m._id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                                <div>
                                  <p className="font-medium">{m.title}</p>
                                  <p className="text-xs text-slate-500">{formatDateTime(m.scheduledAt)}{m.location ? ` · ${m.location}` : ''}</p>
                                </div>
                                <Badge tone="brand">{titleCase(m.type)}</Badge>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <EmptyState title="No meetings scheduled" message="Parent meetings and hearings will appear here." />
                        )}
                      </Card>
                    </div>

                    <Card>
                      <CardHeader icon={FileText} title="Recent incidents" subtitle="Only finalised outcomes are visible in the portal" />
                      {detail.incidents.length ? (
                        <ul className="divide-y divide-line text-sm dark:divide-[#1f2f49]">
                          {detail.incidents.slice(0, 6).map((incident) => (
                            <li key={incident.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                              <div>
                                <p className="font-medium">{incident.offence}</p>
                                <p className="mt-0.5 max-w-2xl text-xs text-slate-500">{incident.description}</p>
                                <p className="mt-1 text-[11px] text-slate-400">{incident.reference} · {formatDateTime(incident.occurredAt)}</p>
                              </div>
                              <div className="text-right">
                                <StatusBadge status={incident.status} />
                                {typeof incident.deduction === 'number' && <p className="mt-1 text-xs font-semibold text-red-600">−{incident.deduction} marks</p>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <EmptyState title="No conduct incidents" message="No finalised incidents have been recorded this term." />
                      )}
                    </Card>
                  </div>
                )
              )}

              {tab === 'conduct' && (
                detailLoading || !detail ? (
                  <LoadingBlock />
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-4">
                      <StatCard label="Starting marks" value={detail.conduct.startingMarks} tone="slate" />
                      <StatCard label="Deducted" value={`−${detail.conduct.totalDeductions}`} tone="red" />
                      <StatCard label="Rewarded" value={`+${detail.conduct.totalRewards}`} tone="emerald" />
                      <StatCard label="Balance" value={detail.conduct.balance} tone="brand" />
                    </div>
                    <Card className="overflow-hidden">
                      <CardHeader icon={TrendingUp} title="Conduct ledger" subtitle="Every change to your child's marks, newest first" />
                      {detail.conduct.transactions.length ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                              <tr>
                                <th className="px-4 py-3">Date</th>
                                <th className="px-4 py-3">Reason</th>
                                <th className="px-4 py-3">Type</th>
                                <th className="px-4 py-3 text-right">Change</th>
                                <th className="px-4 py-3 text-right">Balance</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                              {detail.conduct.transactions.map((tx) => (
                                <tr key={tx.id}>
                                  <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(tx.at)}</td>
                                  <td className="px-4 py-2.5">{tx.reason}</td>
                                  <td className="px-4 py-2.5"><Badge tone="slate">{titleCase(tx.type)}</Badge></td>
                                  <td className={`px-4 py-2.5 text-right font-semibold ${tx.change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{tx.change >= 0 ? '+' : ''}{tx.change}</td>
                                  <td className="px-4 py-2.5 text-right">{tx.newBalance}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <EmptyState title="No conduct transactions" message="No marks have changed this term." />
                      )}
                    </Card>
                    <Card>
                      <CardHeader icon={TrendingUp} title="Risk assessments" subtitle="How the school has assessed support needs" />
                      {detail.riskHistory.length ? (
                        <ul className="divide-y divide-line text-sm dark:divide-[#1f2f49]">
                          {detail.riskHistory.map((r) => (
                            <li key={r._id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                              <div>
                                <RiskBadge risk={r.riskLevel} />
                                {r.reasons?.length ? <p className="mt-1 text-xs text-slate-500">{r.reasons.join(' · ')}</p> : null}
                              </div>
                              <span className="text-xs text-slate-400">{formatDate(r.createdAt)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <EmptyState title="No risk assessments" message="Assessments appear when the school reviews support needs." />}
                    </Card>
                  </div>
                )
              )}

              {tab === 'communication' && (
                detailLoading || !detail ? (
                  <LoadingBlock />
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardHeader icon={FileText} title="Issued letters" subtitle="Official communications from the school" />
                      {detail.letters.length ? (
                        <ul className="divide-y divide-line text-sm dark:divide-[#1f2f49]">
                          {detail.letters.map((letter) => (
                            <li key={letter._id} className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge tone="ochre">{titleCase(letter.type)}</Badge>
                                <span className="font-mono text-[11px] text-slate-400">{letter.reference}</span>
                              </div>
                              <p className="mt-1 font-medium">{letter.subject}</p>
                              <p className="text-xs text-slate-500">Issued {letter.issuedAt ? formatDate(letter.issuedAt) : '—'}</p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <EmptyState icon={FileText} title="No letters" message="Official letters issued by the school will be listed here." />
                      )}
                    </Card>

                    <Card>
                      <CardHeader icon={CalendarDays} title="Meetings & invitations" subtitle="Scheduled conversations with the school" />
                      {detail.meetings.length ? (
                        <ul className="divide-y divide-line text-sm dark:divide-[#1f2f49]">
                          {detail.meetings.map((m) => (
                            <li key={m._id} className="px-4 py-3">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-medium">{m.title}</p>
                                <Badge tone="brand">{titleCase(m.type)}</Badge>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">{formatDateTime(m.scheduledAt)}{m.location ? ` · ${m.location}` : ''}</p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <EmptyState icon={CalendarDays} title="No meetings" message="You have no upcoming meetings with the school." />
                      )}
                    </Card>
                  </div>
                )
              )}

              {tab === 'consent' && <ConsentTab />}
            </>
          )}
        </>
      )}

      {dataRequestOpen && <DataRequestModal open onClose={() => setDataRequestOpen(false)} childrenList={children} />}
    </div>
  )
}

function ConsentTab() {
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: ['portal-consent'], queryFn: () => get<Consent>('/portal/consent') })
  const [form, setForm] = useState<Consent | null>(null)
  const state = form ?? data ?? null

  const save = useMutation({
    mutationFn: () => patch<Consent>('/portal/consent', state),
    onSuccess: () => {
      success('Contact preferences saved')
      setForm(null)
      queryClient.invalidateQueries({ queryKey: ['portal-consent'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  if (!state) return <LoadingBlock />

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader icon={Bell} title="How may the school contact you?" subtitle="You can change these permissions at any time" />
        <div className="space-y-3 p-4">
          {[
            { key: 'whatsappConsent' as const, label: 'WhatsApp messages', icon: Bell, hint: 'Conduct updates, meeting invitations and reminders.' },
            { key: 'smsConsent' as const, label: 'SMS messages', icon: Phone, hint: 'Used when WhatsApp is unavailable.' },
            { key: 'emailConsent' as const, label: 'Email', icon: Mail, hint: 'Letters, reports and formal notices.' },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-4 rounded-lg border border-line p-3 dark:border-[#1f2f49]">
              <div className="flex items-start gap-3">
                <item.icon className="mt-0.5 h-4 w-4 text-slate-400" />
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-slate-500">{item.hint}</p>
                </div>
              </div>
              <Toggle
                checked={state[item.key]}
                onChange={(v) => setForm({ ...state, [item.key]: v })}
                label={item.label}
              />
            </div>
          ))}
          <Field label="Preferred channel">
            <Select
              value={state.preferredChannel}
              onChange={(e) => setForm({ ...state, preferredChannel: e.target.value as Consent['preferredChannel'] })}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </Select>
          </Field>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save preferences</Button>
        </div>
      </Card>

      <Card>
        <CardHeader icon={ShieldCheck} title="Your data rights" subtitle="Protected under Rwanda's data protection law" />
        <div className="space-y-2 p-4 text-sm text-slate-600 dark:text-slate-300">
          <p><span className="font-semibold">Access</span> — request a copy of the personal data the school holds about your child.</p>
          <p><span className="font-semibold">Correction</span> — ask for inaccurate information to be fixed.</p>
          <p><span className="font-semibold">Objection</span> — object to non-essential processing.</p>
          <p><span className="font-semibold">Erasure</span> — ask for deletion where the law does not require retention.</p>
          <p className="pt-2 text-xs text-slate-400">Use the Data request button at the top of the page. The school responds within 30 days.</p>
        </div>
      </Card>
    </div>
  )
}

function DataRequestModal({ open, onClose, childrenList }: { open: boolean; onClose: () => void; childrenList: Child[] }) {
  const { success, error: toastError } = useToast()
  const [form, setForm] = useState({ type: 'access', studentId: childrenList[0]?.id ?? '', details: '' })

  const create = useMutation({
    mutationFn: () => post<{ requestNumber: string }>('/portal/data-requests', { ...form, studentId: form.studentId || undefined }),
    onSuccess: (result) => {
      success(`Request ${result.requestNumber} submitted — the school will respond within 30 days`)
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Submit a data request"
      subtitle="The school will acknowledge and respond within 30 days."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={form.details.trim().length < 10} onClick={() => create.mutate()}>Submit request</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Request type">
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="access">Access — copy of my child's data</option>
            <option value="correction">Correction — fix inaccurate data</option>
            <option value="objection">Objection — restrict processing</option>
            <option value="erasure">Erasure — delete where lawful</option>
          </Select>
        </Field>
        <Field label="Child">
          <Select value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}>
            {childrenList.map((c) => <option key={c.id} value={c.id}>{c.fullName} · {c.className}</option>)}
          </Select>
        </Field>
        <Field label="What would you like the school to do?" required>
          <Textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} className="min-h-[120px]" />
        </Field>
        <Alert tone="info">Certain education and safeguarding records must be retained by law; the school will explain any limitation in its response.</Alert>
      </div>
    </Modal>
  )
}
