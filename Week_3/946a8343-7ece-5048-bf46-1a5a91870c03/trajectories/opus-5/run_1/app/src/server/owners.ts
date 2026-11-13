import { eligibleGroupMembers } from './access';
import { Sql } from './db';
import { globMatch } from './glob';

export const ownersPath = '.spurline/OWNERS';

export type OwnersSection = {
  name: string;
  count: number;
  optional: boolean;
  owners: string[];
  matched: boolean;
};

export type OwnersProblem = { line: number; reason: string };

type RawLine = { glob: string; owners: string[]; line: number };

type RawSection = { name: string; count: number; optional: boolean; lines: RawLine[] };

export async function readOwners(
  sql: Sql,
  content: string | null,
  changedFiles: string[],
): Promise<{ sections: OwnersSection[]; problems: OwnersProblem[] }> {
  const problems: OwnersProblem[] = [];
  if (content === null) return { sections: [], problems };
  const sections: RawSection[] = [{ name: 'Owners', count: 1, optional: false, lines: [] }];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = index + 1;
    const text = raw.trim();
    if (text === '' || text.startsWith('#')) continue;
    if (text.startsWith('[') || text.startsWith('^[')) {
      const optional = text.startsWith('^');
      const body = optional ? text.slice(1) : text;
      const header = /^\[([^\]]+)\](?:\[([^\]]*)\])?$/.exec(body);
      if (header === null) {
        problems.push({ line, reason: 'bad section header' });
        continue;
      }
      let count = 1;
      if (header[2] !== undefined) {
        const parsed = Number(header[2]);
        if (!Number.isInteger(parsed) || parsed < 0) {
          problems.push({ line, reason: 'bad count' });
          continue;
        }
        count = parsed;
      }
      sections.push({ name: header[1], count, optional, lines: [] });
      continue;
    }
    const parts = text.split(/\s+/);
    const glob = parts[0];
    const owners = parts.slice(1);
    if (owners.length === 0) {
      problems.push({ line, reason: 'no owners' });
      continue;
    }
    const resolved: string[] = [];
    let bad = false;
    for (const owner of owners) {
      if (!owner.startsWith('@')) {
        problems.push({ line, reason: `unknown user ${owner}` });
        bad = true;
        break;
      }
      const name = owner.slice(1);
      if (name.includes('/')) {
        const members = await eligibleGroupMembers(sql, name);
        const group = await sql.one<{ id: number }>('select id from groups where path = $1', [name]);
        if (group === null) {
          problems.push({ line, reason: `unknown group @${name}` });
          bad = true;
          break;
        }
        resolved.push(...members);
        continue;
      }
      const user = await sql.one<{ id: number }>('select id from users where username = $1', [name]);
      if (user === null) {
        problems.push({ line, reason: `unknown user @${name}` });
        bad = true;
        break;
      }
      resolved.push(name);
    }
    if (bad) continue;
    const section = sections[sections.length - 1];
    section.lines.push({ glob, owners: resolved, line });
  }

  const out: OwnersSection[] = [];
  for (const section of sections) {
    if (section.lines.length === 0) continue;
    const owners = new Set<string>();
    let matched = false;
    for (const file of changedFiles) {
      const winner = [...section.lines].reverse().find((item) => globMatch(item.glob, file));
      if (winner === undefined) continue;
      matched = true;
      for (const owner of winner.owners) owners.add(owner);
    }
    if (!matched) continue;
    out.push({
      name: section.name,
      count: section.optional ? 0 : section.count,
      optional: section.optional,
      owners: [...owners],
      matched,
    });
  }
  return { sections: out, problems };
}
