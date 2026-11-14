import type { DeleteAction, Dialect, ImportReportItem, Limits } from '../shared/domain.ts'
import type { Literal } from '../shared/mortise.ts'

export interface DdlError {
  line: number
  column: number
  message: string
}

export interface Place {
  line: number
  column: number
}

export interface ImportedColumn {
  name: string
  type: { name: string; params: number[] }
  /** Set for an inline MySQL ENUM: the choice this column creates. */
  enumValues: string[] | null
  key: boolean
  auto: boolean
  required: boolean
  unique: boolean
  default: Literal | null
}

export interface ImportedIndex {
  columns: Array<{ name: string; place: Place }>
  unique: boolean
  name: string | null
}

interface ImportedForeignKey {
  table: string
  column: string
  columnPlace: Place
  refTable: string
  refTablePlace: Place
  refColumn: string
  refColumnPlace: Place
  action: DeleteAction | null
  place: Place
  reportAt: number
}

export interface ImportedTable {
  name: string
  namePlace: Place
  place: Place
  columns: ImportedColumn[]
  indexes: ImportedIndex[]
  keyColumns: Array<{ name: string; place: Place }>
  uniqueColumns: Array<{ name: string; place: Place }>
  foreignKeys: ImportedForeignKey[]
  reportAt: number
}

interface ImportedType {
  name: string
  values: string[]
  place: Place
  reportAt: number
}

interface ImportedIndexStatement {
  table: string
  tablePlace: Place
  index: ImportedIndex
  reportAt: number
}

export interface ImportedDdl {
  tables: ImportedTable[]
  types: ImportedType[]
  indexStatements: ImportedIndexStatement[]
  foreignKeys: ImportedForeignKey[]
  report: ImportReportItem[]
  notes: string[]
}

type ParsedDdl = { ok: true; value: ImportedDdl } | { ok: false; errors: DdlError[] }

interface Token {
  kind: 'word' | 'quoted' | 'string' | 'number' | 'punct'
  text: string
  /** Identifier or string content: unquoted words are folded for PostgreSQL. */
  value: string
  start: number
  line: number
  column: number
  endLine: number
  endColumn: number
}

class Failure extends Error {
  constructor(
    readonly line: number,
    readonly column: number,
    message: string,
  ) {
    super(message)
  }
}

const here = (token: Token): Place => ({ line: token.line, column: token.column })
const WORD_START = /[A-Za-z0-9_$]/

/** Finds the first byte that is not valid UTF-8 and where it sits, or null when the bytes are valid. */
function firstInvalidUtf8(bytes: Buffer): Place | null {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return null
  } catch {
    let at = 0
    while (at < bytes.length) {
      const lead = bytes[at] as number
      const length = lead < 0x80 ? 1 : lead >= 0xc2 && lead < 0xe0 ? 2 : lead >= 0xe0 && lead < 0xf0 ? 3 : lead >= 0xf0 && lead < 0xf5 ? 4 : 0
      const chunk = bytes.subarray(at, at + length)
      let valid = length > 0 && chunk.length === length
      if (valid) {
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(chunk)
        } catch {
          valid = false
        }
      }
      if (!valid) break
      at += length
    }
    const prefix = bytes.subarray(0, at).toString('utf8')
    const lines = prefix.split('\n')
    return { line: lines.length, column: Array.from(lines[lines.length - 1] as string).length + 1 }
  }
}

