import { Hono } from "hono";
import { clockNow } from "../clock.ts";
import { pool } from "../db.ts";
import { notFound, refusalToError } from "../errors.ts";
import { STAKING_GAS, stakingFee } from "../fee.ts";
import {
  heldAmount, parseDepositBody, parseProposalBody, parseVoteBody, proposalOf, proposalView, proposalsOf, refuseGovernance, type GovernanceRequest,
} from "../governance.ts";
import { availableOf } from "../ledger.ts";
import { parseStakeBody, refuseStake, type StakeKind } from "../staking.ts";
import { ledgerEntries, stakingMe, validatorViews } from "../views.ts";
import { insertTransaction } from "../transactions.ts";
import { createTransaction, read, requireWriter, write, type Scope } from "./context.ts";
import type { Refusal } from "../errors.ts";

export const economyRoutes = new Hono();

economyRoutes.get("/w/:id/validators", read(async (c, scope) => c.json(await validatorViews(pool, scope.workspaceId))));

economyRoutes.get("/w/:id/staking/me", read(async (c, scope) => c.json(await stakingMe(pool, scope.workspaceId, scope.user.id))));

economyRoutes.get("/w/:id/staking/fee", read(async (c) => c.json({ gas: STAKING_GAS, feeUfern: stakingFee() })));

for (const kind of ["delegate", "undelegate", "redelegate", "claim"] as const satisfies readonly StakeKind[]) {
  economyRoutes.post(
    `/w/:id/staking/${kind}`,
    write((c, scope, body) =>
      createTransaction(c, scope, body, async (db) => {
        requireWriter(scope);
        const request = await parseStakeBody(db, scope.workspaceId, kind, body);
        if ("message" in request) throw refusalToError(request);
        const refusal = await refuseStake(db, scope.workspaceId, scope.user.id, request, clockNow(), await availableOf(db, scope.workspaceId, scope.user.id));
        if (refusal) throw refusalToError(refusal);
        return insertTransaction(db, scope.workspaceId, scope.user.id, {
          kind, feeUfern: stakingFee(), gas: STAKING_GAS, heldUfern: kind === "delegate" ? request.amount : 0, params: request,
        });
      }),
    ),
  );
}

async function requireProposal(scope: Scope, raw: string) {
  const proposal = /^\d{1,9}$/.test(raw) ? await proposalOf(pool, scope.workspaceId, Number(raw)) : undefined;
  if (!proposal) throw notFound();
  return proposal;
}

economyRoutes.get(
  "/w/:id/proposals",
  read(async (c, scope) => c.json(await Promise.all((await proposalsOf(pool, scope.workspaceId)).map((row) => proposalView(pool, scope.workspaceId, row, scope.user.id))))),
);

economyRoutes.get(
  "/w/:id/proposals/:number",
  read(async (c, scope) => c.json(await proposalView(pool, scope.workspaceId, await requireProposal(scope, c.req.param("number") ?? ""), scope.user.id))),
);

/** Parse (422), check the balance (422) and the period (409), then record the transaction with its held amount. */
function governanceWrite(parse: (number: number, body: Record<string, unknown>) => GovernanceRequest | Refusal, needsProposal: boolean) {
  return write(async (c, scope, body) => {
    const number = needsProposal ? (await requireProposal(scope, c.req.param("number") ?? "")).number : 0;
    return createTransaction(c, scope, body, async (db) => {
      requireWriter(scope);
      const request = parse(number, body);
      if ("message" in request) throw refusalToError(request);
      const refusal = await refuseGovernance(db, scope.workspaceId, request, clockNow(), await availableOf(db, scope.workspaceId, scope.user.id));
      if (refusal) throw refusalToError(refusal);
      return insertTransaction(db, scope.workspaceId, scope.user.id, { kind: request.kind, feeUfern: stakingFee(), gas: STAKING_GAS, heldUfern: heldAmount(request), params: request });
    });
  });
}

economyRoutes.post("/w/:id/proposals", governanceWrite((_, body) => parseProposalBody(body), false));
economyRoutes.post("/w/:id/proposals/:number/deposits", governanceWrite(parseDepositBody, true));
economyRoutes.post("/w/:id/proposals/:number/votes", governanceWrite(parseVoteBody, true));

economyRoutes.get(
  "/w/:id/ledger",
  read(async (c, scope) => {
    const account = c.req.query("account")?.replaceAll("\0", "") ?? null;
    const entries = await ledgerEntries(pool, scope.workspaceId, account);
    return c.json({ account, balanceUfern: entries.reduce((sum, entry) => sum + entry.amountUfern, 0), entries });
  }),
);
