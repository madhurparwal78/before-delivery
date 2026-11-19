// Exchange commands between the dealer and a counterpart: sending an offer, review holds,
// replacements, acceptance, dispatch freezes, arrival photographs and receipts.

import { createHash, randomUUID } from "node:crypto";
import { basketFull, F } from "../../shared/feedback.js";
import { judgePhoto, PHOTO_EXTENSIONS, type PhotoVerdict } from "../../shared/photoRules.js";
import type { Party } from "../../shared/types.js";
import { type Body, flag, integer, keys as keyList, text } from "../body.js";
import { config } from "../config.js";
import type { Desk, ManifestRecord, OfferRecord, SpecimenRecord, StoredPhoto } from "../desk.js";
import { conflict, FieldErrors, forbidden, invalid, notFound, serviceUnavailable, tooLarge } from "../errors.js";
import { copyObject, putObject } from "../minio.js";
import { IN_TRANSIT, OPEN, RESPONDING } from "../../shared/offerStates.js";
import { offerItems, offerRefusal, startWindow } from "../rules.js";
import { offerView, visibleOffers, visibleSpecimenKeys } from "../state.js";
import { type Caller, type CommandSpec, notExpired, stale } from "./runner.js";


export function offerFor(desk: Desk, key: string, caller: Caller): OfferRecord {
  const offer = desk.offers.get(key);
  if (!offer || !visibleOffers(desk, caller.party).includes(offer)) throw notFound();
  return offer;
}

function visibleSpecimen(desk: Desk, key: string | null, caller: Caller): SpecimenRecord {
  if (key === null || !visibleSpecimenKeys(desk, caller.party).has(key)) throw notFound();
  return desk.specimen(key);
}

/** The party who receives a specimen of this offer: each side receives the other's items. */
export function receiverOf(offer: OfferRecord, key: string): Party | null {
  if (offer.dealer_items.includes(key)) return "counterpart";
  if (offer.counterpart_items.includes(key)) return "dealer";
  return null;
}

/** The arrival photograph a receiver took of a specimen for this offer. */
export function arrivalFor(s: SpecimenRecord, offer: string): StoredPhoto | undefined {
  return s.photos.filter((p) => p.label === "arrival" && p.offer === offer).at(-1);
}

/**
 * A committed change to an included specimen's attribution, photographs or annotations bumps every
 * open offer that includes it, clears both acceptances and restarts the dealer's window.
 */
export function touchOffersOf(desk: Desk, key: string): string[] {
  const touched: string[] = [];
  for (const offer of desk.offers.values()) {
    if (!OPEN.includes(offer.status) || !offerItems(offer).includes(key)) continue;
    changeOffer(desk, offer, "dealer");
    touched.push(offer.key);
  }
  return touched;
}

function changeOffer(desk: Desk, offer: OfferRecord, by: Party): void {
  offer.version += 1;
  offer.acceptances = { dealer: null, counterpart: null };
  offer.status = by === "dealer" ? "sent" : "countered";
  startWindow(offer, by, desk.now);
  offer.changed = desk.lastSequence + 1;
  desk.touch("offers", offer.key);
}

/** Swaps the owners of every item in one step and makes the offer transferred. */
export function transferOwnership(desk: Desk, offer: OfferRecord, commandId: string, actor: Party): void {
  for (const key of offerItems(offer)) {
    const s = desk.specimen(key);
    s.owner = offer.dealer_items.includes(key) ? "counterpart" : "dealer";
    s.transferred = true;
    s.version += 1;
    desk.touch("specimens", key);
    for (const cell of desk.cells.values()) {
      if (cell.specimen === key) {
        cell.specimen = null;
        desk.touch("cells", cell.cell);
        desk.trayVersion += 1;
      }
    }
  }
  offer.status = "transferred";
  desk.touch("offers", offer.key);
  desk.event("ownership.transferred", actor, commandId, [offer.key]);
}

// --- send -----------------------------------------------------------------------------------

