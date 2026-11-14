import type { ComponentProps, ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import * as Network from 'expo-network'
import { radius, spacing, useTheme, type Palette } from '../theme'

type IconName = ComponentProps<typeof Ionicons>['name']

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  padded = true,
  style,
}: {
  children: ReactNode
  scroll?: boolean
  refreshing?: boolean
  onRefresh?: () => void
  padded?: boolean
  style?: ViewStyle
}) {
  const theme = useTheme()
  const body = padded ? { padding: spacing.lg } : undefined
  if (!scroll) {
    return (
      <SafeAreaView style={[{ flex: 1, backgroundColor: theme.background }, style]} edges={['top', 'left', 'right']}>
        <View style={[{ flex: 1 }, body]}>{children}</View>
      </SafeAreaView>
    )
  }
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: theme.background }, style]} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[{ paddingBottom: spacing.xxl }, body]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={theme.primary} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}

export function AppHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 }}>{title}</Text>
        {subtitle ? <Text style={{ color: theme.textMuted, fontSize: 14, marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  )
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode
  style?: ViewStyle
  onPress?: () => void
}) {
  const theme = useTheme()
  const base: ViewStyle = {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    padding: spacing.lg,
  }
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        android_ripple={{ color: theme.primarySoft }}
        style={({ pressed }) => [base, style, pressed && { opacity: 0.85 }]}
      >
        {children}
      </Pressable>
    )
  }
  return <View style={[base, style]}>{children}</View>
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm }}>
      <Text style={{ color: theme.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
      {action}
    </View>
  )
}

export function Button({
  title,
  onPress,
  icon,
  loading,
  disabled,
  variant = 'primary',
  compact,
}: {
  title: string
  onPress: () => void
  icon?: IconName
  loading?: boolean
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  compact?: boolean
}) {
  const theme = useTheme()
  const palette: Record<typeof variant, { bg: string; fg: string; border: string }> = {
    primary: { bg: theme.primary, fg: theme.onPrimary, border: theme.primary },
    secondary: { bg: theme.surface, fg: theme.primary, border: theme.border },
    ghost: { bg: 'transparent', fg: theme.text, border: 'transparent' },
    danger: { bg: theme.dangerSoft, fg: theme.danger, border: theme.dangerSoft },
  }
  const colors = palette[variant]
  const inactive = disabled || loading
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      android_ripple={{ color: theme.primarySoft }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          backgroundColor: colors.bg,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: radius.md,
          paddingHorizontal: compact ? spacing.md : spacing.lg,
          paddingVertical: compact ? spacing.sm : 13,
          opacity: inactive ? 0.55 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.fg} />
      ) : icon ? (
        <Ionicons name={icon} size={18} color={colors.fg} />
      ) : null}
      <Text style={{ color: colors.fg, fontWeight: '700', fontSize: 15 }}>{title}</Text>
    </Pressable>
  )
}

export function IconButton({
  icon,
  onPress,
  label,
  badge,
}: {
  icon: IconName
  onPress: () => void
  label: string
  badge?: number
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        width: 42,
        height: 42,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.surfaceMuted,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={21} color={theme.text} />
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: 3,
            right: 3,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: radius.pill,
            backgroundColor: theme.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

export function TextField({
  label,
  error,
  ...props
}: TextInputProps & { label?: string; error?: string }) {
  const theme = useTheme()
  const multiline = Boolean(props.multiline)
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? (
        <Text style={{ color: theme.text, fontWeight: '600', fontSize: 13, marginBottom: 6 }}>{label}</Text>
      ) : null}
      <TextInput
        placeholderTextColor={theme.textMuted}
        {...props}
        style={[
          {
            backgroundColor: theme.surface,
            borderColor: error ? theme.danger : theme.border,
            borderWidth: 1,
            borderRadius: radius.md,
            color: theme.text,
            paddingHorizontal: spacing.md,
            paddingVertical: 12,
            fontSize: 15,
            minHeight: multiline ? 110 : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
          },
          props.style,
        ]}
      />
      {error ? <Text style={{ color: theme.danger, fontSize: 12, marginTop: 4 }}>{error}</Text> : null}
    </View>
  )
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const theme = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: theme.surface,
        borderColor: theme.border,
        borderWidth: 1,
        borderRadius: radius.md,
        paddingHorizontal: spacing.md,
        marginBottom: spacing.md,
      }}
    >
      <Ionicons name="search" size={18} color={theme.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        style={{ flex: 1, color: theme.text, fontSize: 15, paddingVertical: 11 }}
        returnKeyType="search"
        autoCorrect={false}
      />
      {value ? (
        <Pressable onPress={() => onChange('')} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color={theme.textMuted} />
        </Pressable>
      ) : null}
    </View>
  )
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent'

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const theme = useTheme()
  const tones: Record<Tone, { bg: string; fg: string }> = {
    neutral: { bg: theme.surfaceMuted, fg: theme.textMuted },
    info: { bg: theme.primarySoft, fg: theme.primary },
    success: { bg: theme.successSoft, fg: theme.success },
    warning: { bg: theme.warningSoft, fg: theme.warning },
    danger: { bg: theme.dangerSoft, fg: theme.danger },
    accent: { bg: theme.accentSoft, fg: theme.accent },
  }
  const colors = tones[tone]
  return (
    <View style={{ backgroundColor: colors.bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 }}>
      <Text style={{ color: colors.fg, fontSize: 11, fontWeight: '800', textTransform: 'capitalize' }}>{label}</Text>
    </View>
  )
}

