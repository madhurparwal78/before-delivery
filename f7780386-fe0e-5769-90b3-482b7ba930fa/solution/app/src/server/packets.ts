// Compliance packets: a snapshot of checked-in visits for a date range, its stored PDF, and the
// unguessable read-only link the operator issues, revokes or regenerates.

import { randomBytes, randomUUID } from "node:crypto";
import type { Packet, PacketSnapshot, PacketStatus, PacketVisit, Validity } from "../shared/api.js";
import { clock } from "../shared/rules.js";
import { daysBetween, isCalendarDate, kitchenDate, kitchenMinute } from "../shared/zone.js";
import { now, nowSecond } from "./clock.js";
import { tx, type Db } from "./db.js";
import { coveringDocument, inertDownload } from "./documents.js";
import { conflict, FieldErrors, forbidden, invalid, notFound, unavailable } from "./errors.js";
import { json, type Reply, type Request } from "./http.js";
import { iso, kitchenName, stationOf, timeZone } from "./kitchen.js";
import { buildPdf, type PdfLine } from "./pdf.js";
import type { SessionUser } from "./sessions.js";
import { getObject, putObject } from "./storage.js";

const MAX_RANGE_DAYS = 31;
const MAX_EXPIRY_MS = 30 * 86_400_000;
const INSTANT_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;

export const PACKET_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

interface PacketRow {
  id: string;
  from_date: string;
  to_date: string;
  expires_at: Date;
  revoked: boolean;
  token: string | null;
  snapshot: PacketSnapshot;
  created_at: Date;
}

/** Usable while not revoked and now is strictly before expires_at; expired from that instant on. */
function packetStatus(row: PacketRow): PacketStatus {
  if (row.revoked) return "revoked";
  return now() < row.expires_at.getTime() ? "active" : "expired";
}

function packetJson(row: PacketRow): Packet {
  const status = packetStatus(row);
  const active = status === "active" && row.token !== null;
  return {
    id: row.id,
    from: row.from_date,
    to: row.to_date,
    expires_at: iso(row.expires_at),
    status,
    url: active ? `/packet/${row.token}` : null,
    token: active ? row.token : null,
    created_at: iso(row.created_at),
  };
}

function requireOperator(user: SessionUser): void {
  if (user.role !== "operator") throw forbidden();
}

function checkExpiry(errors: FieldErrors, raw: unknown): number | null {
  const at = typeof raw === "string" && INSTANT_WITH_OFFSET.test(raw) ? Date.parse(raw) : Number.NaN;
  if (Number.isNaN(at)) {
    errors.add("expires_at", "invalid");
    return null;
  }
  if (at <= now()) errors.add("expires_at", "not_in_future");
  else if (at > now() + MAX_EXPIRY_MS) errors.add("expires_at", "too_far");
  return Math.floor(at / 1000) * 1000;
}

interface VisitRow {
  id: string;
  member_id: string;
  business_name: string;
  station_id: string;
  date: string;
  start_minute: number;
  end_minute: number;
}

interface CrewRow {
  booking_id: string;
  crew_cook_id: string;
  name: string;
  at: Date;
}

function validity(found: { expiresOn: string } | null): Validity {
  return { valid: found !== null, expires_on: found?.expiresOn ?? null };
}

