import { randomUUID } from 'node:crypto';
import { analyseChart, topRowStitches } from '../../src/domain/rows';
import { NO_STITCH } from '../../src/domain/symbols';
import type { Chart, ColourDef, Craft, Mode, RepeatBox, Terms } from '../../src/domain/types';
import { createUser, hashPassword, newToken, userByEmail } from '../auth';
import { colourLimits, today } from '../config';
import { one, query } from '../db';
import { notFound, type Router } from '../http';
import { setHold } from '../live';
import { invitationMail, sendMail } from '../mail';
import { chartSnapshot, getPattern } from '../patterns';
import { counterSet } from '../valkey';

interface SetupUser {
  email: string;
  name?: string;
  password?: string;
  verified?: boolean;
}

interface SetupVersion {
  note?: string;
  rows?: Record<string, string>;
  colourRows?: Record<string, string>;
  height?: number;
  width?: number;
  castOn?: number;
  repeats?: RepeatBox[];
  colours?: ColourDef[];
}

interface SetupTester {
  email: string;
  version?: number;
  row?: number;
  notes?: { row: number; text: string }[];
}

interface SetupInvite {
  email: string;
  sentHoursAgo?: number;
  status?: string;
}

interface SetupPattern {
  key: string;
  owner: string;
  name: string;
  craft?: Craft;
  mode?: Mode;
  terms?: Terms;
  castOn?: number;
  width?: number;
  height?: number;
  rows?: Record<string, string>;
  colours?: ColourDef[];
  colourRows?: Record<string, string>;
  repeats?: RepeatBox[];
  coDesigners?: string[];
  versions?: SetupVersion[];
  published?: boolean;
  testers?: SetupTester[];
  invites?: SetupInvite[];
}

const DEFAULT_COLOUR: ColourDef = { letter: 'A', name: 'Main', hex: '#f1f4fa' };
const CONTRAST_COLOUR: ColourDef = { letter: 'B', name: 'Contrast', hex: '#aebfd8' };

function colourKey(given: ColourDef[] | undefined, colourRows: Record<string, string>): ColourDef[] {
  const colours = given && given.length > 0 ? [...given] : [DEFAULT_COLOUR];
  const letters = new Set(colours.map((colour) => colour.letter));
  for (const line of Object.values(colourRows)) {
    for (const letter of line.split(/\s+/).filter(Boolean)) {
      if (letters.has(letter)) continue;
      letters.add(letter);
      colours.push(
        letter === 'B' ? CONTRAST_COLOUR : { letter, name: `Colour ${letter}`, hex: '#d8dfec' },
      );
    }
  }
  return colours.sort((a, b) => a.letter.localeCompare(b.letter));
}

interface PlainCell {
  row: number;
  col: number;
  stitch: string;
  colour: string;
  repeat: string | null;
}

function buildCells(
  width: number,
  height: number,
  rows: Record<string, string>,
  colourRows: Record<string, string>,
  repeats: RepeatBox[],
): PlainCell[] {
  const cells: PlainCell[] = [];
  for (let row = 1; row <= height; row += 1) {
    const stitches = (rows[String(row)] ?? '').split(/\s+/).filter(Boolean);
    const colours = (colourRows[String(row)] ?? '').split(/\s+/).filter(Boolean);
    for (let col = 1; col <= width; col += 1) {
      const box = repeats.find(
        (entry) =>
          row >= entry.fromRow && row <= entry.toRow && col >= entry.fromCol && col <= entry.toCol,
      );
      cells.push({
        row,
        col,
        stitch: stitches[col - 1] ?? NO_STITCH,
        colour: colours[col - 1] ?? 'A',
        repeat: box ? box.id : null,
      });
    }
  }
  return cells;
}

