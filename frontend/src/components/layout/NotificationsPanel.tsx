import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Loader2 } from 'lucide-react'
import { api, apiError, getPage, post } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { timeAgo, cn } from '../../lib/utils'
import type { NotificationItem } from '../../lib/types'
import { EmptyState, IconButton } from '../ui'
import { useToast } from '../toast'

export function useUnreadCount() {
  const { me, socket } = useAuth()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!me) return
    let alive = true
    api
      .get('/notifications/unread-count')
      .then((res) => alive && setCount(res.data.data.unread ?? 0))
      .catch(() => undefined)
    const onNew = () => setCount((c) => c + 1)
    socket?.on('notification:new', onNew)
    return () => {
      alive = false
      socket?.off('notification:new', onNew)
    }
  }, [me, socket])

  return { count, setCount }
}

export function NotificationsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [unread, setUnread] = useState(0)
  const { socket } = useAuth()
  const { success, error } = useToast()
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const page = await getPage<NotificationItem>('/notifications', { pageSize: 30 })
      setItems(page.items)
      setUnread(Number(page.meta.unread ?? items.filter((i) => !i.readAt).length))
    } catch (err) {
      error(apiError(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!socket) return
    const onNew = (payload: NotificationItem) => {
      setItems((list) => [{ ...payload, _id: payload._id ?? String(Date.now()) }, ...list].slice(0, 40))
      // Unread count is managed by useUnreadCount to avoid double counting.
    }
    socket.on('notification:new', onNew)
    return () => {
      socket.off('notification:new', onNew)
    }
  }, [socket])

  const markAll = async () => {
    try {
      await post('/notifications/read-all')
      setItems((list) => list.map((i) => ({ ...i, readAt: new Date().toISOString() })))
      setUnread(0)
      success('All notifications marked as read')
    } catch (err) {
      error(apiError(err))
    }
  }

  const openItem = async (item: NotificationItem) => {
    if (!item.readAt) {
      await post(`/notifications/${item._id}/read`).catch(() => undefined)
      setItems((list) => list.map((i) => (i._id === item._id ? { ...i, readAt: new Date().toISOString() } : i)))
      setUnread((n) => Math.max(0, n - 1))
    }
    if (item.link) {
      onClose()
      navigate(item.link)
    }
  }

  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy-950/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden="true" />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-[min(94vw,420px)] flex-col border-l border-line bg-white shadow-lift animate-slideIn dark:border-[#1f2f49] dark:bg-[#0c1524]" aria-label="Notifications">
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5 dark:border-[#1f2f49]">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <Bell className="h-4 w-4 text-brand-600" /> Notifications
              {unread ? <span className="rounded-full bg-ochre-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span> : null}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Live updates from across the school</p>
          </div>
          <div className="flex items-center gap-1">
            <IconButton label="Mark all read" onClick={markAll}>
              <CheckCheck className="h-4 w-4" />
            </IconButton>
            <IconButton label="Close" onClick={onClose}>
              <span className="text-lg leading-none">×</span>
            </IconButton>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState title="You are all caught up" message="New discipline, approval and support alerts will appear here in real time." icon={Bell} />
          ) : (
            <ul className="divide-y divide-line dark:divide-[#1f2f49]">
              {items.map((item) => (
                <li key={item._id}>
                  <button onClick={() => void openItem(item)} className={cn('w-full px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.03]', !item.readAt && 'bg-brand-50/60 dark:bg-brand-900/10')}>
                    <div className="flex items-start gap-2">
                      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', item.readAt ? 'bg-transparent' : 'bg-brand-600')} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{item.message}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">{timeAgo(item.createdAt)}</p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}
