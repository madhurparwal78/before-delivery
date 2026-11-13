import crypto from 'node:crypto';
import { pool, verifyPassword, hashPassword } from './db.js';
import { route, personJson, type Ctx } from './api.js';
import { withClient } from './api.js';
import { SESSION_COOKIE, cookieOpts } from './session.js';
import { HttpError, notFound } from './errors.js';
import { serverDate } from './time.js';
import { emitFor } from './events.js';
import { writeLedgerEntry } from './ledger.js';
import { adminCapTable, holderCapTable, boardCapTable } from './capTable.js';
import {
  personById, poolFigures, fullyDilutedTotal, sumExercised, sumOpenOrders,
  holdingsByHolder, type PersonRec,
} from './register.js';
import { latestVestedMark } from './vesting.js';
import { readGrants } from './grantReader.js';

const ROLES: Array<'option_holder' | 'investor' | 'board_member'> = ['option_holder', 'investor', 'board_member'];

function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

route('GET', '/api/health', 'anyone', () => ({ status: 'ok' }));

route('GET', '/api/masthead', 'anyone', async () => {
  const total = await withClient(async (c) => fullyDilutedTotal(c));
  return { company: 'Tidecraft Robotics', fully_diluted_total: total };
});

route('POST', '/api/session', 'anyone', async (ctx: Ctx) => {
  const b = body(ctx);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const r = await pool.query('SELECT * FROM people WHERE lower(email) = $1', [email]);
  const row = r.rows[0] as (PersonRec & { password_hash: string }) | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new HttpError(401, 'invalid_credentials', "That email and password don't match a Tidecraft register account.");
  }
  if (row.access === 'removed') {
    throw new HttpError(401, 'access_removed', 'Your access to the Tidecraft register has ended.');
  }
  if (row.access !== 'active') {
    throw new HttpError(401, 'invalid_credentials', "That email and password don't match a Tidecraft register account.");
  }
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token, person_id) VALUES ($1,$2)', [token, row.id]);
  ctx.res.cookie(SESSION_COOKIE, token, cookieOpts());
  return { person: personJson(row) };
});

route('DELETE', '/api/session', 'signed-in', async (ctx: Ctx) => {
  const token = (ctx.req.cookies as Record<string, string>)[SESSION_COOKIE];
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  ctx.res.clearCookie(SESSION_COOKIE, cookieOpts());
  ctx.res.status(204).end();
  return undefined;
});

route('GET', '/api/me', 'signed-in', async (ctx: Ctx) => {
  const p = await withClient((c) => personById(c, ctx.person.id));
  if (!p) throw notFound();
  const at = new Date();
  return {
    person: personJson(p),
    server_time: at.toISOString(),
    server_date: serverDate(at),
    time_zone: 'America/Los_Angeles',
  };
});

route('GET', '/api/portal', 'signed-in', async (ctx: Ctx) => {
  const at = new Date();
  const dateStr = serverDate(at);
  const person = ctx.person;
  return withClient(async (client) => {
    const p = await personById(client, person.id);
    if (!p) throw notFound();
    if (p.role === 'option_holder' || p.role === 'leaver') {
      const grants = await readGrants(client, "g.holder_id = $1 AND g.state = 'accepted'", [person.id]);
      let vested = 0;
      let total = 0;
      let next: { date: string; cumulative: number } | null = null;
      for (const g of grants) {
        total += Number(g.options);
        const inputs = { options: Number(g.options), vestingType: g.vesting_type, vestingStart: g.vesting_start };
        const mark = latestVestedMark(inputs, dateStr);
        const v = mark < 0 ? 0 : Math.floor((Number(g.options) * mark) / 48);
        vested += v;
        if (!g.termination_date && p.role === 'option_holder') {
          for (let m = mark + 1; m <= 48 && !next; m++) {
            const cum = Math.floor((Number(g.options) * m) / 48);
            const prev = Math.floor((Number(g.options) * Math.max(mark, 0)) / 48);
            if (cum > prev) next = { date: addMonths(g.vesting_start, m), cumulative: cum };
          }
        }
      }
      if (p.role === 'leaver') {
        const exercisable = await leaverExercisable(client, person.id, at);
        return { first_name: p.first_name, exercisable, window_ends_at: p.window_ends_at?.toISOString() ?? null };
      }
      return {
        first_name: p.first_name,
        vested_today: vested,
        total_options: total,
        next_tranche_date: next?.date ?? null,
      };
    }
    if (p.role === 'investor') {
      const holdings = await holdingsByHolder(client);
      const mine = holdings.get(person.id) ?? 0;
      const total = await fullyDilutedTotal(client);
      const cap = await holderCapTable(client, person.id);
      const myRow = cap.rows.find((r) => r.key === person.id);
      const tender = await client.query(
        "SELECT id, closes_at FROM tenders WHERE state = 'open' ORDER BY created_at DESC LIMIT 1",
      );
      const t = tender.rows[0] as { id: string; closes_at: Date } | undefined;
      return {
        first_name: p.first_name,
        fully_diluted_shares: mine,
        ownership: myRow?.ownership ?? '0.00',
        open_tender: t ? { id: t.id, closes_at: new Date(t.closes_at).toISOString() } : null,
        fully_diluted_total: total,
      };
    }
    if (p.role === 'board_member') {
      const queue = await client.query(
        "SELECT g.id, NOT EXISTS (SELECT 1 FROM grant_votes v WHERE v.grant_id = g.id AND v.voter_id = $1) AS awaiting FROM grants g WHERE g.state = 'board_queue'",
        [person.id],
      );
      const board = await client.query<{ count: string }>(
        "SELECT count(*)::text FROM people WHERE role = 'board_member'",
      );
      const size = Number(board.rows[0]?.count ?? 0);
      const quorum = Math.floor(size / 2) + 1;
      return {
        first_name: p.first_name,
        awaiting_vote: queue.rows.length,
        quorum,
        board_size: size,
      };
    }
    // founder_admin
    const total = await fullyDilutedTotal(client);
    const offers = await client.query<{ count: string }>(
      "SELECT count(*)::text FROM grants WHERE state = 'approved'",
    );
    return {
      first_name: p.first_name,
      fully_diluted_total: total,
      offers_to_send: Number(offers.rows[0]?.count ?? 0),
    };
  });
});

