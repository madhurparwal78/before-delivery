import { ROSTER_ERRORS } from '../../shared/copy';

export interface RosterLine {
  line: number;
  seedText: string | null;
  name: string;
  username: string | null;
}

export interface RosterEntrant {
  name: string;
  username: string | null;
  seed: number;
}

const MAX_ERRORS = 20;

export const decodeRoster = (bytes: Buffer): string | null => {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return null;
  }
};

/** Every physical line counts for numbering; blank and # lines are ignored. */
export const rosterLines = (text: string): RosterLine[] => {
  const lines: RosterLine[] = [];
  const physical = text.split('\n');
  for (let index = 0; index < physical.length; index += 1) {
    const raw = (physical[index] as string).replace(/\r$/, '');
    if (index === physical.length - 1 && raw === '') continue;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    let rest = trimmed;
    let seedText: string | null = null;
    const bar = rest.indexOf('|');
    if (bar !== -1) {
      seedText = rest.slice(0, bar).trim();
      rest = rest.slice(bar + 1).trim();
    }
    let username: string | null = null;
    const account = /\s@(\S+)$/.exec(rest);
    if (account?.[1] !== undefined) {
      username = account[1].toLowerCase();
      rest = rest.slice(0, account.index);
    }
    lines.push({ line: index + 1, seedText, name: rest.trim(), username });
  }
  return lines;
};

export const rosterUsernames = (text: string): string[] =>
  [...new Set(rosterLines(text).map((line) => line.username).filter((name): name is string => name !== null))];

export type RosterResult = { ok: true; entrants: RosterEntrant[] } | { ok: false; errors: string[] };

/** The published roster checks, in the published order, first failing check per line only. */
export const parseRoster = (text: string, knownUsernames: Set<string>): RosterResult => {
  const lines = rosterLines(text);
  if (lines.length < 2 || lines.length > 128) {
    return { ok: false, errors: [ROSTER_ERRORS.count(lines.length)] };
  }

  const errors: string[] = [];
  const seedLines = new Map<number, number>();
  const nameLines = new Map<string, { line: number; spelling: string }>();
  const accountLines = new Map<string, number>();
  const accepted: { name: string; username: string | null; seed: number | null }[] = [];

  for (const entry of lines) {
    const fail = (message: string): void => {
      if (errors.length < MAX_ERRORS) errors.push(message);
    };
    let seed: number | null = null;

    if (entry.seedText !== null) {
      if (!/^\d+$/.test(entry.seedText)) {
        fail(ROSTER_ERRORS.seedNotNumber(entry.line));
        continue;
      }
      seed = Number(entry.seedText);
      if (seed < 1 || seed > 128) {
        fail(ROSTER_ERRORS.seedNotNumber(entry.line));
        continue;
      }
      if (seed > lines.length) {
        fail(ROSTER_ERRORS.seedTooLarge(entry.line, seed, lines.length));
        continue;
      }
      const earlier = seedLines.get(seed);
      if (earlier !== undefined) {
        fail(ROSTER_ERRORS.seedUsed(entry.line, seed, earlier));
        continue;
      }
    }

    if (entry.name === '') {
      fail(ROSTER_ERRORS.nameEmpty(entry.line));
      continue;
    }
    if ([...entry.name].length > 40) {
      fail(ROSTER_ERRORS.nameLong(entry.line));
      continue;
    }
    const earlierName = nameLines.get(entry.name.toLowerCase());
    if (earlierName !== undefined) {
      fail(ROSTER_ERRORS.duplicateName(entry.line, earlierName.spelling, earlierName.line));
      continue;
    }
    if (entry.username !== null) {
      if (!knownUsernames.has(entry.username)) {
        fail(ROSTER_ERRORS.noAccount(entry.line, entry.username));
        continue;
      }
      const earlierAccount = accountLines.get(entry.username);
      if (earlierAccount !== undefined) {
        fail(ROSTER_ERRORS.accountUsed(entry.line, entry.username, earlierAccount));
        continue;
      }
    }

    if (seed !== null) seedLines.set(seed, entry.line);
    nameLines.set(entry.name.toLowerCase(), { line: entry.line, spelling: entry.name });
    if (entry.username !== null) accountLines.set(entry.username, entry.line);
    accepted.push({ name: entry.name, username: entry.username, seed });
  }

  if (errors.length > 0) return { ok: false, errors };

  const taken = new Set(accepted.map((entry) => entry.seed).filter((seed): seed is number => seed !== null));
  const free: number[] = [];
  for (let seed = 1; seed <= accepted.length; seed += 1) {
    if (!taken.has(seed)) free.push(seed);
  }
  const entrants: RosterEntrant[] = accepted.map((entry) => ({
    name: entry.name,
    username: entry.username,
    seed: entry.seed ?? (free.shift() as number),
  }));
  entrants.sort((a, b) => a.seed - b.seed);
  return { ok: true, entrants };
};
