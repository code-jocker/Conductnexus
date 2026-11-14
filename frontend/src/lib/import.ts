export type ImportSource = 'paste' | 'csv' | 'xlsx'

export type ParsedTable = {
  headers: string[]
  rows: string[][]
  delimiter: string
  hasHeader: boolean
  source: ImportSource
}

export type TargetField = {
  key: string
  label: string
  group: string
  aliases: string[]
}

export type ColumnMapping = Record<number, string>

export type StructureOption = { _id: string; name: string; code?: string }

export type ImportContext = {
  classId: string
  streamId?: string
  dormitoryId?: string
  classTeacherId?: string
  admissionType?: string
  boardingStatus?: 'day' | 'boarding'
  classes: StructureOption[]
  streams: StructureOption[]
  dormitories: StructureOption[]
}

export type BuiltImportRow = {
  sourceIndex: number
  fullName: string
  data: Record<string, unknown>
}

const DELIMITERS = [',', ';', '\t', '|'] as const

export const TARGET_FIELDS: TargetField[] = [
  { key: 'fullName', label: 'Full name', group: 'Identity', aliases: ['full name', 'name', 'student name', 'names', 'student', 'learner', 'learner name'] },
  { key: 'firstName', label: 'First name', group: 'Identity', aliases: ['first name', 'firstname', 'given name', 'forename'] },
  { key: 'otherNames', label: 'Other names', group: 'Identity', aliases: ['other names', 'middle name', 'middlename', 'middle names'] },
  { key: 'lastName', label: 'Last name', group: 'Identity', aliases: ['last name', 'lastname', 'surname', 'family name'] },
  { key: 'gender', label: 'Gender', group: 'Identity', aliases: ['gender', 'sex'] },
  { key: 'dateOfBirth', label: 'Date of birth', group: 'Identity', aliases: ['date of birth', 'dob', 'birth date', 'birthdate'] },
  { key: 'nationalId', label: 'National ID', group: 'Identity', aliases: ['national id', 'national id number', 'nid', 'id number'] },
  { key: 'nationality', label: 'Nationality', group: 'Identity', aliases: ['nationality'] },
  { key: 'religion', label: 'Religion', group: 'Identity', aliases: ['religion'] },
  { key: 'bloodGroup', label: 'Blood group', group: 'Identity', aliases: ['blood group', 'blood type'] },
  { key: 'studentId', label: 'Student ID', group: 'Admission', aliases: ['student id', 'student number', 'student no', 'student code'] },
  { key: 'admissionNumber', label: 'Admission number', group: 'Admission', aliases: ['admission number', 'admission no', 'admission', 'admission no.'] },
  { key: 'admissionDate', label: 'Admission date', group: 'Admission', aliases: ['admission date', 'enrollment date', 'enrolment date', 'enrolled on', 'date admitted'] },
  { key: 'admissionType', label: 'Admission type', group: 'Admission', aliases: ['admission type', 'entry type'] },
  { key: 'previousSchool', label: 'Previous school', group: 'Admission', aliases: ['previous school', 'former school'] },
  { key: 'previousClass', label: 'Previous class', group: 'Admission', aliases: ['previous class', 'former class'] },
  { key: 'class', label: 'Class', group: 'Placement', aliases: ['class', 'grade', 'level', 'form'] },
  { key: 'stream', label: 'Stream / section', group: 'Placement', aliases: ['stream', 'section', 'option', 'combination'] },
  { key: 'dormitory', label: 'Dormitory', group: 'Placement', aliases: ['dormitory', 'dorm', 'house'] },
  { key: 'boardingStatus', label: 'Boarding status', group: 'Placement', aliases: ['boarding status', 'boarding', 'resident status', 'residence'] },
  { key: 'roomNumber', label: 'Room number', group: 'Placement', aliases: ['room number', 'room', 'room no'] },
  { key: 'contactPhone', label: 'Student phone', group: 'Contact', aliases: ['student phone', 'phone', 'mobile', 'telephone', 'contact phone'] },
  { key: 'contactEmail', label: 'Student email', group: 'Contact', aliases: ['student email', 'email', 'e-mail', 'contact email'] },
  { key: 'contactAddress', label: 'Address', group: 'Contact', aliases: ['address', 'residence address', 'home address'] },
  { key: 'guardianName', label: 'Guardian name', group: 'Guardians', aliases: ['guardian name', 'parent name', 'guardian', 'parent', 'father name', 'mother name'] },
  { key: 'guardianRelationship', label: 'Guardian relationship', group: 'Guardians', aliases: ['guardian relationship', 'relationship', 'parent relationship'] },
  { key: 'guardianPhone', label: 'Guardian phone', group: 'Guardians', aliases: ['guardian phone', 'parent phone', 'guardian phone number', 'parent phone number', 'emergency phone'] },
  { key: 'guardianEmail', label: 'Guardian email', group: 'Guardians', aliases: ['guardian email', 'parent email'] },
  { key: 'guardianOccupation', label: 'Guardian occupation', group: 'Guardians', aliases: ['guardian occupation', 'parent occupation', 'occupation'] },
  { key: 'guardianAddress', label: 'Guardian address', group: 'Guardians', aliases: ['guardian address', 'parent address'] },
  { key: 'notes', label: 'Notes', group: 'Other', aliases: ['notes', 'remarks', 'comments', 'comment'] },
]

