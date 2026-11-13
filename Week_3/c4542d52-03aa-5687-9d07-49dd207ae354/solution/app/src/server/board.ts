import type { Person, QueueEntry, VestingType } from "../shared/types.js";
import { formatPrice } from "./decimal.js";
import { direct, only, query, transaction, type Queryable, type Tx } from "./db.js";
import { conflict, notFound, validation } from "./errors.js";
import { moveGrant } from "./grants.js";
import { now } from "./time.js";

type QueueRow = {
  id: string;
  holder_name: string;
  options: number;
  strike_units: string;
  vesting_type: VestingType;
  vesting_start: string;
  approvals: number;
  declines: number;
  my_vote: "approve" | "decline" | null;
};

const presentEntry = (row: QueueRow): QueueEntry => ({
  id: row.id,
  holder_name: row.holder_name,
  options: row.options,
  strike: formatPrice(BigInt(row.strike_units)),
  vesting_type: row.vesting_type,
  vesting_start: row.vesting_start,
  approvals: row.approvals,
  declines: row.declines,
  my_vote: row.my_vote,
});

/** A majority of the people whose role is board member: floor(n ÷ 2) + 1. */
export async function boardSize(db: Queryable): Promise<{ boardSize: number; quorum: number }> {
  const [row] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM people WHERE role = 'board_member'");
  const size = row?.n ?? 0;
  return { boardSize: size, quorum: Math.floor(size / 2) + 1 };
}

const QUEUE_SELECT = `SELECT g.id, p.name AS holder_name, g.options, g.strike_units::text AS strike_units, g.vesting_type, g.vesting_start,
    (SELECT count(*) FROM votes v WHERE v.grant_id = g.id AND v.vote = 'approve')::int AS approvals,
    (SELECT count(*) FROM votes v WHERE v.grant_id = g.id AND v.vote = 'decline')::int AS declines,
    (SELECT v.vote FROM votes v WHERE v.grant_id = g.id AND v.voter_id = $1) AS my_vote
  FROM grants g JOIN people p ON p.id = g.holder_id WHERE g.state = 'board_queue'`;

export async function loadQueue(person: Person): Promise<{ quorum: number; board_size: number; grants: QueueEntry[] }> {
  const [rows, size] = await Promise.all([query<QueueRow>(`${QUEUE_SELECT} ORDER BY g.id`, [person.id]), boardSize(direct)]);
  return { quorum: size.quorum, board_size: size.boardSize, grants: rows.map(presentEntry) };
}

export async function awaitingVote(person: Person): Promise<number> {
  const queue = await loadQueue(person);
  return queue.grants.filter((entry) => entry.my_vote === null).length;
}

export async function castVote(person: Person, grantId: string, vote: unknown): Promise<QueueEntry & { state: string }> {
  return transaction(async (tx) => {
    const [grant] = await tx.query<{ id: string; state: string }>("SELECT id, state FROM grants WHERE id = $1 FOR UPDATE", [grantId]);
    if (!grant) throw notFound();
    if (grant.state !== "board_queue") throw conflict("grant_not_in_queue", "This grant is no longer waiting for a vote.");
    const [mine] = await tx.query("SELECT 1 FROM votes WHERE grant_id = $1 AND voter_id = $2", [grantId, person.id]);
    if (mine) throw conflict("already_voted", `You have already voted on ${grantId}.`);
    if (vote !== "approve" && vote !== "decline") throw validation({ vote: "Vote approve or decline." });
    await tx.query("INSERT INTO votes (grant_id, voter_id, vote, voted_at) VALUES ($1, $2, $3, $4)", [grantId, person.id, vote, now()]);
    const [counts] = await tx.query<{ approvals: number; declines: number }>(
      `SELECT count(*) FILTER (WHERE vote = 'approve')::int AS approvals, count(*) FILTER (WHERE vote = 'decline')::int AS declines
         FROM votes WHERE grant_id = $1`,
      [grantId],
    );
    const { quorum } = await boardSize(tx);
    let state = "board_queue";
    if ((counts?.approvals ?? 0) >= quorum && (await moveGrant(tx, grantId, ["board_queue"], "approved"))) {
      state = "approved";
      await announceDecision(tx, grantId, "approved");
    } else if ((counts?.declines ?? 0) >= quorum) {
      await tx.query("DELETE FROM votes WHERE grant_id = $1", [grantId]);
      if (await moveGrant(tx, grantId, ["board_queue"], "draft")) {
        state = "draft";
        await announceDecision(tx, grantId, "returned");
      }
    }
    tx.emit({ to: null, type: "changed", data: { topics: ["board", "grants"] } });
    const row = only(await tx.query<QueueRow>(QUEUE_SELECT.replace("g.state = 'board_queue'", "g.id = $2"), [person.id, grantId]));
    return { ...presentEntry(row), state };
  });
}

async function announceDecision(tx: Tx, grantId: string, outcome: "approved" | "returned"): Promise<void> {
  const watchers = await tx.query<{ id: string }>("SELECT id FROM people WHERE role IN ('board_member', 'founder_admin')");
  for (const watcher of watchers) tx.emit({ to: watcher.id, type: "grant.decided", data: { grant_id: grantId, outcome } });
}
