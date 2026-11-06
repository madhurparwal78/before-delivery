import { config, LIMITS } from '../config.ts';
import { query, queryOne, transact, type Transaction } from '../db/pool.ts';
import { queueMail } from '../db/outbox.ts';
import { FIELD_COPY, STATUS_COPY } from '../../domain/copy.ts';
import { isPublicStatus, publicStatusOf, type PublicDropStatus } from '../../domain/dropstate.ts';
import { isMarket, marketCity, type Market } from '../../domain/markets.ts';
import { graphemeCount, normaliseMailName } from '../../domain/text.ts';
import { copenhagenToday, formatInstant, formatMarketTime, isoWeekOfInstant, weekLabel, weekValue } from '../../domain/time.ts';
import type { Ctx } from '../http/context.ts';
import { ApiError, conflict, gone, notFound, validationFailed } from '../http/errors.ts';
import { sendJson, sendText } from '../http/respond.ts';
import { email as emailField, Problems, readString, text } from '../http/validate.ts';
import { newClaimReference, newId, newToken } from '../services/crypto.ts';
import { getObject, StorageUnavailable } from '../services/storage.ts';
import { dropWeek, earliestInstant, loadDropBySlug, loadDrops, type DropRecord } from '../repo/drops.ts';
import { fingerprint, replayOf, storeResponse } from '../repo/idempotency.ts';

const SORTS = ['soonest', 'latest', 'name'] as const;
type Sort = (typeof SORTS)[number];

interface WorkspaceNameRow {
  id: string;
  name: string;
}

