import { requireRole, requireSession, type Session } from '../auth.ts';
import { query, transact, type Transaction } from '../db/pool.ts';
import { FIELD_COPY } from '../../domain/copy.ts';
import { isPlanningOpen, isPublicStatus } from '../../domain/dropstate.ts';
import { COPENHAGEN_ZONE, marketCity, MARKETS, type Market } from '../../domain/markets.ts';
import { restockOccurrences } from '../../domain/restocks.ts';
import { normaliseMailName } from '../../domain/text.ts';
import {
  formatInstant,
  formatTimeOfDay,
  formatWallDate,
  parseLocalDateTime,
  resolveWall,
  weekdayLongName,
} from '../../domain/time.ts';
import type { Ctx } from '../http/context.ts';
import { conflict, notFound } from '../http/errors.ts';
import { sendEmpty, sendJson } from '../http/respond.ts';
import { email as emailField, integer, list, Problems, record, text } from '../http/validate.ts';
import { newId } from '../services/crypto.ts';
import {
  buyerDropShape,
  loadDropById,
  loadDrops,
  slugFor,
  staffDropShape,
  type DropRecord,
} from '../repo/drops.ts';
import { openingsFor, writeTiming } from '../repo/timing.ts';
import { readDropInput, readMarketValue, type DropInput } from './dropinput.ts';

export async function listDrops(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drops = await loadDrops('workspace_id = $1', [session.workspaceId], ctx.nowMs);
  if (session.role === 'stockist_buyer') {
    sendJson(ctx.response, 200, {
      items: drops.filter((drop) => isPublicStatus(drop.status)).map(buyerDropShape),
    });
    return;
  }
  sendJson(ctx.response, 200, { items: drops.map(staffDropShape) });
}

/** Loads a drop in the caller's workspace, or 404 at step 5 of the error ladder. */
export async function requireDrop(ctx: Ctx, session: Session): Promise<DropRecord> {
  const drop = await loadDropById(ctx.params['dropId'] as string, session.workspaceId, ctx.nowMs);
  if (drop === null) throw notFound();
  if (session.role === 'stockist_buyer' && !isPublicStatus(drop.status)) throw notFound();
  return drop;
}

export async function getDrop(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  sendJson(
    ctx.response,
    200,
    session.role === 'stockist_buyer' ? buyerDropShape(drop) : staffDropShape(drop),
  );
}

export async function checkDropFields(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  requireRole(session, 'launch_producer');
  const body = ctx.json();
  const problems = new Problems();
  readDropInput(body, problems, { partial: true, nowMs: ctx.nowMs });
  problems.throwIfAny();
  sendEmpty(ctx.response, 204);
}

export async function createDrop(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  requireRole(session, 'launch_producer');
  const body = ctx.json();
  const problems = new Problems();
  const input = readDropInput(body, problems, { partial: false, nowMs: ctx.nowMs });
  const status = input.status ?? 'draft';
  if (status === 'scheduled' && input.timing === undefined) {
    problems.add('goLiveAt', FIELD_COPY.required);
  }
  problems.throwIfAny();

  const dropId = await transact(async (tx) => {
    const id = newId();
    const slug = await slugFor(input.name ?? 'Drop', tx);
    await tx.query(
      `insert into drops (id, workspace_id, slug, name, type, status, hold_seconds, palette,
                          internal_note, created_at_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        session.workspaceId,
        slug,
        input.name,
        input.type ?? 'simultaneous',
        status,
        input.holdSeconds ?? 900,
        input.palette ?? ['stone', 'ink', 'vermilion'],
        input.internalNote ?? '',
        ctx.nowMs,
      ],
    );
    for (const market of MARKETS) {
      await tx.query('insert into drop_markets (drop_id, market, store_pieces) values ($1,$2,$3)', [
        id,
        market,
        input.markets?.[market] ?? 0,
      ]);
    }
    for (const [position, style] of (input.styles ?? []).entries()) {
      await tx.query(
        `insert into drop_styles (drop_id, style_number, name, colour, wholesale_edition, rrp_dkk_minor, position)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, style.styleNumber, style.name, style.colour, style.wholesaleEdition, style.rrpDkkMinor, position],
      );
    }
    await tx.query(
      `insert into look_orders (drop_id, order_version, saved_by, saved_at_ms) values ($1,1,$2,$3)`,
      [id, session.name, ctx.nowMs],
    );
    await tx.query(
      `insert into stories (drop_id, html, version, saved_by, saved_at_ms) values ($1,'',1,'',$2)`,
      [id, ctx.nowMs],
    );
    if (input.timing !== undefined) await writeTiming(tx, id, input.timing);
    return id;
  });

  const drop = await loadDropById(dropId, session.workspaceId, ctx.nowMs);
  if (drop === null) throw notFound();
  sendJson(ctx.response, 201, staffDropShape(drop));
}

