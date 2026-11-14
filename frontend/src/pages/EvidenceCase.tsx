import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  FolderLock,
  Image as ImageIcon,
  Paperclip,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { api, apiError, downloadFile, get, getPage } from '../lib/api'
import { refName } from '../lib/hooks'
import { formatDateTime, humanBytes, titleCase } from '../lib/utils'
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
  Select,
  StatCard,
  StatusBadge,
  Textarea,
} from '../components/ui'
import { useToast } from '../components/toast'

type IncidentSummary = {
  _id: string
  incidentNumber: string
  studentSnapshot: { fullName: string; studentId: string; className?: string; dormitoryName?: string }
  offenceSnapshot: { name: string; severity: string; deduction: number; requiresEvidence?: boolean }
  description: string
  status: string
  occurredAt: string
  reportedBy?: { name?: string } | string
  history?: { at: string; action: string; note?: string }[]
}

export type EvidenceRow = {
  _id: string
  originalName: string
  mimeType: string
  size: number
  classification: string
  linkedType: string
  linkedId?: string
  reviewStatus: string
  description?: string
  createdAt: string
  uploadedBy?: { name?: string } | string
}

export function EvidenceCasePage() {
  const { id = '' } = useParams()
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [downloadingAll, setDownloadingAll] = useState(false)

  const incident = useQuery({
    queryKey: ['incident', id],
    queryFn: () => get<IncidentSummary>(`/incidents/${id}`),
    enabled: Boolean(id),
  })

  const evidence = useQuery({
    queryKey: ['evidence', 'incident', id],
    queryFn: () => getPage<EvidenceRow>('/evidence', { linkedType: 'incident', linkedId: id, pageSize: 100 }),
    enabled: Boolean(id),
  })

  const rows = evidence.data?.items ?? []
  const stats = useMemo(() => {
    const images = rows.filter((row) => row.mimeType.startsWith('image/')).length
    return {
      total: rows.length,
      images,
      documents: rows.length - images,
      validated: rows.filter((row) => row.reviewStatus === 'reviewed').length,
      rejected: rows.filter((row) => row.reviewStatus === 'rejected').length,
      pending: rows.filter((row) => !['reviewed', 'rejected'].includes(row.reviewStatus)).length,
    }
  }, [rows])

  const hero = rows.find((row) => row.mimeType.startsWith('image/'))

  async function download(row: EvidenceRow) {
    try {
      await downloadFile(`/evidence/${row._id}/download`, row.originalName)
    } catch (err) {
      toastError(apiError(err))
    }
  }

  async function downloadAll() {
    if (!rows.length) return
    setDownloadingAll(true)
    try {
      for (const row of rows) await downloadFile(`/evidence/${row._id}/download`, row.originalName)
      success(`${rows.length} evidence file${rows.length === 1 ? '' : 's'} downloaded`)
    } catch (err) {
      toastError(apiError(err))
    } finally {
      setDownloadingAll(false)
    }
  }

  if (incident.isLoading) return <LoadingBlock label="Loading case evidence…" />
  if (incident.error || !incident.data) {
    return (
      <EmptyState
        title="Case unavailable"
        message="It may not exist, or your role does not have visibility of it."
        action={<Link to="/incidents" className="link font-semibold">Back to incidents</Link>}
      />
    )
  }

  const inc = incident.data

  return (
    <div className="space-y-5">
      <Link to={`/incidents/${id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to case
      </Link>

      <PageHeader
        eyebrow={`${inc.incidentNumber} · ${titleCase(inc.offenceSnapshot.severity)} severity`}
        title="Evidence workspace"
        subtitle={`${inc.studentSnapshot.fullName} · ${inc.offenceSnapshot.name} · occurred ${formatDateTime(inc.occurredAt)}`}
        actions={
          <>
            <StatusBadge status={inc.status} />
            {has('evidence.upload') && (
              <Button variant="secondary" icon={Upload} onClick={() => setUploadOpen(true)}>
                Attach evidence
              </Button>
            )}
            <Button icon={Download} loading={downloadingAll} disabled={!rows.length} onClick={downloadAll}>
              Download all
            </Button>
          </>
        }
      />

      {inc.offenceSnapshot.requiresEvidence && !rows.length && (
        <Alert tone="warning" title="Evidence is required for this offence">
          The case cannot be submitted for review until at least one supporting file is attached.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Total assets" value={stats.total} icon={FolderLock} tone="brand" />
        <StatCard label="Photos" value={stats.images} icon={ImageIcon} tone="emerald" />
        <StatCard label="Documents" value={stats.documents} icon={FileText} tone="slate" />
        <StatCard label="Validated" value={stats.validated} icon={CheckCircle2} tone="emerald" hint={`${stats.pending} awaiting review`} />
        <StatCard label="Rejected" value={stats.rejected} icon={ShieldCheck} tone="amber" />
      </div>

      <Card className="overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[1.4fr_1fr]">
          <div className="relative min-h-[240px] bg-navy-950">
            {hero ? (
              <CaseImage row={hero} className="h-full max-h-[380px] w-full object-contain" />
            ) : (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 text-slate-400">
                <FolderLock className="h-10 w-10" />
                <p className="text-sm">No photo evidence attached yet</p>
              </div>
            )}
            <span className="absolute left-4 top-4 rounded-full bg-navy-950/80 px-3 py-1 text-xs font-semibold text-white">
              {rows.length} asset{rows.length === 1 ? '' : 's'} · {inc.studentSnapshot.className ?? 'Unplaced'}
            </span>
          </div>
          <div className="space-y-3 p-5">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Incident</p>
              <p className="font-semibold">{inc.offenceSnapshot.name}</p>
              <p className="text-xs text-slate-500">{inc.studentSnapshot.fullName} · {inc.studentSnapshot.studentId}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Reported by</p>
              <p className="text-sm">{refName(inc.reportedBy)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-400">Findings recorded</p>
              <p className="line-clamp-4 text-sm text-slate-600 dark:text-slate-300">{inc.description}</p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge tone={stats.validated === stats.total && stats.total > 0 ? 'emerald' : 'amber'}>
                {stats.total ? `${stats.validated}/${stats.total} validated` : 'No validation yet'}
              </Badge>
              <Badge tone="slate">{inc.incidentNumber}</Badge>
            </div>
          </div>
        </div>
      </Card>

      {rows.length ? (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {rows.map((row) => (
            <Card key={row._id} className="overflow-hidden">
              <div className="relative h-28 bg-slate-100 dark:bg-[#0c1524]">
                {row.mimeType.startsWith('image/') ? (
                  <CaseImage row={row} className="h-28 w-full object-cover" />
                ) : (
                  <div className="flex h-28 items-center justify-center text-slate-400"><FileText className="h-8 w-8" /></div>
                )}
                <Badge tone={row.classification === 'restricted' ? 'red' : row.classification === 'confidential' ? 'amber' : 'slate'} className="absolute left-2 top-2">
                  {titleCase(row.classification)}
                </Badge>
              </div>
              <div className="space-y-1 p-3">
                <p className="truncate text-xs font-medium" title={row.originalName}>{row.originalName}</p>
                <p className="text-[11px] text-slate-400">{humanBytes(row.size)} · {formatDateTime(row.createdAt)}</p>
                <div className="flex items-center justify-between pt-1">
                  <StatusBadge status={row.reviewStatus} />
                  <div className="flex items-center gap-1">
                    <button type="button" title="Preview" onClick={() => void preview(row, toastError)} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-white/5">
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" title="Download" onClick={() => void download(row)} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-white/5">
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader title="All assets" subtitle="Every file is hashed on upload and each access is logged" icon={Paperclip} />
        {evidence.isLoading ? (
          <LoadingBlock label="Loading assets…" />
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                  <th className="px-5 py-2.5 font-semibold">File</th>
                  <th className="px-3 py-2.5 font-semibold">Type</th>
                  <th className="px-3 py-2.5 font-semibold">Classification</th>
                  <th className="px-3 py-2.5 font-semibold">Review</th>
                  <th className="px-3 py-2.5 font-semibold">Uploaded</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row._id} className="border-b border-line/60 last:border-0 dark:border-[#1f2f49]">
                    <td className="px-5 py-3">
                      <p className="font-medium">{row.originalName}</p>
                      <p className="text-xs text-slate-400">{humanBytes(row.size)}{row.description ? ` · ${row.description}` : ''}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-500">{row.mimeType}</td>
                    <td className="px-3 py-3">
                      <Badge tone={row.classification === 'restricted' ? 'red' : row.classification === 'confidential' ? 'amber' : 'slate'}>{titleCase(row.classification)}</Badge>
                    </td>
                    <td className="px-3 py-3"><StatusBadge status={row.reviewStatus} /></td>
                    <td className="px-3 py-3 text-xs text-slate-400">{formatDateTime(row.createdAt)}<br />{refName(row.uploadedBy)}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={Eye} onClick={() => void preview(row, toastError)}>View</Button>
                        <Button size="sm" variant="ghost" icon={Download} onClick={() => void download(row)}>Download</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No evidence yet" message="Attach photos, PDFs or documents to support this case." icon={FolderLock} />
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Validation summary" subtitle="Reviews are performed by authorised staff" icon={ShieldCheck} />
          <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
            <Summary label="Validated" value={`${stats.validated}`} tone="text-risk-green" />
            <Summary label="Awaiting review" value={`${stats.pending}`} tone="text-ochre-600" />
            <Summary label="Rejected" value={`${stats.rejected}`} tone="text-risk-red" />
            <Summary label="With description" value={`${rows.filter((row) => row.description?.trim()).length}`} tone="text-brand-600" />
          </dl>
          {inc.offenceSnapshot.requiresEvidence && (
            <div className="border-t border-line px-5 py-3 text-xs text-slate-500 dark:border-[#26374f]">
              This offence requires evidence. Submission is blocked until at least one asset is linked.
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Case activity" subtitle="Evidence and review actions are timestamped" icon={CheckCircle2} />
          {inc.history?.length ? (
            <ol className="space-y-3 p-5">
              {[...inc.history].reverse().slice(0, 8).map((entry, index) => (
                <li key={index} className="border-l border-line pl-4 dark:border-[#26374f]">
                  <p className="text-sm font-medium">{titleCase(entry.action)}</p>
                  {entry.note && <p className="text-xs text-slate-500">{entry.note}</p>}
                  <p className="text-[11px] text-slate-400">{formatDateTime(entry.at)}</p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="No activity yet" message="Case actions will appear here." />
          )}
        </Card>
      </div>

      <UploadCaseEvidence
        open={uploadOpen}
        caseId={id}
        onClose={() => setUploadOpen(false)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['evidence', 'incident', id] })
          queryClient.invalidateQueries({ queryKey: ['incident', id] })
        }}
      />
    </div>
  )
}

function CaseImage({ row, className }: { row: EvidenceRow; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!row.mimeType.startsWith('image/')) return
    let active = true
    let objectUrl = ''
    api
      .get(`/evidence/${row._id}/download`, { responseType: 'blob' })
      .then((res) => {
        if (!active) return
        objectUrl = URL.createObjectURL(res.data as Blob)
        setUrl(objectUrl)
      })
      .catch(() => undefined)
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [row._id, row.mimeType])
  if (!url) return <div className="flex h-full min-h-[112px] w-full items-center justify-center text-slate-500"><ImageIcon className="h-8 w-8" /></div>
  return <img src={url} alt={row.originalName} className={className} />
}

async function preview(row: EvidenceRow, onError: (message: string) => void) {
  try {
    const { data } = await api.get(`/evidence/${row._id}/download`, { responseType: 'blob' })
    const url = URL.createObjectURL(data as Blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err) {
    onError(apiError(err))
  }
}

function Summary({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold ${tone}`}>{value}</dd>
    </div>
  )
}