function tokenize(text: string, dialect: Dialect, limits: Limits): Token[] | DdlError {
  const tokens: Token[] = []
  let i = 0
  let line = 1
  let column = 1
  let depth = 0
  const advance = (count: number): void => {
    for (let n = 0; n < count; n++) {
      const code = text.charCodeAt(i)
      if (code === 10) {
        line++
        column = 1
      } else if (code < 0xdc00 || code > 0xdfff) column++
      i++
    }
  }
  while (i < text.length) {
    const ch = text.charAt(i)
    if (/\s/.test(ch)) {
      advance(1)
      continue
    }
    if (ch === '-' && text.charAt(i + 1) === '-') {
      while (i < text.length && text.charAt(i) !== '\n') advance(1)
      continue
    }
    if (ch === '/' && text.charAt(i + 1) === '*') {
      const close = text.indexOf('*/', i + 2)
      advance((close === -1 ? text.length : close + 2) - i)
      continue
    }
    const start = i
    const startLine = line
    const startColumn = column
    const make = (kind: Token['kind'], value: string): void => {
      tokens.push({ kind, text: text.slice(start, i), value, start, line: startLine, column: startColumn, endLine: line, endColumn: column })
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let value = ''
      advance(1)
      for (;;) {
        if (i >= text.length) return { line: startLine, column: startColumn, message: 'Unexpected end of text' }
        const inner = text.charAt(i)
        if (inner === ch && text.charAt(i + 1) === ch) {
          value += ch
          advance(2)
        } else if (inner === ch) {
          advance(1)
          break
        } else if (inner === '\\' && ch === "'" && dialect === 'mysql') {
          value += text.charAt(i + 1)
          advance(2)
        } else {
          value += inner
          advance(1)
        }
      }
      make(ch === "'" ? 'string' : 'quoted', value)
    } else if (ch === '-' && /[0-9]/.test(text.charAt(i + 1))) {
      advance(1)
      while (/[0-9.]/.test(text.charAt(i))) advance(1)
      make('number', text.slice(start, i))
    } else if (WORD_START.test(ch)) {
      while (WORD_START.test(text.charAt(i))) advance(1)
      if (/^[0-9]/.test(text.slice(start, i)) && text.charAt(i) === '.' && /[0-9]/.test(text.charAt(i + 1))) {
        advance(1)
        while (/[0-9]/.test(text.charAt(i))) advance(1)
      }
      const word = text.slice(start, i)
      make(/^[0-9]/.test(word) ? 'number' : 'word', dialect === 'postgresql' ? word.toLowerCase() : word)
    } else {
      advance(ch.length)
      if (ch === '(') {
        depth++
        if (depth > limits.nestingLimit) return { line: startLine, column: startColumn, message: `Nesting is deeper than ${limits.nestingLimit} levels` }
      } else if (ch === ')') depth = Math.max(0, depth - 1)
      make('punct', ch)
    }
  }
  return tokens
}

/** The first two tokens of a statement, upper-cased and joined by one space. */
function statementWords(text: string, start: number): string {
  const words: string[] = []
  let i = start
  while (words.length < 2 && i < text.length) {
    while (i < text.length && /\s/.test(text.charAt(i))) i++
    const from = i
    while (i < text.length && !/[\s;(),=]/.test(text.charAt(i))) i++
    if (i === from) break
    words.push(text.slice(from, i).toUpperCase())
  }
  return words.join(' ')
}

const SKIPPED = ['SET', 'BEGIN', 'COMMIT', 'START TRANSACTION', 'DROP TABLE', 'CREATE EXTENSION', 'CREATE SCHEMA', 'USE', 'LOCK TABLES', 'UNLOCK TABLES']

class Statement {
  private at = 0
  constructor(
    readonly tokens: Token[],
    private readonly end: Place,
  ) {}

  peek(offset = 0): Token | undefined {
    return this.tokens[this.at + offset]
  }

  done(): boolean {
    return this.at >= this.tokens.length
  }

  next(): Token {
    const token = this.tokens[this.at]
    if (!token) throw new Failure(this.end.line, this.end.column, 'Unexpected end of text')
    this.at++
    return token
  }

  upper(offset = 0): string {
    const token = this.tokens[this.at + offset]
    return token && token.kind === 'word' ? token.text.toUpperCase() : ''
  }

  isPunct(text: string, offset = 0): boolean {
    const token = this.tokens[this.at + offset]
    return token?.kind === 'punct' && token.text === text
  }

  fail(token: Token): never {
    throw new Failure(token.line, token.column, `Unexpected token ${token.text}`)
  }

  unsupportedClause(token: Token, clause: string): never {
    throw new Failure(token.line, token.column, `Unsupported clause: ${clause}`)
  }

  expectPunct(text: string): Token {
    const token = this.next()
    if (token.kind !== 'punct' || token.text !== text) this.fail(token)
    return token
  }

  expectWord(word: string): Token {
    const token = this.next()
    if (token.kind !== 'word' || token.text.toUpperCase() !== word) this.fail(token)
    return token
  }

  acceptWord(word: string): boolean {
    if (this.upper() !== word) return false
    this.at++
    return true
  }

