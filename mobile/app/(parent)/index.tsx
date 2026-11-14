import { Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { apiErrorMessage } from '../../src/api/client'
import { fetchPortalChildren } from '../../src/api/endpoints'
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
  statusTone,
} from '../../src/components/ui'
import { spacing, useTheme } from '../../src/theme'

export default function ParentHomeScreen() {
  const theme = useTheme()
  const portal = useQuery({ queryKey: ['portal', 'children'], queryFn: fetchPortalChildren })

  if (portal.isLoading) {
    return (
      <Screen>
        <LoadingView label="Loading your children…" />
      </Screen>
    )
  }

  if (portal.error || !portal.data) {
    return (
      <Screen>
        <ErrorState message={apiErrorMessage(portal.error)} onRetry={() => void portal.refetch()} />
      </Screen>
    )
  }

  const { parent, children } = portal.data

  return (
    <Screen refreshing={portal.isRefetching} onRefresh={() => void portal.refetch()}>
      <AppHeader title={`Hello, ${parent.name.split(' ')[0] || 'parent'}`} subtitle="Your children's conduct at a glance" />

      <Card>
        <Text style={{ color: theme.textMuted, fontSize: 12, lineHeight: 18 }}>
          Marks start at 40 each term. Deductions follow the school's published offence rules; corrections are recorded
          separately so the history stays accurate. Contact the school if something looks wrong.
        </Text>
      </Card>

      <SectionTitle title="Children" />
      {children.length ? (
        <Rows>
          {children.map((child) => (
            <Row
              key={child.id}
              icon="person-outline"
              title={child.fullName}
              subtitle={`${child.admissionNumber}${child.className ? ` · ${child.className}` : ''}${
                child.dormitory ? ` · ${child.dormitory}` : ''
              }`}
              meta={`${child.balance}/40 marks · ${child.relationship ?? 'guardian'}${child.primary ? ' · primary' : ''}`}
              onPress={() => router.push(`/child/${child.id}`)}
              right={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Badge label={`${child.risk} risk`} tone={statusTone(child.risk)} />
                  <Badge label={child.status} tone={statusTone(child.status)} />
                </View>
              }
            />
          ))}
        </Rows>
      ) : (
        <Card>
          <EmptyState
            icon="people-outline"
            title="No children linked"
            message="Ask the school office to link your guardian account to your child's admission record."
          />
        </Card>
      )}

      {children.some((child) => child.balance <= 20) ? (
        <>
          <SectionTitle title="Please note" />
          <Card style={{ borderColor: theme.warningSoft, backgroundColor: theme.warningSoft }}>
            <Text style={{ color: theme.warning, fontSize: 13, lineHeight: 19 }}>
              A child's conduct balance is at or below 20 marks. The school may schedule a meeting or intervention. You
              can see the details on the child's page.
            </Text>
          </Card>
        </>
      ) : null}

      <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.xxl, textAlign: 'center' }}>
        Powered by Shyaka clever prince a.k.a Code jocker
      </Text>
    </Screen>
  )
}
