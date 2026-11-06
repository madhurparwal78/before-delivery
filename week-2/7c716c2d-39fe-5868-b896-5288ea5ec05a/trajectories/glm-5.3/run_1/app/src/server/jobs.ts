import { withClient, query, isDatabaseOk, setDatabaseOk, poolRef } from "./db.ts";
import type { Client, Pool } from "./db.ts";
import type { Config } from "./env.ts";
import { nowMs } from "./clock.ts";
import * as mail from "./mail.ts";
import * as storage from "./storage.ts";
import * as billing from "./billing.ts";
import { emitEvent } from "./store.ts";
import { loadCalendarStates } from "./scope.ts";
import { calendarEffectiveOn, currentCycleNumber, cycleSpan, nextCountedOnOrAfter, type CalendarState } from "./calendar.ts";
import { instantInZone, localTimeInstant, partsFor } from "./tz.ts";

interface ServiceStates {
  database: boolean;
  storage: boolean;
  billing: boolean;
}

const states: ServiceStates = { database: true, storage: true, billing: true };
let lastHeldMail = -1;

export function serviceStates(): ServiceStates {
  return states;
}

export function storageAvailable(): boolean {
  return states.storage;
}

export function billingAvailable(): boolean {
  return states.billing;
}

/** Probe each service; flip the shared flags and emit notice events on changes. */
export async function probeServices(cfg: Config): Promise<void> {
  try {
    await query("SELECT 1");
    setDatabaseOk(true);
    if (!states.database) {
      states.database = true;
      await applyOwedSetup(cfg);
      await emitNoticeToAll();
    }
  } catch {
    if (states.database) {
      states.database = false;
      setDatabaseOk(false);
    }
  }
  const wasStorage = states.storage;
  states.storage = await storage.probeStorage(cfg);
  if (wasStorage !== states.storage) await emitNoticeToAll();
  const wasBilling = states.billing;
  try {
    await billing.registerCatalog(cfg);
    states.billing = true;
  } catch {
    states.billing = false;
  }
  if (wasBilling !== states.billing) await emitNoticeToAll();
  try {
    const held = await mail.countHeld();
    if (lastHeldMail !== -1 && held !== lastHeldMail) {
      await emitNoticeToAll();
    }
    lastHeldMail = held;
  } catch {
    // nothing to compare while the database is down
  }
}

async function emitNoticeToAll(): Promise<void> {
  try {
    await withClient(async (client) => {
      const ws = await client.query<{ id: string }>("SELECT id FROM workspaces");
      for (const row of ws.rows) {
        await emitEvent(client, row.id, "notice", {});
      }
    });
  } catch {
    // nothing to announce while the database is down
  }
}

/** Schema, seed and Kill Bill registration owed after a database recovery. */
async function applyOwedSetup(cfg: Config): Promise<void> {
  try {
    const { applySchemaAndSeed, registerWorkspaces } = await import("./setup.ts");
    await applySchemaAndSeed(cfg);
    await registerWorkspaces(cfg);
  } catch {
    // retried on the next probe
  }
}

// ---------------------------------------------------------------------------
// Timed changes: each one is decided here, once, from the server clock.
// ---------------------------------------------------------------------------

