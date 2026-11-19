// Stock commands (dealer only): intake, quarantine, reconciliation, condition annotations,
// tray placement, album holes, keeper order and audit marks.

import { createHash, randomUUID } from "node:crypto";
import { F, textLong } from "../../shared/feedback.js";
import { CELLS, type Cell } from "../../shared/limits.js";
import { judgePhoto, PHOTO_EXTENSIONS } from "../../shared/photoRules.js";
import { characters, REFERENCE_PATTERN } from "../../shared/textRules.js";
import type { PhotoLabel } from "../../shared/types.js";
import { type Body, integer, keys as keyList, text } from "../body.js";
import { config } from "../config.js";
import type { Desk, SpecimenRecord, StoredPhoto } from "../desk.js";
import { conflict, FieldErrors, forbidden, invalid, notFound } from "../errors.js";
import { putObject } from "../minio.js";
import { lookupAlbum, lookupVariety, type AlbumDefinition, type VarietyRecord } from "../register.js";
import { albumRefusal, holderFits, specimenStatus } from "../rules.js";
import { specimenView } from "../state.js";
import { touchOffersOf } from "./exchange.js";
import { type CommandSpec, stale } from "./runner.js";

const ALBUM_SET = "ALD-CROWN";
const NOTE_MAX = () => config.limits.FLAN_NOTE_MAX_CHARS;

/** A dealer-owned specimen the dealer may act on; 404 when unknown or hidden, 403 when not theirs. */
function dealerStock(desk: Desk, key: string | null): SpecimenRecord {
  const s = key === null ? undefined : desk.specimens.get(key);
  if (!s || s.owner === "outsider") throw notFound();
  if (s.owner !== "dealer" || s.transferred) throw forbidden();
  return s;
}

function noteError(errors: FieldErrors, field: string, value: string | null, required: boolean): void {
  if (value === null || (required && value.trim() === "")) errors.add(field, F.INVALID);
  else if (characters(value) > NOTE_MAX()) errors.add(field, textLong(NOTE_MAX()));
}

// --- intake ---------------------------------------------------------------------------------

interface StagedFace {
  label: PhotoLabel;
  bytes: Buffer;
  sha256: string;
  objectKey: string;
  contentType: string;
  width: number;
  height: number;
}

export const createSpecimen: CommandSpec<Body, null, StagedFace[], StagedFace[]> = {
  locate: () => null,
  conflicts(desk, body) {
    const reference = text(body, "reference");
    if (reference !== null && desk.specimens.has(reference)) throw conflict(F.INTAKE_DUP);
  },
  validate(desk, body) {
    const errors = new FieldErrors();
    const reference = text(body, "reference");
    if (reference === null || !REFERENCE_PATTERN.test(reference)) errors.add("reference", F.REFERENCE_FORMAT);
    const staged: StagedFace[] = [];
    for (const label of ["obverse", "reverse"] as const) {
      const part = body.files[label];
      if (!part) {
        errors.add(label, F.PHOTO_MISSING);
        continue;
      }
      const verdict = judgePhoto(part.bytes, config.limits);
      if (!verdict.ok) {
        if (verdict.oversized) errors.addOversized(label, verdict.copy);
        else errors.add(label, verdict.copy);
        continue;
      }
      const sha256 = createHash("sha256").update(part.bytes).digest("hex");
      staged.push({
        label,
        bytes: part.bytes,
        sha256,
        objectKey: `specimens/${desk.ns}/${reference}/${label}-${sha256}.${PHOTO_EXTENSIONS[verdict.kind]}`,
        contentType: verdict.contentType,
        width: verdict.width,
        height: verdict.height,
      });
    }
    errors.throwIfAny();
    return staged;
  },
  async provide(_desk, _body, _located, staged) {
    for (const face of staged) await putObject(face.objectKey, face.bytes, face.contentType);
    return staged;
  },
  written: (staged) => staged.map((face) => face.objectKey),
  apply(desk, body, _located, _caller, commandId, staged) {
    const key = text(body, "reference")!;
    const specimen: SpecimenRecord = {
      key,
      creation: desk.nextCreation,
      display_label: `Specimen ${key}`,
      owner: "dealer",
      transferred: false,
      holder: { kind: "flip", width_mm: 50, height_mm: 50 },
      attribution: { reference: null, mintmark: null, revision: null, certainty: "certain", note: null, correction: null, register: "pending" },
      quarantined: false,
      missing: false,
      version: 1,
      photos: staged.map((face) => ({
        id: randomUUID(),
        label: face.label,
        object_key: face.objectKey,
        sha256: face.sha256,
        width: face.width,
        height: face.height,
      })),
      annotations: [],
    };
    desk.nextCreation += 1;
    desk.touchRow();
    desk.specimens.set(key, specimen);
    desk.touch("specimens", key);
    desk.event("specimen.created", "dealer", commandId, [], { specimen: key });
    return { status: 201, body: { specimen: specimenView(desk, specimen) } };
  },
};

