import { lateFee } from '../../domain/lateFee.js';
import { needsBilling, splitSettlement } from '../../domain/settlement.js';
import {
  canSettle,
  effectiveLoanStatus,
  LOAN_STATUS_WORDS,
  type StoredLoanStatus,
} from '../../domain/states.js';
import { FIELD_COPY } from '../../shared/errors.js';
import type { AppContext } from '../core/context.js';
import { readLedger, writeLedgerEntry } from '../core/ledger.js';
import { queueMessage, receiptMessage } from '../core/mailer.js';
import { presentLoan, presentSettlement } from '../core/present.js';
import { findLoan, type SettlementRecord } from '../core/records.js';
import { inTransaction } from '../db/pool.js';
import type { Client } from '../db/pool.js';
import {
  BillingUnavailable,
  depositPaymentKey,
  depositReleaseTransactionKey,
  extraDamageKey,
  lateFeeKey,
} from '../services/billing.js';
import {
  fail,
  failBillingSettlement,
  failSettlementMismatch,
  failTransition,
  failValidation,
} from '../http/apiError.js';
import type { HandlerResult } from '../http/context.js';
import { sessionRoute, type Route } from '../http/routes.js';
import { readInteger, resolveLoan } from './shared.js';

export function settlementRoutes(app: AppContext): Route[] {
  return [
    sessionRoute({
      method: 'POST',
      pattern: '/api/loans/:loanId/settlement',
      body: 'json',
      keyed: true,
      roles: ['founder'],
      resolve: (context) => resolveLoan(app, context),
      handle: async (context, resolved): Promise<HandlerResult> => {
        const damageCents = readInteger(context.json, 'damage_cents');
        if (resolved.inspection?.outcome === 'ok' && damageCents !== null && damageCents !== 0) {
          throw failValidation({ damage_cents: FIELD_COPY.damage_ok });
        }
        if (damageCents === null || damageCents < 0 || damageCents > resolved.replacementCents) {
          throw failValidation({ damage_cents: FIELD_COPY.damage_range });
        }

        try {
          const settled = await inTransaction(app.pool, async (client) => {
            const locked = await client.query<{ status: string; due_at: Date }>(
              `select status, due_at from loan where id = $1 for no key update`,
              [resolved.id],
            );
            const row = locked.rows[0];
            if (row === undefined) throw fail('not_found');
            const status = effectiveLoanStatus(
              row.status as StoredLoanStatus,
              row.due_at,
              context.now,
            );
            if (!canSettle(status)) throw failTransition('loan', LOAN_STATUS_WORDS[status]);

            const loan = await findLoan(client, resolved.id);
            if (loan === null || loan.returnedAt === null) throw fail('not_found');

            await fixDamageCharge(app, loan.id, damageCents);

            const fee = lateFee(
              app.library.calendar,
              app.library.lateFeeSchedule,
              loan.dueDate,
              loan.returnedAt,
              loan.replacementCents,
            );
            const split = splitSettlement(loan.depositCents, damageCents, fee.lateFeeCents);

            if (needsBilling(split)) {
              const accountId = await app.billing.ensureAccount({
                memberId: loan.memberId,
                name: loan.memberName,
                email: await memberEmail(client, loan.memberId),
              });
              if (split.releasedCents > 0) {
                await app.billing.recordRefund(
                  depositPaymentKey(loan.id),
                  depositReleaseTransactionKey(loan.id),
                  split.releasedCents,
                );
              }
              if (split.extraDamageCents > 0) {
                await app.billing.recordPurchase(
                  accountId,
                  extraDamageKey(loan.id),
                  extraDamageKey(loan.id),
                  split.extraDamageCents,
                );
              }
              if (split.lateFeeCents > 0) {
                await app.billing.recordPurchase(
                  accountId,
                  lateFeeKey(loan.id),
                  lateFeeKey(loan.id),
                  split.lateFeeCents,
                );
              }
            }

            const record: SettlementRecord = {
              depositCents: split.depositCents,
              releasedCents: split.releasedCents,
              damageCents: split.damageCents,
              damageFromDepositCents: split.damageFromDepositCents,
              extraDamageCents: split.extraDamageCents,
              lateDays: fee.lateDays,
              lateFeeCents: split.lateFeeCents,
              totalChargedCents: split.totalChargedCents,
              settledAt: context.now,
            };

            await client.query(
              `insert into settlement (loan_id, deposit_cents, released_cents, damage_cents,
                 damage_from_deposit_cents, extra_damage_cents, late_days, late_fee_cents,
                 total_charged_cents, settled_at)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                loan.id,
                record.depositCents,
                record.releasedCents,
                record.damageCents,
                record.damageFromDepositCents,
                record.extraDamageCents,
                record.lateDays,
                record.lateFeeCents,
                record.totalChargedCents,
                record.settledAt,
              ],
            );

            if (record.releasedCents > 0) {
              await writeLedgerEntry(client, {
                loanId: loan.id,
                itemId: loan.itemId,
                kind: 'deposit_release',
                amountCents: -record.releasedCents,
              });
            }
            if (record.damageFromDepositCents > 0) {
              await writeLedgerEntry(client, {
                loanId: loan.id,
                itemId: loan.itemId,
                kind: 'damage_charge',
                amountCents: -record.damageFromDepositCents,
              });
            }
            if (record.extraDamageCents > 0) {
              await writeLedgerEntry(client, {
                loanId: loan.id,
                itemId: loan.itemId,
                kind: 'extra_damage',
                amountCents: record.extraDamageCents,
              });
            }
            if (record.lateFeeCents > 0) {
              await writeLedgerEntry(client, {
                loanId: loan.id,
                itemId: loan.itemId,
                kind: 'late_fee',
                amountCents: record.lateFeeCents,
              });
            }

            await client.query(`update loan set status = 'settled', settled_at = $2 where id = $1`, [
              loan.id,
              record.settledAt,
            ]);

            await queueMessage(
              client,
              receiptMessage({
                loanId: loan.id,
                itemName: loan.itemName,
                unitLabel: loan.unit.label,
                memberEmail: await memberEmail(client, loan.memberId),
                settlement: record,
              }),
            );

            const updated = await findLoan(client, loan.id);
            if (updated === null) throw fail('not_found');
            return { loan: updated, settlement: record };
          });

          return {
            kind: 'json',
            status: 201,
            value: {
              settlement: presentSettlement(settled.loan.id, settled.settlement),
              loan: presentLoan(settled.loan, context.now),
            },
          };
        } catch (error) {
          if (error instanceof BillingUnavailable) {
            app.probes.noteBillingDown();
            throw failBillingSettlement();
          }
          throw error;
        }
      },
    }),

    sessionRoute({
      method: 'GET',
      pattern: '/api/ledger',
      roles: ['founder'],
      handle: async (context): Promise<HandlerResult> => {
        const loanId = context.query.get('loan_id');
        const view = await readLedger(app.pool, loanId);
        return {
          kind: 'json',
          status: 200,
          value: {
            entries: view.entries.map((entry) => ({
              id: entry.id,
              loan_id: entry.loanId,
              item: { id: entry.itemId, name: entry.itemName },
              kind: entry.kind,
              amount_cents: entry.amountCents,
              created_at: entry.createdAt.toISOString(),
            })),
            deposits_held_cents: view.depositsHeldCents,
          },
        };
      },
    }),
  ];
}

/**
 * The damage charge is fixed on its own connection, so it survives the rollback of
 * an attempt that billing then refuses.
 */
async function fixDamageCharge(app: AppContext, loanId: string, damageCents: number): Promise<void> {
  const result = await app.pool.query<{ damage_cents: number }>(
    `insert into settlement_fix (loan_id, damage_cents) values ($1, $2)
     on conflict (loan_id) do update set damage_cents = settlement_fix.damage_cents
     returning damage_cents`,
    [loanId, damageCents],
  );
  const fixed = result.rows[0]?.damage_cents ?? damageCents;
  if (fixed !== damageCents) throw failSettlementMismatch(fixed);
}

async function memberEmail(client: Client, memberId: string): Promise<string> {
  const result = await client.query<{ email: string }>(`select email from person where id = $1`, [
    memberId,
  ]);
  return result.rows[0]?.email ?? '';
}
