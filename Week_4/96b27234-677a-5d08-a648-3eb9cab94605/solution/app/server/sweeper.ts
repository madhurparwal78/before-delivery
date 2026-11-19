import { query } from "./db.js";
import { sendDueReminders } from "./gatherings.js";
import { clearPresenceIfIdle, leaveSession, openSessionIdsOf } from "./membership.js";
import { sendDueMail } from "./mail.js";
import { friendsHint } from "./notify.js";
import { live, run, socketsKey } from "./valkey.js";
import { closeDueVotes } from "./votes.js";

/** People whose last socket closed and whose grace is over leave their sessions and read as offline. */
async function completeDrops(worldId?: string): Promise<void> {
  try {
    live();
  } catch {
    return;
  }
  const due = await query<{ person_id: string }>(
    `DELETE FROM drops d USING people p WHERE p.id = d.person_id AND d.due_at <= world_now(p.world_id) AND ($1::text IS NULL OR p.world_id = $1)
     RETURNING d.person_id`,
    [worldId ?? null],
  );
  for (const { person_id: personId } of due) {
    try {
      if ((await run((client) => client.hlen(socketsKey(personId)))) > 0) continue;
      for (const sessionId of await openSessionIdsOf(personId)) await leaveSession(sessionId, personId);
      await clearPresenceIfIdle(personId);
      await friendsHint(personId);
    } catch {
      await query("INSERT INTO drops (person_id, due_at) SELECT p.id, world_now(p.world_id) FROM people p WHERE p.id = $1 ON CONFLICT DO NOTHING", [personId]);
    }
  }
}

/** Everything that has come due in a world (or all worlds): votes, dropped sockets. */
export async function runDueWork(worldId?: string): Promise<void> {
  await closeDueVotes(worldId);
  await completeDrops(worldId);
}

function every(milliseconds: number, work: () => Promise<unknown>): void {
  const tick = (): void => {
    work()
      .catch(() => undefined)
      .finally(() => setTimeout(tick, milliseconds));
  };
  setTimeout(tick, milliseconds);
}

export function startSweeper(): void {
  every(1000, async () => {
    await runDueWork();
    await sendDueReminders();
  });
  every(500, async () => {
    while (await sendDueMail()) continue;
  });
}

