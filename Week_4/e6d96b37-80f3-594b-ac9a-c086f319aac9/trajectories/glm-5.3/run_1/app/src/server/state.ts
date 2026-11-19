import type {
  AlbumState,
  Annotation,
  Attribution,
  AuditEvent,
  DeskEvent,
  DeskState,
  Dispute,
  DisputeMarker,
  Manifest,
  ManifestEvidence,
  Offer,
  PhotoRecord,
  Receipt,
  Specimen,
  TrayCellState,
} from "../shared/types.js";
import { pool } from "./db.js";
import { now as clockNow } from "./clock.js";
import type { FlanEnv } from "../shared/env.js";
import { TRAY_CELLS } from "../shared/util.js";

interface SpecimenRow {
  key: string;
  display_label: string;
  owner: string;
  status: string;
  version: number;
  holder_kind: string;
  holder_width_mm: number;
  holder_height_mm: number;
  attribution_reference: string;
  attribution_mintmark: string;
  attribution_revision: number;
  certainty: string;
  note: string;
  correction: string;
  register_state: string;
  quarantined: boolean;
  missing: boolean;
}

interface PhotoRow {
  id: string;
  specimen: string;
  label: string;
  object_key: string;
  sha256: string;
  width: number;
  height: number;
}

interface AnnotationRow {
  id: string;
  specimen: string;
  photo: string;
  x: number;
  y: number;
  text: string;
}

