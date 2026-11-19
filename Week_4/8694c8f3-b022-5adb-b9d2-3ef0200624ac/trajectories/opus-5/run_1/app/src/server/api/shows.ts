import { pool, withTransaction } from '../db.js';
import { ApiError, Err, fieldError } from '../errors.js';
import { asString } from '../input.js';
import type { Ctx, Reply } from '../http.js';
import { requireMembership, requireOwner, isUuid } from '../access.js';
import { getObject, keys, putAndConfirm, sha256Hex } from '../storage.js';
import { buildShowBundle, unreadyReferences } from '../domain/bundle.js';
import { writeActivity } from '../domain/activitylog.js';
import { emit, keepAlive, openStream, subscribe, writeEvent } from '../events.js';
import type { ShowStatus, ShowVersionDoc } from '../../shared/types.js';

interface VersionRow {
  number: number;
  status: ShowStatus;
  sha256: string | null;
  size: number | null;
  note: string;
  published_at: Date | null;
  user_id: string;
  display_name: string;
}

function toVersion(row: VersionRow, liveNumber: number | null): ShowVersionDoc {
  return {
    number: row.number,
    status: row.status,
    live: liveNumber === row.number,
    sha256: row.sha256,
    size: row.size,
    published_at: row.published_at?.toISOString() ?? null,
    published_by: { user_id: row.user_id, display_name: row.display_name },
    note: row.note,
  };
}

async function versionRows(setId: string): Promise<VersionRow[]> {
  const result = await pool.query<VersionRow>(
    `select v.number, v.status, v.sha256, v.size, v.note, v.published_at, u.id as user_id, u.display_name
       from show_versions v join users u on u.id = v.published_by
      where v.set_id = $1 order by v.number desc`,
    [setId],
  );
  return result.rows;
}

export async function publishShow(ctx: Ctx): Promise<Reply> {
  const membership = requireOwner(await requireMembership(ctx, ctx.params['id'] ?? ''));
  const noteValue = ctx.json['note'];
  const note = noteValue === undefined || noteValue === null ? '' : asString(noteValue) ?? '';
  if (note.length > 200) throw fieldError('note', 'A note is at most 200 characters');
  if (await unreadyReferences(pool, membership.setId)) {
    throw new ApiError(409, 'asset_not_ready', 'An asset in this set is not ready');
  }

  const { bundle, bytes } = await buildShowBundle(pool, membership.setId);
  const number = await withTransaction(async (client) => {
    await client.query(`select id from sets where id = $1 for update`, [membership.setId]);
    const next = await client.query<{ next: number }>(
      `select coalesce(max(number), 0) + 1 as next from show_versions where set_id = $1`,
      [membership.setId],
    );
    const allocated = next.rows[0]?.next ?? 1;
    await client.query(
      `insert into show_versions (set_id, number, status, note, asset_ids, published_by)
       values ($1, $2, 'storing', $3, $4, $5)`,
      [membership.setId, allocated, note, bundle.assets.map((asset) => asset.id), membership.user.id],
    );
    return allocated;
  });

  try {
    await putAndConfirm(keys.bundle(membership.setId, number), bytes, 'application/json');
  } catch (error) {
    await pool.query(`update show_versions set status = 'store failed' where set_id = $1 and number = $2`, [
      membership.setId,
      number,
    ]);
    await writeActivity(
      pool,
      membership.setId,
      membership.user.id,
      'show.store_failed',
      String(number),
      `Publishing version ${number} failed`,
    );
    if (error instanceof ApiError && error.status === 503) {
      throw new ApiError(503, 'storage_unavailable', error.message, {
        show_version: {
          number,
          status: 'store failed',
          live: false,
          sha256: null,
          size: null,
          published_at: null,
          published_by: { user_id: membership.user.id, display_name: membership.user.display_name },
          note,
        },
      });
    }
    throw error;
  }

  const digest = sha256Hex(bytes);
  const publishedAt = await withTransaction(async (client) => {
    const updated = await client.query<{ published_at: Date }>(
      `update show_versions set status = 'published', sha256 = $3, size = $4, published_at = now()
        where set_id = $1 and number = $2 returning published_at`,
      [membership.setId, number, digest, bytes.length],
    );
    await client.query(`update sets set live_number = $2 where id = $1`, [membership.setId, number]);
    await writeActivity(
      client,
      membership.setId,
      membership.user.id,
      'show.publish',
      String(number),
      `Published version ${number}`,
    );
    return updated.rows[0]?.published_at ?? new Date();
  });
  emit(membership.setId, { event: 'show', data: { live_number: number } });

  const showVersion: ShowVersionDoc = {
    number,
    status: 'published',
    live: true,
    sha256: digest,
    size: bytes.length,
    published_at: publishedAt.toISOString(),
    published_by: { user_id: membership.user.id, display_name: membership.user.display_name },
    note,
  };
  return { status: 201, json: { show_version: showVersion } };
}

export async function listShows(ctx: Ctx): Promise<Reply> {
  const membership = await requireMembership(ctx, ctx.params['id'] ?? '');
  const setRow = await pool.query<{ show_token: string; live_number: number | null }>(
    `select show_token, live_number from sets where id = $1`,
    [membership.setId],
  );
  const row = setRow.rows[0];
  if (row === undefined) throw Err.notFound();
  const rows = await versionRows(membership.setId);
  return {
    status: 200,
    json: {
      show_url: `/show/${row.show_token}`,
      live_number: row.live_number,
      versions: rows.map((version) => toVersion(version, row.live_number)),
    },
  };
}

