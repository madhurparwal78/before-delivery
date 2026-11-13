import { formatMl, type Ml } from '../../domain/decimal.ts';
import { ApiError, ValidationError } from '../../domain/errors.ts';
import { elapsedHours, formatInstant, parseInstant, windowStatus } from '../../domain/time.ts';
import { type Client, pool, transaction } from '../db.ts';
import { channelFlows, serverNow, windowRow, windowRows } from '../reads.ts';
import { windowRecord, type WindowRow } from '../records.ts';
import { restrictedCapVolume } from './restrictions.ts';
import { requireCapMlDay } from './validate.ts';

/** The channel capacity table: one revision per save, restore or new window. */

interface RevisionRow {
  revision: number;
  saved_at: Date;
  saved_by: string;
  restored_from: number | null;
  cells: Record<string, string>;
}

export async function capacityBody(channelId: string): Promise<Record<string, unknown>> {
  const channel = await pool.query<{ capacity_revision: number }>(
    'select capacity_revision from channels where id = $1',
    [channelId],
  );
  if (channel.rows[0] === undefined) throw new ApiError('not_found');
  const windows = await windowRows({ channelId });
  const revisions = await pool.query<RevisionRow>(
    'select revision, saved_at, saved_by, restored_from from capacity_revisions where channel_id = $1 order by revision desc',
    [channelId],
  );
  return {
    revision: (channel.rows[0] as { capacity_revision: number }).capacity_revision,
    cells: windows.map((window) => ({
      window_id: window.id,
      cap_ml_day: formatMl(BigInt(window.table_cap_ml_day)),
    })),
    revisions: revisions.rows.map((row) => ({
      revision: row.revision,
      saved_at: formatInstant(row.saved_at),
      saved_by: row.saved_by,
      restored_from: row.restored_from,
    })),
  };
}

interface SubmittedCell {
  windowId: string;
  capMlDay: Ml;
}

function readCells(input: unknown): SubmittedCell[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw ValidationError.field('cells', 'Send at least one cap.');
  }
  const cells: SubmittedCell[] = [];
  for (const entry of input as Record<string, unknown>[]) {
    const windowId = entry.window_id;
    if (typeof windowId !== 'string') throw ValidationError.field('cells', 'Each cap needs a window.');
    cells.push({ windowId, capMlDay: requireCapMlDay(`cells.${windowId}`, entry.cap_ml_day) });
  }
  return cells;
}

async function checkCell(cell: SubmittedCell, channelId: string, now: Date): Promise<WindowRow> {
  const window = await windowRow(cell.windowId);
  if (window === null || window.channel_id !== channelId) {
    throw ValidationError.field(`cells.${cell.windowId}`, 'That window is not on this channel.');
  }
  if (windowStatus(window.opens_at, window.closes_at, now) === 'closed') {
    throw ValidationError.field(`cells.${cell.windowId}`, 'This window has closed.');
  }
  const capVolume = restrictedCapVolume(window, cell.capMlDay);
  const committed = BigInt(window.committed_ml);
  if (capVolume < committed) {
    throw ValidationError.field(
      `cells.${cell.windowId}`,
      `That cap leaves ${formatMl(capVolume)} ML, below the ${formatMl(committed)} ML already committed.`,
    );
  }
  return window;
}

async function storeRevision(
  client: Client,
  channelId: string,
  caps: ReadonlyMap<string, Ml>,
  savedBy: string,
  restoredFrom: number | null,
): Promise<number> {
  const locked = await client.query<{ capacity_revision: number }>(
    'select capacity_revision from channels where id = $1 for update',
    [channelId],
  );
  const revision = (locked.rows[0] as { capacity_revision: number }).capacity_revision + 1;
  for (const [windowId, capMlDay] of caps) {
    await client.query('update windows set table_cap_ml_day = $2 where id = $1', [windowId, capMlDay.toString()]);
  }
  const all = await client.query<{ id: string; table_cap_ml_day: string }>(
    'select id, table_cap_ml_day from windows where channel_id = $1',
    [channelId],
  );
  const cells = Object.fromEntries(all.rows.map((row) => [row.id, row.table_cap_ml_day]));
  await client.query(
    'insert into capacity_revisions (channel_id, revision, saved_by, restored_from, cells) values ($1,$2,$3,$4,$5)',
    [channelId, revision, savedBy, restoredFrom, JSON.stringify(cells)],
  );
  await client.query('update channels set capacity_revision = $2 where id = $1', [channelId, revision]);
  return revision;
}

async function cellsReply(channelId: string): Promise<{ window_id: string; cap_ml_day: string }[]> {
  const windows = await windowRows({ channelId });
  return windows.map((window) => ({
    window_id: window.id,
    cap_ml_day: formatMl(BigInt(window.table_cap_ml_day)),
  }));
}