export async function runTimedSweeps(cfg: Config): Promise<void> {
  if (!isDatabaseOk()) return;
  const now = nowMs();
  try {
    await withClient(async (client) => {
      // Typing lapses: one typing event per channel whose list changed.
      const lapsed = await client.query<{ channel_id: string; person_id: string }>(
        "DELETE FROM typing WHERE last_signal < $1 RETURNING channel_id, person_id",
        [new Date(now - 5000).toISOString()]
      );
      for (const channelId of new Set(lapsed.rows.map((r) => r.channel_id))) {
        const wsId = await workspaceOfChannel(client, channelId);
        const list = await typingList(client, channelId);
        await emitEvent(client, wsId, "typing", { channel_id: channelId, typing: list });
      }

      // Presence: away after the window with no heartbeat or request.
      const away = await client.query<{ person_id: string; workspace_id: string }>(
        `UPDATE presence SET status = 'away'
         WHERE status = 'active' AND last_heartbeat < $1
         RETURNING person_id, workspace_id`,
        [new Date(now - cfg.presenceAwaySeconds * 1000).toISOString()]
      );
      for (const row of away.rows) {
        await emitEvent(client, row.workspace_id, "presence", { person_id: row.person_id, status: "away" });
      }

      // Knock expiry: the edge itself counts as expired.
      const expired = await client.query<{ id: string; room_id: string }>(
        `UPDATE knocks SET status = 'expired'
         WHERE status = 'waiting' AND created_at < $1
         RETURNING id, room_id`,
        [new Date(now - cfg.knockTtlSeconds * 1000).toISOString()]
      );
      for (const row of expired.rows) {
        const wsId = await workspaceOfRoom(client, row.room_id);
        await emitEvent(client, wsId, "knock", { id: row.id });
      }

      // A private room that lost its last occupant expires its waiting knocks.
      const emptied = await client.query<{ room_id: string; workspace_id: string }>(
        `SELECT r.id AS room_id, r.workspace_id FROM rooms r
         WHERE r.kind = 'private'
           AND NOT EXISTS (SELECT 1 FROM room_occupants o WHERE o.room_id = r.id)
           AND EXISTS (SELECT 1 FROM knocks k WHERE k.room_id = r.id AND k.status = 'waiting')`
      );
      for (const room of emptied.rows) {
        const rows = await client.query<{ id: string }>(
          "UPDATE knocks SET status = 'expired' WHERE room_id = $1 AND status = 'waiting' RETURNING id",
          [room.room_id]
        );
        for (const row of rows.rows) {
          await emitEvent(client, room.workspace_id, "knock", { id: row.id });
        }
      }

      // Stream grace: leave the room once the last stream has been closed for the window.
      const leaves = await client.query<{ person_id: string; room_id: string; workspace_id: string }>(
        `DELETE FROM room_occupants o
         USING stream_state s
         WHERE o.person_id = s.person_id
           AND s.stream_count <= 0
           AND s.last_disconnect IS NOT NULL
           AND s.last_disconnect < $1
         RETURNING o.person_id, o.room_id, s.workspace_id`,
        [new Date(now - cfg.streamGraceSeconds * 1000).toISOString()]
      );
      for (const row of leaves.rows) {
        const { roomJson } = await import("./proj.ts");
        const room = await roomJson(client, row.room_id);
        if (room) await emitEvent(client, row.workspace_id, "room", room);
      }

      // Digests: queue the digest for today's counted day once it is 08:00 or later.
      await queueTodayDigests(cfg, client, now);

      // Idempotency records live for their TTL.
      await client.query("DELETE FROM idempotency WHERE created_at < $1", [
        new Date(now - cfg.idempotencyTtlSeconds * 1000).toISOString(),
      ]);

      // Retention: keep the 1,000 most recent events per workspace.
      await client.query(
        `DELETE FROM events WHERE id IN (
           SELECT id FROM (
             SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY id DESC) AS rn
             FROM events
           ) ranked WHERE ranked.rn > 1000
         )`
      );
    });
  } catch (e) {
    console.error("sweep failed:", e);
  }

  // Attachment deletion queue: remove objects once storage is reachable.
  try {
    const rows = await query<{ id: string; storage_key: string }>(
      "SELECT id, storage_key FROM attachment_deletions ORDER BY created_at LIMIT 20"
    );
    for (const row of rows.rows) {
      try {
        await storage.deleteObject(row.storage_key);
        await query("DELETE FROM attachment_deletions WHERE id = $1", [row.id]);
      } catch {
        break;
      }
    }
  } catch {
    // database down
  }

  // Seat limits: adopt Kill Bill's confirmed value for each workspace.
  try {
    const ws = await query<{ id: string; name: string; seat_limit: number }>(
      "SELECT id, name, seat_limit FROM workspaces"
    );
    for (const w of ws.rows) {
      const calStates = await loadCalendarStates(poolRef(), w.id);
      const today = partsFor(calStates[0].time_zone, now).date;
      let state = await billing.readBillingState(cfg, w.id, w.name, w.seat_limit);
      if (state.scheduledOn !== null && state.scheduledLimit !== null && state.scheduledOn <= today) {
        state = await billing.applyScheduledReduction(cfg, w.id, w.name, w.seat_limit, today);
      }
      if (state.limit !== w.seat_limit) {
        await query("UPDATE workspaces SET seat_limit = $1 WHERE id = $2", [state.limit, w.id]);
      }
    }
  } catch {
    // the next sweep retries
  }

  try {
    await mail.deliverOutbox(cfg);
  } catch (e) {
    console.error("mail delivery failed:", e);
  }
}

async function typingList(client: Client, channelId: string): Promise<string[]> {
  const res = await client.query<{ person_id: string }>(
    `SELECT t.person_id FROM typing t JOIN people p ON p.id = t.person_id
     WHERE t.channel_id = $1 ORDER BY p.name, t.person_id`,
    [channelId]
  );
  return res.rows.map((r) => r.person_id);
}

async function workspaceOfChannel(client: Client, channelId: string): Promise<string> {
  const res = await client.query<{ workspace_id: string }>("SELECT workspace_id FROM channels WHERE id = $1", [channelId]);
  return res.rows[0].workspace_id;
}

