import 'react-native-reanimated'
import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { AuthProvider, useAuth } from '../src/auth/AuthProvider'
import { configureNotificationHandler, useNotificationObserver } from '../src/notifications/push'
import { useTheme } from '../src/theme'

void SplashScreen.preventAutoHideAsync()
configureNotificationHandler()

function AppShell() {
  const { status } = useAuth()
  const theme = useTheme()
  useNotificationObserver()

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync()
  }, [status])

  return (
    <>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.surface },
          headerTintColor: theme.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(staff)" options={{ headerShown: false }} />
        <Stack.Screen name="(parent)" options={{ headerShown: false }} />
        <Stack.Screen name="incident/[id]" options={{ title: 'Incident' }} />
        <Stack.Screen name="incident/new" options={{ title: 'Report incident', presentation: 'modal' }} />
        <Stack.Screen name="student/[id]" options={{ title: 'Student' }} />
        <Stack.Screen name="child/[id]" options={{ title: 'Child' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="sessions" options={{ title: 'Devices & sessions' }} />
        <Stack.Screen name="profile" options={{ title: 'My account' }} />
        <Stack.Screen name="drafts" options={{ title: 'Offline drafts' }} />
        <Stack.Screen name="privacy" options={{ title: 'Privacy & data' }} />
      </Stack>
    </>
  )
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </QueryClientProvider>
  )
}
