import { useCallback } from 'react'

export function useGoogleSignIn(onFirebaseIdToken: (token: string) => Promise<void>) {
  void onFirebaseIdToken
  const prompt = useCallback(() => {}, [])
  return {
    configured: false,
    ready: false,
    busy: false,
    error: null as string | null,
    prompt,
  }
}
