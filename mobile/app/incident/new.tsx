import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import * as Network from 'expo-network'
import { useAuth } from '../../src/auth/AuthProvider'
import { apiErrorMessage } from '../../src/api/client'
import { listOffences, listStudents } from '../../src/api/endpoints'
import type { Offence, Student } from '../../src/api/types'
import { saveDraft, listDrafts } from '../../src/offline/db'
import { syncPendingDrafts } from '../../src/offline/sync'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  EmptyState,
  OfflineBanner,
  Screen,
  SearchField,
  SectionTitle,
  severityTone,
  TextField,
} from '../../src/components/ui'
import { radius, spacing, useTheme } from '../../src/theme'

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function newLocalId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export default function NewIncidentScreen() {
  const theme = useTheme()
  const { has } = useAuth()
  const [student, setStudent] = useState<Student | null>(null)
  const [offence, setOffence] = useState<Offence | null>(null)
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => toLocalInput(new Date()))
  const [safeguarding, setSafeguarding] = useState(false)
  const [picker, setPicker] = useState<'student' | 'offence' | null>(null)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const localIdRef = useRef(newLocalId())

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  const students = useQuery({
    queryKey: ['students', 'picker', query],
    queryFn: () => listStudents({ q: query || undefined, pageSize: 25 }),
    enabled: picker === 'student' && has('students.view'),
  })

  const offences = useQuery({
    queryKey: ['offences'],
    queryFn: listOffences,
    enabled: picker === 'offence',
  })

  const canCreate = has('incidents.create')
  const studentLabel = useMemo(() => {
    if (!student) return ''
    const cls = typeof student.classId === 'string' ? '' : student.classId?.name
    return `${student.fullName} · ${student.studentId}${cls ? ` · ${cls}` : ''}`
  }, [student])

  const validate = (): string => {
    if (!student?._id && !student?.id) return 'Select the student involved.'
    if (!offence?._id) return 'Select the offence rule that applies.'
    if (description.trim().length < 10) return 'Describe what happened in at least 10 characters.'
    if (location.trim().length < 2) return 'Add the location where it happened.'
    const when = new Date(occurredAt)
    if (Number.isNaN(when.getTime())) return 'Enter the date and time as YYYY-MM-DDTHH:mm.'
    if (when.getTime() > Date.now() + 60_000) return 'The incident time cannot be in the future.'
    return ''
  }

  const draftInput = () => ({
    studentId: String(student?._id ?? student?.id),
    studentName: student?.fullName ?? 'Student',
    offenceId: String(offence?._id),
    offenceName: offence?.name ?? 'Incident',
    description: description.trim(),
    occurredAt: new Date(occurredAt).toISOString(),
    location: location.trim(),
    safeguarding,
    localId: localIdRef.current,
  })

  const clearForm = () => {
    localIdRef.current = newLocalId()
    setStudent(null)
    setOffence(null)
    setDescription('')
    setLocation('')
    setOccurredAt(toLocalInput(new Date()))
    setSafeguarding(false)
  }

  const saveOffline = () => {
    const message = validate()
    if (message) {
      setError(message)
      return
    }
    setError('')
    try {
      saveDraft(draftInput())
      clearForm()
      Alert.alert('Draft saved', 'This incident is stored on this device and will sync when you submit it online.')
      router.back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The draft could not be saved.')
    }
  }

  const submit = async () => {
    const message = validate()
    if (message) {
      setError(message)
      return
    }
    setError('')
    setBusy(true)
    try {
      saveDraft(draftInput())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The draft could not be saved locally.')
      setBusy(false)
      return
    }

    const network = await Network.getNetworkStateAsync().catch(() => null)
    if (network && (network.isConnected === false || network.isInternetReachable === false)) {
      clearForm()
      setBusy(false)
      Alert.alert('Saved offline', 'You are offline. The incident is queued on this device and will sync later.')
      router.back()
      return
    }

    try {
      await syncPendingDrafts()
      const synced = listDrafts().find((d) => d.localId === localIdRef.current)
      if (synced?.syncStatus === 'synced') {
        clearForm()
        setBusy(false)
        Alert.alert('Incident recorded', `Reference ${synced.serverReference ?? 'created'}. It is now awaiting independent review.`, [
          {
            text: 'View incident',
            onPress: () => {
              if (synced.serverIncidentId) router.replace(`/incident/${synced.serverIncidentId}`)
              else router.back()
            },
          },
        ])
        return
      }
      setBusy(false)
      setError(synced?.lastError ?? 'The incident could not be submitted. It is saved in Offline drafts.')
    } catch (err) {
      setBusy(false)
      setError(`${apiErrorMessage(err)} The draft is saved in Offline drafts and can be retried.`)
    }
  }

  if (!canCreate) {
    return (
      <Screen>
        <EmptyState icon="lock-closed-outline" title="Not available" message="Your role cannot record incidents." />
      </Screen>
    )
  }

  return (
    <Screen>
      <OfflineBanner />
      <AppHeader title="Report incident" subtitle="Record the facts; a colleague will review it independently." />

      <Card>
        <Pressable onPress={() => setPicker('student')}>
          <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '600' }}>STUDENT</Text>
          <Text style={{ color: student ? theme.text : theme.textMuted, fontSize: 15, marginTop: 4 }}>
            {studentLabel || 'Select a student'}
          </Text>
        </Pressable>
        <View style={{ height: 1, backgroundColor: theme.border, marginVertical: spacing.md }} />
        <Pressable onPress={() => setPicker('offence')}>
          <Text style={{ color: theme.textMuted, fontSize: 12, fontWeight: '600' }}>OFFENCE</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 }}>
            <Text style={{ color: offence ? theme.text : theme.textMuted, fontSize: 15, flex: 1 }}>
              {offence ? `${offence.name} · −${offence.deduction} marks` : 'Select an offence rule'}
            </Text>
            {offence ? <Badge label={offence.severity} tone={severityTone(offence.severity)} /> : null}
          </View>
        </Pressable>
      </Card>

      <SectionTitle title="What happened" />
      <TextField
        label="Description"
        value={description}
        onChangeText={setDescription}
        placeholder="Facts only: who, what, where, and any immediate action taken"
        multiline
        maxLength={4000}
      />
      <TextField
        label="Location"
        value={location}
        onChangeText={setLocation}
        placeholder="e.g. Dormitory B, classroom 4, dining hall"
        maxLength={160}
      />
      <TextField
        label="Date and time"
        value={occurredAt}
        onChangeText={setOccurredAt}
        placeholder="YYYY-MM-DDTHH:mm"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: -6, marginBottom: spacing.md }}>
        Use the 24-hour clock, e.g. 2026-11-14T19:30. Future times and very old dates are rejected by the server.
      </Text>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '700' }}>Safeguarding concern</Text>
            <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2, lineHeight: 17 }}>
              Restricts visibility, routes the case to the safeguarding lead, and sends parents a confidential
              notification without details.
            </Text>
          </View>
          <Switch
            value={safeguarding}
            onValueChange={setSafeguarding}
            trackColor={{ true: theme.danger, false: theme.border }}
          />
        </View>
      </Card>

      {error ? (
        <Card style={{ marginTop: spacing.md, backgroundColor: theme.dangerSoft, borderColor: theme.dangerSoft }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </Card>
      ) : null}

      <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
        <Button title="Submit for review" icon="send-outline" loading={busy} onPress={() => void submit()} />
        <Button title="Save offline draft" icon="cloud-offline-outline" variant="secondary" disabled={busy} onPress={saveOffline} />
      </View>
      <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center', marginTop: spacing.md, lineHeight: 16 }}>
        Duplicate protection: this form carries a unique submission reference, so retries and syncs never create two
        incidents.
      </Text>

      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.overlay }}>
          <View
            style={{
              backgroundColor: theme.surface,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              padding: spacing.lg,
              maxHeight: '82%',
              paddingBottom: spacing.xl,
            }}
          >
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800', marginBottom: spacing.md }}>
              {picker === 'student' ? 'Select student' : 'Select offence'}
            </Text>
            {picker === 'student' ? (
              <SearchField value={search} onChange={setSearch} placeholder="Search name or admission number" />
            ) : null}
            <ScrollView keyboardShouldPersistTaps="handled">
              {picker === 'student' ? (
                students.isLoading ? (
                  <Text style={{ color: theme.textMuted, padding: spacing.md }}>Loading students…</Text>
                ) : students.data?.items.length ? (
                  students.data.items.map((item) => (
                    <Pressable
                      key={item._id ?? item.id}
                      onPress={() => {
                        if (item._id) setStudent(item)
                        setPicker(null)
                        setSearch('')
                      }}
                      style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: theme.border }}
                    >
                      <Text style={{ color: theme.text, fontWeight: '700' }}>{item.fullName}</Text>
                      <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                        {item.studentId}
                        {typeof item.classId === 'string' ? '' : item.classId?.name ? ` · ${item.classId.name}` : ''}
                        {` · ${item.currentBalance}/40`}
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text style={{ color: theme.textMuted, padding: spacing.md }}>
                    No students found. If you are offline, type details and save a draft.
                  </Text>
                )
              ) : offences.isLoading ? (
                <Text style={{ color: theme.textMuted, padding: spacing.md }}>Loading offence rules…</Text>
              ) : (
                offences.data?.map((item) => (
                  <Pressable
                    key={item._id}
                    onPress={() => {
                      setOffence(item)
                      setPicker(null)
                    }}
                    style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: theme.border }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Text style={{ color: theme.text, fontWeight: '700', flex: 1 }}>{item.name}</Text>
                      <Badge label={`−${item.deduction}`} tone="accent" />
                      <Badge label={item.severity} tone={severityTone(item.severity)} />
                    </View>
                    <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
                      {item.category}
                      {item.requiresEvidence ? ' · evidence required' : ''}
                    </Text>
                  </Pressable>
                ))
              )}
            </ScrollView>
            <Pressable onPress={() => setPicker(null)} style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
              <Text style={{ color: theme.textMuted, fontWeight: '700' }}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  )
}
