import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { deviceInfo, getRefreshToken, setRefreshToken } from '../auth/storage'
import type { ApiEnvelope, SessionPayload } from './types'

const baseURL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'

export const api = axios.create({
  baseURL,
  timeout: 20_000,
  headers: { Accept: 'application/json' },
})

let accessToken: string | null = null
let sessionId: string | null = null
let sessionExpiredHandler: (() => void) | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function setSessionId(id: string | null) {
  sessionId = id
}

export function getSessionId() {
  return sessionId
}

export function onSessionExpired(handler: (() => void) | null) {
  sessionExpiredHandler = handler
}

type RetryConfig = InternalAxiosRequestConfig & { _retried?: boolean }

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await getRefreshToken()
  if (!refreshToken) return null
  try {
    const device = await deviceInfo()
    const res = await axios.post<ApiEnvelope<SessionPayload>>(
      `${baseURL}/auth/native/refresh`,
      { refreshToken, device },
      { headers: { 'Content-Type': 'application/json' }, timeout: 20_000 },
    )
    const data = res.data.data
    await setRefreshToken(data.refreshToken)
    setAccessToken(data.accessToken)
    setSessionId(data.sessionId)
    return data.accessToken
  } catch {
    return null
  }
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiEnvelope<unknown>>) => {
    const config = error.config as RetryConfig | undefined
    const status = error.response?.status
    const isAuthCall = Boolean(config?.url?.includes('/auth/native/'))
    if (status !== 401 || !config || config._retried || isAuthCall) {
      if (status === 401 && !isAuthCall) sessionExpiredHandler?.()
      return Promise.reject(error)
    }
    config._retried = true
    refreshPromise = refreshPromise ?? refreshAccessToken().finally(() => {
      refreshPromise = null
    })
    const token = await refreshPromise
    if (!token) {
      sessionExpiredHandler?.()
      return Promise.reject(error)
    }
    config.headers.Authorization = `Bearer ${token}`
    return api(config)
  },
)

export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const envelope = error.response?.data as ApiEnvelope<unknown> | undefined
    if (envelope?.error?.message) return envelope.error.message
    if (error.code === 'ECONNABORTED') return 'The request timed out. Check your connection and try again.'
    if (!error.response)
      return `Cannot reach the server (${baseURL}). If you are on a phone/emulator, set EXPO_PUBLIC_API_URL in mobile/.env to your computer’s LAN IP or deployed API URL, then restart Expo.`
  }
  if (error instanceof Error && error.message) return error.message
  return 'Something went wrong. Please try again.'
}

export function apiBaseUrl() {
  return baseURL
}
