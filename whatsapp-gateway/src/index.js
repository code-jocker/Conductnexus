import path from 'node:path'
import express from 'express'
import QRCode from 'qrcode'

const PORT = Number(process.env.PORT || 3100)
const TOKEN = process.env.GATEWAY_TOKEN || ''
const SESSION_DIR = path.resolve(process.env.SESSION_DIR || './storage/whatsapp-session')
const SESSION_NAME = process.env.SESSION_NAME || 'conductnexus'
const CHROME_PATH = process.env.CHROME_PATH || ''
const AUTO_CONNECT = process.env.AUTO_CONNECT !== 'false'
const RECONNECT_MAX_MS = Number(process.env.RECONNECT_MAX_MS || 60_000)

if (TOKEN.length < 24) {
  console.error('GATEWAY_TOKEN must be set to at least 24 characters. Refusing to start.')
  process.exit(1)
}

let client = null
let reconnectTimer = null
let reconnectAttempts = 0
let shuttingDown = false

let state = {
  status: 'disconnected',
  qrDataUrl: null,
  pairingCode: null,
  pairingPhone: null,
  lastQrAt: null,
  lastConnectedAt: null,
  lastError: null,
  info: null,
}

let cachedStatus = null
let cachedStatusAt = 0
const STATUS_CACHE_TTL_MS = 5_000

function markStale() {
  cachedStatus = null
  cachedStatusAt = 0
}

function setState(patch) {
  state = { ...state, ...patch }
  markStale()
}

function errorText(err) {
  return err instanceof Error ? err.message : String(err ?? 'Unknown error')
}

async function retire(current) {
  if (client === current) client = null
  try {
    await current?.destroy?.()
  } catch (err) {
    console.warn('WhatsApp browser destroy failed:', errorText(err))
  }
}

function scheduleReconnect() {
  if (shuttingDown || !AUTO_CONNECT || reconnectTimer) return
  const delay = Math.min(5_000 * 2 ** reconnectAttempts, RECONNECT_MAX_MS)
  reconnectAttempts += 1
  console.log(`WhatsApp reconnect scheduled in ${delay}ms (attempt ${reconnectAttempts})`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    start().catch((err) => console.error('WhatsApp reconnect failed:', errorText(err)))
  }, delay)
}

async function start(phoneNumber) {
  if (shuttingDown) return { status: state.status, message: 'Gateway is shutting down.' }
  const pairPhone = String(phoneNumber || '').replace(/[^\d]/g, '')

  if (client) {
    if (!pairPhone || state.status === 'ready') {
      return { status: state.status, message: 'WhatsApp session already initialized.' }
    }
    await stop({ reason: 'Switching to phone pairing' })
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const { default: whatsappWeb } = await import('whatsapp-web.js')
  const { Client, LocalAuth } = whatsappWeb

  const instance = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR, clientId: SESSION_NAME }),
    authTimeoutMs: 300_000,
    ...(pairPhone
      ? { pairWithPhoneNumber: { phoneNumber: pairPhone, showNotification: true, intervalMs: 180_000 } }
      : {}),
    puppeteer: {
      headless: true,
      ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=IsolateOrigins,site-per-process',
        '--single-process',
        '--no-zygote',
        '--disable-background-timer-throttling',
      ],
      defaultNavigationTimeout: 20_000,
    },
  })

  client = instance
  setState({
    status: 'initializing',
    qrDataUrl: null,
    pairingCode: null,
    pairingPhone: pairPhone || null,
    lastError: null,
  })

  const isCurrent = () => client === instance

  instance.on('qr', async (qr) => {
    if (!isCurrent()) return
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 })
      setState({
        status: 'qr',
        qrDataUrl,
        lastQrAt: new Date().toISOString(),
        pairingCode: null,
        lastError: null,
      })
    } catch (err) {
      console.warn('QR generation failed:', errorText(err))
    }
  })

  instance.on('code', (code) => {
    if (!isCurrent()) return
    setState({ status: 'pairing', pairingCode: code, qrDataUrl: null, lastError: null })
  })

  instance.on('ready', () => {
    if (!isCurrent()) return
    reconnectAttempts = 0
    setState({
      status: 'ready',
      lastConnectedAt: new Date().toISOString(),
      qrDataUrl: null,
      pairingCode: null,
      lastError: null,
      info: {
        pushname: instance.info?.pushname,
        number: instance.info?.wid?.user,
      },
    })
    console.log('WhatsApp session ready')
  })

  instance.on('auth_failure', async (message) => {
    if (!isCurrent()) return
    await retire(instance)
    setState({ status: 'auth_failure', lastError: errorText(message) })
    scheduleReconnect()
  })

  instance.on('disconnected', async (reason) => {
    if (!isCurrent()) return
    await retire(instance)
    setState({ status: 'disconnected', lastError: errorText(reason) })
    scheduleReconnect()
  })

  instance.initialize().catch(async (err) => {
    console.error('WhatsApp initialization failed:', errorText(err))
    if (!isCurrent()) return
    await retire(instance)
    setState({ status: 'failed', lastError: errorText(err) })
    scheduleReconnect()
  })

  return {
    status: 'initializing',
    message: pairPhone
      ? 'Connecting to WhatsApp. A pairing code will appear shortly.'
      : 'Connecting to WhatsApp. A QR code will appear shortly.',
  }
}