const ALIAS_TO_KEY = new Map<string, string>()
for (const field of TARGET_FIELDS) {
  for (const alias of [field.label, ...field.aliases]) {
    ALIAS_TO_KEY.set(normalizeHeader(alias), field.key)
  }
}

export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function countDelimiter(line: string, delimiter: string): number {
  let count = 0
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') i++
      else quoted = !quoted
    } else if (!quoted && char === delimiter) count++
  }
  return count
}

export function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 5)
  let best = ','
  let bestScore = -1
  for (const delimiter of DELIMITERS) {
    const score = firstLines.reduce((total, line) => total + countDelimiter(line, delimiter), 0)
    if (score > bestScore) {
      best = delimiter
      bestScore = score
    }
  }
  return best
}

export function parseDelimited(text: string, delimiter?: string): string[][] {
  const separator = delimiter ?? detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const pushCell = () => {
    row.push(cell.trim())
    cell = ''
  }
  const pushRow = () => {
    pushCell()
    if (row.some((value) => value !== '')) rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"' && cell.trim() === '') {
      quoted = true
    } else if (char === separator) {
      pushCell()
    } else if (char === '\n') {
      pushRow()
    } else if (char !== '\r') {
      cell += char
    }
  }
  if (cell !== '' || row.length) pushRow()
  return rows
}

function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((header, index) => {
    const base = header.trim() || `Column ${index + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} (${count + 1})`
  })
}

function looksLikeHeader(row: string[]): boolean {
  const cells = row.filter((cell) => cell.trim())
  if (!cells.length) return false
  const known = cells.filter((cell) => ALIAS_TO_KEY.has(normalizeHeader(cell))).length
  if (known !== cells.length) return false
  return known >= 2 || (known === 1 && row.length === 1)
}

export function matrixToTable(matrix: unknown[][], source: ImportSource): ParsedTable {
  const normalized = matrix
    .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()) : []))
    .filter((row) => row.some((cell) => cell !== ''))
  if (!normalized.length) return { headers: [], rows: [], delimiter: source === 'xlsx' ? '' : ',', hasHeader: false, source }

  const width = Math.max(...normalized.map((row) => row.length))
  const padded = normalized.map((row) => [...row, ...Array<string>(width - row.length).fill('')])
  const hasHeader = looksLikeHeader(padded[0])

  if (!hasHeader && padded.length === 1 && padded[0].filter(Boolean).length > 1) {
    const names = padded[0]
      .flatMap((cell) => cell.split(/[,;\t|]/))
      .map((cell) => cell.trim())
      .filter(Boolean)
    return {
      headers: ['Full name'],
      rows: names.map((name) => [name]),
      delimiter: source === 'xlsx' ? '' : ',',
      hasHeader: false,
      source,
    }
  }

  if (hasHeader) {
    return {
      headers: uniqueHeaders(padded[0]),
      rows: padded.slice(1),
      delimiter: '',
      hasHeader: true,
      source,
    }
  }

  const headers =
    width === 1
      ? ['Full name']
      : width === 2
        ? ['First name', 'Last name']
        : width === 3
          ? ['First name', 'Other names', 'Last name']
          : Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
  return { headers, rows: padded, delimiter: '', hasHeader: false, source }
}

