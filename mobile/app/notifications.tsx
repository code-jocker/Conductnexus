import { useState } from 'react'
import { Text, View } from 'react-native'
import { router } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage } from '../src/api/client'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../src/api/endpoints'
import { routeForLink } from '../src/notifications/push'
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
} from '../src/components/ui'
import { timeAgo } from '../src/utils/format'
import { spacing, useTheme } from '../src/theme'

export default function NotificationsScreen() {
  const theme = useTheme()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const notifications = useQuery({
    queryKey: ['notifications', filter],
    queryFn: () => listNotifications(filter === 'unread'),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const readOne = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: invalidate,
  })

  const readAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: invalidate,
  })

  const items = notifications.data?.items ?? []
  const unread = notifications.data?.unread ?? 0

  return (
    <Screen refreshing={notifications.isRefetching} onRefresh={() => void notifications.refetch()}>
      <AppHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : 'You are up to date'}
        action={
          unread ? (
            <Button title="Read all" compact variant="secondary" loading={readAll.isPending} onPress={() => readAll.mutate()} />
          ) : undefined
        }
      />

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        {(['all', 'unread'] as const).map((key) => {
          const active = filter === key
          return (
            <Button
              key={key}
              title={key === 'all' ? 'All' : 'Unread'}
              compact
              variant={active ? 'primary' : 'secondary'}
              onPress={() => setFilter(key)}
            />
          )
        })}
      </View>

      {notifications.isLoading ? <LoadingView label="Loading notifications…" /> : null}
      {notifications.error ? (
        <ErrorState message={apiErrorMessage(notifications.error)} onRetry={() => void notifications.refetch()} />
      ) : null}

      {!notifications.isLoading && !notifications.error ? (
        items.length ? (
          <Rows>
            {items.map((item) => (
              <Row
                key={item._id}
                title={item.title}
                subtitle={item.message}
                meta={timeAgo(item.createdAt)}
                icon={item.readAt ? 'notifications-off-outline' : 'notifications-outline'}
                onPress={() => {
                  if (!item.readAt) readOne.mutate(item._id)
                  router.push(routeForLink(item.link) as never)
                }}
                right={
                  item.readAt ? (
                    <Text style={{ color: theme.textMuted, fontSize: 11 }}>read</Text>
                  ) : (
                    <Badge label="new" tone="accent" />
                  )
                }
              />
            ))}
          </Rows>
        ) : (
          <Card>
            <EmptyState
              icon="notifications-outline"
              title={filter === 'unread' ? 'No unread notices' : 'No notifications yet'}
              message="Alerts about reviews, safeguarding, meetings and guardian communication appear here."
            />
          </Card>
        )
      ) : null}

      <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.xl, textAlign: 'center', lineHeight: 16 }}>
        Safeguarding notifications never include case details. Sign in to the web console to see restricted records.
      </Text>
    </Screen>
  )
}
