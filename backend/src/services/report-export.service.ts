import PDFDocument from 'pdfkit'
import { getSettings } from '../models/core.js'

/**
 * PDF rendering for reports.
 *
 * Everything rendered here comes from the report service, which scopes its
 * queries to the caller — this module only lays out what it is given, so a PDF
 * can never contain a figure the API would not have returned as JSON.
 */

export type PdfSection = {
  heading: string
  /** Key/value pairs. */
  fields?: [string, string][]
  /** Tabular rows, rendered under the same heading. */
  columns?: string[]
  rows?: Record<string, unknown>[]
}

const PAGE = { size: 'A4' as const, margin: 48 }
const MAX_TABLE_ROWS = 200

const cell = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.replace(/\s+/g, ' ').slice(0, 60)
}

function drawTable(
  doc: PDFKit.PDFDocument,
  columns: string[],
  rows: Record<string, unknown>[],
  startX: number,
  startY: number,
  width: number,
): number {
  const columnWidth = width / columns.length
  let y = startY

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155')
  columns.forEach((column, index) => {
    doc.text(column, startX + index * columnWidth, y, { width: columnWidth - 4, ellipsis: true, lineBreak: false })
  })
  y += 14
  doc.moveTo(startX, y - 3).lineTo(startX + width, y - 3).strokeColor('#e2e8f0').stroke()

  doc.font('Helvetica').fontSize(8).fillColor('#172033')
  for (const row of rows.slice(0, MAX_TABLE_ROWS)) {
    if (y > doc.page.height - PAGE.margin - 24) {
      doc.addPage()
      y = PAGE.margin
    }
    let lineHeight = 10
    columns.forEach((column, index) => {
      const text = cell(row[column])
      const height = doc.heightOfString(text, { width: columnWidth - 4 })
      lineHeight = Math.max(lineHeight, height)
    })
    columns.forEach((column, index) => {
      doc.text(cell(row[column]), startX + index * columnWidth, y, {
        width: columnWidth - 4,
        height: lineHeight,
        ellipsis: true,
      })
    })
    y += lineHeight + 3
    doc.moveTo(startX, y - 2).lineTo(startX + width, y - 2).strokeColor('#f1f5f9').stroke()
  }

  return y + 6
}

export async function buildReportPdf(title: string, sections: PdfSection[]): Promise<Buffer> {
  const settings = await getSettings()
  const doc = new PDFDocument({ ...PAGE, bufferPages: true })
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))

  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  const width = doc.page.width - PAGE.margin * 2
  const startX = PAGE.margin

  doc.font('Helvetica-Bold').fontSize(16).fillColor('#0b1b33').text(title, startX, PAGE.margin)
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#64748b')
    .text(`${settings.school.name || 'ConductNexus School'} · generated ${new Date().toLocaleString('en-RW', { timeZone: 'Africa/Kigali' })}`)
  doc.moveTo(startX, doc.y + 6).lineTo(startX + width, doc.y + 6).strokeColor('#0b1b33').stroke()
  doc.moveDown(1)

  for (const section of sections) {
    if (doc.y > doc.page.height - PAGE.margin - 60) {
      doc.addPage()
    }
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0b1b33').text(section.heading)
    doc.moveDown(0.4)

    if (section.fields?.length) {
      doc.font('Helvetica').fontSize(9).fillColor('#172033')
      for (const [label, value] of section.fields) {
        const y = doc.y
        doc.fillColor('#64748b').text(label, startX, y, { width: 180, continued: false })
        doc.fillColor('#172033').text(value, startX + 190, y, { width: width - 190 })
      }
      doc.moveDown(0.8)
    }

    if (section.columns?.length && section.rows?.length) {
      doc.y = drawTable(doc, section.columns, section.rows, startX, doc.y, width)
      doc.moveDown(0.6)
    } else if (!section.fields?.length) {
      doc.font('Helvetica').fontSize(9).fillColor('#64748b').text('No records for this period.')
      doc.moveDown(0.8)
    }
  }

  doc.end()
  return done
}