  name(): Token {
    const token = this.next()
    if (token.kind !== 'word' && token.kind !== 'quoted') this.fail(token)
    return token
  }

  endReached(): void {
    const token = this.peek()
    if (token) this.fail(token)
  }
}

const TYPE_MAP: Record<string, { name: string; auto?: boolean }> = {
  integer: { name: 'int' },
  int: { name: 'int' },
  int4: { name: 'int' },
  serial: { name: 'int', auto: true },
  smallint: { name: 'smallint' },
  int2: { name: 'smallint' },
  smallserial: { name: 'smallint', auto: true },
  bigint: { name: 'bigint' },
  int8: { name: 'bigint' },
  bigserial: { name: 'bigint', auto: true },
  real: { name: 'float' },
  float4: { name: 'float' },
  float: { name: 'float' },
  float8: { name: 'double' },
  double: { name: 'double' },
  boolean: { name: 'bool' },
  bool: { name: 'bool' },
  text: { name: 'text' },
  date: { name: 'date' },
  time: { name: 'time' },
  uuid: { name: 'uuid' },
  json: { name: 'json' },
  jsonb: { name: 'json' },
  bytea: { name: 'bytes' },
  blob: { name: 'bytes' },
  longblob: { name: 'bytes' },
  datetime: { name: 'timestamp' },
  timestamptz: { name: 'timestamptz' },
}
const INTEGER_WIDTH = new Set(['integer', 'int', 'int4', 'smallint', 'int2', 'bigint', 'int8'])

const ACTIONS: Record<string, DeleteAction> = { CASCADE: 'cascade', RESTRICT: 'restrict' }

class Importer {
  readonly result: ImportedDdl = { tables: [], types: [], indexStatements: [], foreignKeys: [], report: [], notes: [] }
  readonly errors: DdlError[] = []
  private readonly enumTypes = new Set<string>()

  constructor(
    private readonly dialect: Dialect,
    private readonly enumNames: Set<string>,
  ) {}

  private note(line: number, text: string): void {
    this.result.notes.push(`Line ${line}: ${text}`)
  }

  private fold(token: Token): string {
    return token.kind === 'quoted' ? token.value : this.dialect === 'postgresql' ? token.text.toLowerCase() : token.text
  }

  statement(text: string, tokens: Token[], terminated: boolean): void {
    const first = tokens[0] as Token
    const last = tokens[tokens.length - 1] as Token
    const end: Place = { line: last.endLine, column: last.endColumn }
    const words = statementWords(text, first.start)
    const upper = words.split(' ')
    const leading = (...parts: string[]): boolean => parts.every((part, i) => upper[i] === part)
    try {
      const cursor = new Statement(tokens, end)
      if (SKIPPED.some((entry) => leading(...entry.split(' ')))) {
        this.result.report.push({ line: first.line, kind: 'statement', name: words, status: 'skipped' })
      } else if (leading('CREATE', 'TYPE')) this.createType(cursor, first)
      else if (leading('CREATE', 'TABLE')) this.createTable(cursor, first)
      else if (leading('ALTER', 'TABLE')) this.alterTable(cursor, first)
      else if (leading('CREATE', 'INDEX') || leading('CREATE', 'UNIQUE')) this.createIndex(cursor, first)
      else throw new Failure(first.line, first.column, `Unsupported statement: ${words}`)
      if (!terminated) throw new Failure(end.line, end.column, 'Missing semicolon at end of statement')
    } catch (error) {
      if (!(error instanceof Failure)) throw error
      this.errors.push({ line: error.line, column: error.column, message: error.message })
    }
  }

  private createType(cursor: Statement, first: Token): void {
    cursor.next()
    cursor.next()
    const name = cursor.name()
    cursor.expectWord('AS')
    cursor.expectWord('ENUM')
    cursor.expectPunct('(')
    const values: string[] = []
    for (;;) {
      const value = cursor.next()
      if (value.kind !== 'string') cursor.fail(value)
      values.push(value.value)
      const after = cursor.next()
      if (after.kind === 'punct' && after.text === ')') break
      if (after.kind !== 'punct' || after.text !== ',') cursor.fail(after)
    }
    cursor.endReached()
    const folded = this.fold(name)
    this.enumTypes.add(folded)
    this.result.types.push({ name: folded, values, place: here(first), reportAt: this.result.report.length })
    this.result.report.push({ line: first.line, kind: 'type', name: folded, status: 'added' })
  }

