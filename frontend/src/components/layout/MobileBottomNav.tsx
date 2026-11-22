import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
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
} from 'lucide-react'
import { HeartHandshake } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useI18n } from '../../lib/i18n'
import { cn } from '../../lib/utils'

type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; permission?: string | string[]; roles?: string[] }

const BOTTOM_NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/students', label: 'nav.students', icon: GraduationCap, permission: 'students.view' },
  { to: '/incidents/new', label: 'nav.incidents', icon: ClipboardList, permission: 'incidents.create' },
  { to: '/communications', label: 'nav.communications', icon: Bell, permission: 'notifications.view' },
]

const MORE_MENU_ITEMS: NavItem[] = [
  { to: '/incidents', label: 'nav.incidents', icon: ClipboardList, permission: 'incidents.view' },
  { to: '/approvals', label: 'nav.approvals', icon: ShieldCheck, permission: ['incidents.review', 'marks.adjust.approve', 'letters.approve', 'appeals.decide', 'investigations.decide', 'safeguarding.escalate'] },
  { to: '/appeals', label: 'nav.appeals', icon: FileText, permission: 'appeals.view' },
  { to: '/communications', label: 'nav.communications', icon: UserRound, permission: 'notifications.view' },
  { to: '/reports', label: 'nav.reports', icon: FileText, permission: 'reports.view' },
  { to: '/attendance', label: 'nav.attendance', icon: LayoutDashboard, permission: 'attendance.view' },
  { to: '/settings', label: 'nav.settings', icon: Settings2, permission: 'settings.manage' },
  { to: '/users', label: 'nav.users', icon: Users, permission: 'users.view' },
  { to: '/audit', label: 'nav.audit', icon: Database, permission: 'audit.view' },
  { to: '/structure', label: 'nav.structure', icon: Activity, permission: ['classes.view', 'academic_years.manage', 'dormitories.view'] },
  { to: '/risk', label: 'nav.risk', icon: ShieldAlert, permission: 'risk.view' },
  { to: '/safeguarding', label: 'nav.safeguarding', icon: ShieldAlert, permission: 'safeguarding.view' },
  { to: '/investigations', label: 'nav.investigations', icon: Activity, permission: 'investigations.view' },
  { to: '/meetings', label: 'nav.meetings', icon: LayoutDashboard, permission: 'meetings.view' },
  { to: '/boarding', label: 'nav.boarding', icon: LayoutDashboard, permission: 'boarding.view' },
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
]

const MORE_MENU_KEY = 'nav.more'

export function MobileBottomNav() {
  const { me, has } = useAuth()
  const { t } = useI18n()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  const isParent = me?.roles.includes('PARENT') && !me?.roles.some((r) => ['ADMIN', 'HEADTEACHER', 'TEACHER', 'DEPUTY_DISCIPLINE'].includes(r))

  const bottomItems = BOTTOM_NAV_ITEMS.filter((item) => !item.permission || has(item.permission))
  const moreItems = (isParent ? PARENT_MORE_ITEMS : MORE_MENU_ITEMS).filter((item) => !item.permission || has(item.permission))

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-white/90 backdrop-blur-md dark:border-[#1f2f49] dark:bg-[#081426]/90 hidden sm:hidden lg:hidden md:hidden">
        <div className="flex items-center justify-around h-14 px-3">
          {bottomItems.map((item) => {
            const isActive = location.pathname === item.to || (item.to === '/' && location.pathname === '/')
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className="flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors"
              >
                <item.icon className={cn('h-5 w-5', isActive ? 'text-brand-600' : 'text-slate-500')} />
                <span className={cn(isActive ? 'text-brand-600' : 'text-slate-500')}>{t(item.label)}</span>
              </NavLink>
            )
          })}
        </div>
      </nav>

      <div className="fixed bottom-0 left-0 right-0 z-40 pb-8 hidden sm:hidden lg:hidden md:hidden">
        <div className="flex justify-center">
          <button
            className="relative inline-flex h-10 w-auto items-center justify-center rounded-full border border-line bg-white px-5 py-2 text-sm font-semibold text-slate-700 shadow-lift dark:border-[#2a3b55] dark:bg-[#101a2c] dark:text-slate-200"
            onClick={() => setMoreOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
          >
            <MoreHorizontal className="h-4 w-4 mr-1.5" />
            <span>{t(MORE_MENU_KEY) ?? 'More'}</span>
            <ChevronDown className={cn('h-3 w-3 ml-1', moreOpen ? 'rotate-180' : '')} />
          </button>
        </div>
      </div>

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
            <nav className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
              {moreItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive: active }) => cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                    active ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5',
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  <span className="truncate">{t(item.label)}</span>
                </NavLink>
              ))}
            </nav>
            <div className="border-t border-line px-4 py-3 dark:border-[#26374f]">
              <button
                onClick={() => setMoreOpen(false)}
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
