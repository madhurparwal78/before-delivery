import { CABLE_CELLS, CABLE_KEY, KNIT_SYMBOLS, crochetSymbols, readsLeftward, symbolByKey, symbolText, type Side, type Symbol } from '../../shared/symbols.ts'
import type { Analysis, ChartData } from './chart.ts'

interface TextFailure { message: string; position: number | null }

interface RowCell { stitch: string; colour: string }

class Fail extends Error {
  constructor(message: string, readonly position: number) { super(message) }
}

const SEPARATOR = 'expected a comma or a full stop.'
const CABLE_TEXT = '2/2 LC'

interface Run {
  key: string
  text: string
  count: bigint
  colour: string | null
  end: number
}

/** One typed item and how many times it is worked. Counts are BigInt so a typed number of any size is arithmetic, never a loop. */
interface Planned { key: string; colour: string | null; cells: number; uses: number; makes: number; count: bigint }

interface Context {
  chart: ChartData
  side: Side
  words: Map<string, boolean>
  letters: Set<string>
}

function wordsOf(chart: ChartData): Map<string, boolean> {
  const words = new Map<string, boolean>()
  const symbols: readonly Symbol[] = chart.craft === 'knit' ? KNIT_SYMBOLS : [...crochetSymbols('us'), ...crochetSymbols('uk')]
  for (const symbol of symbols) {
    if (symbol.key === 'ns') continue
    for (const text of [symbol.rsText, symbol.wsText]) {
      if (text) words.set(text, symbol.counted)
    }
  }
  return words
}

function readWord(text: string, at: number): string {
  let end = at
  while (end < text.length && !' ,;.'.includes(text[end])) end++
  return text.slice(at, end)
}

function isBoundary(char: string | undefined): boolean {
  return char === undefined || ' ,;.'.includes(char)
}

function termsName(chart: ChartData): string {
  return chart.terms === 'uk' ? 'UK' : 'US'
}

function symbolForText(context: Context, text: string): Symbol | undefined {
  const { chart, side } = context
  const symbols = chart.craft === 'knit' ? KNIT_SYMBOLS : crochetSymbols(chart.terms ?? 'us')
  return symbols.find((s) => s.key !== 'ns' && symbolText(s, side) === text && !(s.wsText === null && side === 'WS'))
}

function readRun(text: string, at: number, context: Context): Run {
  const { chart } = context
  const word = text.startsWith(CABLE_TEXT, at) && isBoundary(text[at + CABLE_TEXT.length]) ? CABLE_TEXT : readWord(text, at)
  if (word === '') throw new Fail(SEPARATOR, at + 1)
  let stem = word
  let count = 1n
  let counted = false
  if (context.words.get(word) !== false) {
    const match = /^([a-z]+)(\d+)$/.exec(word)
    if (!match || context.words.get(match[1]) !== true || BigInt(match[2]) < 1n) {
      throw new Fail(`unknown stitch "${word}".`, at + 1)
    }
    stem = match[1]
    count = BigInt(match[2])
    counted = true
  }
  if (chart.craft === 'crochet' && !crochetSymbols(chart.terms ?? 'us').some((s) => s.rsText === stem)) {
    throw new Fail(`${stem} is not valid in ${termsName(chart)} terms.`, at + 1)
  }
  const symbol = symbolForText(context, stem)
  if (!symbol) {
    throw new Fail(`${stem} is not valid on a ${context.side === 'WS' ? 'wrong' : 'right'}-side row.`, at + 1)
  }
  let end = at + word.length
  if (!counted) {
    const times = /^ x(\d+)/.exec(text.slice(end))
    if (times && BigInt(times[1]) >= 1n) {
      count = BigInt(times[1])
      end += times[0].length
    }
  }
  let colour: string | null = null
  if (text.startsWith(' in ', end)) {
    const letter = text[end + 4] ?? ''
    if (!context.letters.has(letter)) throw new Fail(`colour ${letter} is not in the key.`, end + 5)
    colour = letter
    end += 5
  }
  return { key: symbol.key, text: stem, count, colour, end }
}

/** Items joined by ", " up to (not including) the terminator character. */
function readList(text: string, start: number, terminator: string, context: Context): { runs: Run[]; end: number } {
  const runs: Run[] = []
  let at = start
  for (;;) {
    const run = readRun(text, at, context)
    runs.push(run)
    at = run.end
    if (text.startsWith(', ', at)) { at += 2; continue }
    if (text[at] === terminator) return { runs, end: at }
    throw new Fail(SEPARATOR, at + 1)
  }
}

interface Repeat { unit: Run[]; named: bigint; tail: Run[]; position: number }

const REP_FROM = '; rep from * to '

function readRepeat(text: string, star: number, context: Context): { repeat: Repeat; end: number } {
  const unit = readList(text, star + 1, ';', context)
  let at = unit.end
  for (let k = 0; k < REP_FROM.length; k++) {
    if (text[at + k] !== REP_FROM[k]) throw new Fail(SEPARATOR, at + k + 1)
  }
  at += REP_FROM.length
  let named = 0n
  let tail: Run[] = []
  if (text.startsWith('end', at)) {
    at += 3
    if (text[at] === '.') return { repeat: { unit: unit.runs, named, tail, position: star + 1 }, end: at }
    if (!text.startsWith(', ', at)) throw new Fail(SEPARATOR, at + 1)
    at += 2
  } else {
    const last = /^last (?:(\d+) sts|(?:1 )?st), /.exec(text.slice(at))
    if (!last) throw new Fail(SEPARATOR, at + 1)
    named = last[1] ? BigInt(last[1]) : 1n
    at += last[0].length
  }
  const rest = readList(text, at, '.', context)
  tail = rest.runs
  return { repeat: { unit: unit.runs, named, tail, position: star + 1 }, end: rest.end }
}