  private refTarget(cursor: Statement): { table: Token; column: Token; action: DeleteAction | null } {
    const table = cursor.name()
    cursor.expectPunct('(')
    const column = cursor.name()
    if (cursor.isPunct(',')) cursor.unsupportedClause(cursor.peek() as Token, 'composite FOREIGN KEY')
    cursor.expectPunct(')')
    let action: DeleteAction | null = null
    while (cursor.upper() === 'ON') {
      const on = cursor.next()
      const kind = cursor.next()
      if (kind.text.toUpperCase() !== 'DELETE') cursor.unsupportedClause(on, 'ON UPDATE')
      const word = cursor.next()
      const upper = word.text.toUpperCase()
      if (upper === 'SET' || upper === 'NO') {
        const second = cursor.next()
        const pair = `${upper} ${second.text.toUpperCase()}`
        if (pair === 'SET NULL') action = 'set null'
        else if (pair === 'NO ACTION') action = 'no action'
        else cursor.unsupportedClause(on, `ON DELETE ${pair}`)
      } else if (ACTIONS[upper]) action = ACTIONS[upper] as DeleteAction
      else cursor.unsupportedClause(on, `ON DELETE ${upper}`)
    }
    return { table, column, action }
  }

  private createTable(cursor: Statement, first: Token): void {
    cursor.next()
    cursor.next()
    if (cursor.upper() === 'IF') {
      cursor.next()
      cursor.expectWord('NOT')
      cursor.expectWord('EXISTS')
    }
    const nameToken = cursor.name()
    const name = this.fold(nameToken)
    cursor.expectPunct('(')
    const table: ImportedTable = {
      name,
      namePlace: here(nameToken),
      place: here(first),
      columns: [],
      indexes: [],
      keyColumns: [],
      uniqueColumns: [],
      foreignKeys: [],
      reportAt: this.result.report.length,
    }
    for (;;) {
      this.tableItem(cursor, table)
      const after = cursor.next()
      if (after.kind === 'punct' && after.text === ')') break
      if (after.kind !== 'punct' || after.text !== ',') cursor.fail(after)
    }
    while (!cursor.done()) this.tableOption(cursor)
    this.result.tables.push(table)
    this.result.foreignKeys.push(...table.foreignKeys)
    this.result.report.push({ line: first.line, kind: 'table', name, status: 'added' })
  }

  private tableOption(cursor: Statement): void {
    const first = cursor.next()
    let option = first.text.toUpperCase()
    if (option === 'DEFAULT') option = `DEFAULT ${cursor.next().text.toUpperCase()}`
    const bare = option.replace('DEFAULT ', '')
    if (!['ENGINE', 'CHARSET', 'COLLATE', 'AUTO_INCREMENT'].includes(bare)) cursor.unsupportedClause(first, bare)
    if (cursor.isPunct('=')) cursor.next()
    cursor.next()
    this.note(first.line, `table option ${option} ignored`)
  }

  private columnList(cursor: Statement): Array<{ name: string; place: Place }> {
    cursor.expectPunct('(')
    const columns: Array<{ name: string; place: Place }> = []
    for (;;) {
      const column = cursor.name()
      columns.push({ name: this.fold(column), place: here(column) })
      const after = cursor.next()
      if (after.kind === 'punct' && after.text === ')') return columns
      if (after.kind !== 'punct' || after.text !== ',') cursor.fail(after)
    }
  }

  private tableItem(cursor: Statement, table: ImportedTable): void {
    const head = cursor.upper()
    if (head === 'CONSTRAINT' || ['PRIMARY', 'UNIQUE', 'FOREIGN', 'INDEX', 'KEY', 'CHECK'].includes(head)) {
      this.tableConstraint(cursor, table)
      return
    }
    this.columnDefinition(cursor, table)
  }

