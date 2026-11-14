import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { apiErrorMessage } from '../../src/api/client'
import { forgotPassword, resetPassword } from '../../src/api/endpoints'
import { Button, Screen, TextField } from '../../src/components/ui'
import { radius, spacing, useTheme } from '../../src/theme'

const emailSchema = z.object({ email: z.string().trim().email('Enter a valid email address') })
const resetSchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().length(6, 'Enter the 6-digit code'),
  newPassword: z
    .string()
    .min(10, 'At least 10 characters')
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/\d/, 'Include a number'),
})

export default function ForgotPasswordScreen() {
  const theme = useTheme()
  const [step, setStep] = useState<'request' | 'reset'>('request')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const requestForm = useForm<{ email: string }>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  })
  const resetForm = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { email: '', code: '', newPassword: '' },
  })

  const request = requestForm.handleSubmit(async (values) => {
    setLoading(true)
    setError(null)
    try {
      const result = await forgotPassword(values.email)
      setDevCode(result.devCode ?? null)
      resetForm.setValue('email', values.email)
      setMessage('If that address belongs to an active account, a 6-digit reset code has been sent.')
      setStep('reset')
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  })

  const reset = resetForm.handleSubmit(async (values) => {
    setLoading(true)
    setError(null)
    try {
      await resetPassword(values)
      setMessage('Password reset. Sign in with your new password.')
      setTimeout(() => router.replace('/(auth)/login'), 1200)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  })

  return (
    <Screen>
      <Text style={{ color: theme.text, fontSize: 23, fontWeight: '800' }}>Reset your password</Text>
      <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 4, marginBottom: spacing.xl }}>
        {step === 'request'
          ? 'We will email a 6-digit code to your school address.'
          : 'Enter the code from your email and choose a new password.'}
      </Text>

      {message ? (
        <View style={{ backgroundColor: theme.successSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
          <Text style={{ color: theme.success, fontSize: 13 }}>{message}</Text>
          {devCode ? (
            <Text style={{ color: theme.success, fontSize: 12, marginTop: 6 }}>
              Development code: <Text style={{ fontWeight: '800' }}>{devCode}</Text>
            </Text>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <View style={{ backgroundColor: theme.dangerSoft, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md }}>
          <Text style={{ color: theme.danger, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      {step === 'request' ? (
        <>
          <Controller
            control={requestForm.control}
            name="email"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextField
                label="Email address"
                placeholder="you@school.rw"
                keyboardType="email-address"
                autoCapitalize="none"
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={requestForm.formState.errors.email?.message}
              />
            )}
          />
          <Button title="Send reset code" icon="mail-outline" onPress={() => void request()} loading={loading} />
        </>
      ) : (
        <>
          <Controller
            control={resetForm.control}
            name="code"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextField
                label="6-digit code"
                placeholder="000000"
                keyboardType="number-pad"
                maxLength={6}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={resetForm.formState.errors.code?.message}
              />
            )}
          />
          <Controller
            control={resetForm.control}
            name="newPassword"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextField
                label="New password"
                placeholder="At least 10 characters"
                secureTextEntry
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                error={resetForm.formState.errors.newPassword?.message}
              />
            )}
          />
          <Button title="Set new password" icon="key-outline" onPress={() => void reset()} loading={loading} />
          <View style={{ marginTop: spacing.md }}>
            <Button title="Use a different email" variant="ghost" onPress={() => setStep('request')} />
          </View>
        </>
      )}
      <View style={{ marginTop: spacing.xl }}>
        <Button title="Back to sign in" variant="secondary" icon="arrow-back" onPress={() => router.replace('/(auth)/login')} />
      </View>
      <Text style={styles.footer}>Powered by Shyaka clever prince a.k.a Code jocker</Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  footer: { color: '#8695ad', fontSize: 11, textAlign: 'center', marginTop: spacing.xxl },
})
