// Mission history: every mission event, recorded where it happens and read newest first in pages.
import type { Db } from "./db.js";
import { rows } from "./db.js";
import { invalid } from "./http.js";
import type { MissionEventRecord } from "./records.js";

const EVENT_KINDS = ["created", "assignments", "status", "line", "file", "alert", "infill", "owner", "hold", "geofence", "rerun"] as const;
type EventKind = (typeof EVENT_KINDS)[number];

export const SYSTEM = "Swathdeck";

export async function recordEvent(db: Db, missionId: string, kind: EventKind, actor: string, summary: string, at = new Date()): Promise<void> {
  await db.query("INSERT INTO mission_events (mission_id, at, kind, actor, summary) VALUES ($1,$2,$3,$4,$5)",
    [missionId, at, kind, actor, summary]);
}

const PAGE = 50;

/** Opaque cursor: base64url of [at, seq] of the last event shown (pattern from kit/modules/cursor). */
const encode = (at: Date, seq: number) => Buffer.from(JSON.stringify([at.toISOString(), seq])).toString("base64url");

function decode(cursor: string): [Date, number] | null {
  try {
    const [at, seq] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const when = new Date(at);
    return typeof seq === "number" && !Number.isNaN(when.getTime()) ? [when, seq] : null;
  } catch {
    return null;
  }
}

export async function historyPage(db: Db, missionId: string, kindsParam: string | null, before: string | null) {
  const kinds = kindsParam === null || kindsParam === "" ? [...EVENT_KINDS] : kindsParam.split(",");
  if (!kinds.every((k) => (EVENT_KINDS as readonly string[]).includes(k))) throw invalid({ kinds: "Choose kinds from the published list" });
  const cursor = before ? decode(before) : null;
  if (before && !cursor) throw invalid({ before: "Send the cursor from the previous page" });
  const found = await rows<Omit<MissionEventRecord, "mission_id">>(db,
    `SELECT seq, at, kind, actor, summary FROM mission_events
     WHERE mission_id = $1 AND kind = ANY($2) ${cursor ? "AND (at, seq) < ($4, $5)" : ""}
     ORDER BY at DESC, seq DESC LIMIT $3`,
    cursor ? [missionId, kinds, PAGE + 1, cursor[0], cursor[1]] : [missionId, kinds, PAGE + 1]);
  const page = found.slice(0, PAGE);
  const last = page[page.length - 1];
  return {
    events: page.map((e) => ({ seq: e.seq, at: e.at.toISOString(), kind: e.kind, actor: e.actor, summary: e.summary })),
    next: found.length > PAGE && last ? encode(last.at, last.seq) : null,
  };
}