/** Every booking with at least one check-in dated from..to, grouped by date and ordered by start time. */
async function takeSnapshot(db: Db, from: string, to: string): Promise<PacketSnapshot> {
  const visits = await db.query<VisitRow>(
    `SELECT b.id, b.member_id, m.business_name, b.station_id, b.date, b.start_minute, b.end_minute
       FROM bookings b JOIN members m ON m.id = b.member_id
      WHERE b.date BETWEEN $1 AND $2 AND EXISTS (SELECT 1 FROM check_ins c WHERE c.booking_id = b.id)
      ORDER BY b.date, b.start_minute, b.station_id`,
    [from, to],
  );
  const crew = await db.query<CrewRow>(
    `SELECT c.booking_id, c.crew_cook_id, u.name, c.at FROM check_ins c JOIN users u ON u.id = c.crew_cook_id
      WHERE c.booking_id = ANY($1::text[]) ORDER BY c.at`,
    [visits.rows.map((v) => v.id)],
  );
  const days: PacketSnapshot["days"] = [];
  for (const visit of visits.rows) {
    const entry: PacketVisit = {
      business_name: visit.business_name,
      station: stationOf(visit.station_id).name,
      start: clock(visit.start_minute),
      end: clock(visit.end_minute),
      liability_insurance: validity(await coveringDocument(db, visit.member_id, "liability_insurance", null, visit.date)),
      crew: [],
    };
    for (const cook of crew.rows.filter((c) => c.booking_id === visit.id)) {
      entry.crew.push({
        name: cook.name,
        checked_in_at: iso(cook.at),
        food_handler_card: validity(await coveringDocument(db, visit.member_id, "food_handler_card", cook.crew_cook_id, visit.date)),
      });
    }
    const day = days.find((d) => d.date === visit.date);
    if (day) day.visits.push(entry);
    else days.push({ date: visit.date, visits: [entry] });
  }
  return { kitchen: kitchenName(), time_zone: timeZone(), from, to, generated_at: iso(nowSecond()), days };
}

const validWord = (v: Validity): string => (v.valid ? `Valid (expires ${v.expires_on ?? ""})` : "Not valid");