export async function patchDrop(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'launch_producer');
  if (!isPlanningOpen(drop.status)) throw conflict('drop_locked');

  const body = ctx.json();
  const problems = new Problems();
  const input = readDropInput(body, problems, {
    partial: true,
    currentType: drop.type,
    nowMs: ctx.nowMs,
  });
  problems.throwIfAny();

  await transact(async (tx) => {
    await applyDropFields(tx, drop, input);
    const nextType = input.type ?? drop.type;
    if (input.timing !== undefined) {
      await writeTiming(tx, drop.id, input.timing);
    } else if (input.type !== undefined && input.type !== drop.type) {
      await writeTiming(tx, drop.id, {
        type: nextType,
        goLiveAtMs: null,
        copenhagenGoLive: null,
        localGoLive: null,
      });
    }
  });

  const updated = await loadDropById(drop.id, session.workspaceId, ctx.nowMs);
  if (updated === null) throw notFound();
  sendJson(ctx.response, 200, staffDropShape(updated));
}

async function applyDropFields(
  tx: Transaction,
  drop: DropRecord,
  input: DropInput,
): Promise<void> {
  if (input.name !== undefined) {
    await tx.query('update drops set name = $2 where id = $1', [drop.id, input.name]);
  }
  if (input.holdSeconds !== undefined) {
    await tx.query('update drops set hold_seconds = $2 where id = $1', [drop.id, input.holdSeconds]);
  }
  if (input.palette !== undefined) {
    await tx.query('update drops set palette = $2 where id = $1', [drop.id, input.palette]);
  }
  if (input.internalNote !== undefined) {
    await tx.query('update drops set internal_note = $2 where id = $1', [drop.id, input.internalNote]);
  }
  if (input.type !== undefined) {
    await tx.query('update drops set type = $2 where id = $1', [drop.id, input.type]);
  }
  if (input.markets !== undefined) {
    for (const market of MARKETS) {
      await tx.query('update drop_markets set store_pieces = $3 where drop_id = $1 and market = $2', [
        drop.id,
        market,
        input.markets[market],
      ]);
    }
  }
  if (input.styles !== undefined) {
    await tx.query('delete from drop_styles where drop_id = $1', [drop.id]);
    for (const [position, style] of input.styles.entries()) {
      await tx.query(
        `insert into drop_styles (drop_id, style_number, name, colour, wholesale_edition, rrp_dkk_minor, position)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [drop.id, style.styleNumber, style.name, style.colour, style.wholesaleEdition, style.rrpDkkMinor, position],
      );
    }
  }
}

export async function scheduleDrop(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'launch_producer');
  if (drop.status !== 'draft') throw conflict('drop_not_draft');

  const openings = openingsFor({
    type: drop.type,
    goLiveAtMs: drop.goLiveAtMs,
    copenhagenGoLive: drop.copenhagenGoLive,
    localGoLive: drop.localGoLive,
  });
  const problems = new Problems();
  if (openings === null) {
    problems.add(drop.type === 'rolling' ? 'localGoLive' : 'goLiveAt', FIELD_COPY.required);
  } else {
    const earliest = Math.min(...openings.map((opening) => opening.instantMs));
    if (earliest <= ctx.nowMs) {
      problems.add(drop.type === 'rolling' ? 'localGoLive' : 'goLiveAt', FIELD_COPY.notLater);
    }
  }
  problems.throwIfAny();

  await query("update drops set status = 'scheduled' where id = $1", [drop.id]);
  const updated = await loadDropById(drop.id, session.workspaceId, ctx.nowMs);
  if (updated === null) throw notFound();
  sendJson(ctx.response, 200, staffDropShape(updated));
}

export async function withdrawDrop(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'launch_producer');
  if (drop.status === 'withdrawn') throw conflict('drop_withdrawn_already');
  if (!isPublicStatus(drop.status)) throw conflict('drop_not_public');

  const body = ctx.json();
  const problems = new Problems();
  const reason = text(problems, body, 'reason', { max: 500 });
  problems.throwIfAny();

  await transact(async (tx) => {
    await tx.query(
      "update drops set status = 'withdrawn', withdrawn_at_ms = $2, withdraw_reason = $3 where id = $1",
      [drop.id, ctx.nowMs, reason],
    );
    await tx.query(
      "update holds set status = 'void' where drop_id = $1 and status = 'offered'",
      [drop.id],
    );
    await tx.query(
      `delete from outbox
        where sent_at_ms is null
          and kind in ('hold','press_preview')
          and payload->>'dropName' = $1`,
      [drop.name],
    );
  });
  const updated = await loadDropById(drop.id, session.workspaceId, ctx.nowMs);
  if (updated === null) throw notFound();
  sendJson(ctx.response, 200, staffDropShape(updated));
}

interface RestockRow {
  id: string;
  drop_id: string;
  first_restock: string;
  weekday: string;
  copenhagen_time: string;
  pieces: Record<string, number>;
}

function restockShape(row: RestockRow, nowMs: number): Record<string, unknown> {
  const wall = parseLocalDateTime(row.first_restock);
  const instants = wall === null ? [] : restockOccurrences(wall, nowMs, 8);
  return {
    id: row.id,
    weekday: row.weekday,
    copenhagenTime: row.copenhagen_time,
    pieces: row.pieces,
    nextInstants: instants.map(formatInstant),
  };
}

export async function listRestocks(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  const rows = await query<RestockRow>(
    'select * from restock_series where drop_id = $1 order by created_at_ms',
    [drop.id],
  );
  sendJson(ctx.response, 200, { items: rows.map((row) => restockShape(row, ctx.nowMs)) });
}

export async function createRestock(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'launch_producer');
  if (drop.status === 'withdrawn') throw conflict('drop_withdrawn_already');

  const body = ctx.json();
  const problems = new Problems();
  const firstRestock = text(problems, body, 'firstRestock');
  const wall = firstRestock === '' ? null : parseLocalDateTime(firstRestock);
  if (wall === null) {
    problems.add('firstRestock', FIELD_COPY.instant);
  } else {
    const resolved = resolveWall(COPENHAGEN_ZONE, wall);
    if (resolved.kind === 'gap') {
      problems.add('firstRestock', FIELD_COPY.gap(formatWallDate(wall)));
    } else if (resolved.instantMs <= ctx.nowMs) {
      problems.add('firstRestock', FIELD_COPY.notLater);
    }
  }
  const pieces = record(body['pieces']);
  const collected: Record<string, number> = {};
  for (const market of MARKETS) {
    if (!Object.hasOwn(pieces, market)) {
      problems.add(`pieces.${market}`, FIELD_COPY.required);
      continue;
    }
    collected[market] = integer(problems, pieces, market, 0, 100_000, `pieces.${market}`);
  }
  problems.throwIfAny();
  const checkedWall = wall as NonNullable<typeof wall>;

  const id = newId();
  await query(
    `insert into restock_series (id, drop_id, first_restock, weekday, copenhagen_time, pieces, created_at_ms)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      id,
      drop.id,
      firstRestock,
      weekdayLongName(checkedWall),
      formatTimeOfDay(checkedWall),
      collected,
      ctx.nowMs,
    ],
  );
  const rows = await query<RestockRow>('select * from restock_series where id = $1', [id]);
  const row = rows[0];
  if (row === undefined) throw notFound();
  sendJson(ctx.response, 201, restockShape(row, ctx.nowMs));
}

interface WaitlistRow {
  id: string;
  name: string;
  email: string;
  market: Market;
  status: string;
  joined_at_ms: number;
  position: number;
  hold_status: string | null;
  hold_offered_at_ms: number | null;
  hold_expires_at_ms: number | null;
}

export async function listWaitlist(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'launch_producer', 'merchandiser', 'press_lead', 'finance_lead');
  const rows = await query<WaitlistRow>(
    `select w.id, w.name, w.email, w.market, w.status, w.joined_at_ms, w.position,
            h.status as hold_status, h.offered_at_ms as hold_offered_at_ms,
            h.expires_at_ms as hold_expires_at_ms
       from waitlist_members w
       left join holds h on h.waitlist_member_id = w.id
      where w.drop_id = $1
      order by w.position`,
    [drop.id],
  );
  sendJson(ctx.response, 200, {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      market: row.market,
      status: row.status,
      joinedAt: formatInstant(Number(row.joined_at_ms)),
      position: row.position,
      hold:
        row.hold_status === null
          ? null
          : {
              status: row.hold_status,
              offeredAt: formatInstant(Number(row.hold_offered_at_ms)),
              expiresAt: formatInstant(Number(row.hold_expires_at_ms)),
            },
    })),
  });
}

