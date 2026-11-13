import type { ReactNode } from 'react'
import { GraduationCap, ShieldCheck } from 'lucide-react'
import { ImigongoBand } from '../Imigongo'
import { Footer } from '../Footer'

const HIGHLIGHTS = [
  'Immutable conduct ledger with independent approvals',
  'Safeguarding, appeals and investigations in one place',
  'Rwanda-aligned data protection and role-based access',
]

export function AuthLayout({
  children,
  eyebrow,
  title,
  subtitle,
}: {
  children: ReactNode
  eyebrow?: string
  title: string
  subtitle?: string
}) {
  return (
    <div className="auth-canvas flex min-h-screen flex-col">
      <div className="mx-auto grid w-full max-w-6xl flex-1 items-stretch gap-0 px-4 py-6 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:py-12">
        <aside className="relative hidden overflow-hidden rounded-2xl bg-navy-900 p-10 text-white shadow-lift lg:flex lg:flex-col">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-cyan-accent shadow-lg shadow-brand-900/50">
              <GraduationCap className="h-6 w-6" />
            </span>
            <div>
              <p className="font-display text-lg font-semibold leading-tight">
                Conduct<span className="text-ochre-400">Nexus</span>
              </p>
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">School discipline, done right</p>
            </div>
          </div>

          <div className="mt-12 max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ochre-300">Built for Rwandan schools</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight">
              Fair, transparent and accountable conduct management.
            </h2>
            <ul className="mt-8 space-y-4">
              {HIGHLIGHTS.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-slate-300">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-accent" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-auto">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Imigongo pattern</p>
            <p className="mt-1 text-xs text-slate-400">
              A traditional Rwandan geometric art form, honoured in the texture of this platform.
            </p>
            <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
              <ImigongoBand className="h-14" />
            </div>
          </div>
        </aside>

        <main className="flex flex-col justify-center">
          <div className="mx-auto w-full max-w-md">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-cyan-accent text-white">
                <GraduationCap className="h-5 w-5" />
              </span>
              <p className="font-display text-lg font-semibold">
                Conduct<span className="text-ochre-500">Nexus</span>
              </p>
            </div>
            <div className="surface animate-fadeUp p-6 sm:p-8">
              {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ochre-500">{eyebrow}</p>}
              <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
              {subtitle && <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
              <div className="mt-6">{children}</div>
            </div>
          </div>
        </main>
      </div>
      <div className="mt-6 hidden lg:block">
        <Footer />
      </div>
      <div className="lg:hidden">
        <Footer compact />
      </div>
    </div>
  )
}
