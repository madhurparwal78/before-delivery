import { mergeImportedBlocks, printModel, type ImportedBlock, type PrintableLink, type PrintableModel } from '../shared/canonical.ts'
import type { ImportItemStatus, ImportReportItem, Limits } from '../shared/domain.ts'
import { parseMortise, type Column, type Model } from '../shared/mortise.ts'
import type { DdlError, ImportedColumn, ImportedDdl, ImportedIndex, ImportedTable, Place } from './ddl.ts'

export type ImportMode = 'merge' | 'replace'

interface ImportPlan {
  text: string
  report: ImportReportItem[]
  notes: string[]
  counts: { added: number; merged: number; skipped: number; ambiguous: number }
}

type Planned = { ok: true; plan: ImportPlan } | { ok: false; errors: DdlError[] }

const asError = (place: Place, message: string): DdlError => ({ line: place.line, column: place.column, message })

function toColumn(source: ImportedColumn, table: ImportedTable): Column {
  const key = table.keyColumns.some((candidate) => candidate.name === source.name)
  return {
    name: source.name,
    type: source.type,
    key: source.key || key,
    auto: source.auto,
    required: source.required,
    unique: source.unique || table.uniqueColumns.some((candidate) => candidate.name === source.name),
    default: source.default,
  }
}

function defaultIndexName(table: string, columns: string[]): string {
  return `${table}_${columns.join('_')}_idx`
}

function placeOfLine(model: Model, line: number, ddl: ImportedDdl): Place {
  const entity = model.entities.find((candidate) => line >= candidate.line && line <= candidate.endLine)
  const table = ddl.tables.find((candidate) => candidate.name === entity?.name)
  if (table) return table.place
  const choice = model.choices.find((candidate) => line >= candidate.line && line <= candidate.endLine)
  const type = ddl.types.find((candidate) => candidate.name === choice?.name)
  if (type) return type.place
  const link = model.links.find((candidate) => candidate.line === line)
  const foreignKey = ddl.foreignKeys.find((candidate) => candidate.table === link?.from.entity && candidate.column === link?.from.column)
  if (foreignKey) return foreignKey.place
  return ddl.tables[0]?.place ?? ddl.types[0]?.place ?? { line: 1, column: 1 }
}

