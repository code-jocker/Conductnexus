import { useState } from 'react'
import { Alert, Pressable, Switch, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../src/auth/AuthProvider'
import { apiErrorMessage } from '../../src/api/client'
import {
  fetchPortalChildren,
  fetchPortalConsent,
  submitPortalDataRequest,
  updatePortalConsent,
  type PortalConsent,
} from '../../src/api/endpoints'
import {
  AppHeader,
  Badge,
  Button,
  Card,
  KeyValue,
  LoadingView,
  Row,
  Rows,
  Screen,
  SectionTitle,
  TextField,
} from '../../src/components/ui'
import { radius, spacing, useTheme } from '../../src/theme'

const REQUEST_TYPES = [
  { key: 'access', label: 'Access my data' },
  { key: 'correction', label: 'Correct my data' },
  { key: 'objection', label: 'Object to processing' },
  { key: 'erasure', label: 'Request erasure' },
] as const

type RequestType = (typeof REQUEST_TYPES)[number]['key']

export default function ParentAccountScreen() {
  const theme = useTheme()
  const queryClient = useQueryClient()
  const { signOut, schoolName } = useAuth()
  const [requestType, setRequestType] = useState<RequestType>('access')
  const [details, setDetails] = useState('')
  const [requestRef, setRequestRef] = useState('')
  const [error, setError] = useState('')

  const portal = useQuery({ queryKey: ['portal', 'children'], queryFn: fetchPortalChildren })
  const consent = useQuery({ queryKey: ['portal', 'consent'], queryFn: fetchPortalConsent })

  const saveConsent = useMutation({
    mutationFn: (input: Partial<PortalConsent>) => updatePortalConsent(input),
    onSuccess: (data) => {
      queryClient.setQueryData(['portal', 'consent'], data)
    },
    onError: (err) => Alert.alert('Consent not saved', apiErrorMessage(err)),
  })

  const dataRequest = useMutation({
    mutationFn: () => submitPortalDataRequest({ type: requestType, details: details.trim() }),
    onSuccess: (data) => {
      setRequestRef(`${data.requestNumber} · due ${new Date(data.dueDate).toDateString()}`)
      setDetails('')
      Alert.alert('Request submitted', `Reference ${data.requestNumber}. The school will respond within 30 days.`)
    },
    onError: (err) => setError(apiErrorMessage(err)),
  })

  const parent = portal.data?.parent
  const consentData = consent.data

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to see your children.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ])
  }

  return (
    <Screen>
      <AppHeader title="Account" subtitle={schoolName} />

      <Card>
        <Text style={{ color: theme.text, fontSize: 19, fontWeight: '800' }}>{parent?.name ?? 'Guardian'}</Text>
        <View style={{ marginTop: spacing.sm }}>
          <KeyValue label="Phone" value={parent?.phone ?? '—'} />
          <KeyValue label="Email" value={parent?.email ?? '—'} />
          <KeyValue label="Children linked" value={String(portal.data?.children.length ?? 0)} />
        </View>
      </Card>

      <SectionTitle title="Communication consent" />
      {consent.isLoading ? <LoadingView label="Loading consent…" /> : null}
      {consentData ? (
        <Card>
          {(
            [
              { key: 'whatsappConsent', label: 'WhatsApp messages' },
              { key: 'smsConsent', label: 'SMS messages' },
              { key: 'emailConsent', label: 'Email messages' },
            ] as const
          ).map((channel) => (
            <View
              key={channel.key}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingVertical: spacing.sm,
                borderBottomWidth: channel.key === 'emailConsent' ? 0 : 1,
                borderBottomColor: theme.border,
              }}
            >
              <Text style={{ color: theme.text, flex: 1, fontSize: 14 }}>{channel.label}</Text>
              <Switch
                value={consentData[channel.key]}
                onValueChange={(value) => saveConsent.mutate({ [channel.key]: value } as Partial<PortalConsent>)}
                trackColor={{ true: theme.primary, false: theme.border }}
              />
            </View>
          ))}
          <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.sm, lineHeight: 16 }}>
            You can withdraw consent at any time. Safeguarding and legal communications may still be sent where the
            school has a duty to inform you.
          </Text>
        </Card>
      ) : null}

      <SectionTitle title="Data protection request" />
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
          {REQUEST_TYPES.map((type) => {
            const active = requestType === type.key
            return (
              <Pressable
                key={type.key}
                onPress={() => setRequestType(type.key)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: 7,
                  borderRadius: radius.pill,
                  borderWidth: 1,
                  borderColor: active ? theme.primary : theme.border,
                  backgroundColor: active ? theme.primarySoft : theme.surface,
                }}
              >
                <Text style={{ color: active ? theme.primary : theme.textMuted, fontSize: 12, fontWeight: '700' }}>
                  {type.label}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <TextField
          label="Details"
          value={details}
          onChangeText={setDetails}
          placeholder="Explain what you are asking for (at least 10 characters)"
          multiline
          maxLength={4000}
        />
        {error ? <Text style={{ color: theme.danger, fontSize: 12, marginBottom: spacing.sm }}>{error}</Text> : null}
        {requestRef ? (
          <Text style={{ color: theme.success, fontSize: 12, marginBottom: spacing.sm }}>Submitted: {requestRef}</Text>
        ) : null}
        <Button
          title="Submit request"
          icon="document-attach-outline"
          variant="secondary"
          loading={dataRequest.isPending}
          disabled={details.trim().length < 10}
          onPress={() => {
            setError('')
            dataRequest.mutate()
          }}
        />
        <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.sm, lineHeight: 16 }}>
          Requests are logged with a reference and answered within 30 days. Some records must be retained under school
          policy or law.
        </Text>
      </Card>

      <SectionTitle title="Settings" />
      <Rows>
        <Row icon="shield-checkmark-outline" title="Privacy & data" onPress={() => router.push('/privacy')} />
        <Row icon="notifications-outline" title="Notices" onPress={() => router.push('/(parent)/notices')} />
        <Row icon="phone-portrait-outline" title="Devices & sessions" onPress={() => router.push('/sessions')} />
      </Rows>

      <View style={{ marginTop: spacing.xl }}>
        <Button title="Sign out" icon="log-out-outline" variant="danger" onPress={confirmSignOut} />
      </View>
      <View style={{ alignItems: 'center', marginTop: spacing.lg }}>
        <Badge label="guardian portal" tone="info" />
      </View>
      <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center', marginTop: spacing.lg }}>
        Powered by Shyaka clever prince a.k.a Code jocker
      </Text>
    </Screen>
  )
}