export function parseText(text: string, source: ImportSource = 'paste'): ParsedTable {
  const delimiter = detectDelimiter(text)
  const table = matrixToTable(parseDelimited(text, delimiter), source)
  return { ...table, delimiter }
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedTable> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0] ?? '']
  if (!firstSheet) throw new Error('The workbook has no readable sheet')
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, raw: false, defval: '' })
  return matrixToTable(matrix, 'xlsx')
}

export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header)
    const exact = ALIAS_TO_KEY.get(normalized)
    if (exact) {
      mapping[index] = exact
      return
    }
    let bestKey = ''
    let bestLength = 0
    for (const [alias, key] of ALIAS_TO_KEY) {
      if (alias.length > bestLength && (normalized.includes(alias) || alias.includes(normalized))) {
        bestKey = key
        bestLength = alias.length
      }
    }
    mapping[index] = bestKey
  })
  return mapping
}

export function splitFullName(raw: string): { firstName: string; otherNames?: string; lastName: string } {
  const value = raw.replace(/\s+/g, ' ').trim()
  if (!value) return { firstName: '', lastName: '' }
  if (value.includes(',')) {
    const [last, ...rest] = value.split(',')
    const names = rest.join(' ').trim().split(' ').filter(Boolean)
    return {
      firstName: names[0] ?? '',
      otherNames: names.slice(1).join(' ') || undefined,
      lastName: last.trim(),
    }
  }
  const parts = value.split(' ').filter(Boolean)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return {
    firstName: parts[0],
    otherNames: parts.length > 2 ? parts.slice(1, -1).join(' ') : undefined,
    lastName: parts[parts.length - 1],
  }
}

export function parseGender(value: string): 'male' | 'female' | '' {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return ''
  if (['m', 'male', 'gabo', 'boy', 'umuhungu'].includes(normalized)) return 'male'
  if (['f', 'female', 'gore', 'girl', 'umukobwa'].includes(normalized)) return 'female'
  return ''
}

export function parseBoarding(value: string): 'day' | 'boarding' | '' {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return ''
  if (['boarding', 'boarder', 'resident', 'b', 'internat'].includes(normalized)) return 'boarding'
  if (['day', 'day student', 'non-resident', 'd'].includes(normalized)) return 'day'
  return ''
}

export function parseAdmissionType(value: string): 'new' | 'transfer' | 'reentry' | 'other' | '' {
  const normalized = value.trim().toLowerCase()
  if (['new', 'new admission', 'fresh', 'first'].includes(normalized)) return 'new'
  if (['transfer', 'transferred', 'transfer in'].includes(normalized)) return 'transfer'
  if (['reentry', 're-entry', 'returning', 'return'].includes(normalized)) return 'reentry'
  if (['other', 'special'].includes(normalized)) return 'other'
  return ''
}

export function parseImportDate(value: string): string {
  const raw = value.trim()
  if (!raw) return ''
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const local = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/)
  if (local) return `${local[3]}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}`
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function matchOption(value: string, options: StructureOption[]): string {
  const raw = value.trim()
  if (!raw) return ''
  if (/^[a-f0-9]{24}$/i.test(raw)) return raw
  const normalized = normalizeHeader(raw)
  const match = options.find(
    (option) => normalizeHeader(option.name) === normalized || (option.code && normalizeHeader(option.code) === normalized),
  )
  return match?._id ?? ''
}

function readMapped(row: string[], mapping: ColumnMapping, key: string): string {
  for (const [indexRaw, mapped] of Object.entries(mapping)) {
    if (mapped !== key) continue
    const value = row[Number(indexRaw)]?.trim()
    if (value) return value
  }
  return ''
}

function readCustomFields(row: string[], mapping: ColumnMapping): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = []
  for (const [indexRaw, mapped] of Object.entries(mapping)) {
    if (!mapped.startsWith('custom:')) continue
    const value = row[Number(indexRaw)]?.trim()
    if (!value) continue
    fields.push({ label: mapped.slice('custom:'.length), value })
  }
  return fields
}

