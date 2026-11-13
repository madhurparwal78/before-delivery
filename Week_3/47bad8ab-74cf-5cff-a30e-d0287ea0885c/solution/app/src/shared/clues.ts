import { type Direction, directionName } from './numbering.ts'

export interface ClueRef {
  number: number
  direction: Direction
}

export interface ClueText extends ClueRef {
  text: string
}

const STAR_PHRASE = 'starred clues'

const REFERENCE_GROUP = /(?<![A-Za-z0-9])(\d+(?:(?:, and | and |, )\d+)*)-(Across|Down)/g

export function isStarred(text: string): boolean {
  return text.startsWith('*')
}

function refersToStarred(text: string): boolean {
  return text.includes(STAR_PHRASE)
}

interface NamedReference extends ClueRef {
  at: number
}

/** Every clue the text names by number, left to right, with where in the text its number starts. */
function numberedReferences(text: string): NamedReference[] {
  const found: NamedReference[] = []
  for (const match of text.matchAll(REFERENCE_GROUP)) {
    const direction: Direction = match[2] === 'Across' ? 'across' : 'down'
    let at = match.index
    for (const digits of match[1].split(/, and | and |, /)) {
      found.push({ number: Number(digits), direction, at })
      at += digits.length
    }
  }
  return found
}

const same = (a: ClueRef, b: ClueRef): boolean => a.number === b.number && a.direction === b.direction

/** The clues a clue refers to that exist in the grid, without itself, in clue order. */
function outgoingLinks(clue: ClueText, clues: readonly ClueText[]): ClueRef[] {
  const named = numberedReferences(clue.text)
  const starred = refersToStarred(clue.text) ? clues.filter((other) => isStarred(other.text)) : []
  return clues.filter((other) => !same(other, clue) && (named.some((ref) => same(ref, other)) || starred.includes(other)))
}

/** A clue's linked clues: the clues it refers to together with the clues that refer to it. */
export function linkedClues(clues: readonly ClueText[]): Map<ClueText, ClueRef[]> {
  const outgoing = new Map(clues.map((clue) => [clue, outgoingLinks(clue, clues)]))
  return new Map(
    clues.map((clue) => [
      clue,
      clues
        .filter((other) => !same(other, clue) && (outgoing.get(clue)?.some((ref) => same(ref, other)) || outgoing.get(other)?.some((ref) => same(ref, clue))))
        .map(({ number, direction }) => ({ number, direction })),
    ]),
  )
}

/** The first bad reference of a clue, reading left to right, as the sentence tail both the upload and the builder show. */
export function badReference(text: string, exists: (ref: ClueRef) => boolean, anyStarred: boolean): string | null {
  const found: { at: number; problem: string }[] = numberedReferences(text)
    .filter((ref) => !exists(ref))
    .map((ref) => ({ at: ref.at, problem: `${ref.number} ${directionName(ref.direction)}, which is not in the grid` }))
  const starAt = text.indexOf(STAR_PHRASE)
  if (starAt >= 0 && !anyStarred) found.push({ at: starAt, problem: 'starred clues, but no clue is starred' })
  found.sort((a, b) => a.at - b.at)
  return found[0]?.problem ?? null
}