async function leaverExercisable(client: import('pg').PoolClient, personId: string, at: Date): Promise<number> {
  const dateStr = serverDate(at);
  const grants = await readGrants(client, "g.holder_id = $1 AND g.state = 'accepted'", [personId]);
  let total = 0;
  for (const g of grants) {
    const inputs = { options: Number(g.options), vestingType: g.vesting_type, vestingStart: g.vesting_start };
    const mark = latestVestedMark(inputs, dateStr);
    const vested = mark < 0 ? 0 : Math.floor((Number(g.options) * mark) / 48);
    const exercised = await sumExercised(client, g.id);
    const open = await sumOpenOrders(client, g.id);
    total += Math.max(0, vested - exercised - Number(g.cancelled) - open);
  }
  return total;
}

function addMonths(start: string, m: number): string {
  const [y, mo, d] = start.split('-').map(Number);
  const total = y! * 12 + (mo! - 1) + m;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const dim = [31, (ny % 4 === 0 && ny % 100 !== 0) || ny % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][nm - 1]!;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(Math.min(d!, dim)).padStart(2, '0')}`;
}

route('GET', '/api/cap-table', 'signed-in', async (ctx: Ctx) => {
  return withClient(async (client) => {
    if (ctx.person.role === 'founder_admin') return adminCapTable(client);
    if (ctx.person.role === 'board_member') return boardCapTable(client);
    return holderCapTable(client, ctx.person.id);
  });
});

route('GET', '/api/ledger', ['founder_admin', 'option_holder', 'leaver', 'investor'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    const filter = ctx.person.role === 'founder_admin' ? null : ctx.person.id;
    const rows = filter
      ? await client.query('SELECT * FROM securities_ledger WHERE holder_id = $1 ORDER BY at DESC, id DESC', [filter])
      : await client.query('SELECT * FROM securities_ledger ORDER BY at DESC, id DESC');
    return {
      entries: rows.rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        at: new Date(r.at as string).toISOString(),
        holder_id: r.holder_id,
        holder_name: r.holder_name,
        kind: r.kind,
        class: r.class,
        shares_delta: Number(r.shares_delta),
        options_delta: Number(r.options_delta),
        reference: r.reference,
      })),
    };
  });
});

route('GET', '/api/pool', ['founder_admin'], async () => {
  return withClient((c) => poolFigures(c));
});

route('PATCH', '/api/pool', ['founder_admin'], async (ctx: Ctx) => {
  const b = body(ctx);
  const authorized = b.authorized;
  if (typeof authorized !== 'number' || !Number.isInteger(authorized) || authorized < 1) {
    throw new HttpError(422, 'validation', 'Some fields need attention.', { authorized: 'Enter a whole number of options from 1 upward.' });
  }
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const figures = await poolFigures(client);
      const allocated = figures.outstanding + figures.exercised + figures.reserved;
      if (authorized < allocated) {
        throw new HttpError(409, 'pool_below_allocated', `The pool can't be smaller than the ${allocated} options already allocated.`);
      }
      await client.query('UPDATE option_pool SET authorized = $1 WHERE id = 1', [authorized]);
      await writeLedgerEntry(client, {
        holder_id: null, holder_name: 'Option pool', kind: 'pool_resized', class: 'Options',
        shares_delta: 0, options_delta: authorized - figures.authorized, reference: `Pool resized to ${authorized}`,
      });
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) {
        await emitFor(client, a.id, 'pool_resized', { authorized });
      }
      await emitFor(client, 'everyone', 'cap_table_changed', {});
      await client.query('COMMIT');
      return poolFigures(client);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

