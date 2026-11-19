import { config } from "./config.js";
import { sql, type Db, type Tx } from "./db.js";
import { BillingUnavailable, ensureSeat } from "./killbill.js";
import { MailUnavailable, sendMail, type Letter } from "./mail.js";
import { hashToken, newToken } from "./auth.js";
import { dayLabel, wallOf } from "../shared/time.js";
import { settleEndedTrials } from "./subscription.js";

// Every Kill Bill or mail effect is a row here, written in the same transaction as its cause, and
// performed exactly once by whichever app copy claims it first (FOR UPDATE SKIP LOCKED).

type Payloads = {
  "killbill.register_workspace": { workspaceId: string };
  "killbill.add_seat": { workspaceId: string; memberId: string; origin: string };
  mail: Letter;
};
type Kind = keyof Payloads;
type Job = { [K in Kind]: { id: string; workspace_id: string; kind: K; payload: Payloads[K] } }[Kind];

/** A failed item is due again for any app copy after this long. */
const RETRY_SECONDS = 2;
/** The copy that just failed to reach a service leaves that service's items to other copies this long (< 10 s). */
const OWN_BACKOFF_MS = 8_000;
/** A request that queues work tries it itself first; the drain loop waits this long before helping. */
const INLINE_GRACE_SECONDS = 10;

export async function enqueue<K extends Kind>(
  tx: Db,
  workspaceId: string,
  kind: K,
  payload: Payloads[K],
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    INSERT INTO outbox (workspace_id, kind, payload, next_attempt_at)
    VALUES (${workspaceId}, ${kind}, ${tx.json(payload)}, now() + make_interval(secs => ${INLINE_GRACE_SECONDS}))
    RETURNING id`;
  return row.id;
}

/** Queues a letter at most once per dedupe key, whichever app copy gets there first. */
async function enqueueOnce(workspaceId: string, letter: Letter, dedupeKey: string): Promise<void> {
  await sql`
    INSERT INTO outbox (workspace_id, kind, payload, dedupe_key)
    VALUES (${workspaceId}, 'mail', ${sql.json(letter)}, ${dedupeKey})
    ON CONFLICT (dedupe_key) DO NOTHING`;
}

function inviteLetter(to: string, ownerName: string, workspaceName: string, origin: string, token: string): Letter {
  return {
    to,
    subject: `${ownerName} invited you to ${workspaceName} on Tidemark Daybook`,
    text: [
      `${ownerName} invited you to plan your days in ${workspaceName} on Tidemark Daybook.`,
      "",
      `Join here: ${origin}/join/${token}`,
      "",
      "Set your name, password and time zone, and your Daybook is ready.",
    ].join("\n"),
  };
}

async function accountOf(tx: Tx, workspaceId: string) {
  const [row] = await tx<{ name: string; email: string }[]>`
    SELECT w.name, m.email FROM workspaces w JOIN members m ON m.workspace_id = w.id AND m.role = 'owner'
    WHERE w.id = ${workspaceId}`;
  return { workspaceId, name: row.name, email: row.email };
}

async function perform(tx: Tx, job: Job): Promise<string | null> {
  switch (job.kind) {
    case "killbill.register_workspace": {
      const account = await accountOf(tx, job.workspace_id);
      const holders = await tx<{ id: string }[]>`
        SELECT id FROM members
        WHERE workspace_id = ${job.workspace_id} AND removed_at IS NULL AND status IN ('active', 'invited')
        ORDER BY created_at`;
      for (const holder of holders) await ensureSeat(account, holder.id);
      return null;
    }
    case "killbill.add_seat": {
      const [member] = await tx<{ email: string }[]>`
        SELECT email FROM members WHERE id = ${job.payload.memberId} AND status = 'pending_billing' AND removed_at IS NULL
        FOR UPDATE`;
      if (!member) return null;
      await ensureSeat(await accountOf(tx, job.workspace_id), job.payload.memberId);
      const token = newToken();
      await tx`UPDATE members SET status = 'invited', invite_token_hash = ${hashToken(token)} WHERE id = ${job.payload.memberId}`;
      const [owner] = await tx<{ owner: string; workspace: string }[]>`
        SELECT m.name AS owner, w.name AS workspace FROM workspaces w
        JOIN members m ON m.workspace_id = w.id AND m.role = 'owner' WHERE w.id = ${job.workspace_id}`;
      return enqueue(tx, job.workspace_id, "mail", inviteLetter(member.email, owner.owner, owner.workspace, job.payload.origin, token));
    }
    case "mail": {
      await sendMail(job.payload, `<outbox-${job.id}@tidemark.test>`);
      return null;
    }
  }
}

type Attempt = { done: boolean; followUp: string | null };

const unreachableUntil: Record<"billing" | "mail", number> = { billing: 0, mail: 0 };

/**
 * Claims and performs one queued item: the given one, or the oldest due one. Returns null when there
 * was nothing to claim (another copy holds it, or it is already done).
 */
async function attempt(id: string | null): Promise<Attempt | null> {
  return sql.begin(async (tx) => {
    const skip: Kind[] = [];
    if (id === null && unreachableUntil.billing > Date.now()) skip.push("killbill.register_workspace", "killbill.add_seat");
    if (id === null && unreachableUntil.mail > Date.now()) skip.push("mail");
    const [job] = id
      ? await tx<Job[]>`SELECT id, workspace_id, kind, payload FROM outbox WHERE id = ${id} AND status = 'pending' FOR UPDATE SKIP LOCKED`
      : await tx<Job[]>`
          SELECT id, workspace_id, kind, payload FROM outbox
          WHERE status = 'pending' AND next_attempt_at <= now() ${skip.length ? tx`AND kind <> ALL(${skip})` : tx``}
          ORDER BY next_attempt_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!job) return null;
    try {
      const followUp = await perform(tx, job);
      await tx`UPDATE outbox SET status = 'done', done_at = now(), attempts = attempts + 1 WHERE id = ${job.id}`;
      return { done: true, followUp };
    } catch (error) {
      if (!(error instanceof BillingUnavailable || error instanceof MailUnavailable)) throw error;
      unreachableUntil[error instanceof MailUnavailable ? "mail" : "billing"] = Date.now() + OWN_BACKOFF_MS;
      await tx`UPDATE outbox SET attempts = attempts + 1, next_attempt_at = now() + make_interval(secs => ${RETRY_SECONDS})
               WHERE id = ${job.id}`;
      return { done: false, followUp: null };
    }
  });
}