async function stop({ reason } = {}) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempts = 0
  const current = client
  client = null
  try {
    await current?.destroy?.()
  } catch (err) {
    console.warn('WhatsApp destroy failed:', errorText(err))
  }
  setState({ status: 'disconnected', qrDataUrl: null, pairingCode: null, lastError: reason ?? null })
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: state.status })
})

app.use((req, res, next) => {
  const header = req.headers.authorization || ''
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
  const supplied = bearer || req.headers['x-gateway-token']
  if (supplied !== TOKEN) {
    res.status(401).json({ ok: false, error: 'Unauthorized' })
    return
  }
  next()
})

function currentStatus() {
  const now = Date.now()
  if (cachedStatus && now - cachedStatusAt < STATUS_CACHE_TTL_MS) {
    return cachedStatus
  }
  const snapshot = { ...state, now: new Date().toISOString() }
  cachedStatus = snapshot
  cachedStatusAt = now
  return snapshot
}

app.get('/warm', (_req, res) => {
  res.json({ ok: true, cached: true, ...currentStatus() })
})

app.get('/status', (_req, res) => {
  res.json({ ok: true, ...currentStatus() })
})

app.get('/qr', (_req, res) => {
  res.json({
    ok: true,
    status: state.status,
    qrDataUrl: state.status === 'qr' ? state.qrDataUrl : null,
  })
})

app.post('/connect', async (req, res) => {
  try {
    const result = await start(req.body?.phoneNumber)
    res.json({ ok: true, ...result })
  } catch (err) {
    setState({ status: 'failed', lastError: errorText(err) })
    res.status(500).json({ ok: false, error: errorText(err) })
  }
})

app.post('/disconnect', async (_req, res) => {
  await stop()
  res.json({ ok: true, status: state.status })
})

app.post('/send', async (req, res) => {
  const to = req.body?.to
  const body = req.body?.body
  if (!to || !body) {
    res.status(400).json({ ok: false, error: 'Both "to" and "body" are required' })
    return
  }
  if (!client || state.status !== 'ready') {
    res.status(409).json({ ok: false, error: `WhatsApp is ${state.status}` })
    return
  }
  try {
    const number = String(to).replace(/[^\d]/g, '')
    if (number.length < 8) {
      res.status(400).json({ ok: false, error: 'Phone number is too short' })
      return
    }
    const message = await client.sendMessage(`${number}@c.us`, String(body))
    const providerMessageId =
      message?.id?._serialized ?? (message?.id?.id ? String(message.id.id) : undefined)
    res.json({ ok: true, providerMessageId })
  } catch (err) {
    res.status(502).json({ ok: false, error: errorText(err) })
  }
})

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' })
})

const server = app.listen(PORT, () => {
  console.log(`ConductNexus WhatsApp gateway listening on port ${PORT}`)
  console.log(`Session directory: ${SESSION_DIR}`)
  if (AUTO_CONNECT) {
    start().catch((err) => console.error('WhatsApp auto-connect failed:', errorText(err)))
  }
})

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`Received ${signal}; shutting down`)
  server.close()
  await stop({ reason: 'Gateway shutting down' })
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', errorText(err)))
