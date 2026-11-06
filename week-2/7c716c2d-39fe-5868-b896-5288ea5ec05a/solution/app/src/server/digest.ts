// The 08:00 digest on each counted day, queued once per workspace and date.
import type { Viewer } from "./access.js";
import { loadCalendar, type WorkspaceCalendar } from "./calendar.js";
import { cycleIssues } from "./cycles.js";
import { query, tx, type Db } from "./db.js";
import { queueMail } from "./outbox.js";
import { localTime, longDate, type IsoDate } from "./time.js";
import { unreadBody } from "./unread.js";
import { STATUS_LABELS, isClosed } from "../shared/status-edges.js";

const DIGEST_HOUR = 8;

async function queuedFor(db: Db, workspaceId: string, day: IsoDate): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM digest_runs WHERE workspace_id = $1 AND day = $2", [workspaceId, day]);
  return rows.length > 0;
}

function digestTime(cal: WorkspaceCalendar, day: IsoDate): number {
  return localTime(day, DIGEST_HOUR, cal.inEffectOn(day).time_zone);
}

/** 08:00 on the next counted day whose digest has not been queued yet. */
export async function nextDigestAt(db: Db, workspaceId: string, cal: WorkspaceCalendar): Promise<number> {
  const today = cal.today();
  if (cal.day(today).counted && !(await queuedFor(db, workspaceId, today))) return digestTime(cal, today);
  return digestTime(cal, cal.nextCounted(today));
}

async function queueDigests(db: Db, workspaceId: string, cal: WorkspaceCalendar, day: IsoDate): Promise<void> {
  const { rows: people } = await db.query<Viewer>(
    "SELECT id, name, email, handle, role, workspace_id AS \"workspaceId\" FROM people WHERE workspace_id = $1 AND role IN ('owner', 'member') ORDER BY name",
    [workspaceId],
  );
  const current = cal.currentNumber();
  for (const person of people) {
    const open = (await cycleIssues(db, person, cal, current)).filter((issue) => !isClosed(issue.status));
    const unread = await unreadBody(db, person.id);
    const lines = open.length ? open.map((issue) => `- ${issue.key} ${issue.title} (${STATUS_LABELS[issue.status]})`) : ["- No open issues in this cycle."];
    await queueMail(db, {
      workspaceId,
      kind: "digest",
      recipientId: person.id,
      email: person.email,
      subject: `Your Tallyroom digest for ${longDate(day)}`,
      body: [`Good morning ${person.name},`, "", `Open issues in cycle ${current}:`, ...lines, "", `Inbox: ${unread.inbox} unread`, ""].join("\n"),
    });
  }
}

/** Queues today's digests once 08:00 has passed on a counted day. */
export async function digestTick(): Promise<void> {
  const workspaces = await query<{ id: string }>("SELECT id FROM workspaces");
  for (const { id } of workspaces) {
    await tx(async (db) => {
      const cal = await loadCalendar(db, id);
      const today = cal.today();
      if (!cal.day(today).counted || cal.now < digestTime(cal, today)) return;
      const { rows } = await db.query("INSERT INTO digest_runs (workspace_id, day) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING day", [id, today]);
      if (rows.length) await queueDigests(db, id, cal, today);
    });
  }
}