export async function loadState(env: FlanEnv, ns: string, viewerRole: "dealer" | "counterpart"): Promise<DeskState> {
  const [specimens, photos, annotations, tray, albumRows, holeRows, keeper, offers, manifests, receipts, disputes, markers, approvals, auditEvents, events] =
    await Promise.all([
      pool.query<SpecimenRow>("SELECT * FROM specimens WHERE ns = $1 ORDER BY key", [ns]),
      pool.query<PhotoRow>("SELECT id, specimen, label, object_key, sha256, width, height FROM photos WHERE ns = $1", [ns]),
      pool.query<AnnotationRow>("SELECT * FROM annotations WHERE ns = $1 ORDER BY id", [ns]),
      pool.query<{ cell: string; specimen: string | null; audit_mark: string | null; audit_version: number }>(
        "SELECT cell, specimen, audit_mark, audit_version FROM tray_cells WHERE ns = $1",
        [ns],
      ),
      pool.query<{ set: string; revision: number; version: number }>("SELECT set, revision, version FROM albums WHERE ns = $1", [ns]),
      pool.query<{ hole: string; reference: string; mintmark: string; specimen: string | null }>(
        "SELECT hole, reference, mintmark, specimen FROM album_holes WHERE ns = $1",
        [ns],
      ),
      pool.query<{ version: number; order_keys: string[] }>("SELECT version, order_keys FROM keeper_orders WHERE ns = $1", [ns]),
      pool.query<OfferRow>("SELECT * FROM offers WHERE ns = $1", [ns]),
      pool.query<ManifestRow>("SELECT offer, party, version, order_keys, frozen FROM manifests WHERE ns = $1", [ns]),
      pool.query<{ offer: string; party: string; confirmed: boolean; matches: boolean }>(
        "SELECT offer, party, confirmed, matches FROM receipts WHERE ns = $1",
        [ns],
      ),
      pool.query<DisputeRow>("SELECT * FROM disputes WHERE ns = $1", [ns]),
      pool.query<{ dispute: string; key: string; x: number; y: number; text: string }>(
        "SELECT dispute, key, x, y, text FROM dispute_markers WHERE ns = $1",
        [ns],
      ),
      pool.query<{ dispute: string; party: string }>("SELECT dispute, party FROM dispute_approvals WHERE ns = $1", [ns]),
      pool.query<{ cell: string; mark: string; actor: string; sequence: string; command_id: string }>(
        "SELECT cell, mark, actor, sequence, command_id FROM audit_marks WHERE ns = $1 ORDER BY sequence",
        [ns],
      ),
      pool.query<{ command_id: string; actor: string; type: string; sequence: string; at: Date }>(
        "SELECT command_id, actor, type, sequence, at FROM events WHERE ns = $1 ORDER BY sequence",
        [ns],
      ),
    ]);

  const specimenMap: Record<string, Specimen> = {};
  for (const row of specimens.rows) {
    specimenMap[row.key] = toSpecimen(row);
  }
  for (const photo of photos.rows) {
    const target = specimenMap[photo.specimen];
    if (target) {
      target.photos.push(toPhoto(photo));
    }
  }
  for (const annotation of annotations.rows) {
    const target = specimenMap[annotation.specimen];
    if (target) {
      target.annotations.push({
        id: annotation.id,
        photo: annotation.photo,
        x: annotation.x,
        y: annotation.y,
        text: annotation.text,
      });
    }
  }

  const trayState: Record<string, TrayCellState> = {};
  for (const cell of tray.rows) {
    trayState[cell.cell] = {
      specimen: cell.specimen ?? "",
      audit_mark: (cell.audit_mark as "missing" | null) ?? null,
      audit_version: cell.audit_version,
    };
  }

  const albumRow = albumRows.rows[0];
  const holes: Record<string, { reference: string; mintmark: string; specimen: string | null }> = {};
  for (const hole of holeRows.rows) {
    holes[hole.hole] = { reference: hole.reference, mintmark: hole.mintmark, specimen: hole.specimen };
  }
  const album: AlbumState = {
    set: albumRow?.set ?? "",
    revision: albumRow?.revision ?? 0,
    holes,
  };

  const keeperRow = keeper.rows[0];
  const trayVersionRow = await pool.query<{ version: number }>("SELECT version FROM tray_meta WHERE ns = $1", [ns]);
  const albumVersion = albumRow?.version ?? 1;
  const keeperVersion = keeperRow?.version ?? 1;

  const offerMap: Record<string, Offer> = {};
  for (const row of offers.rows) {
    offerMap[row.key] = await toOffer(env, ns, row, viewerRole);
  }

  const manifestMap: Record<string, Manifest> = {};
  for (const row of manifests.rows) {
    const evidence = await loadManifestEvidence(ns, row.offer, row.party);
    manifestMap[`${row.offer}/${row.party}`] = {
      version: row.version,
      order: row.order_keys,
      frozen: row.frozen,
      evidence,
    };
  }

  const receiptMap: Record<string, Receipt> = {};
  for (const row of receipts.rows) {
    receiptMap[`${row.offer}/${row.party}`] = { confirmed: row.confirmed, matches: row.matches };
  }

  const disputeMap: Record<string, Dispute> = {};
  for (const row of disputes.rows) {
    disputeMap[row.key] = toDispute(row, markers.rows.filter((m) => m.dispute === row.key), approvals.rows.filter((a) => a.dispute === row.key).map((a) => a.party as "dealer" | "counterpart"));
  }

  const auditEventList: AuditEvent[] = auditEvents.rows.map((row) => ({
    cell: row.cell,
    mark: "missing",
    actor: row.actor as AuditEvent["actor"],
    sequence: Number(row.sequence),
    command_id: row.command_id,
  }));

  const eventList: DeskEvent[] = events.rows.map((row) => ({
    command_id: row.command_id,
    actor: row.actor as DeskEvent["actor"],
    type: row.type as DeskEvent["type"],
    sequence: Number(row.sequence),
    at: new Date(row.at).toISOString(),
  }));

  const isCounterpart = viewerRole === "counterpart";
  if (isCounterpart) {
    const visibleSpecimens = new Set<string>();
    for (const offer of Object.values(offerMap)) {
      for (const item of [...offer.dealer_items, ...offer.counterpart_items]) {
        visibleSpecimens.add(item);
      }
    }
    for (const specimenKey of Object.keys(specimenMap)) {
      if (!visibleSpecimens.has(specimenKey)) {
        delete specimenMap[specimenKey];
      }
    }
  }

  const clock = await clockNow(ns);
  void clock;

  return {
    version: 1,
    versions: {
      tray: trayVersionRow.rows[0]?.version ?? 1,
      album: albumVersion,
      keeper_order: keeperVersion,
    },
    specimens: specimenMap,
    tray: isCounterpart ? {} : trayState,
    album: isCounterpart ? { set: "", revision: 0, holes: {} } : album,
    keeper_order: isCounterpart ? [] : (keeperRow?.order_keys ?? []),
    offers: offerMap,
    manifests: manifestMap,
    receipts: receiptMap,
    disputes: disputeMap,
    audit_events: isCounterpart ? [] : auditEventList,
    events: eventList,
  };
}

