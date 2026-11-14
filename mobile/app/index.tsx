import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Redirect } from 'expo-router'
import { useAuth } from '../src/auth/AuthProvider'
import { useTheme } from '../src/theme'

export default function Index() {
  const { status, isParentOnly } = useAuth()
  const theme = useTheme()

  if (status === 'loading') {
    return (
      <View style={[styles.center, { backgroundColor: theme.navy }]}>
        <View style={styles.mark}>
          <Text style={styles.markText}>CN</Text>
        </View>
        <Text style={styles.title}>ConductNexus</Text>
        <ActivityIndicator color="#d97c3b" style={{ marginTop: 18 }} />
      </View>
    )
  }
  if (status === 'signedOut') return <Redirect href="/(auth)/login" />
  return <Redirect href={isParentOnly ? '/(parent)' : '/(staff)'} />
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: {
    width: 78,
    height: 78,
    borderRadius: 22,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { color: '#ffffff', fontSize: 30, fontWeight: '900', letterSpacing: 1 },
  title: { color: '#ffffff', fontSize: 24, fontWeight: '800', marginTop: 18, letterSpacing: 0.4 },
})
