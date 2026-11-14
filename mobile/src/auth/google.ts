import { useEffect, useState } from 'react'
import * as Google from 'expo-auth-session/providers/google'
import * as WebBrowser from 'expo-web-browser'
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { firebaseAuth, firebaseConfigured } from './firebase'
import { apiErrorMessage } from '../api/client'

WebBrowser.maybeCompleteAuthSession()

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID

export function useGoogleSignIn(onFirebaseIdToken: (token: string) => Promise<void>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const configured = Boolean(webClientId && firebaseConfigured())

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: webClientId,
    iosClientId: iosClientId || undefined,
    androidClientId: androidClientId || undefined,
    scopes: ['openid', 'profile', 'email'],
  })

  useEffect(() => {
    let cancelled = false
    async function exchange() {
      if (response?.type !== 'success') {
        if (response?.type === 'error') setError('Google sign-in failed. Please try again.')
        return
      }
      const googleIdToken = response.params.id_token
      if (!googleIdToken) {
        setError('Google did not return an identity token.')
        return
      }
      setBusy(true)
      setError(null)
      try {
        const { auth } = firebaseAuth()
        const credential = GoogleAuthProvider.credential(googleIdToken)
        const result = await signInWithCredential(auth, credential)
        const firebaseIdToken = await result.user.getIdToken()
        if (!cancelled) await onFirebaseIdToken(firebaseIdToken)
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err))
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void exchange()
    return () => {
      cancelled = true
    }
  }, [response, onFirebaseIdToken])

  return {
    configured,
    ready: Boolean(request),
    busy,
    error,
    prompt: () => {
      setError(null)
      void promptAsync()
    },
  }
}
