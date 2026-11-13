import { Link } from 'react-router-dom'
import { ImigongoBand } from './Imigongo'

export function Footer({ compact = false }: { compact?: boolean }) {
  return (
    <footer className="no-print mt-10">
      <ImigongoBand />
      <div className={`bg-navy-900 text-slate-300 ${compact ? 'px-4 py-4' : 'px-4 py-7 sm:px-8'}`}>
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
          <div>
            <p className="font-display text-sm font-semibold text-white">
              Conduct<span className="text-ochre-400">Nexus</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              Building Better Behaviour Through Connected School Discipline · Kigali, Rwanda
            </p>
          </div>
          <div className="text-[11px] text-slate-400">
            <p>
              &copy; {new Date().getFullYear()} ConductNexus. All rights reserved.
            </p>
            <p className="mt-0.5 text-slate-300">
              Powered by <span className="font-semibold text-ochre-300">Shyaka clever prince a.k.a Code jocker</span>
            </p>
            <p className="mt-1">
              <Link to="/privacy" className="hover:text-white">
                Data protection
              </Link>{' '}
              ·{' '}
              <Link to="/policies" className="hover:text-white">
                School policies
              </Link>{' '}
              ·{' '}
              <a href="/api/docs" className="hover:text-white">
                API docs
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}