export const sendOffer = (key: string): CommandSpec<Body, OfferRecord> => ({
  stepUp: true,
  locate(desk, body, caller) {
    const offer = offerFor(desk, key, caller);
    const sides = [
      { items: keyList(body, "dealer_items") ?? [], owner: "dealer" },
      { items: keyList(body, "counterpart_items") ?? [], owner: "counterpart" },
    ] as const;
    for (const side of sides) {
      for (const item of side.items) {
        const s = visibleSpecimen(desk, item, caller);
        if (s.owner !== side.owner) throw notFound();
      }
    }
    if (caller.party !== "dealer") throw forbidden();
    return offer;
  },
  conflicts(desk, body, offer) {
    notExpired(offer);
    stale(integer(body, "expected_version"), offer.version);
    if (offer.status !== "draft") throw conflict(F.CONFLICT);
    const items = [...(keyList(body, "dealer_items") ?? []), ...(keyList(body, "counterpart_items") ?? [])];
    const refusals = items.map((item) => offerRefusal(desk, item, offer.key));
    for (const copy of [F.OFFER_TAKEN, F.IN_OFFER, F.SET_UNCERTAIN, F.SET_OUTBOUND, F.CATALOG_PENDING]) if (refusals.includes(copy)) throw conflict(copy);
  },
  validate(_desk, body) {
    const errors = new FieldErrors();
    const max = config.limits.FLAN_OFFER_MAX_ITEMS;
    for (const field of ["dealer_items", "counterpart_items"]) {
      const items = keyList(body, field);
      if (items === null) errors.add(field, F.INVALID);
      else if (items.length === 0) errors.add(field, F.BASKET_EMPTY);
      else if (items.length > max) errors.add(field, basketFull(max));
      else if (new Set(items).size !== items.length) errors.add(field, F.ORDER);
    }
    errors.throwIfAny();
  },
  apply(desk, body, offer, _caller, commandId) {
    offer.dealer_items = keyList(body, "dealer_items")!;
    offer.counterpart_items = keyList(body, "counterpart_items")!;
    changeOffer(desk, offer, "dealer");
    desk.event("offer.sent", "dealer", commandId, [offer.key]);
    return { status: 200, body: { offer: offerView(desk, offer) } };
  },
});

// --- review holds ---------------------------------------------------------------------------

export const placeHold = (key: string): CommandSpec<Body, { offer: OfferRecord; s: SpecimenRecord }> => ({
  locate(desk, body, caller) {
    const offer = offerFor(desk, key, caller);
    const s = visibleSpecimen(desk, text(body, "specimen"), caller);
    if (caller.party !== "counterpart" || s.owner !== "dealer") throw forbidden();
    return { offer, s };
  },
  conflicts(desk, _body, { offer, s }) {
    notExpired(offer);
    if (!OPEN.includes(offer.status)) throw conflict(F.CONFLICT);
    if (offerItems(offer).includes(s.key) || offerRefusal(desk, s.key)) throw conflict(F.OFFER_TAKEN);
  },
  apply(desk, _body, { offer, s }, _caller, commandId) {
    // The hold's grace period runs on real time, so it is stamped with real time.
    offer.holds.push({ specimen: s.key, placed_at: new Date().toISOString() });
    desk.touch("offers", offer.key);
    desk.event("hold.placed", "counterpart", commandId, [offer.key], { specimen: s.key });
    return { status: 201, body: { hold: { specimen: s.key } } };
  },
});

export const releaseHold = (key: string, specimen: string): CommandSpec<Body, OfferRecord> => ({
  locate(desk, _body, caller) {
    const offer = offerFor(desk, key, caller);
    if (caller.party !== "counterpart") throw forbidden();
    return offer;
  },
  apply(desk, _body, offer, _caller, commandId) {
    if (offer.holds.some((h) => h.specimen === specimen)) releaseHeld(desk, offer, specimen, "counterpart", commandId);
    return { status: 204, body: null };
  },
});

/** Ends one review hold and tells the dealer's screen it is free again. */
export function releaseHeld(desk: Desk, offer: OfferRecord, specimen: string, actor: "counterpart" | "system", commandId: string): void {
  offer.holds = offer.holds.filter((h) => h.specimen !== specimen);
  desk.touch("offers", offer.key);
  desk.event("hold.released", actor, commandId, [offer.key], { specimen });
}

// --- replacement and acceptance ---------------------------------------------------------------

export const replaceSpecimen = (key: string): CommandSpec<Body, { offer: OfferRecord; remove: string; add: string }> => ({
  locate(desk, body, caller) {
    const offer = offerFor(desk, key, caller);
    const remove = text(body, "remove");
    if (remove === null || !offerItems(offer).includes(remove)) throw notFound();
    const added = visibleSpecimen(desk, text(body, "add"), caller);
    if (added.owner !== desk.specimen(remove).owner) throw notFound();
    return { offer, remove, add: added.key };
  },
  conflicts(desk, body, { offer, add }) {
    notExpired(offer);
    if ([...desk.manifests.values()].some((m) => m.offer === offer.key && m.frozen)) throw conflict(F.DISPATCH_FROZEN);
    stale(integer(body, "expected_version"), offer.version);
    if (!OPEN.includes(offer.status)) throw conflict(F.CONFLICT);
    if (offerItems(offer).includes(add)) throw conflict(F.OFFER_TAKEN);
    const refusal = offerRefusal(desk, add, offer.key);
    if (refusal) throw conflict(refusal);
  },
  apply(desk, _body, { offer, remove, add }, caller, commandId) {
    const swap = (items: string[]) => items.map((item) => (item === remove ? add : item));
    offer.dealer_items = swap(offer.dealer_items);
    offer.counterpart_items = swap(offer.counterpart_items);
    offer.holds = offer.holds.filter((h) => h.specimen !== add);
    changeOffer(desk, offer, caller.party);
    desk.event("offer.replaced", caller.party, commandId, [offer.key], { specimen: add, removed: remove });
    return { status: 200, body: { offer: offerView(desk, offer) } };
  },
});

