import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FileSearch, FolderSearch, Plus, Scale, Search, UserRound } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, getPage, post } from '../lib/api'
import { refName, useStaff } from '../lib/hooks'
import { formatDate, formatDateTime, titleCase } from '../lib/utils'
import { StudentPicker, type PickedStudent } from '../components/StudentPicker'
import { Alert, Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, Select, StatusBadge, Textarea } from '../components/ui'
import { useToast } from '../components/toast'

type InvestigationRow = {
  _id: string
  caseNumber: string
  title: string
  type: string
  status: string
  deadline?: string
  createdAt: string
  studentId?: { fullName?: string; studentId?: string } | string
  assignedTo?: { name?: string } | string
  createdBy?: { name?: string } | string
}

type InvestigationDetail = InvestigationRow & {
  findings?: string
  recommendations?: string
  decision?: { outcome: string; notes?: string; decidedAt?: string; approvedBy?: { name?: string } | string }
  timeline: { at: string; type: string; content: string; by?: { name?: string } | string; visibility?: string }[]
  witnesses: { name: string; contact?: string; statement?: string; recordedAt?: string }[]
  studentStatement?: { content: string; recordedAt?: string }
  incidentIds?: { _id: string; incidentNumber: string; offenceSnapshot?: { name?: string } }[]
}

