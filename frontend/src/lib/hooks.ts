import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get, getPage } from './api'
import type { Offence, Student, StructureOptions } from './types'

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(handle)
  }, [value, delay])
  return debounced
}

export function useStructure() {
  return useQuery({
    queryKey: ['structure-options'],
    queryFn: () => get<StructureOptions>('/structure/options'),
    staleTime: 5 * 60_000,
  })
}

export function useOffences(activeOnly = true) {
  return useQuery({
    queryKey: ['offences', activeOnly],
    queryFn: () => get<Offence[]>('/offences', activeOnly ? {} : { active: 'all' }),
    staleTime: 5 * 60_000,
  })
}

export type StaffMember = {
  id: string
  _id?: string
  name: string
  email: string
  position?: string
  status: string
  roles?: { id: string; key: string; name: string }[]
}

export function useStaff(enabled = true) {
  return useQuery({
    queryKey: ['staff-options'],
    queryFn: async () => {
      const { items } = await getPage<StaffMember>('/users', { pageSize: 100, status: 'active' })
      return items.map((u) => ({ ...u, id: u.id ?? String(u._id) }))
    },
    enabled,
    staleTime: 5 * 60_000,
  })
}

export function useStudentSearch(term: string, enabled = true) {
  const debounced = useDebounced(term, 250)
  return useQuery({
    queryKey: ['student-search', debounced],
    queryFn: async () => {
      const { items } = await getPage<Student>('/students', { pageSize: 20, q: debounced })
      return items
    },
    enabled,
    staleTime: 20_000,
  })
}

export function useTermLabel(termId?: string) {
  const { data } = useStructure()
  const term = data?.terms.find((t) => t._id === termId)
  return term?.name ?? 'Current term'
}

export function refName(value: { name?: string } | string | undefined | null, fallback = 'Unassigned'): string {
  if (!value) return fallback
  return typeof value === 'string' ? value : value.name ?? fallback
}

export function refId(value: { _id?: string } | string | undefined | null): string {
  if (!value) return ''
  return typeof value === 'string' ? value : value._id ?? ''
}
