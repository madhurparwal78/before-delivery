import type { FlanEnv } from "../shared/env.js";
import type { AlbumState, Dispute, Manifest, Offer, PhotoRecord, Specimen } from "../shared/types.js";
import { now as clockNow } from "./clock.js";
import type { OfferRow, SpecimenRow, Tx } from "./domain.js";
import { offerWindowStatus } from "./domain.js";

export async function photosOf(tx: Tx, ns: string, specimen: string): Promise<PhotoRecord[]> {
  const res = await tx.query<{ id: string; label: string; object_key: string; sha256: string; width: number; height: number }>(
    "SELECT id, label, object_key, sha256, width, height FROM photos WHERE ns = $1 AND specimen = $2 ORDER BY id",
    [ns, specimen],
  );
  return res.rows.map((r) => ({
    id: r.id,
    label: r.label as PhotoRecord["label"],
    object_key: r.object_key,
    sha256: r.sha256,
    width: r.width,
    height: r.height,
  }));
}

export async function annotationsOf(tx: Tx, ns: string, specimen: string): Promise<Specimen["annotations"]> {
  const res = await tx.query<{ id: string; photo: string; x: number; y: number; text: string }>(
    "SELECT id, photo, x, y, text FROM annotations WHERE ns = $1 AND specimen = $2 ORDER BY id",
    [ns, specimen],
  );
  return res.rows.map((r) => ({ id: r.id, photo: r.photo, x: r.x, y: r.y, text: r.text }));
}

export function specimenBase(row: SpecimenRow): Specimen {
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
    attribution: {
      reference: row.attribution_reference,
      mintmark: row.attribution_mintmark,
      revision: row.attribution_revision,
      certainty: row.certainty as "certain" | "uncertain",
      note: row.note,
      correction: row.correction,
      register: row.register_state as "stored" | "pending",
    },
    quarantined: row.quarantined,
    missing: row.missing,
    photos: [],
    annotations: [],
  };
}

export async function specimenJson(tx: Tx, ns: string, key: string): Promise<Specimen> {
  const res = await tx.query<SpecimenRow>("SELECT * FROM specimens WHERE ns = $1 AND key = $2", [ns, key]);
  const row = res.rows[0];
  const base = specimenBase(row);
  base.photos = await photosOf(tx, ns, key);
  base.annotations = await annotationsOf(tx, ns, key);
  return base;
}

export async function trayJson(tx: Tx, ns: string): Promise<Record<string, { specimen: string; audit_mark: "missing" | null; audit_version: number }>> {
  const res = await tx.query<{ cell: string; specimen: string | null; audit_mark: string | null; audit_version: number }>(
    "SELECT cell, specimen, audit_mark, audit_version FROM tray_cells WHERE ns = $1",
    [ns],
  );
  const out: Record<string, { specimen: string; audit_mark: "missing" | null; audit_version: number }> = {};
  for (const row of res.rows) {
    out[row.cell] = {
      specimen: row.specimen ?? "",
      audit_mark: (row.audit_mark as "missing" | null) ?? null,
      audit_version: row.audit_version,
    };
  }
  return out;
}

export async function albumJson(tx: Tx, ns: string): Promise<AlbumState> {
  const album = await tx.query<{ set: string; revision: number }>("SELECT set, revision FROM albums WHERE ns = $1", [ns]);
  const holes = await tx.query<{ hole: string; reference: string; mintmark: string; specimen: string | null }>(
    "SELECT hole, reference, mintmark, specimen FROM album_holes WHERE ns = $1 ORDER BY hole",
    [ns],
  );
  const holeMap: AlbumState["holes"] = {};
  for (const hole of holes.rows) {
    holeMap[hole.hole] = { reference: hole.reference, mintmark: hole.mintmark, specimen: hole.specimen };
  }
  return {
    set: album.rows[0]?.set ?? "",
    revision: album.rows[0]?.revision ?? 0,
    holes: holeMap,
  };
}

