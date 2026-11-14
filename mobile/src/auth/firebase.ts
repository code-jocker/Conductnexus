import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, initializeAuth, inMemoryPersistence, type Auth } from 'firebase/auth'

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
}

export function firebaseConfigured(): boolean {
  return Boolean(config.apiKey && config.projectId && config.appId)
}

let app: FirebaseApp | null = null
let auth: Auth | null = null

export function firebaseAuth(): { app: FirebaseApp; auth: Auth } {
  if (!firebaseConfigured()) throw new Error('Google Sign-In is not configured for this build.')
  app = app ?? getApps()[0] ?? initializeApp(config)
  if (!auth) {
    try {
      auth = initializeAuth(app, { persistence: inMemoryPersistence })
    } catch {
      auth = getAuth(app)
    }
  }
  return { app, auth }
}