async function brandNames(): Promise<Map<string, string>> {
  const rows = await query<WorkspaceNameRow>('select id, name from workspaces');
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function coverImages(dropIds: readonly string[]): Promise<Map<string, string>> {
  if (dropIds.length === 0) return new Map();
  const rows = await query<{ drop_id: string; id: string }>(
    `select drop_id, id from looks where drop_id = any($1) and position = 0`,
    [dropIds],
  );
  return new Map(rows.map((row) => [row.drop_id, row.id]));
}

function marketStatusFor(drop: DropRecord, market: Market | null): PublicDropStatus {
  if (market === null) return publicStatusOf(drop.status);
  const entry = drop.markets.find((candidate) => candidate.market === market);
  return entry === undefined ? publicStatusOf(drop.status) : entry.status;
}

function instantFor(drop: DropRecord, market: Market | null): number | null {
  if (market === null) return earliestInstant(drop);
  return drop.markets.find((candidate) => candidate.market === market)?.goLiveAtMs ?? null;
}

export async function listPublicDrops(ctx: Ctx): Promise<void> {
  const problems = new Problems();
  const marketParam = ctx.query('market');
  if (marketParam !== null && !isMarket(marketParam)) problems.add('market', FIELD_COPY.unknownMarket);
  const statusParam = ctx.query('status');
  if (statusParam !== null && !['upcoming', 'live', 'sold_out'].includes(statusParam)) {
    problems.add('status', FIELD_COPY.required);
  }
  const typeParam = ctx.query('type');
  if (typeParam !== null && !['simultaneous', 'rolling'].includes(typeParam)) {
    problems.add('type', FIELD_COPY.required);
  }
  const weekParam = ctx.query('week');
  if (weekParam !== null && !/^\d{4}-W\d{2}$/.test(weekParam)) problems.add('week', FIELD_COPY.required);
  const sortParam = ctx.query('sort') ?? 'soonest';
  if (!(SORTS as readonly string[]).includes(sortParam)) problems.add('sort', FIELD_COPY.required);
  const pageParam = ctx.query('page');
  const page = pageParam === null ? 1 : Number(pageParam);
  if (!Number.isInteger(page) || page < 1) problems.add('page', FIELD_COPY.range(1, 1_000_000));
  problems.throwIfAny();

  const market = marketParam === null ? null : (marketParam as Market);
  const search = (ctx.query('q') ?? '').trim().toLowerCase();
  const sort = sortParam as Sort;

  const drops = (await loadDrops('1 = 1', [], ctx.nowMs)).filter((drop) =>
    isPublicStatus(drop.status),
  );
  const brands = await brandNames();

  const filtered = drops.filter((drop) => {
    if (typeParam !== null && drop.type !== typeParam) return false;
    if (statusParam !== null && marketStatusFor(drop, market) !== statusParam) return false;
    if (weekParam !== null) {
      const week = dropWeek(drop, market);
      if (week === null || week.value !== weekParam) return false;
    }
    if (search !== '') {
      const brand = brands.get(drop.workspaceId) ?? '';
      if (
        !drop.name.toLowerCase().includes(search) &&
        !brand.toLowerCase().includes(search)
      ) {
        return false;
      }
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'en');
    const left = instantFor(a, market) ?? Number.MAX_SAFE_INTEGER;
    const right = instantFor(b, market) ?? Number.MAX_SAFE_INTEGER;
    return sort === 'latest' ? right - left : left - right;
  });

  const total = filtered.length;
  const start = (page - 1) * LIMITS.pageSize;
  const slice = filtered.slice(start, start + LIMITS.pageSize);
  const covers = await coverImages(slice.map((drop) => drop.id));

  sendJson(ctx.response, 200, {
    items: slice.map((drop) => {
      const instant = instantFor(drop, market);
      const week = dropWeek(drop, market);
      const coverId = covers.get(drop.id);
      return {
        slug: drop.slug,
        name: drop.name,
        brand: brands.get(drop.workspaceId) ?? '',
        type: drop.type,
        status: marketStatusFor(drop, market),
        goLiveAt: instant === null ? null : formatInstant(instant),
        weekLabel: week?.label ?? null,
        palette: drop.palette,
        coverImageUrl:
          coverId === undefined
            ? null
            : `/api/public/drops/${drop.slug}/looks/${coverId}/image`,
        markets: drop.markets.map((entry) => ({
          market: entry.market,
          city: entry.city,
          goLiveAt: entry.goLiveAtMs === null ? null : formatInstant(entry.goLiveAtMs),
          status: entry.status,
        })),
      };
    }),
    page,
    pageSize: LIMITS.pageSize,
    total,
    todayCopenhagen: copenhagenToday(ctx.nowMs),
  });
}

/** Loads a public drop, answering 410 for a withdrawn one and 404 for a draft or unknown slug. */
export async function requirePublicDrop(ctx: Ctx): Promise<DropRecord> {
  const drop = await loadDropBySlug(ctx.params['slug'] as string, ctx.nowMs);
  if (drop === null) throw notFound();
  if (drop.status === 'withdrawn') throw gone('drop_withdrawn');
  if (!isPublicStatus(drop.status)) throw notFound();
  return drop;
}

interface LookRow {
  id: string;
  position: number;
  title: string;
  alt_text: string;
  width: number;
  height: number;
  object_key: string;
  content_type: string;
  size_bytes: number;
}

export async function loadLooks(dropId: string): Promise<LookRow[]> {
  return query<LookRow>(
    'select id, position, title, alt_text, width, height, object_key, content_type, size_bytes from looks where drop_id = $1 order by position',
    [dropId],
  );
}

export async function getPublicDrop(ctx: Ctx): Promise<void> {
  const drop = await requirePublicDrop(ctx);
  const brands = await brandNames();
  const story = await queryOne<{ published_html: string | null }>(
    'select published_html from stories where drop_id = $1',
    [drop.id],
  );
  const looks = await loadLooks(drop.id);
  sendJson(ctx.response, 200, {
    slug: drop.slug,
    name: drop.name,
    brand: brands.get(drop.workspaceId) ?? '',
    type: drop.type,
    status: publicStatusOf(drop.status),
    palette: drop.palette,
    storyHtml: story?.published_html ?? '',
    looks: looks.map((look) => ({
      id: look.id,
      position: look.position + 1,
      title: look.title,
      altText: look.alt_text,
      imageUrl: `/api/public/drops/${drop.slug}/looks/${look.id}/image`,
      width: look.width,
      height: look.height,
    })),
    markets: drop.markets.map((entry) => ({
      market: entry.market,
      city: entry.city,
      goLiveAt: entry.goLiveAtMs === null ? null : formatInstant(entry.goLiveAtMs),
      status: entry.status,
      piecesLeft: entry.piecesLeft,
    })),
  });
}

export async function getPublicLookImage(ctx: Ctx): Promise<void> {
  const drop = await requirePublicDrop(ctx);
  const look = await queryOne<LookRow>(
    'select id, position, title, alt_text, width, height, object_key, content_type, size_bytes from looks where id = $1 and drop_id = $2',
    [ctx.params['lookId'] as string, drop.id],
  );
  if (look === null) throw notFound();
  await serveLookBytes(ctx, look);
}

export async function serveLookBytes(ctx: Ctx, look: LookRow): Promise<void> {
  try {
    const bytes = await getObject(look.object_key);
    sendText(ctx.response, 200, look.content_type, bytes, {
      'cache-control': 'public, max-age=86400',
    });
  } catch (error) {
    if (error instanceof StorageUnavailable) throw new ApiError(503, 'storage_unavailable');
    throw error;
  }
}

export async function sitemap(ctx: Ctx): Promise<void> {
  const drops = (await loadDrops('1 = 1', [], ctx.nowMs)).filter((drop) =>
    isPublicStatus(drop.status),
  );
  const entries = ['/', ...drops.map((drop) => `/drops/${drop.slug}`)];
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map((path) => `<url><loc>${config.publicUrl}${path}</loc></url>`),
    '</urlset>',
  ].join('\n');
  sendText(ctx.response, 200, 'application/xml; charset=utf-8', body);
}

