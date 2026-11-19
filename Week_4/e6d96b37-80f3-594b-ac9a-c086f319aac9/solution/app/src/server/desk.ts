// The desk aggregate: one namespace's records, loaded inside a transaction, changed by a command,
// then written back with the events the command appended.

import type pg from "pg";
import type { Cell } from "../shared/limits.js";
import type {
  Actor,
  Album,
  Annotation,
  Attribution,
  Dispute,
  EventType,
  EvidenceItem,
  Holder,
  Marker,
  OfferStatus,
  Party,
  Photo,
  Role,
} from "../shared/types.js";

export interface StoredPhoto extends Photo {
  /** The offer an arrival photograph was taken for. */
  offer?: string;
}

export interface SpecimenRecord {
  key: string;
  creation: number;
  display_label: string;
  owner: Role;
  transferred: boolean;
  holder: Holder;
  attribution: Attribution;
  quarantined: boolean;
  missing: boolean;
  version: number;
  photos: StoredPhoto[];
  annotations: Annotation[];
}

export interface Acceptance {
  version: number;
  subject: string;
}

export interface Hold {
  specimen: string;
  placed_at: string;
}

export interface OfferRecord {
  key: string;
  version: number;
  status: OfferStatus;
  dealer_items: string[];
  counterpart_items: string[];
  acceptances: { dealer: Acceptance | null; counterpart: Acceptance | null };
  holds: Hold[];
  expires_at: string | null;
  /** The status a dispute interrupted, restored when the dispute resolves without a swap. */
  status_before_dispute: OfferStatus | null;
  changed: number;
}

export interface ManifestRecord {
  offer: string;
  party: Party;
  version: number;
  order: string[];
  frozen: boolean;
  evidence: EvidenceItem[];
}

export interface DisputeRecord extends Dispute {
  key: string;
  markers: Marker[];
}

interface RegisterRecord {
  reference: string;
  revision: number;
  issue: string;
  mintmark: string;
  image_path: string;
  image_object_key: string;
}

interface CellRecord {
  cell: Cell;
  specimen: string | null;
  audit_mark: "missing" | null;
  audit_version: number;
}

export interface EvidenceLinkRecord {
  token: string;
  dispute: string;
  expires_at: string;
  revoked: boolean;
}

interface NewEvent {
  sequence: number;
  command_id: string;
  actor: Actor;
  type: EventType;
  at: string;
  offers: string[];
  detail: Record<string, string>;
}

interface NewAuditMark {
  sequence: number;
  cell: Cell;
  actor: Actor;
  command_id: string;
}

type Kind = "specimens" | "offers" | "manifests" | "receipts" | "disputes" | "cells" | "register" | "links";

export class Desk {
  readonly specimens = new Map<string, SpecimenRecord>();
  readonly cells = new Map<Cell, CellRecord>();
  readonly offers = new Map<string, OfferRecord>();
  readonly manifests = new Map<string, ManifestRecord>();
  readonly receipts = new Map<string, { offer: string; party: Party; matches: boolean }>();
  readonly disputes = new Map<string, DisputeRecord>();
  readonly register = new Map<string, RegisterRecord>();
  readonly links = new Map<string, EvidenceLinkRecord>();
  readonly newEvents: NewEvent[] = [];
  readonly newMarks: NewAuditMark[] = [];
  private readonly dirty = new Map<Kind, Set<string>>();
  private rowDirty = false;

  constructor(
    readonly ns: string,
    readonly grading: boolean,
    public clockAt: Date | null,
    public trayVersion: number,
    public albumVersion: number,
    public keeperVersion: number,
    public keeperOrder: string[],
    public keeperPrevious: string[] | null,
    public album: Album | null,
    public lastSequence: number,
    public nextCreation: number,
    public nextDispute: number,
  ) {}

  /** The namespace clock: a grading namespace's own clock, otherwise real time. */
  get now(): Date {
    return this.clockAt ?? new Date();
  }

  touch(kind: Kind, key: string): void {
    if (!this.dirty.has(kind)) this.dirty.set(kind, new Set());
    this.dirty.get(kind)!.add(key);
  }

