import { Text } from 'react-native'
import { router } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage } from '../../src/api/client'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../../src/api/endpoints'
import { routeForLink } from '../../src/notifications/push'
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
} from '../../src/components/ui'
import { timeAgo } from '../../src/utils/format'
import { useTheme } from '../../src/theme'

export default function ParentNoticesScreen() {
  const theme = useTheme()
  const queryClient = useQueryClient()
  const notices = useQuery({ queryKey: ['notifications', 'all'], queryFn: () => listNotifications(false) })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] })

  const readOne = useMutation({ mutationFn: (id: string) => markNotificationRead(id), onSuccess: invalidate })
  const readAll = useMutation({ mutationFn: () => markAllNotificationsRead(), onSuccess: invalidate })

  const items = notices.data?.items ?? []
  const unread = notices.data?.unread ?? 0

  return (
    <Screen refreshing={notices.isRefetching} onRefresh={() => void notices.refetch()}>
      <AppHeader
        title="Notices"
        subtitle={unread ? `${unread} unread` : 'You are up to date'}
        action={
          unread ? (
            <Button title="Read all" compact variant="secondary" loading={readAll.isPending} onPress={() => readAll.mutate()} />
          ) : undefined
        }
      />

      {notices.isLoading ? <LoadingView label="Loading notices…" /> : null}
      {notices.error ? (
        <ErrorState message={apiErrorMessage(notices.error)} onRetry={() => void notices.refetch()} />
      ) : null}

      {!notices.isLoading && !notices.error ? (
        items.length ? (
          <Rows>
            {items.map((item) => (
              <Row
                key={item._id}
                icon={item.readAt ? 'mail-open-outline' : 'mail-unread-outline'}
                title={item.title}
                subtitle={item.message}
                meta={timeAgo(item.createdAt)}
                onPress={() => {
                  if (!item.readAt) readOne.mutate(item._id)
                  router.push(routeForLink(item.link) as never)
                }}
                right={item.readAt ? <Text style={{ color: theme.textMuted, fontSize: 11 }}>read</Text> : <Badge label="new" tone="accent" />}
              />
            ))}
          </Rows>
        ) : (
          <Card>
            <EmptyState
              icon="mail-outline"
              title="No notices yet"
              message="Messages about conduct, meetings and school communication appear here."
            />
          </Card>
        )
      ) : null}

      <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 24, textAlign: 'center', lineHeight: 16 }}>
        Safeguarding notices are intentionally general. Sign in to the school portal or contact the school to discuss a
        confidential matter.
      </Text>
    </Screen>
  )
}