// --- attribution ----------------------------------------------------------------------------

export const quarantine = (key: string): CommandSpec<Body, SpecimenRecord> => ({
  locate: (desk) => dealerStock(desk, key),
  conflicts(desk, body, s) {
    stale(integer(body, "expected_version"), s.version);
    const status = specimenStatus(desk, s.key);
    if (status === "reserved" || status === "outbound") throw conflict(F.IN_OFFER);
  },
  validate(_desk, body) {
    const errors = new FieldErrors();
    noteError(errors, "note", text(body, "note"), true);
    errors.throwIfAny();
  },
  apply(desk, body, s, _caller, commandId) {
    s.quarantined = true;
    s.attribution = { ...s.attribution, certainty: "uncertain", note: text(body, "note") };
    s.version += 1;
    desk.touch("specimens", s.key);
    desk.event("specimen.quarantined", "dealer", commandId, [], { specimen: s.key });
    return { status: 200, body: { specimen: specimenView(desk, s) } };
  },
});

export const reconcile = (key: string): CommandSpec<Body, SpecimenRecord, VarietyRecord> => ({
  locate: (desk) => dealerStock(desk, key),
  conflicts(_desk, body, s) {
    stale(integer(body, "expected_version"), s.version);
  },
  validate(_desk, body) {
    const correction = text(body, "correction");
    const max = config.limits.FLAN_CORRECTION_MAX_CHARS;
    if (correction === null || correction.trim() === "") throw invalid({ correction: F.INVALID });
    if (characters(correction) > max) throw invalid({ correction: textLong(max) });
  },
  async provide(desk, body) {
    const record = await lookupVariety(text(body, "correction")!);
    if (!desk.register.has(`${record.reference}#${record.revision}`)) {
      await putObject(registerImageKey(desk.ns, record), record.image, "image/svg+xml");
    }
    return record;
  },
  onProviderError(desk, body, s) {
    s.attribution = { ...s.attribution, correction: text(body, "correction"), register: "pending" };
    desk.touch("specimens", s.key);
  },
  apply(desk, body, s, _caller, commandId, record) {
    storeRegisterRecord(desk, record);
    s.attribution = {
      ...s.attribution,
      reference: record.reference,
      mintmark: record.mintmark,
      revision: record.revision,
      certainty: "certain",
      correction: text(body, "correction"),
      register: "stored",
    };
    s.quarantined = false;
    s.version += 1;
    desk.touch("specimens", s.key);
    const offers = touchOffersOf(desk, s.key);
    desk.event("specimen.reconciled", "dealer", commandId, offers, { specimen: s.key });
    return { status: 200, body: { specimen: specimenView(desk, s) } };
  },
});

export function registerImageKey(ns: string, record: { reference: string; revision: number }): string {
  return `catalog/${ns}/${record.reference}/r${record.revision}.svg`;
}

function storeRegisterRecord(desk: Desk, record: VarietyRecord): void {
  const key = `${record.reference}#${record.revision}`;
  if (desk.register.has(key)) return;
  desk.register.set(key, {
    reference: record.reference,
    revision: record.revision,
    issue: record.issue,
    mintmark: record.mintmark,
    image_path: record.image_path,
    image_object_key: registerImageKey(desk.ns, record),
  });
  desk.touch("register", key);
}

