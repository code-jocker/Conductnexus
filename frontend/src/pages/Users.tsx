import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Inbox,
  KeyRound,
  Mail,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
  Users as UsersIcon,
  X,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { apiError, del, get, getPage, patch, post, put } from '../lib/api'
import { useStructure } from '../lib/hooks'
import { formatDate, titleCase } from '../lib/utils'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
} from '../components/ui'
import { useToast } from '../components/toast'

type RoleRef = { id: string; key: string; name: string }

type UserRow = {
  id: string
  _id?: string
  name: string
  email: string
  phone?: string
  position?: string
  status: string
  emailVerified?: boolean
  lastLoginAt?: string
  createdAt?: string
  roles: RoleRef[]
  assignedClassIds?: string[]
  assignedDormitoryIds?: string[]
}

type UserDetail = UserRow & {
  overrides?: { permission: string; effect: 'allow' | 'deny'; reason?: string; expiresAt?: string }[]
}

type RoleRow = {
  id: string
  key: string
  name: string
  description?: string
  isSystem?: boolean
  users: number
  permissions: string[]
}

type PermissionCatalog = { permissions: { key: string; label: string; group: string }[]; groups: Record<string, { key: string; label: string }[]> }

type TabKey = 'accounts' | 'requests' | 'roles'

export function UsersPage() {
  const { has } = useAuth()
  const [tab, setTab] = useState<TabKey>('accounts')
  const { data: pendingRequests } = useQuery({
    queryKey: ['access-requests-pending-count'],
    queryFn: () => getPage<AccessRequestRow>('/access-requests', { status: 'pending', pageSize: 1 }),
    enabled: has('users.view'),
    refetchInterval: 60_000,
  })

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Access control"
        title="Users & roles"
        subtitle="Create staff and parent accounts, assign roles, and fine-tune permissions without changing code."
      />

      <Tabs<TabKey>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'accounts', label: 'Staff accounts' },
          ...(has('users.view')
            ? [{ key: 'requests' as TabKey, label: 'Access requests', count: pendingRequests?.meta.total }]
            : []),
          { key: 'roles', label: 'Roles & permissions' },
        ]}
      />

      {tab === 'accounts' && <AccountsTab />}
      {tab === 'requests' && <RequestsTab />}
      {tab === 'roles' && <RolesTab canManage={has('roles.manage')} />}
    </div>
  )
}

function AccountsTab() {
  const { has, me } = useAuth()
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: roles } = useQuery({ queryKey: ['roles-all'], queryFn: () => get<RoleRow[]>('/roles') })

  const { data, isLoading } = useQuery({
    queryKey: ['users', q, status, role, page],
    queryFn: () => getPage<UserRow>('/users', { page, pageSize: 20, q: q || undefined, status: status || undefined, role: role || undefined }),
  })

  const rows = data?.items ?? []

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 p-4">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1) }} placeholder="Search name, email or position…" className="sm:w-64" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }} className="sm:w-40">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="pending">Pending</option>
        </Select>
        <Select value={role} onChange={(e) => { setRole(e.target.value); setPage(1) }} className="sm:w-48">
          <option value="">All roles</option>
          {(roles ?? []).map((r) => <option key={r.id} value={r.key}>{r.name}</option>)}
        </Select>
        <div className="ml-auto">
          {has('users.create') && (
            <Button icon={UserPlus} onClick={() => setCreateOpen(true)}>New user</Button>
          )}
        </div>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading users…" />
      ) : rows.length ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Roles</th>
                  <th className="px-4 py-3">Position</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line dark:divide-[#1f2f49]">
                {rows.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50/60 dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <p className="font-medium">{user.name}{user.id === me?.user.id ? ' (you)' : ''}</p>
                      <p className="text-xs text-slate-400">{user.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((r) => <Badge key={r.id} tone="brand">{r.name}</Badge>)}
                        {!user.roles.length && <span className="text-xs text-slate-400">No role</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">{user.position ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <StatusBadge status={user.status} />
                        {user.emailVerified === false && <Badge tone="amber">Unverified</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(user.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setSelectedId(user.id)}>Manage</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-slate-500 dark:border-[#1f2f49]">
            <span>{data?.meta.total ?? 0} accounts</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={page >= Number(data?.meta.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState icon={UsersIcon} title="No accounts found" message="Adjust the filters or invite a new staff member." />
      )}

      {createOpen && <CreateUserModal open roles={roles ?? []} onClose={() => setCreateOpen(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: ['users'] })} />}
      {selectedId && (
        <ManageUserModal
          key={selectedId}
          userId={selectedId}
          roles={roles ?? []}
          onClose={() => setSelectedId(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['users'] })
            queryClient.invalidateQueries({ queryKey: ['user', selectedId] })
            queryClient.invalidateQueries({ queryKey: ['roles-all'] })
          }}
        />
      )}
    </div>
  )
}

