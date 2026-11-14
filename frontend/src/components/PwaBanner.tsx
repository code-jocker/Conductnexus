import { CloudOff, Download, RefreshCw, X } from 'lucide-react'
import { useInstallPrompt, useOnlineStatus, useServiceWorkerUpdate } from '../lib/pwa'

export function PwaBanner() {
  const online = useOnlineStatus()
  const { updateReady, applyUpdate } = useServiceWorkerUpdate()
  const { canInstall, promptInstall, dismissInstall } = useInstallPrompt()

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4 print:hidden">
      {!online ? (
        <div className="pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border border-ochre-300 bg-ochre-500/10 px-4 py-3 text-xs text-ochre-600 shadow-lift dark:border-ochre-600 dark:bg-ochre-500/15 dark:text-ochre-300">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            You are offline. Pages already opened stay available, and incident drafts saved on this device will sync
            when the connection returns.
          </span>
        </div>
      ) : null}

      {updateReady ? (
        <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-brand-200 bg-white px-4 py-3 text-xs text-slate-700 shadow-lift dark:border-brand-900 dark:bg-[#101a2c] dark:text-slate-200">
          <RefreshCw className="h-4 w-4 shrink-0 text-brand-600" />
          <span className="flex-1">A new version of ConductNexus is ready.</span>
          <button
            type="button"
            onClick={applyUpdate}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-brand-700"
          >
            Reload
          </button>
        </div>
      ) : null}

      {canInstall ? (
        <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 text-xs text-slate-700 shadow-lift dark:border-[#26374f] dark:bg-[#101a2c] dark:text-slate-200">
          <Download className="h-4 w-4 shrink-0 text-brand-600" />
          <span className="flex-1">Install ConductNexus for faster access and offline incident drafts.</span>
          <button
            type="button"
            onClick={() => void promptInstall()}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-brand-700"
          >
            Install
          </button>
          <button
            type="button"
            onClick={dismissInstall}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5"
            aria-label="Dismiss install prompt"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
