import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../../src/auth/AuthProvider'
import { apiErrorMessage } from '../../src/api/client'
import { fetchDashboard } from '../../src/api/endpoints'
import type { Approval, IncidentSummary } from '../../src/api/types'
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

export default function StaffHome() {
  const theme = useTheme()
  const { user, has, schoolName, refreshProfile } = useAuth()
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard })

  const data = dashboard.data
  const metrics = data?.metrics
  const pending = data?.lists.pendingApprovals ?? []

  return (
    <Screen refreshing={dashboard.isRefetching} onRefresh={() => void dashboard.refetch()}>
      <OfflineBanner />
      <AppHeader
        title={`Karibu, ${user?.name?.split(' ')[0] ?? 'there'}`}
        subtitle={schoolName}
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

      {metrics ? (
        <View style={styles.grid}>
          <StatTile label="Active students" value={metrics.students} icon="people-outline" />
          <StatTile label="Incidents logged" value={metrics.incidents} icon="alert-circle-outline" tone="accent" />
          <StatTile label="Awaiting review" value={metrics.pendingReview} icon="time-outline" tone="warning" />
          <StatTile label="Pending approvals" value={metrics.pendingApprovals} icon="checkbox-outline" tone="danger" />
          <StatTile label="High-risk students" value={metrics.highRisk} icon="warning-outline" tone="danger" />
          <StatTile label="Open interventions" value={metrics.openInterventions} icon="medkit-outline" tone="success" />
        </View>
      ) : null}

      <SectionTitle title="Quick actions" />
      <View style={styles.actions}>
        {has('incidents.create') ? (
          <View style={styles.action}>
            <Button title="Report incident" icon="add-circle-outline" onPress={() => router.push('/incident/new')} />
          </View>
        ) : null}
        {has('students.view') ? (
          <View style={styles.action}>
            <Button
              title="Find a student"
              icon="search-outline"
              variant="secondary"
              onPress={() => router.push('/(staff)/students')}
            />
          </View>
        ) : null}
        <View style={styles.action}>
          <Button
            title="My tasks"
            icon="checkbox-outline"
            variant="secondary"
            onPress={() => router.push('/(staff)/tasks')}
          />
        </View>
        {has('incidents.create') ? (
          <View style={styles.action}>
            <Button
              title="Offline drafts"
              icon="cloud-offline-outline"
              variant="secondary"
              onPress={() => router.push('/drafts')}
            />
          </View>
        ) : null}
      </View>

      {pending.length ? (
        <>
          <SectionTitle
            title="Awaiting your decision"
            action={<Badge label={`${pending.length} pending`} tone="warning" />}
          />
          <Rows>
            {pending.map((approval: Approval) => (
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
        </>
      ) : null}

      <SectionTitle title="Recent incidents" />
      {data?.lists.recentIncidents?.length ? (
        <Rows>
          {data.lists.recentIncidents.map((incident: IncidentSummary) => (
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

      {data?.lists.highRiskStudents?.length ? (
        <>
          <SectionTitle title="Students needing attention" />
          <Rows>
            {data.lists.highRiskStudents.map((student) => {
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
        </>
      ) : null}

      {data?.lists.upcomingFollowUps?.length ? (
        <>
          <SectionTitle title="Follow-ups due" />
          <Rows>
            {data.lists.upcomingFollowUps.map((followUp) => (
              <Row
                key={followUp._id}
                title={followUp.title ?? 'Follow-up'}
                subtitle={followUp.dueDate ? new Date(followUp.dueDate).toLocaleDateString() : undefined}
                icon="calendar-outline"
                right={<Badge label={followUp.status ?? 'pending'} tone="warning" />}
              />
            ))}
          </Rows>
        </>
      ) : null}

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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  action: { flexBasis: '48%', flexGrow: 1 },
  avatar: { width: 42, height: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})