function packetPdf(snapshot: PacketSnapshot): Buffer {
  const zone = snapshot.time_zone;
  const lines: PdfLine[] = [
    { text: snapshot.kitchen, size: 18, bold: true },
    { text: "Compliance packet", size: 14, bold: true, gap: 4 },
    { text: `Kitchen visits from ${snapshot.from} to ${snapshot.to}`, size: 11, gap: 6 },
    { text: `Generated ${snapshot.generated_at}. Times are kitchen time (${zone}).`, size: 9 },
  ];
  if (snapshot.days.length === 0) lines.push({ text: "No checked-in visits in this date range.", gap: 14 });
  for (const day of snapshot.days) {
    lines.push({ text: day.date, size: 13, bold: true, gap: 14 });
    for (const visit of day.visits) {
      lines.push({ text: `${visit.start}–${visit.end}  ${visit.station}  ${visit.business_name}`, bold: true, gap: 6 });
      lines.push({ text: `Liability insurance: ${validWord(visit.liability_insurance)}`, indent: 12 });
      for (const cook of visit.crew) {
        const checkedIn = Date.parse(cook.checked_in_at);
        lines.push({
          text: `Crew: ${cook.name}, checked in ${kitchenDate(checkedIn, zone)} ${clock(kitchenMinute(checkedIn, zone))}, food handler card: ${validWord(cook.food_handler_card)}`,
          indent: 12,
        });
      }
    }
  }
  return buildPdf(`Compliance packet ${snapshot.from} to ${snapshot.to}`, lines);
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createPacket(req: Request, user: SessionUser): Promise<Reply> {
  requireOperator(user);
  const errors = new FieldErrors();
  const from = req.json.from;
  const to = req.json.to;
  if (!isCalendarDate(from)) errors.add("from", "invalid");
  if (!isCalendarDate(to)) errors.add("to", "invalid");
  else if (isCalendarDate(from) && daysBetween(from, to) < 0) errors.add("to", "before_from");
  else if (isCalendarDate(from) && daysBetween(from, to) + 1 > MAX_RANGE_DAYS) errors.add("to", "range_too_long");
  const expiresAt = checkExpiry(errors, req.json.expires_at);
  if (!isCalendarDate(from) || !isCalendarDate(to) || expiresAt === null || errors.any()) throw errors.error();
  const id = `pkt_${randomUUID().replaceAll("-", "")}`;
  const snapshot = await tx((db) => takeSnapshot(db, from, to));
  await putObject(`packets/${id}.pdf`, packetPdf(snapshot), "application/pdf");
  const packet = await tx(async (db) => {
    const inserted = await db.query<PacketRow>(
      `INSERT INTO packets (id, from_date, to_date, expires_at, token, snapshot, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, from, to, new Date(expiresAt), newToken(), JSON.stringify(snapshot), new Date(nowSecond())],
    );
    return packetJson(inserted.rows[0]);
  });
  return json(201, { packet });
}

export async function listPackets(_req: Request, user: SessionUser): Promise<Reply> {
  requireOperator(user);
  const packets = await tx((db) => db.query<PacketRow>("SELECT * FROM packets ORDER BY created_at DESC, id"));
  return json(200, { packets: packets.rows.map(packetJson) });
}

async function lockedPacket(db: Db, id: string, user: SessionUser): Promise<PacketRow> {
  const found = await db.query<PacketRow>("SELECT * FROM packets WHERE id = $1 FOR UPDATE", [id]);
  const row: PacketRow | undefined = found.rows[0];
  if (!row) throw notFound();
  requireOperator(user);
  return row;
}

/** Revoking is final: a revoked packet can be neither revoked nor regenerated. */
function requireChangeable(row: PacketRow): void {
  if (packetStatus(row) === "revoked") throw conflict("invalid_transition");
}

export async function revokePacket(req: Request, user: SessionUser): Promise<Reply> {
  const packet = await tx(async (db) => {
    const row = await lockedPacket(db, req.params.id, user);
    requireChangeable(row);
    const updated = await db.query<PacketRow>("UPDATE packets SET revoked = true, token = NULL WHERE id = $1 RETURNING *", [row.id]);
    return packetJson(updated.rows[0]);
  });
  return json(200, { packet });
}

export async function regeneratePacket(req: Request, user: SessionUser): Promise<Reply> {
  const packet = await tx(async (db) => {
    const row = await lockedPacket(db, req.params.id, user);
    const errors = new FieldErrors();
    const expiresAt = req.json.expires_at === undefined ? null : checkExpiry(errors, req.json.expires_at);
    if (errors.any()) throw errors.error();
    requireChangeable(row);
    const effectiveExpiry = expiresAt ?? row.expires_at.getTime();
    if (effectiveExpiry <= now()) throw invalid({ expires_at: "not_in_future" });
    const snapshot = await takeSnapshot(db, row.from_date, row.to_date);
    await putObject(`packets/${row.id}.pdf`, packetPdf(snapshot), "application/pdf");
    const updated = await db.query<PacketRow>("UPDATE packets SET token = $2, snapshot = $3, expires_at = $4 WHERE id = $1 RETURNING *", [
      row.id,
      newToken(),
      JSON.stringify(snapshot),
      new Date(effectiveExpiry),
    ]);
    return packetJson(updated.rows[0]);
  });
  return json(200, { packet });
}

/** The packet behind a usable token; unknown, expired and revoked tokens all read as absent. */
export async function usablePacket(token: string): Promise<PacketRow | null> {
  return tx(async (db) => {
    const found = await db.query<PacketRow>("SELECT * FROM packets WHERE token = $1", [token]);
    const row: PacketRow | undefined = found.rows[0];
    return row && packetStatus(row) === "active" ? row : null;
  });
}

export async function publicPacket(req: Request): Promise<Reply> {
  const row = await usablePacket(req.params.token);
  if (!row) return { status: 404, body: { error: "not_found" }, headers: PACKET_HEADERS };
  return { status: 200, body: row.snapshot, headers: PACKET_HEADERS };
}

export async function publicPacketPdf(req: Request): Promise<Reply> {
  const row = await usablePacket(req.params.token);
  if (!row) return { status: 404, body: { error: "not_found" }, headers: PACKET_HEADERS };
  const bytes = await getObject(`packets/${row.id}.pdf`);
  if (!bytes) throw unavailable("storage_unavailable");
  const name = `compliance-packet-${row.from_date}-to-${row.to_date}.pdf`;
  return { status: 200, bytes, headers: { ...inertDownload("application/pdf", `attachment; filename="${name}"`), ...PACKET_HEADERS } };
}
