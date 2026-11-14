import { useEffect, useState } from 'react'
import { CloudOff, CloudUpload, RefreshCw, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiError, post } from '../lib/api'
import { listOfflineDrafts, removeOfflineDraft, clearOfflineDrafts, type OfflineIncidentDraft } from '../lib/offline'
import { formatDateTime } from '../lib/utils'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, StatusBadge } from '../components/ui'
import { useToast } from '../components/toast'

type SyncResult = { localId: string; status: 'synced' | 'conflict' | 'rejected'; incidentId?: string; reference?: string; error?: string }

const statusTone: Record<string, string> = {
  synced: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  conflict: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  rejected: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
}

export function DraftsPage() {
  const { success, error: toastError } = useToast()
  const [drafts, setDrafts] = useState<OfflineIncidentDraft[]>([])
  const [syncing, setSyncing] = useState(false)
  const [results, setResults] = useState<SyncResult[]>([])

  const refresh = () => {
    void listOfflineDrafts().then(setDrafts)
  }

  useEffect(() => {
    refresh()
    const handler = () => refresh()
    window.addEventListener('cn-offline-drafts', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('cn-offline-drafts', handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  const sync = async () => {
    if (!drafts.length) return
    setSyncing(true)
    try {
      const response = await post<{ results: SyncResult[]; syncedAt: string }>('/sync/incidents', {
        drafts: drafts.map((d) => ({
          localId: d.localId,
          studentId: d.studentId,
          offenceId: d.offenceId,
          description: d.description,
          occurredAt: d.occurredAt,
          location: d.location || undefined,
          safeguardingFlag: d.safeguarding || undefined,
          witnesses: d.witnesses?.length ? d.witnesses : undefined,
          clientSubmissionId: d.clientSubmissionId,
        })),
      })
      setResults(response.results)
      const synced = response.results.filter((r) => r.status === 'synced')
      await Promise.all(synced.map((r) => removeOfflineDraft(r.localId)))
      refresh()
      if (synced.length) success(`${synced.length} draft${synced.length === 1 ? '' : 's'} synced as incidents`)
      const failed = response.results.length - synced.length
      if (failed) toastError(`${failed} draft${failed === 1 ? '' : 's'} still need attention`)
    } catch (err) {
      toastError(apiError(err))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Offline-first"
        title="Offline drafts"
        subtitle="Incidents captured when the network dropped. They are stored on this device until you sync them."
        actions={
          drafts.length > 0 && (
            <Button icon={CloudUpload} loading={syncing} onClick={sync}>
              Sync all drafts
            </Button>
          )
        }
      />

      {!drafts.length ? (
        <Card>
          <EmptyState
            icon={CloudOff}
            title="No offline drafts on this device"
            message="If the API is unreachable while recording an incident, ConductNexus saves it here automatically so no report is lost."
            action={<Link to="/incidents/new" className="text-sm font-semibold text-brand-600 hover:underline">Record an incident</Link>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          <Alert tone="warning" title={`${drafts.length} draft${drafts.length === 1 ? '' : 's'} waiting`}>
            Each draft keeps its original client submission ID, so syncing twice cannot create duplicate incidents.
          </Alert>

          {drafts.map((draft) => {
            const result = results.find((r) => r.localId === draft.localId)
            return (
              <Card key={draft.localId} className="p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{draft.studentName}</span>
                      {draft.studentRef && <span className="text-xs text-slate-400">{draft.studentRef}</span>}
                      <Badge tone="ochre">{draft.offenceName}</Badge>
                      {draft.safeguarding && <Badge tone="danger">Safeguarding</Badge>}
                      {result && <Badge tone={statusTone[result.status]}>{result.status === 'synced' ? `Synced ${result.reference ?? ''}` : result.status}</Badge>}
                    </div>
                    <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{draft.description}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      Occurred {formatDateTime(draft.occurredAt)} · saved {formatDateTime(draft.savedAt)}
                      {draft.location ? ` · ${draft.location}` : ''}
                    </p>
                    {result?.error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{result.error}</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => { void removeOfflineDraft(draft.localId).then(refresh) }}>
                      Discard
                    </Button>
                  </div>
                </div>
              </Card>
            )
          })}

          <Card>
            <CardHeader title="Device storage" subtitle="Drafts never leave this device until you press sync." />
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <span className="text-slate-500">Clearing removes unsynced work permanently.</span>
              <Button
                variant="danger"
                size="sm"
                icon={Trash2}
                onClick={() => {
                  if (window.confirm('Discard every offline draft on this device? This cannot be undone.')) {
                    void clearOfflineDrafts().then(() => {
                      setResults([])
                      refresh()
                    })
                  }
                }}
              >
                Clear all drafts
              </Button>
            </div>
          </Card>
        </div>
      )}

      {results.length > 0 && (
        <Card>
          <CardHeader title="Last sync results" subtitle="Server verdict for each local draft" actions={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setResults([])}>Clear</Button>} />
          <ul className="divide-y divide-line text-sm dark:divide-[#1f2f49]">
            {results.map((r) => (
              <li key={r.localId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  <span className="font-mono text-xs text-slate-400">{r.reference ?? r.localId}</span>
                </span>
                {r.error && <span className="text-xs text-red-600">{r.error}</span>}
                {r.incidentId && <Link to={`/incidents/${r.incidentId}`} className="text-xs font-semibold text-brand-600 hover:underline">Open incident</Link>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
