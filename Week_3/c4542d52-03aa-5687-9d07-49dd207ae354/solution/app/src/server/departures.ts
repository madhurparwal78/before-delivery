import type { Person } from "../shared/types.js";
import { only, transaction, type Tx } from "./db.js";
import { conflict, notFound } from "./errors.js";
import { SELECT_GRANTS, moveGrant, vestingBasis, type GrantRow } from "./grants.js";
import { writeLedgerEntry } from "./ledger.js";
import { presentPerson, type PersonRow } from "./people.js";
import { leaverWarnings, leaverWindowEnd, windowHasEnded } from "./deadlines.js";
import { now, pacificDate } from "./time.js";
import { vestedOn } from "./vesting.js";

/** Records a departure: the person becomes a leaver, unvested options are forfeited and an exercise window opens. */
export async function recordDeparture(id: string): Promise<Person> {
  return transaction(async (tx) => {
    const [person] = await tx.query<PersonRow>("SELECT * FROM people WHERE id = $1 FOR UPDATE", [id]);
    if (!person) throw notFound();
    if (person.role !== "option_holder") throw conflict("not_an_option_holder", "Only an option holder can leave.");
    const terminatedAt = now();
    const terminationDate = pacificDate(terminatedAt);
    await tx.query(
      `UPDATE people SET role = 'leaver', terminated_at = $2, termination_date = $3, window_ends_at = $4, warnings_sent = 0 WHERE id = $1`,
      [id, terminatedAt, terminationDate, leaverWindowEnd(terminatedAt)],
    );
    const grants = await tx.query<GrantRow>(`${SELECT_GRANTS} WHERE g.holder_id = $1 FOR UPDATE OF g`, [id]);
    let forfeitedTotal = 0;
    const forfeitedGrants: string[] = [];
    for (const grant of grants) {
      if (await moveGrant(tx, grant.id, ["offered"], "expired")) {
        tx.emit({ to: id, type: "offer.expired", data: { grant_id: grant.id } });
      }
      const basis = grant.state === "accepted" ? vestingBasis(grant, terminationDate) : null;
      if (!basis || grant.options === null) continue;
      const forfeited = grant.options - vestedOn({ ...basis, terminationDate });
      await tx.query("UPDATE grants SET forfeited = $2 WHERE id = $1", [grant.id, forfeited]);
      if (forfeited > 0) {
        forfeitedTotal += forfeited;
        forfeitedGrants.push(grant.id);
      }
    }
    if (forfeitedTotal > 0) {
      await writeLedgerEntry(tx, {
        holderId: id,
        kind: "options_cancelled",
        shareClass: null,
        sharesDelta: 0,
        optionsDelta: -forfeitedTotal,
        reference: forfeitedGrants.join(", "),
      });
    }
    tx.emit({ to: id, type: "role.changed", data: { role: "leaver" } });
    tx.emit({ to: null, type: "changed", data: { topics: ["people", "grants", "registry"] } });
    return presentPerson(only(await tx.query<PersonRow>("SELECT * FROM people WHERE id = $1", [id])));
  });
}

/** Sends each leaver warning, once, when its time arrives on the server clock. */
export async function warnLeavers(tx: Tx): Promise<void> {
  const moment = now();
  const leavers = await tx.query<PersonRow>("SELECT * FROM people WHERE role = 'leaver' FOR UPDATE SKIP LOCKED");
  for (const leaver of leavers) {
    if (leaver.terminated_at === null || leaver.window_ends_at === null || windowHasEnded(leaver.window_ends_at, moment)) continue;
    const warnings = leaverWarnings(leaver.terminated_at, leaver.window_ends_at);
    const passed = warnings.filter((at) => at <= moment);
    const latest = passed.at(-1);
    if (latest === undefined || passed.length <= leaver.warnings_sent) continue;
    await tx.query("UPDATE people SET warnings_sent = $2 WHERE id = $1", [leaver.id, passed.length]);
    const grants = await tx.query<{ id: string }>("SELECT id FROM grants WHERE holder_id = $1 AND state = 'accepted'", [leaver.id]);
    for (const grant of grants) {
      tx.emit({
        to: leaver.id,
        type: "window.warning",
        data: { grant_id: grant.id, seconds: Math.trunc((leaver.window_ends_at.getTime() - latest.getTime()) / 1000) },
      });
    }
  }
}