export const acceptOffer = (key: string): CommandSpec<Body, OfferRecord> => ({
  stepUp: true,
  locate: (desk, _body, caller) => offerFor(desk, key, caller),
  conflicts(_desk, body, offer) {
    notExpired(offer);
    stale(integer(body, "expected_version"), offer.version);
    if (!RESPONDING.includes(offer.status)) throw conflict(F.CONFLICT);
  },
  apply(desk, _body, offer, caller, commandId) {
    offer.acceptances[caller.party] = { version: offer.version, subject: caller.session.subject };
    if (offer.acceptances.dealer?.version === offer.version && offer.acceptances.counterpart?.version === offer.version) {
      offer.status = "accepted";
      offer.expires_at = null;
      openManifests(desk, offer);
    }
    desk.touch("offers", offer.key);
    desk.event("offer.accepted", caller.party, commandId, [offer.key]);
    return { status: 200, body: { offer: offerView(desk, offer) } };
  },
});

// --- dispatch -------------------------------------------------------------------------------

/** An accepted offer gets one packing manifest per sender, listing that sender's current items. */
function openManifests(desk: Desk, offer: OfferRecord): void {
  for (const party of ["dealer", "counterpart"] as const) {
    const key = `${offer.key}/${party}`;
    const order = party === "dealer" ? offer.dealer_items : offer.counterpart_items;
    const existing = desk.manifests.get(key);
    desk.manifests.set(key, existing
      ? { ...existing, order, version: existing.version + 1 }
      : { offer: offer.key, party, version: 1, order, frozen: false, evidence: [] });
    desk.touch("manifests", key);
  }
}

interface FrozenCopies {
  evidence: { specimen: string; label: "dispatch"; object_key: string; sha256: string; source: StoredPhoto }[];
  keys: string[];
}

export const freezeManifest = (key: string, party: string): CommandSpec<Body, { offer: OfferRecord; manifest: ManifestRecord }, FrozenCopies> => ({
  locate(desk, _body, caller) {
    const offer = offerFor(desk, key, caller);
    const manifest = desk.manifests.get(`${key}/${party}`);
    if (!manifest) throw notFound();
    if (caller.party !== manifest.party) throw forbidden();
    return { offer, manifest };
  },
  conflicts(_desk, body, { offer, manifest }) {
    if (manifest.frozen) throw conflict(F.DISPATCH_FROZEN);
    notExpired(offer);
    stale(integer(body, "expected_version"), manifest.version);
    if (offer.status !== "accepted") throw conflict(F.CONFLICT);
  },
  validate(_desk, body, { offer, manifest }) {
    const order = keyList(body, "order");
    const items = manifest.party === "dealer" ? offer.dealer_items : offer.counterpart_items;
    const same = order !== null && order.length === items.length && new Set(order).size === order.length && order.every((k) => items.includes(k));
    if (!same) throw invalid({ order: F.ORDER });
  },
  async provide(desk, body, { manifest }) {
    const order = keyList(body, "order")!;
    const copies: FrozenCopies = { evidence: [], keys: [] };
    for (const item of order) {
      const source = desk.specimen(item).photos.filter((p) => p.label === "obverse").at(-1);
      // A desk seeded while MinIO was unreachable holds its fixtures without photographs (brief: Seeding rules);
      // that freeze has no evidence to copy and answers as the MinIO outage does.
      if (!source) throw serviceUnavailable();
      const extension = source.object_key.split(".").pop();
      const target = `manifests/${desk.ns}/${manifest.offer}/${manifest.party}/${item}-dispatch-${source.sha256}.${extension}`;
      await copyObject(source.object_key, target);
      copies.keys.push(target);
      copies.evidence.push({ specimen: item, label: "dispatch", object_key: target, sha256: source.sha256, source });
    }
    const record = `manifests/${desk.ns}/${manifest.offer}/${manifest.party}/manifest.json`;
    const evidence = copies.evidence.map(({ source: _source, ...e }) => e);
    await putObject(record, Buffer.from(JSON.stringify({ offer: manifest.offer, party: manifest.party, order, evidence })), "application/json");
    copies.keys.push(record);
    return copies;
  },
  written: (copies) => copies.keys,
  apply(desk, body, { offer, manifest }, caller, commandId, copies) {
    manifest.order = keyList(body, "order")!;
    manifest.frozen = true;
    manifest.version += 1;
    manifest.evidence = copies.evidence.map(({ source: _source, ...e }) => e);
    desk.touch("manifests", `${offer.key}/${manifest.party}`);
    for (const e of copies.evidence) {
      const s = desk.specimen(e.specimen);
      s.photos.push({ id: randomUUID(), label: "dispatch", object_key: e.object_key, sha256: e.sha256, width: e.source.width, height: e.source.height });
      desk.touch("specimens", s.key);
    }
    if ([...desk.manifests.values()].filter((m) => m.offer === offer.key).every((m) => m.frozen)) {
      offer.status = "dispatched";
      offer.version += 1;
      offer.changed = desk.lastSequence + 1;
      desk.touch("offers", offer.key);
    }
    desk.event("manifest.frozen", caller.party, commandId, [offer.key]);
    return { status: 200, body: { manifest: { version: manifest.version, order: manifest.order, frozen: true, evidence: manifest.evidence } } };
  },
});

