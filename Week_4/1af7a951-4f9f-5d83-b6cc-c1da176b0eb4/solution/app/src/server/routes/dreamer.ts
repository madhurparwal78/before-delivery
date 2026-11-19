import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Entry, NightSettings, NightStatus } from "../../shared/api.js";
import { isCategory } from "../../shared/api.js";
import { byteRange, matchesSignature, memoDuration } from "../domain/memos.js";
import { constellations, isPhraseRange, tallies, targetCategory } from "../domain/signs.js";
import { captureWindow, isLateRecall, isNightHeld, NIGHTS, nightKeyAt, nightNumber, TECHNIQUE_NIGHT, wakeAlarm } from "../domain/time.js";
import { categoryErrors, entryFields, isUuid, MESSAGES, sameEntryFields, settingsErrors, sharedErrors, type FieldErrors } from "../domain/validation.js";
import { pool, transaction, type Db } from "../db.js";
import { fail, invalid, notFound, ok, type Reply } from "../http.js";
import { dreamerOnly, type Route } from "../router.js";
import { getMemo, memoKey, putMemo } from "../services/storage.js";
import { memoOf, phaseOf, SIGN_SELECT, toEntry, toSign, type EntryRow, type SignRow } from "../views.js";
import type { DreamerViewer } from "../viewer.js";

function phaseFor(me: DreamerViewer, now: Date) {
  return phaseOf({ published: me.cohortPublished, closed: me.cohortClosed, starts_on: me.cohortStartsOn, coach_tz: me.coachTz }, now);
}

/** The dreamer's published night at `now`: the night key (never before their latest entry's) and its number. */
function tonight(me: DreamerViewer, now: Date): { nightKey: string; night: number } {
  const nightKey = nightKeyAt(now, me);
  return { nightKey, night: nightNumber(nightKey, me.firstNight) };
}

