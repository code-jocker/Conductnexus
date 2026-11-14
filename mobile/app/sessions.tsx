import { Alert, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage } from '../src/api/client'
import { listSessions, logoutOtherSessions, revokeSession } from '../src/api/endpoints'
import type { SessionView } from '../src/api/types'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingView,
  Row,
  Rows,
  Screen,
  SectionTitle,
} from '../src/components/ui'
import { formatDateTime, timeAgo } from '../src/utils/format'
import { spacing, useTheme } from '../src/theme'

const PLATFORM_LABEL: Record<SessionView['platform'], string> = {
  android: 'Android',
  ios: 'iOS',
  web: 'Web browser',
  unknown: 'Unknown device',
}

export default function SessionsScreen() {
  const theme = useTheme()
  const queryClient = useQueryClient()

  const sessions = useQuery({ queryKey: ['sessions'], queryFn: listSessions })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['sessions'] })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeSession(id),
    onSuccess: invalidate,
    onError: (error) => Alert.alert('Could not sign out device', apiErrorMessage(error)),
  })

  const revokeOthers = useMutation({
    mutationFn: () => logoutOtherSessions(),
    onSuccess: () => {
      invalidate()
      Alert.alert('Other sessions signed out', 'Every other device must sign in again.')
    },
    onError: (error) => Alert.alert('Could not sign out other devices', apiErrorMessage(error)),
  })

  const items = sessions.data ?? []
  const others = items.filter((session) => !session.current)

  return (
    <Screen refreshing={sessions.isRefetching} onRefresh={() => void sessions.refetch()}>
      <AppHeader title="Devices & sessions" subtitle="Actively signed-in devices for your account" />

      {sessions.isLoading ? <LoadingView label="Loading sessions…" /> : null}
      {sessions.error ? (
        <ErrorState message={apiErrorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
      ) : null}

      {sessions.isSuccess ? (
        items.length ? (
          <>
            <Rows>
              {items.map((session) => (
                <Row
                  key={session.id}
                  icon={session.platform === 'web' ? 'globe-outline' : 'phone-portrait-outline'}
                  title={`${PLATFORM_LABEL[session.platform]}${session.deviceName ? ` · ${session.deviceName}` : ''}`}
                  subtitle={`${session.current ? 'This device' : session.ip ?? 'Unknown IP'}${
                    session.appVersion ? ` · v${session.appVersion}` : ''
                  }`}
                  meta={`Active ${timeAgo(session.lastActiveAt ?? session.createdAt)} · expires ${formatDateTime(session.expiresAt)}`}
                  right={
                    session.current ? (
                      <Badge label="this device" tone="success" />
                    ) : (
                      <Button
                        title="Sign out"
                        compact
                        variant="danger"
                        loading={revoke.isPending && revoke.variables === session.id}
                        onPress={() =>
                          Alert.alert('Sign out this device?', 'That device will immediately lose access.', [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Sign out', style: 'destructive', onPress: () => revoke.mutate(session.id) },
                          ])
                        }
                      />
                    )
                  }
                />
              ))}
            </Rows>

            <SectionTitle title="Safety" />
            <Card>
              <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 18 }}>
                Sessions are revoked immediately. Changing your password signs out every other device. Use “Sign out
                everywhere else” if you no longer recognise a device.
              </Text>
            </Card>

            {others.length ? (
              <View style={{ marginTop: spacing.md }}>
                <Button
                  title="Sign out everywhere else"
                  icon="log-out-outline"
                  variant="danger"
                  loading={revokeOthers.isPending}
                  onPress={() =>
                    Alert.alert(
                      'Sign out other devices?',
                      `${others.length} other session${others.length === 1 ? '' : 's'} will be revoked.`,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Sign out others', style: 'destructive', onPress: () => revokeOthers.mutate() },
                      ],
                    )
                  }
                />
              </View>
            ) : null}
          </>
        ) : (
          <Card>
            <EmptyState icon="phone-portrait-outline" title="No sessions found" message="Pull down to refresh." />
          </Card>
        )
      ) : null}
    </Screen>
  )
}
