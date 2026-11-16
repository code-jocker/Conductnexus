import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../../src/auth/AuthProvider'
import { apiErrorMessage } from '../../src/api/client'
import { fetchDashboard } from '../../src/api/endpoints'
import type { Approval, IncidentSummary, Student } from '../../src/api/types'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  KeyValue,
  LoadingView,
  OfflineBanner,
  Rows,
  Row,
  Screen,
  SectionTitle,
  StatTile,
  statusTone,
} from '../../src/components/ui'
import { initials, timeAgo } from '../../src/utils/format'
import { radius, spacing, useTheme } from '../../src/theme'
import { mobileRoleDashboardFor, type MobileSection } from '../../src/roleDashboards'

type FollowUpRow = { _id: string; title?: string; type?: string; dueDate?: string; status?: string }
type MeetingRow = { _id: string; title: string; scheduledAt: string }
type LetterRow = { _id: string; reference: string; type: string; status: string; createdAt: string }
type AuditRow = { _id: string; actorName: string; action: string; createdAt: string }
type RecognitionRow = { _id: string; title: string; studentId?: { fullName?: string } }
type StudentRef = Student & { _id?: string; id?: string }

const titleCase = (value: string) =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export default function StaffHome() {
  const theme = useTheme()
  const { user, schoolName, refreshProfile, roles, permissions } = useAuth()
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard })

  const data = dashboard.data
  const config = mobileRoleDashboardFor(roles, data?.role, permissions)
  const metrics = data?.metrics
  const extra = data?.extra ?? {}

  const section = (key: MobileSection) => {
    if (!data) return null
    switch (key) {
      case 'approvals': {
        const pending = (data.lists.pendingApprovals ?? []) as Approval[]
        if (!pending.length) return null
        return (
          <View key={key}>
            <SectionTitle title="Awaiting your decision" action={<Badge label={`${pending.length} pending`} tone="warning" />} />
            <Rows>
              {pending.map((approval) => (
                <Row
                  key={approval._id}
                  title={approval.title}
                  subtitle={approval.summary ?? approval.approvalNumber}
                  meta={timeAgo(approval.createdAt)}
                  icon="checkmark-done-outline"
                  onPress={() => router.push('/(staff)/tasks')}
                />
              ))}
            </Rows>
          </View>
        )
      }
      case 'recentIncidents': {
        const incidents = (data.lists.recentIncidents ?? []) as IncidentSummary[]
        return (
          <View key={key}>
            <SectionTitle title="Recent incidents" />
            {incidents.length ? (
              <Rows>
                {incidents.map((incident) => (
                  <Row
                    key={incident._id}
                    title={`${incident.incidentNumber} · ${incident.studentSnapshot?.fullName ?? 'Student'}`}
                    subtitle={`${incident.offenceSnapshot?.name ?? 'Incident'} · ${incident.location ?? ''}`}
                    meta={timeAgo(incident.occurredAt)}
                    onPress={() => router.push(`/incident/${incident._id}`)}
                    right={<Badge label={incident.status.replace('_', ' ')} tone={statusTone(incident.status)} />}
                  />
                ))}
              </Rows>
            ) : (
              <Card>
                <EmptyState icon="checkmark-circle-outline" title="No incidents yet" message="New reports will appear here." />
              </Card>
            )}
          </View>
        )
      }
      case 'highRisk': {
        const students = (data.lists.highRiskStudents ?? []) as StudentRef[]
        if (!students.length) return null
        return (
          <View key={key}>
            <SectionTitle title="Students needing attention" />
            <Rows>
              {students.map((student) => {
                const id = student._id ?? student.id ?? ''
                return (
                  <Row
                    key={id}
                    title={student.fullName}
                    subtitle={`${student.studentId} · Balance ${student.currentBalance}`}
                    icon="person-outline"
                    onPress={id ? () => router.push(`/student/${id}`) : undefined}
                    right={<Badge label={student.riskLevel} tone={student.riskLevel === 'red' ? 'danger' : 'accent'} />}
                  />
                )
              })}
            </Rows>
          </View>
        )
      }
      case 'followUps': {
        const followUps = (data.lists.upcomingFollowUps ?? []) as FollowUpRow[]
        if (!followUps.length) return null
        return (
          <View key={key}>
            <SectionTitle title="Follow-ups due" />
            <Rows>
              {followUps.map((followUp) => (
                <Row
                  key={followUp._id}
                  title={followUp.title ?? titleCase(followUp.type ?? 'Follow-up')}
                  subtitle={followUp.dueDate ? new Date(followUp.dueDate).toLocaleDateString() : undefined}
                  icon="calendar-outline"
                  right={<Badge label={followUp.status ?? 'pending'} tone="warning" />}
                />
              ))}
            </Rows>
          </View>
        )
      }
      case 'meetings': {
        const meetings = (extra.upcomingMeetings ?? []) as MeetingRow[]
        return (
          <View key={key}>
            <SectionTitle title="Upcoming meetings" />
            {meetings.length ? (
              <Rows>
                {meetings.slice(0, 5).map((meeting) => (
                  <Row
                    key={meeting._id}
                    title={meeting.title}
                    subtitle={new Date(meeting.scheduledAt).toLocaleDateString()}
                    icon="calendar-outline"
                  />
                ))}
              </Rows>
            ) : (
              <Card>
                <EmptyState icon="calendar-outline" title="No meetings scheduled" message="Scheduled meetings appear here." />
              </Card>
            )}
          </View>
        )
      }
      case 'letters': {
        const letters = (extra.letters ?? []) as LetterRow[]
        return (
          <View key={key}>
            <SectionTitle title="Recent letters" />
            {letters.length ? (
              <Rows>
                {letters.slice(0, 5).map((letter) => (
                  <Row
                    key={letter._id}
                    title={letter.reference}
                    subtitle={titleCase(letter.type)}
                    meta={timeAgo(letter.createdAt)}
                    icon="document-text-outline"
                    right={<Badge label={titleCase(letter.status)} tone={letter.status === 'issued' ? 'success' : 'neutral'} />}
                  />
                ))}
              </Rows>
            ) : (
              <Card>
                <EmptyState icon="document-text-outline" title="No letters issued" message="Issued letters appear here." />
              </Card>
            )}
          </View>
        )
      }
      case 'audit': {
        const rows = (extra.recentAudit ?? []) as AuditRow[]
        return (
          <View key={key}>
            <SectionTitle title="Recent audit activity" />
            {rows.length ? (
              <Rows>
                {rows.slice(0, 5).map((entry) => (
                  <Row
                    key={entry._id}
                    title={entry.actorName}
                    subtitle={titleCase(entry.action)}
                    meta={timeAgo(entry.createdAt)}
                    icon="shield-checkmark-outline"
                  />
                ))}
              </Rows>
            ) : (
              <Card>
                <EmptyState icon="shield-checkmark-outline" title="No audit activity" message="Security events appear here." />
              </Card>
            )}
          </View>
        )
      }
      case 'queue': {
        const queue = extra.queue as Record<string, unknown> | undefined
        const entries = Object.entries(queue ?? {}).filter(([, value]) => typeof value === 'number')
        return (
          <View key={key}>
            <SectionTitle title="Message queue health" />
            <Card>
              {entries.length ? (
                entries.map(([state, value]) => (
                  <KeyValue key={state} label={titleCase(state)} value={String(value)} />
                ))
              ) : (
                <Text style={{ color: theme.textMuted, fontSize: 13 }}>No messages waiting for delivery.</Text>
              )}
            </Card>
          </View>
        )
      }
      case 'whatsapp': {
        const wa = extra.whatsapp as { status?: string; info?: { pushname?: string; wid?: string } } | undefined
        return (
          <View key={key}>
            <SectionTitle title="WhatsApp channel" />
            <Card>
              <KeyValue label="Status" value={wa?.status ? titleCase(wa.status) : 'Not configured'} />
              <KeyValue
                label="Connected device"
                value={wa?.info?.pushname ?? (wa?.info?.wid ? wa.info.wid.replace('@c.us', '') : 'None')}
              />
            </Card>
          </View>
        )
      }
      case 'safeguarding': {
        const block = extra.safeguarding as { open?: number; critical?: number } | undefined
        return (
          <View key={key}>
            <SectionTitle title="Safeguarding" />
            <Card>
              <KeyValue label="Open cases" value={String(block?.open ?? 0)} />
              <KeyValue label="Critical" value={String(block?.critical ?? 0)} />
            </Card>
          </View>
        )
      }
      case 'investigations': {
        const block = extra.investigations as { open?: number } | undefined
        return (
          <View key={key}>
            <SectionTitle title="Investigations" />
            <Card>
              <KeyValue label="Open" value={String(block?.open ?? 0)} />
            </Card>
          </View>
        )
      }
      case 'appeals': {
        const block = extra.appeals as { pending?: number } | undefined
        return (
          <View key={key}>
            <SectionTitle title="Appeals" />
            <Card>
              <KeyValue label="Awaiting decision" value={String(block?.pending ?? 0)} />
            </Card>
          </View>
        )
      }
      case 'recognition': {
        const rows = (extra.recentRecognition ?? []) as RecognitionRow[]
        if (!rows.length) return null
        return (
          <View key={key}>
            <SectionTitle title="Recent recognition" />
            <Rows>
              {rows.slice(0, 5).map((item) => (
                <Row
                  key={item._id}
                  title={item.title}
                  subtitle={item.studentId?.fullName}
                  icon="ribbon-outline"
                />
              ))}
            </Rows>
          </View>
        )
      }
      case 'parents': {
        const block = extra.parents as { total?: number } | undefined
        return (
          <View key={key}>
            <SectionTitle title="Parent records" />
            <Card>
              <KeyValue label="Contactable guardians" value={String(block?.total ?? 0)} />
            </Card>
          </View>
        )
      }
      case 'users': {
        const block = extra.users as { total?: number; active?: number; roles?: number } | undefined
        return (
          <View key={key}>
            <SectionTitle title="User accounts" />
            <Card>
              <KeyValue label="Active" value={String(block?.active ?? 0)} />
              <KeyValue label="Total" value={String(block?.total ?? 0)} />
              <KeyValue label="Roles" value={String(block?.roles ?? 0)} />
            </Card>
          </View>
        )
      }
      case 'notifications': {
        const unread = typeof extra.unreadNotifications === 'number' ? extra.unreadNotifications : 0
        return (
          <View key={key}>
            <SectionTitle title="Notification centre" action={<Badge label={`${unread} unread`} tone={unread ? 'warning' : 'neutral'} />} />
            <Card>
              <Button title="Open notifications" icon="notifications-outline" onPress={() => router.push('/notifications')} />
            </Card>
          </View>
        )
      }
      case 'trend': {
        const trend = (data.charts.trend ?? []).slice(-5)
        if (!trend.length) return null
        const total = trend.reduce((sum, day) => sum + Number(day.incidents ?? 0), 0)
        return (
          <View key={key}>
            <SectionTitle title="Incident trend" action={<Badge label={`${total} in 5 days`} tone="info" />} />
            <Card>
              {trend.map((day) => (
                <KeyValue
                  key={day.date}
                  label={new Date(day.date).toLocaleDateString()}
                  value={`${day.incidents} incident${day.incidents === 1 ? '' : 's'} · ${day.deductions} deduction${day.deductions === 1 ? '' : 's'}`}
                />
              ))}
            </Card>
          </View>
        )
      }
      default:
        return null
    }
  }

  return (
    <Screen refreshing={dashboard.isRefetching} onRefresh={() => void dashboard.refetch()}>
      <OfflineBanner />
      <AppHeader
        title={`${config.headline}, ${user?.name?.split(' ')[0] ?? 'there'}`}
        subtitle={`${config.eyebrow} · ${schoolName}`}
        action={
          <IconButton
            icon="notifications-outline"
            label="Notifications"
            onPress={() => router.push('/notifications')}
          />
        }
      />

      {dashboard.isLoading ? <LoadingView label="Loading your dashboard…" /> : null}
      {dashboard.error ? (
        <ErrorState message={apiErrorMessage(dashboard.error)} onRetry={() => void dashboard.refetch()} />
      ) : null}

      <Text style={[styles.lead, { color: theme.textMuted }]}>{config.subtitle}</Text>

      {metrics ? (
        <View style={styles.grid}>
          {config.stats(data!).map((stat) => (
            <StatTile key={stat.label} label={stat.label} value={stat.value} icon={stat.icon} tone={stat.tone} />
          ))}
        </View>
      ) : null}

      {config.quickActions.length ? (
        <>
          <SectionTitle title="Quick actions" />
          <View style={styles.actions}>
            {config.quickActions.map((action) => (
              <View key={action.title} style={styles.action}>
                <Button
                  title={action.title}
                  icon={action.icon}
                  variant="secondary"
                  onPress={() => router.push(action.route as never)}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}

      {config.sections.map((key) => section(key))}

      <Card style={{ marginTop: spacing.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={[styles.avatar, { backgroundColor: theme.primarySoft }]}>
            <Text style={{ color: theme.primary, fontWeight: '800' }}>{initials(user?.name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '700' }}>{user?.name}</Text>
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>
              {data?.roleLabel ?? 'Signed in'} · {data?.roles?.join(', ') ?? ''}
            </Text>
          </View>
          <IconButton icon="refresh" label="Refresh profile" onPress={() => void refreshProfile()} />
        </View>
        <View style={{ marginTop: spacing.md }}>
          <KeyValue label="Conduct rule" value="Balances change only after an independent review." />
        </View>
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  lead: { fontSize: 13, marginTop: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  action: { flexBasis: '48%', flexGrow: 1 },
  avatar: { width: 42, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})