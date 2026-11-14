import { describe, expect, it } from 'vitest'
import {
  buildImportRows,
  detectDelimiter,
  guessMapping,
  matrixToTable,
  parseDelimited,
  parseText,
  splitFullName,
} from './import'

describe('import parsing', () => {
  it('detects the delimiter used by the file', () => {
    expect(detectDelimiter('First name;Last name\nJohn;Doe')).toBe(';')
    expect(detectDelimiter('First name\tLast name\nJohn\tDoe')).toBe('\t')
    expect(detectDelimiter('First name,Last name\nJohn,Doe')).toBe(',')
  })

  it('keeps quoted commas and newlines inside a cell', () => {
    const rows = parseDelimited('name,notes\n"Doe, John","Needs\nsupport"')
    expect(rows).toEqual([
      ['name', 'notes'],
      ['Doe, John', 'Needs\nsupport'],
    ])
  })

  it('parses a CSV with a header row', () => {
    const table = parseText('First name,Last name,Gender,Class\nJohn,Doe,Male,S1\nJane,Roe,F,S1', 'csv')
    expect(table.hasHeader).toBe(true)
    expect(table.headers).toEqual(['First name', 'Last name', 'Gender', 'Class'])
    expect(table.rows).toHaveLength(2)
  })

  it('treats a newline-separated pasted list as full names', () => {
    const table = parseText('John Doe\nJane Roe\nEric Niyonsaba')
    expect(table.headers).toEqual(['Full name'])
    expect(table.rows.map((row) => row[0])).toEqual(['John Doe', 'Jane Roe', 'Eric Niyonsaba'])
  })

  it('treats one comma-separated pasted line as a list of full names', () => {
    const table = parseText('John Doe, Jane Roe; Eric Niyonsaba')
    expect(table.headers).toEqual(['Full name'])
    expect(table.rows.map((row) => row[0])).toEqual(['John Doe', 'Jane Roe', 'Eric Niyonsaba'])
  })

  it('splits full names including last-name-first format', () => {
    expect(splitFullName('John Peter Doe')).toEqual({ firstName: 'John', otherNames: 'Peter', lastName: 'Doe' })
    expect(splitFullName('Doe, John')).toEqual({ firstName: 'John', otherNames: undefined, lastName: 'Doe' })
    expect(splitFullName('Madonna')).toEqual({ firstName: 'Madonna', lastName: '' })
  })

  it('guesses column mappings from common headings', () => {
    const mapping = guessMapping(['Student Name', 'Admission No.', 'Guardian Phone Number', 'Unknown column'])
    expect(mapping[0]).toBe('fullName')
    expect(mapping[1]).toBe('admissionNumber')
    expect(mapping[2]).toBe('guardianPhone')
    expect(mapping[3]).toBe('')
  })

  it('keeps generated positional headers usable', () => {
    const table = matrixToTable([['John', 'Doe'], ['Jane', 'Roe']], 'paste')
    expect(table.headers).toEqual(['First name', 'Last name'])
    expect(guessMapping(table.headers)).toEqual({ 0: 'firstName', 1: 'lastName' })
  })

  it('builds backend rows with placement, guardian and custom fields', () => {
    const table = parseText(
      'Full name,Class,Stream,Guardian,Guardian phone,House\nJohn Peter Doe,S1,North,Mary Doe,0788000000,Akagera',
    )
    const mapping = guessMapping(table.headers)
    mapping[5] = 'custom:House'
    const rows = buildImportRows(table, mapping, {
      classId: 'class-default',
      classes: [{ _id: 'class-s1', name: 'S1' }],
      streams: [{ _id: 'stream-north', name: 'North' }],
      dormitories: [],
    })
    expect(rows).toHaveLength(1)
    const data = rows[0].data
    expect(data.firstName).toBe('John')
    expect(data.otherNames).toBe('Peter')
    expect(data.lastName).toBe('Doe')
    expect(data.classId).toBe('class-s1')
    expect(data.streamId).toBe('stream-north')
    expect(data.guardians).toEqual([
      expect.objectContaining({ name: 'Mary Doe', phone: '0788000000', preferredChannel: 'whatsapp' }),
    ])
    expect(data.customFields).toEqual([{ label: 'House', value: 'Akagera' }])
  })

  it('falls back to the selected class when a row has none', () => {
    const table = parseText('Full name\nJohn Doe')
    const rows = buildImportRows(table, guessMapping(table.headers), {
      classId: 'class-default',
      classes: [{ _id: 'class-s1', name: 'S1' }],
      streams: [],
      dormitories: [],
    })
    expect(rows[0].data.classId).toBe('class-default')
  })
})
