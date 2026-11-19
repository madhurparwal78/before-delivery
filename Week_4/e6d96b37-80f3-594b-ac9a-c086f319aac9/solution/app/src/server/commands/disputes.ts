// Damage disputes: opening the transfer hold with an evidence snapshot, moving markers,
// proposing and approving a resolution, and private expiring evidence links.

import { randomBytes, randomUUID } from "node:crypto";
import { F, textLong } from "../../shared/feedback.js";
import { characters } from "../../shared/textRules.js";
import type { Party } from "../../shared/types.js";
import { type Body, integer, type JsonObject, objects, text } from "../body.js";
import { config } from "../config.js";
import type { Desk, DisputeRecord, EvidenceLinkRecord, OfferRecord, StoredPhoto } from "../desk.js";
import { conflict, FieldErrors, forbidden, invalid, notFound } from "../errors.js";
import { putObject } from "../minio.js";
import { offerView, visibleOffers } from "../state.js";
import { arrivalFor, offerFor, receiverOf, transferOwnership } from "./exchange.js";
import { type Caller, type CommandSpec, notExpired, stale } from "./runner.js";

function coordinate(value: number | null, size: number): boolean {
  return value !== null && value >= 0 && value <= size - 1;
}

function markerErrors(errors: FieldErrors, field: string, x: number | null, y: number | null, label: string | null, arrival: StoredPhoto): void {
  if (!coordinate(x, arrival.width) || !coordinate(y, arrival.height)) errors.add(field, F.COORD);
  const max = config.limits.FLAN_NOTE_MAX_CHARS;
  if (label === null) errors.add(field === "markers" ? field : "text", F.INVALID);
  else if (characters(label) > max) errors.add(field === "markers" ? field : "text", textLong(max));
}

function disputeView({ key: _key, ...dispute }: DisputeRecord) {
  return dispute;
}

function disputeFor(desk: Desk, key: string, caller: Caller): { dispute: DisputeRecord; offer: OfferRecord } {
  const dispute = desk.disputes.get(key);
  const offer = dispute ? desk.offers.get(dispute.offer) : undefined;
  if (!dispute || !offer || !visibleOffers(desk, caller.party).includes(offer)) throw notFound();
  return { dispute, offer };
}

function openOnly(dispute: DisputeRecord): void {
  if (!dispute.open) throw conflict(F.CONFLICT);
}

// --- opening --------------------------------------------------------------------------------

interface Snapshot {
  key: string;
  dispute: string;
}

