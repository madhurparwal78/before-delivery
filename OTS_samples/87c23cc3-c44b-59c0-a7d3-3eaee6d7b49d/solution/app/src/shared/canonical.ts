import {
  RESERVED_NAMES,
  findEntity,
  typeToString,
  type Choice,
  type Column,
  type ColumnRef,
  type Entity,
  type Group,
  type Link,
  type Literal,
  type Model,
} from './mortise.ts'

const BARE = /^[A-Za-z_][A-Za-z0-9_]*$/

function printName(name: string): string {
  return BARE.test(name) && !RESERVED_NAMES.has(name) ? name : `"${name}"`
}

function printLiteral(literal: Literal): string {
  return literal.kind === 'string' ? `'${literal.text.replaceAll("'", "''")}'` : literal.text
}

function printColumn(column: Column, inline: PrintableLink | undefined): string {
  const settings: string[] = []
  if (column.key) settings.push('key')
  if (column.auto) settings.push('auto')
  if (column.required && !column.key) settings.push('required')
  if (column.unique) settings.push('unique')
  if (column.default) settings.push(`default: ${printLiteral(column.default)}`)
  if (inline) settings.push(`link: ${inline.token} ${printName(inline.to.entity)}.${printName(inline.to.column)}`)
  const head = `  ${printName(column.name)} ${typeToString(column.type)}`
  return settings.length ? `${head} [${settings.join(', ')}]` : head
}

export type PrintableLink = Pick<Link, 'from' | 'to' | 'token' | 'deleteAction' | 'inline'>
type PrintableEntity = Pick<Entity, 'name' | 'columns' | 'indexes'>
export type PrintableModel = { choices: Array<Pick<Choice, 'name' | 'values'>>; entities: PrintableEntity[]; links: PrintableLink[]; groups: Array<Pick<Group, 'name' | 'entities'>> }

function printLinkLine(link: Omit<PrintableLink, 'inline'>): string {
  const base = `link ${printName(link.from.entity)}.${printName(link.from.column)} ${link.token} ${printName(link.to.entity)}.${printName(link.to.column)}`
  return link.deleteAction ? `${base} [delete: ${link.deleteAction}]` : base
}

function printChoice(choice: Pick<Choice, 'name' | 'values'>): string {
  return `choice ${printName(choice.name)} { ${choice.values.map(printName).join(', ')} }`
}

function printGroup(name: string, entities: string[]): string {
  return `group "${name}" { ${entities.map(printName).join(', ')} }`
}

/** The entity block followed by the link lines the entity owns, as lines without line endings. */
export function printEntityUnit(model: Pick<PrintableModel, 'links'>, entity: PrintableEntity): string[] {
  const inlineLinks = model.links.filter((link) => link.inline && link.from.entity === entity.name)
  const lines = [`entity ${printName(entity.name)} {`]
  for (const column of entity.columns) {
    lines.push(printColumn(column, inlineLinks.find((link) => link.from.column === column.name)))
  }
  for (const index of entity.indexes) {
    const parts: string[] = []
    if (index.unique) parts.push('unique')
    if (index.name !== null) parts.push(`name: "${index.name}"`)
    lines.push(`  index (${index.columns.map(printName).join(', ')})${parts.length ? ` [${parts.join(', ')}]` : ''}`)
  }
  lines.push('}')
  for (const link of model.links) {
    if (!link.inline && link.from.entity === entity.name) lines.push(printLinkLine(link))
  }
  return lines
}

/** The whole text of a model: choices, then entities with their links, then groups, one blank line between blocks. */
export function printModel(model: PrintableModel): string {
  const blocks: string[][] = []
  for (const choice of model.choices) blocks.push([printChoice(choice)])
  for (const entity of model.entities) blocks.push(printEntityUnit(model, entity))
  for (const group of model.groups) {
    const ordered = model.entities.map((entity) => entity.name).filter((name) => group.entities.includes(name))
    blocks.push([printGroup(group.name, ordered)])
  }
  return blocks.length ? `${blocks.map((block) => block.join('\n')).join('\n\n')}\n` : ''
}

/* ------------------------------------------------------ edits on text */

interface TextLine {
  text: string
  eol: string
}

function splitLines(text: string): TextLine[] {
  const lines: TextLine[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charAt(i) !== '\n') continue
    const crlf = i > start && text.charAt(i - 1) === '\r'
    lines.push({ text: text.slice(start, crlf ? i - 1 : i), eol: crlf ? '\r\n' : '\n' })
    start = i + 1
  }
  if (start < text.length) lines.push({ text: text.slice(start), eol: '' })
  return lines
}

function joinLines(lines: TextLine[]): string {
  return lines.map((line) => line.text + line.eol).join('')
}

function dominantEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function appendBlock(text: string, block: string[]): string {
  const eol = dominantEol(text)
  const body = block.join(eol) + eol
  if (text === '') return body
  return text.endsWith('\n') ? `${text}${eol}${body}` : `${text}${eol}${eol}${body}`
}

export function appendGroupBlock(text: string, name: string, entities: string[]): string {
  return appendBlock(text, [printGroup(name, entities)])
}

export function appendStarterEntity(text: string, model: Model): string {
  let name = 'new_entity'
  for (let n = 2; findEntity(model, name); n++) name = `new_entity_${n}`
  return appendBlock(text, [`entity ${name} {`, '  id int [key, auto]', '}'])
}

export interface ImportedBlock {
  kind: 'choice' | 'entity'
  name: string
}

/**
 * Merges imported blocks into a text: a block whose name exists replaces the existing block in place (an entity takes
 * the link lines directly after it too); new blocks are appended in order, each after one blank line.
 */
export function mergeImportedBlocks(text: string, model: Model, imported: PrintableModel, order: ImportedBlock[]): string {
  const lines = splitLines(text)
  const linkLines = new Set(model.links.filter((link) => !link.inline).map((link) => link.line))
  const replacements: Array<{ from: number; to: number; block: string[] }> = []
  const appended: string[][] = []
  for (const item of order) {
    if (item.kind === 'choice') {
      const choice = imported.choices.find((candidate) => candidate.name === item.name) as PrintableModel['choices'][number]
      const existing = model.choices.find((candidate) => candidate.name === item.name)
      if (existing) replacements.push({ from: existing.line, to: existing.endLine, block: [printChoice(choice)] })
      else appended.push([printChoice(choice)])
    } else {
      const entity = imported.entities.find((candidate) => candidate.name === item.name) as PrintableEntity
      const existing = findEntity(model, item.name)
      if (existing) {
        let to = existing.endLine
        while (linkLines.has(to + 1)) to++
        replacements.push({ from: existing.line, to, block: printEntityUnit(imported, entity) })
      } else appended.push(printEntityUnit(imported, entity))
    }
  }
  const eol = dominantEol(text)
  for (const { from, to, block } of replacements.sort((a, b) => b.from - a.from)) {
    const lastEol = (lines[to] as TextLine).eol
    lines.splice(from, to - from + 1, ...block.map((line, i) => ({ text: line, eol: i === block.length - 1 ? lastEol : eol })))
  }
  return appended.reduce((merged, block) => appendBlock(merged, block), joinLines(lines))
}

export function removeGroupBlock(text: string, group: Group): string {
  const lines = splitLines(text)
  const blank = lines[group.line - 1]
  const from = blank !== undefined && blank.text.trim() === '' ? group.line - 1 : group.line
  lines.splice(from, group.endLine - from + 1)
  return joinLines(lines)
}

export function insertLinkLine(text: string, model: Model, from: ColumnRef, to: ColumnRef): { text: string; line: string; lineNumber: number } {
  const lines = splitLines(text)
  const owner = findEntity(model, from.entity) as Entity
  const linkLines = new Set(model.links.filter((link) => !link.inline).map((link) => link.line))
  let last = owner.endLine
  while (linkLines.has(last + 1)) last++
  const line = printLinkLine({ from, to, token: '>-', deleteAction: null })
  const followed = lines[last] as TextLine
  if (followed.eol === '') {
    followed.eol = dominantEol(text)
    lines.splice(last + 1, 0, { text: line, eol: '' })
  } else {
    lines.splice(last + 1, 0, { text: line, eol: followed.eol })
  }
  return { text: joinLines(lines), line, lineNumber: last + 2 }
}

export function renameEntityInText(text: string, model: Model, from: string, to: string): string {
  const lines = splitLines(text)
  const edits: Array<{ line: number; start: number; end: number }> = []
  const entity = findEntity(model, from)
  if (entity) edits.push({ line: entity.nameSpan.line, start: entity.nameSpan.start, end: entity.nameSpan.end })
  for (const link of model.links) {
    link.entitySpans.forEach((span, side) => {
      const ref = side === 0 ? link.from : link.to
      if (span && ref.entity === from) edits.push(span)
    })
  }
  for (const group of model.groups) {
    group.entities.forEach((name, i) => {
      const span = group.memberSpans[i]
      if (span && name === from) edits.push(span)
    })
  }
  edits.sort((a, b) => b.line - a.line || b.start - a.start)
  const printed = printName(to)
  for (const edit of edits) {
    const line = lines[edit.line] as TextLine
    line.text = line.text.slice(0, edit.start) + printed + line.text.slice(edit.end)
  }
  return joinLines(lines)
}
