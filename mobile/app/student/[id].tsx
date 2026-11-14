import { router, useLocalSearchParams } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Text, View } from 'react-native'
import { useAuth } from '../../src/auth/AuthProvider'
import { apiErrorMessage } from '../../src/api/client'
import { fetchStudentProfile } from '../../src/api/endpoints'
import type { GuardianView } from '../../src/api/types'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingView,
  Row,
  Rows,
  Screen,
  SectionTitle,
  severityTone,
  statusTone,
} from '../../src/components/ui'
import { formatDate, formatDateTime, timeAgo } from '../../src/utils/format'
import { spacing, useTheme } from '../../src/theme'

function guardianLine(guardian: GuardianView): { name: string; detail: string } {
  const parent = typeof guardian.parentId === 'object' && guardian.parentId ? guardian.parentId : null
  return {
    name: parent?.name ?? 'Guardian',
    detail: [guardian.relationship, parent?.phone ?? parent?.email].filter(Boolean).join(' · '),
  }
}

export default function StudentDetailScreen() {
  const theme = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { has } = useAuth()

  const profile = useQuery({
    queryKey: ['student', id],
    queryFn: () => fetchStudentProfile(String(id)),
    enabled: Boolean(id),
  })

  if (profile.isLoading) {
    return (
      <Screen>
        <LoadingView label="Loading student…" />
      </Screen>
    )
  }

  if (profile.error || !profile.data) {
    return (
      <Screen>
        <ErrorState message={apiErrorMessage(profile.error)} onRetry={() => void profile.refetch()} />
      </Screen>
    )
  }

  const { student, class: cls, stream, dormitory, conduct, guardians, incidents, assessments, interventions, followUps, recognitions } =
    profile.data
  const latestRisk = assessments[0]
  const classLabel = [cls?.name, stream?.name].filter(Boolean).join(' · ')

  return (
    <Screen refreshing={profile.isRefetching} onRefresh={() => void profile.refetch()}>
      <AppHeader
        title={student.fullName}
        subtitle={`${student.studentId}${classLabel ? ` · ${classLabel}` : ''}`}
        action={
          has('incidents.create') ? (
            <Button title="Report" icon="add" compact onPress={() => router.push('/incident/new')} />
          ) : undefined
        }
      />

      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.md }}>
        <Badge label={`${student.currentBalance}/40 marks`} tone={student.currentBalance <= 20 ? 'danger' : 'success'} />
        <Badge label={`${student.riskLevel} risk`} tone={statusTone(student.riskLevel)} />
        <Badge label={student.status} tone={statusTone(student.status)} />
      </View>

      <Card>
        <KeyValue label="Class" value={classLabel || '—'} />
        <KeyValue label="Dormitory" value={dormitory?.name ?? '—'} />
        <KeyValue label="Gender" value={student.gender ?? '—'} />
        <KeyValue label="Admission number" value={student.admissionNumber ?? student.studentId} />
      </Card>

      <SectionTitle title={`Conduct${conduct.term?.name ? ` · ${conduct.term.name}` : ''}`} />
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {[
            { label: 'Starting', value: conduct.startingMarks, tone: theme.text },
            { label: 'Deducted', value: `−${conduct.totalDeductions}`, tone: theme.danger },
            { label: 'Rewarded', value: `+${conduct.totalRewards}`, tone: theme.success },
            { label: 'Balance', value: conduct.currentBalance, tone: theme.primary },
          ].map((item) => (
            <View key={item.label} style={{ flex: 1 }}>
              <Text style={{ color: item.tone, fontSize: 20, fontWeight: '800' }}>{item.value}</Text>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>{item.label}</Text>
            </View>
          ))}
        </View>
        <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.md }}>
          History is preserved as immutable entries; corrections are recorded as separate adjustments.
        </Text>
      </Card>

      {latestRisk ? (
        <>
          <SectionTitle title="Risk assessment" />
          <Card>
            <Badge label={`${latestRisk.riskLevel ?? 'unknown'} risk`} tone={statusTone(latestRisk.riskLevel ?? '')} />
            <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 4 }}>
              Updated {formatDateTime(latestRisk.createdAt)}
            </Text>
            {latestRisk.reasons?.length ? (
              <View style={{ marginTop: spacing.sm, gap: 4 }}>
                {latestRisk.reasons.map((reason) => (
                  <Text key={reason} style={{ color: theme.text, fontSize: 13 }}>
                    • {reason}
                  </Text>
                ))}
              </View>
            ) : null}
          </Card>
        </>
      ) : null}

      <SectionTitle title="Recent incidents" action={<Text style={{ color: theme.textMuted, fontSize: 12 }}>{incidents.length}</Text>} />
      {incidents.length ? (
        <Rows>
          {incidents.slice(0, 8).map((incident) => (
            <Row
              key={incident._id}
              title={`${incident.incidentNumber} · ${incident.offenceSnapshot?.name ?? 'Incident'}`}
              subtitle={`${formatDate(incident.occurredAt)}${incident.location ? ` · ${incident.location}` : ''}`}
              meta={incident.description ? incident.description.slice(0, 90) : undefined}
              onPress={() => router.push(`/incident/${incident._id}`)}
              right={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Badge label={incident.status.replace('_', ' ')} tone={statusTone(incident.status)} />
                  <Badge label={incident.severity} tone={severityTone(incident.severity)} />
                </View>
              }
            />
          ))}
        </Rows>
      ) : (
        <Card>
          <EmptyState icon="checkmark-done-outline" title="No incidents" message="No conduct incidents have been recorded for this student." />
        </Card>
      )}

      {guardians.length ? (
        <>
          <SectionTitle title="Guardians" />
          <Rows>
            {guardians.map((link, index) => {
              const line = guardianLine(link)
              return (
                <Row
                  key={link._id ?? `${line.name}-${index}`}
                  icon="people-outline"
                  title={line.name}
                  subtitle={line.detail}
                  right={link.isPrimary ? <Badge label="primary" tone="info" /> : undefined}
                />
              )
            })}
          </Rows>
        </>
      ) : null}

      {interventions.length ? (
        <>
          <SectionTitle title="Interventions" />
          <Rows>
            {interventions.map((item, index) => (
              <Row
                key={item._id ?? index}
                icon="construct-outline"
                title={item.title ?? 'Intervention'}
                subtitle={item.type?.replace(/_/g, ' ')}
                right={<Badge label={item.status ?? 'open'} tone={statusTone(item.status ?? '')} />}
              />
            ))}
          </Rows>
        </>
      ) : null}

      {followUps.length ? (
        <>
          <SectionTitle title="Follow-ups due" />
          <Rows>
            {followUps.map((item, index) => (
              <Row
                key={item._id ?? index}
                icon="calendar-outline"
                title={item.title ?? 'Follow-up'}
                subtitle={item.dueDate ? `Due ${formatDate(item.dueDate)}` : undefined}
              />
            ))}
          </Rows>
        </>
      ) : null}

      {recognitions.length ? (
        <>
          <SectionTitle title="Recognition" />
          <Rows>
            {recognitions.map((item, index) => (
              <Row
                key={item._id ?? index}
                icon="ribbon-outline"
                title={item.title ?? 'Recognition'}
                subtitle={item.awardedAt ? timeAgo(item.awardedAt) : undefined}
                right={item.points ? <Badge label={`+${item.points}`} tone="success" /> : undefined}
              />
            ))}
          </Rows>
        </>
      ) : null}
    </Screen>
  )
}
