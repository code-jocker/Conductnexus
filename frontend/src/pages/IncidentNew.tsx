import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, CheckCircle2, CloudOff, FileText, MapPin, Paperclip, Search, Send, ShieldAlert, Trash2, UserRound, X } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '../components/ui'
import { api, apiError, get, getPage, post } from '../lib/api'
import { useOffences, useStudentSearch } from '../lib/hooks'
import { newLocalId, saveOfflineDraft } from '../lib/offline'
import { useToast } from '../components/toast'
import type { Incident, Offence, Student } from '../lib/types'
import { humanBytes, titleCase } from '../lib/utils'

function nowLocalInput() {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

type StudentDetail = { id: string; fullName: string; studentId: string; className?: string; currentBalance?: number }
type SelectedStudent = { id: string; name: string; ref?: string; balance?: number; className?: string }

export function IncidentNewPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { success, error: toastError, info } = useToast()
  const presetId = params.get('studentId') ?? ''

  const [students, setStudents] = useState<SelectedStudent[]>([])
  const [studentQuery, setStudentQuery] = useState('')
  const [offenceId, setOffenceId] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [occurredAt, setOccurredAt] = useState(nowLocalInput)
  const [safeguarding, setSafeguarding] = useState(false)
  const [witnessName, setWitnessName] = useState('')
  const [witnessStatement, setWitnessStatement] = useState('')
  const [immediateAction, setImmediateAction] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: offences } = useOffences()
  const { data: results } = useStudentSearch(studentQuery, studentQuery.length >= 2)

  const { data: duplicates } = useQuery({
    queryKey: ['incident-duplicates', students.map((s) => s.id).join(','), offenceId],
    enabled: students.length > 0 && Boolean(offenceId),
    queryFn: async () => {
      const since = new Date()
      since.setDate(since.getDate() - 30)
      const matches: { studentName: string; incidentNumber: string; occurredAt: string; status: string }[] = []
      for (const student of students) {
        const { items } = await getPage<Incident>('/incidents', {
          studentId: student.id,
          offenceId,
          from: since.toISOString().slice(0, 10),
          pageSize: 5,
        })
        for (const item of items) {
          matches.push({ studentName: student.name, incidentNumber: item.incidentNumber, occurredAt: item.occurredAt, status: item.status })
        }
      }
      return matches
    },
  })

  useEffect(() => {
    if (!presetId || students.some((s) => s.id === presetId)) return
    get<StudentDetail>(`/students/${presetId}`)
      .then((s) => setStudents([{ id: s.id, name: s.fullName, ref: s.studentId, balance: s.currentBalance, className: s.className }]))
      .catch(() => undefined)
  }, [presetId, students])

  const selectedOffence = useMemo<Offence | undefined>(() => offences?.find((o) => o._id === offenceId), [offences, offenceId])
  const grouped = useMemo(() => {
    const map = new Map<string, Offence[]>()
    for (const o of offences ?? []) {
      const list = map.get(o.category) ?? []
      list.push(o)
      map.set(o.category, list)
    }
    return [...map.entries()]
  }, [offences])

  const validation =
    !students.length || !offenceId || description.trim().length < 10 || location.trim().length < 2
      ? 'Select at least one student, an offence rule, describe what happened (10+ characters) and record the location.'
      : null

  function addStudent(s: SelectedStudent) {
    setStudents((list) => (list.some((x) => x.id === s.id) ? list : [...list, s]))
    setStudentQuery('')
  }

  function removeStudent(id: string) {
    setStudents((list) => list.filter((s) => s.id !== id))
  }

  function buildDraft() {
    return {
      localId: newLocalId(),
      studentId: students[0].id,
      studentName: students[0].name,
      studentRef: students[0].ref,
      offenceId,
      offenceName: selectedOffence?.name ?? '',
      description: description.trim(),
      occurredAt,
      location: location.trim(),
      safeguarding,
      witnesses: witnessName.trim()
        ? [{ name: witnessName.trim(), statement: witnessStatement.trim() || undefined }]
        : undefined,
      immediateAction: immediateAction.trim() || undefined,
      clientSubmissionId: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
    }
  }

  async function uploadEvidence(incidentId: string, file: File) {
    const form = new FormData()
    form.append('file', file)
    form.append('linkedType', 'incident')
    form.append('linkedId', incidentId)
    form.append('classification', 'confidential')
    form.append('description', `Attached while recording: ${selectedOffence?.name ?? 'incident'}`)
    await api.post('/evidence', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  }

  async function createAndMaybeSubmit(submit: boolean) {
    if (validation) return
    setError(null)
    setBusy(submit ? 'submit' : 'draft')
    const draft = buildDraft()
    const clientSubmissionId = draft.clientSubmissionId
    const created: { _id: string; incidentNumber: string }[] = []
    try {
      for (const student of students) {
        const incident = await post<{ _id: string; incidentNumber: string }>('/incidents', {
          studentId: student.id,
          offenceId,
          description: description.trim(),
          occurredAt: new Date(occurredAt).toISOString(),
          location: location.trim(),
          safeguardingFlag: safeguarding,
          witnesses: witnessName.trim() ? [{ name: witnessName.trim(), statement: witnessStatement.trim() || undefined }] : undefined,
          immediateAction: immediateAction.trim() || undefined,
          clientSubmissionId: `${clientSubmissionId}-${student.id}`,
        })
        created.push(incident)
        for (const file of files) await uploadEvidence(incident._id, file)
        if (submit) await post(`/incidents/${incident._id}/submit`)
      }
      const label = created.length === 1 ? created[0].incidentNumber : `${created.length} incidents`
      success(submit ? `${label} submitted for independent review` : `${label} saved as draft${created.length > 1 ? 's' : ''}`)
      if (created.length === 1) navigate(`/incidents/${created[0]._id}`)
      else navigate('/incidents')
    } catch (err) {
      const message = apiError(err)
      if (!created.length && /reach the server|Network Error|ERR_NETWORK/i.test(message)) {
        await saveOfflineDraft(draft)
        info('Saved offline on this device. Sync it from Offline drafts when the connection returns.')
        navigate('/drafts')
      } else {
        const suffix = created.length ? ` (${created.length} incident${created.length === 1 ? '' : 's'} already recorded)` : ''
        setError(`${message}${suffix}`)
        toastError(`${message}${suffix}`)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ochre-500">New conduct record</p>
        <h1 className="mt-1 text-2xl font-semibold">Record an incident</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Incidents stay as drafts until submitted. Deductions are only posted after an independent reviewer approves.
        </p>
      </div>

      {error && (
        <Alert tone="danger" title="Incident not recorded">
          {error}
        </Alert>
      )}

      <Card>
        <CardHeader title="Students involved" subtitle="Record one incident per learner — select everyone involved" icon={UserRound} />
        <div className="space-y-3 p-5">
          {students.length ? (
            <div className="flex flex-wrap gap-2">
              {students.map((s) => (
                <span key={s.id} className="flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50/70 px-3 py-1.5 text-sm dark:border-brand-900 dark:bg-brand-950/30">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-slate-500">{s.ref}</span>
                  <button type="button" onClick={() => removeStudent(s.id)} aria-label={`Remove ${s.name}`} className="text-slate-400 hover:text-risk-red">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : presetId ? (
            <p className="text-sm text-slate-400">Loading student…</p>
          ) : null}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder={students.length ? 'Add another student…' : 'Search by name or student ID…'}
              value={studentQuery}
              onChange={(e) => setStudentQuery(e.target.value)}
            />
          </div>
          {studentQuery.length >= 2 && (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line dark:border-[#26374f]">
              {results?.length ? (
                results.map((s: Student) => {
                  const id = s.id ?? s._id ?? ''
                  const already = students.some((x) => x.id === id)
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={already}
                      onClick={() => addStudent({ id, name: s.fullName, ref: s.studentId, balance: s.currentBalance, className: typeof s.classId === 'object' ? s.classId?.name : undefined })}
                      className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-white/5"
                    >
                      <span>
                        {s.fullName}
                        <span className="ml-2 text-xs text-slate-400">{s.studentId}</span>
                      </span>
                      <span className="text-xs text-slate-400">{already ? 'Added' : typeof s.classId === 'object' ? s.classId?.name : ''}</span>
                    </button>
                  )
                })
              ) : (
                <p className="px-4 py-3 text-sm text-slate-400">No matching students</p>
              )}
            </div>
          )}
          {students.length > 1 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {students.length} learners selected. A separate case with its own review and deduction is created for each.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Offence & details" subtitle="The rule determines deduction and approval requirements" icon={AlertTriangle} />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Offence rule" required>
              <Select value={offenceId} onChange={(e) => setOffenceId(e.target.value)}>
                <option value="">Select an offence…</option>
                {grouped.map(([category, items]) => (
                  <optgroup key={category} label={category}>
                    {items.map((o) => (
                      <option key={o._id} value={o._id}>
                        {o.name} (−{o.deduction} · {titleCase(o.severity)})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
          </div>

          {selectedOffence && (
            <div className="sm:col-span-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs dark:bg-[#0c1524]">
              <Badge tone="red">−{selectedOffence.deduction} marks</Badge>
              <Badge tone={selectedOffence.severity === 'critical' || selectedOffence.severity === 'serious' ? 'orange' : 'slate'}>
                {titleCase(selectedOffence.severity)}
              </Badge>
              {selectedOffence.requiresApproval && <Badge tone="amber">Independent approval required</Badge>}
              {selectedOffence.requiresEvidence && <Badge tone="amber">Evidence required before submit</Badge>}
              {selectedOffence.notifyParent && <Badge tone="brand">Guardian will be notified after approval</Badge>}
            </div>
          )}

          {duplicates?.length ? (
            <div className="sm:col-span-2">
              <Alert tone="warning" title={`Possible duplicate — ${duplicates.length} matching case${duplicates.length === 1 ? '' : 's'} in the last 30 days`}>
                <ul className="space-y-1">
                  {duplicates.slice(0, 4).map((match) => (
                    <li key={match.incidentNumber}>
                      {match.studentName} · {match.incidentNumber} · {new Date(match.occurredAt).toLocaleDateString()} ({titleCase(match.status)})
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs">Check the existing case before recording again — you can still continue if this is a separate event.</p>
              </Alert>
            </div>
          ) : null}

          <div className="sm:col-span-2">
            <Field label="What happened?" hint="Factual, specific and respectful. 10–5000 characters." required>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the conduct, who was involved and any immediate action taken…"
                className="min-h-[130px]"
              />
            </Field>
          </div>

          <Field label="Occurred at" required>
            <Input type="datetime-local" value={occurredAt} max={nowLocalInput()} onChange={(e) => setOccurredAt(e.target.value)} />
          </Field>
          <Field label="Location" required>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input className="pl-9" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Dormitory B, classroom 12" />
            </div>
          </Field>

          <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
            <Field label="Witness name (optional)">
              <Input value={witnessName} onChange={(e) => setWitnessName(e.target.value)} placeholder="Staff or student witness" />
            </Field>
            <Field label="Witness statement (optional)">
              <Input value={witnessStatement} onChange={(e) => setWitnessStatement(e.target.value)} placeholder="Short summary" />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field label="Immediate action taken (optional)" hint="What was done at the time — confiscation, separation, first aid, referral.">
              <Textarea
                value={immediateAction}
                onChange={(e) => setImmediateAction(e.target.value)}
                placeholder="e.g. Phone confiscated and handed to the class teacher; student counselled on the spot."
                className="min-h-[80px]"
              />
            </Field>
          </div>

          <label className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-ochre-200 bg-ochre-50/60 p-4 text-sm dark:border-ochre-600/40 dark:bg-ochre-500/10">
            <input type="checkbox" checked={safeguarding} onChange={(e) => setSafeguarding(e.target.checked)} className="mt-0.5 h-4 w-4 rounded" />
            <span>
              <span className="flex items-center gap-1.5 font-medium text-ochre-700 dark:text-ochre-300">
                <ShieldAlert className="h-4 w-4" /> Flag as a safeguarding concern
              </span>
              <span className="mt-0.5 block text-xs text-ochre-700/80 dark:text-ochre-300/80">
                Restricted visibility. The safeguarding lead will receive an alert and the standard deduction may be paused under investigation.
              </span>
            </span>
          </label>
        </div>
      </Card>

      <Card>
        <CardHeader title="Supporting evidence" subtitle="Photos, PDFs or documents — attached to every case created" icon={Paperclip} />
        <div className="space-y-3 p-5">
          <label className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line p-6 text-sm text-slate-500 transition hover:border-brand-400 hover:bg-brand-50/40 dark:border-[#26374f] dark:hover:bg-brand-950/20">
            <Paperclip className="h-5 w-5 text-brand-500" />
            <span className="font-medium">Attach evidence files</span>
            <span className="text-xs text-slate-400">Images, PDF, Word, Excel or text · max 15 MB each</span>
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,application/pdf,.doc,.docx,.xlsx,text/plain"
              className="hidden"
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])]
                setFiles((list) => [
                  ...list,
                  ...picked.filter((file) => !list.some((existing) => existing.name === file.name && existing.size === file.size)),
                ])
                e.target.value = ''
              }}
            />
          </label>
          {files.length ? (
            <ul className="divide-y divide-line/70 rounded-lg border border-line dark:divide-[#1f2f49] dark:border-[#26374f]">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate">{file.name}</span>
                    <span className="shrink-0 text-xs text-slate-400">{humanBytes(file.size)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setFiles((list) => list.filter((_, i) => i !== index))}
                    className="text-slate-400 hover:text-risk-red"
                    aria-label={`Remove ${file.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400">No evidence attached yet. Evidence is hashed and access-logged on upload.</p>
          )}
          {selectedOffence?.requiresEvidence && !files.length && (
            <Alert tone="warning" title="Evidence required">
              This offence cannot be submitted for review without at least one supporting file.
            </Alert>
          )}
        </div>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <CloudOff className="h-3.5 w-3.5" /> If the network drops, this form is kept safely on your device.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" loading={busy === 'draft'} disabled={Boolean(validation) || busy !== null} onClick={() => createAndMaybeSubmit(false)}>
            Save draft
          </Button>
          <Button loading={busy === 'submit'} disabled={Boolean(validation) || busy !== null} onClick={() => createAndMaybeSubmit(true)} icon={Send}>
            Submit for review
          </Button>
        </div>
      </div>
      {validation && (
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <CheckCircle2 className="h-3.5 w-3.5" /> {validation}
        </p>
      )}
    </div>
  )
}