// --- Waitlist ---------------------------------------------------------------

export async function joinWaitlist(ctx: Ctx): Promise<void> {
  const drop = await requirePublicDrop(ctx);
  const body = ctx.json();
  const problems = new Problems();
  const marketValue = readString(body, 'market');
  if (!isMarket(marketValue)) problems.add('market', FIELD_COPY.unknownMarket);
  const rawName = typeof body['name'] === 'string' ? normaliseMailName(body['name'] as string) : '';
  if (rawName === '') problems.add('name', FIELD_COPY.required);
  else if (graphemeCount(rawName) > 60) problems.add('name', FIELD_COPY.tooLong(60));
  const address = emailField(problems, body, 'email');
  if (body['consent'] !== true) problems.add('consent', FIELD_COPY.consent);
  problems.throwIfAny();
  const market = marketValue as Market;

  if (drop.status === 'sold_out') throw conflict('drop_closed');

  await transact(async (tx) => {
    const existing = await tx.queryOne<{
      id: string;
      status: string;
    }>(
      'select id, status from waitlist_members where drop_id = $1 and market = $2 and lower(email) = lower($3) for update',
      [drop.id, market, address],
    );
    if (existing === null) {
      const next = await tx.queryOne<{ next: number }>(
        'select coalesce(max(position), 0) + 1 as next from waitlist_members where drop_id = $1',
        [drop.id],
      );
      const memberId = newId();
      await tx.query(
        `insert into waitlist_members (id, drop_id, market, name, email, status, joined_at_ms, position)
         values ($1,$2,$3,$4,$5,'pending',$6,$7)`,
        [memberId, drop.id, market, rawName, address, ctx.nowMs, Number(next?.next ?? 1)],
      );
      await issueOptInLink(tx, memberId, drop, market, rawName, address, ctx.nowMs);
      return;
    }
    if (existing.status === 'confirmed') return;
    const live = await tx.queryOne(
      'select 1 from opt_in_links where waitlist_member_id = $1 and used_at_ms is null and expires_at_ms > $2',
      [existing.id, ctx.nowMs],
    );
    if (live !== null) return;
    await issueOptInLink(tx, existing.id, drop, market, rawName, address, ctx.nowMs);
  });

  sendJson(ctx.response, 202, { status: 'check_email' });
}

async function issueOptInLink(
  tx: Transaction,
  waitlistMemberId: string,
  drop: DropRecord,
  market: Market,
  name: string,
  address: string,
  nowMs: number,
): Promise<void> {
  const token = newToken();
  const expiresAtMs = nowMs + config.ttl.optInLinkSeconds * 1000;
  await tx.query(
    `insert into opt_in_links (id, waitlist_member_id, token, issued_at_ms, expires_at_ms)
     values ($1,$2,$3,$4,$5)`,
    [newId(), waitlistMemberId, token, nowMs, expiresAtMs],
  );
  await queueMail(
    tx,
    {
      kind: 'waitlist_opt_in',
      email: address,
      name,
      dropName: drop.name,
      market,
      city: marketCity(market),
      token,
      expiresAtMs,
    },
    `optin:${token}`,
  );
}

