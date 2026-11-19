// The published state object, built for one viewer. A counterpart sees only the offers they are
// party to (every offer past its draft), the manifests, receipts and disputes of those offers,
// and the specimens they name.

import type pg from "pg";
import { CELLS } from "../shared/limits.js";
import type { AuditEvent, DeskEvent, DeskState, Offer, Party, Specimen } from "../shared/types.js";
import type { Desk, OfferRecord, SpecimenRecord } from "./desk.js";
import { offerItems, offerWindow, specimenStatus } from "./rules.js";

export function visibleOffers(desk: Desk, viewer: Party): OfferRecord[] {
  return [...desk.offers.values()].filter((o) => viewer === "dealer" || o.status !== "draft");
}

export function visibleSpecimenKeys(desk: Desk, viewer: Party): Set<string> {
  if (viewer === "dealer") {
    return new Set([...desk.specimens.values()].filter((s) => s.owner !== "outsider").map((s) => s.key));
  }
  const keys = new Set<string>();
  for (const offer of visibleOffers(desk, viewer)) {
    for (const key of [...offerItems(offer), ...offer.holds.map((h) => h.specimen)]) keys.add(key);
  }
  return keys;
}

export function specimenView(desk: Desk, s: SpecimenRecord): Specimen {
  return {
    display_label: s.display_label,
    owner: s.owner,
    status: specimenStatus(desk, s.key),
    version: s.version,
    holder: s.holder,
    attribution: s.attribution,
    quarantined: s.quarantined,
    missing: s.missing,
    photos: s.photos.map(({ id, label, object_key, sha256, width, height }) => ({ id, label, object_key, sha256, width, height })),
    annotations: s.annotations,
  };
}

export function offerView(desk: Desk, o: OfferRecord): Offer {
  return {
    version: o.version,
    status: o.status,
    dealer_items: o.dealer_items,
    counterpart_items: o.counterpart_items,
    acceptances: { dealer: o.acceptances.dealer?.version ?? null, counterpart: o.acceptances.counterpart?.version ?? null },
    holds: o.holds.map((h) => h.specimen),
    ...offerWindow(o, desk.now),
  };
}

export async function deskState(client: pg.PoolClient | pg.Pool, desk: Desk, viewer: Party): Promise<DeskState> {
  const offers = visibleOffers(desk, viewer);
  const offerKeys = new Set(offers.map((o) => o.key));
  const specimenKeys = visibleSpecimenKeys(desk, viewer);
  const events = await client.query<DeskEvent & { sequence: string }>(
    `SELECT command_id, actor, type, sequence, at FROM desk_events WHERE ns = $1 ${viewer === "dealer" ? "" : "AND offers && $2"}
     ORDER BY sequence`,
    viewer === "dealer" ? [desk.ns] : [desk.ns, [...offerKeys]],
  );
  const marks =
    viewer === "dealer"
      ? await client.query<AuditEvent & { sequence: string }>(
          "SELECT cell, mark, actor, sequence, command_id FROM audit_marks WHERE ns = $1 ORDER BY sequence",
          [desk.ns],
        )
      : null;
  const dealer = viewer === "dealer";
  return {
    version: desk.lastSequence,
    versions: { tray: desk.trayVersion, album: desk.albumVersion, keeper_order: desk.keeperVersion },
    specimens: Object.fromEntries(
      [...desk.specimens.values()].filter((s) => specimenKeys.has(s.key)).map((s) => [s.key, specimenView(desk, s)]),
    ),
    tray: dealer
      ? Object.fromEntries(
          CELLS.map((cell) => {
            const c = desk.cells.get(cell)!;
            return [cell, { specimen: c.specimen, audit_mark: c.audit_mark, audit_version: c.audit_version }];
          }),
        )
      : {},
    album: dealer && desk.album ? desk.album : {},
    keeper_order: dealer ? desk.keeperOrder : [],
    offers: Object.fromEntries(offers.map((o) => [o.key, offerView(desk, o)])),
    manifests: Object.fromEntries(
      [...desk.manifests.entries()]
        .filter(([, m]) => offerKeys.has(m.offer))
        .map(([key, m]) => [key, { version: m.version, order: m.order, frozen: m.frozen, evidence: m.evidence }]),
    ),
    receipts: Object.fromEntries(
      [...desk.receipts.entries()].filter(([, r]) => offerKeys.has(r.offer)).map(([key, r]) => [key, { confirmed: true, matches: r.matches }]),
    ),
    disputes: Object.fromEntries(
      [...desk.disputes.values()]
        .filter((d) => offerKeys.has(d.offer))
        .map(({ key, ...d }) => [key, d]),
    ),
    audit_events: marks ? marks.rows.map((m) => ({ ...m, sequence: Number(m.sequence) })) : [],
    events: events.rows.map((e) => ({ ...e, sequence: Number(e.sequence), at: new Date(e.at).toISOString() })),
  };
}