export function InvestigationsPage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panel, setPanel] = useState<'timeline' | 'evidence' | 'findings' | 'decision'>('timeline')
  const [entry, setEntry] = useState('')
  const [finding, setFinding] = useState('')
  const [recommendation, setRecommendation] = useState('')
  const [outcome, setOutcome] = useState('')
  const [decisionNotes, setDecisionNotes] = useState('')

  const { data: staff } = useStaff(has('investigations.assign'))
  const { data, isLoading } = useQuery({
    queryKey: ['investigations', status, q],
    queryFn: () => getPage<InvestigationRow>('/investigations', { pageSize: 40, status: status || undefined, q: q || undefined }),
  })
  const { data: detail } = useQuery({
    queryKey: ['investigation', selectedId],
    queryFn: () => get<InvestigationDetail>(`/investigations/${selectedId}`),
    enabled: Boolean(selectedId),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['investigations'] })
    queryClient.invalidateQueries({ queryKey: ['investigation'] })
  }

  const addEntry = useMutation({
    mutationFn: () => post(`/investigations/${selectedId}/timeline`, { type: 'note', content: entry }),
    onSuccess: () => {
      success('Timeline entry recorded')
      setEntry('')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const saveFindings = useMutation({
    mutationFn: () => post(`/investigations/${selectedId}/findings`, { findings: finding, recommendations: recommendation || undefined }),
    onSuccess: () => {
      success('Findings recorded')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const recordDecision = useMutation({
    mutationFn: () => post(`/investigations/${selectedId}/decision`, { outcome, notes: decisionNotes || undefined }),
    onSuccess: () => {
      success('Decision recorded. The investigator cannot approve their own findings.')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const closeCase = useMutation({
    mutationFn: () => post(`/investigations/${selectedId}/close`, { note: decisionNotes || 'Investigation concluded' }),
    onSuccess: () => {
      success('Investigation closed')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const investigations = data?.items ?? []
  const isAssignee = detail && typeof detail.assignedTo === 'object' && detail.assignedTo?.name

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Case management"
        title="Investigations"
        subtitle="Structured case files with timelines, witnesses, statements and independent decisions."
        actions={
          has('investigations.create') && (
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>
              Open investigation
            </Button>
          )
        }
      />

      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search case number or title…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-52">
            <option value="">All statuses</option>
            <option value="opened">Opened</option>
            <option value="investigating">Investigating</option>
            <option value="findings">Findings</option>
            <option value="decision">Decision</option>
            <option value="closed">Closed</option>
          </Select>
        </div>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading investigations…" />
      ) : investigations.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {investigations.map((inv) => (
            <Card key={inv._id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[11px] text-slate-400">{inv.caseNumber}</span>
                <StatusBadge status={inv.status} />
              </div>
              <p className="mt-2 font-display text-base font-semibold">{inv.title}</p>
              <p className="mt-1 text-xs text-slate-500">
                {typeof inv.studentId === 'object' ? inv.studentId?.fullName ?? 'Student' : 'Student'} · {titleCase(inv.type)}
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                <UserRound className="h-3.5 w-3.5" /> {refName(inv.assignedTo, 'Unassigned')}
              </div>
              <p className="mt-1 text-xs text-slate-400">Deadline {formatDate(inv.deadline)}</p>
              <Button size="sm" variant="secondary" className="mt-4" icon={FolderSearch} onClick={() => { setSelectedId(inv._id); setPanel('timeline') }}>
                Open case file
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No investigations" message="Open a case when an incident needs deeper fact-finding." icon={FileSearch} />
      )}

      <CreateInvestigationModal open={createOpen} onClose={() => setCreateOpen(false)} staff={staff ?? []} onSaved={refresh} />

      <Modal open={Boolean(selectedId)} onClose={() => setSelectedId(null)} title={detail ? `${detail.caseNumber} · ${detail.title}` : 'Investigation'} subtitle="Case file" size="xl">
        {!detail ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              <Badge tone="brand">{titleCase(detail.type)}</Badge>
              <Badge tone="slate">Deadline {formatDate(detail.deadline)}</Badge>
              <Badge tone="slate">{refName(detail.assignedTo, 'Unassigned')}</Badge>
            </div>

            <div className="flex flex-wrap gap-1.5 border-b border-line pb-3 dark:border-[#26374f]">
              {(['timeline', 'evidence', 'findings', 'decision'] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => setPanel(key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${panel === key ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300'}`}
                >
                  {titleCase(key)}
                </button>
              ))}
            </div>

            {panel === 'timeline' && (
              <div className="space-y-4">
                <ol className="relative space-y-3 pl-5">
                  <span className="absolute bottom-2 left-[7px] top-2 w-px bg-line dark:bg-[#26374f]" aria-hidden />
                  {detail.timeline.map((t, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[17px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" />
                      <p className="text-sm font-medium">{titleCase(t.type)}</p>
                      <p className="text-sm text-slate-600 dark:text-slate-300">{t.content}</p>
                      <p className="text-[11px] text-slate-400">
                        {formatDateTime(t.at)} · {refName(t.by, 'System')} · {titleCase(t.visibility ?? 'case_team')}
                      </p>
                    </li>
                  ))}
                </ol>
                {has('investigations.evidence') && detail.status !== 'closed' && (
                  <div className="flex flex-col gap-2 rounded-lg border border-line p-3 dark:border-[#26374f] sm:flex-row">
                    <Input value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="Add a case note…" className="flex-1" />
                    <Button size="sm" loading={addEntry.isPending} disabled={entry.trim().length < 2} onClick={() => addEntry.mutate()}>
                      Add entry
                    </Button>
                  </div>
                )}
              </div>
            )}

            {panel === 'evidence' && (
              <div className="space-y-4">
                {detail.studentStatement ? (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-400">Student statement</p>
                    <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 dark:bg-[#0c1524]">{detail.studentStatement.content}</p>
                  </div>
                ) : (
                  <p className="text-slate-400">No student statement recorded.</p>
                )}
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-400">Witnesses ({detail.witnesses.length})</p>
                  {detail.witnesses.length ? (
                    <ul className="mt-1 divide-y divide-line/70 dark:divide-[#1f2f49]">
                      {detail.witnesses.map((w, i) => (
                        <li key={i} className="py-2">
                          <p className="font-medium">{w.name}</p>
                          {w.statement && <p className="text-slate-600 dark:text-slate-300">{w.statement}</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-slate-400">No witnesses recorded yet.</p>
                  )}
                </div>
                {detail.incidentIds?.length ? (
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-400">Linked incidents</p>
                    <ul className="mt-1 space-y-1">
                      {detail.incidentIds.map((inc) => (
                        <li key={inc._id} className="font-mono text-xs text-slate-500">{inc.incidentNumber} · {inc.offenceSnapshot?.name}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}

            {panel === 'findings' && (
              <div className="space-y-3">
                {detail.findings ? (
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-[#0c1524]">
                    <p className="text-[11px] uppercase tracking-wider text-slate-400">Findings</p>
                    <p className="mt-1 whitespace-pre-wrap">{detail.findings}</p>
                    {detail.recommendations && (
                      <>
                        <p className="mt-3 text-[11px] uppercase tracking-wider text-slate-400">Recommendations</p>
                        <p className="mt-1 whitespace-pre-wrap">{detail.recommendations}</p>
                      </>
                    )}
                  </div>
                ) : has('investigations.evidence') ? (
                  <>
                    <Field label="Findings" required>
                      <Textarea value={finding} onChange={(e) => setFinding(e.target.value)} placeholder="What did the investigation establish?" className="min-h-[110px]" />
                    </Field>
                    <Field label="Recommendations">
                      <Textarea value={recommendation} onChange={(e) => setRecommendation(e.target.value)} />
                    </Field>
                    <Button size="sm" loading={saveFindings.isPending} disabled={finding.trim().length < 5} onClick={() => saveFindings.mutate()}>
                      Save findings
                    </Button>
                  </>
                ) : (
                  <p className="text-slate-400">Findings have not been recorded yet.</p>
                )}
              </div>
            )}

            {panel === 'decision' && (
              <div className="space-y-3">
                {detail.decision ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge tone="emerald"><CheckCircle2 className="h-3 w-3" /> Decision recorded</Badge>
                      <span className="text-xs text-slate-400">{formatDateTime(detail.decision.decidedAt)} · {refName(detail.decision.approvedBy)}</span>
                    </div>
                    <p className="rounded-lg bg-slate-50 p-3 dark:bg-[#0c1524]">{detail.decision.outcome}</p>
                    {detail.decision.notes && <p className="text-slate-600 dark:text-slate-300">{detail.decision.notes}</p>}
                    {detail.status !== 'closed' && has('investigations.close') && (
                      <Button size="sm" variant="secondary" loading={closeCase.isPending} onClick={() => closeCase.mutate()}>
                        Close investigation
                      </Button>
                    )}
                  </div>
                ) : has('investigations.decide') ? (
                  <>
                    {isAssignee && (
                      <Alert tone="warning" title="Independent decision required">
                        You are the assigned investigator, so a different authorised officer must approve the final decision.
                      </Alert>
                    )}
                    <Field label="Decision outcome" required>
                      <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Outcome of the case and action to be taken…" className="min-h-[110px]" />
                    </Field>
                    <Field label="Decision notes">
                      <Textarea value={decisionNotes} onChange={(e) => setDecisionNotes(e.target.value)} />
                    </Field>
                    <Button size="sm" loading={recordDecision.isPending} disabled={outcome.trim().length < 3 || Boolean(isAssignee)} onClick={() => recordDecision.mutate()} icon={Scale}>
                      Record decision
                    </Button>
                  </>
                ) : (
                  <p className="text-slate-400">No decision has been recorded. An authorised decision-maker must approve findings.</p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function CreateInvestigationModal({
  open,
  onClose,
  staff,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  staff: { id: string; name: string; position?: string }[]
  onSaved: () => void
}) {
  const { success, error: toastError } = useToast()
  const [student, setStudent] = useState<PickedStudent | null>(null)
  const [form, setForm] = useState({ title: '', type: 'misconduct', assignedTo: '', deadline: '' })

  const create = useMutation({
    mutationFn: () =>
      post('/investigations', {
        studentId: student?.id,
        title: form.title,
        type: form.type,
        assignedTo: form.assignedTo || undefined,
        deadline: form.deadline || undefined,
      }),
    onSuccess: () => {
      success('Investigation opened')
      setStudent(null)
      setForm({ title: '', type: 'misconduct', assignedTo: '', deadline: '' })
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Open an investigation"
      subtitle="Assign an investigator and keep the evidence trail intact."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={!student || form.title.trim().length < 5} onClick={() => create.mutate()}>
            Open case
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Student" required>
          <StudentPicker value={student} onChange={setStudent} />
        </Field>
        <Field label="Case title" required>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Alleged theft in Dormitory B" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Case type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="misconduct">Misconduct</option>
              <option value="serious_incident">Serious incident</option>
              <option value="safeguarding_linked">Safeguarding linked</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Investigator">
            <Select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
              <option value="">Assign later</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Deadline">
          <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}
