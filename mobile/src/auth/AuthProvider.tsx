import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { setAccessToken, setSessionId, onSessionExpired } from '../api/client'
import { fetchMe, nativeGoogle, nativeLogin, nativeLogout, nativeRefresh, nativeTwoFactorResend, nativeTwoFactorVerify, type TwoFactorChallenge, type TwoFactorChannel } from '../api/endpoints'
import type { MePayload, SessionPayload, SessionUser } from '../api/types'
import { getBiometricsEnabled, getRefreshToken, setRefreshToken, clearRefreshToken } from './storage'
import { biometricsAvailable, unlockWithBiometrics } from './biometrics'
import { setupPushNotifications } from '../notifications/push'

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn'

type AuthContextValue = {
  status: AuthStatus
  user: SessionUser | null
  roles: string[]
  permissions: string[]
  schoolName: string
  biometricsLocked: boolean
  biometricsSupported: boolean
  isParentOnly: boolean
  has: (permission: string) => boolean
  signIn: (email: string, password: string, channel?: TwoFactorChannel) => Promise<TwoFactorChallenge | null>
  verifyTwoFactor: (challenge: string, code: string) => Promise<void>
  resendTwoFactor: (challenge: string, channel: TwoFactorChannel) => Promise<Omit<TwoFactorChallenge, 'twoFactorRequired' | 'challenge' | 'email' | 'name'>>
  signInWithGoogleToken: (idToken: string, channel?: TwoFactorChannel) => Promise<TwoFactorChallenge | null>
  signOut: () => Promise<void>
  unlockWithBiometric: () => Promise<boolean>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function parentOnly(roles: string[], permissions: string[]): boolean {
  if (roles.includes('PARENT') && !permissions.includes('students.view') && !permissions.includes('incidents.view')) {
    return true
  }
  return permissions.includes('portal.view_children') && !permissions.includes('students.view') && !permissions.includes('incidents.view')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)
  const [roles, setRoles] = useState<string[]>([])
  const [permissions, setPermissions] = useState<string[]>([])
  const [schoolName, setSchoolName] = useState('ConductNexus')
  const [biometricsLocked, setBiometricsLocked] = useState(false)
  const [biometricsSupported, setBiometricsSupported] = useState(false)
  const mounted = useRef(true)

  const applyMe = useCallback((me: MePayload) => {
    setUser(me.user)
    setRoles(me.roles)
    setPermissions(me.permissions)
    setSchoolName(me.setup.schoolName || 'ConductNexus')
  }, [])

  const finishSession = useCallback(
    async (payload: SessionPayload) => {
      await setRefreshToken(payload.refreshToken)
      setAccessToken(payload.accessToken)
      setSessionId(payload.sessionId)
      const me = await fetchMe()
      applyMe(me)
      if (mounted.current) setStatus('signedIn')
    },
    [applyMe],
  )

  const clearSession = useCallback(async () => {
    setAccessToken(null)
    setSessionId(null)
    setUser(null)
    setRoles([])
    setPermissions([])
    await clearRefreshToken()
    queryClient.clear()
    if (mounted.current) {
      setBiometricsLocked(false)
      setStatus('signedOut')
    }
  }, [queryClient])

  useEffect(() => {
    mounted.current = true
    onSessionExpired(() => {
      void clearSession()
    })
    return () => {
      mounted.current = false
      onSessionExpired(null)
    }
  }, [clearSession])

  useEffect(() => {
    biometricsAvailable().then((available) => {
      if (mounted.current) setBiometricsSupported(available)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      const refreshToken = await getRefreshToken()
      if (!refreshToken) {
        if (!cancelled && mounted.current) setStatus('signedOut')
        return
      }
      const biometricsEnabled = await getBiometricsEnabled()
      if (biometricsEnabled) {
        const ok = await unlockWithBiometrics()
        if (!ok) {
          if (!cancelled && mounted.current) {
            setBiometricsLocked(true)
            setStatus('signedOut')
          }
          return
        }
      }
      try {
        const payload = await nativeRefresh(refreshToken)
        await finishSession(payload)
      } catch {
        await clearSession()
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [clearSession, finishSession])

  useEffect(() => {
    if (status === 'signedIn') {
      void setupPushNotifications().catch(() => undefined)
    }
  }, [status])

  const signIn = useCallback(
    async (email: string, password: string, channel?: TwoFactorChannel) => {
      const result = await nativeLogin(email.trim().toLowerCase(), password, channel)
      if ('challenge' in result) {
        return result
      }
      await finishSession(result)
      queryClient.clear()
      return null
    },
    [finishSession, queryClient],
  )

  const verifyTwoFactor = useCallback(
    async (challenge: string, code: string) => {
      const payload = await nativeTwoFactorVerify(challenge, code)
      await finishSession(payload)
      queryClient.clear()
    },
    [finishSession, queryClient],
  )

  const resendTwoFactor = useCallback(
    (challenge: string, channel: TwoFactorChannel) => nativeTwoFactorResend(challenge, channel),
    [],
  )

  const signInWithGoogleToken = useCallback(
    async (idToken: string, channel?: TwoFactorChannel) => {
      const result = await nativeGoogle(idToken, channel)
      if ('challenge' in result) {
        return result
      }
      await finishSession(result)
      queryClient.clear()
      return null
    },
    [finishSession, queryClient],
  )

  const signOut = useCallback(async () => {
    const refreshToken = await getRefreshToken()
    try {
      await nativeLogout(refreshToken)
    } catch {
      // Local sign-out still proceeds if the network is unavailable.
    }
    await clearSession()
  }, [clearSession])

  const unlockWithBiometric = useCallback(async () => {
    const ok = await unlockWithBiometrics()
    if (!ok) return false
    const refreshToken = await getRefreshToken()
    if (!refreshToken) {
      await clearSession()
      return false
    }
    try {
      const payload = await nativeRefresh(refreshToken)
      await finishSession(payload)
      setBiometricsLocked(false)
      return true
    } catch {
      await clearSession()
      return false
    }
  }, [clearSession, finishSession])

  const refreshProfile = useCallback(async () => {
    const me = await fetchMe()
    applyMe(me)
  }, [applyMe])

  const has = useCallback((permission: string) => permissions.includes(permission), [permissions])

  const isParentOnly = useMemo(() => parentOnly(roles, permissions), [roles, permissions])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      roles,
      permissions,
      schoolName,
      biometricsLocked,
      biometricsSupported,
      isParentOnly,
      has,
      signIn,
      verifyTwoFactor,
      resendTwoFactor,
      signInWithGoogleToken,
      signOut,
      unlockWithBiometric,
      refreshProfile,
    }),
    [
      status,
      user,
      roles,
      permissions,
      schoolName,
      biometricsLocked,
      biometricsSupported,
      isParentOnly,
      has,
      signIn,
      verifyTwoFactor,
      resendTwoFactor,
      signInWithGoogleToken,
      signOut,
      unlockWithBiometric,
      refreshProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
