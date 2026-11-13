import { randomBytes, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { type Queryable, type Row, query, queryOne, transact } from '../db/pool.js';
import { writeEvent } from '../events/outbox.js';
import { problem } from '../http/problem.js';
import { renderPdf, PressUnavailable } from '../services/press.js';
import { rigSheetHtml } from '../services/rigsheet.js';
import { deleteObject, putObject, StoreUnreachable } from '../services/store.js';
import {
  type CircuitLoad,
  circuitLoads,
  layoutCells,
  layoutView,
  lowestContrast,
  placementStatus,
  requireLayout,
} from './layouts.js';
import { SHELF, siteLocation } from './kit.js';
import { requireSite, staleFacts } from './sites.js';

const ATTEMPT_BEAT_MILLISECONDS = 4_000;
const ATTEMPT_STALE_SECONDS = 12;

type SheetStatus = 'Draft' | 'Issued' | 'Out of step' | 'Withdrawn';

interface SheetCircuit extends CircuitLoad {
  readonly live: boolean;
  readonly confirmedAt: string | null;
}

interface SheetView {
  readonly id: string;
  readonly layoutId: string;
  readonly version: number;
  readonly status: SheetStatus;
  readonly issuedAt: string;
  readonly layoutHash: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly key: string;
  readonly techUrl: string | null;
  readonly linkEndsAt: string;
  readonly linkActive: boolean;
  readonly lowestContrast: number | null;
  readonly circuits: readonly SheetCircuit[];
}

interface SheetRecord {
  readonly id: string;
  readonly layoutId: string;
  readonly version: number;
  readonly status: SheetStatus;
  readonly issuedAt: Date;
  readonly layoutHash: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly objectKey: string;
  readonly lowestContrast: number | null;
  readonly linkEndsAt: Date;
}

function toSheet(row: Row): SheetRecord {
  return {
    id: row['id'] as string,
    layoutId: row['layout_id'] as string,
    version: Number(row['version']),
    status: row['status'] as SheetStatus,
    issuedAt: row['issued_at'] as Date,
    layoutHash: row['layout_hash'] as string,
    sha256: row['sha256'] as string,
    bytes: Number(row['bytes']),
    objectKey: row['object_key'] as string,
    lowestContrast: row['lowest_contrast'] === null ? null : Number(row['lowest_contrast']),
    linkEndsAt: row['link_ends_at'] as Date,
  };
}

async function findSheet(sheetId: string): Promise<SheetRecord | null> {
  if (!/^[0-9a-f-]{36}$/.test(sheetId)) return null;
  const row = await queryOne('select * from sheets where id = $1', [sheetId]);
  return row === null ? null : toSheet(row);
}

export async function requireSheet(sheetId: string): Promise<SheetRecord> {
  const sheet = await findSheet(sheetId);
  if (sheet === null) throw problem('not_found');
  return sheet;
}

function sheetObjectKey(sheetId: string): string {
  return `sheets/${sheetId}/rig-sheet.pdf`;
}

async function sheetCircuits(sheet: SheetRecord): Promise<SheetCircuit[]> {
  const layout = await requireLayout(sheet.layoutId);
  const loads = await circuitLoads(layout);
  const ticks = await query('select circuit_id, live, confirmed_at from circuit_confirmations where sheet_id = $1', [
    sheet.id,
  ]);
  const byCircuit = new Map<string, { live: boolean; confirmedAt: Date }>();
  for (const tick of ticks) {
    byCircuit.set(tick['circuit_id'] as string, {
      live: tick['live'] as boolean,
      confirmedAt: tick['confirmed_at'] as Date,
    });
  }
  return loads.map((load) => {
    const tick = byCircuit.get(load.id);
    return {
      ...load,
      live: tick?.live ?? false,
      confirmedAt: tick === undefined ? null : tick.confirmedAt.toISOString(),
    };
  });
}

async function activeLink(sheetId: string): Promise<string | null> {
  const row = await queryOne<{ token: string }>('select token from sheet_links where sheet_id = $1 and active', [
    sheetId,
  ]);
  return row?.token ?? null;
}

export async function sheetView(sheet: SheetRecord): Promise<SheetView> {
  const [circuits, token] = await Promise.all([sheetCircuits(sheet), activeLink(sheet.id)]);
  const windowOpen = Date.now() < sheet.linkEndsAt.getTime();
  const linkActive = token !== null && windowOpen && sheet.status !== 'Withdrawn';
  return {
    id: sheet.id,
    layoutId: sheet.layoutId,
    version: sheet.version,
    status: sheet.status,
    issuedAt: sheet.issuedAt.toISOString(),
    layoutHash: sheet.layoutHash,
    sha256: sheet.sha256,
    bytes: sheet.bytes,
    key: sheet.objectKey,
    techUrl: linkActive ? `/rig/${token}` : null,
    linkEndsAt: sheet.linkEndsAt.toISOString(),
    linkActive,
    lowestContrast: sheet.lowestContrast,
    circuits,
  };
}

async function changeStatus(client: Queryable, sheetId: string, status: SheetStatus): Promise<void> {
  await client.query('update sheets set status = $2 where id = $1', [sheetId, status]);
  await writeEvent(client, 'sheet.changed', sheetId, { id: sheetId, status }, sheetId);
}

/** Issues a rig sheet: nothing is Issued until the PDF is stored and read back. */
export async function issueSheet(layoutId: string): Promise<SheetView> {
  const layout = await requireLayout(layoutId);
  const existing = await queryOne('select * from sheets where layout_id = $1 and status <> $2', [layoutId, 'Withdrawn']);
  const current = existing === null ? null : toSheet(existing);
  if (current?.status === 'Issued') throw problem('sheet_already_issued');

  const unbodied = layout.placements.filter((placement) => placementStatus(placement) !== 'Bodied').length;
  if (unbodied > 0 || layout.placements.length === 0) {
    throw problem('layout_needs_bodies', { placeholders: { n: String(unbodied) } });
  }

  const site = await requireSite(layout.siteId);
  const serials = layout.placements.flatMap((placement) => [placement.bodySerial as string, placement.lensSerial]);
  const places = await query(
    'select serial, location from units where serial = any($1::text[])',
    [serials],
  );
  const located = new Map(places.map((row) => [row['serial'] as string, row['location'] as string]));
  for (const serial of serials) {
    const location = located.get(serial);
    if (location !== SHELF && location !== siteLocation(site.id)) {
      throw problem('body_not_available', { placeholders: { serial } });
    }
  }

  const loads = await circuitLoads(layout);
  const overloaded = loads.find((circuit) => circuit.overloaded);
  if (overloaded !== undefined) {
    throw problem('circuit_overloaded', {
      placeholders: {
        name: overloaded.name,
        load: String(overloaded.loadWatts),
        capacity: String(overloaded.capacityWatts),
      },
    });
  }

  const sheetId = randomUUID();
  const attemptId = randomUUID();
  await sweepIssueAttempts();
  await transact(async (client) => {
    await client.query('insert into issue_attempts (id, layout_id, sheet_id, state) values ($1, $2, $3, $4)', [
      attemptId,
      layoutId,
      sheetId,
      'rendering',
    ]);
    for (const serial of serials) {
      // A serial is free to claim, or already bound to the sheet this issue replaces.
      const taken = await client.query(
        `insert into serial_bindings (serial, attempt_id) values ($1, $2)
         on conflict (serial) do update set attempt_id = excluded.attempt_id
           where serial_bindings.attempt_id is null and serial_bindings.sheet_id = $3
         returning serial`,
        [serial, attemptId, current?.id ?? null],
      );
      if (taken.rows.length === 0) throw problem('body_in_issued_rig', { placeholders: { serial } });
    }
  });

  // Only a stopped process stops beating, so its attempt is swept while a slow press or store is not.
  const beating = setInterval(() => {
    void query('update issue_attempts set heartbeat_at = now() where id = $1', [attemptId]).catch(() => undefined);
  }, ATTEMPT_BEAT_MILLISECONDS);
  try {
    const stale = await staleFacts(site.id);
    const cells = await layoutCells(layout, stale.stale);
    const lowest = lowestContrast(cells.cells);
    const version = Number(
      (await queryOne<{ next: string }>('select coalesce(max(version), 0) + 1 as next from sheets where layout_id = $1', [
        layoutId,
      ]))?.next ?? '1',
    );
    const pdf = await renderPdf(
      rigSheetHtml({
        siteName: site.name,
        layoutName: layout.name,
        version,
        showAt: site.showAt,
        lowestContrast: lowest,
        widthMetres: Number(site.widthMetres),
        heightMetres: Number(site.heightMetres),
        placements: layoutView(layout).placements,
        circuits: loads,
      }),
    );
    const stored = await putObject(sheetObjectKey(sheetId), pdf, 'application/pdf');
    await transact(async (client) => {
      const layoutNow = await client.query('select version from layouts where id = $1 for update', [layoutId]);
      const active = await client.query(
        `select id, status from sheets where layout_id = $1 and status <> 'Withdrawn' for update`,
        [layoutId],
      );
      const standing = active.rows[0];
      if (standing !== undefined && standing['id'] !== current?.id) throw problem('sheet_already_issued');
      if (standing !== undefined && standing['status'] === 'Issued') throw problem('sheet_already_issued');
      const claimed = await client.query('select 1 from serial_bindings where attempt_id = $1', [attemptId]);
      if (claimed.rows.length !== serials.length) throw problem('body_in_issued_rig', { placeholders: { serial: serials[0] as string } });
      if (standing !== undefined) await changeStatus(client, standing['id'] as string, 'Withdrawn');
      const issuedAt = new Date();
      // A layout edit that landed while the sheet was being pressed leaves it out of step from its first moment.
      const status: SheetStatus = Number(layoutNow.rows[0]?.['version']) === layout.version ? 'Issued' : 'Out of step';
      await client.query(
        `insert into sheets (id, layout_id, version, status, issued_at, layout_hash, sha256, bytes, object_key, lowest_contrast, link_ends_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          sheetId,
          layoutId,
          version,
          status,
          issuedAt.toISOString(),
          layout.hash,
          stored.sha256,
          stored.bytes,
          stored.key,
          lowest,
          new Date(issuedAt.getTime() + config.techLinkSeconds * 1000).toISOString(),
        ],
      );
      await client.query('update serial_bindings set sheet_id = $2, attempt_id = null where attempt_id = $1', [
        attemptId,
        sheetId,
      ]);
      if (standing !== undefined) await client.query('delete from serial_bindings where sheet_id = $1', [standing['id']]);
      await client.query('delete from issue_attempts where id = $1', [attemptId]);
      await client.query('insert into sheet_links (token, sheet_id) values ($1, $2)', [newToken(), sheetId]);
      await writeEvent(client, 'sheet.changed', sheetId, { id: sheetId, status }, sheetId);
    });
  } catch (error) {
    await abandonAttempt(attemptId, sheetId);
    if (error instanceof PressUnavailable) throw problem('press_unavailable');
    if (error instanceof StoreUnreachable) throw problem('sheet_store_unavailable');
    throw error;
  } finally {
    clearInterval(beating);
  }
  return sheetView(await requireSheet(sheetId));
}

/** Gives back the serials an unfinished issue claimed: free ones go free, those of the replaced sheet stay with it. */
async function releaseClaims(attemptId: string): Promise<void> {
  await query('delete from serial_bindings where attempt_id = $1 and sheet_id is null', [attemptId]);
  await query('update serial_bindings set attempt_id = null where attempt_id = $1', [attemptId]);
}

async function abandonAttempt(attemptId: string, sheetId: string): Promise<void> {
  await releaseClaims(attemptId);
  await query('delete from issue_attempts where id = $1', [attemptId]);
  try {
    await deleteObject(sheetObjectKey(sheetId));
  } catch (error) {
    if (!(error instanceof StoreUnreachable)) throw error;
  }
}

/** Clears issue attempts left behind by a process that stopped mid-issue. */
export async function sweepIssueAttempts(): Promise<void> {
  const stale = await query(
    `delete from issue_attempts where heartbeat_at < now() - interval '${ATTEMPT_STALE_SECONDS} seconds' returning id, sheet_id`,
  );
  for (const row of stale) {
    await releaseClaims(row['id'] as string);
    try {
      await deleteObject(sheetObjectKey(row['sheet_id'] as string));
    } catch (error) {
      if (!(error instanceof StoreUnreachable)) throw error;
    }
  }
}

function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function withdrawSheet(sheetId: string): Promise<SheetView> {
  const sheet = await requireSheet(sheetId);
  if (sheet.status === 'Withdrawn') throw problem('sheet_withdrawn');
  await transact(async (client) => {
    await changeStatus(client, sheetId, 'Withdrawn');
    await client.query('delete from serial_bindings where sheet_id = $1 and attempt_id is null', [sheetId]);
    await client.query('update serial_bindings set sheet_id = null where sheet_id = $1', [sheetId]);
    await client.query('update sheet_links set active = false where sheet_id = $1 and active', [sheetId]);
  });
  return sheetView(await requireSheet(sheetId));
}

export async function regenerateLink(sheetId: string): Promise<SheetView> {
  const sheet = await requireSheet(sheetId);
  if (sheet.status === 'Withdrawn') throw problem('sheet_withdrawn');
  if (Date.now() >= sheet.linkEndsAt.getTime()) throw problem('link_window_over');
  await transact(async (client) => {
    await client.query('update sheet_links set active = false where sheet_id = $1 and active', [sheetId]);
    await client.query('insert into sheet_links (token, sheet_id) values ($1, $2)', [newToken(), sheetId]);
  });
  return sheetView(await requireSheet(sheetId));
}

export async function endLink(sheetId: string): Promise<void> {
  await requireSheet(sheetId);
  await query('update sheet_links set active = false where sheet_id = $1 and active', [sheetId]);
}

interface ResolvedLink {
  readonly token: string;
  readonly sheet: SheetRecord;
}

/** Resolves a capability token: window first, then the link's own end. */
export async function resolveLink(token: string): Promise<ResolvedLink> {
  const row = await queryOne(
    `select s.*, sl.active from sheet_links sl join sheets s on s.id = sl.sheet_id where sl.token = $1`,
    [token],
  );
  if (row === null) throw problem('link_not_found');
  const sheet = toSheet(row);
  if (Date.now() >= sheet.linkEndsAt.getTime()) throw problem('link_window_over');
  if (row['active'] !== true || sheet.status === 'Withdrawn') throw problem('link_ended');
  return { token, sheet };
}

const LINK_WINDOW_SECONDS = 60;
const LINK_REQUEST_LIMIT = 30;

/** At most 30 served requests per link in any rolling 60 seconds, across all processes. */
export async function countLinkRequest(token: string): Promise<void> {
  await transact(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [token]);
    const served = await client.query(
      `select at from link_requests where token = $1 and at > now() - interval '${LINK_WINDOW_SECONDS} seconds' order by at`,
      [token],
    );
    if (served.rows.length >= LINK_REQUEST_LIMIT) {
      const oldest = served.rows[served.rows.length - LINK_REQUEST_LIMIT] as { at: Date };
      const freesIn = Math.max(1, Math.ceil((oldest.at.getTime() + LINK_WINDOW_SECONDS * 1000 - Date.now()) / 1000));
      throw problem('link_rate_limited', { headers: { 'Retry-After': String(freesIn) } });
    }
    await client.query('insert into link_requests (token) values ($1)', [token]);
  });
}

export async function pruneLinkRequests(): Promise<void> {
  await query(`delete from link_requests where at < now() - interval '10 minutes'`);
}

interface RigView {
  readonly siteName: string;
  readonly layoutName: string;
  readonly sheetStatus: SheetStatus;
  readonly issuedAt: string;
  readonly linkEndsAt: string;
  readonly showAt: string;
  readonly lowestContrast: number | null;
  readonly circuits: readonly SheetCircuit[];
}

export async function rigView(sheet: SheetRecord): Promise<RigView> {
  const layout = await requireLayout(sheet.layoutId);
  const site = await requireSite(layout.siteId);
  return {
    siteName: site.name,
    layoutName: layout.name,
    sheetStatus: sheet.status,
    issuedAt: sheet.issuedAt.toISOString(),
    linkEndsAt: sheet.linkEndsAt.toISOString(),
    showAt: site.showAt.toISOString(),
    lowestContrast: sheet.lowestContrast,
    circuits: await sheetCircuits(sheet),
  };
}

export async function setCircuitLive(sheet: SheetRecord, circuitId: string, live: boolean): Promise<SheetCircuit> {
  const layout = await requireLayout(sheet.layoutId);
  const owned = await queryOne('select id from circuits where id = $1 and site_id = $2', [circuitId, layout.siteId]);
  if (owned === null) throw problem('not_found');
  await transact(async (client) => {
    const changed = await client.query(
      `insert into circuit_confirmations (sheet_id, circuit_id, live, confirmed_at)
       select $1, $2, $3, now()
       where $3 or exists (select 1 from circuit_confirmations where sheet_id = $1 and circuit_id = $2)
       on conflict (sheet_id, circuit_id) do update set live = excluded.live, confirmed_at = excluded.confirmed_at
       where circuit_confirmations.live <> excluded.live
       returning confirmed_at`,
      [sheet.id, circuitId, live],
    );
    const confirmedAt = changed.rows[0]?.['confirmed_at'];
    if (confirmedAt === undefined) return;
    await writeEvent(
      client,
      'circuit.confirmed',
      sheet.id,
      { circuitId, live, confirmedAt: (confirmedAt as Date).toISOString() },
      sheet.id,
    );
  });
  const circuits = await sheetCircuits(sheet);
  const circuit = circuits.find((entry) => entry.id === circuitId);
  if (circuit === undefined) throw problem('not_found');
  return circuit;
}
