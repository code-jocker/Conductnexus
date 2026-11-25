import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  GraduationCap,
  ClipboardList,
  Bell,
  MoreHorizontal,
  ChevronDown,
  X,
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
  Search,
  CloudOff,
  HeartHandshake,
} from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { cn } from '../../lib/utils'

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
  { to: '/incidents/new', label: 'Quick log', icon: ClipboardList, permission: 'incidents.create' },
  { to: '/communications', label: 'Alerts', icon: Bell, permission: 'notifications.view' },
]

const PARENT_BOTTOM_ITEMS: NavItem[] = [
  { to: '/portal', label: 'nav.portal', icon: Home },
  { to: '/communications', label: 'Alerts', icon: Bell, permission: 'notifications.view' },
  { to: '/profile', label: 'My profile', icon: UserRound },
]

const MORE_MENU_ITEMS: NavItem[] = [
  { to: '/incidents', label: 'nav.incidents', icon: ClipboardList, permission: 'incidents.view' },
  { to: '/drafts', label: 'nav.drafts', icon: CloudOff, permission: 'incidents.create' },
  { to: '/approvals', label: 'nav.approvals', icon: ShieldCheck, permission: ['incidents.review', 'marks.adjust.approve', 'letters.approve', 'appeals.decide', 'investigations.decide', 'safeguarding.escalate'] },
  { to: '/appeals', label: 'nav.appeals', icon: FileText, permission: 'appeals.view' },
  { to: '/reports', label: 'nav.reports', icon: FileText, permission: 'reports.view' },
  { to: '/attendance', label: 'nav.attendance', icon: LayoutDashboard, permission: 'attendance.view' },
  { to: '/boarding', label: 'nav.boarding', icon: LayoutDashboard, permission: 'boarding.view' },
  { to: '/welfare', label: 'nav.welfare', icon: HeartHandshake, permission: ['welfare.view', 'welfare.refer', 'detention.view'] },
  { to: '/risk', label: 'nav.risk', icon: ShieldAlert, permission: 'risk.view' },
  { to: '/safeguarding', label: 'nav.safeguarding', icon: ShieldAlert, permission: 'safeguarding.view' },
  { to: '/investigations', label: 'nav.investigations', icon: Activity, permission: 'investigations.view' },
  { to: '/meetings', label: 'nav.meetings', icon: LayoutDashboard, permission: 'meetings.view' },
  { to: '/promotions', label: 'nav.promotions', icon: ArrowUpRight, permission: 'students.view' },
  { to: '/evidence', label: 'nav.evidence', icon: FileText, permission: 'evidence.view' },
  { to: '/policies', label: 'nav.policies', icon: FileText, permission: 'policies.view' },
  { to: '/structure', label: 'nav.structure', icon: Activity, permission: ['classes.view', 'academic_years.manage', 'dormitories.view'] },
  { to: '/users', label: 'nav.users', icon: Users, permission: 'users.view' },
  { to: '/data-protection', label: 'nav.data', icon: ShieldAlert, permission: 'data_protection.view' },
  { to: '/audit', label: 'nav.audit', icon: Database, permission: 'audit.view' },
  { to: '/monitoring', label: 'nav.monitoring', icon: Activity, permission: 'system.monitor' },
  { to: '/settings', label: 'nav.settings', icon: Settings2, permission: 'settings.manage' },
  { to: '/profile', label: 'My profile', icon: UserRound },
]

const PARENT_MORE_ITEMS: NavItem[] = [
  { to: '/portal', label: 'nav.portal', icon: Home },
  { to: '/communications', label: 'nav.communications', icon: Bell, permission: 'notifications.view' },
  { to: '/profile', label: 'My profile', icon: UserRound },
]

const MORE_MENU_KEY = 'nav.more'

export function MobileBottomNav() {
  const { me, has, logout } = useAuth()
  const { t, language, setLanguage } = useI18n()
  const location = useLocation()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  const isParent = Boolean(
    me?.roles.includes('PARENT') &&
    !me?.roles.some((r) => ['ADMIN', 'HEADTEACHER', 'TEACHER', 'DEPUTY_DISCIPLINE'].includes(r)),
  )

  const bottomItems = (isParent ? PARENT_BOTTOM_ITEMS : BOTTOM_NAV_ITEMS).filter(
    (item) => !item.permission || has(item.permission),
  )
  const moreItems = (isParent ? PARENT_MORE_ITEMS : MORE_MENU_ITEMS).filter(
    (item) => !item.permission || has(item.permission),
  )
  const filteredMoreItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return moreItems
    return moreItems.filter((item) => t(item.label).toLocaleLowerCase().includes(query))
  }, [moreItems, search, t])

  useEffect(() => {
    setMoreOpen(false)
    setSearch('')
  }, [location.pathname])

  useEffect(() => {
    if (!moreOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [moreOpen])

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
      navigate('/login', { replace: true })
    } finally {
      setLoggingOut(false)
      setMoreOpen(false)
    }
  }

  return (
    <>
      <nav
        aria-label="Primary mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur-md dark:border-[#1f2f49] dark:bg-[#081426]/95 lg:hidden"
      >
        <div className="mx-auto flex h-16 max-w-xl items-stretch justify-around px-1">
          {bottomItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              aria-label={t(item.label)}
              className={({ isActive }) =>
                cn(
                  'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-semibold transition-colors',
                  isActive ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn('h-5 w-5', isActive && 'stroke-[2.5]')} />
                  <span className="max-w-full truncate">{t(item.label)}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[10px] font-semibold transition-colors',
              moreOpen ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400',
            )}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <MoreHorizontal className="h-5 w-5" />
            <span>{t(MORE_MENU_KEY) || 'More'}</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
            aria-label="Close navigation menu"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-more-title"
            className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-2xl border border-line bg-white shadow-2xl dark:border-[#26374f] dark:bg-[#101a2c]"
            style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4 dark:border-[#1f2f49]">
              <div>
                <h2 id="mobile-more-title" className="text-base font-semibold text-slate-900 dark:text-white">
                  {t(MORE_MENU_KEY) || 'More'}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">All areas available to your account</p>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-line px-4 py-3 dark:border-[#1f2f49]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search menu…"
                  aria-label="Search navigation menu"
                  className="h-11 w-full rounded-lg border border-line bg-slate-50 pl-9 pr-3 text-base text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-[#26374f] dark:bg-[#0c1524] dark:text-white"
                />
              </div>
            </div>

            <nav aria-label="More navigation" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3">
              {filteredMoreItems.length ? (
                filteredMoreItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                        isActive
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5',
                      )
                    }
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    <span className="truncate">{t(item.label)}</span>
                  </NavLink>
                ))
              ) : (
                <p className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  No matching sections. Try another search.
                </p>
              )}
            </nav>

            <div className="flex items-center gap-2 border-t border-line px-4 py-3 dark:border-[#26374f]">
              <button
                type="button"
                onClick={() => setLanguage(language === 'en' ? 'rw' : 'en')}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#2a3b55] dark:text-slate-200 dark:hover:bg-white/5"
              >
                <span>{language === 'en' ? 'EN' : 'RW'}</span>
                {language === 'en' ? 'Switch to Kinyarwanda' : 'Hindura mu Cyongereza'}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-50 px-3 text-sm font-semibold text-red-700 disabled:opacity-60 dark:bg-red-950/30 dark:text-red-300"
              >
                <LogOut className="h-4 w-4" />
                {loggingOut ? 'Signing out…' : t('action.signOut')}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
