import {
  copy,
  describeRituals,
  isBedtime,
  isNote,
  isTimeZoneName,
  normaliseEmail,
  parseRituals,
  startsAt,
  totalMinutes,
  type RitualChoice,
} from "../src/shared/hour";
import { now } from "./clock";
import { inTransaction, transaction, withDb, type Db } from "./db";
import { holdingKey, rateLimit, rememberReply, replayOf } from "./guards";
import { ApiError, invalid, isObject, unaccepted, type Reply } from "./http";
import { issueLink } from "./links";
import { confirmMail } from "./messages";
import { deliverNow, enqueue } from "./outbox";
import { LAST_NIGHT, nextReminder } from "./reminders";
import { fingerprint, newId, newToken } from "./tokens";

interface HourInput {
  bedtime: string;
  time_zone: string;
  rituals: RitualChoice[];
  note: string;
}

type HourField = keyof HourInput;
const HOUR_FIELDS: HourField[] = ["bedtime", "time_zone", "rituals", "note"];

/** Checks each supplied hour field against the plan rules, collecting every failing field at once. */
function checkHourFields(body: Record<string, unknown>, fields: Record<string, string>) {
  const hour: Partial<HourInput> = {};
  if ("bedtime" in body) {
    if (isBedtime(body.bedtime)) hour.bedtime = body.bedtime;
    else fields.bedtime = copy.bedtime;
  }
  if ("time_zone" in body) {
    if (isTimeZoneName(body.time_zone)) hour.time_zone = body.time_zone;
    else fields.time_zone = copy.timeZone;
  }
  if ("rituals" in body) {
    const rituals = parseRituals(body.rituals);
    if (rituals) hour.rituals = rituals;
    else fields.rituals = copy.rituals;
  }
  if ("note" in body) {
    if (isNote(body.note)) hour.note = body.note;
    else fields.note = copy.note;
  }
  return hour;
}

const MISSING: Record<"email" | Exclude<HourField, "note">, string> = {
  email: copy.email,
  bedtime: copy.bedtime,
  time_zone: copy.timeZone,
  rituals: copy.rituals,
};

/** The plan rules for saving a new hour: email, bedtime, time zone and rituals required, note optional. */
function parseNewHour(body: unknown): { email: string } & HourInput {
  const source = isObject(body) ? body : {};
  const fields = unaccepted(source, ["email", ...HOUR_FIELDS]);
  const hour = checkHourFields(source, fields);
  const email = normaliseEmail(source.email);
  if (!email) fields.email = MISSING.email;
  for (const key of ["bedtime", "time_zone", "rituals"] as const) if (!(key in source)) fields[key] = MISSING[key];
  const { bedtime, time_zone, rituals, note = "" } = hour;
  if (!email || !bedtime || !time_zone || !rituals || Object.keys(fields).length) throw invalid(fields);
  return { email, bedtime, time_zone, rituals, note };
}

interface PlanRow extends HourInput {
  id: string;
  email: string;
  reminders: "on" | "paused";
  active_since: Date;
  version: number;
  last_night: string | null;
}

const PLAN_COLUMNS = `p.id, v.email, p.bedtime, p.time_zone, p.rituals, p.note, p.reminders, p.active_since, p.version, ${LAST_NIGHT}`;

/** The published plan shape, with its derived start, total, next reminder and current share link. */
async function ownerView(db: Db, row: PlanRow) {
  const share = await db.query<{ token: string }>("SELECT token FROM share_links WHERE plan_id = $1", [row.id]);
  const next = nextReminder(row, row.last_night);
  return {
    id: row.id,
    email: row.email,
    bedtime: row.bedtime,
    time_zone: row.time_zone,
    rituals: describeRituals(row.rituals),
    total_minutes: totalMinutes(row.rituals),
    note: row.note,
    reminders: row.reminders,
    version: row.version,
    starts_at_local: startsAt(row.bedtime),
    next_reminder_at: next === null ? null : new Date(next).toISOString(),
    share_url: share.rows[0] ? `/p/${share.rows[0].token}` : null,
  };
}

