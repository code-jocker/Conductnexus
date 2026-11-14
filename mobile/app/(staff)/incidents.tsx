import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useAuth } from '../../src/auth/AuthProvider'
import { apiErrorMessage } from '../../src/api/client'
import { listIncidents } from '../../src/api/endpoints'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingView,
  OfflineBanner,
  Row,
  Rows,
  Screen,
  SearchField,
  severityTone,
  statusTone,
} from '../../src/components/ui'
import { timeAgo } from '../../src/utils/format'
import { radius, spacing, useTheme } from '../../src/theme'

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'under_review', label: 'Under review' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'draft', label: 'Drafts' },
]

export default function IncidentsScreen() {
  const theme = useTheme()
  const { has } = useAuth()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [query, status])

  const incidents = useQuery({
    queryKey: ['incidents', { query, status, page }],
    queryFn: () => listIncidents({ q: query || undefined, status: status || undefined, page, pageSize: 30 }),
    placeholderData: keepPreviousData,
  })

  const items = incidents.data?.items ?? []
  const meta = incidents.data?.meta

  return (
    <Screen refreshing={incidents.isRefetching} onRefresh={() => void incidents.refetch()}>
      <OfflineBanner />
      <AppHeader
        title="Incidents"
        subtitle={meta ? `${meta.total} record${meta.total === 1 ? '' : 's'} visible to you` : 'Loading…'}
        action={
          has('incidents.create') ? (
            <Button title="Report" icon="add" compact onPress={() => router.push('/incident/new')} />
          ) : undefined
        }
      />

      <SearchField value={search} onChange={setSearch} placeholder="Search number, student, offence…" />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
        {FILTERS.map((filter) => {
          const active = status === filter.key
          return (
            <Pressable
              key={filter.key}
              onPress={() => setStatus(filter.key)}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: 7,
                borderRadius: radius.pill,
                backgroundColor: active ? theme.primary : theme.surface,
                borderWidth: 1,
                borderColor: active ? theme.primary : theme.border,
              }}
            >
              <Text style={{ color: active ? theme.onPrimary : theme.textMuted, fontSize: 12, fontWeight: '700' }}>
                {filter.label}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {incidents.isLoading ? <LoadingView label="Loading incidents…" /> : null}
      {incidents.error ? (
        <ErrorState message={apiErrorMessage(incidents.error)} onRetry={() => void incidents.refetch()} />
      ) : null}

      {!incidents.isLoading && !incidents.error ? (
        items.length ? (
          <Rows>
            {items.map((incident) => (
              <Row
                key={incident._id}
                title={`${incident.incidentNumber} · ${incident.studentSnapshot?.fullName ?? 'Student'}`}
                subtitle={`${incident.offenceSnapshot?.name ?? 'Incident'}${incident.location ? ` · ${incident.location}` : ''}`}
                meta={`${timeAgo(incident.occurredAt)} · reported by ${typeof incident.reportedBy === 'string' ? 'staff' : incident.reportedBy?.name ?? 'staff'}`}
                onPress={() => router.push(`/incident/${incident._id}`)}
                right={
                  <View style={{ alignItems: 'flex-end', gap: 5 }}>
                    <Badge label={incident.status.replace('_', ' ')} tone={statusTone(incident.status)} />
                    <Badge label={incident.severity} tone={severityTone(incident.severity)} />
                  </View>
                }
              />
            ))}
          </Rows>
        ) : (
          <Card>
            <EmptyState
              icon="file-tray-outline"
              title="No incidents match"
              message="Try a different filter or search term. Drafts you save offline appear here after syncing."
            />
          </Card>
        )
      ) : null}

      {meta && meta.page < meta.totalPages ? (
        <View style={{ marginTop: spacing.lg }}>
          <Button
            title="Load more"
            variant="secondary"
            icon="chevron-down"
            loading={incidents.isFetching}
            onPress={() => setPage((p) => p + 1)}
          />
        </View>
      ) : null}
    </Screen>
  )
}
