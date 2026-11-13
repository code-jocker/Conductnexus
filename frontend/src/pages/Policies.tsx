import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpenCheck, CheckCircle2, FilePlus2, History, Plus } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, get, getPage, patch, post } from '../lib/api'
import { formatDate, titleCase } from '../lib/utils'
import { Badge, Button, Card, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, Select, Textarea } from '../components/ui'
import { useToast } from '../components/toast'

type Policy = {
  _id: string
  title: string
  type: string
  version: string
  summary?: string
  content?: string
  effectiveDate: string
  published: boolean
  createdAt?: string
  offenceCategories?: string[]
}

type PolicyVersion = { _id: string; version: string; published: boolean; effectiveDate: string; createdAt?: string }

export function PoliciesPage() {
  const { has } = useAuth()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState<Policy | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', type: 'discipline', version: '1.0', summary: '', content: '', effectiveDate: new Date().toISOString().slice(0, 10) })
  const [versionOpen, setVersionOpen] = useState(false)
  const [versionForm, setVersionForm] = useState({ version: '', summary: '', content: '', effectiveDate: new Date().toISOString().slice(0, 10) })

  const { data, isLoading } = useQuery({
    queryKey: ['policies'],
    queryFn: () => getPage<Policy>('/policies', { pageSize: 50 }),
  })
  const { data: versions } = useQuery({
    queryKey: ['policy-versions', selected?._id],
    queryFn: () => get<PolicyVersion[]>(`/policies/${selected!._id}/versions`),
    enabled: Boolean(selected),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['policies'] })
    queryClient.invalidateQueries({ queryKey: ['policy-versions'] })
  }

  const create = useMutation({
    mutationFn: () => post('/policies', draft),
    onSuccess: () => {
      success('Policy created as a draft')
      setCreateOpen(false)
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const save = useMutation({
    mutationFn: () => patch(`/policies/${selected!._id}`, { summary: selected!.summary, content: selected!.content, effectiveDate: selected!.effectiveDate }),
    onSuccess: () => {
      success('Policy draft updated')
      setEditing(false)
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const publish = useMutation({
    mutationFn: () => post(`/policies/${selected!._id}/publish`),
    onSuccess: () => {
      success('Policy published. Published versions are immutable.')
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const newVersion = useMutation({
    mutationFn: () => post(`/policies/${selected!._id}/new-version`, versionForm),
    onSuccess: () => {
      success('New policy version drafted')
      setVersionOpen(false)
      refresh()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const policies = data?.items ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Rules & policy centre"
        title="Policies"
        subtitle="Version-controlled discipline, safeguarding and data protection policy with a published-only view for staff."
        actions={
          has('policies.manage') && (
            <Button icon={Plus} onClick={() => setCreateOpen(true)}>
              New policy
            </Button>
          )
        }
      />

      {isLoading ? (
        <LoadingBlock label="Loading policies…" />
      ) : policies.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {policies.map((policy) => (
            <Card key={policy._id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <Badge tone="brand">{titleCase(policy.type)}</Badge>
                <Badge tone={policy.published ? 'emerald' : 'slate'}>{policy.published ? 'Published' : 'Draft'}</Badge>
              </div>
              <p className="mt-2 font-display text-base font-semibold">{policy.title}</p>
              <p className="text-xs text-slate-400">Version {policy.version} · effective {formatDate(policy.effectiveDate)}</p>
              {policy.summary && <p className="mt-2 line-clamp-3 text-sm text-slate-600 dark:text-slate-300">{policy.summary}</p>}
              <Button size="sm" variant="secondary" className="mt-auto pt-2" onClick={() => { setSelected(policy); setEditing(false) }}>
                <BookOpenCheck className="h-4 w-4" /> Read policy
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No policies yet" message="Publish your discipline handbook so staff and families see the same rules." icon={BookOpenCheck} />
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.title ?? 'Policy'}
        subtitle={selected ? `Version ${selected.version} · ${selected.published ? 'Published' : 'Draft'}` : undefined}
        size="xl"
        footer={
          selected && has('policies.manage') ? (
            <>
              {!selected.published && (
                <>
                  <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
                    {editing ? 'Cancel editing' : 'Edit draft'}
                  </Button>
                  <Button variant="dark" loading={publish.isPending} onClick={() => publish.mutate()} icon={CheckCircle2}>
                    Publish
                  </Button>
                </>
              )}
              <Button variant="secondary" icon={FilePlus2} onClick={() => {
                setVersionForm({ version: '', summary: '', content: selected.content ?? '', effectiveDate: new Date().toISOString().slice(0, 10) })
                setVersionOpen(true)
              }}>
                New version
              </Button>
              {editing && (
                <Button loading={save.isPending} onClick={() => save.mutate()}>
                  Save draft
                </Button>
              )}
            </>
          ) : (
            <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
          )
        }
      >
        {selected && (
          <div className="space-y-4 text-sm">
            {selected.summary && <p className="rounded-lg bg-brand-50/60 p-3 text-brand-900 dark:bg-brand-950/20 dark:text-brand-200">{selected.summary}</p>}
            {editing ? (
              <>
                <Field label="Summary">
                  <Textarea value={selected.summary ?? ''} onChange={(e) => setSelected({ ...selected, summary: e.target.value })} />
                </Field>
                <Field label="Policy content">
                  <Textarea className="min-h-[220px] font-mono text-xs" value={selected.content ?? ''} onChange={(e) => setSelected({ ...selected, content: e.target.value })} />
                </Field>
                <Field label="Effective date">
                  <Input type="date" value={selected.effectiveDate.slice(0, 10)} onChange={(e) => setSelected({ ...selected, effectiveDate: e.target.value })} />
                </Field>
              </>
            ) : (
              <div className="max-h-[46vh] overflow-y-auto whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-300">
                {selected.content || 'This policy does not have content yet.'}
              </div>
            )}

            <div className="rounded-lg border border-line p-3 dark:border-[#26374f]">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <History className="h-3.5 w-3.5" /> Version history
              </p>
              <ul className="mt-2 space-y-1">
                {versions?.map((v) => (
                  <li key={v._id} className="flex items-center justify-between text-xs">
                    <span>Version {v.version} · {formatDate(v.effectiveDate)}</span>
                    <Badge tone={v.published ? 'emerald' : 'slate'}>{v.published ? 'Published' : 'Draft'}</Badge>
                  </li>
                ))}
                {!versions?.length && <li className="text-xs text-slate-400">No earlier versions.</li>}
              </ul>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create a policy"
        subtitle="Drafts stay internal until published."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button loading={create.isPending} disabled={draft.title.trim().length < 3} onClick={() => create.mutate()}>
              Create draft
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Title" required>
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Type">
              <Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                <option value="discipline">Discipline</option>
                <option value="safeguarding">Safeguarding</option>
                <option value="data_protection">Data protection</option>
                <option value="handbook">Handbook</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Version">
              <Input value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} />
            </Field>
            <Field label="Effective date" required>
              <Input type="date" value={draft.effectiveDate} onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })} />
            </Field>
          </div>
          <Field label="Summary">
            <Textarea value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
          </Field>
          <Field label="Content">
            <Textarea className="min-h-[200px] font-mono text-xs" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        title="Create a new version"
        subtitle="Published versions are immutable. This becomes a new draft."
        footer={
          <>
            <Button variant="ghost" onClick={() => setVersionOpen(false)}>Cancel</Button>
            <Button loading={newVersion.isPending} disabled={!versionForm.version || versionForm.version === selected?.version} onClick={() => newVersion.mutate()}>
              Create version
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="New version" required>
              <Input value={versionForm.version} onChange={(e) => setVersionForm({ ...versionForm, version: e.target.value })} placeholder="2.0" />
            </Field>
            <Field label="Effective date" required>
              <Input type="date" value={versionForm.effectiveDate} onChange={(e) => setVersionForm({ ...versionForm, effectiveDate: e.target.value })} />
            </Field>
          </div>
          <Field label="What changed?">
            <Textarea value={versionForm.summary} onChange={(e) => setVersionForm({ ...versionForm, summary: e.target.value })} />
          </Field>
          <Field label="Content">
            <Textarea className="min-h-[160px] font-mono text-xs" value={versionForm.content} onChange={(e) => setVersionForm({ ...versionForm, content: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
