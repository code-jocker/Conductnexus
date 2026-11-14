import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../src/auth/AuthProvider'
import { useTheme } from '../../src/theme'

export default function StaffLayout() {
  const theme = useTheme()
  const { has } = useAuth()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        sceneStyle: { backgroundColor: theme.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="incidents"
        options={{
          title: 'Incidents',
          href: has('incidents.view') ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="alert-circle-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="students"
        options={{
          title: 'Students',
          href: has('students.view') ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="people-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color, size }) => <Ionicons name="checkbox-outline" size={size} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color as string} />,
        }}
      />
    </Tabs>
  )
}
