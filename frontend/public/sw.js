/* ConductNexus service worker: app-shell caching with an offline fallback.
   API and socket traffic is never cached. */
const VERSION = 'conductnexus-v1'
const SHELL_CACHE = `${VERSION}-shell`
const RUNTIME_CACHE = `${VERSION}-runtime`
const OFFLINE_URL = '/offline.html'
const PRECACHE = ['/', '/index.html', OFFLINE_URL, '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

function isAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    /\.(?:css|js|woff2?|ttf|png|jpg|jpeg|svg|webp|ico)$/i.test(url.pathname)
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => undefined)
          return response
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE)
          return (await cache.match('/index.html')) || (await cache.match(OFFLINE_URL)) || Response.error()
        }),
    )
    return
  }

  if (isAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined)
            }
            return response
          }),
      ),
    )
  }
})
