// The Cupfold roster format: the one place a roster file is parsed and checked.
const MAX_ENTRANTS = 128;
const MAX_NAME = 40;
const MAX_ERRORS = 20;

interface RosterEntry { seed: number; name: string; username: string | null }
type RosterResult = { entries: RosterEntry[] } | { errors: string[] };

interface Line { number: number; seedText: string | null; name: string; username: string | null }

function lines(text: string): Line[] {
  const found: Line[] = [];
  text.replace(/^﻿/, '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    let rest = line;
    let seedText: string | null = null;
    const bar = rest.indexOf('|');
    if (bar >= 0) {
      seedText = rest.slice(0, bar).trim();
      rest = rest.slice(bar + 1).trim();
    }
    const tagged = / @(\w+)$/.exec(rest);
    found.push({ number: index + 1, seedText, name: (tagged ? rest.slice(0, tagged.index) : rest).trim(),
      username: tagged ? (tagged[1] as string).toLowerCase() : null });
  });
  return found;
}

export const usernamesIn = (text: string): string[] =>
  lines(text).flatMap((line) => (line.username ? [line.username] : []));

export function parseRoster(text: string, accounts: ReadonlySet<string>): RosterResult {
  const all = lines(text);
  if (all.length < 2 || all.length > MAX_ENTRANTS) {
    return { errors: [`The roster has ${all.length} entrants. A roster needs 2 to ${MAX_ENTRANTS}.`] };
  }
  const errors: string[] = [];
  const seeds = new Map<number, number>();
  const names = new Map<string, { spelling: string; line: number }>();
  const usernames = new Map<string, number>();
  const entries: Array<{ line: Line; seed: number | null }> = [];
  for (const line of all) {
    const problem = ((): string | null => {
      let seed: number | null = null;
      if (line.seedText !== null) {
        seed = /^\d+$/.test(line.seedText) ? Number(line.seedText) : 0;
        if (seed < 1 || seed > MAX_ENTRANTS) return 'seed must be a whole number from 1 to 128';
        if (seed > all.length) return `seed ${seed} is larger than the number of entrants (${all.length})`;
        const used = seeds.get(seed);
        if (used !== undefined) return `seed ${seed} is already used on line ${used}`;
        seeds.set(seed, line.number);
      }
      entries.push({ line, seed });
      if (line.name === '') return 'name is empty';
      if ([...line.name].length > MAX_NAME) return `name is longer than ${MAX_NAME} characters`;
      const first = names.get(line.name.toLowerCase());
      if (first) return `duplicate name "${first.spelling}" (first on line ${first.line})`;
      names.set(line.name.toLowerCase(), { spelling: line.name, line: line.number });
      if (line.username !== null) {
        if (!accounts.has(line.username)) return `no account named @${line.username}`;
        const earlier = usernames.get(line.username);
        if (earlier !== undefined) return `@${line.username} is already on line ${earlier}`;
        usernames.set(line.username, line.number);
      }
      return null;
    })();
    if (problem) errors.push(`Line ${line.number}: ${problem}`);
  }
  if (errors.length) return { errors: errors.slice(0, MAX_ERRORS) };
  // Seeded lines keep their seed; the others take the remaining numbers in file order.
  const free = Array.from({ length: all.length }, (_, i) => i + 1).filter((n) => !seeds.has(n));
  return {
    entries: entries.map(({ line, seed }) => ({ seed: seed ?? (free.shift() as number), name: line.name,
      username: line.username })).sort((a, b) => a.seed - b.seed),
  };
}
