import pg from 'pg';
import type { Config } from './db.js';
import { maskedRegistration } from './panels.js';
import { readPanels } from './model.js';
import { slotLabel, zoneName } from './time.js';
import type { LinkStatus, OfferStatus, LinkRole } from './domain.js';

export interface LinkRow {
  id: string; car_id: string; role: LinkRole; name: string; token_hash: string;
  status: string; created_at: Date; expires_at: Date; last_seen_at: Date | null;
}

/** Link status decided only by the server's clock and the revocation flag. */
export function linkStatus(row: { status: string; expires_at: Date }): LinkStatus {
  if (row.status === 'revoked') return 'revoked';
  if (row.expires_at.getTime() <= Date.now()) return 'expired';
  return 'active';
}

export async function findLinkByToken(client: pg.Pool | pg.PoolClient, token: string): Promise<{ link: LinkRow; status: LinkStatus } | null> {
  const { tokenHash } = await import('./crypto.js');
  const r = await client.query('SELECT * FROM links WHERE token_hash = $1', [tokenHash(token)]);
  if (r.rows.length === 0) return null;
  const link = r.rows[0] as LinkRow;
  return { link, status: linkStatus(link) };
}

export async function applyOfferLapse(client: pg.Pool | pg.PoolClient): Promise<void> {
  await client.query(`UPDATE offers SET status = 'lapsed' WHERE status IN ('open','needs_reread') AND lapses_at <= now()`);
}

/** A buyer's link view, with seen state against the current version's frozen content. */
export async function buyerLinkView(cfg: Config, client: pg.Pool | pg.PoolClient, link: LinkRow, car: { id: string; name: string; registration: string; asking_pounds: number; viewing_area: string; story: string; listing_status: string; current_version: number | null }): Promise<Record<string, unknown>> {
  await applyOfferLapse(client);
  const versionNumber = car.current_version ?? 0;
  const versionRow = await client.query('SELECT * FROM versions WHERE car_id = $1 AND number = $2', [car.id, versionNumber]);
  const content = versionRow.rows[0]?.content as { findings: frozenFindingShape[]; record: Record<string, unknown> } | undefined;
  const findings = content?.findings ?? [];
  const seen = await client.query('SELECT finding_id, finding_fingerprint, seen_at FROM seen_records WHERE link_id = $1', [link.id]);
  const seenByFinding = new Map(seen.rows.map((r: { finding_id: string; finding_fingerprint: string; seen_at: Date }) => [r.finding_id, r]));
  const materialUnseen = findings.filter((f: frozenFindingShape) => f.material && !(seenByFinding.get(f.id)?.finding_fingerprint === f.fingerprint)).length;
  const findingsView = findings.map((f: frozenFindingShape) => {
    const rec = seenByFinding.get(f.id);
    const isSeen = rec?.finding_fingerprint === f.fingerprint;
    return {
      id: f.id, position: f.position, panelId: f.panelId, panelLabel: f.panelLabel,
      u: f.u, v: f.v, title: f.title, wording: f.wording, severity: f.severity,
      material: f.material, band: f.band, photoId: f.photoId,
      seen: isSeen, seenAt: isSeen ? rec?.seen_at?.toISOString() ?? null : null,
      changedSinceSeen: !isSeen && rec !== undefined,
    };
  });
  const seenCount = findingsView.filter((f: { seen: boolean }) => f.seen).length;
  const removedFindings = await removedFindingsFor(client, link.id, car.id, versionNumber);
  const offerRow = await client.query('SELECT * FROM offers WHERE link_id = $1 ORDER BY stamped_at DESC LIMIT 1', [link.id]);
  const offer = offerRow.rows[0] ? offerView(offerRow.rows[0]) : null;
  const { panels } = await readPanels(client, car.id, 'buyer' as const);
  const record = content?.record ?? { pulledAt: null, firstUsedDate: '', tape: [], advisories: [], openAdvisories: 0 };
  const slots = await readSlots(client, car.id, link.id);
  const invoices = await client.query(`SELECT label FROM uploads WHERE car_id = $1 AND kind = 'invoice' ORDER BY created_at`, [car.id]);
  return {
    role: 'buyer', name: link.name, status: linkStatus(link), expiresAt: link.expires_at.toISOString(),
    serverNow: new Date().toISOString(),
    car: {
      name: car.name, maskedRegistration: maskedRegistration(car.registration),
      askingPounds: car.asking_pounds, viewingArea: car.viewing_area, story: car.story,
      listingStatus: car.listing_status, firstUsedDate: (record as { firstUsedDate?: string }).firstUsedDate ?? '',
    },
    version: content ? { number: versionNumber, publishedAt: versionRow.rows[0].published_at.toISOString() } : null,
    heroFindingId: heroOfFrozen(findings),
    findings: findingsView,
    removedFindings,
    progress: { seen: seenCount, total: findings.length, materialUnseen },
    panels,
    record,
    versionsRead: await readVersionsRead(client, link.id),
    slots,
    invoices: invoices.rows.map((r: { label: string }) => ({ label: r.label })),
    offer,
  };
}