export function statusTone(status: string): Tone {
  const value = status.toLowerCase()
  if (['approved', 'synced', 'active', 'green', 'closed'].includes(value)) return 'success'
  if (['submitted', 'under_review', 'escalated', 'pending', 'yellow'].includes(value)) return 'warning'
  if (['rejected', 'conflict', 'red', 'suspended'].includes(value)) return 'danger'
  if (['draft', 'info_requested', 'orange'].includes(value)) return 'accent'
  return 'neutral'
}

export function severityTone(severity: string): Tone {
  if (severity === 'critical') return 'danger'
  if (severity === 'serious') return 'accent'
  if (severity === 'moderate') return 'warning'
  return 'info'
}

export function StatTile({ label, value, icon, tone = 'info' }: { label: string; value: number | string; icon: IconName; tone?: Tone }) {
  const theme = useTheme()
  const tones: Record<Tone, string> = {
    neutral: theme.textMuted,
    info: theme.primary,
    success: theme.success,
    warning: theme.warning,
    danger: theme.danger,
    accent: theme.accent,
  }
  return (
    <View
      style={{
        flexBasis: '48%',
        flexGrow: 1,
        backgroundColor: theme.surface,
        borderRadius: radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.border,
        padding: spacing.lg,
      }}
    >
      <Ionicons name={icon} size={20} color={tones[tone]} />
      <Text style={{ color: theme.text, fontSize: 26, fontWeight: '800', marginTop: spacing.sm }}>{value}</Text>
      <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>{label}</Text>
    </View>
  )
}

export function Rows({ children }: { children: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border }}>
      {children}
    </View>
  )
}

export function Row({
  title,
  subtitle,
  meta,
  icon,
  onPress,
  right,
}: {
  title: string
  subtitle?: string
  meta?: string
  icon?: IconName
  onPress?: () => void
  right?: ReactNode
}) {
  const theme = useTheme()
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg }}>
      {icon ? (
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: radius.md,
            backgroundColor: theme.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={19} color={theme.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: theme.textMuted, fontSize: 13, marginTop: 2 }} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {meta ? <Text style={{ color: theme.textMuted, fontSize: 11, marginTop: 3 }}>{meta}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={theme.textMuted} /> : null)}
    </View>
  )
  const separator = { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }
  if (!onPress) return <View style={separator}>{content}</View>
  return (
    <Pressable onPress={onPress} android_ripple={{ color: theme.primarySoft }} style={separator}>
      {content}
    </Pressable>
  )
}

export function KeyValue({ label, value }: { label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.lg, paddingVertical: 6 }}>
      <Text style={{ color: theme.textMuted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: theme.text, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  )
}

export function EmptyState({ icon = 'file-tray-outline', title, message }: { icon?: IconName; title: string; message?: string }) {
  const theme = useTheme()
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl }}>
      <Ionicons name={icon} size={34} color={theme.textMuted} />
      <Text style={{ color: theme.text, fontWeight: '700', fontSize: 16, marginTop: spacing.md }}>{title}</Text>
      {message ? (
        <Text style={{ color: theme.textMuted, fontSize: 13, textAlign: 'center', marginTop: 4, maxWidth: 280 }}>{message}</Text>
      ) : null}
    </View>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const theme = useTheme()
  return (
    <Card style={{ borderColor: theme.dangerSoft, backgroundColor: theme.dangerSoft }}>
      <Text style={{ color: theme.danger, fontWeight: '700' }}>Something went wrong</Text>
      <Text style={{ color: theme.danger, fontSize: 13, marginTop: 4 }}>{message}</Text>
      {onRetry ? (
        <View style={{ marginTop: spacing.md }}>
          <Button title="Try again" onPress={onRetry} variant="secondary" compact />
        </View>
      ) : null}
    </Card>
  )
}

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  const theme = useTheme()
  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm }}>
      <ActivityIndicator color={theme.primary} />
      <Text style={{ color: theme.textMuted, fontSize: 13 }}>{label}</Text>
    </View>
  )
}

export function OfflineBanner() {
  const theme = useTheme()
  const network = Network.useNetworkState()
  if (network.isConnected !== false && network.isInternetReachable !== false) return null
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: theme.warningSoft,
        borderRadius: radius.md,
        padding: spacing.md,
        marginBottom: spacing.md,
      }}
    >
      <Ionicons name="cloud-offline-outline" size={17} color={theme.warning} />
      <Text style={{ color: theme.warning, fontSize: 12, flex: 1 }}>
        You are offline. Incident drafts are saved on this device and will sync when the connection returns.
      </Text>
    </View>
  )
}

export function paletteColor(theme: Palette, risk: string): string {
  if (risk === 'red') return theme.danger
  if (risk === 'orange') return theme.accent
  if (risk === 'yellow') return theme.warning
  if (risk === 'green') return theme.success
  return theme.textMuted
}
