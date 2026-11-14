import {
  CARDINALITY_OF,
  DEFAULT_LIMITS,
  GROUP_NAME_MAX,
  NAME_MAX,
  type Cardinality,
  type DeleteAction,
  type Limits,
  type LinkToken,
} from './domain.ts'

const STATEMENT_KEYWORDS = ['entity', 'choice', 'link', 'group'] as const
export const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'entity', 'choice', 'link', 'group', 'index', 'key', 'auto', 'required', 'unique', 'default', 'true', 'false', 'null', 'now',
])

const TYPE_NAMES = [
  'int', 'smallint', 'bigint', 'decimal', 'float', 'double', 'bool', 'text', 'varchar', 'char', 'date', 'time',
  'timestamp', 'timestamptz', 'uuid', 'json', 'bytes',
] as const
const INTEGER_TYPES: ReadonlySet<string> = new Set(['int', 'smallint', 'bigint'])

interface Span {
  line: number
  start: number
  end: number
}

export interface MortiseError {
  line: number
  column: number
  message: string
  /** Set on the error of a link that joins the same two columns as an earlier one. */
  duplicateLink?: true
}

export type Literal =
  | { kind: 'number'; text: string }
  | { kind: 'string'; text: string }
  | { kind: 'boolean'; text: 'true' | 'false' }
  | { kind: 'null'; text: 'null' }
  | { kind: 'now'; text: 'now' }

interface ColumnType {
  name: string
  params: number[]
}

export interface ColumnRef {
  entity: string
  column: string
}

export interface Column {
  name: string
  type: ColumnType
  key: boolean
  auto: boolean
  required: boolean
  unique: boolean
  default: Literal | null
}

interface Index {
  columns: string[]
  unique: boolean
  name: string | null
}

export interface Entity {
  name: string
  columns: Column[]
  indexes: Index[]
  line: number
  endLine: number
  nameSpan: Span
}

export interface Choice {
  name: string
  values: string[]
  line: number
  endLine: number
}

export interface Link {
  from: ColumnRef
  to: ColumnRef
  token: LinkToken
  cardinality: Cardinality
  deleteAction: DeleteAction | null
  inline: boolean
  line: number
  column: number
  entitySpans: [Span | null, Span]
}

export interface Group {
  name: string
  entities: string[]
  line: number
  endLine: number
  memberSpans: Span[]
}

type StatementRef =
  | { kind: 'choice'; index: number }
  | { kind: 'entity'; index: number }
  | { kind: 'link'; index: number }
  | { kind: 'group'; index: number }

export interface Model {
  choices: Choice[]
  entities: Entity[]
  links: Link[]
  groups: Group[]
  order: StatementRef[]
}

interface ParseResult {
  model: Model
  errors: MortiseError[]
}

export function formatError(error: MortiseError): string {
  return `Line ${error.line}, column ${error.column}: ${error.message}`
}

export function typeToString(type: ColumnType): string {
  return type.params.length ? `${type.name}(${type.params.join(',')})` : type.name
}

function isIntegerType(type: ColumnType): boolean {
  return INTEGER_TYPES.has(type.name)
}

export function findEntity(model: Model, name: string): Entity | undefined {
  return model.entities.find((entity) => entity.name === name)
}

export function findColumn(entity: Entity, name: string): Column | undefined {
  return entity.columns.find((column) => column.name === name)
}

function emptyModel(): Model {
  return { choices: [], entities: [], links: [], groups: [], order: [] }
}

/* ---------------------------------------------------------------- lexing */

type TokenKind = 'word' | 'number' | 'dq' | 'sq' | 'punct' | 'link' | 'open-quote' | 'other'

interface Token {
  kind: TokenKind
  text: string
  value: string
  start: number
  end: number
}

interface LexedLine {
  tokens: Token[]
  lineEnd: number
}

const WORD_CHAR = /[A-Za-z0-9_]/
const PUNCTUATION = new Set(['{', '}', '[', ']', '(', ')', ',', ':', '.'])

