import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  Award,
  Bell,
  BookOpenCheck,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  CloudOff,
  Database,
  FileText,
  FolderLock,
  GraduationCap,
  Home,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Moon,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Settings2,
  Sun,
  Users,
  UserCog,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useTheme } from '../../lib/theme'
import { useI18n } from '../../lib/i18n'
import { get } from '../../lib/api'
import { cn, initials } from '../../lib/utils'
import type { Settings } from '../../lib/types'
import { Footer } from '../Footer'
import { IconButton } from '../ui'
import { NotificationsPanel, useUnreadCount } from './NotificationsPanel'

type NavItem = { to: string; label: string; icon: LucideIcon; permission?: string | string[]; roles?: string[] }

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [{ to: '/', label: 'nav.dashboard', icon: LayoutDashboard }],
  },
  {
    title: 'Discipline & care',
    items: [
      { to: '/students', label: 'nav.students', icon: GraduationCap, permission: 'students.view' },
      { to: '/incidents', label: 'nav.incidents', icon: ClipboardList, permission: 'incidents.view' },
      {
        to: '/approvals',
        label: 'nav.approvals',
        icon: ShieldCheck,
        permission: ['incidents.review', 'marks.adjust.approve', 'letters.approve', 'appeals.decide', 'investigations.decide', 'safeguarding.escalate'],
      },
      { to: '/risk', label: 'nav.risk', icon: Award, permission: 'risk.view' },
      { to: '/safeguarding', label: 'nav.safeguarding', icon: ShieldAlert, permission: 'safeguarding.view' },
      { to: '/investigations', label: 'nav.investigations', icon: Search, permission: 'investigations.view' },
      { to: '/appeals', label: 'nav.appeals', icon: FileText, permission: 'appeals.view' },
      { to: '/evidence', label: 'nav.evidence', icon: FolderLock, permission: 'evidence.view' },
    ],
  },
  {
    title: 'School operations',
    items: [
      { to: '/policies', label: 'nav.policies', icon: BookOpenCheck, permission: 'policies.view' },
      { to: '/meetings', label: 'nav.meetings', icon: CalendarDays, permission: 'meetings.view' },
      { to: '/communications', label: 'nav.communications', icon: MessageSquare, permission: 'notifications.view' },
      { to: '/reports', label: 'nav.reports', icon: FileText, permission: 'reports.view' },
      { to: '/drafts', label: 'nav.drafts', icon: CloudOff, permission: 'incidents.create' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/structure', label: 'nav.structure', icon: Users, permission: ['classes.view', 'academic_years.manage', 'dormitories.view'] },
      { to: '/users', label: 'nav.users', icon: UserCog, permission: 'users.view' },
      { to: '/data-protection', label: 'nav.data', icon: Shield, permission: 'data_protection.view' },
      { to: '/audit', label: 'nav.audit', icon: Database, permission: 'audit.view' },
      { to: '/monitoring', label: 'nav.monitoring', icon: Activity, permission: 'system.monitor' },
      { to: '/settings', label: 'nav.settings', icon: Settings2, permission: 'settings.manage' },
    ],
  },
]

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  HEADTEACHER: 'Headteacher',
  TEACHER: 'Teacher',
  DEPUTY_DISCIPLINE: 'Deputy — Discipline',
  IT: 'IT Officer',
  PATRON: 'Patron',
  MATRON: 'Matron',
  BURSAR: 'Bursar',
  DOS: 'Dean of Studies',
  LIBRARIAN: 'Librarian',
  SECRETARY: 'Secretary',
  PARENT: 'Parent / Guardian',
}

