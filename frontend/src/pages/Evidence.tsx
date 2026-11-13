import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileLock2, FolderLock, Plus, ShieldCheck, Upload } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { api, apiError, downloadFile, getPage } from '../lib/api'
import { refName } from '../lib/hooks'
import { formatDateTime, humanBytes, titleCase } from '../lib/utils'
import { Alert, Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, Select, StatusBadge, Textarea } from '../components/ui'
import { useToast } from '../components/toast'

type EvidenceRow = {
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

export function EvidencePage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [linkedType, setLinkedType] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['evidence', linkedType],
    queryFn: () => getPage<EvidenceRow>('/evidence', { pageSize: 50, linkedType: linkedType || undefined }),
  })

  const review = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'reviewed' | 'rejected' }) =>
      api.post(`/evidence/${id}/review`, { status }).then((r) => r.data.data),
    onSuccess: () => {
      success('Evidence review recorded')
      queryClient.invalidateQueries({ queryKey: ['evidence'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  async function download(row: EvidenceRow) {
    try {
      await downloadFile(`/evidence/${row._id}/download`, row.originalName)
    } catch (err) {
      toastError(apiError(err))
    }
  }

  const items = data?.items ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Secure storage"
        title="Evidence management"
        subtitle="SHA-256 verifiable files with classification, restricted access and complete download logging."
        actions={
          has('evidence.upload') && (
            <Button icon={Upload} onClick={() => setUploadOpen(true)}>
              Upload evidence
            </Button>
          )
        }
      />

      <Alert tone="info" title="Integrity by design">
        Uploaded files are hashed on receipt. Downloads are logged with the staff member, classification and time.
      </Alert>

      <Card className="flex flex-col gap-2 p-4 sm:flex-row">
        <Select value={linkedType} onChange={(e) => setLinkedType(e.target.value)} className="sm:w-56">
          <option value="">All evidence</option>
          <option value="incident">Linked to incidents</option>
          <option value="investigation">Linked to investigations</option>
          <option value="safeguarding">Linked to safeguarding</option>
          <option value="appeal">Linked to appeals</option>
          <option value="meeting">Linked to meetings</option>
          <option value="general">General</option>
        </Select>
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" /> Restricted files are hidden unless your role is safeguarding-authorised.
        </span>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading evidence register…" />
      ) : items.length ? (
        <Card>
          <ul className="divide-y divide-line/70 dark:divide-[#1f2f49]">
            {items.map((row) => (
              <li key={row._id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
                    row.classification === 'restricted'
                      ? 'bg-red-50 text-red-600 dark:bg-red-950/40'
                      : row.classification === 'confidential'
                        ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/40'
                        : 'bg-brand-50 text-brand-600 dark:bg-brand-900/40'
                  }`}>
                    <FileLock2 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.originalName}</p>
                    <p className="text-xs text-slate-500">
                      {humanBytes(row.size)} · {titleCase(row.linkedType)} · uploaded by {refName(row.uploadedBy)} · {formatDateTime(row.createdAt)}
                    </p>
                    {row.description && <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">{row.description}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.classification === 'restricted' ? 'red' : row.classification === 'confidential' ? 'amber' : 'slate'}>
                    {titleCase(row.classification)}
                  </Badge>
                  <StatusBadge status={row.reviewStatus} />
                  {has('evidence.review') && row.reviewStatus !== 'reviewed' && (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => review.mutate({ id: row._id, status: 'reviewed' })}>
                        Mark reviewed
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => review.mutate({ id: row._id, status: 'rejected' })}>
                        Reject
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" icon={Download} onClick={() => download(row)}>
                    Download
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <EmptyState title="No evidence uploaded" message="Attach photos, PDFs or documents to support a case." icon={FolderLock} />
      )}

      <UploadEvidenceModal open={uploadOpen} onClose={() => setUploadOpen(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: ['evidence'] })} />
    </div>
  )
}

function UploadEvidenceModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [linked, setLinked] = useState('general')
  const [classification, setClassification] = useState('confidential')
  const [linkedId, setLinkedId] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit() {
    if (!file) return
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('linkedType', linked)
      form.append('classification', classification)
      if (linkedId.trim()) form.append('linkedId', linkedId.trim())
      if (description.trim()) form.append('description', description.trim())
      await api.post('/evidence', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      success('Evidence uploaded and hashed')
      setFile(null)
      setDescription('')
      setLinkedId('')
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
      title="Upload evidence"
      subtitle="Files are stored privately and cannot be accessed by link alone."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!file} onClick={submit} icon={Plus}>
            Upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line p-8 text-sm text-slate-500 transition hover:border-brand-400 hover:bg-brand-50/40 dark:border-[#26374f] dark:hover:bg-brand-950/20"
        >
          <Upload className="h-6 w-6 text-brand-500" />
          {file ? (
            <span className="font-medium text-ink dark:text-slate-100">{file.name} · {humanBytes(file.size)}</span>
          ) : (
            <span>Choose a photo, PDF or document (max 25 MB)</span>
          )}
        </button>
        <input ref={inputRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Link to">
            <Select value={linked} onChange={(e) => setLinked(e.target.value)}>
              <option value="general">General evidence</option>
              <option value="incident">Incident</option>
              <option value="investigation">Investigation</option>
              <option value="safeguarding">Safeguarding case</option>
              <option value="appeal">Appeal</option>
              <option value="meeting">Meeting</option>
            </Select>
          </Field>
          <Field label="Classification">
            <Select value={classification} onChange={(e) => setClassification(e.target.value)}>
              <option value="internal">Internal</option>
              <option value="confidential">Confidential</option>
              <option value="restricted">Restricted (safeguarding only)</option>
            </Select>
          </Field>
        </div>
        {linked !== 'general' && (
          <Field label="Record ID" hint="Paste the incident, case, appeal or meeting ID">
            <Input value={linkedId} onChange={(e) => setLinkedId(e.target.value)} placeholder="65f1c…" />
          </Field>
        )}
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this evidence show?" />
        </Field>
      </div>
    </Modal>
  )
}
