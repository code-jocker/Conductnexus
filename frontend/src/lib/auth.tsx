import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { io, type Socket } from 'socket.io-client'
import { get, post, setToken, getToken } from './api'
import { signInWithGoogle } from './firebase'
import type { Me } from './types'

export type TwoFactorChannel = 'email' | 'whatsapp'

type LoginResponse = {
  accessToken?: string
  user?: Me['user']
  roles?: string[]
  permissions?: string[]
  twoFactorRequired?: boolean
  canTrustDevice?: boolean
  challenge?: string
  email?: string
  name?: string
  channel?: TwoFactorChannel
  channels?: TwoFactorChannel[]
  maskedDestination?: string
  delivered?: boolean
  warning?: string
  devCode?: string
  isNew?: boolean
  hasAccess?: boolean
  message?: string
}

export type TwoFactorChallenge = {
  challenge: string
  canTrustDevice?: boolean
  email: string
  name?: string
  channel: TwoFactorChannel
  channels: TwoFactorChannel[]
  maskedDestination: string
  delivered: boolean
  warning?: string
  devCode?: string
}

export type TwoFactorDeliveryInfo = Omit<TwoFactorChallenge, 'challenge' | 'email' | 'name'>

export type LoginResult =
  | { status: 'authenticated'; me: Me }
  | ({ status: 'two_factor_required' } & TwoFactorChallenge)

export type GoogleLoginResult =
  | { status: 'authenticated'; me: Me; hasAccess: boolean; message?: string }
  | ({ status: 'two_factor_required' } & TwoFactorChallenge)

function toChallenge(data: LoginResponse, fallbackEmail: string): TwoFactorChallenge {
  return {
    challenge: data.challenge ?? '',
    canTrustDevice: Boolean(data.canTrustDevice),
    email: data.email ?? fallbackEmail,
    name: data.name,
    channel: data.channel ?? 'email',
    channels: data.channels?.length ? data.channels : ['email'],
    maskedDestination: data.maskedDestination ?? data.email ?? fallbackEmail,
    delivered: Boolean(data.delivered),
    warning: data.warning,
    devCode: data.devCode,
  }
}

type AuthValue = {
  me: Me | null
  loading: boolean
  socket: Socket | null
  login: (email: string, password: string, channel?: TwoFactorChannel) => Promise<LoginResult>
  verifyTwoFactor: (challenge: string, code: string, trustDevice?: boolean) => Promise<Me>
  resendTwoFactor: (challenge: string, channel: TwoFactorChannel) => Promise<TwoFactorDeliveryInfo>
  loginWithGoogle: (channel?: TwoFactorChannel) => Promise<GoogleLoginResult>
  logout: () => Promise<void>
  refreshMe: () => Promise<void>
  has: (permission: string | string[]) => boolean
  hasRole: (role: string | string[]) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [socket, setSocket] = useState<Socket | null>(null)
  const queryClient = useQueryClient()

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setMe(null)
      return
    }
    try {
      setMe(await get<Me>('/auth/me'))
    } catch {
      setMe(null)
      setToken(null)
    }
  }, [])

  useEffect(() => {
    refreshMe().finally(() => setLoading(false))
  }, [refreshMe])

  useEffect(() => {
    if (!me) {
      setSocket((current) => {
        current?.disconnect()
        return null
      })
      return
    }
    const token = getToken()
    const url = import.meta.env.VITE_SOCKET_URL || window.location.origin
    const s = io(url, { path: '/socket.io', auth: { token }, transports: ['polling', 'websocket'] })
    setSocket(s)
    return () => {
      s.disconnect()
      setSocket(null)
    }
  }, [me])

  const login = useCallback(
    async (email: string, password: string, channel?: TwoFactorChannel): Promise<LoginResult> => {
      const data = await post<LoginResponse>('/auth/login', { email, password, channel })
      if (data.twoFactorRequired && data.challenge) {
        return { status: 'two_factor_required', ...toChallenge(data, email) }
      }
      if (!data.accessToken || !data.user) throw new Error('Sign-in failed. Please try again.')
      setToken(data.accessToken)
      const next: Me = { user: data.user, roles: data.roles ?? [], permissions: data.permissions ?? [] }
      queryClient.clear()
      setMe(next)
      return { status: 'authenticated', me: next }
    },
    [queryClient],
  )

  const verifyTwoFactor = useCallback(
    async (challenge: string, code: string, trustDevice = false) => {
      const data = await post<{ accessToken: string; user: Me['user']; roles: string[]; permissions: string[] }>(
        '/auth/2fa/verify',
        { challenge, code, trustDevice },
      )
      setToken(data.accessToken)
      const next: Me = { user: data.user, roles: data.roles, permissions: data.permissions }
      queryClient.clear()
      setMe(next)
      return next
    },
    [queryClient],
  )

  const resendTwoFactor = useCallback(async (challenge: string, channel: TwoFactorChannel) => {
    const data = await post<{
      channel: TwoFactorChannel
      channels: TwoFactorChannel[]
      maskedDestination: string
      delivered: boolean
      warning?: string
      devCode?: string
    }>('/auth/2fa/resend', { challenge, channel })
    return {
      channel: data.channel,
      channels: data.channels?.length ? data.channels : [data.channel],
      maskedDestination: data.maskedDestination,
      delivered: data.delivered,
      warning: data.warning,
      devCode: data.devCode,
    }
  }, [])

  const loginWithGoogle = useCallback(
    async (channel?: TwoFactorChannel): Promise<GoogleLoginResult> => {
      const idToken = await signInWithGoogle()
      const data = await post<LoginResponse>('/auth/google', { idToken, channel })
      if (data.twoFactorRequired && data.challenge) {
        return { status: 'two_factor_required', ...toChallenge(data, data.email ?? '') }
      }
      if (!data.accessToken) {
        throw new Error(data.message ?? 'This Google account is not linked to a ConductNexus user.')
      }
      setToken(data.accessToken)
      const next: Me = { user: data.user!, roles: data.roles ?? [], permissions: data.permissions ?? [] }
      queryClient.clear()
      setMe(next)
      return { status: 'authenticated', me: next, hasAccess: Boolean(data.hasAccess), message: data.message }
    },
    [queryClient],
  )

  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => undefined)
    setToken(null)
    queryClient.clear()
    setMe(null)
    socket?.disconnect()
  }, [queryClient, socket])

  const has = useCallback(
    (permission: string | string[]) => {
      if (!me) return false
      const list = Array.isArray(permission) ? permission : [permission]
      return list.some((p) => me.permissions.includes(p))
    },
    [me],
  )

  const hasRole = useCallback(
    (role: string | string[]) => {
      if (!me) return false
      const list = Array.isArray(role) ? role : [role]
      return list.some((r) => (me.roles as string[]).includes(r))
    },
    [me],
  )

  const value = useMemo<AuthValue>(
    () => ({ me, loading, socket, login, verifyTwoFactor, resendTwoFactor, loginWithGoogle, logout, refreshMe, has, hasRole }),
    [me, loading, socket, login, verifyTwoFactor, resendTwoFactor, loginWithGoogle, logout, refreshMe, has, hasRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