export function AppShell() {
  const { me, has, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const { language, setLanguage, t } = useI18n()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [schoolName, setSchoolName] = useState('ConductNexus')
  const { count } = useUnreadCount()
  const location = useLocation()
  const navigate = useNavigate()
  const userMenuRef = useRef<HTMLDivElement>(null)

  const isParent = me?.roles.includes('PARENT') && !me?.roles.some((r) => ['ADMIN', 'HEADTEACHER', 'TEACHER', 'DEPUTY_DISCIPLINE'].includes(r))

  useEffect(() => {
    get<Settings>('/settings')
      .then((s) => setSchoolName(s.school?.name || 'ConductNexus'))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    setMobileOpen(false)
    setUserMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const groups = useMemo(() => {
    if (isParent) {
      return [
        { title: 'Parent portal', items: [{ to: '/portal', label: 'nav.portal', icon: Home }] },
        { title: 'Communication', items: [{ to: '/communications', label: 'nav.communications', icon: Bell, permission: 'notifications.view' }] },
      ]
    }
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.to === '/approvals' && !me?.roles.some((r) => ['ADMIN', 'HEADTEACHER', 'DEPUTY_DISCIPLINE', 'DOS'].includes(r))) {
          return has(['incidents.review', 'marks.adjust.approve', 'letters.approve', 'appeals.decide', 'investigations.decide', 'safeguarding.escalate'])
        }
        if (item.roles && !item.roles.some((r) => (me?.roles as string[] | undefined)?.includes(r))) return false
        return !item.permission || has(item.permission)
      }),
    })).filter((group) => group.items.length > 0)
  }, [isParent, has, me?.roles])

  const primaryRole = me?.roles[0] ?? ''
  const displayName = me?.user.name ?? 'User'

  const sidebar = (
    <div className="flex h-full flex-col bg-navy-900 dark:bg-[#081426]">
      <div className="flex items-center justify-between px-4 pb-3 pt-5">
        <button onClick={() => navigate('/')} className="flex items-center gap-2.5 text-left">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-cyan-accent shadow-lg shadow-brand-900/40">
            <GraduationCap className="h-5 w-5 text-white" />
          </span>
          <span>
            <span className="block font-display text-[15px] font-semibold leading-tight text-white">
              Conduct<span className="text-ochre-400">Nexus</span>
            </span>
            <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">School discipline</span>
          </span>
        </button>
        <button className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="mx-4 mb-3 h-px bg-white/10" />
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{group.title}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => cn('nav-link', isActive && 'nav-link-active')}
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{t(item.label)}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 px-4 py-4">
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Signed in as</p>
        <p className="mt-1 truncate text-sm font-medium text-white">{displayName}</p>
        <p className="truncate text-[11px] text-slate-400">{ROLE_LABELS[primaryRole] ?? primaryRole}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-full bg-canvas dark:bg-[#081426]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 w-[280px] shadow-lift">{sidebar}</div>
        </div>
      ) : null}

      <div className="lg:pl-[264px]">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur dark:border-[#1f2f49] dark:bg-[#0c1524]/90">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{schoolName}</p>
              <p className="hidden text-[11px] text-slate-500 dark:text-slate-400 sm:block">
                {new Date().toLocaleDateString('en-RW', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kigali' })}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setLanguage(language === 'en' ? 'rw' : 'en')}
                className="hidden h-9 rounded-lg border border-line px-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-50 dark:border-[#2a3b55] dark:text-slate-300 dark:hover:bg-white/5 sm:block"
                title="Switch language"
              >
                {language === 'en' ? 'EN' : 'RW'}
              </button>
              <IconButton label={theme === 'dark' ? 'Use light mode' : 'Use dark mode'} onClick={toggle}>
                {theme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
              </IconButton>
              <button onClick={() => setNotificationsOpen(true)} className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5" aria-label="Notifications">
                <Bell className="h-[18px] w-[18px]" />
                {count > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-ochre-500 px-1 text-[9px] font-bold text-white">{count > 99 ? '99+' : count}</span>
                ) : null}
              </button>
              <div className="relative" ref={userMenuRef}>
                <button onClick={() => setUserMenuOpen((v) => !v)} className="flex items-center gap-2 rounded-lg p-1 pl-1.5 hover:bg-slate-100 dark:hover:bg-white/5" aria-haspopup="menu" aria-expanded={userMenuOpen}>
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-navy-900 text-[11px] font-bold text-white dark:bg-brand-600">
                    {initials(displayName)}
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block max-w-[140px] truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{displayName}</span>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400">{ROLE_LABELS[primaryRole] ?? primaryRole}</span>
                  </span>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 sm:block" />
                </button>
                {userMenuOpen ? (
                  <div className="absolute right-0 top-11 w-56 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lift dark:border-[#2a3b55] dark:bg-[#101a2c]" role="menu">
                    <div className="border-b border-line px-3 py-2 dark:border-[#1f2f49]">
                      <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{displayName}</p>
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{me?.user.email}</p>
                    </div>
                    <button onClick={() => navigate('/profile')} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5">
                      <UserRound className="h-4 w-4" /> My profile
                    </button>
                    <button onClick={() => navigate('/change-password')} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5">
                      <Shield className="h-4 w-4" /> Change password
                    </button>
                    {!me?.user.emailVerified ? (
                      <button onClick={() => navigate('/verify-email')} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30">
                        <Mail className="h-4 w-4" /> Verify email
                      </button>
                    ) : null}
                    <div className="my-1 h-px bg-line dark:bg-[#1f2f49]" />
                    <button
                      onClick={async () => {
                        await logout()
                        navigate('/login')
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      <LogOut className="h-4 w-4" /> {t('action.signOut')}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto min-h-[calc(100vh-8rem)] w-full max-w-[1440px] px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>
        <div className="mx-auto w-full max-w-[1440px]">
          <Footer />
        </div>
      </div>

      <NotificationsPanel open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </div>
  )
}
