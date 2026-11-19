import { limits } from '../config.ts';
import { db, tx, type Sql } from '../providers/db.ts';
import { namespaceNow } from '../domain/clock.ts';
import {
  hasLapsed,
  isOpenOffer,
  itemsAreOutbound,
  reservesItems,
  windowView,
} from '../domain/offer.ts';
import { statusOf } from '../domain/specimen.ts';
import { appendEvent, publish, type AppendedEvent } from './events.ts';
import type {
  Album,
  AlbumHole,
  Annotation,
  Attribution,
  AuditEvent,
  DeskEvent,
  DeskState,
  Dispute,
  Holder,
  KeyedSpecimen,
  Manifest,
  Offer,
  Party,
  Photo,
  Receipt,
  Role,
  Specimen,
  TrayCell,
} from '../../shared/types.ts';

/* -- row shapes ---------------------------------------------------------- */

interface SpecimenRow {
  key: string;
  display_label: string;
  owner: string;
  version: number;
  holder: Holder;
  attribution: Attribution;
  quarantined: boolean;
  missing: boolean;
  created_seq: string;
}

interface PhotoRow {
  id: string;
  specimen: string;
  label: string;
  object_key: string;
  sha256: string;
  width: number;
  height: number;
  content_type: string;
}

interface AnnotationRow {
  id: string;
  specimen: string;
  photo: string;
  x: number;
  y: number;
  text: string;
}

interface CellRow {
  cell: string;
  specimen: string | null;
  audit_mark: string | null;
  audit_version: number;
  row_index: number;
  col_index: number;
  width_mm: number;
  height_mm: number;
}

interface OfferRow {
  key: string;
  version: number;
  status: string;
  dealer_items: string[];
  counterpart_items: string[];
  accept_dealer: number | null;
  accept_counterpart: number | null;
  expires_at: Date | null;
}

interface ManifestRow {
  offer: string;
  party: string;
  version: number;
  ordering: string[];
  frozen: boolean;
  evidence: Manifest['evidence'];
}

interface DisputeRow {
  key: string;
  offer: string;
  specimen: string;
  version: number;
  open: boolean;
  note: string;
  outcome: string | null;
  proposed_by: string | null;
  approvals: Party[];
}

/* -- expiry sweep -------------------------------------------------------- */

/**
 * Expiry is decided on the namespace clock whenever an offer is read or
 * written, so a read first settles any lapsed offer: its reservations and holds
 * are released and `offer.expired` is appended.
 */
export async function expireLapsedOffers(ns: string): Promise<void> {
  const lapsed = await tx(async (sql) => {
    const now = await namespaceNow(sql, ns);
    const found = await sql.query<OfferRow>(
      `SELECT key, version, status, dealer_items, counterpart_items,
              accept_dealer, accept_counterpart, expires_at
         FROM offers WHERE ns = $1 FOR UPDATE`,
      [ns],
    );
    const events: AppendedEvent[] = [];
    for (const offer of found.rows) {
      if (!hasLapsed(offer.status as Offer['status'], offer.expires_at, now)) continue;
      await sql.query('UPDATE offers SET status = $3 WHERE ns = $1 AND key = $2', [
        ns,
        offer.key,
        'expired',
      ]);
      await sql.query('DELETE FROM offer_holds WHERE ns = $1 AND offer = $2', [ns, offer.key]);
      events.push(
        await appendEvent(sql, ns, {
          type: 'offer.expired',
          actor: 'system',
          commandId: null,
          payload: { offer: offer.key },
        }),
      );
    }
    return events;
  });
  publish(ns, lapsed);
}

/* -- reading ------------------------------------------------------------- */

export interface LoadedDesk {
  state: DeskState;
  /** Every specimen with its key, in creation sequence, for the paged list. */
  specimensInOrder: KeyedSpecimen[];
  /** Tray cells in row-major order, for the audit walk. */
  cellsInOrder: CellRow[];
  photoById: Map<string, PhotoRow>;
}

/**
 * Builds the published state object. A counterpart's state holds only the
 * offers, manifests, receipts and disputes they are party to, plus the
 * specimens those name; their tray and album are empty.
 *
 * Passing `client` reads inside a command's own transaction, so a reply
 * describes the state that command is committing. Expiry is only settled on
 * the pool path, since a write transaction is already in progress otherwise.
 */
