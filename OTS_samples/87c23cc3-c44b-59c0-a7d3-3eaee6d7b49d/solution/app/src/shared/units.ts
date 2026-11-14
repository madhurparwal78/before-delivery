const START_UNIT = 'the start of the text'

interface Unit {
  name: string
  text: string
}

const UNIT_START = /^(entity|choice|group) /
const UNIT_NAME = /^(entity|choice|group) +("[^"]*"|[A-Za-z0-9_]+)/

function unitName(line: string): string {
  const found = UNIT_NAME.exec(line)
  if (!found) return `${line.split(' ')[0]} `
  const kind = found[1] as string
  const raw = found[2] as string
  if (kind === 'group') return `group "${raw.replace(/^"|"$/g, '')}"`
  return `${kind} ${raw.replace(/^"|"$/g, '')}`
}

function splitLines(text: string): string[] {
  const lines: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charAt(i) === '\n') {
      lines.push(text.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < text.length) lines.push(text.slice(start))
  return lines
}

/** A unit starts at every line that begins with `entity `, `choice ` or `group `; earlier lines form the start unit. */
export function splitUnits(text: string): Unit[] {
  const units: Unit[] = []
  const seen = new Map<string, number>()
  let current: Unit | null = null
  for (const line of splitLines(text)) {
    if (UNIT_START.test(line)) {
      const base = unitName(line)
      const count = (seen.get(base) ?? 0) + 1
      seen.set(base, count)
      current = { name: count === 1 ? base : `${base} (${count})`, text: '' }
      units.push(current)
    } else if (!current) {
      current = { name: START_UNIT, text: '' }
      units.push(current)
    }
    current.text += line
  }
  return units
}

function joinUnits(units: Unit[]): string {
  return units
    .map((unit, i) => (i < units.length - 1 && !unit.text.endsWith('\n') ? `${unit.text}\n` : unit.text))
    .join('')
}

function changedUnits(from: Unit[], to: Unit[]): Set<string> {
  const before = new Map(from.map((unit) => [unit.name, unit.text]))
  const after = new Map(to.map((unit) => [unit.name, unit.text]))
  const changed = new Set<string>()
  for (const [name, text] of before) if (after.get(name) !== text) changed.add(name)
  for (const name of after.keys()) if (!before.has(name)) changed.add(name)
  return changed
}

type MergeResult = { conflict: null; text: string } | { conflict: string; text: null }

/** Applies the sender's changes (base to sent) onto the current text, or names the first unit both sides changed. */
export function mergeEdit(base: string, sent: string, current: string): MergeResult {
  const baseUnits = splitUnits(base)
  const sentUnits = splitUnits(sent)
  const currentUnits = splitUnits(current)
  const mine = changedUnits(baseUnits, sentUnits)
  const theirs = changedUnits(baseUnits, currentUnits)
  const order = [...currentUnits.map((unit) => unit.name), ...baseUnits.map((unit) => unit.name)]
  const shared = order.find((name) => mine.has(name) && theirs.has(name))
  if (shared !== undefined) return { conflict: shared, text: null }

  const sentByName = new Map(sentUnits.map((unit) => [unit.name, unit]))
  const baseNames = new Set(baseUnits.map((unit) => unit.name))
  const result: Unit[] = []
  for (const unit of currentUnits) {
    if (!mine.has(unit.name)) result.push(unit)
    else {
      const replacement = sentByName.get(unit.name)
      if (replacement) result.push(replacement)
    }
  }
  sentUnits.forEach((unit, i) => {
    if (baseNames.has(unit.name)) return
    const before = sentUnits[i - 1]
    if (!before) {
      result.unshift(unit)
      return
    }
    const at = result.findIndex((candidate) => candidate.name === before.name)
    if (at === -1) result.push(unit)
    else result.splice(at + 1, 0, unit)
  })
  return { conflict: null, text: joinUnits(result) }
}
