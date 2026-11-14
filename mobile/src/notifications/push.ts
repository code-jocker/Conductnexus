import { useEffect } from 'react'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import { registerPushToken } from '../api/endpoints'

const projectId =
  (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
  process.env.EXPO_PUBLIC_EAS_PROJECT_ID

export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  })
}

export async function setupPushNotifications(): Promise<void> {
  if (!Device.isDevice) return
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'ConductNexus',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2563eb',
    })
  }
  const current = await Notifications.getPermissionsAsync()
  let status = current.status
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync()
    status = requested.status
  }
  if (status !== 'granted') return
  if (!projectId || projectId === 'REPLACE_WITH_EAS_PROJECT_ID') return
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId })
    await registerPushToken(token.data, Platform.OS)
  } catch {
    // Push tokens are unavailable in Expo Go or when the project id is not set.
  }
}

export function routeForLink(link?: string): string {
  if (!link) return '/notifications'
  const incident = link.match(/^\/incidents\/([a-f0-9]{24})/i)
  if (incident?.[1]) return `/incident/${incident[1]}`
  const student = link.match(/^\/students\/([a-f0-9]{24})/i)
  if (student?.[1]) return `/student/${student[1]}`
  if (link.startsWith('/approvals')) return '/(staff)/tasks'
  if (link.startsWith('/meetings')) return '/notifications'
  if (link.startsWith('/portal')) return '/(parent)'
  if (link.startsWith('/incidents')) return '/(staff)/incidents'
  return '/notifications'
}

export function useNotificationObserver() {
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { link?: string } | undefined
      router.push(routeForLink(data?.link) as never)
    })
    return () => subscription.remove()
  }, [])
}