/** Tries a just-queued item (and the item it leads to) before answering the request. */
export async function attemptNow(id: string): Promise<{ done: boolean; followUp: Attempt | null }> {
  const first = await attempt(id);
  if (!first?.done) return { done: false, followUp: null };
  return { done: true, followUp: first.followUp ? await attempt(first.followUp) : null };
}

async function queueTrialNotices(): Promise<void> {
  const due = await sql<{ id: string; name: string; trial_ends_at: Date; email: string; time_zone: string }[]>`
    SELECT w.id, w.name, w.trial_ends_at, m.email, m.time_zone
    FROM workspaces w JOIN members m ON m.workspace_id = w.id AND m.role = 'owner'
    WHERE w.state = 'trialing' AND w.trial_ends_at > now()
      AND w.trial_ends_at - make_interval(secs => ${config.trialNoticeLeadSeconds}) <= now()
      AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.dedupe_key = 'trial-notice:' || w.id::text)`;
  for (const w of due) {
    const end = wallOf(w.trial_ends_at.getTime(), w.time_zone);
    await enqueueOnce(
      w.id,
      {
        to: w.email,
        subject: "Your Tidemark Daybook trial ends soon",
        text: [
          `Your trial for ${w.name} ends on ${dayLabel(end.date)} at ${end.time} (${w.time_zone}).`,
          "",
          "After that the workspace becomes read-only until the subscription is active. Your plans stay readable.",
        ].join("\n"),
      },
      `trial-notice:${w.id}`,
    );
  }
}

/** The background loop every app copy runs: trial clock, trial notices and the queue drain. */
export function startWorker(): void {
  const tick = async () => {
    try {
      await settleEndedTrials(Date.now());
      await queueTrialNotices();
      for (let i = 0; i < 50; i++) {
        const outcome = await attempt(null);
        if (!outcome) break;
        if (outcome.followUp) await attempt(outcome.followUp);
      }
    } catch (error) {
      console.error("Background work failed:", error instanceof Error && "code" in error ? String(error.code) : error instanceof Error ? error.name : "unknown");
    }
  };
  const schedule = () => setTimeout(() => void tick().finally(schedule), 1_500 + Math.random() * 1_000).unref();
  void tick().finally(schedule);
}
