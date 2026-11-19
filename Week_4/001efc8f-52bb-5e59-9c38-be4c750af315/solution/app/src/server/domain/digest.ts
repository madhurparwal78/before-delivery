import { now } from "../clock.js";
import { config } from "../config.js";
import { pool, rows, tx } from "../db.js";
import { sendMail } from "../services/smtp.js";
import { formatBusinessDate, formatWhen, localDate, localParts } from "./businessTime.js";
import { ANSWERED } from "./mentions.js";

const DIGEST_HOUR = 7;
const QUOTE_MAX = 140;
const RETRY_MS = 30_000;
const DIGEST_SENDERS = 4;

type Workspace = { id: string; time_zone: string };
type Period = { key: string; dated: Date };

// The digest period for a workspace at an instant: its business date once 07:00 local has come,
// or the current window when DIGEST_INTERVAL_SECONDS is set.
function duePeriod(workspace: Workspace, at: Date): Period | null {
  if (config.digestIntervalSeconds !== null) {
    const span = config.digestIntervalSeconds * 1000;
    const start = Math.floor(at.getTime() / span) * span;
    return { key: `window:${start / 1000}`, dated: new Date(start) };
  }
  const local = localParts(workspace.time_zone, at);
  return local.hour < DIGEST_HOUR ? null : { key: localDate(local), dated: at };
}

type Eligible = { id: string; text: string; sent_at: Date; channel: string; private: boolean; author: string; member: boolean };

// Eligible mentions: unanswered right now, message still there, older than the threshold, not
// handled by an earlier digest.
function eligibleMentions(userId: string, at: Date): Promise<Eligible[]> {
  return rows<Eligible>(
    pool,
    `SELECT mn.id, m.text, m.sent_at, c.name AS channel, c.private, au.name AS author,
            EXISTS (SELECT 1 FROM memberships mb WHERE mb.channel_id = c.id AND mb.user_id = mn.user_id) AS member
       FROM mentions mn
       JOIN messages m ON m.id = mn.message_id AND m.deleted_at IS NULL
       JOIN channels c ON c.id = m.channel_id
       JOIN users au ON au.id = m.author_id
      WHERE mn.user_id = $1 AND mn.handled_at IS NULL
        AND m.sent_at < $2::timestamptz - make_interval(secs => $3)
        AND NOT ${ANSWERED}
      ORDER BY m.sent_at, m.id`,
    [userId, at, config.mentionUnansweredSeconds],
  );
}

function digestMail(person: { name: string; email: string }, zone: string, period: Period, listed: Eligible[]) {
  const n = listed.length;
  const lines = listed.flatMap((mention) => {
    const head = `#${mention.channel} · ${mention.author} · ${formatWhen(zone, mention.sent_at)}`;
    if (mention.private) return [`${head} — private channel, open Rimewire to read it.`, ""];
    const quote = [...mention.text.replace(/\s+/g, " ")].slice(0, QUOTE_MAX).join("");
    return [head, `"${quote}"`, ""];
  });
  return {
    toName: person.name,
    toAddress: person.email,
    subject: `Rimewire: ${n} unanswered ${n === 1 ? "mention" : "mentions"} for ${formatBusinessDate(zone, period.dated)}`,
    text: [`Hello ${person.name},`, "", "These mentions are still waiting for your answer:", "", ...lines, `Open Rimewire: ${config.publicUrl}/`, ""].join("\n"),
  };
}

// One digest per person per period: the digests row is written before the mail goes out, so a
// second process blocks on it and then skips; a mail failure rolls it back for the retry.
async function digestFor(person: { id: string; name: string; email: string }, workspace: Workspace, period: Period): Promise<void> {
  await tx(async (client) => {
    const at = now();
    const claimed = await client.query("INSERT INTO digests (user_id, period, sent_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [person.id, period.key, at]);
    if (claimed.rowCount === 0) return;
    const mentions = await eligibleMentions(person.id, at);
    const listed = mentions.filter((m) => m.member);
    if (listed.length > 0) await sendMail(digestMail(person, workspace.time_zone, period, listed));
    else await client.query("DELETE FROM digests WHERE user_id = $1 AND period = $2", [person.id, period.key]);
    if (mentions.length > 0) {
      await client.query("UPDATE mentions SET handled_at = $2 WHERE id = ANY($1::uuid[])", [mentions.map((m) => m.id), at]);
    }
  });
}

const nextAttempt = new Map<string, number>();

async function runWorkspace(workspace: Workspace, period: Period): Promise<void> {
  const runKey = `${workspace.id}/${period.key}`;
  if ((nextAttempt.get(runKey) ?? 0) > Date.now()) return;
  const done = await rows(pool, "SELECT 1 FROM digest_runs WHERE workspace_id = $1 AND period = $2", [workspace.id, period.key]);
  if (done.length > 0) return;
  // Only people with an open mention can get a digest; the rest would claim and release a row.
  const people = await rows<{ id: string; name: string; email: string }>(
    pool,
    `SELECT u.id, u.name, u.email FROM users u
      WHERE u.workspace_id = $1 AND u.status = 'active'
        AND EXISTS (SELECT 1 FROM mentions mn WHERE mn.user_id = u.id AND mn.handled_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM digests d WHERE d.user_id = u.id AND d.period = $2)
      ORDER BY u.name`,
    [workspace.id, period.key],
  );
  // A few senders at once, so the digest lands at 07:00 however many people are waiting for one.
  let failed = false;
  const queue = [...people];
  await Promise.all(
    Array.from({ length: Math.min(DIGEST_SENDERS, queue.length) }, async () => {
      for (let person = queue.shift(); person && !failed; person = queue.shift()) {
        try {
          await digestFor(person, workspace, period);
        } catch {
          failed = true;
        }
      }
    }),
  );
  if (failed) {
    nextAttempt.set(runKey, Date.now() + RETRY_MS);
    return;
  }
  nextAttempt.delete(runKey);
  await pool.query("INSERT INTO digest_runs (workspace_id, period, completed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [workspace.id, period.key, now()]);
}

export async function runDueDigests(): Promise<void> {
  const at = now();
  const workspaces = await rows<Workspace>(pool, "SELECT id, time_zone FROM workspaces ORDER BY name");
  for (const workspace of workspaces) {
    const period = duePeriod(workspace, at);
    if (period) await runWorkspace(workspace, period);
  }
}
