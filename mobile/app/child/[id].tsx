import { Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { apiErrorMessage } from '../../src/api/client'
import { fetchPortalChild } from '../../src/api/endpoints'
import {
  AppHeader,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingView,
  Row,
  Rows,
  Screen,
  SectionTitle,
  statusTone,
} from '../../src/components/ui'
import { formatDate, formatDateTime } from '../../src/utils/format'
import { spacing, useTheme } from '../../src/theme'

export default function ChildDetailScreen() {
  const theme = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()

  const child = useQuery({
    queryKey: ['portal', 'child', id],
    queryFn: () => fetchPortalChild(String(id)),
    enabled: Boolean(id),
  })

  if (child.isLoading) {
    return (
      <Screen>
        <LoadingView label="Loading your child's record…" />
      </Screen>
    )
  }

  if (child.error || !child.data) {
    return (
      <Screen>
        <ErrorState message={apiErrorMessage(child.error)} onRetry={() => void child.refetch()} />
      </Screen>
    )
  }

  const { student, conduct, incidents, letters, meetings, recognition, riskHistory } = child.data

  return (
    <Screen refreshing={child.isRefetching} onRefresh={() => void child.refetch()}>
      <AppHeader title={student.fullName} subtitle={`${student.admissionNumber}${student.className ? ` · ${student.className}` : ''}`} />

      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.md }}>
        <Badge label={`${student.balance}/40 marks`} tone={student.balance <= 20 ? 'danger' : 'success'} />
        <Badge label={`${student.risk} risk`} tone={statusTone(student.risk)} />
        <Badge label={student.status} tone={statusTone(student.status)} />
      </View>

      <Card>
        <KeyValue label="Class" value={student.className || '—'} />
        <KeyValue label="Dormitory" value={student.dormitory || '—'} />
        <KeyValue label="Gender" value={student.gender ?? '—'} />
      </Card>

      <SectionTitle title="Conduct this term" />
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {[
            { label: 'Starting', value: conduct.startingMarks, tone: theme.text },
            { label: 'Deducted', value: `−${conduct.totalDeductions}`, tone: theme.danger },
            { label: 'Rewarded', value: `+${conduct.totalRewards}`, tone: theme.success },
            { label: 'Balance', value: conduct.balance, tone: theme.primary },
          ].map((item) => (
            <View key={item.label} style={{ flex: 1 }}>
              <Text style={{ color: item.tone, fontSize: 20, fontWeight: '800' }}>{item.value}</Text>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>{item.label}</Text>
            </View>
          ))}
        </View>
        {conduct.transactions.length ? (
          <View style={{ marginTop: spacing.md }}>
            {conduct.transactions.slice(0, 12).map((entry) => (
              <View
                key={entry.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing.sm,
                  paddingVertical: 7,
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>{entry.reason}</Text>
                  <Text style={{ color: theme.textMuted, fontSize: 11 }}>{formatDateTime(entry.at)}</Text>
                </View>
                <Text style={{ color: entry.change < 0 ? theme.danger : theme.success, fontWeight: '800', fontSize: 13 }}>
                  {entry.change > 0 ? '+' : ''}
                  {entry.change}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 11 }}>{entry.newBalance}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: spacing.md }}>
            No marks changes recorded this term.
          </Text>
        )}
      </Card>

      <SectionTitle title="Incidents" action={<Text style={{ color: theme.textMuted, fontSize: 12 }}>{incidents.length}</Text>} />
      {incidents.length ? (
        <Rows>
          {incidents.map((incident) => (
            <Row
              key={incident.id}
              title={`${incident.reference} · ${incident.offence ?? 'Incident'}`}
              subtitle={incident.description ?? ''}
              meta={`${formatDate(incident.occurredAt)}${incident.deduction ? ` · −${incident.deduction} marks` : ''}`}
              right={<Badge label={incident.status.replace('_', ' ')} tone={statusTone(incident.status)} />}
            />
          ))}
        </Rows>
      ) : (
        <Card>
          <EmptyState icon="checkmark-done-outline" title="No incidents" message="Nothing has been recorded against your child." />
        </Card>
      )}

      {letters.length ? (
        <>
          <SectionTitle title="Letters issued" />
          <Rows>
            {letters.map((letter) => (
              <Row
                key={letter._id}
                icon="mail-outline"
                title={letter.subject}
                subtitle={`${letter.reference} · ${letter.type.replace(/_/g, ' ')}`}
                meta={formatDate(letter.issuedAt)}
              />
            ))}
          </Rows>
        </>
      ) : null}

      {meetings.length ? (
        <>
          <SectionTitle title="Scheduled meetings" />
          <Rows>
            {meetings.map((meeting) => (
              <Row
                key={meeting._id}
                icon="calendar-outline"
                title={meeting.title}
                subtitle={`${formatDateTime(meeting.scheduledAt)}${meeting.location ? ` · ${meeting.location}` : ''}`}
              />
            ))}
          </Rows>
        </>
      ) : null}

      {recognition.length ? (
        <>
          <SectionTitle title="Recognition" />
          <Rows>
            {recognition.map((item) => (
              <Row
                key={item._id}
                icon="ribbon-outline"
                title={item.title}
                subtitle={item.description}
                meta={formatDate(item.awardedAt)}
                right={item.points ? <Badge label={`+${item.points}`} tone="success" /> : undefined}
              />
            ))}
          </Rows>
        </>
      ) : null}

      {riskHistory.length ? (
        <>
          <SectionTitle title="Risk history" />
          <Card>
            {riskHistory.map((entry) => (
              <View key={entry._id} style={{ paddingVertical: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                  <Badge label={`${entry.riskLevel} risk`} tone={statusTone(entry.riskLevel)} />
                  <Text style={{ color: theme.textMuted, fontSize: 11 }}>{formatDate(entry.createdAt)}</Text>
                </View>
                {entry.reasons?.length ? (
                  <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 3 }}>{entry.reasons.join(' · ')}</Text>
                ) : null}
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.xl, textAlign: 'center' }}>
        Deductions follow the school's published offence rules. Contact the school office to discuss any entry.
      </Text>
    </Screen>
  )
}
