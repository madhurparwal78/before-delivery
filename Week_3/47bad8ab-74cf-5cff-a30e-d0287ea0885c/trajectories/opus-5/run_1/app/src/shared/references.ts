import type { Direction } from './grid';

export interface ClueRef {
  number: number;
  direction: Direction;
}

export interface ClueEntry extends ClueRef {
  text: string;
}

export interface ReferenceHit extends ClueRef {
  /** Where the reference starts in the clue text, for left-to-right reporting. */
  index: number;
}

const GROUP = /(\d+)((?:(?:, and |, | and )\d+)*)-(Across|Down)/g;
const STARRED_PHRASE = 'starred clues';

/** Every clue number a clue's text refers to, with the position of each reference. */
export function findReferences(text: string): ReferenceHit[] {
  const hits: ReferenceHit[] = [];
  GROUP.lastIndex = 0;
  let match = GROUP.exec(text);
  while (match !== null) {
    const before = match.index === 0 ? '' : text[match.index - 1];
    if (!/[A-Za-z0-9]/.test(before)) {
      const direction: Direction = match[3] === 'Across' ? 'across' : 'down';
      const numbers = [match[1], ...(match[2].match(/\d+/g) ?? [])];
      for (const raw of numbers) {
        hits.push({ number: Number(raw), direction, index: match.index });
      }
    }
    match = GROUP.exec(text);
  }
  return hits;
}

export function isStarred(text: string): boolean {
  return text.startsWith('*');
}

/** Where `starred clues` appears in the text, or -1. */
export function starredReferenceIndex(text: string): number {
  return text.indexOf(STARRED_PHRASE);
}

export function clueOrderKey(ref: ClueRef): number {
  return (ref.direction === 'across' ? 0 : 1) * 1e6 + ref.number;
}

function sameRef(a: ClueRef, b: ClueRef): boolean {
  return a.number === b.number && a.direction === b.direction;
}

/** The clues one clue points at: its references plus the starred clues, itself apart. */
function targetsOf(clue: ClueEntry, clues: ClueEntry[]): ClueRef[] {
  const targets: ClueRef[] = [];
  const add = (ref: ClueRef): void => {
    if (sameRef(ref, clue)) return;
    if (!clues.some((c) => sameRef(c, ref))) return;
    if (!targets.some((t) => sameRef(t, ref))) targets.push(ref);
  };
  for (const hit of findReferences(clue.text)) add({ number: hit.number, direction: hit.direction });
  if (starredReferenceIndex(clue.text) >= 0) {
    for (const other of clues) {
      if (isStarred(other.text)) add({ number: other.number, direction: other.direction });
    }
  }
  return targets;
}

/**
 * A clue's linked clues: the clues it refers to together with the clues that refer
 * to it, without repeats and without itself, in clue order.
 */
export function computeLinks(clues: ClueEntry[]): Map<string, ClueRef[]> {
  const key = (ref: ClueRef): string => `${ref.direction}:${ref.number}`;
  const links = new Map<string, ClueRef[]>();
  for (const clue of clues) links.set(key(clue), []);
  const push = (from: ClueRef, to: ClueRef): void => {
    const list = links.get(key(from));
    if (list && !list.some((l) => sameRef(l, to))) list.push(to);
  };
  for (const clue of clues) {
    const self: ClueRef = { number: clue.number, direction: clue.direction };
    for (const target of targetsOf(clue, clues)) {
      push(self, { number: target.number, direction: target.direction });
      push(target, self);
    }
  }
  for (const list of links.values()) list.sort((a, b) => clueOrderKey(a) - clueOrderKey(b));
  return links;
}