function UploadCaseEvidence({ open, caseId, onClose, onSaved }: { open: boolean; caseId: string; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const [files, setFiles] = useState<File[]>([])
  const [classification, setClassification] = useState('confidential')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit() {
    if (!files.length) return
    setBusy(true)
    try {
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        form.append('linkedType', 'incident')
        form.append('linkedId', caseId)
        form.append('classification', classification)
        if (description.trim()) form.append('description', description.trim())
        await api.post('/evidence', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      }
      success(`${files.length} evidence file${files.length === 1 ? '' : 's'} attached`)
      setFiles([])
      setDescription('')
      onSaved()
      onClose()
    } catch (err) {
      toastError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Attach case evidence"
      subtitle="Files are stored privately, hashed with SHA-256 and access-logged"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!files.length} icon={Upload} onClick={submit}>Upload {files.length || ''}</Button></>}
    >
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line p-8 text-sm text-slate-500 transition hover:border-brand-400 hover:bg-brand-50/40 dark:border-[#26374f] dark:hover:bg-brand-950/20"
        >
          <Upload className="h-6 w-6 text-brand-500" />
          <span>{files.length ? `${files.length} file${files.length === 1 ? '' : 's'} selected` : 'Choose photos, PDFs or documents (max 15 MB each)'}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept="image/png,image/jpeg,image/webp,application/pdf,.doc,.docx,.xlsx,text/plain"
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])]
            setFiles((list) => [...list, ...picked.filter((file) => !list.some((existing) => existing.name === file.name && existing.size === file.size))])
            e.target.value = ''
          }}
        />
        {files.length ? (
          <ul className="divide-y divide-line/70 rounded-lg border border-line text-sm dark:divide-[#1f2f49] dark:border-[#26374f]">
            {files.map((file, index) => (
              <li key={`${file.name}-${file.size}`} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="truncate">{file.name}</span>
                <button type="button" className="text-xs font-semibold text-slate-400 hover:text-risk-red" onClick={() => setFiles((list) => list.filter((_, i) => i !== index))}>Remove</button>
              </li>
            ))}
          </ul>
        ) : null}
        <Field label="Classification">
          <Select value={classification} onChange={(e) => setClassification(e.target.value)}>
            <option value="internal">Internal</option>
            <option value="confidential">Confidential</option>
            <option value="restricted">Restricted (safeguarding only)</option>
          </Select>
        </Field>
        <Field label="Description" hint="Explain what this evidence shows">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Photo of the damaged property, signed statement…" />
        </Field>
        {classification === 'restricted' && (
          <Alert tone="info" title="Restricted access">
            Only safeguarding-authorised staff will be able to view this file.
          </Alert>
        )}
      </div>
    </Modal>
  )
}
