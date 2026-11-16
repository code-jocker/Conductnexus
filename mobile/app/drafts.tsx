import { useCallback, useState } from 'react'
import { Alert, Platform, Text, View } from 'react-native'
import { router } from 'expo-router'
import { apiErrorMessage } from '../src/api/client'
import { deleteDraft, listDrafts, retryDraftAsNew, type LocalDraft } from '../src/offline/db'
import { syncPendingDrafts, type DraftSyncSummary } from '../src/offline/sync'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  EmptyState,
  OfflineBanner,
  Row,
  Rows,
  Screen,
  SectionTitle,
  statusTone,
} from '../src/components/ui'
import { formatDateTime } from '../src/utils/format'
import { spacing, useTheme } from '../src/theme'

export default function DraftsScreen() {
  const theme = useTheme()
  const [drafts, setDrafts] = useState<LocalDraft[]>(() => listDrafts())
  const [syncing, setSyncing] = useState(false)
  const [summary, setSummary] = useState<DraftSyncSummary | null>(null)

  const refresh = useCallback(() => setDrafts(listDrafts()), [])

  const sync = async () => {
    setSyncing(true)
    try {
      const result = await syncPendingDrafts()
      setSummary(result)
      refresh()
      if (result.synced > 0) {
        Alert.alert('Sync complete', `${result.synced} draft${result.synced === 1 ? '' : 's'} recorded on the server.`)
      } else if (result.failed > 0) {
        Alert.alert('Some drafts were not accepted', 'Open a draft to see the reason from the server.')
      } else if (result.attempted === 0) {
        Alert.alert('Nothing to sync', 'There are no pending drafts on this device.')
      }
    } catch (err) {
      Alert.alert('Sync failed', `${apiErrorMessage(err)} Your drafts remain on this device.`)
    } finally {
      setSyncing(false)
    }
  }

  const confirmDelete = (draft: LocalDraft) => {
    Alert.alert('Delete draft?', 'This removes the draft from this device permanently.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteDraft(draft.localId)
          refresh()
        },
      },
    ])
  }

  const pending = drafts.filter((d) => d.syncStatus === 'pending' || d.syncStatus === 'conflict').length
  const needsDecision = drafts.filter((d) => d.syncStatus === 'conflict' || d.syncStatus === 'rejected')

  const requeueAsNew = (draft: LocalDraft) => {
    Alert.alert(
      'Retry as a new report?',
      'The server refused this draft because its submission id was already used. Retrying creates a new submission with the same details, so the report is recorded once.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Retry as new',
          onPress: () => {
            retryDraftAsNew(draft.localId)
            refresh()
            setSummary(null)
          },
        },
      ],
    )
  }

  return (
    <Screen refreshing={syncing} onRefresh={() => void sync()}>
      <OfflineBanner />
      <AppHeader title="Offline drafts" subtitle={drafts.length ? `${drafts.length} on this device · ${pending} pending` : 'Nothing stored yet'} />

      <Button
        title={pending ? 'Sync pending drafts' : 'Check for pending drafts'}
        icon="cloud-upload-outline"
        loading={syncing}
        onPress={() => void sync()}
      />

      {summary ? (
        <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: spacing.sm }}>
          Last attempt: {summary.synced} synced · {summary.failed} failed · {summary.pending} still pending
        </Text>
      ) : null}

      <View style={{ marginTop: spacing.lg }}>
        {needsDecision.length ? (
          <>
            <SectionTitle title="Needs your decision" action={<Badge label={`${needsDecision.length}`} tone="danger" />} />
            <View style={{ gap: spacing.md }}>
              {needsDecision.map((draft) => (
                <Card key={draft.localId}>
                  <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15 }}>
                    {draft.studentName} · {draft.offenceName}
                  </Text>
                  <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 3 }}>
                    {formatDateTime(draft.occurredAt)} · {draft.location || 'No location'}
                  </Text>
                  <View style={{ marginTop: spacing.sm }}>
                    <Badge label={draft.syncStatus} tone={statusTone(draft.syncStatus)} />
                  </View>
                  <Text style={{ color: theme.danger, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 }}>
                    {draft.lastError ?? 'The server did not accept this draft.'}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                    <View style={{ flex: 1 }}>
                      <Button title="Retry as new" compact icon="refresh" onPress={() => requeueAsNew(draft)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button title="Discard" compact variant="danger" onPress={() => confirmDelete(draft)} />
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          </>
        ) : null}

        {drafts.length ? (
          <Rows>
            {drafts.map((draft) => (
              <Row
                key={draft.localId}
                title={`${draft.studentName} · ${draft.offenceName}`}
                subtitle={draft.description.slice(0, 100)}
                meta={`${formatDateTime(draft.occurredAt)}${draft.serverReference ? ` · ${draft.serverReference}` : ''}${
                  draft.lastError ? ` · ${draft.lastError}` : ''
                }`}
                onPress={() => {
                  if (draft.syncStatus === 'synced' && draft.serverIncidentId) {
                    router.push(`/incident/${draft.serverIncidentId}`)
                    return
                  }
                  Alert.alert(
                    'Draft details',
                    `${draft.studentName}\n${draft.offenceName}\n${formatDateTime(draft.occurredAt)}\n${draft.location}\n\n${draft.description}`,
                    [
                      { text: 'Close', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(draft) },
                    ],
                  )
                }}
                right={
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Badge label={draft.syncStatus} tone={statusTone(draft.syncStatus)} />
                    {draft.safeguarding ? <Badge label="safeguarding" tone="danger" /> : null}
                  </View>
                }
              />
            ))}
          </Rows>
        ) : (
          <Card>
            <EmptyState
              icon="cloud-done-outline"
              title="No offline drafts"
              message="Incidents you save while offline appear here. They contain the student, offence, description, location and time, and sync exactly once."
            />
          </Card>
        )}
      </View>

      <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.xl, lineHeight: 16 }}>
        {Platform.OS === 'web'
          ? "On web, drafts are stored in this browser's local storage. They may not be available on other browsers or devices."
          : "Drafts are stored only in this app's private sandbox on this device. Signing out does not delete them; remove them here if the device is shared."}
      </Text>
    </Screen>
  )
}