  private tableConstraint(cursor: Statement, table: ImportedTable): void {
    const start = cursor.peek() as Token
    if (cursor.acceptWord('CONSTRAINT')) {
      const named = cursor.name()
      this.note(named.line, `constraint name ${named.value} not kept`)
    }
    const kind = cursor.upper()
    const word = cursor.next()
    if (kind === 'PRIMARY') {
      cursor.expectWord('KEY')
      table.keyColumns.push(...this.columnList(cursor))
    } else if (kind === 'UNIQUE') {
      if (cursor.upper() === 'KEY' || cursor.upper() === 'INDEX') cursor.next()
      if (!cursor.isPunct('(')) {
        const named = cursor.name()
        this.note(named.line, `constraint name ${named.value} not kept`)
      }
      const columns = this.columnList(cursor)
      if (columns.length === 1) table.uniqueColumns.push(columns[0] as { name: string; place: Place })
      else table.indexes.push({ columns, unique: true, name: null })
    } else if (kind === 'FOREIGN') {
      cursor.expectWord('KEY')
      const columns = this.columnList(cursor)
      if (columns.length > 1) cursor.unsupportedClause(word, 'composite FOREIGN KEY')
      cursor.expectWord('REFERENCES')
      const target = this.refTarget(cursor)
      const column = columns[0] as { name: string; place: Place }
      table.foreignKeys.push(this.foreignKey(table.name, column, target, start, this.result.report.length))
    } else if (kind === 'INDEX' || kind === 'KEY') {
      const name = cursor.isPunct('(') ? null : cursor.name()
      table.indexes.push({ columns: this.columnList(cursor), unique: false, name: name ? this.fold(name) : null })
    } else {
      cursor.unsupportedClause(word, kind || word.text.toUpperCase())
    }
  }

  private foreignKey(
    table: string,
    column: { name: string; place: Place },
    target: { table: Token; column: Token; action: DeleteAction | null },
    at: Token,
    reportAt: number,
  ): ImportedForeignKey {
    return {
      table,
      column: column.name,
      columnPlace: column.place,
      refTable: this.fold(target.table),
      refTablePlace: here(target.table),
      refColumn: this.fold(target.column),
      refColumnPlace: here(target.column),
      action: target.action,
      place: here(at),
      reportAt,
    }
  }

  private columnType(cursor: Statement, column: ImportedColumn, table: string): void {
    const head = cursor.next()
    if (head.kind !== 'word' && head.kind !== 'quoted') cursor.fail(head)
    let words = head.kind === 'quoted' ? head.value : head.text.toLowerCase()
    const written = head.text
    if (head.kind === 'word') {
      if (words === 'double' && cursor.upper() === 'PRECISION') {
        cursor.next()
      } else if (words === 'character' && cursor.upper() === 'VARYING') {
        cursor.next()
        words = 'varchar'
      } else if (words === 'timestamp' || words === 'time') {
        if (cursor.upper() === 'WITH' || cursor.upper() === 'WITHOUT') {
          const zone = cursor.next().text.toUpperCase()
          cursor.expectWord('TIME')
          cursor.expectWord('ZONE')
          words = words === 'timestamp' && zone === 'WITH' ? 'timestamptz' : words
        }
      }
    }
    const params: number[] = []
    let widthAt: Token | null = null
    if (cursor.isPunct('(')) {
      widthAt = cursor.next()
      if (words === 'enum') {
        column.enumValues = []
        for (;;) {
          const value = cursor.next()
          if (value.kind !== 'string') cursor.fail(value)
          column.enumValues.push(value.value)
          const after = cursor.next()
          if (after.kind === 'punct' && after.text === ')') break
          if (after.kind !== 'punct' || after.text !== ',') cursor.fail(after)
        }
      } else {
        for (;;) {
          const number = cursor.next()
          if (number.kind !== 'number') cursor.fail(number)
          params.push(Number(number.text))
          const after = cursor.next()
          if (after.kind === 'punct' && after.text === ')') break
          if (after.kind !== 'punct' || after.text !== ',') cursor.fail(after)
        }
      }
    }
    const unsupported = (): never => {
      throw new Failure(head.line, head.column, `Unsupported type: ${written}`)
    }
    if (words === 'enum' && column.enumValues) {
      column.type = { name: `${table}_${column.name}`, params: [] }
      return
    }
    if (head.kind === 'word' && this.dialect === 'mysql' && words.toLowerCase() === 'tinyint') {
      if (params.length === 1 && params[0] === 1) {
        column.type = { name: 'bool', params: [] }
        return
      }
      unsupported()
    }
    const folded = words.toLowerCase()
    if (folded === 'numeric' || folded === 'decimal') {
      if (params.length !== 2) unsupported()
      column.type = { name: 'decimal', params }
    } else if (folded === 'varchar' || folded === 'char' || folded === 'character') {
      if (params.length !== 1) unsupported()
      column.type = { name: folded === 'varchar' ? 'varchar' : 'char', params }
    } else if (folded === 'timestamp') {
      column.type = { name: this.dialect === 'postgresql' ? 'timestamp' : 'timestamptz', params: [] }
    } else if (folded === 'datetime' && params.length) {
      unsupported()
    } else if (folded === 'double' || (folded === 'float' && this.dialect === 'mysql')) {
      column.type = { name: folded === 'double' ? 'double' : 'float', params: [] }
    } else if (this.enumNames.has(words) || this.enumTypes.has(words)) {
      column.type = { name: words, params: [] }
    } else {
      const mapped = TYPE_MAP[folded]
      if (!mapped || (params.length && !INTEGER_WIDTH.has(folded))) unsupported()
      column.type = { name: (mapped as { name: string }).name, params: [] }
      if (mapped?.auto) column.auto = true
      if (params.length && widthAt) this.note(widthAt.line, `display width on ${column.name} ignored`)
    }
  }