export async function loadDesk(
  ns: string,
  viewer: Role,
  client?: Sql,
): Promise<LoadedDesk> {
  if (!client) await expireLapsedOffers(ns);
  const sql = client ?? (await db());
  const now = await namespaceNow(sql, ns);

  // These run one after another: inside a command's transaction they share a
  // single client, which can only carry one query at a time.
  const specimenRows = await sql.query<SpecimenRow>(
    `SELECT key, display_label, owner, version, holder, attribution, quarantined, missing, created_seq
       FROM specimens WHERE ns = $1 ORDER BY created_seq`,
    [ns],
  );
  const photoRows = await sql.query<PhotoRow>(
    `SELECT id, specimen, label, object_key, sha256, width, height, content_type
       FROM photos WHERE ns = $1 ORDER BY created_seq`,
    [ns],
  );
  const annotationRows = await sql.query<AnnotationRow>(
    'SELECT id, specimen, photo, x, y, text FROM annotations WHERE ns = $1 ORDER BY id',
    [ns],
  );
  const cellRows = await sql.query<CellRow>(
    `SELECT cell, specimen, audit_mark, audit_version, row_index, col_index, width_mm, height_mm
       FROM tray_cells WHERE ns = $1 ORDER BY row_index, col_index`,
    [ns],
  );
  const trayRow = await sql.query<{ version: number }>('SELECT version FROM trays WHERE ns = $1', [ns]);
  const albumRow = await sql.query<{ set_key: string | null; revision: number | null; version: number }>(
    'SELECT set_key, revision, version FROM albums WHERE ns = $1',
    [ns],
  );
  const holeRows = await sql.query<{ label: string; reference: string; mintmark: string; specimen: string | null }>(
    'SELECT label, reference, mintmark, specimen FROM album_holes WHERE ns = $1 ORDER BY position',
    [ns],
  );
  const keeperRow = await sql.query<{ ordering: string[]; version: number }>(
    'SELECT ordering, version FROM keeper_orders WHERE ns = $1',
    [ns],
  );
  const offerRows = await sql.query<OfferRow>(
    `SELECT key, version, status, dealer_items, counterpart_items,
            accept_dealer, accept_counterpart, expires_at
       FROM offers WHERE ns = $1 ORDER BY created_seq`,
    [ns],
  );
  const holdRows = await sql.query<{ offer: string; specimen: string }>(
    'SELECT offer, specimen FROM offer_holds WHERE ns = $1',
    [ns],
  );
  const manifestRows = await sql.query<ManifestRow>(
    'SELECT offer, party, version, ordering, frozen, evidence FROM manifests WHERE ns = $1',
    [ns],
  );
  const receiptRows = await sql.query<{ offer: string; party: string; confirmed: boolean; matches: boolean }>(
    'SELECT offer, party, confirmed, matches FROM receipts WHERE ns = $1',
    [ns],
  );
  const disputeRows = await sql.query<DisputeRow>(
    `SELECT key, offer, specimen, version, open, note, outcome, proposed_by, approvals
       FROM disputes WHERE ns = $1 ORDER BY created_seq`,
    [ns],
  );
  const markerRows = await sql.query<{ id: string; dispute: string; x: number; y: number; text: string }>(
    'SELECT id, dispute, x, y, text FROM dispute_markers WHERE ns = $1 ORDER BY position',
    [ns],
  );
  const auditRows = await sql.query<{ cell: string; actor: string; sequence: string; command_id: string }>(
    'SELECT cell, actor, sequence, command_id FROM audit_marks WHERE ns = $1 ORDER BY sequence',
    [ns],
  );
  const eventRows = await sql.query<{ command_id: string | null; actor: string; type: string; sequence: string; at: Date }>(
    'SELECT command_id, actor, type, sequence, at FROM desk_events WHERE ns = $1 ORDER BY sequence',
    [ns],
  );

  /* -- reservations decide specimen status -- */

  const reserved = new Set<string>();
  const outbound = new Set<string>();
  const transferredByOffer = new Set<string>();
  for (const offer of offerRows.rows) {
    const status = offer.status as Offer['status'];
    const items = [...offer.dealer_items, ...offer.counterpart_items];
    if (reservesItems(status)) for (const key of items) reserved.add(key);
    if (itemsAreOutbound(status)) for (const key of items) outbound.add(key);
    if (status === 'transferred') for (const key of items) transferredByOffer.add(key);
  }
  for (const hold of holdRows.rows) reserved.add(hold.specimen);

  const shelved = new Set<string>();
  for (const cell of cellRows.rows) if (cell.specimen) shelved.add(cell.specimen);

  const photosOf = new Map<string, Photo[]>();
  const photoById = new Map<string, PhotoRow>();
  for (const photo of photoRows.rows) {
    photoById.set(photo.id, photo);
    const list = photosOf.get(photo.specimen) ?? [];
    list.push({
      id: photo.id,
      label: photo.label as Photo['label'],
      object_key: photo.object_key,
      sha256: photo.sha256,
      width: photo.width,
      height: photo.height,
    });
    photosOf.set(photo.specimen, list);
  }

  const annotationsOf = new Map<string, Annotation[]>();
  for (const row of annotationRows.rows) {
    const list = annotationsOf.get(row.specimen) ?? [];
    list.push({ id: row.id, photo: row.photo, x: row.x, y: row.y, text: row.text });
    annotationsOf.set(row.specimen, list);
  }

  const specimensInOrder: KeyedSpecimen[] = specimenRows.rows.map((row) => {
    const specimen: Specimen = {
      display_label: row.display_label,
      owner: row.owner as Specimen['owner'],
      status: statusOf({
        attribution: row.attribution,
        quarantined: row.quarantined,
        missing: row.missing,
        shelved: shelved.has(row.key),
        reservedOrHeld: reserved.has(row.key),
        outbound: outbound.has(row.key),
        transferred: transferredByOffer.has(row.key),
      }),
      version: row.version,
      holder: row.holder,
      attribution: row.attribution,
      quarantined: row.quarantined,
      missing: row.missing,
      photos: photosOf.get(row.key) ?? [],
      annotations: annotationsOf.get(row.key) ?? [],
    };
    return { key: row.key, ...specimen };
  });

  /* -- offers, manifests, receipts, disputes -- */

  const holdsOf = new Map<string, string[]>();
  for (const hold of holdRows.rows) {
    const list = holdsOf.get(hold.offer) ?? [];
    list.push(hold.specimen);
    holdsOf.set(hold.offer, list);
  }

  const offers: Record<string, Offer> = {};
  for (const row of offerRows.rows) {
    const status = row.status as Offer['status'];
    offers[row.key] = {
      version: row.version,
      status,
      dealer_items: row.dealer_items,
      counterpart_items: row.counterpart_items,
      acceptances: { dealer: row.accept_dealer, counterpart: row.accept_counterpart },
      holds: holdsOf.get(row.key) ?? [],
      ...windowView(status, row.expires_at, now),
    };
  }

  const manifests: Record<string, Manifest> = {};
  for (const row of manifestRows.rows) {
    manifests[`${row.offer}/${row.party}`] = {
      version: row.version,
      order: row.ordering,
      frozen: row.frozen,
      evidence: row.evidence,
    };
  }

  const receipts: Record<string, Receipt> = {};
  for (const row of receiptRows.rows) {
    receipts[`${row.offer}/${row.party}`] = {
      confirmed: row.confirmed,
      matches: row.matches,
    };
  }

  const markersOf = new Map<string, Dispute['markers']>();
  for (const row of markerRows.rows) {
    const list = markersOf.get(row.dispute) ?? [];
    list.push({ id: row.id, x: row.x, y: row.y, text: row.text });
    markersOf.set(row.dispute, list);
  }

  const disputes: Record<string, Dispute> = {};
  for (const row of disputeRows.rows) {
    disputes[row.key] = {
      offer: row.offer,
      specimen: row.specimen,
      version: row.version,
      open: row.open,
      markers: markersOf.get(row.key) ?? [],
      resolution:
        row.outcome && row.proposed_by
          ? {
              outcome: row.outcome as 'transfer' | 'return',
              proposed_by: row.proposed_by as Party,
            }
          : null,
      resolution_approvals: row.approvals,
    };
  }

  const tray: Record<string, TrayCell> = {};
  for (const row of cellRows.rows) {
    tray[row.cell] = {
      specimen: row.specimen,
      audit_mark: row.audit_mark as TrayCell['audit_mark'],
      audit_version: row.audit_version,
    };
  }

  const holes: Record<string, AlbumHole> = {};
  for (const row of holeRows.rows) {
    holes[row.label] = {
      reference: row.reference,
      mintmark: row.mintmark,
      specimen: row.specimen,
    };
  }
  const album: Album = {
    set: albumRow.rows[0]?.set_key ?? null,
    revision: albumRow.rows[0]?.revision ?? null,
    holes,
  };

  const auditEvents: AuditEvent[] = auditRows.rows.map((row) => ({
    cell: row.cell,
    mark: 'missing',
    actor: row.actor as AuditEvent['actor'],
    sequence: Number(row.sequence),
    command_id: row.command_id,
  }));

  const events: DeskEvent[] = eventRows.rows.map((row) => ({
    command_id: row.command_id,
    actor: row.actor as DeskEvent['actor'],
    type: row.type as DeskEvent['type'],
    sequence: Number(row.sequence),
    at: row.at.toISOString(),
  }));

  const version = events.length > 0 ? (events[events.length - 1] as DeskEvent).sequence : 0;

  const specimens: Record<string, Specimen> = {};
  for (const { key, ...specimen } of specimensInOrder) specimens[key] = specimen;

  const full: DeskState = {
    version,
    versions: {
      tray: trayRow.rows[0]?.version ?? 1,
      album: albumRow.rows[0]?.version ?? 1,
      keeper_order: keeperRow.rows[0]?.version ?? 1,
    },
    specimens,
    tray,
    album,
    keeper_order: keeperRow.rows[0]?.ordering ?? [],
    offers,
    manifests,
    receipts,
    disputes,
    audit_events: auditEvents,
    events,
  };

  return {
    state: viewer === 'counterpart' ? narrowToCounterpart(full) : full,
    specimensInOrder,
    cellsInOrder: cellRows.rows,
    photoById,
  };
}

