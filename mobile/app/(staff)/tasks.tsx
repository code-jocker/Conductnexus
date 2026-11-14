import { useState } from 'react'
import { router } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal, StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../../src/auth/AuthProvider'
import { apiErrorMessage } from '../../src/api/client'
import { decideApproval, listApprovals, listNotifications } from '../../src/api/endpoints'
import type { Approval } from '../../src/api/types'
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
  SectionTitle,
  TextField,
  statusTone,
} from '../../src/components/ui'
import { personName, timeAgo } from '../../src/utils/format'
import { radius, spacing, useTheme } from '../../src/theme'

type Decision = 'approve' | 'reject' | 'request_info'

export default function TasksScreen() {
  const theme = useTheme()
  const { has } = useAuth()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Approval | null>(null)
  const [decision, setDecision] = useState<Decision>('approve')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const approvals = useQuery({ queryKey: ['approvals', 'pending'], queryFn: () => listApprovals('pending') })
  const notifications = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => listNotifications(true),
    enabled: has('notifications.view'),
  })

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selected) return
      await decideApproval(selected._id, decision, notes.trim())
    },
    onSuccess: async () => {
      setSelected(null)
      setNotes('')
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['approvals'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (err) => setError(apiErrorMessage(err)),
  })

  const open = (approval: Approval, next: Decision) => {
    setSelected(approval)
    setDecision(next)
    setNotes('')
    setError(null)
  }

  const canSubmit = decision === 'approve' ? true : notes.trim().length >= 3

  return (
    <Screen refreshing={approvals.isRefetching} onRefresh={() => void approvals.refetch()}>
      <AppHeader
        title="Tasks"
        subtitle="Approvals, follow-ups and unread notices"
        action={
          has('notifications.view') ? (
            <Button title="Notices" compact variant="secondary" onPress={() => router.push('/notifications')} />
          ) : undefined
        }
      />

      <SectionTitle title="Approvals requiring you" action={<Badge label={`${approvals.data?.pendingCount ?? 0}`} tone="warning" />} />
      {approvals.isLoading ? <LoadingView label="Checking approvals…" /> : null}
      {approvals.error ? (
        <ErrorState message={apiErrorMessage(approvals.error)} onRetry={() => void approvals.refetch()} />
      ) : null}
      {approvals.data?.items.length ? (
        <View style={{ gap: spacing.md }}>
          {approvals.data.items.map((approval) => (
            <Card key={approval._id}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15 }}>{approval.title}</Text>
                  <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 3 }}>
                    {approval.approvalNumber}
                    {approval.studentId && typeof approval.studentId === 'object'
                      ? ` · ${approval.studentId.fullName ?? ''}`
                      : ''}
                  </Text>
                </View>
                <Badge label={approval.type.replace('_', ' ')} tone="info" />
              </View>
              {approval.summary ? (
                <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: spacing.sm }}>{approval.summary}</Text>
              ) : null}
              <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.sm }}>
                Requested by {personName(approval.requestedBy)} · {timeAgo(approval.createdAt)}
              </Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Button title="Approve" compact icon="checkmark" onPress={() => open(approval, 'approve')} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Reject" compact variant="danger" icon="close" onPress={() => open(approval, 'reject')} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Ask" compact variant="secondary" icon="help-circle-outline" onPress={() => open(approval, 'request_info')} />
                </View>
              </View>
            </Card>
          ))}
        </View>
      ) : !approvals.isLoading ? (
        <Card>
          <EmptyState icon="checkmark-done-outline" title="No approvals waiting" message="High-impact discipline decisions appear here when they require your permission." />
        </Card>
      ) : null}

      {has('notifications.view') ? (
        <>
          <SectionTitle title="Unread notices" action={<Badge label={`${notifications.data?.unread ?? 0}`} tone="accent" />} />
          {notifications.data?.items.length ? (
            <Rows>
              {notifications.data.items.slice(0, 8).map((item) => (
                <Row
                  key={item._id}
                  title={item.title}
                  subtitle={item.message}
                  meta={timeAgo(item.createdAt)}
                  icon="notifications-outline"
                  onPress={() => router.push('/notifications')}
                  right={<Badge label={item.type.split('.')[0] ?? item.type} tone={statusTone(item.type)} />}
                />
              ))}
            </Rows>
          ) : (
            <Card>
              <EmptyState icon="notifications-off-outline" title="You are all caught up" />
            </Card>
          )}
        </>
      ) : null}

      <Modal visible={Boolean(selected)} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={[styles.overlay, { backgroundColor: theme.overlay }]}>
          <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
                {decision === 'approve' ? 'Approve' : decision === 'reject' ? 'Reject' : 'Request more information'}
              </Text>
              <Button title="Close" variant="ghost" compact onPress={() => setSelected(null)} />
            </View>
            <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>
              {selected?.title ?? ''}
            </Text>
            <View style={{ marginTop: spacing.lg }}>
              <TextField
                label={decision === 'approve' ? 'Decision notes (optional)' : 'Reason'}
                placeholder={decision === 'reject' ? 'Explain what must change before this can proceed' : 'Add context for the record'}
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </View>
            {error ? <Text style={{ color: theme.danger, fontSize: 13, marginBottom: spacing.sm }}>{error}</Text> : null}
            <Button
              title={decision === 'approve' ? 'Confirm approval' : decision === 'reject' ? 'Confirm rejection' : 'Send request'}
              icon="checkmark-done"
              variant={decision === 'reject' ? 'danger' : 'primary'}
              disabled={!canSubmit}
              loading={mutation.isPending}
              onPress={() => void mutation.mutateAsync()}
            />
            <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.md, textAlign: 'center' }}>
              Every decision is recorded in the audit trail with your name, role, reason and time.
            </Text>
          </View>
        </View>
      </Modal>
    </Screen>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.xl, paddingBottom: spacing.xxl },
})
