export function formatDate(value?: string | Date | null): string {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function timeAgo(value?: string | Date | null): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (Number.isNaN(seconds)) return ''
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`
  return formatDate(date)
}

export function personName(value: unknown, fallback = '—'): string {
  if (!value) return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return fallback
}

export function className(student: { classId?: { name?: string } | string }): string {
  if (!student.classId) return ''
  return typeof student.classId === 'string' ? '' : (student.classId.name ?? '')
}

export function initials(name?: string): string {
  if (!name) return 'CN'
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function todayIso(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset()
  const local = new Date(now.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 16)
}