export const annotate = (key: string): CommandSpec<Body, { s: SpecimenRecord; photo: StoredPhoto }> => ({
  locate(desk, body) {
    const s = dealerStock(desk, key);
    const photo = s.photos.find((p) => p.id === text(body, "photo"));
    if (!photo) throw notFound();
    return { s, photo };
  },
  conflicts(_desk, body, { s }) {
    stale(integer(body, "expected_version"), s.version);
  },
  validate(_desk, body, { photo }) {
    const errors = new FieldErrors();
    const id = text(body, "annotation");
    if (id === null || id.length < 1 || id.length > 64) errors.add("annotation", F.INVALID);
    const x = integer(body, "x");
    const y = integer(body, "y");
    if (x === null || x < 0 || x > photo.width - 1) errors.add("x", F.COORD);
    if (y === null || y < 0 || y > photo.height - 1) errors.add("y", F.COORD);
    noteError(errors, "text", text(body, "text"), true);
    errors.throwIfAny();
  },
  apply(desk, body, { s, photo }, _caller, commandId) {
    const annotation = { id: text(body, "annotation")!, photo: photo.id, x: integer(body, "x")!, y: integer(body, "y")!, text: text(body, "text")! };
    s.annotations = [...s.annotations.filter((a) => a.id !== annotation.id), annotation];
    s.version += 1;
    desk.touch("specimens", s.key);
    const offers = touchOffersOf(desk, s.key);
    desk.event("annotation.saved", "dealer", commandId, offers, { specimen: s.key });
    return { status: 200, body: { specimen: specimenView(desk, s) } };
  },
});

// --- tray -----------------------------------------------------------------------------------

function trayView(desk: Desk) {
  return Object.fromEntries(
    CELLS.map((cell) => {
      const c = desk.cells.get(cell)!;
      return [cell, { specimen: c.specimen, audit_mark: c.audit_mark, audit_version: c.audit_version }];
    }),
  );
}

function cellOf(desk: Desk, name: string | null) {
  const cell = CELLS.find((c) => c === name);
  if (!cell) throw notFound();
  return desk.cells.get(cell)!;
}

export const placeHolder: CommandSpec<Body, { s: SpecimenRecord; cell: Cell }> = {
  locate(desk, body) {
    const s = dealerStock(desk, text(body, "specimen"));
    return { s, cell: cellOf(desk, text(body, "cell")).cell };
  },
  conflicts(desk, body, { s, cell }) {
    stale(integer(body, "expected_version"), desk.trayVersion);
    const occupant = desk.cells.get(cell)!.specimen;
    if (occupant !== null && occupant !== s.key) throw conflict(F.TRAY_TAKEN);
  },
  validate(_desk, _body, { s }) {
    if (!holderFits(s.holder)) throw invalid({ cell: F.TRAY_SIZE });
  },
  apply(desk, _body, { s, cell }, _caller, commandId) {
    for (const c of desk.cells.values()) {
      if (c.specimen === s.key) {
        c.specimen = null;
        desk.touch("cells", c.cell);
      }
    }
    desk.cells.get(cell)!.specimen = s.key;
    desk.touch("cells", cell);
    desk.trayVersion += 1;
    desk.touchRow();
    desk.event("tray.placed", "dealer", commandId, [], { specimen: s.key, cell });
    return { status: 200, body: { tray: trayView(desk), version: desk.trayVersion } };
  },
};

// --- album ----------------------------------------------------------------------------------

export const reconcileAlbum: CommandSpec<Body, null, AlbumDefinition> = {
  locate: () => null,
  provide: (desk) => lookupAlbum(desk.album?.set ?? ALBUM_SET),
  apply(desk, _body, _located, _caller, commandId, definition) {
    desk.album = albumFrom(definition, desk.album?.holes ?? {});
    desk.albumVersion += 1;
    desk.touchRow();
    desk.event("album.reconciled", "dealer", commandId);
    return { status: 200, body: { album: desk.album } };
  },
};

/** An album from a register definition, keeping fills whose hole still expects the same mintmark. */
export function albumFrom(definition: AlbumDefinition, previous: Record<string, { mintmark: string; specimen: string | null }>) {
  return {
    set: definition.set,
    revision: definition.revision,
    holes: Object.fromEntries(
      definition.holes.map((h) => [
        h.label,
        { reference: h.reference, mintmark: h.mintmark, specimen: previous[h.label]?.mintmark === h.mintmark ? previous[h.label]!.specimen : null },
      ]),
    ),
  };
}

