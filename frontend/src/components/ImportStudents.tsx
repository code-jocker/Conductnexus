import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ClipboardPaste, FileSpreadsheet, FileUp, RefreshCw, Upload, X } from 'lucide-react'
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Textarea } from './ui'
import { apiError, post } from '../lib/api'
import { useStructure } from '../lib/hooks'
import { useToast } from './toast'
import {
  buildImportRows,
  FIELD_LABELS,
  guessMapping,
  parseSpreadsheetFile,
  parseText,
  TARGET_FIELDS,
  type ColumnMapping,
  type ParsedTable,
} from '../lib/import'

type ImportRowResult = {
  index: number
  ok: boolean
  studentId?: string
  fullName?: string
  errors?: string[]
  duplicate?: { field: string; value: string; studentId?: string; fullName?: string }
}

type ImportResponse = {
  dryRun: boolean
  total: number
  valid: number
  invalid: number
  imported: number
  failed: number
  results: ImportRowResult[]
}

const STEPS = ['Source', 'Map columns', 'Preview'] as const

function friendly(text: string): string {
  let output = text
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    output = output.split(key).join(label)
  }
  return output.replace(/^Invalid enum value.*$/i, 'Check the value and try again')
}

export function ImportStudents({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: structure } = useStructure()
  const { success, error: toastError } = useToast()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState(0)
  const [mode, setMode] = useState<'paste' | 'file'>('paste')
  const [pasted, setPasted] = useState('')
  const [fileName, setFileName] = useState('')
  const [table, setTable] = useState<ParsedTable | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [classId, setClassId] = useState('')
  const [streamId, setStreamId] = useState('')
  const [dormitoryId, setDormitoryId] = useState('')
  const [admissionType, setAdmissionType] = useState('new')
  const [boardingStatus, setBoardingStatus] = useState<'day' | 'boarding'>('day')
  const [preview, setPreview] = useState<ImportResponse | null>(null)
  const [committed, setCommitted] = useState<ImportResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  const selectedClass = structure?.classes.find((c) => c._id === classId)
  const streams = useMemo(
    () => (structure?.streams ?? []).filter((s) => !selectedClass || s.level === selectedClass.level),
    [structure, selectedClass],
  )

  function reset() {
    setStep(0)
    setMode('paste')
    setPasted('')
    setFileName('')
    setTable(null)
    setMapping({})
    setClassId('')
    setStreamId('')
    setDormitoryId('')
    setAdmissionType('new')
    setBoardingStatus('day')
    setPreview(null)
    setCommitted(null)
    setBusy(false)
    setParseError(null)
  }

  function close() {
    reset()
    onClose()
  }

  function acceptTable(next: ParsedTable, name = '') {
    if (!next.headers.length || !next.rows.length) {
      setParseError('No rows were detected. Paste at least one name or choose a file with a header row.')
      return
    }
    setParseError(null)
    setTable(next)
    setMapping(guessMapping(next.headers))
    setFileName(name)
    setStep(1)
    setPreview(null)
    setCommitted(null)
  }

  function parsePaste() {
    try {
      acceptTable(parseText(pasted, 'paste'))
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Could not parse the pasted text')
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setParseError(null)
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        acceptTable(await parseSpreadsheetFile(file), file.name)
      } else {
        acceptTable(parseText(await file.text(), 'csv'), file.name)
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Could not read the file')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const nameMapped = Object.values(mapping).some((value) => value === 'fullName' || value === 'firstName' || value === 'lastName')
  const canPreview = Boolean(table && classId && nameMapped)

  const builtRows = useMemo(() => {
    if (!table || !structure) return []
    return buildImportRows(table, mapping, {
      classId,
      streamId: streamId || undefined,
      dormitoryId: dormitoryId || undefined,
      admissionType,
      boardingStatus,
      classes: structure.classes,
      streams: structure.streams,
      dormitories: structure.dormitories,
    })
  }, [table, mapping, structure, classId, streamId, dormitoryId, admissionType, boardingStatus])

  async function runPreview() {
    if (!canPreview) return
    setBusy(true)
    setPreview(null)
    setCommitted(null)
    setStep(2)
    try {
      const result = await post<ImportResponse>('/students/import', {
        rows: builtRows.map((row) => row.data),
        dryRun: true,
      })
      setPreview(result)
    } catch (err) {
      toastError(apiError(err))
      setStep(1)
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!preview || preview.valid === 0) return
    setBusy(true)
    try {
      const result = await post<ImportResponse>('/students/import', {
        rows: builtRows.map((row) => row.data),
        dryRun: false,
      })
      setCommitted(result)
      queryClient.invalidateQueries({ queryKey: ['students'] })
      success(`${result.imported} student${result.imported === 1 ? '' : 's'} imported`)
    } catch (err) {
      toastError(apiError(err))
    } finally {
      setBusy(false)
    }
  }

  const result = committed ?? preview
  const sourceOffset = table?.hasHeader ? 2 : 1

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import students"
      subtitle="CSV, Excel (.xlsx) or pasted names. Map the columns, review every row, then commit."
      size="xl"
      footer={
        committed ? (
          <div className="flex w-full items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              {committed.imported} imported · {committed.failed} skipped
            </p>
            <Button onClick={close}>Done</Button>
          </div>
        ) : (
          <div className="flex w-full items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => (step === 0 ? close() : setStep((s) => s - 1))} disabled={busy}>
              {step === 0 ? 'Cancel' : <><ArrowLeft className="h-4 w-4" /> Back</>}
            </Button>
            {step === 0 && (
              <Button onClick={parsePaste} disabled={!pasted.trim() || busy}>
                Parse names <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {step === 1 && (
              <Button onClick={runPreview} disabled={!canPreview || busy} loading={busy}>
                Preview {builtRows.length} row{builtRows.length === 1 ? '' : 's'} <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {step === 2 && (
              <Button onClick={commit} disabled={!preview || preview.valid === 0 || busy} loading={busy}>
                <Upload className="h-4 w-4" /> Import {preview?.valid ?? 0} student{preview?.valid === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        )
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {STEPS.map((label, index) => (
          <span
            key={label}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
              index === step
                ? 'bg-navy-900 text-white dark:bg-brand-600'
                : index < step
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200'
                  : 'bg-slate-100 text-slate-400 dark:bg-white/5'
            }`}
          >
            <span className="grid h-5 w-5 place-items-center rounded-full border border-current text-[10px]">{index < step ? '✓' : index + 1}</span>
            {label}
          </span>
        ))}
      </div>

      {parseError && (
        <Alert tone="danger" title="Could not read the input">
          {parseError}
        </Alert>
      )}

      {step === 0 && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant={mode === 'paste' ? 'primary' : 'secondary'} size="sm" icon={ClipboardPaste} onClick={() => setMode('paste')}>
              Paste names
            </Button>
            <Button variant={mode === 'file' ? 'primary' : 'secondary'} size="sm" icon={FileSpreadsheet} onClick={() => setMode('file')}>
              Upload CSV / Excel
            </Button>
          </div>

          {mode === 'paste' ? (
            <Field
              label="Paste student names"
              hint="One name per line, or separate names with commas, semicolons or tabs. A header row is detected automatically."
            >
              <Textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={'John Peter Doe\nJane Roe\nEric Niyonsaba'}
                className="min-h-[180px] font-mono text-xs"
              />
            </Field>
          ) : (
            <div className="rounded-xl border border-dashed border-line p-6 text-center dark:border-[#2a3b55]">
              <FileUp className="mx-auto h-8 w-8 text-brand-500" />
              <p className="mt-2 text-sm font-medium">{fileName || 'Choose a spreadsheet or CSV file'}</p>
              <p className="text-xs text-slate-400">The first sheet is read. Maximum 500 rows per import.</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="mt-4 block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {busy && <p className="mt-2 text-xs text-slate-400">Reading the file…</p>}
            </div>
          )}

          <Alert tone="info" title="Duplicates are checked before anything is written">
            A student is flagged when their student ID, admission number, national ID or full name already exists in the selected class.
          </Alert>
        </div>
      )}

      {step === 1 && table && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge tone="brand">{table.rows.length} rows</Badge>
            <Badge tone="slate">{table.headers.length} columns</Badge>
            {table.hasHeader && <Badge tone="emerald">Header detected</Badge>}
            {fileName && <span className="text-slate-400">{fileName}</span>}
          </div>

          <Card className="p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Apply to every row</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Class" required hint="Used when the row has no class or the class is not recognised">
                <Select value={classId} onChange={(e) => { setClassId(e.target.value); setStreamId('') }}>
                  <option value="">Select a class…</option>
                  {structure?.classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Stream / section">
                <Select value={streamId} onChange={(e) => setStreamId(e.target.value)}>
                  <option value="">No stream</option>
                  {streams.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Dormitory">
                <Select value={dormitoryId} onChange={(e) => setDormitoryId(e.target.value)}>
                  <option value="">No dormitory</option>
                  {structure?.dormitories.map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
                </Select>
              </Field>
              <Field label="Admission type">
                <Select value={admissionType} onChange={(e) => setAdmissionType(e.target.value)}>
                  <option value="new">New admission</option>
                  <option value="transfer">Transfer</option>
                  <option value="reentry">Re-entry</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Boarding status">
                <Select value={boardingStatus} onChange={(e) => setBoardingStatus(e.target.value as 'day' | 'boarding')}>
                  <option value="day">Day</option>
                  <option value="boarding">Boarding</option>
                </Select>
              </Field>
            </div>
            {!nameMapped && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-risk-orange">
                <AlertTriangle className="h-3.5 w-3.5" /> Map at least one name column (full name, first name or last name).
              </p>
            )}
          </Card>

          <div className="overflow-x-auto rounded-xl border border-line dark:border-[#26374f]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f] dark:bg-white/5">
                  <th className="px-4 py-2.5 font-semibold">Detected column</th>
                  <th className="px-4 py-2.5 font-semibold">First values</th>
                  <th className="px-4 py-2.5 font-semibold">Map to field</th>
                </tr>
              </thead>
              <tbody>
                {table.headers.map((header, index) => (
                  <tr key={index} className="border-b border-line/60 last:border-0 dark:border-[#1f2f49]">
                    <td className="px-4 py-2.5 font-medium">{header}</td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-xs text-slate-500">
                      {table.rows.slice(0, 3).map((row) => row[index]).filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Select
                        value={mapping[index] ?? ''}
                        onChange={(e) => setMapping((current) => ({ ...current, [index]: e.target.value }))}
                      >
                        <option value="">Ignore this column</option>
                        {TARGET_FIELDS.map((field) => (
                          <option key={field.key} value={field.key}>{field.group} · {field.label}</option>
                        ))}
                        {header && <option value={`custom:${header}`}>Keep as custom field “{header}”</option>}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {busy && !result && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 w-full" />)}</div>}

          {result && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Rows checked</p>
                  <p className="mt-1 text-2xl font-semibold">{result.total}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{committed ? 'Imported' : 'Ready to import'}</p>
                  <p className="mt-1 text-2xl font-semibold text-risk-green">{committed ? result.imported : result.valid}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Skipped</p>
                  <p className="mt-1 text-2xl font-semibold text-risk-orange">{committed ? result.failed : result.invalid}</p>
                </Card>
              </div>

              {!committed && result.invalid > 0 && (
                <Alert tone="warning" title="Some rows need attention">
                  Fix the rows marked below, or import only the valid rows. Invalid rows are never written.
                </Alert>
              )}
              {committed && (
                <Alert tone={result.failed ? 'info' : 'success'} title="Import complete">
                  {result.imported} student{result.imported === 1 ? '' : 's'} registered with a conduct allocation for the active term.
                  {result.failed ? ` ${result.failed} row${result.failed === 1 ? '' : 's'} were skipped.` : ''}
                </Alert>
              )}

              <div className="max-h-[360px] overflow-x-auto overflow-y-auto rounded-xl border border-line dark:border-[#26374f]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 dark:bg-[#101a2c]">
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-slate-400 dark:border-[#26374f]">
                      <th className="px-4 py-2 font-semibold">Row</th>
                      <th className="px-4 py-2 font-semibold">Student</th>
                      <th className="px-4 py-2 font-semibold">Result</th>
                      <th className="px-4 py-2 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {builtRows.map((row, index) => {
                      const item = result.results.find((entry) => entry.index === index)
                      const ok = committed ? Boolean(item?.studentId) : Boolean(item?.ok)
                      return (
                        <tr key={index} className="border-b border-line/60 last:border-0 dark:border-[#1f2f49]">
                          <td className="px-4 py-2 text-xs text-slate-400">{row.sourceIndex + sourceOffset}</td>
                          <td className="px-4 py-2">
                            <p className="font-medium">{row.fullName || '—'}</p>
                          </td>
                          <td className="px-4 py-2">
                            {ok ? (
                              <Badge tone="emerald"><Check className="mr-1 h-3 w-3" /> {committed ? 'Imported' : 'Ready'}</Badge>
                            ) : (
                              <Badge tone="red"><X className="mr-1 h-3 w-3" /> Skipped</Badge>
                            )}
                          </td>
                          <td className="px-4 py-2 text-xs text-slate-500">
                            {item?.duplicate
                              ? `Duplicate ${FIELD_LABELS[item.duplicate.field] ?? item.duplicate.field}: ${item.duplicate.value}${item.duplicate.fullName ? ` · ${item.duplicate.fullName}` : ''}`
                              : item?.errors?.length
                                ? item.errors.map(friendly).join(' · ')
                                : ok
                                  ? 'Validated'
                                  : 'Not validated'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {!committed && (
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" icon={RefreshCw} onClick={runPreview} disabled={busy}>
                    Re-check rows
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