/** The dreamer's own entry; with `lock`, its row (and so its memo slot and its signs) is held until the transaction ends. */
async function ownEntry(db: Db, me: DreamerViewer, id: string | undefined, lock = false): Promise<EntryRow> {
  if (!isUuid(id)) throw notFound();
  const found = await db.query<EntryRow>(`SELECT * FROM entries WHERE id = $1 AND enrollment_id = $2${lock ? " FOR UPDATE" : ""}`, [id, me.enrollmentId]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

async function signsOf(db: Db, enrollmentId: string): Promise<SignRow[]> {
  return (await db.query<SignRow>(`${SIGN_SELECT} WHERE n.enrollment_id = $1 ORDER BY s.created_at`, [enrollmentId])).rows;
}

async function entryView(db: Db, me: DreamerViewer, row: EntryRow): Promise<Entry> {
  const signs = await db.query<SignRow>(`${SIGN_SELECT} WHERE s.entry_id = $1`, [row.id]);
  return toEntry(row, me.firstNight, signs.rows);
}

/** An existing entry id answers as a replay (identical body), a conflict, or not found for another dreamer. */
async function replayOrConflict(me: DreamerViewer, id: string, body: Record<string, unknown>) {
  const stored = await pool.query<EntryRow>("SELECT * FROM entries WHERE id = $1", [id]);
  const row = stored.rows[0];
  if (!row) return null;
  if (row.enrollment_id !== me.enrollmentId) throw notFound();
  if (!sameEntryFields(body, row)) throw fail(409, "entry_id_conflict");
  return ok({ entry: await entryView(pool, me, row) });
}

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

/** The memo slot's check order; the slot is claimed in Postgres before MinIO is contacted and released if the write fails. */
async function storeMemo(me: DreamerViewer, entryId: string | undefined, raw: Buffer, req: IncomingMessage): Promise<Reply> {
  const contentType = req.headers["content-type"] ?? "";
  const duration = memoDuration(req.headers["x-memo-duration-ms"]);
  return transaction(async (client) => {
    const row = await ownEntry(client, me, entryId, true);
    const stored = memoOf(row);
    if (stored) {
      const identical = row.memo_sha256 === sha256(raw) && stored.content_type === contentType && stored.duration_ms === duration;
      if (!identical) throw fail(409, "memo_exists");
      return ok({ memo: stored });
    }
    if (duration === null) throw invalid({ duration_ms: MESSAGES.duration });
    if (raw.length === 0) throw invalid({ memo: MESSAGES.emptyMemo });
    if (!matchesSignature(contentType, raw)) throw invalid({ memo: MESSAGES.memoSignature });
    await client.query(
      "UPDATE entries SET memo_content_type = $2, memo_size_bytes = $3, memo_duration_ms = $4, memo_sha256 = $5 WHERE id = $1",
      [row.id, contentType, raw.length, duration, sha256(raw)],
    );
    await putMemo(memoKey(me.enrollmentId, row.id), raw, contentType, duration);
    return ok({ memo: { content_type: contentType, size_bytes: raw.length, duration_ms: duration } }, 201);
  });
}

/** The tag's check order, decided while the entry's row is locked so that no two stored signs ever overlap. */
async function tagSign(me: DreamerViewer, entryId: string | undefined, body: Record<string, unknown>): Promise<Reply> {
  const { start, end, category } = body;
  return transaction(async (client) => {
    const row = await ownEntry(client, me, entryId, true);
    const answer = async (sign: SignRow, status: number) => ok({ sign: toSign(sign), tallies: tallies(await signsOf(client, me.enrollmentId)) }, status);
    if (typeof start === "number" && typeof end === "number" && Number.isInteger(start) && Number.isInteger(end)) {
      const stored = (await client.query<SignRow>(`${SIGN_SELECT} WHERE s.entry_id = $1 ORDER BY s.created_at`, [row.id])).rows;
      const identical = stored.find((sign) => sign.start_offset === start && sign.end_offset === end);
      if (identical && identical.category === category) return answer(identical, 200);
      if (identical && isCategory(category)) throw fail(409, "sign_conflict");
      const overlapping = stored.find((sign) => sign !== identical && start < sign.end_offset && sign.start_offset < end);
      if (overlapping) throw fail(409, "sign_overlap", { sign_id: overlapping.id });
    }
    const errors: FieldErrors = { ...categoryErrors(category) };
    if (!isPhraseRange(row.text, start, end)) errors.range = MESSAGES.range;
    if (!isPhraseRange(row.text, start, end) || typeof end !== "number" || !isCategory(category) || Object.keys(errors).length > 0) {
      throw invalid(errors);
    }
    const inserted = await client.query<{ id: string }>(
      "INSERT INTO dream_signs (entry_id, start_offset, end_offset, phrase, category) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [row.id, start, end, row.text.slice(start, end), category],
    );
    const made = (await client.query<SignRow>(`${SIGN_SELECT} WHERE s.id = $1`, [inserted.rows[0]?.id])).rows[0];
    if (!made) throw new Error("the stored sign could not be read back");
    return answer(made, 201);
  });
}

export const dreamerRoutes: Route[] = [
  dreamerOnly("GET", /^\/api\/me\/night$/, async ({ now }, me) => {
    const { nightKey, night } = tonight(me, now);
    const status: NightStatus = {
      night_key: nightKey,
      night_number: night,
      first_night: me.firstNight,
      capture_window: captureWindow(nightKey, now, me.homeTz),
      bedtime: me.bedtime,
      wake_alarm: wakeAlarm(me.bedtime),
      home_tz: me.homeTz,
      technique_unlocked: night >= TECHNIQUE_NIGHT,
      cohort_phase: phaseFor(me, now).phase,
    };
    return ok(status);
  }),

  dreamerOnly("PATCH", /^\/api\/me\/settings$/, async ({ body, now }, me) => {
    const errors = settingsErrors(body);
    if (Object.keys(errors).length > 0) throw invalid(errors);
    const updated = await pool.query<{ home_tz: string; bedtime: string }>(
      "UPDATE enrollments SET home_tz = COALESCE($2, home_tz), bedtime = COALESCE($3, bedtime) WHERE id = $1 RETURNING home_tz, bedtime",
      [me.enrollmentId, body.home_tz ?? null, body.bedtime ?? null],
    );
    const saved = updated.rows[0];
    if (!saved) throw notFound();
    const after = { homeTz: saved.home_tz, bedtime: saved.bedtime, latestEntryKey: me.latestEntryKey };
    const nightKey = nightKeyAt(now, after);
    const settings: NightSettings = {
      home_tz: saved.home_tz,
      bedtime: saved.bedtime,
      wake_alarm: wakeAlarm(saved.bedtime),
      night_key: nightKey,
      night_number: nightNumber(nightKey, me.firstNight),
      night_held: isNightHeld(now, after),
    };
    return ok(settings);
  }),

  dreamerOnly("GET", /^\/api\/me\/entries$/, async (_ctx, me) => {
    const rows = await pool.query<EntryRow>(
      "SELECT * FROM entries WHERE enrollment_id = $1 ORDER BY night_key DESC, created_at DESC",
      [me.enrollmentId],
    );
    const signs = await signsOf(pool, me.enrollmentId);
    return ok({ entries: rows.rows.map((row) => toEntry(row, me.firstNight, signs)) });
  }),

  dreamerOnly("PUT", /^\/api\/me\/entries\/([^/]+)$/, async ({ params, body, now }, me) => {
    const id = params[0];
    if (!isUuid(id)) throw invalid({ id: MESSAGES.entryId });
    const replay = await replayOrConflict(me, id, body);
    if (replay) return replay;
    const { nightKey, night } = tonight(me, now);
    if (night < 1) throw fail(409, "cohort_not_started");
    if (night > NIGHTS || phaseFor(me, now).phase === "closed") throw fail(409, "cohort_closed");
    const checked = entryFields(body, night);
    if ("errors" in checked) throw invalid(checked.errors);
    const f = checked.fields;
    const inserted = await pool.query<EntryRow>(
      `INSERT INTO entries (id, enrollment_id, night_key, title, text, dreams_recalled, lucid, wbtb, technique,
         technique_minutes, late_recall, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, date_trunc('second', $12::timestamptz))
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [id, me.enrollmentId, nightKey, f.title, f.text, f.dreams_recalled, f.lucid, f.wbtb, f.technique,
        f.technique_minutes, isLateRecall(nightKey, now, me.homeTz), now],
    );
    const row = inserted.rows[0];
    if (row) return ok({ entry: await entryView(pool, me, row) }, 201);
    // A simultaneous save of the same id committed first: answer as its replay, conflict or not found.
    const raced = await replayOrConflict(me, id, body);
    if (raced) return raced;
    throw fail(409, "entry_id_conflict");
  }),

  dreamerOnly("PUT", /^\/api\/me\/entries\/([^/]+)\/share$/, async ({ params, body }, me) => {
    const row = await ownEntry(pool, me, params[0]);
    const errors = sharedErrors(body.shared);
    if (typeof body.shared !== "boolean") throw invalid(errors);
    await pool.query("UPDATE entries SET shared = $2 WHERE id = $1", [row.id, body.shared]);
    return ok({ entry: await entryView(pool, me, { ...row, shared: body.shared }) });
  }),

  dreamerOnly("PUT", /^\/api\/me\/entries\/([^/]+)\/memo$/, async ({ params, raw, req }, me) => storeMemo(me, params[0], raw, req), "memo"),

  dreamerOnly("GET", /^\/api\/me\/entries\/([^/]+)\/memo$/, async ({ params, req }, me) =>
    memoReply(await ownEntry(pool, me, params[0]), me.enrollmentId, req.headers.range),
  ),

  dreamerOnly("POST", /^\/api\/me\/entries\/([^/]+)\/signs$/, async ({ params, body }, me) => tagSign(me, params[0], body)),

  dreamerOnly("GET", /^\/api\/me\/dreamscape$/, async (_ctx, me) => {
    const signs = await signsOf(pool, me.enrollmentId);
    return ok({
      constellations: constellations(signs.map((s) => ({ category: s.category, nightKey: s.night_key }))),
      target_category: targetCategory(tallies(signs)),
    });
  }),

  dreamerOnly("POST", /^\/api\/me\/reality-checks$/, async ({ body, now }, me) => {
    const { id, category } = body;
    const stored = async () => {
      if (!isUuid(id)) return null;
      const found = await pool.query<{ id: string; enrollment_id: string; category: string; night_key: string; night_count: number }>(
        `SELECT r.id, r.enrollment_id, r.category, r.night_key,
                (SELECT count(*)::int FROM reality_checks o
                  WHERE o.enrollment_id = r.enrollment_id AND o.night_key = r.night_key
                    AND (o.created_at, o.id) <= (r.created_at, r.id)) AS night_count
           FROM reality_checks r WHERE r.id = $1`,
        [id],
      );
      const check = found.rows[0];
      if (!check) return null;
      if (check.enrollment_id !== me.enrollmentId) throw notFound();
      if (check.category !== category) throw fail(409, "reality_check_id_conflict");
      return { reality_check: { id: check.id, category: check.category, night_key: check.night_key }, night_count: check.night_count };
    };
    const replay = await stored();
    if (replay) return ok(replay);
    const errors: FieldErrors = { ...categoryErrors(category) };
    if (!isUuid(id)) errors.id = MESSAGES.realityCheckId;
    if (Object.keys(errors).length > 0) throw invalid(errors);
    const inserted = await pool.query(
      "INSERT INTO reality_checks (id, enrollment_id, category, night_key) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
      [id, me.enrollmentId, category, tonight(me, now).nightKey],
    );
    const made = await stored();
    if (!made) throw fail(409, "reality_check_id_conflict");
    return ok(made, inserted.rowCount ? 201 : 200);
  }),
];

/** The stored memo bytes, in full or as one byte range, with the stored type and duration; never an object key or URL. */
export async function memoReply(row: EntryRow, enrollmentId: string, range: string | undefined): Promise<Reply> {
  const memo = memoOf(row);
  if (!memo) throw notFound();
  const data = await getMemo(memoKey(enrollmentId, row.id));
  const headers = { "Accept-Ranges": "bytes", "X-Memo-Duration-Ms": String(memo.duration_ms) };
  const answer = byteRange(range, data.length);
  if (answer.kind === "unsatisfiable") throw fail(416, "range_not_satisfiable", {}, { "Content-Range": `bytes */${data.length}` });
  if (answer.kind === "full") return { status: 200, bytes: { data, contentType: memo.content_type, headers } };
  const { first, last } = answer;
  return {
    status: 206,
    bytes: { data: data.subarray(first, last + 1), contentType: memo.content_type, headers: { ...headers, "Content-Range": `bytes ${first}-${last}/${data.length}` } },
  };
}
