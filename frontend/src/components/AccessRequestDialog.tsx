import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Send } from 'lucide-react'
import { Alert, Button, Field, Input, Modal, Select, Textarea } from './ui'
import { apiError, get, post } from '../lib/api'

type RequestableRole = { key: string; name: string; description: string }

const EMPTY = { name: '', email: '', phone: '', requestedRole: '', reason: '' }

export function AccessRequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: roles } = useQuery({
    queryKey: ['access-request-roles'],
    queryFn: () => get<RequestableRole[]>('/auth/access-request/roles'),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  })

  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setForm(EMPTY)
    setSent(null)
    setError(null)
    onClose()
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await post<{ message: string }>('/auth/access-request', {
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        requestedRole: form.requestedRole,
        reason: form.reason || undefined,
      })
      setSent(result.message)
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={sent ? 'Request sent' : 'Request an account'}
      subtitle={
        sent
          ? 'Your request is waiting for a school administrator to review it.'
          : 'Tell the school who you are. An administrator approves every account before it is created.'
      }
      size="md"
    >
      {sent ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold">Waiting for approval</p>
              <p>{sent}</p>
              <p className="text-xs opacity-80">
                Once approved, your sign-in details reach you by email and, when you added a number, by WhatsApp.
              </p>
            </div>
          </div>
          <Button type="button" className="w-full" onClick={close}>
            Back to sign in
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert tone="danger" title="Could not send request">{error}</Alert>}

          <Field label="Full name" required>
            <Input
              required
              autoComplete="name"
              placeholder="e.g. Aline Uwase"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>

          <Field label="Email address" hint="Your invitation and approval message go to this address." required>
            <Input
              type="email"
              required
              autoComplete="email"
              placeholder="you@school.rw"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>

          <Field label="Phone number" hint="Optional, but recommended so approval can also reach you on WhatsApp.">
            <Input
              type="tel"
              autoComplete="tel"
              placeholder="+250 7…"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>

          <Field label="Role you are requesting" required>
            <Select
              required
              value={form.requestedRole}
              onChange={(e) => setForm({ ...form, requestedRole: e.target.value })}
            >
              <option value="">Choose a role…</option>
              {(roles ?? []).map((role) => (
                <option key={role.key} value={role.key}>{role.name}</option>
              ))}
            </Select>
          </Field>

          {form.requestedRole && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {(roles ?? []).find((role) => role.key === form.requestedRole)?.description}
            </p>
          )}

          <Field label="Why do you need access?" hint="A short note helps the administrator confirm you quickly.">
            <Textarea
              rows={3}
              maxLength={1000}
              placeholder="e.g. I teach Mathematics in S2 and need to record behaviour cases."
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </Field>

          <p className="text-[11px] text-slate-400">
            Administrator, IT and parent accounts are created directly by the school office. Parents should ask the
            school to link their children first.
          </p>

          <Button type="submit" className="w-full" loading={busy} icon={Send}>
            Send request for approval
          </Button>
        </form>
      )}
    </Modal>
  )
}
