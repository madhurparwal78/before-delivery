// Notices go through ntfy, once at the published time, for riders with reminders on.
// Each rider's topic is malhar-<rider id>. A notice is sent only on a 200 reply.
import { config } from "./config";
import { appNowMs, formatDddDMon, formatIstTime } from "./clock";
import { pool, n } from "./db";
import { hubById, modelById } from "./seed";
import {} from "./store";

const NTFY_TIMEOUT_MS = 3000;

export interface NoticeRow {
  id: string;
  rider_id: string;
  kind: string;
  state: string;
  due_at_ms: number;
  sent_at_ms: number | null;
  lock_id: string | null;
  ride_id: string | null;
  topic: string | null;
}

async function ntfyPublish(topic: string, title: string, message: string): Promise<boolean> {
  const url = `${config.ntfyUrl.replace(/\/$/, "")}/${topic}`;
  const headers: Record<string, string> = { Title: title };
  if (config.ntfyUsername) {
    headers.Authorization = `Basic ${Buffer.from(`${config.ntfyUsername}:${config.ntfyPassword}`).toString("base64")}`;
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), NTFY_TIMEOUT_MS);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: message,
      signal: controller.signal,
    });
    clearTimeout(t);
    return res.status === 200;
  } catch {
    return false;
  }
}

// Publishes the confirmation notice and sets remindersOn only after ntfy accepts it.
function dateStr(v: string | Date): string {
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  return v;
}

export async function turnOnReminders(userId: string): Promise<{ remindersOn: boolean; topic: string }> {
  const topic = `malhar-${userId}`;
  const ok = await ntfyPublish(topic, "Reminders on", "Key-On will send lock and ride notices here.");
  if (!ok) return { remindersOn: false, topic };
  await pool.query(`UPDATE users SET reminders_on = true WHERE id = $1`, [userId]);
  return { remindersOn: true, topic };
}

// Creates a pending notice if not already there (dedupe by key).
export async function ensurePendingNotice(params: {
  riderId: string;
  kind: "lock_ending" | "ride_reminder" | "delivery_place";
  dueAtMs: number;
  lockId?: string | null;
  rideId?: string | null;
  dedupeKey: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO notices (id, rider_id, kind, state, due_at_ms, sent_at_ms, lock_id, ride_id, dedupe_key)
     VALUES ($1, $2, $3, 'pending', $4, NULL, $5, $6, $7)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      `notice_${params.dedupeKey}`,
      params.riderId,
      params.kind,
      params.dueAtMs,
      params.lockId ?? null,
      params.rideId ?? null,
      params.dedupeKey,
    ]
  );
}

export async function cancelNoticesForLock(lockId: string): Promise<void> {
  await pool.query(`UPDATE notices SET state = 'cancelled' WHERE lock_id = $1 AND state = 'pending'`, [lockId]);
}

export async function cancelNoticesForRide(rideId: string): Promise<void> {
  await pool.query(`UPDATE notices SET state = 'cancelled' WHERE ride_id = $1 AND state = 'pending'`, [rideId]);
}

// Each sweep sends due pending notices. Any copy may send a pending notice on its
// next sweep, with no leader and no claim left behind by a failing copy.
export async function sendDueNotices(): Promise<void> {
  const now = appNowMs();
  const due = await pool.query(
    `SELECT * FROM notices WHERE state = 'pending' AND due_at_ms <= $1 ORDER BY due_at_ms ASC LIMIT 20`,
    [now]
  );
  for (const row of due.rows as NoticeRow[]) {
    // claim it atomically: only one copy moves it to 'sending' then 'sent'
    const claimed = await pool.query(
      `UPDATE notices SET state = 'sending' WHERE id = $1 AND state = 'pending' RETURNING id`,
      [row.id]
    );
    if (!claimed.rowCount) continue;
    let keepPending = false;
    try {
      const user = await pool.query(`SELECT reminders_on FROM users WHERE id = $1`, [row.rider_id]);
      const remindersOn = user.rowCount ? (user.rows[0] as { reminders_on: boolean }).reminders_on : false;
      if (!remindersOn) {
        // a notice is sent only for a rider with reminders on at its due time
        await pool.query(`UPDATE notices SET state = 'cancelled' WHERE id = $1`, [row.id]);
        continue;
      }
      const text = await noticeText(row);
      if (text === null) {
        await pool.query(`UPDATE notices SET state = 'cancelled' WHERE id = $1`, [row.id]);
        continue;
      }
      const topic = `malhar-${row.rider_id}`;
      const ok = await ntfyPublish(topic, text.title, text.message);
      if (ok) {
        await pool.query(`UPDATE notices SET state = 'sent', sent_at_ms = $2, topic = $3 WHERE id = $1`, [
          row.id,
          now,
          topic,
        ]);
      } else {
        keepPending = true;
      }
    } catch {
      keepPending = true;
    }
    if (keepPending) {
      await pool.query(`UPDATE notices SET state = 'pending' WHERE id = $1`, [row.id]);
    }
  }
}

async function noticeText(row: NoticeRow): Promise<{ title: string; message: string } | null> {
  const user = (await pool.query(`SELECT reminders_on FROM users WHERE id = $1`, [row.rider_id])).rows[0] as
    | { reminders_on: boolean }
    | undefined;
  if (!user) return null;
  if (row.kind === "lock_ending") {
    const lock = (await pool.query(`SELECT hub, model, expires_at_ms, state FROM locks WHERE id = $1`, [row.lock_id]))
      .rows[0] as { hub: string; model: string; expires_at_ms: string | number; state: string } | undefined;
    if (!lock || lock.state !== "locked") return null;
    const modelName = modelById(lock.model)?.name ?? lock.model;
    const hubName = hubById(lock.hub)?.name ?? lock.hub;
    return {
      title: "Price lock ends today",
      message: `Your ${modelName} price lock at ${hubName} ends at ${formatIstTime(n(lock.expires_at_ms))} today.`,
    };
  }
  if (row.kind === "ride_reminder") {
    const ride = (await pool.query(`SELECT hub, model, starts_at_ms, state FROM rides WHERE id = $1`, [row.ride_id]))
      .rows[0] as { hub: string; model: string; starts_at_ms: string | number; state: string } | undefined;
    if (!ride || ride.state !== "booked") return null;
    const modelName = modelById(ride.model)?.name ?? ride.model;
    const hubName = hubById(ride.hub)?.name ?? ride.hub;
    return {
      title: "Test ride tomorrow",
      message: `Your ${modelName} ride at ${hubName} is tomorrow at ${formatIstTime(n(ride.starts_at_ms))} IST.`,
    };
  }
  if (row.kind === "delivery_place") {
    const lock = (await pool.query(`SELECT hub, model, delivery_date, state FROM locks WHERE id = $1`, [row.lock_id]))
      .rows[0] as { hub: string; model: string; delivery_date: string | Date; state: string } | undefined;
    if (!lock || lock.state !== "delivery_set") return null;
    const modelName = modelById(lock.model)?.name ?? lock.model;
    const hubName = hubById(lock.hub)?.name ?? lock.hub;
    return {
      title: "Delivery day set",
      message: `A place opened at ${hubName}. Your ${modelName} handover is on ${formatDddDMon(Date.parse(`${dateStr(lock.delivery_date)}T18:00:00+05:30`))}.`,
    };
  }
  return null;
}
