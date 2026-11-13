import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Compass, Home } from 'lucide-react'
import { Button, Card } from '../components/ui'
import { ImigongoBand } from '../components/Imigongo'

const SUGGESTIONS = [
  { to: '/', label: 'Dashboard', hint: 'Your daily conduct overview' },
  { to: '/incidents', label: 'Incidents', hint: 'Browse and record behaviour incidents' },
  { to: '/students', label: 'Students', hint: 'Find a learner and their ledger' },
  { to: '/reports', label: 'Reports', hint: 'Term, class and communication reports' },
]

export function NotFoundPage() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div className="mx-auto max-w-2xl py-10">
      <Card className="overflow-hidden">
        <ImigongoBand className="h-2" />
        <div className="p-6 sm:p-10">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ochre-500/10 text-ochre-600 dark:text-ochre-300">
            <Compass className="h-6 w-6" />
          </span>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-ochre-500">Error 404</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">This page could not be found</h1>
          <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
            The address <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-700 dark:bg-white/10 dark:text-slate-200">{location.pathname}</code>{' '}
            does not match any page in ConductNexus. It may have been renamed, or the link may be incomplete.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button icon={Home} onClick={() => navigate('/')}>Go to dashboard</Button>
            <Button variant="secondary" icon={ArrowLeft} onClick={() => navigate(-1)}>Go back</Button>
          </div>

          <div className="mt-8 grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-xl border border-line p-3 transition hover:border-brand-300 hover:bg-brand-50/50 dark:border-[#1f2f49] dark:hover:border-brand-800 dark:hover:bg-brand-950/20"
              >
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.label}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{item.hint}</p>
              </Link>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}
