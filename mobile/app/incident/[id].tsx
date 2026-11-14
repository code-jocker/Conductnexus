import { useState } from 'react'
import { Alert, Modal, Pressable, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../src/auth/AuthProvider'
import { apiErrorMessage } from '../../src/api/client'
import { fetchIncident, reviewIncident, submitIncident } from '../../src/api/endpoints'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingView,
  Screen,
  SectionTitle,
  TextField,
  severityTone,
  statusTone,
} from '../../src/components/ui'
import { formatDateTime, personName } from '../../src/utils/format'
import { radius, spacing, useTheme } from '../../src/theme'

type Decision = 'approve' | 'reject' | 'request_info'

const DECISION_LABEL: Record<Decision, string> = {
  approve: 'Approve incident',
  reject: 'Reject incident',
  request_info: 'Request more information',
}

export default function IncidentDetailScreen() {
  const theme = useTheme()
  const queryClient = useQueryClient()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user, has } = useAuth()
  const [decision, setDecision] = useState<Decision | null>(null)
  const [comments, setComments] = useState('')

  const incident = useQuery({
    queryKey: ['incident', id],
    queryFn: () => fetchIncident(String(id)),
    enabled: Boolean(id),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['incident', id] })
    void queryClient.invalidateQueries({ queryKey: ['incidents'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const submitMutation = useMutation({
    mutationFn: () => submitIncident(String(id)),
    onSuccess: refresh,
    onError: (error) => Alert.alert('Could not submit', apiErrorMessage(error)),
  })

  const reviewMutation = useMutation({
    mutationFn: (input: { decision: Decision; comments: string }) =>
      reviewIncident(String(id), input.decision, input.comments.trim() || undefined),
    onSuccess: () => {
      setDecision(null)
      setComments('')
      refresh()
    },
    onError: (error) => Alert.alert('Review failed', apiErrorMessage(error)),
  })

  if (incident.isLoading) {
    return (
      <Screen>
        <LoadingView label="Loading incident…" />
      </Screen>
    )
  }

  if (incident.error || !incident.data) {
    return (
      <Screen>
        <ErrorState message={apiErrorMessage(incident.error)} onRetry={() => void incident.refetch()} />
      </Screen>
    )
  }

  const data = incident.data
  const student = typeof data.studentId === 'string' ? null : data.studentId
  const reporter = typeof data.reportedBy === 'string' ? null : data.reportedBy
  const isReporter = Boolean(reporter?._id && user?.id && reporter._id === user.id)
  const canReview =
    has('incidents.review') &&
    ['submitted', 'under_review', 'escalated'].includes(data.status) &&
    !isReporter
  const canSubmitDraft = has('incidents.submit') && data.status === 'draft' && isReporter

  return (
    <Screen>
      <AppHeader
        title={data.incidentNumber}
        subtitle={`${student?.fullName ?? data.studentSnapshot?.fullName ?? 'Student'} · ${data.occurredAt ? formatDateTime(data.occurredAt) : ''}`}
      />

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
        <Badge label={data.status.replace('_', ' ')} tone={statusTone(data.status)} />
        <Badge label={data.severity} tone={severityTone(data.severity)} />
        {data.safeguardingFlag ? <Badge label="safeguarding" tone="danger" /> : null}
      </View>

      <Card>
        <Text style={{ color: theme.text, fontWeight: '800', fontSize: 18 }}>{data.offenceSnapshot?.name ?? 'Offence'}</Text>
        <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 2 }}>
          {data.offenceSnapshot?.code ?? ''} {data.offenceSnapshot?.severity ? `· ${data.offenceSnapshot.severity}` : ''}
        </Text>
        <Text style={{ color: theme.text, fontSize: 15, lineHeight: 22, marginTop: spacing.md }}>{data.description}</Text>
        <View style={{ marginTop: spacing.md }}>
          <KeyValue label="Location" value={data.location || '—'} />
          <KeyValue label="Occurred" value={formatDateTime(data.occurredAt)} />
          <KeyValue label="Reported by" value={personName(data.reportedBy)} />
          <KeyValue
            label="Deduction"
            value={`${data.offenceSnapshot?.deduction ?? 0} marks`}
          />
          <KeyValue label="Marks applied" value={data.deductionApplied ? 'Yes' : 'Not yet'} />
          <KeyValue label="Student balance" value={student?.currentBalance !== undefined ? `${student.currentBalance}/40` : '—'} />
        </View>
      </Card>

      {isReporter && ['submitted', 'under_review'].includes(data.status) ? (
        <Card style={{ marginTop: spacing.md, backgroundColor: theme.primarySoft, borderColor: theme.primarySoft }}>
          <Text style={{ color: theme.primary, fontSize: 12, lineHeight: 18 }}>
            Independent review: because you reported this incident, another authorised staff member must review it. You
            cannot approve your own report.
          </Text>
        </Card>
      ) : null}

      {data.safeguardingFlag ? (
        <Card style={{ marginTop: spacing.md, backgroundColor: theme.dangerSoft, borderColor: theme.dangerSoft }}>
          <Text style={{ color: theme.danger, fontWeight: '700' }}>Safeguarding case</Text>
          <Text style={{ color: theme.danger, fontSize: 12, marginTop: 4, lineHeight: 18 }}>
            Details are restricted. Do not discuss this case outside the safeguarding process. Parents receive
            confidential notifications only.
          </Text>
        </Card>
      ) : null}

      {data.witnesses?.length ? (
        <>
          <SectionTitle title="Witnesses" />
          <Card>
            {data.witnesses.map((witness, index) => (
              <View key={`${witness.name}-${index}`} style={{ marginBottom: index === data.witnesses!.length - 1 ? 0 : spacing.md }}>
                <Text style={{ color: theme.text, fontWeight: '700' }}>{witness.name}</Text>
                {witness.contact ? <Text style={{ color: theme.textMuted, fontSize: 12 }}>{witness.contact}</Text> : null}
                {witness.statement ? (
                  <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 4 }}>{witness.statement}</Text>
                ) : null}
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {data.evidenceIds?.length ? (
        <>
          <SectionTitle title="Evidence" />
          <Card>
            {data.evidenceIds.map((file) => (
              <KeyValue
                key={file._id}
                label={file.originalName ?? file.fileName ?? 'Attachment'}
                value={file.mimeType ?? 'file'}
              />
            ))}
            <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.sm }}>
              Evidence files are handled in the web console where they can be verified and downloaded securely.
            </Text>
          </Card>
        </>
      ) : null}

      {data.review?.decision ? (
        <>
          <SectionTitle title="Review decision" />
          <Card>
            <Badge label={String(data.review.decision).replace('_', ' ')} tone={statusTone(String(data.review.decision))} />
            <View style={{ marginTop: spacing.md }}>
              <KeyValue label="Reviewer" value={personName(data.review.reviewedBy)} />
              <KeyValue label="Reviewed" value={formatDateTime(data.review.reviewedAt)} />
            </View>
            {data.review.comments ? (
              <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: spacing.sm, lineHeight: 19 }}>
                {data.review.comments}
              </Text>
            ) : null}
          </Card>
        </>
      ) : null}

      {data.history?.length ? (
        <>
          <SectionTitle title="History" />
          <Card>
            {data.history.map((entry, index) => (
              <View key={`${entry.action}-${index}`} style={{ marginBottom: spacing.sm }}>
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600' }}>{entry.action.replace(/_/g, ' ')}</Text>
                <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                  {formatDateTime(entry.at)}
                  {entry.note ? ` · ${entry.note}` : ''}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {canSubmitDraft ? (
        <View style={{ marginTop: spacing.xl }}>
          <Button
            title="Submit for review"
            icon="send-outline"
            loading={submitMutation.isPending}
            onPress={() =>
              Alert.alert('Submit incident?', 'It will be sent for independent review and may affect the conduct ledger.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Submit', onPress: () => submitMutation.mutate() },
              ])
            }
          />
        </View>
      ) : null}

      {canReview ? (
        <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
          <Button title="Approve" icon="checkmark-circle-outline" onPress={() => setDecision('approve')} />
          <Button
            title="Request more information"
            icon="help-circle-outline"
            variant="secondary"
            onPress={() => setDecision('request_info')}
          />
          <Button title="Reject" icon="close-circle-outline" variant="danger" onPress={() => setDecision('reject')} />
        </View>
      ) : null}

      <Modal visible={decision !== null} transparent animationType="slide" onRequestClose={() => setDecision(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.overlay }}>
          <View
            style={{
              backgroundColor: theme.surface,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              padding: spacing.lg,
              paddingBottom: spacing.xxl,
            }}
          >
            <Text style={{ color: theme.text, fontSize: 19, fontWeight: '800' }}>
              {decision ? DECISION_LABEL[decision] : ''}
            </Text>
            <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 4, marginBottom: spacing.md }}>
              {decision === 'approve'
                ? 'Approval applies the offence deduction and queues the parent notification.'
                : decision === 'reject'
                  ? 'Rejection closes the report without changing the ledger. A reason is required.'
                  : 'The reporter will be asked for more detail before a decision is made.'}
            </Text>
            <TextField
              label={decision === 'approve' ? 'Notes (optional)' : 'Reason'}
              value={comments}
              onChangeText={setComments}
              placeholder="Explain the decision for the audit trail"
              multiline
              maxLength={2000}
            />
            {reviewMutation.error ? (
              <Text style={{ color: theme.danger, fontSize: 12, marginBottom: spacing.sm }}>
                {apiErrorMessage(reviewMutation.error)}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Pressable
                onPress={() => {
                  setDecision(null)
                  setComments('')
                }}
                style={{ flex: 1, paddingVertical: 13, alignItems: 'center' }}
              >
                <Text style={{ color: theme.textMuted, fontWeight: '700' }}>Cancel</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Button
                  title="Confirm"
                  loading={reviewMutation.isPending}
                  disabled={!decision || (decision !== 'approve' && comments.trim().length < 3)}
                  onPress={() => {
                    if (!decision) return
                    reviewMutation.mutate({ decision, comments })
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {!canReview && !canSubmitDraft && !data.review?.decision && data.status !== 'approved' ? (
        <EmptyState
          icon="hourglass-outline"
          title="Awaiting action"
          message="No action is available to you at this stage. Reviewers and administrators continue the workflow."
        />
      ) : null}
    </Screen>
  )
}