async function workspaceOfRoom(client: Client, roomId: string): Promise<string> {
  const res = await client.query<{ workspace_id: string }>("SELECT workspace_id FROM rooms WHERE id = $1", [roomId]);
  return res.rows[0].workspace_id;
}

/** Digests: one per owner and member per counted day, queued at or after 08:00. */
async function queueTodayDigests(cfg: Config, client: Client, now: number): Promise<void> {
  const ws = await client.query<{ id: string }>("SELECT id FROM workspaces");
  for (const w of ws.rows) {
    const calStates = await loadCalendarStates(client, w.id);
    const today = partsFor(calStates[0].time_zone, now).date;
    const cal = calendarEffectiveOn(calStates, today);
    const counted = cal.working_weekdays.includes(isoWeekdayOf(today)) && !cal.holidays.some((h) => h.date === today);
    if (!counted) continue;
    const dueMs = localTimeInstant(cal.time_zone, today, 8, 0);
    if (now < dueMs) continue;
    const people = await client.query<{ id: string; email: string }>(
      "SELECT id, email FROM people WHERE workspace_id = $1 AND role IN ('owner','member') AND NOT removed",
      [w.id]
    );
    for (const person of people.rows) {
      // The digest row and its email commit together, so neither is left behind.
      await client.query("BEGIN");
      try {
        const inserted = await client.query(
          `INSERT INTO digests (workspace_id, person_id, date, created_at) VALUES ($1,$2,$3,$4)
           ON CONFLICT DO NOTHING`,
          [w.id, person.id, today, new Date(now).toISOString()]
        );
        if (inserted.rowCount === 0) {
          await client.query("COMMIT");
          continue;
        }
        const body = await digestBodyFor(client, w.id, person.id);
        await mail.queueMail(client, {
          workspaceId: w.id,
          kind: "digest",
          toEmail: person.email,
          subject: digestSubject(today),
          body,
          refTable: null,
          refId: null,
        });
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  }
  void cfg;
}

function isoWeekdayOf(date: string): number {
  const d = new Date(`${date}T00:00:00Z`);
  return ((d.getUTCDay() + 6) % 7) + 1;
}

function digestSubject(date: string): string {
  const dt = new Date(`${date}T00:00:00Z`);
  const weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dt.getUTCDay()];
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][dt.getUTCMonth()];
  return `Your Tallyroom digest for ${weekday} ${dt.getUTCDate()} ${month}`;
}

async function digestBodyFor(client: Client, workspaceId: string, personId: string): Promise<string> {
  const { unreadCountsFor } = await import("./store.ts");
  const counts = await unreadCountsFor(client, personId);
  const open = await client.query<{ key: string; title: string }>(
    `SELECT p.key || '-' || i.number AS key, i.title FROM issues i
     JOIN projects p ON p.id = i.project_id
     WHERE i.workspace_id = $1 AND i.status NOT IN ('done','cancelled')
     ORDER BY p.key, i.number`,
    [workspaceId]
  );
  const lines = open.rows.map((r) => `- ${r.key}: ${r.title}`);
  return `Open issues:\n${lines.join("\n")}\n\nInbox unread: ${counts.inbox}`;
}

/** The next digest instant: 08:00 on the next counted day whose digest has not been queued. */
export async function nextDigestAt(workspaceId: string): Promise<string | null> {
  const calStates = await loadCalendarStates(poolRef(), workspaceId);
  const now = nowMs();
  const today = partsFor(calStates[0].time_zone, now).date;
  // Walk counted days from today up to the end of the current cycle plus one.
  const current = currentCycleNumber(calStates, now);
  const countedDays: string[] = [];
  let firstCounted = nextCountedOnOrAfter(calStates[0], calStates[0].cycle_anchor);
  for (let n = 1; n <= current + 1; n++) {
    const span = cycleSpan(calStates, firstCounted);
    for (const d of span.countedDates) countedDays.push(d);
    firstCounted = span.nextFirst;
  }
  const queued = await query<{ date: string }>("SELECT DISTINCT date FROM digests WHERE workspace_id = $1", [workspaceId]);
  const queuedSet = new Set(queued.rows.map((r) => r.date));
  for (const date of countedDays) {
    if (date < today) continue;
    if (queuedSet.has(date)) continue;
    const cal = calendarEffectiveOn(calStates, date);
    return instantInZone(cal.time_zone, localTimeInstant(cal.time_zone, date, 8, 0));
  }
  return null;
}

export function startBackgroundJobs(pool: Pool, cfg: Config): void {
  void pool;
  setInterval(() => {
    void probeServices(cfg);
  }, 5000);
  setInterval(() => {
    void runTimedSweeps(cfg);
  }, 2000);
  void probeServices(cfg);
}
