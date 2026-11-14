import { useEffect, useState } from 'react'
import { Alert, Switch, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../src/auth/AuthProvider'
import { getBiometricsEnabled, setBiometricsEnabled } from '../../src/auth/storage'
import { listSessions } from '../../src/api/endpoints'
import { countPendingDrafts } from '../../src/offline/db'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  KeyValue,
  OfflineBanner,
  Row,
  Rows,
  Screen,
  SectionTitle,
} from '../../src/components/ui'
import { initials } from '../../src/utils/format'
import { spacing, useTheme } from '../../src/theme'

export default function MoreScreen() {
  const theme = useTheme()
  const { user, roles, schoolName, has, signOut, biometricsSupported } = useAuth()
  const [biometrics, setBiometrics] = useState<boolean | null>(null)
  const pendingDrafts = countPendingDrafts()

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: listSessions })

  useEffect(() => {
    void getBiometricsEnabled().then(setBiometrics)
  }, [])

  const toggleBiometrics = async (value: boolean) => {
    await setBiometricsEnabled(value)
    setBiometrics(value)
  }

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'This device will need to sign in again. Offline drafts stay on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut()
        },
      },
    ])
  }

  return (
    <Screen>
      <OfflineBanner />
      <AppHeader title="More" subtitle={schoolName} />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View
            style={{
              width: 54,
              height: 54,
              borderRadius: 27,
              backgroundColor: theme.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.primary, fontWeight: '800', fontSize: 18 }}>{initials(user?.name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '800', fontSize: 17 }}>{user?.name ?? 'Signed in'}</Text>
            <Text style={{ color: theme.textMuted, fontSize: 13 }}>{user?.email ?? ''}</Text>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {roles.slice(0, 3).map((role) => (
                <Badge key={role} label={role.replace(/_/g, ' ')} tone="info" />
              ))}
            </View>
          </View>
        </View>
        <View style={{ marginTop: spacing.lg }}>
          <KeyValue label="Position" value={user?.position ?? '—'} />
          <KeyValue label="Account status" value={user?.status ?? '—'} />
        </View>
      </Card>

      <SectionTitle title="Work" />
      <Rows>
        <Row
          icon="notifications-outline"
          title="Notifications"
          subtitle="Review alerts and follow-ups"
          onPress={() => router.push('/notifications')}
        />
        <Row
          icon="cloud-offline-outline"
          title="Offline drafts"
          subtitle="Incidents saved on this device"
          onPress={() => router.push('/drafts')}
          right={
            pendingDrafts > 0 ? (
              <Badge label={`${pendingDrafts} pending`} tone="accent" />
            ) : (
              <Badge label="clear" tone="success" />
            )
          }
        />
        {['marks.adjust.approve', 'incidents.review', 'letters.approve', 'students.promote.approve'].some((permission) => has(permission)) ? (
          <Row icon="checkmark-done-outline" title="Approvals queue" onPress={() => router.push('/(staff)/tasks')} />
        ) : null}
        <Row
          icon="document-text-outline"
          title="Reports & exports"
          subtitle="Full reporting is available in the web console"
        />
      </Rows>

      <SectionTitle title="Account & security" />
      <Rows>
        <Row icon="person-outline" title="My account" subtitle="Profile and password" onPress={() => router.push('/profile')} />
        <Row
          icon="phone-portrait-outline"
          title="Devices & sessions"
          subtitle="Review where you are signed in"
          onPress={() => router.push('/sessions')}
          right={
            sessions.isSuccess ? <Badge label={`${sessions.data.length} active`} tone="info" /> : undefined
          }
        />
        <Row
          icon="finger-print-outline"
          title="Biometric unlock"
          subtitle={
            biometricsSupported
              ? 'Require Face ID or fingerprint when reopening the app'
              : 'Not available on this device'
          }
          right={
            <Switch
              value={Boolean(biometrics)}
              onValueChange={(value) => void toggleBiometrics(value)}
              disabled={!biometricsSupported}
              trackColor={{ true: theme.primary, false: theme.border }}
            />
          }
        />
        <Row icon="shield-checkmark-outline" title="Privacy & data" onPress={() => router.push('/privacy')} />
      </Rows>

      <SectionTitle title="Session" />
      <Button title="Sign out" icon="log-out-outline" variant="danger" onPress={confirmSignOut} />
      <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center', marginTop: spacing.xl }}>
        ConductNexus · {schoolName}
      </Text>
      <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center', marginTop: 2 }}>
        Powered by Shyaka clever prince a.k.a Code jocker
      </Text>
    </Screen>
  )
}