/** Turns a parsed DDL dump into the new text, the per-statement report and the notes, or the line-and-column errors. */
export function planImport(ddl: ImportedDdl, mode: ImportMode, currentText: string, limits: Limits): Planned {
  const errors: DdlError[] = []
  const existing = mode === 'merge' ? parseMortise(currentText, limits).model : null

  const status = new Map<string, ImportItemStatus>()
  const seen = new Set<string>()
  for (const table of ddl.tables) {
    if (seen.has(table.name)) errors.push(asError(table.namePlace, `Duplicate table in import: ${table.name}`))
    seen.add(table.name)
    const exact = existing?.entities.some((entity) => entity.name === table.name)
    const folded = existing?.entities.some((entity) => entity.name.toLowerCase() === table.name.toLowerCase())
    status.set(table.name, !existing ? 'added' : exact ? 'merged' : folded ? 'ambiguous' : 'added')
  }
  const importedTables = ddl.tables.filter((table) => status.get(table.name) !== 'ambiguous')
  const tableNames = new Set(importedTables.map((table) => table.name))
  const hasColumn = (table: string, column: string): boolean =>
    ddl.tables.find((candidate) => candidate.name === table)?.columns.some((candidate) => candidate.name === column) ?? false

  for (const table of ddl.tables) {
    for (const reference of [...table.keyColumns, ...table.uniqueColumns, ...table.indexes.flatMap((index) => index.columns)]) {
      if (!hasColumn(table.name, reference.name)) errors.push(asError(reference.place, `Unknown column ${table.name}.${reference.name}`))
    }
  }
  for (const statement of ddl.indexStatements) {
    if (!tableNames.has(statement.table)) errors.push(asError(statement.tablePlace, `Unknown table in index: ${statement.table}`))
    else {
      for (const reference of statement.index.columns) {
        if (!hasColumn(statement.table, reference.name)) errors.push(asError(reference.place, `Unknown column ${statement.table}.${reference.name}`))
      }
    }
  }
  for (const key of ddl.foreignKeys) {
    const ambiguous = [key.table, key.refTable].find((name) => status.get(name) === 'ambiguous')
    if (ambiguous !== undefined) errors.push(asError(key.place, `Foreign key points to ambiguous table ${ambiguous}`))
    else if (!tableNames.has(key.table)) errors.push(asError(key.place, `Unknown table in foreign key: ${key.table}`))
    else if (!tableNames.has(key.refTable)) errors.push(asError(key.refTablePlace, `Unknown table in foreign key: ${key.refTable}`))
    else {
      if (!hasColumn(key.table, key.column)) errors.push(asError(key.columnPlace, `Unknown column ${key.table}.${key.column}`))
      if (!hasColumn(key.refTable, key.refColumn)) errors.push(asError(key.refColumnPlace, `Unknown column ${key.refTable}.${key.refColumn}`))
    }
  }
  if (errors.length) return { ok: false, errors }

  const indexesOf = new Map<string, ImportedIndex[]>(importedTables.map((table) => [table.name, [...table.indexes]]))
  for (const statement of ddl.indexStatements) indexesOf.get(statement.table)?.push(statement.index)
  const model: PrintableModel = { choices: [], entities: [], links: [], groups: [] }
  for (const type of ddl.types) model.choices.push({ name: type.name, values: type.values })
  for (const table of importedTables) {
    for (const column of table.columns) if (column.enumValues) model.choices.push({ name: column.type.name, values: column.enumValues })
  }
  for (const table of importedTables) {
    const columns = table.columns.map((column) => toColumn(column, table))
    const indexes = (indexesOf.get(table.name) ?? []).map((index) => {
      const names = index.columns.map((column) => column.name)
      return { columns: names, unique: index.unique, name: index.name === null || index.name === defaultIndexName(table.name, names) ? null : index.name }
    })
    model.entities.push({ name: table.name, columns, indexes })
  }
  for (const key of ddl.foreignKeys) {
    const entity = model.entities.find((candidate) => candidate.name === key.table)
    const column = entity?.columns.find((candidate) => candidate.name === key.column)
    const sole = (entity?.columns.filter((candidate) => candidate.key).length ?? 0) === 1 && column?.key === true
    const soleUnique = entity?.indexes.some((index) => index.unique && index.columns.length === 1 && index.columns[0] === key.column) ?? false
    const token = column?.unique || sole || soleUnique ? '--' : '>-'
    const link: PrintableLink = {
      from: { entity: key.table, column: key.column },
      to: { entity: key.refTable, column: key.refColumn },
      token,
      deleteAction: key.action,
      inline: false,
    }
    model.links.push(link)
  }

  const order: ImportedBlock[] = []
  const statements = [
    ...ddl.types.map((type) => ({ at: type.reportAt, block: { kind: 'choice', name: type.name } as ImportedBlock })),
    ...importedTables.map((table) => ({ at: table.reportAt, block: { kind: 'entity', name: table.name } as ImportedBlock })),
  ].sort((a, b) => a.at - b.at)
  for (const statement of statements) order.push(statement.block)
  for (const table of importedTables) {
    for (const column of table.columns) if (column.enumValues) order.push({ kind: 'choice', name: column.type.name })
  }

  const text = existing ? mergeImportedBlocks(currentText, existing, model, order) : printModel(model)
  const check = parseMortise(text, limits)
  if (check.errors.length) {
    return {
      ok: false,
      errors: check.errors.map((error) => ({ ...placeOfLine(check.model, error.line - 1, ddl), message: error.message })),
    }
  }

  const report = ddl.report.map((item): ImportReportItem => ({ ...item }))
  for (const table of ddl.tables) (report[table.reportAt] as ImportReportItem).status = status.get(table.name) as ImportItemStatus
  for (const type of ddl.types) {
    const merged = existing?.choices.some((choice) => choice.name === type.name)
    ;(report[type.reportAt] as ImportReportItem).status = merged ? 'merged' : 'added'
  }
  for (const statement of ddl.indexStatements) (report[statement.reportAt] as ImportReportItem).status = status.get(statement.table) as ImportItemStatus
  for (const key of ddl.foreignKeys) {
    if (report[key.reportAt]?.kind === 'foreign key') (report[key.reportAt] as ImportReportItem).status = status.get(key.table) as ImportItemStatus
  }
  const count = (kind: ImportReportItem['kind'], wanted: ImportItemStatus): number =>
    report.filter((item) => item.kind === kind && item.status === wanted).length
  return {
    ok: true,
    plan: {
      text,
      report,
      notes: ddl.notes,
      counts: { added: count('table', 'added'), merged: count('table', 'merged'), skipped: count('statement', 'skipped'), ambiguous: count('table', 'ambiguous') },
    },
  }
}