export interface frozenFindingShape {
  id: string; position: number; panelId: string; panelLabel: string; u: number; v: number;
  title: string; wording: string; severity: string; material: boolean; band: string; photoId: string | null;
  fingerprint: string;
}

function heroOfFrozen(findings: frozenFindingShape[]): string | null {
  const order = (s: string) => (s === 'serious' ? 2 : s === 'moderate' ? 1 : 0);
  let best: frozenFindingShape | null = null;
  for (const f of findings) {
    if (!best || order(f.severity) > order(best.severity) || (order(f.severity) === order(best.severity) && f.position < best.position)) best = f;
  }
  return best ? best.id : null;
}

/** Every version in which this link holds a seen record, ascending. */
async function readVersionsRead(client: pg.Pool | pg.PoolClient, linkId: string): Promise<number[]> {
  const seen = await client.query(`
    SELECT DISTINCT v.number AS n
    FROM versions v
    JOIN seen_records sr ON sr.link_id = $1
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v.content->'findings') f WHERE f->>'id' = sr.finding_id)
    ORDER BY v.number`, [linkId]);
  return seen.rows.map((row: { n: number }) => row.n);
}

async function removedFindingsFor(client: pg.Pool | pg.PoolClient, linkId: string, carId: string, currentVersion: number): Promise<{ id: string; title: string; removedInVersion: number }[]> {
  const seen = await client.query('SELECT finding_id, seen_at FROM seen_records WHERE link_id = $1', [linkId]);
  const seenIds = new Set(seen.rows.map((r: { finding_id: string }) => r.finding_id));
  const current = await client.query('SELECT content FROM versions WHERE car_id = $1 AND number = $2', [carId, currentVersion]);
  const currentIds = new Set<string>(((current.rows[0]?.content as { findings: { id: string }[] } | undefined)?.findings ?? []).map((f) => f.id));
  const earlier = await client.query('SELECT number, content FROM versions WHERE car_id = $1 AND number < $2 ORDER BY number DESC', [carId, currentVersion]);
  const out: { id: string; title: string; removedInVersion: number }[] = [];
  const reported = new Set<string>();
  for (const row of earlier.rows) {
    const content = row.content as { findings: { id: string; title: string }[] };
    for (const f of content.findings) {
      if (seenIds.has(f.id) && !currentIds.has(f.id) && !reported.has(f.id)) {
        out.push({ id: f.id, title: f.title, removedInVersion: row.number });
        reported.add(f.id);
      }
    }
  }
  return out.reverse();
}

export function offerView(row: { id: string; amount_pounds: number; status: string; stamped_at: Date; lapses_at: Date }): Record<string, unknown> {
  const secondsRemaining = Math.max(0, Math.floor((row.lapses_at.getTime() - Date.now()) / 1000));
  return {
    id: row.id, amountPounds: row.amount_pounds, status: row.status as OfferStatus,
    stampedAt: row.stamped_at.toISOString(), lapsesAt: row.lapses_at.toISOString(),
    secondsRemaining,
  };
}

export async function readSlots(client: pg.Pool | pg.PoolClient, carId: string, viewer: 'owner' | { linkId: string } | string): Promise<unknown[]> {
  const rows = await client.query('SELECT * FROM slots WHERE car_id = $1 ORDER BY starts_at', [carId]);
  const holderNames = new Map<string, string>();
  if (viewer === 'owner') {
    const names = await client.query('SELECT l.id, l.name FROM links l JOIN slots s ON s.holder_link_id = l.id WHERE s.car_id = $1', [carId]);
    for (const r of names.rows) holderNames.set(r.id, r.name);
  }
  return rows.rows.map((s: { id: string; starts_at: Date; duration_minutes: number; holder_link_id: string | null }) => {
    const view: Record<string, unknown> = {
      id: s.id,
      localStart: londonWallTime(s.starts_at),
      zone: zoneOf(s.starts_at),
      startsAt: s.starts_at.toISOString(),
      durationMinutes: s.duration_minutes,
      label: slotLabel(s.starts_at),
      held: s.holder_link_id !== null,
      heldByYou: typeof viewer === 'string' ? s.holder_link_id === viewer : s.holder_link_id === viewer.linkId,
    };
    if (viewer === 'owner' && s.holder_link_id) view.holderName = holderNames.get(s.holder_link_id) ?? null;
    return view;
  });
}