export const fillHole = (label: string): CommandSpec<Body, SpecimenRecord> => ({
  locate(desk, body) {
    if (!desk.album?.holes[label]) throw notFound();
    return dealerStock(desk, text(body, "specimen"));
  },
  conflicts(desk, body, s) {
    stale(integer(body, "expected_version"), desk.albumVersion);
    const refusal = albumRefusal(desk, s.key);
    if (refusal) throw conflict(refusal);
  },
  validate(desk, _body, s) {
    if (s.missing || s.attribution.mintmark !== desk.album!.holes[label]!.mintmark) throw invalid({ specimen: F.SET_MISMATCH });
  },
  apply(desk, _body, s, _caller, commandId) {
    const album = desk.album!;
    for (const hole of Object.values(album.holes)) if (hole.specimen === s.key) hole.specimen = null;
    album.holes[label]!.specimen = s.key;
    desk.albumVersion += 1;
    desk.touchRow();
    desk.event("album.filled", "dealer", commandId, [], { specimen: s.key, hole: label });
    return { status: 200, body: { album, version: desk.albumVersion } };
  },
});

// --- keeper order ---------------------------------------------------------------------------

export const reorderKeepers: CommandSpec<Body, null> = {
  locate: () => null,
  conflicts(desk, body) {
    stale(integer(body, "expected_version"), desk.keeperVersion);
  },
  validate(desk, body) {
    const order = keyList(body, "order");
    const same = order !== null && order.length === desk.keeperOrder.length && new Set(order).size === order.length
      && order.every((k) => desk.keeperOrder.includes(k));
    if (!same) throw invalid({ order: F.ORDER });
  },
  apply(desk, body, _located, _caller, commandId) {
    desk.keeperPrevious = desk.keeperOrder;
    desk.keeperOrder = keyList(body, "order")!;
    desk.keeperVersion += 1;
    desk.touchRow();
    desk.event("keeper.reordered", "dealer", commandId);
    return { status: 200, body: { keeper_order: desk.keeperOrder, version: desk.keeperVersion } };
  },
};

export const undoKeepers: CommandSpec<Body, null> = {
  locate: () => null,
  conflicts(desk, body) {
    stale(integer(body, "expected_version"), desk.keeperVersion);
    if (desk.keeperPrevious === null) throw conflict(F.UNDO_NONE);
  },
  apply(desk, _body, _located, _caller, commandId) {
    desk.keeperOrder = desk.keeperPrevious!;
    desk.keeperPrevious = null;
    desk.keeperVersion += 1;
    desk.touchRow();
    desk.event("keeper.restored", "dealer", commandId);
    return { status: 200, body: { keeper_order: desk.keeperOrder, version: desk.keeperVersion } };
  },
};

// --- audit ----------------------------------------------------------------------------------

export const markMissing: CommandSpec<Body, Cell> = {
  locate: (desk, body) => cellOf(desk, text(body, "cell")).cell,
  conflicts(desk, body, cell) {
    stale(integer(body, "expected_version"), desk.cells.get(cell)!.audit_version);
  },
  validate(desk, body, cell) {
    const errors = new FieldErrors();
    if (text(body, "mark") !== "missing") errors.add("mark", F.INVALID);
    if (desk.cells.get(cell)!.specimen === null) errors.add("cell", F.CELL_EMPTY);
    errors.throwIfAny();
  },
  apply(desk, _body, cell, _caller, commandId) {
    const c = desk.cells.get(cell)!;
    const s = desk.specimen(c.specimen!);
    c.audit_mark = "missing";
    c.audit_version += 1;
    desk.touch("cells", cell);
    s.missing = true;
    s.version += 1;
    desk.touch("specimens", s.key);
    const sequence = desk.event("audit.marked", "dealer", commandId, [], { specimen: s.key, cell });
    desk.newMarks.push({ sequence, cell, actor: "dealer", command_id: commandId });
    return { status: 200, body: { cell: { cell, specimen: c.specimen, audit_mark: c.audit_mark, audit_version: c.audit_version } } };
  },
};
