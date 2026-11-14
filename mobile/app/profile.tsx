import { useEffect, useState } from 'react'
import { Alert, Switch, Text, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../src/auth/AuthProvider'
import { apiErrorMessage } from '../src/api/client'
import { changePassword } from '../src/api/endpoints'
import { getBiometricsEnabled, setBiometricsEnabled } from '../src/auth/storage'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  KeyValue,
  Screen,
  SectionTitle,
  TextField,
} from '../src/components/ui'
import { formatDate } from '../src/utils/format'
import { spacing, useTheme } from '../src/theme'

export default function ProfileScreen() {
  const theme = useTheme()
  const queryClient = useQueryClient()
  const { user, roles, permissions, schoolName, biometricsSupported, refreshProfile } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [biometrics, setBiometrics] = useState(false)

  useEffect(() => {
    void getBiometricsEnabled().then(setBiometrics)
  }, [])

  const submit = async () => {
    setError('')
    if (next.length < 10) {
      setError('The new password must be at least 10 characters.')
      return
    }
    if (next !== confirm) {
      setError('The new passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await changePassword({ currentPassword: current, newPassword: next })
      setCurrent('')
      setNext('')
      setConfirm('')
      queryClient.clear()
      await refreshProfile()
      Alert.alert('Password changed', 'All other devices were signed out. This device stays signed in.')
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleBiometrics = async (value: boolean) => {
    if (value && !biometricsSupported) {
      Alert.alert('Not available', 'Set up Face ID or a fingerprint in your device settings first.')
      return
    }
    await setBiometricsEnabled(value)
    setBiometrics(value)
  }

  return (
    <Screen>
      <AppHeader title="My account" subtitle={schoolName} />

      <Card>
        <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>{user?.name ?? 'Signed in'}</Text>
        <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 2 }}>{user?.email ?? ''}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: spacing.sm }}>
          {roles.map((role) => (
            <Badge key={role} label={role.replace(/_/g, ' ')} tone="info" />
          ))}
        </View>
        <View style={{ marginTop: spacing.md }}>
          <KeyValue label="Position" value={user?.position ?? '—'} />
          <KeyValue label="Auth provider" value={user?.authProvider ?? '—'} />
          <KeyValue label="Email verified" value={user?.emailVerified ? 'Yes' : 'No'} />
          <KeyValue label="Permissions" value={String(permissions.length)} />
          <KeyValue label="Today" value={formatDate(new Date())} />
        </View>
      </Card>

      <SectionTitle title="Security" />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '700' }}>Biometric unlock</Text>
            <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
              Require Face ID or a fingerprint when the app reopens.
            </Text>
          </View>
          <Switch
            value={biometrics}
            onValueChange={(value) => void toggleBiometrics(value)}
            disabled={!biometricsSupported}
            trackColor={{ true: theme.primary, false: theme.border }}
          />
        </View>
      </Card>

      <SectionTitle title="Change password" />
      <Card>
        <TextField label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" />
        <TextField label="New password" value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" />
        <TextField label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" />
        <Text style={{ color: theme.textMuted, fontSize: 11, marginBottom: spacing.sm }}>
          At least 10 characters with upper case, lower case and a number. Changing it signs out every other device.
        </Text>
        {error ? <Text style={{ color: theme.danger, fontSize: 12, marginBottom: spacing.sm }}>{error}</Text> : null}
        <Button
          title="Update password"
          icon="key-outline"
          loading={busy}
          disabled={!current || !next || !confirm}
          onPress={() => void submit()}
        />
      </Card>

      <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center', marginTop: spacing.xl }}>
        Powered by Shyaka clever prince a.k.a Code jocker
      </Text>
    </Screen>
  )
}