route('POST', '/api/issuances', ['founder_admin'], async (ctx: Ctx) => {
  const b = body(ctx);
  const fields: Record<string, string> = {};
  const holderId = typeof b.holder_id === 'string' ? b.holder_id : '';
  const klass = typeof b.class === 'string' ? b.class : '';
  const shares = b.shares;
  const shareCount = typeof shares === 'number' && Number.isInteger(shares) ? shares : 0;
  if (!['Common', 'Series Seed Preferred', 'Series A Preferred'].includes(klass)) {
    fields.class = 'Choose Common, Series Seed Preferred or Series A Preferred.';
  }
  if (shareCount < 1) {
    fields.shares = 'Enter a whole number of shares from 1 upward.';
  }
  if (Object.keys(fields).length > 0) throw new HttpError(422, 'validation', 'Some fields need attention.', fields);
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const person = await personById(client, holderId);
      if (!person) throw notFound();
      await client.query(
        'INSERT INTO share_holdings (person_id, class, shares) VALUES ($1,$2,$3) ON CONFLICT (person_id, class) DO UPDATE SET shares = share_holdings.shares + $3',
        [holderId, klass, shareCount],
      );
      const entry = await writeLedgerEntry(client, {
        holder_id: holderId, holder_name: person.name, kind: 'issuance', class: klass,
        shares_delta: shareCount, options_delta: 0, reference: `Issuance of ${shareCount} ${klass} shares`,
      });
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'cap_table_changed', {});
      await emitFor(client, holderId, 'cap_table_changed', {});
      await client.query('COMMIT');
      return { entry: ledgerJson(entry) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

function ledgerJson(entry: {
  id: string; at: Date; holder_id: string | null; holder_name: string;
  kind: string; class: string; shares_delta: number; options_delta: number; reference: string;
}): Record<string, unknown> {
  return {
    id: entry.id,
    at: entry.at.toISOString(),
    holder_id: entry.holder_id,
    holder_name: entry.holder_name,
    kind: entry.kind,
    class: entry.class,
    shares_delta: entry.shares_delta,
    options_delta: entry.options_delta,
    reference: entry.reference,
  };
}

route('GET', '/api/people', ['founder_admin'], async () => {
  return withClient(async (client) => {
    const rows = await client.query('SELECT * FROM people ORDER BY id');
    return { people: rows.rows.map((r: Record<string, unknown>) => personJson(r as unknown as PersonRec)) };
  });
});

route('POST', '/api/people', ['founder_admin'], async (ctx: Ctx) => {
  const b = body(ctx);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const role = typeof b.role === 'string' ? b.role : '';
  const password = typeof b.password === 'string' ? b.password : '';
  const fields: Record<string, string> = {};
  if (name.length < 1) fields.name = 'Enter a name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter a valid email address.';
  if (!(ROLES as string[]).includes(role)) fields.role = 'Choose a role.';
  if (password.length < 12 || password.length > 128) fields.password = 'Enter an initial password of 12 to 128 characters.';
  if (Object.keys(fields).length > 0) throw new HttpError(422, 'validation', 'Some fields need attention.', fields);
  const existing = await pool.query('SELECT id FROM people WHERE lower(email) = $1', [email]);
  if (existing.rows.length > 0) {
    throw new HttpError(422, 'validation', 'Some fields need attention.', { email: 'That email is already on the register.' });
  }
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const next = await client.query<{ max: string | null }>(
        "SELECT max(substring(id from 5)::bigint)::text AS max FROM people WHERE id LIKE 'PER-%'",
      );
      const id = `PER-${String(Number(next.rows[0]?.max ?? 0) + 1).padStart(3, '0')}`;
      const first = name.split(/\s+/)[0]!;
      await client.query(
        'INSERT INTO people (id, name, first_name, email, password_hash, role, access) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, name, first, email, hashPassword(password), role, 'active'],
      );
      await client.query('COMMIT');
      const p = await personById(client, id);
      return { person: p ? personJson(p) : null };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});