function lexLine(line: string): LexedLine {
  const tokens: Token[] = []
  let i = 0
  let lineEnd = 0
  const push = (kind: TokenKind, start: number, end: number, value = line.slice(start, end)): void => {
    tokens.push({ kind, text: line.slice(start, end), value, start, end })
    lineEnd = end
  }
  while (i < line.length) {
    const ch = line.charAt(i)
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++
    } else if (ch === '#') {
      break
    } else if (ch === '"' || ch === "'") {
      const start = i
      let value = ''
      let closed = false
      i++
      while (i < line.length) {
        const inner = line.charAt(i)
        if (inner === ch) {
          if (ch === "'" && line.charAt(i + 1) === "'") {
            value += "'"
            i += 2
            continue
          }
          closed = true
          i++
          break
        }
        value += inner
        i++
      }
      if (closed) push(ch === '"' ? 'dq' : 'sq', start, i, value)
      else push('open-quote', start, line.length)
    } else if (ch === '>' && line.startsWith('>-<', i)) {
      push('link', i, i + 3)
      i += 3
    } else if (ch === '>' && line.startsWith('>-', i)) {
      push('link', i, i + 2)
      i += 2
    } else if (ch === '-' && line.startsWith('-<', i)) {
      push('link', i, i + 2)
      i += 2
    } else if (ch === '-' && line.startsWith('--', i)) {
      push('link', i, i + 2)
      i += 2
    } else if (ch === '-' && /[0-9]/.test(line.charAt(i + 1))) {
      const start = i
      i++
      while (/[0-9]/.test(line.charAt(i))) i++
      if (line.charAt(i) === '.' && /[0-9]/.test(line.charAt(i + 1))) {
        i++
        while (/[0-9]/.test(line.charAt(i))) i++
      }
      push('number', start, i)
    } else if (WORD_CHAR.test(ch)) {
      const start = i
      while (WORD_CHAR.test(line.charAt(i))) i++
      const word = line.slice(start, i)
      if (/^[0-9]+$/.test(word) && line.charAt(i) === '.' && /[0-9]/.test(line.charAt(i + 1))) {
        i++
        while (/[0-9]/.test(line.charAt(i))) i++
        push('number', start, i)
      } else {
        push(/^[0-9]+$/.test(word) ? 'number' : 'word', start, i)
      }
    } else if (PUNCTUATION.has(ch)) {
      push('punct', i, i + 1)
      i++
    } else {
      const point = String.fromCodePoint(line.codePointAt(i) ?? 0)
      push('other', i, i + point.length)
      i += point.length
    }
  }
  return { tokens, lineEnd }
}

function columnOf(line: string, offset: number): number {
  let count = 0
  for (let i = 0; i < offset; i++) {
    const code = line.charCodeAt(i)
    if (code < 0xdc00 || code > 0xdfff) count++
  }
  return count + 1
}

const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const DQ_NAME_CHARS = /^[\x20-\x7e]*$/