function zoneOf(date: Date): 'GMT' | 'BST' {
  return zoneName(date);
}

/** Inspector view: role, name, status, car and panels only. */
export async function inspectorLinkView(cfg: Config, client: pg.Pool | pg.PoolClient, link: LinkRow, car: { id: string; registration: string; name: string }): Promise<Record<string, unknown>> {
  const { panels } = await readPanels(client, car.id, { linkId: link.id, name: link.name });
  return {
    role: 'inspector', name: link.name, status: linkStatus(link),
    expiresAt: link.expires_at.toISOString(), serverNow: new Date().toISOString(),
    car: { name: car.name, maskedRegistration: maskedRegistration(car.registration) },
    panels,
  };
}

export async function linkViewForOwnerTable(client: pg.Pool | pg.PoolClient, carId: string): Promise<unknown[]> {
  const rows = await client.query('SELECT * FROM links WHERE car_id = $1 ORDER BY created_at', [carId]);
  const findings = await client.query('SELECT count(*)::int AS n FROM findings WHERE car_id = $1', [carId]);
  const out = [];
  for (const link of rows.rows as LinkRow[]) {
    const seenCount = await countSeenForCurrent(client, carId, link.id);
    const materialUnseen = await countMaterialUnseen(client, carId, link.id);
    const offer = await client.query('SELECT status FROM offers WHERE link_id = $1 ORDER BY stamped_at DESC LIMIT 1', [link.id]);
    out.push({
      id: link.id, role: link.role, name: link.name, status: linkStatus(link),
      expiresAt: link.expires_at.toISOString(),
      secondsRemaining: linkStatus(link) === 'active' ? Math.max(0, Math.floor((link.expires_at.getTime() - Date.now()) / 1000)) : 0,
      seen: seenCount, total: link.role === 'buyer' ? findings.rows[0].n : 0,
      materialUnseen, lastSeenAt: link.last_seen_at?.toISOString() ?? null,
      offerStatus: offer.rows[0]?.status ?? null,
    });
  }
  return out;
}

async function countSeenForCurrent(client: pg.Pool | pg.PoolClient, carId: string, linkId: string): Promise<number> {
  const car = await client.query('SELECT current_version FROM cars WHERE id = $1', [carId]);
  const version = car.rows[0]?.current_version;
  if (!version) return 0;
  const content = await client.query('SELECT content FROM versions WHERE car_id = $1 AND number = $2', [carId, version]);
  const findings = ((content.rows[0]?.content as { findings: frozenFindingShape[] } | undefined)?.findings) ?? [];
  const seen = await client.query('SELECT finding_id, finding_fingerprint FROM seen_records WHERE link_id = $1', [linkId]);
  const map = new Map(seen.rows.map((r: { finding_id: string; finding_fingerprint: string }) => [r.finding_id, r.finding_fingerprint]));
  return findings.filter(f => map.get(f.id) === f.fingerprint).length;
}

async function countMaterialUnseen(client: pg.Pool | pg.PoolClient, carId: string, linkId: string): Promise<number> {
  const car = await client.query('SELECT current_version FROM cars WHERE id = $1', [carId]);
  const version = car.rows[0]?.current_version;
  if (!version) return 0;
  const content = await client.query('SELECT content FROM versions WHERE car_id = $1 AND number = $2', [carId, version]);
  const findings = ((content.rows[0]?.content as { findings: frozenFindingShape[] } | undefined)?.findings) ?? [];
  const seen = await client.query('SELECT finding_id, finding_fingerprint FROM seen_records WHERE link_id = $1', [linkId]);
  const map = new Map(seen.rows.map((r: { finding_id: string; finding_fingerprint: string }) => [r.finding_id, r.finding_fingerprint]));
  return findings.filter(f => f.material && map.get(f.id) !== f.fingerprint).length;
}


/** The London wall time of an instant, written YYYY-MM-DDTHH:mm. */
function londonWallTime(date: Date): string {
  const shifted = new Date(date.getTime() + zoneNameOffset(date) * 60_000);
  return `${shifted.toISOString().slice(0, 10)}T${shifted.toISOString().slice(11, 16)}`;
}

function zoneNameOffset(date: Date): number {
  return zoneName(date) === 'BST' ? 60 : 0;
}
