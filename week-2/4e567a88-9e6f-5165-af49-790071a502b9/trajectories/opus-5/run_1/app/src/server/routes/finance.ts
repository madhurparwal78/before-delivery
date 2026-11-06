import { db } from '../db';
import { advanceTopup } from '../domain/billing';
import { meterJson } from '../domain/meter';
import { fail } from '../errors';
import { Router, accepted, created, csv, ok } from '../http/router';
import { balancesOf, movementsOf } from '../store/ledger';
import { allTeams } from '../store/people';
import { TopupRecord, insertTopup, newTopupId, topupsOfTeam } from '../store/topups';
import { JsonObject, JsonValue } from '../types';
import { csvRow, policyNow, requireRole, resolveTeam } from './support';

function topupJson(topup: TopupRecord): JsonObject {
  return {
    id: topup.id,
    team_id: topup.teamId,
    credits: Number(topup.credits),
    amount_usd: topup.amountUsd,
    status: topup.status,
    pending_reason: topup.pendingReason,
    failure_reason: topup.failureReason,
    kb_account_id: topup.kbAccountId,
    kb_invoice_id: topup.kbInvoiceId,
    kb_payment_id: topup.kbPaymentId,
    created_by: topup.createdBy,
    created_at: topup.createdAt.toISOString(),
    paid_at: topup.paidAt === null ? null : topup.paidAt.toISOString(),
  };
}

export function registerFinanceRoutes(router: Router): void {
  router.add('GET', '/api/teams/:id/meter', 'none', async (ctx) => {
    const teamId = ctx.params['id']!;
    const teams = await allTeams();
    if (!teams.some((team) => team.id === teamId)) throw fail.notFound();
    if (ctx.caller.member.role === 'member' && ctx.caller.member.teamId !== teamId) throw fail.notFound();
    const policy = await policyNow();
    return ok(await meterJson(teamId, policy, new Date()));
  });

  router.add('GET', '/api/teams/:id/ledger', 'none', async (ctx) => {
    requireRole(ctx.caller, ['finance', 'admin']);
    const teamId = ctx.params['id']!;
    const teams = await allTeams();
    if (!teams.some((team) => team.id === teamId)) throw fail.notFound();
    const balances = await balancesOf(db, teamId);
    const movements = await movementsOf(teamId);
    return ok({
      balances: {
        granted_micro: Number(balances.grantedMicro),
        available_micro: Number(balances.availableMicro),
        reserved_micro: Number(balances.reservedMicro),
        settled_micro: Number(balances.settledMicro),
      },
      movements: movements as unknown as JsonValue,
    });
  });

  router.add('GET', '/api/teams/:id/ledger.csv', 'none', async (ctx) => {
    requireRole(ctx.caller, ['finance', 'admin']);
    const teamId = ctx.params['id']!;
    const teams = await allTeams();
    if (!teams.some((team) => team.id === teamId)) throw fail.notFound();
    const movements = await movementsOf(teamId);
    const header = csvRow([
      'movement_id',
      'kind',
      'created_at',
      'job_id',
      'topup_id',
      'kb_invoice_id',
      'account',
      'amount_micro',
    ]);
    const rows = movements.flatMap((movement) =>
      movement.entries.map((entry) =>
        csvRow([
          movement.id,
          movement.kind,
          movement.created_at,
          movement.job_id ?? '',
          movement.topup_id ?? '',
          movement.kb_invoice_id ?? '',
          entry.account,
          String(entry.amount_micro),
        ]),
      ),
    );
    return csv([header, ...rows].join('\n') + '\n', `ledger-${teamId}.csv`);
  });

  router.add('POST', '/api/topups', 'json', async (ctx) => {
    requireRole(ctx.caller, ['finance']);
    const teams = await allTeams();
    const teamId = ctx.body['team_id'];
    const credits = ctx.body['credits'];
    const errors: Record<string, string> = {};
    const team = typeof teamId === 'string' ? teams.find((candidate) => candidate.id === teamId) : undefined;
    if (!team) errors['team_id'] = 'Choose a team.';
    if (
      typeof credits !== 'number' ||
      !Number.isInteger(credits) ||
      credits < 100 ||
      credits > 100000 ||
      credits % 100 !== 0
    ) {
      errors['credits'] = 'Enter a whole number of credits from 100 to 100000 in multiples of 100.';
    }
    if (Object.keys(errors).length > 0) throw fail.validation(errors);

    const amountUsd = (Number(credits) / 100).toFixed(2);
    const stored = await insertTopup({
      id: newTopupId(),
      teamId: team!.id,
      credits: BigInt(credits as number),
      amountUsd,
      createdBy: ctx.caller.member.id,
    });
    const outcome = await advanceTopup(stored);
    if (outcome.kind === 'paid') return created({ topup: topupJson(outcome.topup) });
    if (outcome.kind === 'pending') return accepted({ topup: topupJson(outcome.topup) });
    throw fail.billingRejected();
  });

  router.add('GET', '/api/topups', 'none', async (ctx) => {
    requireRole(ctx.caller, ['finance', 'admin']);
    const team = await resolveTeam(ctx, { required: false });
    const topups = await topupsOfTeam(team.id);
    return ok({ topups: topups.map(topupJson) as unknown as JsonValue });
  });
}
