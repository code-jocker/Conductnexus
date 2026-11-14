import { Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { apiErrorMessage } from '../../src/api/client'
import { fetchPortalChild, fetchPortalChildren } from '../../src/api/endpoints'
import {
  AppHeader,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingView,
  Row,
  Rows,
  Screen,
  SectionTitle,
} from '../../src/components/ui'
import { formatDateTime } from '../../src/utils/format'
import { spacing, useTheme } from '../../src/theme'

export default function ParentMeetingsScreen() {
  const theme = useTheme()
  const children = useQuery({ queryKey: ['portal', 'children'], queryFn: fetchPortalChildren })
  const childList = children.data?.children ?? []
  const ids = childList.map((child) => child.id)

  const details = useQuery({
    queryKey: ['portal', 'meeting-details', ids],
    queryFn: () => Promise.all(childList.map((child) => fetchPortalChild(child.id))),
    enabled: childList.length > 0,
  })

  const meetings =
    details.data?.flatMap((detail) =>
      detail.meetings.map((meeting) => ({
        ...meeting,
        childName: detail.student.fullName,
        childId: detail.student.id,
      })),
    ) ?? []
  meetings.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())

  const loading = children.isLoading || (childList.length > 0 && details.isLoading)
  const error = children.error ?? details.error

  return (
    <Screen
      refreshing={children.isRefetching || details.isRefetching}
      onRefresh={() => {
        void children.refetch()
        void details.refetch()
      }}
    >
      <AppHeader title="Meetings" subtitle="Scheduled conversations with the school" />

      {loading ? <LoadingView label="Loading meetings…" /> : null}
      {!loading && error ? <ErrorState message={apiErrorMessage(error)} /> : null}

      {!loading && !error ? (
        meetings.length ? (
          <>
            <Rows>
              {meetings.map((meeting) => (
                <Row
                  key={meeting._id}
                  icon="calendar-outline"
                  title={meeting.title}
                  subtitle={`${meeting.childName}${meeting.location ? ` · ${meeting.location}` : ''}`}
                  meta={`${formatDateTime(meeting.scheduledAt)}${meeting.type ? ` · ${meeting.type.replace(/_/g, ' ')}` : ''}`}
                  right={<Badge label="scheduled" tone="info" />}
                />
              ))}
            </Rows>
            <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.md, lineHeight: 16 }}>
              The school will confirm any change of time or venue through your chosen communication channel. Bring your
              phone to the meeting so the outcome can be recorded accurately.
            </Text>
          </>
        ) : (
          <Card>
            <EmptyState
              icon="calendar-clear-outline"
              title="No meetings scheduled"
              message="Meetings about conduct or support appear here once the school schedules them."
            />
          </Card>
        )
      ) : null}

      <SectionTitle title="Need to talk sooner?" />
      <Card>
        <View>
          <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 19 }}>
            Contact the school office or your child's class teacher. If the matter concerns a safeguarding issue, ask for
            the designated safeguarding lead.
          </Text>
        </View>
      </Card>
    </Screen>
  )
}
