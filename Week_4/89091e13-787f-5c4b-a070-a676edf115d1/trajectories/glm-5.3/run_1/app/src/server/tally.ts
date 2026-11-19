// The governance tally: quorum, veto and pass rules decided from exact fractions.

import { percentFromFraction } from "../shared/domain.js";
import type { Db } from "./db.js";

export interface TallyOutcome {
  status: "rejected-quorum" | "rejected-veto" | "passed" | "rejected";
  statusText: string;
  turnout: string;
  vetoShare: string;
  yesShare: string;
  votesUfern: bigint;
}

/** Final tally at the voting end instant, from the published rules. */
export async function computeTally(
  db: Db,
  workspaceId: string,
  number: number,
): Promise<TallyOutcome | null> {
  const proposal = await db.one<{ status: string; voting_ends_at: Date | null }>(
    `SELECT status, voting_ends_at FROM proposals WHERE workspace_id = $1 AND number = $2`,
    [workspaceId, number],
  );
  if (!proposal || proposal.status !== "voting") return null;
  const validators = await db.many<{ id: string; self_stake_ufern: bigint; stake_ufern: bigint }>(
    `SELECT v.id, v.self_stake_ufern::bigint AS self_stake_ufern,
            (v.self_stake_ufern + COALESCE((SELECT SUM(d.amount_ufern) FROM delegations d WHERE d.validator_id = v.id), 0))::bigint AS stake_ufern
     FROM validators v WHERE v.workspace_id = $1`,
    [workspaceId],
  );
  const validatorByOperator = new Map(validators.map((v) => [`validator-op-${v.id}`, v]));
  const delegations = await db.many<{ person_id: string; amount_ufern: bigint }>(
    `SELECT person_id, amount_ufern::bigint AS amount_ufern FROM delegations WHERE workspace_id = $1`,
    [workspaceId],
  );
  const bondedByPerson = new Map<string, bigint>();
  for (const validator of validators) {
    bondedByPerson.set(validator.id, validator.stake_ufern);
  }
  for (const delegation of delegations) {
    bondedByPerson.set(
      delegation.person_id,
      (bondedByPerson.get(delegation.person_id) ?? 0n) + delegation.amount_ufern,
    );
  }
  const totalBonded = validators.reduce((acc, v) => acc + v.stake_ufern, 0n);
  const votes = await db.many<{ person_id: string; option: string }>(
    `SELECT person_id, option FROM votes WHERE workspace_id = $1 AND number = $2`,
    [workspaceId, number],
  );
  const totals: Record<string, bigint> = { yes: 0n, no: 0n, no_with_veto: 0n, abstain: 0n };
  for (const vote of votes) {
    const validator = validatorByOperator.get(vote.person_id);
    const power = validator ? validator.self_stake_ufern : bondedByPerson.get(vote.person_id) ?? 0n;
    totals[vote.option] = (totals[vote.option] ?? 0n) + power;
  }
  const votesTotal = totals.yes! + totals.no! + totals.no_with_veto! + totals.abstain!;
  const quorumReached = votesTotal * 1000n > totalBonded * 334n;
  const vetoed = votesTotal > 0n && totals.no_with_veto! * 1000n > votesTotal * 334n;
  const nonAbstain = votesTotal - totals.abstain!;
  const yesPassed = nonAbstain > 0n && totals.yes! * 2n > nonAbstain;
  let status: TallyOutcome["status"];
  let statusText: string;
  if (!quorumReached) {
    status = "rejected-quorum";
    statusText = "Rejected — quorum not reached";
  } else if (vetoed) {
    status = "rejected-veto";
    statusText = "Rejected with veto";
  } else if (yesPassed) {
    status = "passed";
    statusText = "Passed";
  } else {
    status = "rejected";
    statusText = "Rejected";
  }
  return {
    status,
    statusText,
    turnout: percentFromFraction(votesTotal, totalBonded),
    vetoShare: percentFromFraction(totals.no_with_veto!, votesTotal),
    yesShare: percentFromFraction(totals.yes!, votesTotal),
    votesUfern: votesTotal,
  };
}
