import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { apiErrorMessage } from '../../src/api/client'
import { listStudents } from '../../src/api/endpoints'
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
  SearchField,
} from '../../src/components/ui'
import { className } from '../../src/utils/format'
import { radius, spacing, useTheme } from '../../src/theme'

const RISKS = [
  { key: '', label: 'All' },
  { key: 'green', label: 'Green' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'orange', label: 'Orange' },
  { key: 'red', label: 'Red' },
]

export default function StudentsScreen() {
  const theme = useTheme()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [risk, setRisk] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [query, risk])

  const students = useQuery({
    queryKey: ['students', { query, risk, page }],
    queryFn: () => listStudents({ q: query || undefined, risk: risk || undefined, page, pageSize: 30 }),
    placeholderData: keepPreviousData,
  })
  const items = students.data?.items ?? []
  const meta = students.data?.meta

  return (
    <Screen refreshing={students.isRefetching} onRefresh={() => void students.refetch()}>
      <AppHeader title="Students" subtitle={meta ? `${meta.total} student${meta.total === 1 ? '' : 's'}` : 'Search your school'} />
      <SearchField value={search} onChange={setSearch} placeholder="Name, student ID or admission number" />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}>
        {RISKS.map((item) => {
          const active = risk === item.key
          return (
            <Pressable
              key={item.key}
              onPress={() => setRisk(item.key)}
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
                {item.label}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {students.isLoading ? <LoadingView label="Loading students…" /> : null}
      {students.error ? (
        <ErrorState message={apiErrorMessage(students.error)} onRetry={() => void students.refetch()} />
      ) : null}

      {!students.isLoading && !students.error ? (
        items.length ? (
          <Rows>
            {items.map((student) => {
              const id = student._id ?? student.id ?? ''
              return (
                <Row
                  key={id}
                  title={student.fullName}
                  subtitle={`${student.studentId}${className(student) ? ` · ${className(student)}` : ''}`}
                  meta={`Balance ${student.currentBalance}${student.status !== 'active' ? ` · ${student.status}` : ''}`}
                  icon="person-outline"
                  onPress={id ? () => router.push(`/student/${id}`) : undefined}
                  right={<Badge label={student.riskLevel} tone={student.riskLevel === 'red' ? 'danger' : student.riskLevel === 'orange' ? 'accent' : student.riskLevel === 'yellow' ? 'warning' : 'success'} />}
                />
              )
            })}
          </Rows>
        ) : (
          <Card>
            <EmptyState icon="people-outline" title="No students found" message="Check the spelling or clear the filters." />
          </Card>
        )
      ) : null}

      {meta && meta.page < meta.totalPages ? (
        <View style={{ marginTop: spacing.lg }}>
          <Button
            title="Load more"
            variant="secondary"
            icon="chevron-down"
            loading={students.isFetching}
            onPress={() => setPage((p) => p + 1)}
          />
        </View>
      ) : null}
    </Screen>
  )
}