export const openDispute = (key: string): CommandSpec<Body, { offer: OfferRecord; specimen: string; arrival: StoredPhoto | undefined }, Snapshot> => ({
  locate(desk, body, caller) {
    const offer = offerFor(desk, key, caller);
    const specimen = text(body, "specimen");
    if (specimen === null || receiverOf(offer, specimen) === null) throw notFound();
    if (receiverOf(offer, specimen) !== caller.party) throw forbidden();
    return { offer, specimen, arrival: arrivalFor(desk.specimen(specimen), offer.key) };
  },
  conflicts(_desk, body, { offer }) {
    notExpired(offer);
    stale(integer(body, "expected_version"), offer.version);
    if (offer.status !== "dispatched" && offer.status !== "received") throw conflict(F.CONFLICT);
  },
  validate(_desk, body, { arrival }) {
    const errors = new FieldErrors();
    const note = text(body, "note");
    const max = config.limits.FLAN_NOTE_MAX_CHARS;
    if (note === null) errors.add("note", F.INVALID);
    else if (characters(note) > max) errors.add("note", textLong(max));
    const markers = objects(body, "markers");
    if (!arrival) errors.add("markers", F.ARRIVAL_MISSING);
    else if (markers === null || markers.length === 0) errors.add("markers", F.COORD);
    else for (const m of markers) markerErrors(errors, "markers", numberOf(m.x), numberOf(m.y), stringOf(m.text), arrival);
    errors.throwIfAny();
  },
  async provide(desk, body, { offer, specimen, arrival }) {
    const dispute = `dispute-${desk.nextDispute}`;
    const evidence = [...desk.manifests.values()]
      .flatMap((m) => (m.offer === offer.key ? m.evidence : []))
      .find((e) => e.specimen === specimen);
    const snapshot = {
      dispute,
      offer: offer.key,
      specimen,
      note: text(body, "note"),
      markers: objects(body, "markers"),
      dispatch_object_key: evidence?.object_key ?? null,
      arrival_object_key: arrival!.object_key,
    };
    const objectKey = `disputes/${desk.ns}/${dispute}/evidence-${desk.lastSequence + 1}.json`;
    await putObject(objectKey, Buffer.from(JSON.stringify(snapshot)), "application/json");
    return { key: objectKey, dispute };
  },
  written: (snapshot) => [snapshot.key],
  apply(desk, body, { offer, specimen }, caller, commandId, snapshot) {
    const dispute: DisputeRecord = {
      key: snapshot.dispute,
      offer: offer.key,
      specimen,
      version: 1,
      open: true,
      markers: objects(body, "markers")!.map((m) => ({ id: randomUUID(), x: numberOf(m.x)!, y: numberOf(m.y)!, text: stringOf(m.text)! })),
      resolution: null,
      resolution_approvals: [],
    };
    desk.disputes.set(dispute.key, dispute);
    desk.touch("disputes", dispute.key);
    desk.nextDispute += 1;
    offer.status_before_dispute = offer.status;
    offer.status = "disputed";
    offer.version += 1;
    offer.changed = desk.lastSequence + 1;
    desk.touch("offers", offer.key);
    desk.event("dispute.opened", caller.party, commandId, [offer.key], { specimen });
    return { status: 201, body: { dispute: disputeView(dispute) } };
  },
});

