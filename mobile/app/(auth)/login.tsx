import { useCallback, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Link, router } from 'expo-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Ionicons } from '@expo/vector-icons'
import { useAuth } from '../../src/auth/AuthProvider'
import { useGoogleSignIn } from '../../src/auth/google'
import { apiErrorMessage } from '../../src/api/client'
import type { TwoFactorChallenge } from '../../src/api/endpoints'
import { Button, TextField } from '../../src/components/ui'
import { radius, spacing, useTheme } from '../../src/theme'

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})
type FormValues = z.infer<typeof schema>

export default function LoginScreen() {
  const theme = useTheme()
  const { signIn, verifyTwoFactor, signInWithGoogleToken, biometricsLocked, unlockWithBiometric, schoolName } = useAuth()
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null)
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const google = useGoogleSignIn(
    useCallback(
      async (token: string) => {
        await signInWithGoogleToken(token)
        router.replace('/')
      },
      [signInWithGoogleToken],
    ),
  )
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  const submit = handleSubmit(async (values) => {
    try {
      const pending = await signIn(values.email, values.password)
      if (pending) {
        setChallenge(pending)
        setCode(pending.devCode ?? '')
        return
      }
      router.replace('/')
    } catch (err) {
      setError('root', { message: apiErrorMessage(err) })
    }
  })

  const verify = async () => {
    if (!challenge) return
    setVerifyError(null)
    setVerifying(true)
    try {
      await verifyTwoFactor(challenge.challenge, code.trim())
      router.replace('/')
    } catch (err) {
      setVerifyError(apiErrorMessage(err))
    } finally {
      setVerifying(false)
    }
  }

  const cancelChallenge = () => {
    setChallenge(null)
    setCode('')
    setVerifyError(null)
  }

  const unlock = async () => {
    const ok = await unlockWithBiometric()
    if (ok) router.replace('/')
  }

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.navy }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={styles.logo}>
              <Ionicons name="shield-checkmark" size={34} color="#ffffff" />
            </View>
            <Text style={styles.brandTitle}>ConductNexus</Text>
            <Text style={styles.brandSub}>{schoolName === 'ConductNexus' ? 'School conduct & discipline' : schoolName}</Text>
          </View>

          <View style={[styles.card, { backgroundColor: theme.surface }]}>
            <Text style={{ color: theme.text, fontSize: 22, fontWeight: '800' }}>Sign in</Text>
            <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 4, marginBottom: spacing.lg }}>
              Use the same account you use on the web.
            </Text>

            {challenge ? (
              <View>
                <View style={{ backgroundColor: theme.primarySoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
                  <Text style={{ color: theme.primary, fontSize: 13 }}>
                    We sent a 6-digit code to {challenge.email}. Enter it to finish signing in.
                  </Text>
                </View>
                <TextField
                  label="Verification code"
                  placeholder="000000"
                  keyboardType="number-pad"
                  autoCapitalize="none"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                  error={verifyError ?? undefined}
                />
                <Button title="Verify and sign in" icon="shield-checkmark" onPress={() => void verify()} loading={verifying} />
                <Pressable onPress={cancelChallenge} hitSlop={8} style={{ marginTop: spacing.md }}>
                  <Text style={{ color: theme.textMuted, fontSize: 13, textAlign: 'center' }}>Use a different account</Text>
                </Pressable>
              </View>
            ) : (
              <>
            {biometricsLocked ? (
              <View style={{ backgroundColor: theme.primarySoft, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg }}>
                <Text style={{ color: theme.primary, fontWeight: '700' }}>Saved session locked</Text>
                <Text style={{ color: theme.primary, fontSize: 12, marginTop: 4, marginBottom: spacing.md }}>
                  Unlock with your device biometrics, or sign in with your password below.
                </Text>
                <Button title="Unlock" icon="finger-print" onPress={() => void unlock()} />
              </View>
            ) : null}

            <Controller
              control={control}
              name="email"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextField
                  label="Email address"
                  placeholder="you@school.rw"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  textContentType="username"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.email?.message}
                />
              )}
            />
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextField
                  label="Password"
                  placeholder="Your password"
                  secureTextEntry
                  autoComplete="current-password"
                  textContentType="password"
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  error={errors.password?.message}
                />
              )}
            />

            {errors.root?.message ? (
              <View style={{ backgroundColor: theme.dangerSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
                <Text style={{ color: theme.danger, fontSize: 13 }}>{errors.root.message}</Text>
              </View>
            ) : null}

            <Button title="Sign in" icon="log-in-outline" onPress={() => void submit()} loading={isSubmitting} />

            {google.configured ? (
              <View style={{ marginTop: spacing.md }}>
                <Button
                  title="Continue with Google"
                  icon="logo-google"
                  variant="secondary"
                  loading={google.busy}
                  onPress={google.prompt}
                  disabled={!google.ready}
                />
              </View>
            ) : null}
            {google.error ? (
              <Text style={{ color: theme.danger, fontSize: 12, marginTop: 8 }}>{google.error}</Text>
            ) : null}

            <View style={styles.links}>
              <Link href="/(auth)/forgot-password" style={{ color: theme.primary, fontWeight: '600', fontSize: 13 }}>
                Forgot password?
              </Link>
              <Pressable onPress={() => router.push('/privacy')} hitSlop={8}>
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>Privacy</Text>
              </Pressable>
            </View>
              </>
            )}
          </View>

          <Text style={styles.footer}>Powered by Shyaka clever prince a.k.a Code jocker</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  brandTitle: { color: '#ffffff', fontSize: 27, fontWeight: '900', marginTop: spacing.md, letterSpacing: 0.3 },
  brandSub: { color: 'rgba(255,255,255,0.72)', fontSize: 13, marginTop: 3 },
  card: { borderRadius: radius.lg, padding: spacing.xl },
  links: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg },
  footer: { color: 'rgba(255,255,255,0.55)', fontSize: 11, textAlign: 'center', marginTop: spacing.xl },
})
