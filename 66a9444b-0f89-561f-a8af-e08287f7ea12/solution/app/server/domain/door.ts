// Door admission and the admissions report, counted against the festival day (05:00 to 05:00 Brussels).
import { dayPassCovers } from "../../shared/admission.ts";
import { festivalDayBounds, festivalDayOf } from "../../shared/brussels.ts";
import { db, transaction } from "../db/index.ts";
import { ApiError, FieldErrors, notFound, ok, route } from "../http.ts";
import { audit } from "./audit.ts";
import { edition, festivalDays } from "./programme.ts";
import { isoOrNull, isoUtc } from "./time.ts";
import { asObject } from "./validate.ts";


type PassAtDoor = { code: string; status: string; kind: "seat" | "full_festival" | "day"; line_session_id: string | null; line_day: string | null; holder_name: string; title: string };
type SessionAtDoor = { id: string; title: string; admission: string; venue_id: string; status: string; starts_at: Date };
type Refusal = "already_admitted" | "pass_transferred" | "pass_refunded" | "pass_voided" | "not_entitled" | "session_cancelled";

const STATUS_REFUSAL: Record<string, Refusal> = { transferred: "pass_transferred", refunded: "pass_refunded", voided: "pass_voided" };

/**
 * Entitlement: a full-festival pass admits to any pass session once per session; a day pass for D admits to
 * pass sessions of festival day D outside the Planetarium Dome once per day; a seat pass admits once to its session.
 * Returns the scans that count as "already used" for this pass at this door.
 */
function entitlement(pass: PassAtDoor, session: SessionAtDoor, day: string): { entitled: boolean; usedScope: "session" | "day" } {
  if (pass.kind === "full_festival") return { entitled: session.admission === "pass", usedScope: "session" };
  if (pass.kind === "day") return { entitled: session.admission === "pass" && pass.line_day === day && dayPassCovers(session.venue_id), usedScope: "day" };
  return { entitled: pass.line_session_id === session.id, usedScope: "session" };
}

route("POST", "/api/box-office/scans", ["box_office"], async (ctx) => {
  const body = asObject(ctx.body);
  const outcome = await transaction(async (tx) => {
    const code = typeof body.pass_code === "string" ? body.pass_code.trim().toUpperCase() : "";
    const pass = await tx.one<PassAtDoor>(
      `SELECT p.code, p.status, l.kind, l.session_id AS line_session_id, l.festival_day::text AS line_day, l.holder_name, l.title
       FROM passes p JOIN lines l ON l.id = p.line_id WHERE p.code = $1 FOR UPDATE OF p`, [code]);
    if (!pass) throw new ApiError(404, "unknown_pass");
    const session = await tx.one<SessionAtDoor>(
      "SELECT id, title, admission, venue_id, effective_status(status, publish_at, $2) AS status, starts_at FROM sessions WHERE id = $1",
      [typeof body.session_id === "string" ? body.session_id : "", new Date()]);
    if (!session) throw notFound();
    const now = new Date();
    const day = festivalDayOf(session.starts_at.getTime());
    let refusal: Refusal | null = STATUS_REFUSAL[pass.status] ?? null;
    let firstAdmitted: Date | null = null;
    if (!refusal && session.status === "cancelled") refusal = "session_cancelled";
    if (!refusal) {
      const rule = entitlement(pass, session, day);
      if (!rule.entitled || session.status !== "published") refusal = "not_entitled";
      else {
        const used = await tx.one<{ scanned_at: Date }>(
          `SELECT scanned_at FROM scans WHERE pass_code = $1 AND result = 'admitted' AND ${rule.usedScope === "day" ? "festival_day = $2" : "session_id = $2"}
           ORDER BY seq LIMIT 1`, [pass.code, rule.usedScope === "day" ? day : session.id]);
        if (used) { refusal = "already_admitted"; firstAdmitted = used.scanned_at; }
      }
    }
    await tx.query("INSERT INTO scans (pass_code, session_id, festival_day, venue_id, result, reason, scanned_at, staff_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [pass.code, session.id, day, session.venue_id, refusal ? "refused" : "admitted", refusal, now, ctx.user.id]);
    await audit(tx, ctx.user, refusal ? "scan.refused" : "scan.admitted", { type: "pass", id: pass.code }, { session_id: session.id, reason: refusal });
    return { refusal, firstAdmitted, pass, session, day, now };
  });
  if (outcome.refusal) {
    throw new ApiError(409, "admission_refused", { reason: outcome.refusal, first_admitted_at: isoOrNull(outcome.firstAdmitted) });
  }
  return ok({
    result: "admitted", pass_code: outcome.pass.code, holder_name: outcome.pass.holder_name, item_title: outcome.pass.title,
    session_id: outcome.session.id, festival_day: outcome.day, scanned_at: isoUtc(outcome.now),
  });
});

route("GET", "/api/box-office/admissions", ["box_office"], async (ctx) => {
  const day = ctx.query.get("festival_day") ?? "";
  if (!festivalDays(await edition()).some((d) => d.date === day)) throw new FieldErrors({ festival_day: "unknown_festival_day" });
  const bounds = festivalDayBounds(day);
  const venues = await db.all<{ venue_id: string; name: string; admissions: number }>(
    `SELECT v.id AS venue_id, v.name, (SELECT count(*) FROM scans s WHERE s.venue_id = v.id AND s.festival_day = $1 AND s.result = 'admitted')::integer AS admissions
     FROM venues v ORDER BY v.position, v.id`, [day]);
  return ok({
    festival_day: day, starts_at: isoUtc(bounds.startsAt), ends_at: isoUtc(bounds.endsAt),
    length_hours: (bounds.endsAt - bounds.startsAt) / 3_600_000, venues, total: venues.reduce((s, v) => s + v.admissions, 0),
  });
});