  touchRow(): void {
    this.rowDirty = true;
  }

  /** Appends exactly one event with the next desk sequence. */
  event(type: EventType, actor: Actor, commandId: string, offers: string[] = [], detail: Record<string, string> = {}): number {
    this.lastSequence += 1;
    this.rowDirty = true;
    this.newEvents.push({ sequence: this.lastSequence, command_id: commandId, actor, type, at: this.now.toISOString(), offers, detail });
    return this.lastSequence;
  }

  specimen(key: string): SpecimenRecord {
    return this.specimens.get(key)!;
  }

  manifestKey(offer: string, party: Party): string {
    return `${offer}/${party}`;
  }

  async save(client: pg.PoolClient): Promise<void> {
    const keys = (kind: Kind) => [...(this.dirty.get(kind) ?? [])];
    for (const key of keys("specimens")) {
      const s = this.specimens.get(key)!;
      await client.query(
        `INSERT INTO specimens (ns, key, creation, data) VALUES ($1,$2,$3,$4)
         ON CONFLICT (ns, key) DO UPDATE SET data = EXCLUDED.data`,
        [this.ns, key, s.creation, s],
      );
    }
    for (const key of keys("cells")) {
      const c = this.cells.get(key as Cell)!;
      await client.query(
        `INSERT INTO tray_cells (ns, cell, specimen, audit_mark, audit_version) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (ns, cell) DO UPDATE SET specimen = EXCLUDED.specimen, audit_mark = EXCLUDED.audit_mark,
         audit_version = EXCLUDED.audit_version`,
        [this.ns, c.cell, c.specimen, c.audit_mark, c.audit_version],
      );
    }
    for (const key of keys("offers")) {
      await client.query(
        `INSERT INTO offers (ns, key, data) VALUES ($1,$2,$3) ON CONFLICT (ns, key) DO UPDATE SET data = EXCLUDED.data`,
        [this.ns, key, this.offers.get(key)],
      );
    }
    for (const key of keys("manifests")) {
      const m = this.manifests.get(key)!;
      await client.query(
        `INSERT INTO manifests (ns, offer, party, data) VALUES ($1,$2,$3,$4)
         ON CONFLICT (ns, offer, party) DO UPDATE SET data = EXCLUDED.data`,
        [this.ns, m.offer, m.party, m],
      );
    }
    for (const key of keys("receipts")) {
      const r = this.receipts.get(key)!;
      await client.query(
        `INSERT INTO receipts (ns, offer, party, matches) VALUES ($1,$2,$3,$4)
         ON CONFLICT (ns, offer, party) DO UPDATE SET matches = EXCLUDED.matches`,
        [this.ns, r.offer, r.party, r.matches],
      );
    }
    for (const key of keys("disputes")) {
      await client.query(
        `INSERT INTO disputes (ns, key, data) VALUES ($1,$2,$3) ON CONFLICT (ns, key) DO UPDATE SET data = EXCLUDED.data`,
        [this.ns, key, this.disputes.get(key)],
      );
    }
    for (const key of keys("register")) {
      const r = this.register.get(key)!;
      await client.query(
        `INSERT INTO register_records (ns, reference, revision, issue, mintmark, image_path, image_object_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (ns, reference, revision) DO NOTHING`,
        [this.ns, r.reference, r.revision, r.issue, r.mintmark, r.image_path, r.image_object_key],
      );
    }
    for (const key of keys("links")) {
      const l = this.links.get(key)!;
      await client.query(
        `INSERT INTO evidence_links (token, ns, dispute, expires_at, revoked) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (token) DO UPDATE SET revoked = EXCLUDED.revoked`,
        [l.token, this.ns, l.dispute, l.expires_at, l.revoked],
      );
    }
    for (const e of this.newEvents) {
      await client.query(
        `INSERT INTO desk_events (ns, sequence, command_id, actor, type, at, offers, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [this.ns, e.sequence, e.command_id, e.actor, e.type, e.at, e.offers, e.detail],
      );
    }
    for (const m of this.newMarks) {
      await client.query(
        `INSERT INTO audit_marks (ns, sequence, cell, mark, actor, command_id) VALUES ($1,$2,$3,'missing',$4,$5)`,
        [this.ns, m.sequence, m.cell, m.actor, m.command_id],
      );
    }
    if (this.rowDirty) {
      await client.query(
        `UPDATE desks SET clock_at=$2, tray_version=$3, album_version=$4, keeper_version=$5, keeper_order=$6,
         keeper_previous=$7, album=$8, last_sequence=$9, next_creation=$10, next_dispute=$11 WHERE ns=$1`,
        [
          this.ns,
          this.clockAt,
          this.trayVersion,
          this.albumVersion,
          this.keeperVersion,
          JSON.stringify(this.keeperOrder),
          this.keeperPrevious === null ? null : JSON.stringify(this.keeperPrevious),
          this.album,
          this.lastSequence,
          this.nextCreation,
          this.nextDispute,
        ],
      );
    }
  }
}

interface DeskRow {
  ns: string;
  grading: boolean;
  clock_at: Date | null;
  tray_version: number;
  album_version: number;
  keeper_version: number;
  keeper_order: string[];
  keeper_previous: string[] | null;
  album: Album | null;
  last_sequence: string;
  next_creation: string;
  next_dispute: number;
}

/** Loads a namespace's desk; `lock` takes the row lock that serialises commands on it. */
export async function loadDesk(client: pg.PoolClient | pg.Pool, ns: string, lock: boolean): Promise<Desk | null> {
  const rows = await client.query<DeskRow>(`SELECT * FROM desks WHERE ns = $1 ${lock ? "FOR UPDATE" : ""}`, [ns]);
  const row = rows.rows[0];
  if (!row) return null;
  const desk = new Desk(
    row.ns,
    row.grading,
    row.clock_at,
    row.tray_version,
    row.album_version,
    row.keeper_version,
    row.keeper_order,
    row.keeper_previous,
    row.album,
    Number(row.last_sequence),
    Number(row.next_creation),
    row.next_dispute,
  );
  const [specimens, cells, offers, manifests, receipts, disputes, register, links] = await Promise.all([
    client.query<{ data: SpecimenRecord }>("SELECT data FROM specimens WHERE ns=$1 ORDER BY creation", [ns]),
    client.query<CellRecord>("SELECT cell, specimen, audit_mark, audit_version FROM tray_cells WHERE ns=$1 ORDER BY cell", [ns]),
    client.query<{ data: OfferRecord }>("SELECT data FROM offers WHERE ns=$1 ORDER BY key", [ns]),
    client.query<{ data: ManifestRecord }>("SELECT data FROM manifests WHERE ns=$1", [ns]),
    client.query<{ offer: string; party: Party; matches: boolean }>("SELECT offer, party, matches FROM receipts WHERE ns=$1", [ns]),
    client.query<{ data: DisputeRecord }>("SELECT data FROM disputes WHERE ns=$1 ORDER BY key", [ns]),
    client.query<RegisterRecord>(
      "SELECT reference, revision, issue, mintmark, image_path, image_object_key FROM register_records WHERE ns=$1",
      [ns],
    ),
    client.query<{ token: string; dispute: string; expires_at: Date; revoked: boolean }>(
      "SELECT token, dispute, expires_at, revoked FROM evidence_links WHERE ns=$1",
      [ns],
    ),
  ]);
  for (const { data } of specimens.rows) desk.specimens.set(data.key, data);
  for (const cell of cells.rows) desk.cells.set(cell.cell, cell);
  for (const { data } of offers.rows) desk.offers.set(data.key, data);
  for (const { data } of manifests.rows) desk.manifests.set(desk.manifestKey(data.offer, data.party), data);
  for (const r of receipts.rows) desk.receipts.set(desk.manifestKey(r.offer, r.party), r);
  for (const { data } of disputes.rows) desk.disputes.set(data.key, data);
  for (const r of register.rows) desk.register.set(`${r.reference}#${r.revision}`, r);
  for (const l of links.rows) desk.links.set(l.token, { ...l, expires_at: l.expires_at.toISOString() });
  return desk;
}