export async function addVipMembers(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const drop = await requireDrop(ctx, session);
  requireRole(session, 'launch_producer');

  const body = ctx.json();
  const problems = new Problems();
  const market = readMarketValue(body['market'], problems, 'market');
  const entries = list(body, 'members');
  if (entries.length < 1 || entries.length > 200) problems.add('members', FIELD_COPY.range(1, 200));
  const members: { name: string; email: string }[] = [];
  for (const [index, entry] of entries.entries()) {
    const row = record(entry);
    const rawName = typeof row['name'] === 'string' ? normaliseMailName(row['name'] as string) : '';
    const name = text(problems, { name: rawName }, 'name', { max: 60 }, `members.${index}.name`);
    const address = emailField(problems, row, 'email', `members.${index}.email`);
    members.push({ name, email: address });
  }
  problems.throwIfAny();
  const checkedMarket = market as Market;

  const inserted = await transact(async (tx) => {
    const ids: string[] = [];
    for (const member of members) {
      const next = await tx.queryOne<{ next: number }>(
        'select coalesce(max(position), 0) + 1 as next from waitlist_members where drop_id = $1',
        [drop.id],
      );
      const position = Number(next?.next ?? 1);
      const row = await tx.queryOne<{ id: string }>(
        `insert into waitlist_members (id, drop_id, market, name, email, status, joined_at_ms, position, confirmed_at_ms)
         values ($1,$2,$3,$4,$5,'confirmed',$6,$7,$6)
         on conflict (drop_id, market, lower(email)) do update
           set status = 'confirmed', confirmed_at_ms = coalesce(waitlist_members.confirmed_at_ms, $6)
         returning id`,
        [newId(), drop.id, checkedMarket, member.name, member.email, ctx.nowMs, position],
      );
      if (row !== null) ids.push(row.id);
    }
    return ids;
  });

  const rows = await query<WaitlistRow>(
    `select w.id, w.name, w.email, w.market, w.status, w.joined_at_ms, w.position,
            null::text as hold_status, null::bigint as hold_offered_at_ms, null::bigint as hold_expires_at_ms
       from waitlist_members w where w.id = any($1) order by w.position`,
    [inserted],
  );
  sendJson(ctx.response, 201, {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      market: row.market,
      city: marketCity(row.market),
      status: row.status,
      joinedAt: formatInstant(Number(row.joined_at_ms)),
      position: row.position,
      hold: null,
    })),
  });
}