export function buildImportRows(table: ParsedTable, mapping: ColumnMapping, context: ImportContext): BuiltImportRow[] {
  return table.rows
    .map((row, sourceIndex) => {
      const fullNameCell = readMapped(row, mapping, 'fullName')
      const split = fullNameCell ? splitFullName(fullNameCell) : null
      const firstName = readMapped(row, mapping, 'firstName') || split?.firstName || ''
      const lastName = readMapped(row, mapping, 'lastName') || split?.lastName || ''
      const otherNames = readMapped(row, mapping, 'otherNames') || split?.otherNames

      const classId = matchOption(readMapped(row, mapping, 'class'), context.classes) || context.classId
      const streamId = matchOption(readMapped(row, mapping, 'stream'), context.streams) || context.streamId
      const dormitoryId = matchOption(readMapped(row, mapping, 'dormitory'), context.dormitories) || context.dormitoryId

      const guardianPhone = readMapped(row, mapping, 'guardianPhone')
      const guardianName = readMapped(row, mapping, 'guardianName')
      const guardianEmail = readMapped(row, mapping, 'guardianEmail')
      const guardianAddress = readMapped(row, mapping, 'guardianAddress')
      const guardianOccupation = readMapped(row, mapping, 'guardianOccupation')
      const guardianRelationship = readMapped(row, mapping, 'guardianRelationship')

      const contactPhone = readMapped(row, mapping, 'contactPhone')
      const contactEmail = readMapped(row, mapping, 'contactEmail')
      const contactAddress = readMapped(row, mapping, 'contactAddress')

      const data: Record<string, unknown> = {
        firstName,
        lastName,
        otherNames: otherNames || undefined,
        gender: parseGender(readMapped(row, mapping, 'gender')),
        dateOfBirth: parseImportDate(readMapped(row, mapping, 'dateOfBirth')) || undefined,
        nationality: readMapped(row, mapping, 'nationality') || undefined,
        nationalId: readMapped(row, mapping, 'nationalId') || undefined,
        religion: readMapped(row, mapping, 'religion') || undefined,
        bloodGroup: readMapped(row, mapping, 'bloodGroup') || undefined,
        studentId: readMapped(row, mapping, 'studentId') || undefined,
        admissionNumber: readMapped(row, mapping, 'admissionNumber') || undefined,
        admissionDate: parseImportDate(readMapped(row, mapping, 'admissionDate')) || undefined,
        admissionType: parseAdmissionType(readMapped(row, mapping, 'admissionType')) || context.admissionType || 'new',
        previousSchool: readMapped(row, mapping, 'previousSchool') || undefined,
        previousClass: readMapped(row, mapping, 'previousClass') || undefined,
        classId,
        streamId: streamId || undefined,
        dormitoryId: dormitoryId || undefined,
        classTeacherId: context.classTeacherId || undefined,
        boardingStatus:
          parseBoarding(readMapped(row, mapping, 'boardingStatus')) ||
          context.boardingStatus ||
          (dormitoryId ? 'boarding' : 'day'),
        roomNumber: readMapped(row, mapping, 'roomNumber') || undefined,
        notes: readMapped(row, mapping, 'notes') || undefined,
        contact:
          contactPhone || contactEmail || contactAddress
            ? { phone: contactPhone || undefined, email: contactEmail || undefined, address: contactAddress || undefined }
            : undefined,
        customFields: readCustomFields(row, mapping),
      }

      if (guardianPhone) {
        data.guardians = [
          {
            name: guardianName || 'Guardian',
            relationship: guardianRelationship || 'Guardian',
            phone: guardianPhone,
            email: guardianEmail || undefined,
            address: guardianAddress || undefined,
            occupation: guardianOccupation || undefined,
            preferredChannel: 'whatsapp',
            whatsappConsent: true,
            isPrimary: true,
          },
        ]
      }

      return {
        sourceIndex,
        fullName: [firstName, otherNames, lastName].filter(Boolean).join(' ') || fullNameCell,
        data,
      }
    })
}

export const FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(TARGET_FIELDS.map((field) => [field.key, field.label])),
  classId: 'Class',
  'guardians.0.name': 'Guardian name',
  'guardians.0.phone': 'Guardian phone',
  'contact.email': 'Student email',
}