  private columnDefinition(cursor: Statement, table: ImportedTable): void {
    const nameToken = cursor.name()
    const column: ImportedColumn = {
      name: this.fold(nameToken),
      type: { name: '', params: [] },
      enumValues: null,
      key: false,
      auto: false,
      required: false,
      unique: false,
      default: null,
    }
    this.columnType(cursor, column, table.name)
    table.columns.push(column)
    while (!cursor.done() && !cursor.isPunct(',') && !cursor.isPunct(')')) {
      const token = cursor.next()
      const word = token.kind === 'word' ? token.text.toUpperCase() : ''
      if (word === 'CONSTRAINT') {
        const named = cursor.name()
        this.note(named.line, `constraint name ${named.value} not kept`)
      } else if (word === 'NOT') {
        cursor.expectWord('NULL')
        column.required = true
      } else if (word === 'NULL') {
        column.required = false
      } else if (word === 'PRIMARY') {
        cursor.expectWord('KEY')
        table.keyColumns.push({ name: column.name, place: here(nameToken) })
      } else if (word === 'UNIQUE') {
        if (cursor.upper() === 'KEY') cursor.next()
        column.unique = true
      } else if (word === 'AUTO_INCREMENT') {
        column.auto = true
      } else if (word === 'GENERATED') {
        const mode = cursor.next().text.toUpperCase()
        if (mode === 'BY') cursor.expectWord('DEFAULT')
        else if (mode !== 'ALWAYS') cursor.fail(token)
        cursor.expectWord('AS')
        cursor.expectWord('IDENTITY')
        column.auto = true
        if (mode === 'ALWAYS') this.note(token.line, 'GENERATED ALWAYS imported as auto')
      } else if (word === 'DEFAULT') {
        column.default = this.defaultValue(cursor)
      } else if (word === 'REFERENCES') {
        const target = this.refTarget(cursor)
        table.foreignKeys.push(this.foreignKey(table.name, { name: column.name, place: here(nameToken) }, target, token, this.result.report.length))
      } else if (word) {
        cursor.unsupportedClause(token, word === 'ON' ? 'ON UPDATE' : word)
      } else {
        cursor.fail(token)
      }
    }
  }

  private defaultValue(cursor: Statement): Literal {
    const token = cursor.next()
    if (token.kind === 'string') return { kind: 'string', text: token.value }
    if (token.kind === 'number') return { kind: 'number', text: token.text }
    const word = token.kind === 'word' ? token.text.toUpperCase() : ''
    if (word === 'TRUE') return { kind: 'boolean', text: 'true' }
    if (word === 'FALSE') return { kind: 'boolean', text: 'false' }
    if (word === 'NULL') return { kind: 'null', text: 'null' }
    if (word === 'CURRENT_TIMESTAMP' || (word === 'NOW' && cursor.isPunct('('))) {
      if (cursor.isPunct('(')) {
        cursor.next()
        cursor.expectPunct(')')
      }
      return { kind: 'now', text: 'now' }
    }
    if (word && cursor.isPunct('(')) cursor.unsupportedClause(token, `DEFAULT ${token.text}`)
    return cursor.fail(token)
  }