interface Parsed { before: Run[]; repeat: Repeat | null; claim: { made: bigint; position: number } | null }

function parse(text: string, row: number, context: Context): Parsed {
  let at = 0
  const label = /^(?:Row|Rnd) (\d+)(?: \((?:RS|WS)\))?: /.exec(text)
  if (label) {
    if (Number(label[1]) !== row) throw new Fail(`the label says Row ${label[1]}.`, 1)
    at = label[0].length
  }
  const before: Run[] = []
  let repeat: Repeat | null = null
  let end: number
  for (;;) {
    if (text[at] === '*') {
      const read = readRepeat(text, at, context)
      repeat = read.repeat
      end = read.end
      break
    }
    const run = readRun(text, at, context)
    before.push(run)
    at = run.end
    if (text.startsWith(', ', at)) { at += 2; continue }
    if (text[at] === '.') { end = at; break }
    throw new Fail(SEPARATOR, at + 1)
  }
  const rest = text.slice(end + 1)
  let claim: Parsed['claim'] = null
  if (rest !== '') {
    const count = /^ \((\d+) sts?\)$/.exec(rest)
    if (!count) throw new Fail(SEPARATOR, end + 2)
    claim = { made: BigInt(count[1]), position: end + 3 }
  }
  return { before, repeat, claim }
}

function expand(chart: ChartData, runs: Run[]): Planned[] {
  return runs.map((run) => {
    if (run.key === CABLE_KEY) return { key: run.key, colour: run.colour, cells: CABLE_CELLS, uses: CABLE_CELLS, makes: CABLE_CELLS, count: run.count }
    const symbol = symbolByKey(chart.craft, chart.terms, run.key)!
    return { key: run.key, colour: run.colour, cells: 1, uses: symbol.uses, makes: symbol.makes, count: run.count }
  })
}

function total(items: Planned[], pick: (item: Planned) => number): bigint {
  return items.reduce((sum, item) => sum + BigInt(pick(item)) * item.count, 0n)
}

/** Reads typed text into the row's new cells (columns 1..width), or names the first failure. */
export function planText(chart: ChartData, analysis: Analysis, row: number, text: string, side: Side):
  { cells: RowCell[] } | { failure: TextFailure } {
  const context: Context = { chart, side, words: wordsOf(chart), letters: new Set(chart.colours.map((c) => c.letter)) }
  const fail = (message: string, position: number): { failure: TextFailure } =>
    ({ failure: { message: `Row ${row}, position ${position}: ${message}`, position } })
  try {
    const parsed = parse(text, row, context)
    const needed = BigInt(analysis.rows[row - 1].needed)
    const before = expand(chart, parsed.before)
    let items = before
    let cells = total(before, (i) => i.cells)
    let made = total(before, (i) => i.makes)
    if (parsed.repeat) {
      const unit = expand(chart, parsed.repeat.unit)
      const tail = expand(chart, parsed.repeat.tail)
      const unitUses = total(unit, (i) => i.uses)
      const tailUses = total(tail, (i) => i.uses)
      const remaining = needed - total(before, (i) => i.uses) - tailUses
      if (parsed.repeat.named !== tailUses || unitUses <= 0n || remaining <= 0n || remaining % unitUses !== 0n) {
        throw new Fail(`the repeat does not fit ${needed} stitches.`, parsed.repeat.position)
      }
      const copies = remaining / unitUses
      cells += copies * total(unit, (i) => i.cells) + total(tail, (i) => i.cells)
      made += copies * total(unit, (i) => i.makes) + total(tail, (i) => i.makes)
      // Only a row that fits is laid out, so the copies are few: every item takes at least one cell.
      items = cells > BigInt(chart.width) ? before : [...before, ...Array.from({ length: Number(copies) }, () => unit).flat(), ...tail]
    }
    if (cells > BigInt(chart.width)) throw new Fail(`the text needs ${cells} cells, the chart is ${chart.width} wide.`, 1)
    if (parsed.claim && parsed.claim.made !== made) {
      throw new Fail(`the closing count says ${parsed.claim.made} sts, the row makes ${made}.`, parsed.claim.position)
    }
    return { cells: place(chart, row, side, items, Number(cells)) }
  } catch (error) {
    if (error instanceof Fail) return fail(error.message, error.position)
    throw error
  }
}

function place(chart: ChartData, row: number, side: Side, items: Planned[], cells: number): RowCell[] {
  const width = chart.width
  const order = Array.from({ length: width }, (_, i) => (readsLeftward(side) ? width - i : i + 1))
  const existing = chart.stitch[row - 1]
  const colours = chart.colour[row - 1]
  const first = Math.max(0, order.findIndex((col) => existing[col - 1] !== 'ns'))
  const start = first + cells > width ? width - cells : first
  const result: RowCell[] = Array.from({ length: width }, (_, i) => ({ stitch: 'ns', colour: colours[i] }))
  let at = start
  for (const item of items) {
    for (let n = 0; n < Number(item.count); n++) {
      for (let k = 0; k < item.cells; k++) {
        const col = order[at++]
        result[col - 1] = { stitch: item.key, colour: item.colour ?? colours[col - 1] }
      }
    }
  }
  return result
}