function numberOf(value: JsonObject[string] | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function stringOf(value: JsonObject[string] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

// --- markers and resolution -------------------------------------------------------------------

export const moveMarker = (key: string, marker: string): CommandSpec<Body, { dispute: DisputeRecord; offer: OfferRecord }> => ({
  locate(desk, _body, caller) {
    const found = disputeFor(desk, key, caller);
    if (!found.dispute.markers.some((m) => m.id === marker)) throw notFound();
    return found;
  },
  conflicts(_desk, body, { dispute }) {
    stale(integer(body, "expected_version"), dispute.version);
    openOnly(dispute);
  },
  validate(desk, body, { dispute, offer }) {
    const errors = new FieldErrors();
    const arrival = arrivalFor(desk.specimen(dispute.specimen), offer.key)!;
    const x = integer(body, "x");
    const y = integer(body, "y");
    if (!coordinate(x, arrival.width)) errors.add("x", F.COORD);
    if (!coordinate(y, arrival.height)) errors.add("y", F.COORD);
    const label = text(body, "text");
    const max = config.limits.FLAN_NOTE_MAX_CHARS;
    if (label === null) errors.add("text", F.INVALID);
    else if (characters(label) > max) errors.add("text", textLong(max));
    errors.throwIfAny();
  },
  apply(desk, body, { dispute, offer }, caller, commandId) {
    dispute.markers = dispute.markers.map((m) => (m.id === marker ? { id: m.id, x: integer(body, "x")!, y: integer(body, "y")!, text: text(body, "text")! } : m));
    dispute.version += 1;
    desk.touch("disputes", dispute.key);
    desk.event("marker.moved", caller.party, commandId, [offer.key]);
    return { status: 200, body: { dispute: disputeView(dispute) } };
  },
});

export const proposeResolution = (key: string): CommandSpec<Body, { dispute: DisputeRecord; offer: OfferRecord }> => ({
  locate: (desk, _body, caller) => disputeFor(desk, key, caller),
  conflicts(_desk, body, { dispute }) {
    stale(integer(body, "expected_version"), dispute.version);
    openOnly(dispute);
  },
  validate(_desk, body) {
    const outcome = text(body, "outcome");
    if (outcome !== "transfer" && outcome !== "return") throw invalid({ outcome: F.INVALID });
  },
  apply(desk, body, { dispute, offer }, caller, commandId) {
    dispute.resolution = { outcome: text(body, "outcome") as "transfer" | "return", proposed_by: caller.party };
    dispute.resolution_approvals = [caller.party];
    dispute.version += 1;
    desk.touch("disputes", dispute.key);
    desk.event("resolution.proposed", caller.party, commandId, [offer.key]);
    return { status: 200, body: { dispute: disputeView(dispute) } };
  },
});

export const approveResolution = (key: string): CommandSpec<Body, { dispute: DisputeRecord; offer: OfferRecord }> => ({
  locate(desk, _body, caller) {
    const found = disputeFor(desk, key, caller);
    if (found.dispute.resolution?.proposed_by === caller.party) throw forbidden();
    return found;
  },
  conflicts(_desk, body, { dispute }) {
    stale(integer(body, "expected_version"), dispute.version);
    openOnly(dispute);
    if (dispute.resolution === null) throw conflict(F.CONFLICT);
  },
  apply(desk, _body, { dispute, offer }, caller, commandId) {
    dispute.resolution_approvals = [...dispute.resolution_approvals, caller.party];
    dispute.open = false;
    dispute.version += 1;
    desk.touch("disputes", dispute.key);
    offer.version += 1;
    offer.changed = desk.lastSequence + 1;
    desk.touch("offers", offer.key);
    desk.event("resolution.approved", caller.party, commandId, [offer.key]);
    resolve(desk, offer, dispute.resolution!.outcome, caller.party, commandId);
    return { status: 200, body: { dispute: disputeView(dispute), offer: offerView(desk, offer) } };
  },
});

function resolve(desk: Desk, offer: OfferRecord, outcome: "transfer" | "return", actor: Party, commandId: string): void {
  if (outcome === "return") {
    offer.status = "returned";
    desk.event("offer.returned", actor, commandId, [offer.key]);
    return;
  }
  const receipts = (["dealer", "counterpart"] as const).filter((party) => desk.receipts.has(`${offer.key}/${party}`));
  if (receipts.length === 2) transferOwnership(desk, offer, commandId, actor);
  else offer.status = receipts.length === 0 ? "dispatched" : "received";
}

// --- evidence links -------------------------------------------------------------------------

export const createLink = (key: string): CommandSpec<Body, { dispute: DisputeRecord; offer: OfferRecord }> => ({
  locate: (desk, _body, caller) => disputeFor(desk, key, caller),
  apply(desk, _body, { dispute, offer }, caller, commandId) {
    const link: EvidenceLinkRecord = {
      token: randomBytes(24).toString("base64url"),
      dispute: dispute.key,
      expires_at: new Date(desk.now.getTime() + config.limits.FLAN_LINK_TTL_S * 1000).toISOString(),
      revoked: false,
    };
    desk.links.set(link.token, link);
    desk.touch("links", link.token);
    desk.event("link.created", caller.party, commandId, [offer.key]);
    return { status: 201, body: { link: { token: link.token, url: `${config.publicUrl}/evidence/${link.token}`, expires_at: link.expires_at } } };
  },
});

export const revokeLink = (key: string, token: string): CommandSpec<Body, { link: EvidenceLinkRecord; offer: OfferRecord }> => ({
  locate(desk, _body, caller) {
    const { dispute, offer } = disputeFor(desk, key, caller);
    const link = desk.links.get(token);
    if (!link || link.dispute !== dispute.key) throw notFound();
    return { link, offer };
  },
  apply(desk, _body, { link, offer }, caller, commandId) {
    link.revoked = true;
    desk.touch("links", link.token);
    desk.event("link.revoked", caller.party, commandId, [offer.key]);
    return { status: 204, body: null };
  },
});