async function movePointer(
  ctx: Ctx,
  pick: (versions: VersionRow[], live: number | null) => number,
  action: 'show.rollback' | 'show.activate',
): Promise<Reply> {
  const membership = requireOwner(await requireMembership(ctx, ctx.params['id'] ?? ''));
  const result = await withTransaction(async (client) => {
    const setRow = await client.query<{ live_number: number | null }>(
      `select live_number from sets where id = $1 for update`,
      [membership.setId],
    );
    const live = setRow.rows[0]?.live_number ?? null;
    const versions = await versionRows(membership.setId);
    const target = pick(versions, live);
    await client.query(`update sets set live_number = $2 where id = $1`, [membership.setId, target]);
    await writeActivity(
      client,
      membership.setId,
      membership.user.id,
      action,
      String(target),
      action === 'show.rollback'
        ? `Rolled back to version ${target}`
        : `Made version ${target} live`,
    );
    return { live_number: target, previous_live_number: live };
  });
  emit(membership.setId, { event: 'show', data: { live_number: result.live_number } });
  return { status: 200, json: result };
}

export async function rollbackShow(ctx: Ctx): Promise<Reply> {
  return movePointer(
    ctx,
    (versions, live) => {
      const candidates = versions.filter(
        (version) => version.status === 'published' && (live === null || version.number < live),
      );
      const previous = candidates[0];
      if (previous === undefined) throw new ApiError(409, 'no_previous_version', 'There is no earlier version');
      return previous.number;
    },
    'show.rollback',
  );
}

export async function activateShow(ctx: Ctx): Promise<Reply> {
  const number = Number(ctx.params['n'] ?? '');
  return movePointer(
    ctx,
    (versions) => {
      const found = versions.find((version) => version.number === number);
      if (found === undefined) throw Err.notFound();
      if (found.status !== 'published') {
        throw new ApiError(409, 'not_published', 'That version is not published');
      }
      return found.number;
    },
    'show.activate',
  );
}

interface LiveShow {
  set_id: string;
  set_name: string;
  bpm: number;
  live_number: number | null;
}

async function liveShow(token: string): Promise<LiveShow> {
  const result = await pool.query<LiveShow>(
    `select id as set_id, name as set_name, bpm, live_number from sets where show_token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (row === undefined) throw Err.notFound();
  return row;
}

export async function getShow(ctx: Ctx): Promise<Reply> {
  const show = await liveShow(ctx.params['token'] ?? '');
  if (show.live_number === null) throw new ApiError(404, 'not_published', 'Nothing is live yet');
  const version = await pool.query<{ number: number; sha256: string; size: number; published_at: Date }>(
    `select number, sha256, size, published_at from show_versions where set_id = $1 and number = $2`,
    [show.set_id, show.live_number],
  );
  const row = version.rows[0];
  if (row === undefined) throw new ApiError(404, 'not_published', 'Nothing is live yet');
  return {
    status: 200,
    json: {
      set_name: show.set_name,
      bpm: show.bpm,
      version: {
        number: row.number,
        sha256: row.sha256,
        size: row.size,
        published_at: row.published_at.toISOString(),
      },
    },
  };
}

export async function getShowBundle(ctx: Ctx): Promise<Reply> {
  const show = await liveShow(ctx.params['token'] ?? '');
  if (show.live_number === null) throw new ApiError(404, 'not_published', 'Nothing is live yet');
  const version = await pool.query<{ sha256: string }>(
    `select sha256 from show_versions where set_id = $1 and number = $2 and status = 'published'`,
    [show.set_id, show.live_number],
  );
  const row = version.rows[0];
  if (row === undefined) throw new ApiError(404, 'not_published', 'Nothing is live yet');
  const bytes = await getObject(keys.bundle(show.set_id, show.live_number));
  return {
    status: 200,
    body: bytes,
    headers: {
      'Content-Type': 'application/json',
      'X-Bundle-SHA256': row.sha256,
      'X-Show-Version': String(show.live_number),
    },
  };
}

export async function getShowAsset(ctx: Ctx): Promise<Reply> {
  const show = await liveShow(ctx.params['token'] ?? '');
  const assetId = ctx.params['assetId'] ?? '';
  if (show.live_number === null || !isUuid(assetId)) throw Err.notFound();
  const inManifest = await pool.query<{ content_type: string; sha256: string }>(
    `select a.content_type, a.sha256
       from show_versions v join assets a on a.id = $3
      where v.set_id = $1 and v.number = $2 and $3 = any(v.asset_ids)`,
    [show.set_id, show.live_number, assetId],
  );
  const row = inManifest.rows[0];
  if (row === undefined) throw Err.notFound();
  const bytes = await getObject(keys.asset(show.set_id, assetId));
  return {
    status: 200,
    body: bytes,
    headers: { 'Content-Type': row.content_type, 'X-Content-SHA256': row.sha256 },
  };
}

export async function streamShowEvents(ctx: Ctx): Promise<void> {
  const show = await liveShow(ctx.params['token'] ?? '');
  openStream(ctx.res);
  writeEvent(ctx.res, { event: 'show', data: { live_number: show.live_number } });
  const unsubscribe = subscribe(show.set_id, (event) => {
    if (event.event === 'show') writeEvent(ctx.res, event);
  });
  const timer = keepAlive(ctx.res);
  ctx.req.on('close', () => {
    clearInterval(timer);
    unsubscribe();
  });
}
