import { useColorScheme } from 'react-native'

export type Palette = {
  mode: 'light' | 'dark'
  navy: string
  primary: string
  primarySoft: string
  accent: string
  accentSoft: string
  background: string
  surface: string
  surfaceMuted: string
  border: string
  text: string
  textMuted: string
  danger: string
  dangerSoft: string
  success: string
  successSoft: string
  warning: string
  warningSoft: string
  onPrimary: string
  overlay: string
}

const light: Palette = {
  mode: 'light',
  navy: '#0b1b33',
  primary: '#2563eb',
  primarySoft: '#e8effd',
  accent: '#d97c3b',
  accentSoft: '#fdf0e6',
  background: '#f5f7fb',
  surface: '#ffffff',
  surfaceMuted: '#eef2f9',
  border: '#dbe3ef',
  text: '#0f172a',
  textMuted: '#5b6b83',
  danger: '#c0392b',
  dangerSoft: '#fdeceb',
  success: '#1d7a4a',
  successSoft: '#e8f7ef',
  warning: '#9a6200',
  warningSoft: '#fdf3df',
  onPrimary: '#ffffff',
  overlay: 'rgba(11, 27, 51, 0.55)',
}

const dark: Palette = {
  mode: 'dark',
  navy: '#071122',
  primary: '#6d9bff',
  primarySoft: '#14284a',
  accent: '#e89a60',
  accentSoft: '#3a2618',
  background: '#060d19',
  surface: '#0d182b',
  surfaceMuted: '#13203a',
  border: '#1f2f4d',
  text: '#e8eefb',
  textMuted: '#9aabc5',
  danger: '#ff8b80',
  dangerSoft: '#3a1a1a',
  success: '#63d69b',
  successSoft: '#12301f',
  warning: '#f3c56b',
  warningSoft: '#332710',
  onPrimary: '#06101f',
  overlay: 'rgba(0, 0, 0, 0.65)',
}

export function useTheme(): Palette {
  const scheme = useColorScheme()
  return scheme === 'dark' ? dark : light
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const