async function planOf(db: Db, visitorId: string, lock = false) {
  const rows = await db.query<PlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM plans p JOIN visitors v ON v.id = p.visitor_id WHERE p.visitor_id = $1${lock ? " FOR UPDATE OF p" : ""}`,
    [visitorId],
  );
  return rows.rows[0] ?? null;
}

const QUEUED: Reply = { status: 202, body: { status: "confirmation_queued" } };
const SENT: Reply = { status: 202, body: { status: "confirmation_sent" } };

/**
 * Saves a draft and emails its confirmation link, in the published order: an idempotent replay or
 * conflict first, then the plan rules, then the hourly limit. The draft, its link and its email are
 * committed together (the key remembers "queued"); only then is the email handed to SMTP, and if SMTP
 * accepts it before the answer the key remembers "sent". The reply is the same for new and known addresses.
 */
export function createDraft(body: unknown, key: string): Promise<Reply> {
  const requestHash = fingerprint(body ?? null);
  return withDb((db) =>
    holdingKey(db, key, async () => {
      const saved = await inTransaction(db, async () => {
        const replay = await replayOf(db, key, requestHash);
        if (replay) return { kind: "replay" as const, replay };
        const input = parseNewHour(body);
        await rateLimit(db, "saves", input.email);
        const draftId = newId();
        await db.query(
          "INSERT INTO drafts (id, email, bedtime, time_zone, rituals, note) VALUES ($1, $2, $3, $4, $5, $6)",
          [draftId, input.email, input.bedtime, input.time_zone, JSON.stringify(input.rituals), input.note],
        );
        const link = await issueLink(db, input.email, "confirm", draftId);
        const mailId = await enqueue(db, { to: input.email, linkHash: link.hash, sendingNow: true, ...confirmMail(link.token, input) });
        await rememberReply(db, key, requestHash, QUEUED);
        return { kind: "saved" as const, mailId };
      });
      if (saved.kind === "replay") return saved.replay;
      return inTransaction(db, async () => {
        if (!(await deliverNow(db, saved.mailId))) return QUEUED;
        await rememberReply(db, key, requestHash, SENT);
        return SENT;
      });
    }),
  );
}

/**
 * Makes a confirmed draft the address's hour with reminders on. An earlier hour keeps its id and share
 * link and goes up one version; a confirmation is a reminders-start moment.
 */
export async function adoptDraft(db: Db, visitorId: string, draftId: string) {
  const draft = await db.query<HourInput>("SELECT bedtime, time_zone, rituals, note FROM drafts WHERE id = $1", [draftId]);
  const hour = draft.rows[0];
  await db.query(
    `INSERT INTO plans (id, visitor_id, bedtime, time_zone, rituals, note, reminders, active_since, version)
     VALUES ($1, $2, $3, $4, $5, $6, 'on', $7, 1)
     ON CONFLICT (visitor_id) DO UPDATE SET bedtime = EXCLUDED.bedtime, time_zone = EXCLUDED.time_zone,
       rituals = EXCLUDED.rituals, note = EXCLUDED.note, reminders = 'on', active_since = EXCLUDED.active_since,
       version = plans.version + 1`,
    [newId(), visitorId, hour.bedtime, hour.time_zone, JSON.stringify(hour.rituals), hour.note, now()],
  );
  await db.query("DELETE FROM drafts WHERE id = $1", [draftId]);
}

export function readPlan(visitorId: string) {
  return withDb(async (db) => {
    const row = await planOf(db, visitorId);
    if (!row) throw new ApiError("no_plan");
    return { status: 200, body: { plan: await ownerView(db, row) } };
  });
}

/** The version in If-Match, bare or quoted; anything else is a version that matches nothing. */
function versionOf(header: string | undefined) {
  const match = /^"?(\d{1,9})"?$/.exec(String(header).trim());
  return match ? Number(match[1]) : NaN;
}

/**
 * Edits the hour, in the published order: no hour 404, no If-Match 428, a stale version 409 with the
 * current hour, then the plan rules on the supplied keys. Of parallel edits to one version, the first to
 * lock the row wins. A resume, or a changed bedtime or time zone, is a reminders-start moment.
 */
export function updatePlan(visitorId: string, body: unknown, ifMatch: string | undefined): Promise<Reply> {
  return transaction(async (db) => {
    const current = await planOf(db, visitorId, true);
    if (!current) throw new ApiError("no_plan");
    if (ifMatch === undefined || ifMatch.trim() === "") throw new ApiError("version_required");
    if (versionOf(ifMatch) !== current.version) {
      throw new ApiError("version_conflict", undefined, {}, { current: await ownerView(db, current) });
    }
    if (!isObject(body) || !Object.keys(body).length) throw invalid();
    const fields = unaccepted(body, [...HOUR_FIELDS, "reminders"]);
    const hour = checkHourFields(body, fields);
    const reminders = body.reminders;
    const remindersGiven = reminders === "on" || reminders === "paused";
    if ("reminders" in body && !remindersGiven) fields.reminders = copy.reminders;
    if (Object.keys(fields).length) throw invalid(fields);
    const next = { ...current, ...hour, reminders: remindersGiven ? reminders : current.reminders };
    const restarts =
      (current.reminders === "paused" && next.reminders === "on") ||
      next.bedtime !== current.bedtime ||
      next.time_zone !== current.time_zone;
    await db.query(
      `UPDATE plans SET bedtime = $2, time_zone = $3, rituals = $4, note = $5, reminders = $6,
         active_since = $7, version = version + 1 WHERE id = $1`,
      [current.id, next.bedtime, next.time_zone, JSON.stringify(next.rituals), next.note, next.reminders,
        restarts ? now() : current.active_since],
    );
    const saved = (await planOf(db, visitorId)) as PlanRow;
    return { status: 200, body: { plan: await ownerView(db, saved) } };
  });
}

/** A new share link replaces the previous one, which stops working at once. */
export function createShare(visitorId: string): Promise<Reply> {
  return transaction(async (db) => {
    const plan = await planOf(db, visitorId, true);
    if (!plan) throw new ApiError("no_plan");
    const token = newToken();
    await db.query(
      "INSERT INTO share_links (token, plan_id) VALUES ($1, $2) ON CONFLICT (plan_id) DO UPDATE SET token = EXCLUDED.token",
      [token, plan.id],
    );
    return { status: 201, body: { share: { url: `/p/${token}`, created_at: now().toISOString() } } };
  });
}

export function revokeShare(visitorId: string): Promise<Reply> {
  return withDb(async (db) => {
    const plan = await planOf(db, visitorId);
    if (!plan) throw new ApiError("no_plan");
    await db.query("DELETE FROM share_links WHERE plan_id = $1", [plan.id]);
    return { status: 204 };
  });
}

/** The shared view: bedtime, time zone, rituals and total, never the email, the note or an id. */
export function readShared(token: string): Promise<Reply> {
  return withDb(async (db) => {
    const rows = await db.query<HourInput>(
      "SELECT p.bedtime, p.time_zone, p.rituals FROM share_links s JOIN plans p ON p.id = s.plan_id WHERE s.token = $1",
      [token],
    );
    const plan = rows.rows[0];
    if (!plan) throw new ApiError("not_found");
    return {
      status: 200,
      body: {
        plan: {
          bedtime: plan.bedtime,
          time_zone: plan.time_zone,
          rituals: describeRituals(plan.rituals),
          total_minutes: totalMinutes(plan.rituals),
        },
      },
    };
  });
}

/** The live count: confirmed hours with reminders on. */
export function keepingTonight(): Promise<Reply> {
  return withDb(async (db) => {
    const rows = await db.query<{ keeping: number }>("SELECT count(*)::int AS keeping FROM plans WHERE reminders = 'on'");
    return { status: 200, body: { keeping: rows.rows[0].keeping } };
  });
}

/**
 * Delete everything for the address in one step: the hour, drafts, emailed links, sessions, share link,
 * outbox emails and reminder records. Rate-limit counts stay for their hour (they hold no address).
 */
export function eraseVisitor(visitorId: string): Promise<Reply> {
  const address = "(SELECT email FROM visitors WHERE id = $1)";
  return transaction(async (db) => {
    // Waits for a scheduler run that holds this hour, so a reminder it is writing is deleted below too.
    await db.query("SELECT 1 FROM plans WHERE visitor_id = $1 FOR UPDATE", [visitorId]);
    await db.query(`DELETE FROM drafts WHERE email = ${address}`, [visitorId]);
    await db.query(`DELETE FROM links WHERE email = ${address}`, [visitorId]);
    await db.query(`DELETE FROM outbox WHERE recipient = ${address}`, [visitorId]);
    await db.query("DELETE FROM visitors WHERE id = $1", [visitorId]);
    return { status: 204 };
  });
}