function CreateUserModal({ open, roles, onClose, onSaved }: { open: boolean; roles: RoleRow[]; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const { data: structure } = useStructure()
  const [form, setForm] = useState({ name: '', email: '', phone: '', position: '', roleIds: [] as string[], classIds: [] as string[], dormitoryIds: [] as string[], sendInvite: true, temporaryPassword: '' })
  const [created, setCreated] = useState<{ email: string; temporaryPassword?: string; inviteDelivered: boolean } | null>(null)

  const create = useMutation({
    mutationFn: () =>
      post<{ user: UserRow; temporaryPassword?: string; inviteDelivered: boolean }>('/users', {
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        position: form.position || undefined,
        roleIds: form.roleIds,
        classIds: form.classIds,
        dormitoryIds: form.dormitoryIds,
        sendInvite: form.sendInvite,
        temporaryPassword: form.temporaryPassword || undefined,
      }),
    onSuccess: (result) => {
      success('Account created')
      onSaved()
      if (result.inviteDelivered) {
        onClose()
      } else {
        setCreated({ email: form.email, temporaryPassword: result.temporaryPassword, inviteDelivered: result.inviteDelivered })
      }
    },
    onError: (err) => toastError(apiError(err)),
  })

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  if (created) {
    return (
      <Modal open={open} onClose={onClose} title="Account created" subtitle="Share these credentials securely." footer={<Button onClick={onClose}>Done</Button>}>
        <div className="space-y-3 text-sm">
          <Alert tone={created.temporaryPassword ? 'warning' : 'success'} title={created.temporaryPassword ? 'Email not delivered' : 'Invitation sent'}>
            {created.temporaryPassword
              ? 'Email delivery is not configured. Give this temporary password to the user and ask them to change it on first sign-in.'
              : `An invitation email was sent to ${created.email}.`}
          </Alert>
          {created.temporaryPassword && (
            <div className="rounded-lg border border-line bg-slate-50 p-3 font-mono text-base dark:border-[#1f2f49] dark:bg-white/[0.02]">
              {created.temporaryPassword}
            </div>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite a staff member"
      subtitle="They must change the temporary password on first sign-in."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={form.name.trim().length < 2 || !form.email.includes('@') || !form.roleIds.length} onClick={() => create.mutate()}>
            Create account
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email" required>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="teacher@school.rw" />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+250 7xx xxx xxx" />
          </Field>
          <Field label="Position">
            <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="e.g. Teacher of Mathematics" />
          </Field>
        </div>

        <Field label="Roles" required hint="A user can hold more than one role.">
          <div className="grid gap-2 rounded-lg border border-line p-3 dark:border-[#1f2f49] sm:grid-cols-2">
            {roles.map((r) => (
              <Checkbox
                key={r.id}
                checked={form.roleIds.includes(r.id)}
                onChange={() => setForm({ ...form, roleIds: toggle(form.roleIds, r.id) })}
                label={<span><span className="font-medium">{r.name}</span>{r.description ? <span className="block text-xs text-slate-500">{r.description}</span> : null}</span>}
              />
            ))}
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Assigned classes" hint="Teachers only see their assigned classes.">
            <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-line p-3 dark:border-[#1f2f49]">
              {(structure?.classes ?? []).map((c) => (
                <Checkbox key={c._id} checked={form.classIds.includes(c._id)} onChange={() => setForm({ ...form, classIds: toggle(form.classIds, c._id) })} label={c.name} />
              ))}
              {!structure?.classes.length && <p className="text-xs text-slate-400">No classes configured.</p>}
            </div>
          </Field>
          <Field label="Assigned dormitories" hint="Matrons and patrons see only their dormitories.">
            <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-lg border border-line p-3 dark:border-[#1f2f49]">
              {(structure?.dormitories ?? []).map((d) => (
                <Checkbox key={d._id} checked={form.dormitoryIds.includes(d._id)} onChange={() => setForm({ ...form, dormitoryIds: toggle(form.dormitoryIds, d._id) })} label={d.name} />
              ))}
              {!structure?.dormitories.length && <p className="text-xs text-slate-400">No dormitories configured.</p>}
            </div>
          </Field>
        </div>

        <Field label="Temporary password" hint="Leave blank to generate one. Minimum 10 characters with upper, lower and a digit.">
          <Input value={form.temporaryPassword} onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })} placeholder="Auto-generate" />
        </Field>
        <Checkbox checked={form.sendInvite} onChange={(v) => setForm({ ...form, sendInvite: v })} label="Send an invitation email with the temporary password" />
      </div>
    </Modal>
  )
}

function ManageUserModal({ userId, roles, onClose, onSaved }: { userId: string; roles: RoleRow[]; onClose: () => void; onSaved: () => void }) {
  const { has, me } = useAuth()
  const { success, error: toastError } = useToast()
  const { data: user, isLoading } = useQuery({ queryKey: ['user', userId], queryFn: () => get<UserDetail>(`/users/${userId}`) })
  const { data: permissionInfo } = useQuery({
    queryKey: ['user-permissions', userId],
    queryFn: () => get<{ roles: string[]; effective: string[]; overrides: UserDetail['overrides'] }>(`/users/${userId}/permissions`),
    enabled: has('users.view'),
  })
  const { data: catalog } = useQuery({
    queryKey: ['permissions-catalog'],
    queryFn: () => get<PermissionCatalog>('/permissions'),
    enabled: has('users.view'),
  })

  const [profile, setProfile] = useState<{ name: string; phone: string; position: string; status: string } | null>(null)
  const [selectedRoles, setSelectedRoles] = useState<string[] | null>(null)
  const [overrides, setOverrides] = useState<{ permission: string; effect: 'allow' | 'deny'; reason: string }[] | null>(null)
  const [newOverride, setNewOverride] = useState({ permission: '', effect: 'allow' as 'allow' | 'deny', reason: '' })

  const current = profile ?? (user ? { name: user.name, phone: user.phone ?? '', position: user.position ?? '', status: user.status } : null)
  const currentRoles = selectedRoles ?? user?.roles.map((r) => r.id) ?? []
  const currentOverrides = overrides ?? (permissionInfo?.overrides ?? []).map((o) => ({ permission: o.permission, effect: o.effect, reason: o.reason ?? '' }))

  const saveProfile = useMutation({
    mutationFn: () => patch(`/users/${userId}`, { name: profile?.name, phone: profile?.phone, position: profile?.position, status: profile?.status }),
    onSuccess: () => {
      success('Profile updated')
      onSaved()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const saveRoles = useMutation({
    mutationFn: () => put(`/users/${userId}/roles`, { roleIds: currentRoles }),
    onSuccess: () => {
      success('Roles updated — the user may need to refresh')
      onSaved()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const saveOverrides = useMutation({
    mutationFn: () =>
      put<{ effective: string[] }>(`/users/${userId}/permissions`, {
        overrides: currentOverrides.map((o) => ({ permission: o.permission, effect: o.effect, reason: o.reason || undefined })),
      }),
    onSuccess: () => {
      success('Permission overrides saved')
      onSaved()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const toggleStatus = useMutation({
    mutationFn: () => post(`/users/${userId}/${user?.status === 'active' ? 'deactivate' : 'activate'}`),
    onSuccess: () => {
      success(user?.status === 'active' ? 'Account deactivated' : 'Account activated')
      setProfile(null)
      onSaved()
    },
    onError: (err) => toastError(apiError(err)),
  })

  if (isLoading || !user || !current) {
    return <Modal open onClose={onClose} title="Manage account"><LoadingBlock /></Modal>
  }

  return (
    <Modal open onClose={onClose} title={user.name} subtitle={user.email} size="lg" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={user.status} />
          {user.emailVerified === false && <Badge tone="amber">Email not verified</Badge>}
          {user.roles.map((r) => <Badge key={r.id} tone="brand">{r.name}</Badge>)}
        </div>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Profile</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name">
              <Input value={current.name} onChange={(e) => setProfile({ ...current, name: e.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={current.phone} onChange={(e) => setProfile({ ...current, phone: e.target.value })} />
            </Field>
            <Field label="Position">
              <Input value={current.position} onChange={(e) => setProfile({ ...current, position: e.target.value })} />
            </Field>
            <Field label="Status">
              <Select value={current.status} onChange={(e) => setProfile({ ...current, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="pending">Pending</option>
              </Select>
            </Field>
          </div>
          {has('users.update') && (
            <Button size="sm" className="mt-2" loading={saveProfile.isPending} onClick={() => saveProfile.mutate()}>Save profile</Button>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Roles</h4>
          <div className="grid gap-2 rounded-lg border border-line p-3 dark:border-[#1f2f49] sm:grid-cols-2">
            {roles.map((r) => (
              <Checkbox
                key={r.id}
                checked={currentRoles.includes(r.id)}
                onChange={() => {
                  const next = currentRoles.includes(r.id) ? currentRoles.filter((x) => x !== r.id) : [...currentRoles, r.id]
                  setSelectedRoles(next)
                }}
                label={<span><span className="font-medium">{r.name}</span>{r.isSystem ? <span className="ml-1 text-[10px] uppercase text-slate-400">system</span> : null}</span>}
              />
            ))}
          </div>
          {has('roles.manage') && (
            <Button size="sm" className="mt-2" loading={saveRoles.isPending} disabled={!currentRoles.length} onClick={() => saveRoles.mutate()}>Save roles</Button>
          )}
        </section>

        <section>
          <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><KeyRound className="h-3.5 w-3.5" /> Permission overrides</h4>
          <p className="mb-2 text-xs text-slate-500">Allow or deny individual permissions on top of the roles. Deny always wins. Overrides expire automatically when an expiry is set on the server.</p>
          <ul className="space-y-1.5">
            {currentOverrides.map((o, i) => (
              <li key={`${o.permission}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 dark:border-[#1f2f49]">
                <span className="font-mono text-xs">{o.permission}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={o.effect === 'allow' ? 'emerald' : 'red'}>{o.effect}</Badge>
                  {o.reason && <span className="text-xs text-slate-500">{o.reason}</span>}
                  {has('permissions.manage') && (
                    <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setOverrides(currentOverrides.filter((_, idx) => idx !== i))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </li>
            ))}
            {!currentOverrides.length && <li className="text-xs text-slate-400">No overrides — the user inherits permissions from roles.</li>}
          </ul>

          {has('permissions.manage') && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Select
                className="min-w-[220px] flex-1"
                value={newOverride.permission}
                onChange={(e) => setNewOverride({ ...newOverride, permission: e.target.value })}
              >
                <option value="">Select permission…</option>
                {(catalog?.permissions ?? []).map((p) => (
                  <option key={p.key} value={p.key}>{p.group} — {p.label}</option>
                ))}
              </Select>
              <Select className="w-24" value={newOverride.effect} onChange={(e) => setNewOverride({ ...newOverride, effect: e.target.value as 'allow' | 'deny' })}>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </Select>
              <Input className="w-44" placeholder="Reason (optional)" value={newOverride.reason} onChange={(e) => setNewOverride({ ...newOverride, reason: e.target.value })} />
              <Button
                size="sm"
                variant="secondary"
                disabled={!newOverride.permission || currentOverrides.some((o) => o.permission === newOverride.permission)}
                onClick={() => {
                  setOverrides([...currentOverrides, { permission: newOverride.permission, effect: newOverride.effect, reason: newOverride.reason }])
                  setNewOverride({ permission: '', effect: 'allow', reason: '' })
                }}
              >
                Add
              </Button>
            </div>
          )}
          {has('permissions.manage') && (
            <Button size="sm" className="mt-3" loading={saveOverrides.isPending} onClick={() => saveOverrides.mutate()}>Save overrides</Button>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 dark:border-[#1f2f49]">
          <div className="text-xs text-slate-500">
            Created {formatDate(user.createdAt)} · Effective permissions: {permissionInfo?.effective.length ?? 0}
          </div>
          {has('users.deactivate') && user.id !== me?.user.id && (
            <Button
              size="sm"
              variant={user.status === 'active' ? 'danger' : 'secondary'}
              loading={toggleStatus.isPending}
              onClick={() => toggleStatus.mutate()}
            >
              {user.status === 'active' ? 'Deactivate account' : 'Reactivate account'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function RolesTab({ canManage }: { canManage: boolean }) {
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<RoleRow | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const { data: roles, isLoading } = useQuery({ queryKey: ['roles-all'], queryFn: () => get<RoleRow[]>('/roles') })
  const { data: catalog } = useQuery({ queryKey: ['permissions-catalog'], queryFn: () => get<PermissionCatalog>('/permissions') })
  const { data: users } = useQuery({ queryKey: ['users-count'], queryFn: () => getPage<UserRow>('/users', { pageSize: 1 }) })

  const deleteRole = useMutation({
    mutationFn: (id: string) => del(`/roles/${id}`),
    onSuccess: () => {
      success('Role deleted')
      queryClient.invalidateQueries({ queryKey: ['roles-all'] })
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-200"><ShieldCheck className="h-5 w-5" /></span>
          <div>
            <p className="text-sm font-semibold">{roles?.length ?? 0} roles · {users?.meta.total ?? 0} accounts</p>
            <p className="text-xs text-slate-500">Roles bundle permissions. Individual overrides are managed per user.</p>
          </div>
        </div>
        {canManage && <Button icon={Plus} onClick={() => setCreateOpen(true)}>New role</Button>}
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading roles…" />
      ) : roles?.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {roles.map((role) => (
            <Card key={role.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{role.name}</p>
                    {role.isSystem && <Badge tone="slate">System</Badge>}
                    <Badge tone="brand">{role.users} user{role.users === 1 ? '' : 's'}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{role.description || 'No description'}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-slate-400">{role.key}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setSelected(role)}>{canManage ? 'Edit' : 'View'}</Button>
                  {canManage && !role.isSystem && (
                    <button
                      type="button"
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      aria-label={`Delete ${role.name}`}
                      onClick={() => {
                        if (window.confirm(`Delete the role "${role.name}"? It must have no users assigned.`)) deleteRole.mutate(role.id)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-3 line-clamp-2 text-xs text-slate-500">
                {role.permissions.length ? role.permissions.slice(0, 5).map(titleCase).join(' · ') + (role.permissions.length > 5 ? ` +${role.permissions.length - 5} more` : '') : 'No permissions assigned'}
              </p>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState icon={ShieldCheck} title="No roles" message="Seed roles are created automatically at setup." />
      )}

      {selected && (
        <RolePermissionModal
          key={selected.id}
          role={selected}
          catalog={catalog}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['roles-all'] })}
        />
      )}
      {createOpen && (
        <CreateRoleModal
          open
          catalog={catalog}
          onClose={() => setCreateOpen(false)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['roles-all'] })}
        />
      )}
    </div>
  )
}

function RolePermissionModal({
  role,
  catalog,
  canManage,
  onClose,
  onSaved,
}: {
  role: RoleRow
  catalog?: PermissionCatalog
  canManage: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const { success, error: toastError } = useToast()
  const [selected, setSelected] = useState<string[]>(role.permissions)
  const [filter, setFilter] = useState('')

  const save = useMutation({
    mutationFn: () => put(`/roles/${role.id}/permissions`, { permissions: selected }),
    onSuccess: () => {
      success('Role permissions saved')
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  const groups = useMemo(() => {
    const source = catalog?.groups ?? {}
    const needle = filter.trim().toLowerCase()
    return Object.entries(source)
      .map(([group, perms]) => ({
        group,
        perms: perms.filter((p) => !needle || p.key.includes(needle) || p.label.toLowerCase().includes(needle)),
      }))
      .filter((g) => g.perms.length)
  }, [catalog, filter])

  return (
    <Modal
      open
      onClose={onClose}
      title={`${role.name} permissions`}
      subtitle={`${selected.length} of ${catalog?.permissions.length ?? 0} permissions selected`}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {canManage && <Button loading={save.isPending} onClick={() => save.mutate()}>Save permissions</Button>}
        </>
      }
    >
      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter permissions…" className="pl-9" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map(({ group, perms }) => (
            <div key={group}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ochre-600 dark:text-ochre-400">{titleCase(group)}</p>
              <div className="space-y-1.5">
                {perms.map((p) => (
                  <Checkbox
                    key={p.key}
                    checked={selected.includes(p.key)}
                    onChange={() => setSelected(selected.includes(p.key) ? selected.filter((x) => x !== p.key) : [...selected, p.key])}
                    label={<span><span className="text-sm">{p.label}</span><span className="ml-1 font-mono text-[10px] text-slate-400">{p.key}</span></span>}
                  />
                ))}
              </div>
            </div>
          ))}
          {!groups.length && <p className="text-sm text-slate-400">No permissions match your filter.</p>}
        </div>
        {role.key === 'ADMIN' && (
          <Alert tone="warning" title="Administrator safeguards">
            Core administrator permissions cannot be removed, so the system can always be maintained.
          </Alert>
        )}
      </div>
    </Modal>
  )
}

function CreateRoleModal({ open, catalog, onClose, onSaved }: { open: boolean; catalog?: PermissionCatalog; onClose: () => void; onSaved: () => void }) {
  const { success, error: toastError } = useToast()
  const [form, setForm] = useState({ key: '', name: '', description: '', permissions: [] as string[] })

  const create = useMutation({
    mutationFn: () => post('/roles', form),
    onSuccess: () => {
      success('Role created')
      onSaved()
      onClose()
    },
    onError: (err) => toastError(apiError(err)),
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a role"
      subtitle="Start with the essential permissions; you can refine them later."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={create.isPending} disabled={form.key.trim().length < 2 || form.name.trim().length < 2} onClick={() => create.mutate()}>Create role</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role key" required hint="Uppercase letters, numbers and underscores">
            <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="CARE_COORDINATOR" />
          </Field>
          <Field label="Display name" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Care Coordinator" />
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Permissions" hint="You can also assign permissions after creating the role.">
          <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-line p-3 dark:border-[#1f2f49]">
            {Object.entries(catalog?.groups ?? {}).map(([group, perms]) => (
              <div key={group}>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titleCase(group)}</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {perms.map((p) => (
                    <Checkbox
                      key={p.key}
                      checked={form.permissions.includes(p.key)}
                      onChange={() =>
                        setForm({
                          ...form,
                          permissions: form.permissions.includes(p.key)
                            ? form.permissions.filter((x) => x !== p.key)
                            : [...form.permissions, p.key],
                        })
                      }
                      label={<span className="text-xs">{p.label}</span>}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  )
}

type AccessRequestRow = {
  id: string
  name: string
  email: string
  phone?: string
  requestedRole: string
  roleName?: string
  reason?: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt?: string
  reviewedAt?: string
  reviewedByName?: string
  decisionNote?: string
  notifications?: { email: boolean; whatsapp: boolean }
}

type ApproveResult = {
  request: AccessRequestRow
  user: { id: string; name: string; email: string }
  created: boolean
  temporaryPassword?: string
  emailDelivered: boolean
  whatsappDelivered: boolean
  whatsappError?: string
}

const REQUEST_STATUS_TONE: Record<string, string> = { pending: 'amber', approved: 'emerald', rejected: 'red' }

function RequestsTab() {
  const { has } = useAuth()
  const queryClient = useQueryClient()
  const { error: toastError } = useToast()
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(1)
  const [approveTarget, setApproveTarget] = useState<AccessRequestRow | null>(null)
  const [rejectTarget, setRejectTarget] = useState<AccessRequestRow | null>(null)
  const [result, setResult] = useState<ApproveResult | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['access-requests', status, page],
    queryFn: () => getPage<AccessRequestRow>('/access-requests', { status, page, pageSize: 20 }),
  })

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['access-requests'] })
    queryClient.invalidateQueries({ queryKey: ['access-requests-pending-count'] })
    queryClient.invalidateQueries({ queryKey: ['users'] })
  }

  const rows = data?.items ?? []

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-2 p-4">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
          className="sm:w-48"
        >
          <option value="pending">Pending approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All requests</option>
        </Select>
        <p className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          Requests arrive from the sign-in page. Approving creates the account and notifies the person.
        </p>
      </Card>

      {isLoading ? (
        <LoadingBlock label="Loading access requests…" />
      ) : rows.length ? (
        <Card className="divide-y divide-line dark:divide-[#1f2f49]">
          {rows.map((request) => (
            <div key={request.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{request.name}</p>
                  <Badge tone={REQUEST_STATUS_TONE[request.status]}>{titleCase(request.status)}</Badge>
                  <Badge tone="brand">{request.roleName ?? titleCase(request.requestedRole)}</Badge>
                </div>
                <p className="text-xs text-slate-400">
                  {request.email}
                  {request.phone ? ` · ${request.phone}` : ''}
                </p>
                {request.reason && <p className="text-sm text-slate-600 dark:text-slate-300">{request.reason}</p>}
                <p className="text-[11px] text-slate-400">
                  Requested {request.createdAt ? formatDate(request.createdAt) : '—'}
                  {request.reviewedByName ? ` · reviewed by ${request.reviewedByName}` : ''}
                </p>
                {request.status === 'approved' && request.notifications && (
                  <p className="text-[11px] text-slate-400">
                    Email {request.notifications.email ? 'sent' : 'not delivered'} · WhatsApp{' '}
                    {request.notifications.whatsapp ? 'sent' : 'not delivered'}
                  </p>
                )}
                {request.status === 'rejected' && request.decisionNote && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">Note: {request.decisionNote}</p>
                )}
              </div>
              {request.status === 'pending' && has('users.create') && (
                <div className="flex shrink-0 gap-2">
                  <Button size="sm" icon={CheckCircle2} onClick={() => setApproveTarget(request)}>
                    Approve
                  </Button>
                  <Button size="sm" variant="secondary" icon={X} onClick={() => setRejectTarget(request)}>
                    Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
          {data && <Pagination meta={data.meta} onPage={setPage} />}
        </Card>
      ) : (
        <EmptyState
          icon={Inbox}
          title="No access requests"
          message={
            status === 'pending'
              ? 'Requests submitted from the sign-in page will appear here for approval.'
              : 'No requests match this filter yet.'
          }
        />
      )}

      {approveTarget && (
        <ApproveRequestModal
          request={approveTarget}
          onClose={() => setApproveTarget(null)}
          onApproved={(approved) => {
            setApproveTarget(null)
            setResult(approved)
            refresh()
          }}
        />
      )}

      {rejectTarget && (
        <RejectRequestModal
          request={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onRejected={() => {
            setRejectTarget(null)
            refresh()
          }}
          onError={(message) => toastError(message)}
        />
      )}

      {result && (
        <Modal
          open
          onClose={() => setResult(null)}
          title="Access granted"
          subtitle={result.user.email}
          footer={<Button onClick={() => setResult(null)}>Done</Button>}
        >
          <div className="space-y-3 text-sm">
            <Alert
              tone={result.emailDelivered ? 'success' : 'warning'}
              title={result.emailDelivered ? 'Approval email sent' : 'Email not delivered'}
            >
              {result.emailDelivered
                ? `Sign-in details were emailed to ${result.user.email}.`
                : 'Share this temporary password securely instead.'}
            </Alert>
            {result.temporaryPassword && (
              <div className="rounded-lg border border-line bg-slate-50 p-3 font-mono text-base dark:border-[#1f2f49] dark:bg-white/[0.02]">
                {result.temporaryPassword}
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <MessageCircle className="h-4 w-4" />
              WhatsApp: {result.whatsappDelivered ? 'delivered' : result.whatsappError || 'not delivered'}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Mail className="h-4 w-4" />
              {result.emailDelivered ? 'Approval email delivered' : 'Approval email stored but not delivered'}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function ApproveRequestModal({
  request,
  onClose,
  onApproved,
}: {
  request: AccessRequestRow
  onClose: () => void
  onApproved: (result: ApproveResult) => void
}) {
  const { data: roles } = useQuery({
    queryKey: ['access-request-roles'],
    queryFn: () => get<{ key: string; name: string }[]>('/auth/access-request/roles'),
    staleTime: 10 * 60 * 1000,
  })
  const [roleKey, setRoleKey] = useState(request.requestedRole)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      const result = await post<ApproveResult>(`/access-requests/${request.id}/approve`, {
        roleKey: roleKey || undefined,
        note: note || undefined,
      })
      onApproved(result)
    } catch (err) {
      setError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Approve access request"
      subtitle={`${request.name} · ${request.email}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} icon={CheckCircle2} onClick={submit}>
            Approve and notify
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {error && <Alert tone="danger" title="Could not approve">{error}</Alert>}
        <div className="space-y-1 rounded-lg border border-line p-3 dark:border-[#1f2f49]">
          <p><span className="text-slate-500">Email:</span> {request.email}</p>
          <p><span className="text-slate-500">Phone:</span> {request.phone || 'Not provided'}</p>
          {request.reason && <p><span className="text-slate-500">Reason:</span> {request.reason}</p>}
        </div>
        <Field label="Role to grant" required>
          <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
            {(roles ?? []).map((role) => (
              <option key={role.key} value={role.key}>{role.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)" hint="Included in the audit trail and, for rejections, in the message.">
          <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          A new account gets a temporary password. Sign-in details go by email
          {request.phone ? ' and WhatsApp' : ''}.
        </p>
      </div>
    </Modal>
  )
}

function RejectRequestModal({
  request,
  onClose,
  onRejected,
  onError,
}: {
  request: AccessRequestRow
  onClose: () => void
  onRejected: () => void
  onError: (message: string) => void
}) {
  const { success } = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      await post(`/access-requests/${request.id}/reject`, { note: note || undefined })
      success('Request rejected')
      onRejected()
    } catch (err) {
      const message = apiError(err)
      setError(message)
      onError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Reject access request"
      subtitle={`${request.name} · ${request.email}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={submit}>
            Reject request
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {error && <Alert tone="danger" title="Could not reject">{error}</Alert>}
        <Field label="Reason (optional)" hint="The requester receives this note by email.">
          <Textarea
            rows={3}
            maxLength={1000}
            placeholder="e.g. Please ask the school office to confirm your employment details."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  )
}
