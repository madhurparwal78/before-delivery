import type { Category, ImportOutcome, RowRejection } from './api-types'
import { categoryFromText } from './categories'
import { itemIdentity } from './names'
import { decimalText } from './numbers'
import { MAX_WEIGHT_GRAMS, gramsFromDecimal, type WeightUnit } from './weights'

export const MAX_CSV_ROWS = 2000
const REQUIRED_COLUMNS = ['Item Name', 'Category', 'weight', 'unit'] as const

export const FILE_MESSAGES = {
  missingFile: 'Choose a CSV file.',
  unreadable: "This file isn't readable as CSV.",
  tooManyRows: `A file can have at most ${MAX_CSV_ROWS} rows.`,
  duplicateColumn: (column: string) => `Duplicate column: ${column}`,
  missingColumn: (column: string) => `Missing column: ${column}`,
} as const

/** The records of a UTF-8 CSV (optional byte-order mark), or null when it is not valid UTF-8 or a quote is never closed. */
export function readRecords(bytes: Uint8Array): string[][] | null {
  const hasMark = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(hasMark ? bytes.subarray(3) : bytes)
  } catch {
    return null
  }
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let started = false
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') field += ch
      else if (text[i + 1] === '"') (field += '"', i++)
      else quoted = false
    } else if (ch === '"' && field === '') {
      quoted = true
      started = true
    } else if (ch === ',') {
      record.push(field)
      field = ''
      started = true
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      if (started) records.push([...record, field])
      record = []
      field = ''
      started = false
    } else {
      field += ch
      started = true
    }
  }
  if (quoted) return null
  if (started) records.push([...record, field])
  return records.map((cells) => cells.map((cell) => cell.trim()))
}

type HeaderCheck = { ok: true; columns: ReadonlyMap<string, number> } | { ok: false; message: string }

/** Duplicate column, then missing column. */
export function checkHeader(header: readonly string[]): HeaderCheck {
  const columns = new Map<string, number>()
  const written = new Map<string, string>()
  for (const [index, name] of header.entries()) {
    const key = name.toLowerCase()
    const first = written.get(key)
    if (first !== undefined) return { ok: false, message: FILE_MESSAGES.duplicateColumn(first) }
    written.set(key, name)
    columns.set(key, index)
  }
  const missing = REQUIRED_COLUMNS.find((column) => !columns.has(column.toLowerCase()))
  return missing ? { ok: false, message: FILE_MESSAGES.missingColumn(missing) } : { ok: true, columns }
}

export const REJECTION_WORDS: Record<RowRejection, string> = {
  missing_name: 'Name is blank',
  unknown_category: 'Unknown category',
  invalid_weight: 'Invalid weight',
  unknown_unit: 'Unknown unit',
  invalid_qty: 'Invalid quantity',
}

const UNITS: Record<string, WeightUnit> = {
  g: 'g', gram: 'g', grams: 'g', oz: 'oz', ounce: 'oz', ounces: 'oz', kg: 'kg', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
}

export interface NewGear {
  name: string
  category: Category
  weightGrams: number
  unitsOwned: number
  notes: string
  priceCents: number | null
}

export interface CheckedRow {
  row: number
  name: string
  categoryText: string
  reason: RowRejection | null
  gear: NewGear | null
}

function priceCents(text: string): number | null {
  const match = /^\$?(\d+)(?:\.(\d{2}))?$/.exec(text)
  if (!match) return null
  const cents = Number.parseInt(`${match[1]}${match[2] ?? '00'}`, 10)
  return Number.isSafeInteger(cents) ? cents : null
}

function rejection(row: number, name: string, categoryText: string, reason: RowRejection): CheckedRow {
  return { row, name, categoryText, reason, gear: null }
}

/** The first failing row check, in the published order, or the gear the row would create. */
export function checkRow(row: number, cells: readonly string[], columns: ReadonlyMap<string, number>): CheckedRow {
  const value = (column: string): string => cells[columns.get(column.toLowerCase()) ?? -1] ?? ''
  const name = value('Item Name')
  const categoryText = value('Category')
  const category = categoryFromText(categoryText)
  const weightText = value('weight')
  const unit = UNITS[value('unit').toLowerCase()]
  const qtyText = value('qty')
  if (name === '') return rejection(row, name, categoryText, 'missing_name')
  if (category === null) return rejection(row, name, categoryText, 'unknown_category')
  const weightGrams = decimalText(weightText) !== null && unit !== undefined ? gramsFromDecimal(weightText, unit) : null
  if (decimalText(weightText) === null || (weightGrams !== null && weightGrams > MAX_WEIGHT_GRAMS)) {
    return rejection(row, name, categoryText, 'invalid_weight')
  }
  if (unit === undefined || weightGrams === null) return rejection(row, name, categoryText, 'unknown_unit')
  const quantity = /^\d+$/.test(qtyText) ? Number.parseInt(qtyText, 10) : null
  if (qtyText !== '' && (quantity === null || quantity < 1 || quantity > 99)) return rejection(row, name, categoryText, 'invalid_qty')
  return {
    row,
    name,
    categoryText,
    reason: null,
    gear: { name, category, weightGrams, unitsOwned: quantity ?? 1, notes: value('desc'), priceCents: priceCents(value('price')) },
  }
}

export interface MatchedRow {
  row: number
  name: string
  categoryText: string
  outcome: ImportOutcome
  itemId: string | null
  sameAsRow: number | null
  reason: RowRejection | null
  gear: NewGear | null
}

/**
 * Matches accepted rows by name and category against the closet and against earlier rows of the same file.
 * `existing` maps an item identity to the id of the closet item (retired ones included).
 */
export function matchRows(rows: readonly CheckedRow[], existing: ReadonlyMap<string, string>): MatchedRow[] {
  const firstRowOf = new Map<string, number>()
  return rows.map((checked) => {
    const base = { ...checked, itemId: null, sameAsRow: null }
    if (checked.gear === null) return { ...base, outcome: 'rejected' as const }
    const identity = itemIdentity(checked.gear.name, checked.gear.category)
    const earlier = firstRowOf.get(identity) ?? null
    const itemId = existing.get(identity) ?? null
    if (earlier === null) firstRowOf.set(identity, checked.row)
    return { ...base, outcome: itemId !== null || earlier !== null ? ('matched' as const) : ('created' as const), itemId, sameAsRow: earlier }
  })
}
