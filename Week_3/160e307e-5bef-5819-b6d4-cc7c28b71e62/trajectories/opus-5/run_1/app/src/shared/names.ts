export const NAME_BLOCKLIST = ['admin', 'referee', 'duecoin', 'tamarind', 'moderator'];
export const NAME_MIN = 3;
export const NAME_MAX = 16;
const NAME_PATTERN = /^[A-Za-z0-9_]+$/;

export type NameProblem = 'NAME_INVALID' | 'NAME_BLOCKED' | null;

export function nameShapeProblem(name: string): NameProblem {
  if (name.length < NAME_MIN || name.length > NAME_MAX) return 'NAME_INVALID';
  if (!NAME_PATTERN.test(name)) return 'NAME_INVALID';
  if (NAME_BLOCKLIST.some((word) => name.toLowerCase().includes(word))) return 'NAME_BLOCKED';
  return null;
}

/** Suggestions run `<base>_01` to `<base>_99` in increasing order. */
export function suggestionCandidates(name: string, blocked: boolean): string[] {
  const base = blocked ? 'Player' : name.slice(0, 13);
  const candidates: string[] = [];
  for (let n = 1; n <= 99; n += 1) {
    candidates.push(`${base}_${String(n).padStart(2, '0')}`);
  }
  return candidates;
}

export function guestName(digits: string): string {
  return `Guest-${digits}`;
}
