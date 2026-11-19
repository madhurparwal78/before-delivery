import type { Tx } from "./db.js";
import { record, type Actor } from "./audit.js";
import { newId } from "./crypto.js";
import type { CredentialRow, RotationRow, TurnRow, VaultRow } from "./model.js";
import { addDays, businessDaysAfter, officeDate, officeMidnight } from "./office-time.js";
import { runsBetween } from "./rotations.js";

export interface TurnDue {
  credential_id: string;
  label: string;
  due_by: string;
}

/** A person lost a vault scope: every login in it is due to turn two office business days later. */
export async function createScopeLossTurns(tx: Tx, vault: VaultRow, actor: Actor, at: Date): Promise<TurnDue[]> {
  const dueBy = businessDaysAfter(officeDate(at), 2);
  const logins = await tx.query<CredentialRow>("SELECT * FROM credentials WHERE vault_id = $1 ORDER BY ord", [vault.id]);
  const created: TurnDue[] = [];
  for (const login of logins) {
    await tx.query(
      "INSERT INTO turns (id, credential_id, kind, due_by, state, created_at) VALUES ($1,$2,'scope_loss',$3,'due',$4)",
      [newId(), login.id, dueBy, at],
    );
    await record(
      tx,
      actor,
      "turn_due",
      { kind: "login", id: login.id, name: login.label },
      actor === "system" ? { due_by: dueBy } : { due_by: dueBy, confirmed_by: actor.name },
      at,
    );
    created.push({ credential_id: login.id, label: login.label, due_by: dueBy });
  }
  return created;
}

/** Every due and overdue turn of the login moves to turned, one `turn_done` each. */
export async function completeTurns(tx: Tx, login: CredentialRow, actor: Actor): Promise<void> {
  const open = await tx.query<TurnRow>("SELECT * FROM turns WHERE credential_id = $1 AND state <> 'turned' ORDER BY ord", [login.id]);
  for (const turn of open) {
    await tx.query("UPDATE turns SET state = 'turned' WHERE id = $1", [turn.id]);
    await record(tx, actor, "turn_done", { kind: "login", id: login.id, name: login.label }, { turn_id: turn.id });
  }
}

/** Scheduled runs whose instant has passed become due turns, exactly once each (unique per rotation and instant). */
export async function dueRuns(tx: Tx, at: Date): Promise<number> {
  const rotations = await tx.query<RotationRow & { label: string }>(
    "SELECT r.*, c.label FROM rotations r JOIN credentials c ON c.id = r.credential_id",
  );
  let created = 0;
  for (const rotation of rotations) {
    for (const run of runsBetween(rotation, rotation.since, at)) {
      const turn = await tx.one<{ id: string }>(
        `INSERT INTO turns (id, credential_id, kind, rotation_id, run_at, run_date, shifted, due_by, state, created_at)
         VALUES ($1,$2,'scheduled',$3,$4,$5,$6,$7,'due',$8) ON CONFLICT (rotation_id, run_at) DO NOTHING RETURNING id`,
        [newId(), rotation.credential_id, rotation.id, run.at, run.office_date, run.shifted, businessDaysAfter(run.office_date, 2), run.at],
      );
      if (!turn) continue;
      created++;
      await record(
        tx,
        "system",
        "rotation_due",
        { kind: "login", id: rotation.credential_id, name: rotation.label },
        { turn_id: turn.id, run_on: run.office_date },
        run.at,
      );
    }
  }
  return created;
}

/** A due turn becomes overdue at the office midnight after its due-by date. */
export async function overdueTurns(tx: Tx, at: Date): Promise<number> {
  const today = officeDate(at);
  const late = await tx.query<TurnRow & { label: string }>(
    `SELECT t.*, c.label FROM turns t JOIN credentials c ON c.id = t.credential_id
     WHERE t.state = 'due' AND t.due_by < $1 ORDER BY t.due_by, t.ord`,
    [today],
  );
  for (const turn of late) {
    await tx.query("UPDATE turns SET state = 'overdue' WHERE id = $1", [turn.id]);
    await record(
      tx,
      "system",
      "rotation_overdue",
      { kind: "login", id: turn.credential_id, name: turn.label },
      { turn_id: turn.id, due_by: turn.due_by },
      officeMidnight(addDays(turn.due_by, 1)),
    );
  }
  return late.length;
}
