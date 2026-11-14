import { Text, View } from 'react-native'
import { AppHeader, Badge, Card, Screen, SectionTitle } from '../src/components/ui'
import { spacing, useTheme } from '../src/theme'

const SECTIONS = [
  {
    title: 'What the system records',
    body: 'Conduct incidents, the resultant marks adjustments, risk assessments, guardians linked to each student, parent communication and meetings, and audit records of staff actions. Every marks change is an immutable ledger entry; corrections are separate entries rather than edits.',
  },
  {
    title: 'Who can see what',
    body: 'Staff access follows granular role permissions and class or dormitory assignment. A report author cannot review their own incident. Safeguarding cases are restricted to the safeguarding team; other staff see only a flag. Parents see only their own children.',
  },
  {
    title: 'Parent communication and consent',
    body: 'WhatsApp, SMS and email messages are only sent through channels a guardian has consented to. Consent can be changed at any time from the parent portal. Safeguarding notifications never include case details; they ask the guardian to sign in or contact the school.',
  },
  {
    title: 'Data protection requests',
    body: 'Guardians can request access, correction, objection or erasure from the account tab. Requests are logged, given a reference number, and answered within 30 days unless a legal retention duty applies.',
  },
  {
    title: 'Devices and sessions',
    body: 'This app stores its refresh credential in the operating system keychain or keystore, not plain storage. Sessions can be reviewed and revoked from Devices & sessions. Changing your password revokes every other session. Offline incident drafts stay on this device until synced or deleted.',
  },
  {
    title: 'Notifications',
    body: 'Push notifications use Expo push delivery. Sensitive safeguarding notifications show a generic message. You can revoke this device from Devices & sessions, which also stops notifications.',
  },
] as const

export default function PrivacyScreen() {
  const theme = useTheme()
  return (
    <Screen>
      <AppHeader title="Privacy & data" subtitle="How ConductNexus handles student and guardian information" />

      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.md }}>
        <Badge label="least privilege" tone="info" />
        <Badge label="consent-aware" tone="success" />
        <Badge label="audited" tone="accent" />
      </View>

      {SECTIONS.map((section) => (
        <View key={section.title} style={{ marginBottom: spacing.md }}>
          <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15, marginBottom: 4 }}>{section.title}</Text>
          <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 20 }}>{section.body}</Text>
        </View>
      ))}

      <SectionTitle title="Your choices" />
      <Card>
        <Text style={{ color: theme.textMuted, fontSize: 13, lineHeight: 20 }}>
          Guardians can update communication consent and submit a data protection request from the Account tab. Staff
          can review their active devices under More → Devices & sessions.
        </Text>
      </Card>

      <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: spacing.xl, textAlign: 'center' }}>
        ConductNexus is deployed by your school. Contact the school administration for data protection questions.
      </Text>
    </Screen>
  )
}