/**
 * A counterpart sees only the exchange side: the offers, manifests, receipts
 * and disputes they are party to, plus the specimens those name.
 */
function narrowToCounterpart(full: DeskState): DeskState {
  const visibleSpecimens = new Set<string>();
  for (const offer of Object.values(full.offers)) {
    for (const key of [...offer.dealer_items, ...offer.counterpart_items, ...offer.holds]) {
      visibleSpecimens.add(key);
    }
  }
  for (const dispute of Object.values(full.disputes)) visibleSpecimens.add(dispute.specimen);

  const specimens: Record<string, Specimen> = {};
  for (const [key, specimen] of Object.entries(full.specimens)) {
    if (visibleSpecimens.has(key)) specimens[key] = specimen;
  }

  return {
    ...full,
    specimens,
    tray: {},
    album: { set: null, revision: null, holes: {} },
    keeper_order: [],
    audit_events: [],
  };
}

/* -- derived counts ------------------------------------------------------ */

export interface DeskCounts {
  openOffers: number;
  awaitingReceipt: number;
  dealerSpecimens: number;
  occupiedCells: number;
  takenInToday: number;
  cataloguePending: number;
  anyClosing: boolean;
}

/** Every count covers only records the viewer may see. */
export function countsOf(state: DeskState, today: string): DeskCounts {
  let openOffers = 0;
  let awaitingReceipt = 0;
  let anyClosing = false;
  for (const offer of Object.values(state.offers)) {
    if (isOpenOffer(offer.status)) {
      openOffers += 1;
      if (offer.closing) anyClosing = true;
    }
    if (offer.status === 'dispatched' || offer.status === 'received') awaitingReceipt += 1;
  }

  let dealerSpecimens = 0;
  let cataloguePending = 0;
  for (const specimen of Object.values(state.specimens)) {
    if (
      specimen.owner === 'dealer' &&
      specimen.status !== 'transferred' &&
      specimen.status !== 'missing'
    ) {
      dealerSpecimens += 1;
    }
    if (specimen.attribution.register === 'pending') cataloguePending += 1;
  }

  let occupiedCells = 0;
  for (const cell of Object.values(state.tray)) if (cell.specimen) occupiedCells += 1;

  // Only a `specimen.created` event dated today counts as taken in today;
  // seeded fixture specimens have no such event.
  let takenInToday = 0;
  for (const event of state.events) {
    if (event.type === 'specimen.created' && event.at.slice(0, 10) === today) takenInToday += 1;
  }

  return {
    openOffers,
    awaitingReceipt,
    dealerSpecimens,
    occupiedCells,
    takenInToday,
    cataloguePending,
    anyClosing,
  };
}

export { limits as stateLimits };