interface OfferRow {
  key: string;
  version: number;
  status: string;
  dealer_items: string[];
  counterpart_items: string[];
  dealer_acceptance_version: number | null;
  counterpart_acceptance_version: number | null;
  expires_at: Date | null;
}

async function toOffer(env: FlanEnv, ns: string, row: OfferRow, viewerRole: "dealer" | "counterpart"): Promise<Offer> {
  void viewerRole;
  const holdsRes = await pool.query<{ specimen: string }>("SELECT specimen FROM holds WHERE ns = $1 AND offer = $2", [ns, row.key]);
  const clock = await clockNow(ns);
  const status = row.status as Offer["status"];
  const window = offerWindow(status, row.expires_at, clock, env);
  return {
    version: row.version,
    status,
    dealer_items: row.dealer_items,
    counterpart_items: row.counterpart_items,
    acceptances: {
      dealer: row.dealer_acceptance_version,
      counterpart: row.counterpart_acceptance_version,
    },
    holds: holdsRes.rows.map((h) => h.specimen),
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    remaining_seconds: window.remaining,
    closing: window.closing,
  };
}

export function offerWindow(
  status: Offer["status"],
  expiresAt: Date | null,
  clock: Date,
  env: FlanEnv,
): { remaining: number | null; closing: boolean } {
  if (status === "sent" || status === "countered") {
    if (expiresAt === null) return { remaining: null, closing: false };
    const remaining = Math.max(0, Math.floor((expiresAt.getTime() - clock.getTime()) / 1000));
    return { remaining, closing: remaining <= env.FLAN_CLOSING_S };
  }
  if (status === "expired") {
    return { remaining: 0, closing: false };
  }
  return { remaining: null, closing: false };
}

interface ManifestRow {
  offer: string;
  party: string;
  version: number;
  order_keys: string[];
  frozen: boolean;
}

async function loadManifestEvidence(ns: string, offer: string, party: string): Promise<ManifestEvidence[]> {
  const direct = await pool.query<{ specimen: string; label: string; object_key: string; sha256: string }>(
    "SELECT specimen, label, object_key, sha256 FROM photos WHERE ns = $1 AND offer = $2 AND label = $3",
    [ns, offer, "dispatch"],
  );
  return direct.rows
    .map((r) => ({ specimen: r.specimen, label: r.label, object_key: r.object_key, sha256: r.sha256 }))
    .filter((r) => r.specimen.length > 0);
}

interface DisputeRow {
  key: string;
  offer: string;
  specimen: string;
  version: number;
  open: boolean;
  resolution_outcome: string | null;
  resolution_proposed_by: string | null;
}

function toDispute(
  row: DisputeRow,
  markers: { key: string; x: number; y: number; text: string }[],
  approvals: ("dealer" | "counterpart")[],
): Dispute {
  const markerList: DisputeMarker[] = markers.map((m) => ({ id: m.key, x: m.x, y: m.y, text: m.text }));
  return {
    offer: row.offer,
    specimen: row.specimen,
    version: row.version,
    open: row.open,
    markers: markerList,
    resolution:
      row.resolution_outcome !== null && row.resolution_proposed_by !== null
        ? { outcome: row.resolution_outcome as "transfer" | "return", proposed_by: row.resolution_proposed_by as "dealer" | "counterpart" }
        : null,
    resolution_approvals: approvals,
  };
}

function toSpecimen(row: SpecimenRow): Specimen {
  const attribution: Attribution = {
    reference: row.attribution_reference,
    mintmark: row.attribution_mintmark,
    revision: row.attribution_revision,
    certainty: row.certainty as "certain" | "uncertain",
    note: row.note,
    correction: row.correction,
    register: row.register_state as "stored" | "pending",
  };
  return {
    display_label: row.display_label,
    owner: row.owner as Specimen["owner"],
    status: row.status as Specimen["status"],
    version: row.version,
    holder: {
      kind: row.holder_kind as "flip" | "slab" | "capsule",
      width_mm: row.holder_width_mm,
      height_mm: row.holder_height_mm,
    },
    attribution,
    quarantined: row.quarantined,
    missing: row.missing,
    photos: [],
    annotations: [],
  };
}

function toPhoto(row: PhotoRow): PhotoRecord {
  return {
    id: row.id,
    label: row.label as PhotoRecord["label"],
    object_key: row.object_key,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
  };
}