export async function saveCapacityTable(
  channelId: string,
  savedBy: string,
  input: { baseRevision: unknown; cells: unknown },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const channel = await pool.query<{ capacity_revision: number }>(
    'select capacity_revision from channels where id = $1',
    [channelId],
  );
  if (channel.rows[0] === undefined) throw new ApiError('not_found');

  const baseRevision = input.baseRevision;
  if (typeof baseRevision !== 'number' || !Number.isInteger(baseRevision) || baseRevision < 1) {
    throw ValidationError.field('base_revision', 'Send the revision the table was loaded at.');
  }
  const cells = readCells(input.cells);
  const now = serverNow();
  for (const cell of cells) await checkCell(cell, channelId, now);

  const outcome = await transaction(async (client) => {
    const locked = await client.query<{ capacity_revision: number }>(
      'select capacity_revision from channels where id = $1 for update',
      [channelId],
    );
    const current = (locked.rows[0] as { capacity_revision: number }).capacity_revision;
    const caps = new Map<string, Ml>();

    if (baseRevision === current) {
      for (const cell of cells) caps.set(cell.windowId, cell.capMlDay);
      const revision = await storeRevision(client, channelId, caps, savedBy, null);
      return { conflict: false as const, revision };
    }

    for (const cell of cells) {
      const window = (await windowRow(cell.windowId, client)) as WindowRow;
      const currentCap = BigInt(window.table_cap_ml_day);
      caps.set(cell.windowId, currentCap < cell.capMlDay ? currentCap : cell.capMlDay);
    }
    const revision = await storeRevision(client, channelId, caps, savedBy, null);
    return { conflict: true as const, revision };
  });

  const reply = await cellsReply(channelId);
  if (!outcome.conflict) {
    return { status: 200, body: { revision: outcome.revision, cells: reply } };
  }
  throw new ApiError('revision_conflict', {
    revision: outcome.revision,
    cells: reply,
    submitted: cells.map((cell) => ({ window_id: cell.windowId, cap_ml_day: formatMl(cell.capMlDay) })),
  });
}

export async function restoreRevision(
  channelId: string,
  revision: number,
  savedBy: string,
): Promise<Record<string, unknown>> {
  const stored = await pool.query<RevisionRow>(
    'select revision, cells from capacity_revisions where channel_id = $1 and revision = $2',
    [channelId, revision],
  );
  const source = stored.rows[0];
  if (source === undefined) throw new ApiError('not_found');

  const now = serverNow();
  const windows = await windowRows({ channelId });
  const caps = new Map<string, Ml>();
  const below: string[] = [];

  for (const window of windows) {
    const capText = source.cells[window.id];
    if (capText === undefined) continue;
    if (windowStatus(window.opens_at, window.closes_at, now) === 'closed') continue;
    const capMlDay = BigInt(capText);
    if (restrictedCapVolume(window, capMlDay) < BigInt(window.committed_ml)) below.push(window.id);
    caps.set(window.id, capMlDay);
  }
  if (below.length > 0) {
    throw new ApiError(
      'restore_below_committed',
      { windows: below },
      `Restoring revision ${revision} would cut below what is already committed.`,
    );
  }

  const created = await transaction((client) => storeRevision(client, channelId, caps, savedBy, revision));
  return { revision: created, restored_from: revision, cells: await cellsReply(channelId) };
}

export async function createWindow(
  channelId: string,
  savedBy: string,
  input: { opensAt: unknown; closesAt: unknown; capMlDay: unknown; rosteredOperator: unknown },
): Promise<Record<string, unknown>> {
  const channel = await pool.query<{ id: string }>('select id from channels where id = $1', [channelId]);
  if (channel.rows[0] === undefined) throw new ApiError('not_found');

  const opensAt = parseInstant(input.opensAt);
  if (opensAt === null) throw ValidationError.field('opens_at', 'Send an instant as YYYY-MM-DDTHH:MM:SSZ.');
  const closesAt = parseInstant(input.closesAt);
  if (closesAt === null) throw ValidationError.field('closes_at', 'Send an instant as YYYY-MM-DDTHH:MM:SSZ.');
  const hours = elapsedHours(opensAt, closesAt);
  if (hours === null || hours < 1 || hours > 72) {
    throw ValidationError.field('closes_at', 'A window lasts a whole number of hours, from 1 to 72.');
  }
  const capMlDay = requireCapMlDay('cap_ml_day', input.capMlDay);

  const rostered = input.rosteredOperator;
  const district = await pool.query<{ code: string }>(
    "select operator_code as code from users where operator_code = $1 and operator_kind = 'district' and erased = false",
    [typeof rostered === 'string' ? rostered : ''],
  );
  if (district.rows[0] === undefined) {
    throw ValidationError.field('rostered_operator', 'Choose a district operator.');
  }

  const overlapping = await pool.query<{ id: string }>(
    'select id from windows where channel_id = $1 and opens_at < $3 and closes_at > $2',
    [channelId, opensAt, closesAt],
  );
  if (overlapping.rows[0] !== undefined) {
    throw ValidationError.field('closes_at', 'Windows on one channel never overlap.');
  }

  const created = await transaction(async (client) => {
    const id = await nextWindowId(client, channelId);
    await client.query(
      `insert into windows (id, channel_id, opens_at, closes_at, hours, table_cap_ml_day, rostered_operator)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, channelId, opensAt, closesAt, hours, capMlDay.toString(), rostered as string],
    );
    const revision = await storeRevision(client, channelId, new Map([[id, capMlDay]]), savedBy, null);
    return { id, revision };
  });

  const window = (await windowRow(created.id)) as WindowRow;
  return {
    window: windowRecord(window, serverNow(), await channelFlows()),
    capacity_revision: created.revision,
  };
}

async function nextWindowId(client: Client, channelId: string): Promise<string> {
  const found = await client.query<{ count: string }>(
    'select count(*)::text as count from windows where channel_id = $1',
    [channelId],
  );
  const suffix = Number((found.rows[0] as { count: string }).count) + 1;
  return `W-${channelId.replace(/^C-/, '')}-${String(suffix).padStart(2, '0')}`;
}