function isDqNameValue(value: string): boolean {
  return value.length >= 1 && DQ_NAME_CHARS.test(value) && !/["\\.`]/.test(value)
}

function isNameToken(token: Token): boolean {
  if (token.kind === 'word') return BARE_NAME.test(token.text)
  if (token.kind === 'dq') return isDqNameValue(token.value)
  return false
}

function isGroupNameToken(token: Token): boolean {
  return token.kind === 'dq' && token.value.length >= 1 && token.value.length <= GROUP_NAME_MAX
}

/* ----------------------------------------------------------- raw syntax */

interface RawSetting {
  name: string
  span: Span
  literal?: Literal
  literalSpan?: Span
  token?: LinkToken
  target?: { entity: string; column: string; entitySpan: Span; columnSpan: Span }
  indexName?: string
}

interface RawColumn {
  name: string
  nameSpan: Span
  typeName: string
  typeSpan: Span
  parenSpan: Span | null
  params: number[]
  settings: RawSetting[]
}

interface RawIndex {
  names: Array<{ name: string; span: Span }>
  settings: RawSetting[]
}

interface RawEntity {
  name: string
  nameSpan: Span
  brace: Span
  line: number
  endLine: number
  columns: RawColumn[]
  indexes: RawIndex[]
}

interface RawChoice {
  name: string
  nameSpan: Span
  values: Array<{ value: string; span: Span }>
  line: number
  endLine: number
}

interface RawLink {
  from: { entity: string; column: string; entitySpan: Span; columnSpan: Span }
  token: LinkToken
  to: { entity: string; column: string; entitySpan: Span; columnSpan: Span }
  action: DeleteAction | null
  actionSpan: Span | null
  keywordSpan: Span
  inline: boolean
  line: number
}

interface RawGroup {
  name: string
  nameSpan: Span
  members: Array<{ name: string; span: Span }>
  line: number
  endLine: number
}

type RawStatement =
  | { kind: 'choice'; node: RawChoice }
  | { kind: 'entity'; node: RawEntity }
  | { kind: 'link'; node: RawLink }
  | { kind: 'group'; node: RawGroup }

const MAX_VARCHAR = 16383
const MAX_CHAR = 255

class Parser {
  readonly errors: MortiseError[] = []
  readonly statements: RawStatement[] = []
  private readonly lines: string[]
  private readonly lexed: Array<LexedLine | undefined>
  private statementCount = 0
  private entityCount = 0

  constructor(
    text: string,
    private readonly limits: Limits,
  ) {
    this.lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    if (this.lines.length > 1 && this.lines[this.lines.length - 1] === '') this.lines.pop()
    this.lexed = new Array<LexedLine | undefined>(this.lines.length)
    this.endOfText = this.computeEndOfText(text)
  }

  private readonly endOfText: { line: number; column: number }

  private computeEndOfText(text: string): { line: number; column: number } {
    if (text.endsWith('\n')) return { line: this.lines.length + 1, column: 1 }
    const last = this.lines.length - 1
    return { line: last + 1, column: columnOf(this.lines[last] ?? '', (this.lines[last] ?? '').length) }
  }

  private lex(line: number): LexedLine {
    let lexed = this.lexed[line]
    if (!lexed) {
      lexed = lexLine(this.lines[line] ?? '')
      this.lexed[line] = lexed
    }
    return lexed
  }

  private span(line: number, token: Token): Span {
    return { line, start: token.start, end: token.end }
  }

  report(line: number, offset: number, message: string, duplicateLink = false): void {
    this.errors.push({ line: line + 1, column: columnOf(this.lines[line] ?? '', offset), message, ...(duplicateLink ? { duplicateLink: true as const } : {}) })
  }

  reportAt(span: Span, message: string, duplicateLink = false): void {
    this.report(span.line, span.start, message, duplicateLink)
  }

  private unexpectedEndOfLine(line: number): void {
    this.report(line, this.lex(line).lineEnd, 'Unexpected end of line')
  }

  private unexpectedToken(line: number, token: Token): void {
    if (token.kind === 'open-quote') this.unexpectedEndOfLine(line)
    else this.report(line, token.start, `Unexpected token ${token.text}`)
  }

  private countStatement(line: number, offset: number): void {
    this.statementCount++
    if (this.statementCount === this.limits.statementLimit + 1) {
      this.report(line, offset, `Schema has more than ${this.limits.statementLimit} statements`)
    }
  }

  parse(): void {
    let line = 0
    while (line < this.lines.length) {
      const { tokens } = this.lex(line)
      const first = tokens[0]
      if (!first) {
        line++
      } else if (first.kind === 'word' && first.text === 'entity') {
        this.countStatement(line, first.start)
        line = this.parseEntity(line)
      } else if (first.kind === 'word' && first.text === 'choice') {
        this.countStatement(line, first.start)
        line = this.parseChoice(line)
      } else if (first.kind === 'word' && first.text === 'group') {
        this.countStatement(line, first.start)
        line = this.parseGroup(line)
      } else if (first.kind === 'word' && first.text === 'link') {
        this.countStatement(line, first.start)
        this.parseLinkLine(line)
        line++
      } else {
        this.unexpectedToken(line, first)
        line++
      }
    }
  }

  /* ------------------------------------------------------------ entity */

  private skipBlock(from: number): number {
    for (let line = from; line < this.lines.length; line++) {
      const { tokens } = this.lex(line)
      if (tokens.length === 1 && tokens[0]?.text === '}') return line + 1
    }
    return this.lines.length
  }

  private parseEntity(line: number): number {
    const { tokens } = this.lex(line)
    const name = tokens[1]
    if (!name) {
      this.unexpectedEndOfLine(line)
      return this.skipBlock(line + 1)
    }
    if (!isNameToken(name)) {
      this.unexpectedToken(line, name)
      return this.skipBlock(line + 1)
    }
    const open = tokens[2]
    if (!open) this.unexpectedEndOfLine(line)
    else if (open.text !== '{') this.unexpectedToken(line, open)
    else if (tokens[3]) this.unexpectedToken(line, tokens[3])
    const brace = tokens[tokens.length - 1]
    if (!brace || brace.text !== '{' || brace.kind !== 'punct') return this.skipBlock(line + 1)

    this.entityCount++
    const nameSpan = this.span(line, name)
    if (this.entityCount === this.limits.entityLimit + 1) {
      this.reportAt(nameSpan, `Schema has more than ${this.limits.entityLimit} entities`)
    }
    const entity: RawEntity = {
      name: name.value,
      nameSpan,
      brace: this.span(line, brace),
      line,
      endLine: line,
      columns: [],
      indexes: [],
    }
    this.statements.push({ kind: 'entity', node: entity })
    let next = line + 1
    for (; next < this.lines.length; next++) {
      const lexed = this.lex(next)
      const first = lexed.tokens[0]
      if (!first) continue
      if (first.text === '}' && first.kind === 'punct') {
        if (lexed.tokens[1]) this.unexpectedToken(next, lexed.tokens[1])
        entity.endLine = next
        return next + 1
      }
      if (first.kind === 'word' && (STATEMENT_KEYWORDS as readonly string[]).includes(first.text)) {
        this.reportAt(entity.brace, `Missing closing brace for entity ${entity.name}`)
        entity.endLine = next - 1
        return next
      }
      this.parseMember(next, entity)
    }
    this.reportAt(entity.brace, `Missing closing brace for entity ${entity.name}`)
    entity.endLine = this.lines.length - 1
    return this.lines.length
  }

  private parseMember(line: number, entity: RawEntity): void {
    const { tokens } = this.lex(line)
    const first = tokens[0]
    if (!first) return
    if (first.kind === 'word' && first.text === 'index' && tokens[1]?.text === '(' && tokens[1].kind === 'punct') {
      const index = this.parseIndex(line, tokens)
      if (index) entity.indexes.push(index)
      return
    }
    const column = this.parseColumn(line, tokens)
    if (column) entity.columns.push(column)
  }

  private parseColumn(line: number, tokens: Token[]): RawColumn | null {
    const nameToken = tokens[0]
    if (!nameToken) return null
    if (!isNameToken(nameToken)) {
      this.unexpectedToken(line, nameToken)
      return null
    }
    const typeToken = tokens[1]
    if (!typeToken) {
      this.unexpectedEndOfLine(line)
      return null
    }
    if (typeToken.kind !== 'word') {
      this.unexpectedToken(line, typeToken)
      return null
    }
    let at = 2
    const params: number[] = []
    let parenSpan: Span | null = null
    if (tokens[at]?.text === '(' && tokens[at]?.kind === 'punct') {
      parenSpan = this.span(line, tokens[at] as Token)
      at++
      for (;;) {
        const number = tokens[at]
        if (!number) return this.endOfLine(line)
        if (number.kind !== 'number' || number.text.includes('.') || number.text.startsWith('-')) return this.badToken(line, number)
        params.push(Number(number.text))
        at++
        const after = tokens[at]
        if (!after) return this.endOfLine(line)
        if (after.text === ',' && after.kind === 'punct' && params.length < 2) {
          at++
          continue
        }
        if (after.text === ')' && after.kind === 'punct') {
          at++
          break
        }
        return this.badToken(line, after)
      }
    }
    let settings: RawSetting[] = []
    if (tokens[at]?.text === '[' && tokens[at]?.kind === 'punct') {
      const parsed = this.parseSettings(line, tokens, at + 1, false)
      if (!parsed) return null
      settings = parsed.settings
      at = parsed.next
    }
    if (tokens[at]) {
      this.unexpectedToken(line, tokens[at] as Token)
      return null
    }
    return {
      name: nameToken.value,
      nameSpan: this.span(line, nameToken),
      typeName: typeToken.text,
      typeSpan: this.span(line, typeToken),
      parenSpan,
      params,
      settings,
    }
  }

  private endOfLine(line: number): null {
    this.unexpectedEndOfLine(line)
    return null
  }

  private badToken(line: number, token: Token): null {
    this.unexpectedToken(line, token)
    return null
  }

  private parseLiteral(line: number, token: Token | undefined): { literal: Literal; span: Span } | null {
    if (!token) return this.endOfLine(line)
    const span = this.span(line, token)
    if (token.kind === 'number') return { literal: { kind: 'number', text: token.text }, span }
    if (token.kind === 'sq') return { literal: { kind: 'string', text: token.value }, span }
    if (token.kind === 'word') {
      if (token.text === 'true' || token.text === 'false') return { literal: { kind: 'boolean', text: token.text }, span }
      if (token.text === 'null') return { literal: { kind: 'null', text: 'null' }, span }
      if (token.text === 'now') return { literal: { kind: 'now', text: 'now' }, span }
    }
    return this.badToken(line, token)
  }

  private parseRef(line: number, tokens: Token[], at: number): { ref: RawLink['from']; next: number } | null {
    const entity = tokens[at]
    if (!entity) return this.endOfLine(line)
    if (!isNameToken(entity)) return this.badToken(line, entity)
    const dot = tokens[at + 1]
    if (!dot) return this.endOfLine(line)
    if (dot.text !== '.' || dot.kind !== 'punct') return this.badToken(line, dot)
    const column = tokens[at + 2]
    if (!column) return this.endOfLine(line)
    if (!isNameToken(column)) return this.badToken(line, column)
    return {
      ref: { entity: entity.value, column: column.value, entitySpan: this.span(line, entity), columnSpan: this.span(line, column) },
      next: at + 3,
    }
  }

  private parseSettings(line: number, tokens: Token[], from: number, forIndex: boolean): { settings: RawSetting[]; next: number } | null {
    const settings: RawSetting[] = []
    let at = from
    for (;;) {
      const word = tokens[at]
      if (!word) return this.endOfLine(line)
      if (word.kind !== 'word') return this.badToken(line, word)
      const setting: RawSetting = { name: word.text, span: this.span(line, word) }
      at++
      if (word.text === 'default' && !forIndex) {
        const colon = tokens[at]
        if (!colon) return this.endOfLine(line)
        if (colon.text !== ':' || colon.kind !== 'punct') return this.badToken(line, colon)
        const literal = this.parseLiteral(line, tokens[at + 1])
        if (!literal) return null
        setting.literal = literal.literal
        setting.literalSpan = literal.span
        at += 2
      } else if (word.text === 'link' && !forIndex) {
        const colon = tokens[at]
        if (!colon) return this.endOfLine(line)
        if (colon.text !== ':' || colon.kind !== 'punct') return this.badToken(line, colon)
        const tokenAt = tokens[at + 1]
        if (!tokenAt) return this.endOfLine(line)
        if (tokenAt.kind !== 'link') return this.badToken(line, tokenAt)
        const ref = this.parseRef(line, tokens, at + 2)
        if (!ref) return null
        setting.token = tokenAt.text as LinkToken
        setting.target = ref.ref
        at = ref.next
      } else if (word.text === 'name' && forIndex) {
        const colon = tokens[at]
        if (!colon) return this.endOfLine(line)
        if (colon.text !== ':' || colon.kind !== 'punct') return this.badToken(line, colon)
        const value = tokens[at + 1]
        if (!value) return this.endOfLine(line)
        if (!isGroupNameToken(value)) return this.badToken(line, value)
        setting.indexName = value.value
        at += 2
      }
      settings.push(setting)
      const after = tokens[at]
      if (!after) return this.endOfLine(line)
      if (after.text === ',' && after.kind === 'punct') {
        at++
        continue
      }
      if (after.text === ']' && after.kind === 'punct') return { settings, next: at + 1 }
      return this.badToken(line, after)
    }
  }

  private parseIndex(line: number, tokens: Token[]): RawIndex | null {
    const names: RawIndex['names'] = []
    let at = 2
    for (;;) {
      const name = tokens[at]
      if (!name) return this.endOfLine(line)
      if (!isNameToken(name)) return this.badToken(line, name)
      names.push({ name: name.value, span: this.span(line, name) })
      at++
      const after = tokens[at]
      if (!after) return this.endOfLine(line)
      if (after.text === ',' && after.kind === 'punct') {
        at++
        continue
      }
      if (after.text === ')' && after.kind === 'punct') {
        at++
        break
      }
      return this.badToken(line, after)
    }
    let settings: RawSetting[] = []
    if (tokens[at]?.text === '[' && tokens[at]?.kind === 'punct') {
      const parsed = this.parseSettings(line, tokens, at + 1, true)
      if (!parsed) return null
      settings = parsed.settings
      at = parsed.next
    }
    if (tokens[at]) return this.badToken(line, tokens[at] as Token)
    return { names, settings }
  }

  /* ------------------------------------------------------- link lines */

  private parseLinkLine(line: number): void {
    const { tokens } = this.lex(line)
    const keyword = tokens[0] as Token
    const from = this.parseRef(line, tokens, 1)
    if (!from) return
    const tokenAt = tokens[from.next]
    if (!tokenAt) return void this.unexpectedEndOfLine(line)
    if (tokenAt.kind !== 'link') return void this.unexpectedToken(line, tokenAt)
    const to = this.parseRef(line, tokens, from.next + 1)
    if (!to) return
    let at = to.next
    let action: DeleteAction | null = null
    let actionSpan: Span | null = null
    if (tokens[at]?.text === '[' && tokens[at]?.kind === 'punct') {
      const word = tokens[at + 1]
      if (!word) return void this.unexpectedEndOfLine(line)
      if (word.text !== 'delete' || word.kind !== 'word') return void this.unexpectedToken(line, word)
      const colon = tokens[at + 2]
      if (!colon) return void this.unexpectedEndOfLine(line)
      if (colon.text !== ':' || colon.kind !== 'punct') return void this.unexpectedToken(line, colon)
      const first = tokens[at + 3]
      if (!first) return void this.unexpectedEndOfLine(line)
      actionSpan = this.span(line, first)
      let consumed = 1
      if (first.kind === 'word' && (first.text === 'cascade' || first.text === 'restrict')) {
        action = first.text
      } else if (first.kind === 'word' && (first.text === 'set' || first.text === 'no')) {
        const second = tokens[at + 4]
        const wanted = first.text === 'set' ? 'null' : 'action'
        if (!second) return void this.unexpectedEndOfLine(line)
        if (second.text !== wanted || second.kind !== 'word') return void this.unexpectedToken(line, second)
        action = first.text === 'set' ? 'set null' : 'no action'
        consumed = 2
      } else {
        return void this.unexpectedToken(line, first)
      }
      const close = tokens[at + 3 + consumed]
      if (!close) return void this.unexpectedEndOfLine(line)
      if (close.text !== ']' || close.kind !== 'punct') return void this.unexpectedToken(line, close)
      at += 4 + consumed
    }
    if (tokens[at]) return void this.unexpectedToken(line, tokens[at] as Token)
    this.statements.push({
      kind: 'link',
      node: {
        from: from.ref,
        token: tokenAt.text as LinkToken,
        to: to.ref,
        action,
        actionSpan,
        keywordSpan: this.span(line, keyword),
        inline: false,
        line,
      },
    })
  }

  /* ---------------------------------------------- choice and group lists */

  private skipToCloseBrace(line: number, tokenIndex: number): number {
    let at = tokenIndex
    for (let current = line; current < this.lines.length; current++) {
      const { tokens } = this.lex(current)
      for (; at < tokens.length; at++) {
        if (tokens[at]?.text === '}' && tokens[at]?.kind === 'punct') {
          if (tokens[at + 1]) this.unexpectedToken(current, tokens[at + 1] as Token)
          return current + 1
        }
      }
      at = 0
    }
    return this.lines.length
  }

  private parseList<T extends { span: Span }>(
    line: number,
    headerKind: 'choice' | 'group',
    isHeadName: (token: Token) => boolean,
    makeItem: (token: Token, span: Span) => T,
    describe: (name: string) => string,
  ): { head: { token: Token; span: Span } | null; items: T[]; end: number; endLine: number } {
    const lexed = this.lex(line)
    const items: T[] = []
    const head = lexed.tokens[1]
    if (!head) {
      this.unexpectedEndOfLine(line)
      return { head: null, items, end: this.skipToCloseBrace(line + 1, 0), endLine: line }
    }
    if (!isHeadName(head)) {
      this.unexpectedToken(line, head)
      return { head: null, items, end: this.skipToCloseBrace(line, 2), endLine: line }
    }
    const headInfo = { token: head, span: this.span(line, head) }
    const open = lexed.tokens[2]
    if (!open) {
      this.unexpectedEndOfLine(line)
      return { head: headInfo, items, end: this.skipToCloseBrace(line + 1, 0), endLine: line }
    }
    if (open.text !== '{' || open.kind !== 'punct') {
      this.unexpectedToken(line, open)
      return { head: headInfo, items, end: this.skipToCloseBrace(line, 3), endLine: line }
    }
    const brace = this.span(line, open)
    let current = line
    let at = 3
    let expectName = true
    for (;;) {
      let tokens = this.lex(current).tokens
      while (at >= tokens.length) {
        current++
        at = 0
        while (current < this.lines.length && this.lex(current).tokens.length === 0) current++
        if (current >= this.lines.length) {
          this.errors.push({ line: this.endOfText.line, column: this.endOfText.column, message: 'Unexpected end of text' })
          return { head: headInfo, items, end: this.lines.length, endLine: this.lines.length - 1 }
        }
        tokens = this.lex(current).tokens
        const first = tokens[0] as Token
        if (first.kind === 'word' && (STATEMENT_KEYWORDS as readonly string[]).includes(first.text)) {
          this.reportAt(brace, `Missing closing brace for ${headerKind} ${describe(head.value)}`)
          return { head: headInfo, items, end: current, endLine: current - 1 }
        }
      }
      const token = tokens[at] as Token
      if (expectName) {
        if (!isNameToken(token)) {
          this.unexpectedToken(current, token)
          return { head: headInfo, items, end: this.skipToCloseBrace(current, at + 1), endLine: current }
        }
        items.push(makeItem(token, this.span(current, token)))
        expectName = false
        at++
      } else if (token.text === ',' && token.kind === 'punct') {
        expectName = true
        at++
      } else if (token.text === '}' && token.kind === 'punct') {
        if (tokens[at + 1]) this.unexpectedToken(current, tokens[at + 1] as Token)
        return { head: headInfo, items, end: current + 1, endLine: current }
      } else {
        this.unexpectedToken(current, token)
        return { head: headInfo, items, end: this.skipToCloseBrace(current, at + 1), endLine: current }
      }
    }
  }

  private parseChoice(line: number): number {
    const result = this.parseList(
      line,
      'choice',
      isNameToken,
      (token, span) => ({ value: token.value, span }),
      (name) => name,
    )
    if (result.head) {
      this.statements.push({
        kind: 'choice',
        node: { name: result.head.token.value, nameSpan: result.head.span, values: result.items, line, endLine: result.endLine },
      })
    }
    return result.end
  }

  private parseGroup(line: number): number {
    const result = this.parseList(
      line,
      'group',
      isGroupNameToken,
      (token, span) => ({ name: token.value, span }),
      (name) => `"${name}"`,
    )
    if (result.head) {
      this.statements.push({
        kind: 'group',
        node: { name: result.head.token.value, nameSpan: result.head.span, members: result.items, line, endLine: result.endLine },
      })
    }
    return result.end
  }
}

/* -------------------------------------------------------------- checks */

function checkAndBuild(parser: Parser): Model {
  const model = emptyModel()
  const choiceNames = new Map<string, number>()
  const choiceByName = new Map<string, Choice>()
  const entityLines = new Map<string, number>()
  const groupLines = new Map<string, number>()
  const nameLength = (span: Span, name: string): void => {
    if (name.length > NAME_MAX) parser.reportAt(span, `Name ${name} is longer than ${NAME_MAX} characters`)
  }

  for (const statement of parser.statements) {
    if (statement.kind !== 'choice') continue
    const raw = statement.node
    nameLength(raw.nameSpan, raw.name)
    const first = choiceNames.get(raw.name)
    if (first !== undefined) {
      parser.reportAt(raw.nameSpan, `Choice ${raw.name} is already defined on line ${first + 1}`)
      continue
    }
    choiceNames.set(raw.name, raw.line)
    const seen = new Set<string>()
    for (const value of raw.values) {
      nameLength(value.span, value.value)
      if (seen.has(value.value)) parser.reportAt(value.span, `Choice ${raw.name} lists ${value.value} twice`)
      seen.add(value.value)
    }
    const choice: Choice = { name: raw.name, values: raw.values.map((value) => value.value), line: raw.line, endLine: raw.endLine }
    choiceByName.set(raw.name, choice)
  }

  const pendingLinks: RawLink[] = []
  for (const statement of parser.statements) {
    if (statement.kind === 'entity') {
      const raw = statement.node
      nameLength(raw.nameSpan, raw.name)
      const first = entityLines.get(raw.name)
      if (first !== undefined) parser.reportAt(raw.nameSpan, `Entity ${raw.name} is already defined on line ${first + 1}`)
      else entityLines.set(raw.name, raw.line)
      if (raw.columns.length === 0) parser.reportAt(raw.nameSpan, `Entity ${raw.name} has no columns`)
      const entity = buildEntity(parser, raw, choiceByName, nameLength, pendingLinks)
      if (first === undefined) model.entities.push(entity)
    } else if (statement.kind === 'link') {
      pendingLinks.push(statement.node)
    }
  }
  model.choices = [...choiceByName.values()]

  const linkStarts = new Map<string, number>()
  const orderedLinks = [...pendingLinks].sort((a, b) => a.line - b.line || a.keywordSpan.start - b.keywordSpan.start)
  for (const raw of orderedLinks) {
    const link = checkLink(parser, model, raw, linkStarts)
    if (link) model.links.push(link)
  }

  for (const statement of parser.statements) {
    if (statement.kind !== 'group') continue
    const raw = statement.node
    const first = groupLines.get(raw.name)
    if (first !== undefined) {
      parser.reportAt(raw.nameSpan, `Group "${raw.name}" is already defined on line ${first + 1}`)
      continue
    }
    groupLines.set(raw.name, raw.line)
    model.groups.push({
      name: raw.name,
      entities: raw.members.map((member) => member.name),
      line: raw.line,
      endLine: raw.endLine,
      memberSpans: raw.members.map((member) => member.span),
    })
  }
  const grouped = new Map<string, string>()
  for (const group of model.groups) {
    group.entities.forEach((name, i) => {
      const span = group.memberSpans[i] as Span
      if (!entityLines.has(name)) {
        parser.reportAt(span, `Group "${group.name}" names missing entity ${name}`)
        return
      }
      const owner = grouped.get(name)
      if (owner !== undefined) parser.reportAt(span, `Entity ${name} is already in group "${owner}"`)
      else grouped.set(name, group.name)
    })
  }

  model.order = statementOrder(model)
  return model
}

function statementOrder(model: Model): StatementRef[] {
  const placed: Array<{ line: number; column: number; ref: StatementRef }> = []
  model.choices.forEach((choice, index) => placed.push({ line: choice.line, column: 0, ref: { kind: 'choice', index } }))
  model.entities.forEach((entity, index) => placed.push({ line: entity.line, column: 0, ref: { kind: 'entity', index } }))
  model.links.forEach((link, index) => placed.push({ line: link.line, column: link.column, ref: { kind: 'link', index } }))
  model.groups.forEach((group, index) => placed.push({ line: group.line, column: 0, ref: { kind: 'group', index } }))
  return placed.sort((a, b) => a.line - b.line || a.column - b.column).map((item) => item.ref)
}

function checkType(
  parser: Parser,
  raw: RawColumn,
  choices: Map<string, Choice>,
): ColumnType {
  const name = raw.typeName
  const type: ColumnType = { name, params: raw.params }
  const known = (TYPE_NAMES as readonly string[]).includes(name)
  if (!known && !choices.has(name)) {
    parser.reportAt(raw.typeSpan, `Unknown type ${name}`)
    return type
  }
  const [p, s] = raw.params
  if (name === 'varchar') {
    if (raw.params.length !== 1 || (p as number) < 1 || (p as number) > MAX_VARCHAR) {
      parser.reportAt(raw.typeSpan, `Type varchar needs a length from 1 to ${MAX_VARCHAR}`)
    }
  } else if (name === 'char') {
    if (raw.params.length !== 1 || (p as number) < 1 || (p as number) > MAX_CHAR) {
      parser.reportAt(raw.typeSpan, `Type char needs a length from 1 to ${MAX_CHAR}`)
    }
  } else if (name === 'decimal') {
    if (raw.params.length !== 2 || (p as number) < 1 || (p as number) > 65 || (s as number) < 0 || (s as number) > 30 || (s as number) > (p as number)) {
      parser.reportAt(raw.typeSpan, 'Type decimal needs a precision from 1 to 65 and a scale from 0 to 30 that is not above the precision')
    }
  } else if (raw.parenSpan) {
    parser.reportAt(raw.parenSpan, `Type ${name} takes no parameters`)
  }
  return type
}

function buildEntity(
  parser: Parser,
  raw: RawEntity,
  choices: Map<string, Choice>,
  nameLength: (span: Span, name: string) => void,
  pendingLinks: RawLink[],
): Entity {
  const columns: Column[] = []
  const seen = new Set<string>()
  for (const rawColumn of raw.columns) {
    nameLength(rawColumn.nameSpan, rawColumn.name)
    if (seen.has(rawColumn.name)) {
      parser.reportAt(rawColumn.nameSpan, `Column ${rawColumn.name} is already defined in entity ${raw.name}`)
      continue
    }
    seen.add(rawColumn.name)
    const type = checkType(parser, rawColumn, choices)
    const column: Column = { name: rawColumn.name, type, key: false, auto: false, required: false, unique: false, default: null }
    let defaultSetting: RawSetting | null = null
    for (const setting of rawColumn.settings) {
      switch (setting.name) {
        case 'key':
          column.key = true
          break
        case 'auto':
          column.auto = true
          if (!isIntegerType(type)) parser.reportAt(setting.span, 'Setting auto needs an integer column')
          break
        case 'required':
          column.required = true
          break
        case 'unique':
          column.unique = true
          break
        case 'default':
          column.default = setting.literal ?? null
          defaultSetting = setting
          break
        case 'link':
          if (setting.token && setting.target) {
            pendingLinks.push({
              from: { entity: raw.name, column: rawColumn.name, entitySpan: raw.nameSpan, columnSpan: rawColumn.nameSpan },
              token: setting.token,
              to: setting.target,
              action: null,
              actionSpan: null,
              keywordSpan: setting.span,
              inline: true,
              line: setting.span.line,
            })
          }
          break
        default:
          parser.reportAt(setting.span, `Unknown setting ${setting.name}`)
      }
    }
    if (defaultSetting?.literal) {
      const choice = choices.get(type.name)
      if (column.key && defaultSetting.literal.kind === 'null') {
        parser.reportAt(defaultSetting.span, `Key column ${raw.name}.${column.name} cannot default to null`)
      }
      if (choice && defaultSetting.literal.kind !== 'null' && !choice.values.includes(defaultSetting.literal.text)) {
        parser.reportAt(defaultSetting.literalSpan as Span, `Value ${defaultSetting.literal.text} is not in choice ${choice.name}`)
      }
    }
    columns.push(column)
  }
  const indexes: Index[] = []
  for (const rawIndex of raw.indexes) {
    let valid = true
    for (const name of rawIndex.names) {
      if (!seen.has(name.name)) {
        parser.reportAt(name.span, `Index names missing column ${raw.name}.${name.name}`)
        valid = false
      }
    }
    let unique = false
    let indexName: string | null = null
    for (const setting of rawIndex.settings) {
      if (setting.name === 'unique') unique = true
      else if (setting.name === 'name') indexName = setting.indexName ?? null
      else parser.reportAt(setting.span, `Unknown setting ${setting.name}`)
    }
    if (valid) indexes.push({ columns: rawIndex.names.map((name) => name.name), unique, name: indexName })
  }
  return { name: raw.name, columns, indexes, line: raw.line, endLine: raw.endLine, nameSpan: raw.nameSpan }
}

function isUniqueColumn(entity: Entity, column: Column): boolean {
  if (column.unique) return true
  const keys = entity.columns.filter((c) => c.key)
  if (column.key && keys.length === 1) return true
  return entity.indexes.some((index) => index.unique && index.columns.length === 1 && index.columns[0] === column.name)
}

function checkLink(parser: Parser, model: Model, raw: RawLink, starts: Map<string, number>): Link | null {
  const resolve = (ref: RawLink['from']): { entity: Entity; column: Column } | null => {
    const entity = findEntity(model, ref.entity)
    if (!entity) {
      parser.reportAt(ref.entitySpan, `Link points to missing entity ${ref.entity}`)
      return null
    }
    const column = findColumn(entity, ref.column)
    if (!column) {
      parser.reportAt(ref.entitySpan, `Link points to missing column ${ref.entity}.${ref.column}`)
      return null
    }
    return { entity, column }
  }
  const from = resolve(raw.from)
  const to = resolve(raw.to)
  const link: Link = {
    from: { entity: raw.from.entity, column: raw.from.column },
    to: { entity: raw.to.entity, column: raw.to.column },
    token: raw.token,
    cardinality: CARDINALITY_OF[raw.token],
    deleteAction: raw.action,
    inline: raw.inline,
    line: raw.line,
    column: raw.keywordSpan.start,
    entitySpans: [raw.inline ? null : raw.from.entitySpan, raw.to.entitySpan],
  }
  if (!from || !to) return link
  const sameBase = from.column.type.name === to.column.type.name || (isIntegerType(from.column.type) && isIntegerType(to.column.type))
  if (!sameBase) {
    parser.reportAt(raw.to.entitySpan, `Link joins ${typeToString(from.column.type)} to ${typeToString(to.column.type)}`)
    return link
  }
  if (raw.token === '--' && !isUniqueColumn(from.entity, from.column)) {
    parser.reportAt(raw.from.entitySpan, `One-to-one link needs ${raw.from.entity}.${raw.from.column} to be unique`)
  }
  if (raw.action === 'set null' && raw.actionSpan && raw.token !== '>-<') {
    const foreign = raw.token === '-<' ? to : from
    const ref = raw.token === '-<' ? raw.to : raw.from
    if (foreign.column.required || foreign.column.key) {
      parser.reportAt(raw.actionSpan, `Link sets null on required column ${ref.entity}.${ref.column}`)
    }
  }
  const pair = [`${raw.from.entity}.${raw.from.column}`, `${raw.to.entity}.${raw.to.column}`].sort().join('\u0000')
  const previous = starts.get(pair)
  if (previous !== undefined) {
    parser.reportAt(raw.keywordSpan, `Link ${raw.from.entity}.${raw.from.column} to ${raw.to.entity}.${raw.to.column} is already defined on line ${previous + 1}`, true)
  } else {
    starts.set(pair, raw.line)
  }
  return link
}

/* --------------------------------------------------------------- entry */

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

export function parseMortise(text: string, limits: Limits = DEFAULT_LIMITS): ParseResult {
  if (byteLength(text) > limits.textLimitBytes) {
    return {
      model: emptyModel(),
      errors: [{ line: 1, column: 1, message: `Text is larger than ${limits.textLimitBytes} bytes` }],
    }
  }
  const parser = new Parser(text, limits)
  parser.parse()
  const model = checkAndBuild(parser)
  const errors = parser.errors.sort((a, b) => a.line - b.line || a.column - b.column || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0))
  return { model, errors }
}

const STATEMENT_START = /^(entity|choice|link|group)\b/

/**
 * The diagram for a text that has no earlier clean parse to fall back on: whatever still parses once every erroring line,
 * and every block left open, is left out. Null when nothing can be shown.
 */
export function parseTolerant(text: string, limits: Limits = DEFAULT_LIMITS): Model | null {
  const lines = text.split('\n')
  for (let pass = 0; pass < 8; pass++) {
    const result = parseMortise(lines.join('\n'), limits)
    if (!result.errors.length) return result.model
    for (const error of result.errors) {
      const at = error.line - 1
      if (at >= lines.length) continue
      if (error.message.startsWith('Missing closing brace')) {
        let end = at + 1
        while (end < lines.length && !STATEMENT_START.test(lines[end] as string)) end++
        for (let line = at; line < end; line++) lines[line] = ''
      } else lines[at] = ''
    }
  }
  return null
}
