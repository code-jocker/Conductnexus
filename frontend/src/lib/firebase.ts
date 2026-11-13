import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, type Auth } from 'firebase/auth'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
}

export const firebaseEnabled = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId)

let app: FirebaseApp | null = null

function authInstance(): Auth {
  if (!firebaseEnabled) throw new Error('Google sign-in is not configured. Ask your administrator to set the Firebase keys.')
  if (!app) app = getApps()[0] ?? initializeApp(config)
  return getAuth(app)
}

export async function signInWithGoogle(): Promise<string> {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  const result = await signInWithPopup(authInstance(), provider)
  const idToken = await result.user.getIdToken()
  await signOut(authInstance()).catch(() => undefined)
  return idToken
}
