import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, CheckCircle2, CloudOff, MapPin, Search, Send, ShieldAlert, UserRound } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '../components/ui'
import { apiError, get, post } from '../lib/api'
import { useOffences, useStudentSearch } from '../lib/hooks'
import { newLocalId, saveOfflineDraft } from '../lib/offline'
import { useToast } from '../components/toast'
import type { Offence, Student } from '../lib/types'
import { titleCase } from '../lib/utils'

function nowLocalInput() {
  const now = new Date()
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
  return now.toISOString().slice(0, 16)
}

type StudentDetail = { id: string; fullName: string; studentId: string; className?: string; currentBalance?: number }

export function IncidentNewPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { success, error: toastError, info } = useToast()
  const presetId = params.get('studentId') ?? ''

  const [student, setStudent] = useState<{ id: string; name: string; ref?: string; balance?: number } | null>(null)
  const [studentQuery, setStudentQuery] = useState('')
  const [offenceId, setOffenceId] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [occurredAt, setOccurredAt] = useState(nowLocalInput)
  const [safeguarding, setSafeguarding] = useState(false)
  const [witnessName, setWitnessName] = useState('')
  const [witnessStatement, setWitnessStatement] = useState('')
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: offences } = useOffences()
  const { data: results } = useStudentSearch(studentQuery, studentQuery.length >= 2 && !student)

  useEffect(() => {
    if (!presetId || student) return
    get<StudentDetail>(`/students/${presetId}`)
      .then((s) => setStudent({ id: s.id, name: s.fullName, ref: s.studentId, balance: s.currentBalance }))
      .catch(() => undefined)
  }, [presetId, student])

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
    !student || !offenceId || description.trim().length < 10 || location.trim().length < 2
      ? 'Select a student, an offence rule, describe what happened (10+ characters) and record the location.'
      : null

  function buildDraft() {
    return {
      localId: newLocalId(),
      studentId: student!.id,
      studentName: student!.name,
      studentRef: student!.ref,
      offenceId,
      offenceName: selectedOffence?.name ?? '',
      description: description.trim(),
      occurredAt,
      location: location.trim(),
      clientSubmissionId: `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: new Date().toISOString(),
    }
  }

  async function createAndMaybeSubmit(submit: boolean) {
    if (validation || !student) return
    setError(null)
    setBusy(submit ? 'submit' : 'draft')
    const draft = buildDraft()
    try {
      const created = await post<{ _id: string; incidentNumber: string }>('/incidents', {
        studentId: draft.studentId,
        offenceId: draft.offenceId,
        description: draft.description,
        occurredAt: new Date(draft.occurredAt).toISOString(),
        location: draft.location,
        safeguardingFlag: safeguarding,
        witnesses: witnessName.trim() ? [{ name: witnessName.trim(), statement: witnessStatement.trim() || undefined }] : undefined,
        clientSubmissionId: draft.clientSubmissionId,
      })
      if (submit) {
        await post(`/incidents/${created._id}/submit`)
        success(`${created.incidentNumber} submitted for independent review`)
      } else {
        success(`${created.incidentNumber} saved as a draft`)
      }
      navigate(`/incidents/${created._id}`)
    } catch (err) {
      const message = apiError(err)
      if (/reach the server|Network Error|ERR_NETWORK/i.test(message)) {
        saveOfflineDraft(draft)
        info('Saved offline on this device. Sync it from Offline drafts when the connection returns.')
        navigate('/drafts')
      } else {
        setError(message)
        toastError(message)
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
        <CardHeader title="Student" subtitle="Which learner is this about?" icon={UserRound} />
        <div className="space-y-3 p-5">
          {student ? (
            <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-900 dark:bg-brand-950/30">
              <div>
                <p className="font-medium">{student.name}</p>
                <p className="text-xs text-slate-500">
                  {student.ref} {typeof student.balance === 'number' ? `· current balance ${student.balance}` : ''}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setStudent(null); setStudentQuery('') }}>
                Change
              </Button>
            </div>
          ) : presetId ? (
            <p className="text-sm text-slate-400">Loading student…</p>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  placeholder="Search by name or student ID…"
                  value={studentQuery}
                  onChange={(e) => setStudentQuery(e.target.value)}
                />
              </div>
              {studentQuery.length >= 2 && (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-line dark:border-[#26374f]">
                  {results?.length ? (
                    results.map((s: Student) => {
                      const id = s.id ?? s._id ?? ''
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            setStudent({ id, name: s.fullName, ref: s.studentId, balance: s.currentBalance })
                            setStudentQuery('')
                          }}
                          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-white/5"
                        >
                          <span>
                            {s.fullName}
                            <span className="ml-2 text-xs text-slate-400">{s.studentId}</span>
                          </span>
                          <span className="text-xs text-slate-400">
                            {typeof s.classId === 'object' ? s.classId?.name : ''}
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <p className="px-4 py-3 text-sm text-slate-400">No matching students</p>
                  )}
                </div>
              )}
            </>
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
