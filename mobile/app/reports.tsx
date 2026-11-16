import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { apiErrorMessage } from '../src/api/client'
import { fetchReport, type ReportKind, type ReportPayload } from '../src/api/endpoints'
import { useAuth } from '../src/auth/AuthProvider'
import {
  AppHeader,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingView,
  OfflineBanner,
  Row,
  Rows,
  Screen,
  SectionTitle,
} from '../src/components/ui'
import { spacing, useTheme } from '../src/theme'

const KINDS: { kind: ReportKind; label: string; hint: string }[] = [
  { kind: 'term', label: 'Term report', hint: 'Deductions, rewards and incident counts for the active term' },
  { kind: 'year-end', label: 'Year end', hint: 'Term-over-term comparison across the academic year' },
  { kind: 'high-risk', label: 'High risk', hint: 'Students in orange or red risk with open interventions' },
  { kind: 'class', label: 'By class', hint: 'Conduct position and top offences per class' },
  { kind: 'teacher-activity', label: 'Teacher activity', hint: 'Submissions, approvals and rejections by reporter' },
  { kind: 'communication', label: 'Communication', hint: 'Message queue volume by status and channel' },
]

const titleCase = (value: string) =>
  value.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())

const isScalar = (value: unknown) => value === null || ['string', 'number', 'boolean'].includes(typeof value)

const display = (value: unknown): string => {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function scalarsOf(report: ReportPayload): [string, unknown][] {
  return Object.entries(report).filter(([, value]) => isScalar(value))
}

function listsOf(report: ReportPayload): [string, Record<string, unknown>[]][] {
  const out: [string, Record<string, unknown>[]][] = []
  for (const [key, value] of Object.entries(report)) {
    if (!Array.isArray(value) || value.length === 0) continue
    if (!value.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) continue
    out.push([key, value as Record<string, unknown>[]])
  }
  return out
}

function objectsOf(report: ReportPayload): [string, Record<string, unknown>][] {
  const out: [string, Record<string, unknown>][] = []
  for (const [key, value] of Object.entries(report)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    out.push([key, value as Record<string, unknown>])
  }
  return out
}

export default function ReportsScreen() {
  const theme = useTheme()
  const { has } = useAuth()
  const [kind, setKind] = useState<ReportKind>('term')

  const allowed = has('reports.view')
  const report = useQuery({
    queryKey: ['report', kind],
    queryFn: () => fetchReport(kind),
    enabled: allowed,
  })

  const meta = KINDS.find((entry) => entry.kind === kind)
  const data = report.data

  return (
    <Screen refreshing={report.isRefetching} onRefresh={() => void report.refetch()}>
      <OfflineBanner />
      <AppHeader title="Reports" subtitle={meta?.hint ?? 'Read-only summaries'} />

      {!allowed ? (
        <Card>
          <EmptyState
            icon="lock-closed-outline"
            title="Reports are restricted"
            message="Your role does not include the reports.view permission. Ask an administrator if you need access."
          />
        </Card>
      ) : (
        <>
          <SectionTitle title="Report" />
          <View style={styles.chips}>
            {KINDS.map((entry) => {
              const active = entry.kind === kind
              return (
                <View key={entry.kind} style={styles.chip}>
                  <Card onPress={() => setKind(entry.kind)}>
                    <Text style={{ color: active ? theme.primary : theme.text, fontWeight: '700', fontSize: 13 }}>
                      {entry.label}
                    </Text>
                    {active ? (
                      <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 2 }}>{entry.hint}</Text>
                    ) : null}
                  </Card>
                </View>
              )
            })}
          </View>

          {report.isLoading ? <LoadingView label="Building report…" /> : null}
          {report.error ? (
            <ErrorState message={apiErrorMessage(report.error)} onRetry={() => void report.refetch()} />
          ) : null}

          {data ? (
            <>
              {scalarsOf(data).length ? (
                <>
                  <SectionTitle
                    title="Summary"
                    action={<Badge label={titleCase(kind)} tone="info" />}
                  />
                  <Card>
                    {scalarsOf(data).map(([key, value]) => (
                      <KeyValue key={key} label={titleCase(key)} value={display(value)} />
                    ))}
                  </Card>
                </>
              ) : null}

              {objectsOf(data).map(([key, value]) => (
                <View key={key}>
                  <SectionTitle title={titleCase(key)} />
                  <Card>
                    {Object.entries(value).map(([subKey, subValue]) => (
                      <KeyValue key={subKey} label={titleCase(subKey)} value={display(subValue)} />
                    ))}
                  </Card>
                </View>
              ))}

              {listsOf(data).map(([key, rows]) => (
                <View key={key}>
                  <SectionTitle title={titleCase(key)} action={<Badge label={`${rows.length}`} tone="neutral" />} />
                  <Rows>
                    {rows.slice(0, 12).map((row, index) => {
                      const title = display(row.title ?? row.name ?? row.studentId ?? row._id ?? `Row ${index + 1}`)
                      const subtitle = Object.entries(row)
                        .filter(([subKey, subValue]) => !['title', 'name', '_id', 'studentId'].includes(subKey) && isScalar(subValue))
                        .slice(0, 2)
                        .map(([subKey, subValue]) => `${titleCase(subKey)}: ${display(subValue)}`)
                        .join(' · ')
                      return (
                        <Row
                          key={display(row._id ?? index)}
                          title={title}
                          subtitle={subtitle || undefined}
                          icon="document-text-outline"
                        />
                      )
                    })}
                  </Rows>
                  {rows.length > 12 ? (
                    <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: spacing.sm }}>
                      Showing the first 12 of {rows.length} rows. Exports are available in the web console.
                    </Text>
                  ) : null}
                </View>
              ))}

              <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.lg }}>
                Read-only view. Figures come from the same permission-scoped report service the web console uses.
              </Text>
            </>
          ) : null}
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { flexBasis: '48%', flexGrow: 1 },
})