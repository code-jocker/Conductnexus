import { useState } from 'react'
import { Search, UserRound, X } from 'lucide-react'
import { Input } from './ui'
import { useStudentSearch } from '../lib/hooks'
import type { Student } from '../lib/types'

export type PickedStudent = { id: string; name: string; ref: string; balance?: number }

export function StudentPicker({
  value,
  onChange,
  placeholder = 'Search student by name or ID…',
}: {
  value: PickedStudent | null
  onChange: (student: PickedStudent | null) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const { data, isFetching } = useStudentSearch(query, query.trim().length >= 2 && !value)

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/30">
        <span className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-brand-600" />
          <span>
            <span className="font-medium">{value.name}</span>
            <span className="ml-2 text-xs text-slate-500">{value.ref}</span>
          </span>
        </span>
        <button type="button" onClick={() => onChange(null)} className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" aria-label="Clear student">
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} />
      {query.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-white shadow-lift dark:border-[#26374f] dark:bg-[#101a2c]">
          {isFetching ? (
            <p className="px-4 py-3 text-sm text-slate-400">Searching…</p>
          ) : data?.length ? (
            data.map((s: Student) => {
              const id = s.id ?? s._id ?? ''
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onChange({ id, name: s.fullName, ref: s.studentId, balance: s.currentBalance })
                    setQuery('')
                  }}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-white/5"
                >
                  <span>
                    {s.fullName}
                    <span className="ml-2 text-xs text-slate-400">{s.studentId}</span>
                  </span>
                  <span className="text-xs text-slate-400">{typeof s.classId === 'object' ? s.classId?.name : ''}</span>
                </button>
              )
            })
          ) : (
            <p className="px-4 py-3 text-sm text-slate-400">No matching students</p>
          )}
        </div>
      )}
    </div>
  )
}