  private alterTable(cursor: Statement, first: Token): void {
    cursor.next()
    cursor.next()
    const table = cursor.name()
    const add = cursor.expectWord('ADD')
    if (cursor.upper() === 'COLUMN') cursor.unsupportedClause(add, 'ADD COLUMN')
    if (cursor.acceptWord('CONSTRAINT')) {
      const named = cursor.name()
      this.note(named.line, `constraint name ${named.value} not kept`)
    }
    const kind = cursor.next()
    if (kind.text.toUpperCase() !== 'FOREIGN') cursor.unsupportedClause(kind, kind.text.toUpperCase() === 'CHECK' ? 'CHECK' : `ADD ${kind.text.toUpperCase()}`)
    cursor.expectWord('KEY')
    const columns = this.columnList(cursor)
    if (columns.length > 1) cursor.unsupportedClause(kind, 'composite FOREIGN KEY')
    cursor.expectWord('REFERENCES')
    const target = this.refTarget(cursor)
    cursor.endReached()
    const column = columns[0] as { name: string; place: Place }
    const reportAt = this.result.report.length
    this.result.foreignKeys.push(this.foreignKey(this.fold(table), column, target, first, reportAt))
    this.result.report.push({ line: first.line, kind: 'foreign key', name: `${this.fold(table)}.${column.name}`, status: 'added' })
  }

  private createIndex(cursor: Statement, first: Token): void {
    cursor.next()
    const unique = cursor.acceptWord('UNIQUE')
    cursor.expectWord('INDEX')
    if (cursor.upper() === 'IF') {
      cursor.next()
      cursor.expectWord('NOT')
      cursor.expectWord('EXISTS')
    }
    const name = cursor.name()
    cursor.expectWord('ON')
    const table = cursor.name()
    if (cursor.acceptWord('USING')) cursor.expectWord('BTREE')
    const columns = this.columnList(cursor)
    cursor.endReached()
    const written = name.kind === 'quoted' ? name.value : name.text
    this.result.indexStatements.push({
      table: this.fold(table),
      tablePlace: here(table),
      index: { columns, unique, name: this.fold(name) },
      reportAt: this.result.report.length,
    })
    this.result.report.push({ line: first.line, kind: 'index', name: written, status: 'added' })
  }
}

/** Reads a DDL dump into tables, types, indexes and foreign keys, or lists every line-and-column error. */
export function parseDdl(bytes: Buffer, dialect: Dialect, limits: Limits): ParsedDdl {
  const invalid = firstInvalidUtf8(bytes)
  if (invalid) return { ok: false, errors: [{ ...invalid, message: 'Import is not valid UTF-8 text' }] }
  const text = bytes.toString('utf8')
  const tokens = tokenize(text, dialect, limits)
  if (!Array.isArray(tokens)) return { ok: false, errors: [tokens] }

  const statements: Array<{ tokens: Token[]; terminated: boolean }> = []
  let current: Token[] = []
  for (const token of tokens) {
    if (token.kind === 'punct' && token.text === ';') {
      if (current.length) statements.push({ tokens: current, terminated: true })
      current = []
    } else current.push(token)
  }
  if (current.length) statements.push({ tokens: current, terminated: false })
  if (statements.length > limits.statementLimit) {
    const past = (statements[limits.statementLimit] as { tokens: Token[] }).tokens[0] as Token
    return { ok: false, errors: [{ line: past.line, column: past.column, message: `Import has more than ${limits.statementLimit} statements` }] }
  }

  const enumNames = new Set<string>()
  for (const statement of statements) {
    const [create, type, name] = statement.tokens
    if (create?.text.toUpperCase() === 'CREATE' && type?.text.toUpperCase() === 'TYPE' && name) {
      enumNames.add(name.kind === 'quoted' ? name.value : dialect === 'postgresql' ? name.text.toLowerCase() : name.text)
    }
  }
  const importer = new Importer(dialect, enumNames)
  for (const statement of statements) importer.statement(text, statement.tokens, statement.terminated)
  if (importer.errors.length) return { ok: false, errors: importer.errors }
  return { ok: true, value: importer.result }
}