async function insertCells(patternId: string, cells: PlainCell[], editor: string): Promise<void> {
  const chunk = 1000;
  for (let start = 0; start < cells.length; start += chunk) {
    const slice = cells.slice(start, start + chunk);
    const values: unknown[] = [];
    const tuples = slice.map((cell, position) => {
      const base = position * 7 + 1;
      values.push(patternId, cell.row, cell.col, cell.stitch, cell.colour, cell.repeat, editor);
      return `($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });
    await query(
      `insert into cells (pattern_id, row, col, stitch, colour, repeat_id, last_editor)
       values ${tuples.join(', ')}`,
      values,
    );
  }
}

export function registerGradingRoutes(router: Router): void {
  const guard = (key: string | string[] | undefined): void => {
    const given = Array.isArray(key) ? key[0] : key;
    const expected = process.env.GRADING_KEY ?? '';
    if (expected === '' || given !== expected) throw notFound();
  };

  router.post('/api/grading/setup', async (ctx) => {
    guard(ctx.headers['x-grading-key']);
    const body = ctx.body as { users?: SetupUser[]; patterns?: SetupPattern[] };
    const userIds: Record<string, string> = {};
    const patternIds: Record<string, string> = {};

    for (const entry of body.users ?? []) {
      const existing = await userByEmail(entry.email);
      const name = entry.name ?? entry.email;
      const password = entry.password ?? 'twinrow-password';
      const verified = entry.verified !== false;
      if (existing) {
        await query('update users set name = $2, password_hash = $3, verified = $4 where id = $1', [
          existing.id,
          name,
          hashPassword(password),
          verified,
        ]);
        userIds[entry.email] = existing.id;
      } else {
        const made = await createUser(name, entry.email, password, verified);
        userIds[entry.email] = made.id;
      }
    }

    const idFor = async (email: string): Promise<string> => {
      if (userIds[email]) return userIds[email];
      const found = await userByEmail(email);
      if (found) {
        userIds[email] = found.id;
        return found.id;
      }
      const made = await createUser(email, email, 'twinrow-password', true);
      userIds[email] = made.id;
      return made.id;
    };

    for (const spec of body.patterns ?? []) {
      const ownerId = await idFor(spec.owner);
      const craft: Craft = spec.craft ?? 'knit';
      const mode: Mode = spec.mode ?? 'flat';
      const terms: Terms = spec.terms ?? (craft === 'crochet' ? 'us' : null);
      const width = spec.width ?? 24;
      const height = spec.height ?? 24;
      const castOn = spec.castOn ?? width;
      const repeats = spec.repeats ?? [];
      const colours = colourKey(spec.colours, spec.colourRows ?? {});
      const patternId = randomUUID();

      await query(
        `insert into patterns (id, owner_id, name, craft, mode, terms, cast_on, width, height)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [patternId, ownerId, spec.name, craft, mode, terms, castOn, width, height],
      );
      for (const colour of colours) {
        await query('insert into colours (pattern_id, letter, name, hex) values ($1, $2, $3, $4)', [
          patternId,
          colour.letter,
          colour.name,
          colour.hex,
        ]);
      }
      for (const box of repeats) {
        await query(
          `insert into repeats (pattern_id, id, from_col, to_col, from_row, to_row, times)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [patternId, box.id, box.fromCol, box.toCol, box.fromRow, box.toRow, box.times],
        );
      }
      await insertCells(
        patternId,
        buildCells(width, height, spec.rows ?? {}, spec.colourRows ?? {}, repeats),
        ownerId,
      );
      for (const email of spec.coDesigners ?? []) {
        await query(
          'insert into pattern_co_designers (pattern_id, user_id) values ($1, $2) on conflict do nothing',
          [patternId, await idFor(email)],
        );
      }

      let version = 0;
      for (const snapshot of spec.versions ?? []) {
        version += 1;
        const versionWidth = snapshot.width ?? width;
        const versionHeight = snapshot.height ?? height;
        const versionRepeats = snapshot.repeats ?? [];
        const versionColours = colourKey(snapshot.colours ?? colours, snapshot.colourRows ?? {});
        const chart: Chart = {
          craft,
          mode,
          terms,
          castOn: snapshot.castOn ?? castOn,
          width: versionWidth,
          height: versionHeight,
          colours: versionColours,
          repeats: versionRepeats,
          cells: buildCells(
            versionWidth,
            versionHeight,
            snapshot.rows ?? {},
            snapshot.colourRows ?? {},
            versionRepeats,
          ).map((cell) => ({ ...cell, rev: 0 })),
        };
        await query(
          `insert into versions (pattern_id, version, note, saved_on, stitches, snapshot)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            patternId,
            version,
            snapshot.note ?? '',
            today(),
            topRowStitches(analyseChart(chart, colourLimits)),
            JSON.stringify(chartSnapshot(chart)),
          ],
        );
      }

      if (spec.published && version > 0) {
        await query(`update patterns set state = 'published', published_version = $2 where id = $1`, [
          patternId,
          version,
        ]);
      }

      for (const tester of spec.testers ?? []) {
        const testerId = await idFor(tester.email);
        const followed = tester.version ?? version;
        const row = tester.row ?? 1;
        await query(
          `insert into testers (id, pattern_id, email, user_id, status, token, version, row, accepted_at)
           values ($1, $2, $3, $4, 'accepted', $5, $6, $7, now())`,
          [randomUUID(), patternId, tester.email, testerId, newToken(), followed, row],
        );
        await counterSet(patternId, testerId, row);
        for (const note of tester.notes ?? []) {
          await query(
            'insert into notes (id, pattern_id, user_id, row, text, version) values ($1, $2, $3, $4, $5, $6)',
            [randomUUID(), patternId, testerId, note.row, note.text, followed],
          );
        }
      }

      for (const invite of spec.invites ?? []) {
        const token = newToken();
        const sentAt = new Date(Date.now() - (invite.sentHoursAgo ?? 0) * 3_600_000);
        const account = await userByEmail(invite.email);
        const accepted = invite.status === 'accepted';
        await query(
          `insert into testers (id, pattern_id, email, user_id, status, token, sent_at, version, row, accepted_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)`,
          [
            randomUUID(),
            patternId,
            invite.email,
            accepted ? account?.id ?? null : account?.id ?? null,
            accepted ? 'accepted' : 'sent',
            token,
            sentAt,
            version > 0 ? version : null,
            accepted ? sentAt : null,
          ],
        );
        const mail = invitationMail(spec.name, token);
        try {
          await sendMail(invite.email, mail.subject, mail.body, sentAt);
        } catch {
          // Setup carries on when mail cannot be sent.
        }
      }

      patternIds[spec.key] = patternId;
    }

    return { users: userIds, patterns: patternIds };
  });

  router.post('/api/grading/patterns/:id/hold-updates', async (ctx) => {
    guard(ctx.headers['x-grading-key']);
    const pattern = await getPattern(ctx.params.id);
    if (!pattern) throw notFound();
    const email = typeof ctx.body.email === 'string' ? ctx.body.email : '';
    const hold = ctx.body.hold === true;
    const person = await one<{ id: string }>('select id from users where lower(email) = lower($1)', [
      email,
    ]);
    if (!person) throw notFound();
    setHold(pattern.id, person.id, hold);
    return { held: hold };
  });
}
