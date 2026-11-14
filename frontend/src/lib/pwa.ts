import { useEffect, useState } from 'react'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'cn_pwa_install_dismissed'

function standalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

export function useServiceWorkerUpdate(): { updateReady: boolean; applyUpdate: () => void } {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
    let registration: ServiceWorkerRegistration | undefined
    let disposed = false

    const track = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller && !disposed) {
            setWaiting(installing)
          }
        })
      })
    }

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        registration = reg
        track(reg)
        void reg.update().catch(() => undefined)
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      registration = undefined
    }
  }, [])

  const applyUpdate = () => {
    if (!waiting) return
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
    waiting.postMessage('SKIP_WAITING')
  }

  return { updateReady: Boolean(waiting), applyUpdate }
}

export function useInstallPrompt(): {
  canInstall: boolean
  installed: boolean
  promptInstall: () => Promise<void>
  dismissInstall: () => void
} {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(standalone)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvent(e as InstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const promptInstall = async () => {
    if (!event) return
    await event.prompt()
    const choice = await event.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    setEvent(null)
  }

  const dismissInstall = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // Dismissal only lasts for this page without storage.
    }
  }

  return { canInstall: Boolean(event) && !installed && !dismissed, installed, promptInstall, dismissInstall }
}
