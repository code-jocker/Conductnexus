import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { io, type Socket } from 'socket.io-client'
import { get, post, setToken, getToken } from './api'
import { signInWithGoogle } from './firebase'
import type { Me } from './types'

type LoginResponse = {
  accessToken?: string
  user?: Me['user']
  roles?: string[]
  permissions?: string[]
  twoFactorRequired?: boolean
  challenge?: string
  email?: string
  delivered?: boolean
  devCode?: string
}

export type LoginResult =
  | { status: 'authenticated'; me: Me }
  | { status: 'two_factor_required'; challenge: string; email: string; delivered: boolean; devCode?: string }

type AuthValue = {
  me: Me | null
  loading: boolean
  socket: Socket | null
  login: (email: string, password: string) => Promise<LoginResult>
  verifyTwoFactor: (challenge: string, code: string) => Promise<Me>
  loginWithGoogle: () => Promise<{ me: Me | null; hasAccess: boolean; message?: string }>
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
    const s = io(url, { path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'] })
    setSocket(s)
    return () => {
      s.disconnect()
      setSocket(null)
    }
  }, [me])

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const data = await post<LoginResponse>('/auth/login', { email, password })
      if (data.twoFactorRequired && data.challenge) {
        return {
          status: 'two_factor_required',
          challenge: data.challenge,
          email: data.email ?? email,
          delivered: Boolean(data.delivered),
          devCode: data.devCode,
        }
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
    async (challenge: string, code: string) => {
      const data = await post<{ accessToken: string; user: Me['user']; roles: string[]; permissions: string[] }>(
        '/auth/2fa/verify',
        { challenge, code },
      )
      setToken(data.accessToken)
      const next: Me = { user: data.user, roles: data.roles, permissions: data.permissions }
      queryClient.clear()
      setMe(next)
      return next
    },
    [queryClient],
  )

  const loginWithGoogle = useCallback(async () => {
    const idToken = await signInWithGoogle()
    const data = await post<{
      accessToken?: string
      user?: Me['user']
      roles?: string[]
      permissions?: string[]
      isNew?: boolean
      hasAccess?: boolean
      message?: string
    }>('/auth/google', { idToken })
    if (!data.accessToken) {
      return { me: null, hasAccess: false, message: data.message ?? 'This Google account is not linked to a ConductNexus user.' }
    }
    setToken(data.accessToken)
    const next: Me = { user: data.user!, roles: data.roles ?? [], permissions: data.permissions ?? [] }
    queryClient.clear()
    setMe(next)
    return { me: next, hasAccess: true, message: data.message }
  }, [queryClient])

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
    () => ({ me, loading, socket, login, verifyTwoFactor, loginWithGoogle, logout, refreshMe, has, hasRole }),
    [me, loading, socket, login, verifyTwoFactor, loginWithGoogle, logout, refreshMe, has, hasRole],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