export async function offerJson(tx: Tx, ns: string, key: string, env: FlanEnv): Promise<Offer> {
  const res = await tx.query<OfferRow>("SELECT * FROM offers WHERE ns = $1 AND key = $2", [ns, key]);
  const row = res.rows[0];
  const holds = await tx.query<{ specimen: string }>("SELECT specimen FROM holds WHERE ns = $1 AND offer = $2", [ns, key]);
  const clock = await clockNow(ns);
  const window = offerWindowStatus(row, clock, env);
  return {
    version: row.version,
    status: row.status as Offer["status"],
    dealer_items: row.dealer_items,
    counterpart_items: row.counterpart_items,
    acceptances: {
      dealer: row.dealer_acceptance_version,
      counterpart: row.counterpart_acceptance_version,
    },
    holds: holds.rows.map((h) => h.specimen),
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    remaining_seconds: window.remaining,
    closing: window.closing,
  };
}

export async function manifestJson(tx: Tx, ns: string, offer: string, party: string): Promise<Manifest> {
  const res = await tx.query<{ version: number; order_keys: string[]; frozen: boolean }>(
    "SELECT version, order_keys, frozen FROM manifests WHERE ns = $1 AND offer = $2 AND party = $3",
    [ns, offer, party],
  );
  const row = res.rows[0];
  const evidence = await tx.query<{ specimen: string; label: string; object_key: string; sha256: string }>(
    "SELECT specimen, label, object_key, sha256 FROM photos WHERE ns = $1 AND offer = $2 AND label = 'dispatch' ORDER BY id",
    [ns, offer],
  );
  const partyItems = new Set(
    party === "dealer"
      ? (await tx.query<{ dealer_items: string[] }>("SELECT dealer_items FROM offers WHERE ns = $1 AND key = $2", [ns, offer])).rows[0]?.dealer_items ?? []
      : (await tx.query<{ counterpart_items: string[] }>("SELECT counterpart_items FROM offers WHERE ns = $1 AND key = $2", [ns, offer])).rows[0]?.counterpart_items ?? [],
  );
  return {
    version: row?.version ?? 1,
    order: row?.order_keys ?? [],
    frozen: row?.frozen ?? false,
    evidence: evidence.rows
      .filter((e) => partyItems.has(e.specimen))
      .map((e) => ({ specimen: e.specimen, label: e.label, object_key: e.object_key, sha256: e.sha256 })),
  };
}

export async function keeperJson(tx: Tx, ns: string): Promise<string[]> {
  const res = await tx.query<{ order_keys: string[] }>("SELECT order_keys FROM keeper_orders WHERE ns = $1", [ns]);
  return res.rows[0]?.order_keys ?? [];
}

export async function disputeJson(tx: Tx, ns: string, key: string): Promise<Dispute> {
  const res = await tx.query<{ offer: string; specimen: string; version: number; open: boolean; resolution_outcome: string | null; resolution_proposed_by: string | null }>(
    "SELECT offer, specimen, version, open, resolution_outcome, resolution_proposed_by FROM disputes WHERE ns = $1 AND key = $2",
    [ns, key],
  );
  const row = res.rows[0];
  if (!row) throw new Error("dispute missing");
  const markers = await tx.query<{ key: string; x: number; y: number; text: string }>(
    "SELECT key, x, y, text FROM dispute_markers WHERE ns = $1 AND dispute = $2 ORDER BY key",
    [ns, key],
  );
  const approvals = await tx.query<{ party: string }>(
    "SELECT party FROM dispute_approvals WHERE ns = $1 AND dispute = $2",
    [ns, key],
  );
  return {
    offer: row.offer,
    specimen: row.specimen,
    version: row.version,
    open: row.open,
    markers: markers.rows.map((m) => ({ id: m.key, x: m.x, y: m.y, text: m.text })),
    resolution:
      row.resolution_outcome && row.resolution_proposed_by
        ? { outcome: row.resolution_outcome as "transfer" | "return", proposed_by: row.resolution_proposed_by as "dealer" | "counterpart" }
        : null,
    resolution_approvals: approvals.rows.map((a) => a.party as "dealer" | "counterpart"),
  };
}