// --- arrivals and receipts ----------------------------------------------------------------------

type AcceptedPhoto = Extract<PhotoVerdict, { ok: true }> & { bytes: Buffer };

export const saveArrival = (key: string): CommandSpec<Body, { offer: OfferRecord; s: SpecimenRecord }, StoredPhoto, AcceptedPhoto> => ({
  locate(desk, body, caller) {
    const offer = offerFor(desk, key, caller);
    const specimen = text(body, "specimen");
    if (specimen === null || receiverOf(offer, specimen) === null) throw notFound();
    if (receiverOf(offer, specimen) !== caller.party) throw forbidden();
    return { offer, s: desk.specimen(specimen) };
  },
  conflicts(_desk, _body, { offer }) {
    notExpired(offer);
    if (!IN_TRANSIT.includes(offer.status)) throw conflict(F.CONFLICT);
  },
  validate(_desk, body) {
    const part = body.files.photo;
    if (!part) throw invalid({ photo: F.ARRIVAL_MISSING });
    const verdict = judgePhoto(part.bytes, config.limits);
    if (!verdict.ok) throw verdict.oversized ? tooLarge({ photo: verdict.copy }) : invalid({ photo: verdict.copy });
    return { ...verdict, bytes: part.bytes };
  },
  async provide(desk, _body, { offer, s }, photo) {
    const sha256 = createHash("sha256").update(photo.bytes).digest("hex");
    const objectKey = `arrivals/${desk.ns}/${offer.key}/${s.key}-${sha256}.${PHOTO_EXTENSIONS[photo.kind]}`;
    await putObject(objectKey, photo.bytes, photo.contentType);
    return { id: randomUUID(), label: "arrival", object_key: objectKey, sha256, width: photo.width, height: photo.height, offer: offer.key };
  },
  written: (photo) => [photo.object_key],
  apply(desk, _body, { offer, s }, caller, commandId, stored) {
    s.photos.push(stored);
    s.version += 1;
    desk.touch("specimens", s.key);
    desk.event("arrival.saved", caller.party, commandId, [offer.key], { specimen: s.key });
    const { offer: _offer, ...photo } = stored;
    return { status: 201, body: { photo } };
  },
});

export const recordReceipt = (key: string): CommandSpec<Body, OfferRecord> => ({
  stepUp: true,
  locate: (desk, _body, caller) => offerFor(desk, key, caller),
  conflicts(desk, body, offer, caller) {
    notExpired(offer);
    stale(integer(body, "expected_version"), offer.version);
    if (!IN_TRANSIT.includes(offer.status) || desk.receipts.has(`${offer.key}/${caller.party}`)) throw conflict(F.CONFLICT);
  },
  validate(desk, body, offer, caller) {
    if (flag(body, "matches") === null) throw invalid({ matches: F.INVALID });
    const received = offerItems(offer).filter((item) => receiverOf(offer, item) === caller.party);
    if (received.some((item) => !arrivalFor(desk.specimen(item), offer.key))) throw invalid({ matches: F.ARRIVAL_MISSING });
  },
  apply(desk, body, offer, caller, commandId) {
    const matches = flag(body, "matches")!;
    desk.receipts.set(`${offer.key}/${caller.party}`, { offer: offer.key, party: caller.party, matches });
    desk.touch("receipts", `${offer.key}/${caller.party}`);
    offer.version += 1;
    offer.changed = desk.lastSequence + 1;
    desk.touch("offers", offer.key);
    const other = desk.receipts.get(`${offer.key}/${caller.party === "dealer" ? "counterpart" : "dealer"}`);
    if (offer.status !== "disputed") offer.status = "received";
    desk.event("receipt.recorded", caller.party, commandId, [offer.key]);
    if (offer.status === "received" && other?.matches && matches) transferOwnership(desk, offer, commandId, caller.party);
    return { status: 200, body: { receipt: { confirmed: true, matches }, offer: offerView(desk, offer) } };
  },
});