export async function confirmWaitlist(ctx: Ctx): Promise<void> {
  const body = ctx.json();
  const problems = new Problems();
  const token = text(problems, body, 'token');
  problems.throwIfAny();

  const result = await transact(async (tx) => {
    const link = await tx.queryOne<{
      id: string;
      waitlist_member_id: string;
      expires_at_ms: number;
      used_at_ms: number | null;
    }>('select * from opt_in_links where token = $1 for update', [token]);
    if (link === null) throw gone('link_expired', { message: STATUS_COPY.waitlistLinkExpired });
    if (link.used_at_ms !== null) {
      throw gone('link_used', { message: STATUS_COPY.waitlistLinkUsed });
    }
    if (ctx.nowMs >= Number(link.expires_at_ms)) {
      throw gone('link_expired', { message: STATUS_COPY.waitlistLinkExpired });
    }
    await tx.query('update opt_in_links set used_at_ms = $2 where id = $1', [link.id, ctx.nowMs]);
    await tx.query(
      `update waitlist_members
          set status = 'confirmed', confirmed_at_ms = coalesce(confirmed_at_ms, $2)
        where id = $1`,
      [link.waitlist_member_id, ctx.nowMs],
    );
    const member = await tx.queryOne<{ market: Market; drop_id: string }>(
      'select market, drop_id from waitlist_members where id = $1',
      [link.waitlist_member_id],
    );
    const drop = await tx.queryOne<{ name: string }>('select name from drops where id = $1', [
      member?.drop_id,
    ]);
    return { market: member?.market as Market, dropName: drop?.name ?? '' };
  });

  sendJson(ctx.response, 200, {
    status: 'confirmed',
    dropName: result.dropName,
    market: result.market,
  });
}

// --- Holds and claims -------------------------------------------------------

interface HoldRow {
  id: string;
  drop_id: string;
  market: Market;
  waitlist_member_id: string | null;
  token: string;
  offered_at_ms: number;
  expires_at_ms: number;
  status: string;
}

export async function getHold(ctx: Ctx): Promise<void> {
  const token = ctx.params['holdToken'] as string;
  const hold = await queryOne<HoldRow & { slug: string; drop_name: string; drop_status: string }>(
    `select h.*, d.slug, d.name as drop_name, d.status as drop_status
       from holds h join drops d on d.id = h.drop_id
      where h.token = $1`,
    [token],
  );
  if (hold === null) throw notFound();
  if (hold.drop_status === 'withdrawn') throw gone('drop_withdrawn');
  sendJson(ctx.response, 200, {
    dropSlug: hold.slug,
    dropName: hold.drop_name,
    market: hold.market,
    city: marketCity(hold.market),
    status: holdStateOf(hold, ctx.nowMs),
    offeredAt: formatInstant(Number(hold.offered_at_ms)),
    expiresAt: formatInstant(Number(hold.expires_at_ms)),
  });
}

function holdStateOf(hold: HoldRow, nowMs: number): 'offered' | 'claimed' | 'expired' | 'void' {
  if (hold.status === 'claimed') return 'claimed';
  if (hold.status === 'void') return 'void';
  return nowMs >= Number(hold.expires_at_ms) ? 'expired' : 'offered';
}

export async function createClaim(ctx: Ctx): Promise<void> {
  const drop = await requirePublicDrop(ctx);
  const body = ctx.json();
  const key = ctx.header('idempotency-key');
  if (key === null || key === '' || key.length > 100 || !/^[\x20-\x7e]+$/.test(key)) {
    throw new ApiError(400, 'idempotency_key_required');
  }
  const scope = `claims:${drop.id}`;
  const print = fingerprint(body);
  const replay = await replayOf(scope, key, print);
  if (replay !== null) {
    sendJson(ctx.response, replay.status, replay.body);
    return;
  }

  try {
    const outcome = await transact(async (tx) => {
      const held = readString(body, 'holdToken');
      return held === null || held === ''
        ? await claimOpenPiece(tx, ctx, drop, body)
        : await claimHeldPiece(tx, ctx, drop, held);
    });
    await transact((tx) => storeResponse(tx, scope, key, print, outcome, ctx.nowMs));
    sendJson(ctx.response, outcome.status, outcome.body);
  } catch (error) {
    if (error instanceof ApiError && [201, 409, 422].includes(error.status)) {
      await transact((tx) =>
        storeResponse(tx, scope, key, print, { status: error.status, body: error.body }, ctx.nowMs),
      );
    }
    throw error;
  }
}

