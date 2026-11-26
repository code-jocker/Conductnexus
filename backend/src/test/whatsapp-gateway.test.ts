import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import http from 'node:http'

const { getSettingsMock } = vi.hoisted(() => ({ getSettingsMock: vi.fn() }))
vi.mock('../models/core.js', () => ({ getSettings: getSettingsMock }))

// Set before importing the service so env.ts picks up gateway mode.
const PORT = 3999
const TOKEN = 'gateway-test-token-0123456789abcdef'
process.env.ENABLE_WHATSAPP = 'false'
process.env.WHATSAPP_GATEWAY_URL = `http://127.0.0.1:${PORT}`
process.env.WHATSAPP_GATEWAY_TOKEN = TOKEN

let server: http.Server
let service: typeof import('../services/communication.service.js')
const received: { authorization?: string; body: Record<string, unknown> }[] = []
let failNext = false

beforeAll(async () => {
  getSettingsMock.mockResolvedValue({ comms: { whatsappEnabled: true } })
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      received.push({ authorization: req.headers.authorization, body })
      if (failNext) {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: 'WhatsApp is starting' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, providerMessageId: 'wamid.TEST123' }))
    })
  })
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve))
  service = await import('../services/communication.service.js')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('WhatsApp gateway mode', () => {
  it('sends codes and notices through the remote gateway with the bearer token', async () => {
    const result = await service.sendWhatsAppText('250788000111', 'Your code is 123456')
    expect(result.ok).toBe(true)
    expect(result.provider).toBe('whatsapp')
    expect(result.providerMessageId).toBe('wamid.TEST123')

    const last = received.at(-1)
    expect(last?.authorization).toBe(`Bearer ${TOKEN}`)
    expect(last?.body).toEqual({ to: '250788000111', body: 'Your code is 123456' })
  })

  it('reports the gateway error when the phone is not ready', async () => {
    failNext = true
    const result = await service.sendWhatsAppText('250788000111', 'Hello')
    failNext = false
    expect(result.ok).toBe(false)
    expect(result.error).toContain('WhatsApp is starting')
  })

  it('treats WhatsApp as an available channel even though the local browser is off', () => {
    const delivery = service.deliveryBlockReason()
    expect(delivery.enabled).toBe(true)
    expect(delivery.ready).toBe(false)
    expect(delivery.reason).not.toContain('WhatsApp is disabled')
  })

  it('reuses cached settings while polling gateway status', async () => {
    await service.refreshCommsSettings()
    getSettingsMock.mockClear()

    await service.whatsappStatus()
    await service.whatsappStatus()

    expect(getSettingsMock).not.toHaveBeenCalled()
  })
})
