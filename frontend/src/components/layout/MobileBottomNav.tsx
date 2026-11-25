import { useCallback, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  GraduationCap,
  ClipboardList,
  Bell,
  MoreHorizontal,
  ChevronDown,
  X,
  Search,
  Users,
  ArrowUpRight,
  FileText,
  ShieldCheck,
  Settings2,
  Database,
  Activity,
  ShieldAlert,
  Home,
  UserRound,
  LogOut,
  LogIn,
} from 'lucide-react'
import { HeartHandshake } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { Input } from '../ui'

type NavItem = {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  permission?: string | string[]
  roles?: string[]
}

const BOTTOM_NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/students', label: 'nav.students', icon: GraduationCap, permission: 'students.view' },
  { to: '/incidents/new', label: 'nav.incidents', icon: ClipboardList, permission: 'incidents.create' },
  { to: '/communications', label: 'nav.communications', icon: Bell, permission: 'notifications.view' },
  { to: '#more', label: 'nav.more', icon: MoreHorizontal },
]

const MORE_MENU_ITEMS: NavItem[] = [
  { to: '/incidents', label: 'nav.incidents', icon: ClipboardList, permission: 'incidents.view' },
  { to: '/approvals', label: 'nav.approvals', icon: ShieldCheck, permission: ['incidents.review', 'marks.adjust.approve', 'letters.approve', 'appeals.decide', 'investigations.decide', 'safeguarding.escalate'] },
  { to: '/appeals', label: 'nav.appeals', icon: FileText, permission: 'appeals.view' },
  { to: '/reports', label: 'nav.reports', icon: FileText, permission: 'reports.view' },
  { to: '/attendance', label: 'nav.attendance', icon: Activity, permission: 'attendance.view' },
  { to: '/settings', label: 'nav.settings', icon: Settings2, permission: 'settings.manage' },
  { to: '/users', label: 'nav.users', icon: Users, permission: 'users.view' },
  { to: '/audit', label: 'nav.audit', icon: Database, permission: 'audit.view' },
  { to: '/structure', label: 'nav.structure', icon: Users, permission: ['classes.view', 'academic_years.manage', 'dormitories.view'] },
  { to: '/risk', label: 'nav.risk', icon: ShieldAlert, permission: 'risk.view' },
  { to: '/safeguarding', label: 'nav.safeguarding', icon: ShieldAlert, permission: 'safeguarding.view' },
  { to: '/investigations', label: 'nav.investigations', icon: Activity, permission: 'investigations.view' },
  { to: '/meetings', label: 'nav.meetings', icon: Activity, permission: 'meetings.view' },
  { to: '/boarding', label: 'nav.boarding', icon: Activity, permission: 'boarding.view' },
  { to: '/welfare', label: 'nav.welfare', icon: HeartHandshake, permission: ['welfare.view', 'welfare.refer', 'detention.view'] },
  { to: '/promotions', label: 'nav.promotions', icon: ArrowUpRight, permission: 'students.view' },
  { to: '/evidence', label: 'nav.evidence', icon: FileText, permission: 'evidence.view' },
  { to: '/policies', label: 'nav.policies', icon: FileText, permission: 'policies.view' },
  { to: '/data-protection', label: 'nav.data', icon: ShieldAlert, permission: 'data_protection.view' },
  { to: '/monitoring', label: 'nav.monitoring', icon: Activity, permission: 'system.monitor' },
]

const PARENT_MORE_ITEMS: NavItem[] = [
  { to: '/portal', label: 'nav.portal', icon: Home },
  { to: '/communications', label: 'nav.communications', icon: UserRound, permission: 'notifications.view' },
  { to: '/profile', label: 'nav.profile', icon: UserRound },
]

const MORE_MENU_KEY = 'nav.more'

export function MobileBottomNav() {
  const { me, has, logout } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const [search, setSearch] = useState('')

  const isParent = me?.roles.includes('PARENT') && !me?.roles.some((r) => ['ADMIN', 'HEADTEACHER', 'TEACHER', 'DEPUTY_DISCIPLINE'].includes(r))

  const bottomItems = BOTTOM_NAV_ITEMS.filter((item) => !item.permission || has(item.permission))
  const allMoreItems = (isParent ? PARENT_MORE_ITEMS : MORE_MENU_ITEMS).filter((item) => !item.permission || has(item.permission))
  const debouncedSearch = useMemo(() => search.trim().toLowerCase(), [search])
  const moreItems = useMemo(() => {
    if (!debouncedSearch) return allMoreItems
    return allMoreItems.filter((item) => item.label.toLowerCase().includes(debouncedSearch) || item.to.includes(debouncedSearch))
  }, [allMoreItems, debouncedSearch])

  const handleLogout = useCallback(async () => {
    await logout()
  }, [logout])

  const isActive = (to: string) => {
    if (to === '/') return location.pathname === '/'
    if (to === '#more') return moreOpen
    return location.pathname === to
  }

  return (
    <>
      {/* Bottom navigation bar — single fixed bar at the bottom */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-white/90 backdrop-blur-md dark:border-[#1f2f49] dark:bg-[#081426]/90 hidden sm:hidden lg:hidden md:hidden">
        <div className="flex items-center justify-between h-16 px-3">
          <div className="flex items-center justify-around flex-1 gap-1">
            {bottomItems.map((item) => {
              const active = isActive(item.to)
              const isMore = item.to === '#more'
              return (
                <button
                  key={item.to}
                  type="button"
                  onClick={isMore ? () => setMoreOpen(true) : undefined}
                  disabled={isMore}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors min-w-[44px]',
                    active || isMore
                      ? 'text-brand-600'
                      : 'text-slate-500',
                  )}
                  aria-pressed={active || isMore ? true : false}
                  aria-label={t(item.label)}
                >
                  <item.icon className={cn('h-5 w-5', active || isMore ? 'text-brand-600' : 'text-slate-500')} />
                  <span className={cn(active || isMore ? 'text-brand-600' : 'text-slate-500')}>{t(item.label)}</span>
                </button>
              )
            })}
          </div>
        </div>
      </nav>

      {/* Ensure page content is not hidden behind the fixed bottom nav on mobile */}
      <div className="hidden sm:hidden lg:hidden md:hidden h-16" />

      {/* More menu overlay */}
      {moreOpen && (
        <div className="fixed inset-0 z-50 flex flex-col hidden sm:hidden lg:hidden md:hidden">
          <div className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm" onClick={() => setMoreOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 right-0 w-full max-w-md shadow-lift flex flex-col bg-white dark:bg-[#101a2c]">
            <div className="flex items-center justify-between border-b border-line px-5 py-4 dark:border-[#1f2f49]">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t(MORE_MENU_KEY) ?? 'More'}</h2>
              <button onClick={() => setMoreOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Search within More menu */}
            <div className="px-4 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search menu…"
                />
              </div>
            </div>

            <nav className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
              {moreItems.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-400">No matching items</p>
              ) : (
                moreItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive: active }) => cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition block',
                      active
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5',
                    )}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    <span className="truncate">{t(item.label)}</span>
                  </NavLink>
                ))
              )}
            </nav>

            <div className="border-t border-line px-4 py-3 dark:border-[#26374f]">
              <button
                type="button"
                onClick={() => { setMoreOpen(false); void handleLogout() }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <LogOut className="h-4 w-4" /> {t('action.signOut')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