interface ClaimOutcome {
  status: number;
  body: unknown;
}

async function lockMarket(
  tx: Transaction,
  dropId: string,
  market: Market,
): Promise<{ store_pieces: number; go_live_at_ms: number | null } | null> {
  return tx.queryOne<{ store_pieces: number; go_live_at_ms: number | null }>(
    'select store_pieces, go_live_at_ms from drop_markets where drop_id = $1 and market = $2 for update',
    [dropId, market],
  );
}

async function countClaims(tx: Transaction, dropId: string, market: Market): Promise<number> {
  const row = await tx.queryOne<{ count: number }>(
    'select count(*)::int as count from claims where drop_id = $1 and market = $2',
    [dropId, market],
  );
  return row?.count ?? 0;
}

async function countLiveHolds(
  tx: Transaction,
  dropId: string,
  market: Market,
  nowMs: number,
  exceptHoldId: string | null,
): Promise<number> {
  const row = await tx.queryOne<{ count: number }>(
    `select count(*)::int as count from holds
      where drop_id = $1 and market = $2 and status = 'offered' and expires_at_ms > $3
        and ($4::text is null or id <> $4)`,
    [dropId, market, nowMs, exceptHoldId],
  );
  return row?.count ?? 0;
}

async function recordClaim(
  tx: Transaction,
  ctx: Ctx,
  drop: DropRecord,
  market: Market,
  name: string,
  address: string,
  holdId: string | null,
): Promise<ClaimOutcome> {
  const claimId = newId();
  await tx.query(
    `insert into claims (id, drop_id, market, reference, name, email, claimed_at_ms, hold_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [claimId, drop.id, market, newClaimReference(), name, address, ctx.nowMs, holdId],
  );
  const stored = await tx.queryOne<{ reference: string }>(
    'select reference from claims where id = $1',
    [claimId],
  );
  const claimed = await countClaims(tx, drop.id, market);
  const held = await countLiveHolds(tx, drop.id, market, ctx.nowMs, holdId);
  const marketRow = await lockMarket(tx, drop.id, market);
  const piecesLeft = Math.max(0, (marketRow?.store_pieces ?? 0) - claimed - held);

  await updateSoldOut(tx, drop.id);

  return {
    status: 201,
    body: {
      claim: {
        id: claimId,
        reference: stored?.reference ?? '',
        market,
        claimedAt: formatInstant(ctx.nowMs),
      },
      piecesLeft,
    },
  };
}

async function updateSoldOut(tx: Transaction, dropId: string): Promise<void> {
  const row = await tx.queryOne<{ open: number; status: string }>(
    `select d.status,
            (select count(*) from drop_markets dm
              where dm.drop_id = d.id
                and dm.store_pieces > (select count(*) from claims c
                                        where c.drop_id = d.id and c.market = dm.market)) as open
       from drops d where d.id = $1`,
    [dropId],
  );
  if (row === null) return;
  if (row.status === 'live' && Number(row.open) === 0) {
    await tx.query("update drops set status = 'sold_out' where id = $1", [dropId]);
  }
  if (row.status === 'sold_out' && Number(row.open) > 0) {
    await tx.query("update drops set status = 'live' where id = $1", [dropId]);
  }
}

async function claimHeldPiece(
  tx: Transaction,
  ctx: Ctx,
  drop: DropRecord,
  token: string,
): Promise<ClaimOutcome> {
  const hold = await tx.queryOne<HoldRow>('select * from holds where token = $1 for update', [token]);
  if (hold === null || hold.drop_id !== drop.id) throw notFound();
  await lockMarket(tx, drop.id, hold.market);

  if (hold.status === 'claimed') {
    throw conflict('hold_claimed', { message: STATUS_COPY.holdAlreadyClaimed });
  }
  if (hold.status === 'void' || ctx.nowMs >= Number(hold.expires_at_ms)) {
    throw conflict('hold_expired', {
      message: STATUS_COPY.holdExpired(formatMarketTime(Number(hold.expires_at_ms), 'copenhagen')),
    });
  }

  const member = await tx.queryOne<{ name: string; email: string }>(
    'select name, email from waitlist_members where id = $1',
    [hold.waitlist_member_id],
  );
  if (member === null) throw notFound();

  const already = await tx.queryOne(
    'select 1 from claims where drop_id = $1 and market = $2 and lower(email) = lower($3)',
    [drop.id, hold.market, member.email],
  );
  if (already !== null) {
    throw conflict('already_claimed', {
      message: STATUS_COPY.alreadyClaimed(marketCity(hold.market)),
    });
  }

  await tx.query("update holds set status = 'claimed' where id = $1", [hold.id]);
  return recordClaim(tx, ctx, drop, hold.market, member.name, member.email, hold.id);
}

async function claimOpenPiece(
  tx: Transaction,
  ctx: Ctx,
  drop: DropRecord,
  body: Record<string, unknown>,
): Promise<ClaimOutcome> {
  const problems = new Problems();
  const marketValue = readString(body, 'market');
  if (!isMarket(marketValue)) problems.add('market', FIELD_COPY.unknownMarket);
  const rawName = typeof body['name'] === 'string' ? normaliseMailName(body['name'] as string) : '';
  if (rawName === '') problems.add('name', FIELD_COPY.required);
  else if (graphemeCount(rawName) > 60) problems.add('name', FIELD_COPY.tooLong(60));
  const address = emailField(problems, body, 'email');
  if (problems.any) throw validationFailed(problems.map);
  const market = marketValue as Market;

  const marketRow = await lockMarket(tx, drop.id, market);
  if (marketRow === null) throw notFound();
  const goLiveAtMs = marketRow.go_live_at_ms === null ? null : Number(marketRow.go_live_at_ms);
  if (drop.status === 'scheduled' || goLiveAtMs === null || ctx.nowMs < goLiveAtMs) {
    throw conflict('market_not_live', { message: STATUS_COPY.notLive(marketCity(market)) });
  }

  const already = await tx.queryOne(
    'select 1 from claims where drop_id = $1 and market = $2 and lower(email) = lower($3)',
    [drop.id, market, address],
  );
  if (already !== null) {
    throw conflict('already_claimed', { message: STATUS_COPY.alreadyClaimed(marketCity(market)) });
  }

  const waiting = await tx.queryOne(
    `select 1 from waitlist_members
      where drop_id = $1 and market = $2 and status = 'confirmed' and offered_at_ms is null
      limit 1`,
    [drop.id, market],
  );
  if (waiting !== null) throw conflict('waitlist_pending', { message: STATUS_COPY.waitlistFirst });

  const claimed = await countClaims(tx, drop.id, market);
  const held = await countLiveHolds(tx, drop.id, market, ctx.nowMs, null);
  if (marketRow.store_pieces - claimed - held <= 0) {
    const winner = await tx.queryOne<{ claimed_at_ms: number }>(
      'select claimed_at_ms from claims where drop_id = $1 and market = $2 order by claimed_at_ms desc limit 1',
      [drop.id, market],
    );
    const winningMs = Number(winner?.claimed_at_ms ?? ctx.nowMs);
    throw new ApiError(409, 'sold_out', {
      claimedAt: formatInstant(winningMs),
      message: STATUS_COPY.lostRace(formatMarketTime(winningMs, 'copenhagen')),
    });
  }

  return recordClaim(tx, ctx, drop, market, rawName, address, null);
}

export function publicWeekOptions(drops: readonly DropRecord[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const drop of drops) {
    const instant = earliestInstant(drop);
    if (instant === null) continue;
    const week = isoWeekOfInstant(instant);
    seen.set(weekValue(week), weekLabel(week));
  }
  return [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([value, label]) => ({ value, label }));
}
