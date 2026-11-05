import type { OwedAccount, OwedSummary, StudioSummary } from '../../shared/types';
import { formatMoney } from '../../shared/labels';
import { signedInUser, type Route } from '../http/router';
import * as errors from '../http/errors';
import { query, queryOne, withTransaction } from '../db/pool';
import { listKilns } from '../repo/catalog';
import { addHistory } from '../repo/pieces';
import { findDamageRow, listDamageReports, openDamageCount, settleDamageReport, toDamageReport } from '../repo/damage';
import { fillOf, openFiringFor, placementsOf } from '../repo/firings';
import { findUserById, findUserByMemberNumber, listMembers } from '../repo/users';
import { accountBalanceCents, payFullBalance, postExternalCharge } from '../services/killbill';
import { memberAccountId } from '../services/accounts';

const MIN_SHELF_CHARGE_CENTS = 100;
const MAX_SHELF_CHARGE_CENTS = 20_000;

async function readyCount(): Promise<number> {
  const row = await queryOne<{ count: string }>(
    "select count(*)::text as count from pieces where status = 'ready'",
  );
  return Number(row?.count ?? '0');
}

export const studioRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/studio/summary',
    roles: ['owner'],
    handler: async () => {
      const kilns = await listKilns();
      const rows: StudioSummary['kilns'] = [];
      for (const kiln of kilns) {
        const firing = await openFiringFor(kiln.id);
        rows.push({
          kiln_id: kiln.id,
          firing_id: firing?.id ?? null,
          fill_percent: firing ? fillOf(await placementsOf(firing.id), kiln) : 0,
        });
      }
      const body: StudioSummary = {
        awaiting_pickup: await readyCount(),
        open_damage_reports: await openDamageCount(),
        kilns: rows,
      };
      return { status: 200, body };
    },
  },
  {
    method: 'GET',
    path: '/api/studio/owed',
    roles: ['owner'],
    handler: async () => {
      const accounts: OwedAccount[] = [];
      for (const member of await listMembers()) {
        const accountId = await memberAccountId(member);
        accounts.push({
          kind: 'member',
          member_number: member.member_number,
          piece_number: null,
          name: member.name,
          owed_cents: await accountBalanceCents(accountId),
        });
      }
      const guests = await query<{ number: string; guest_name: string; kb_account_id: string }>(
        `select number, guest_name, kb_account_id from pieces
         where owner_kind = 'guest' and kb_account_id is not null order by number`,
      );
      for (const guest of guests) {
        const owed = await accountBalanceCents(guest.kb_account_id);
        if (owed > 0) {
          accounts.push({
            kind: 'guest',
            member_number: null,
            piece_number: guest.number,
            name: guest.guest_name,
            owed_cents: owed,
          });
        }
      }
      const body: OwedSummary = {
        accounts,
        total_owed_cents: accounts.reduce((sum, account) => sum + account.owed_cents, 0),
      };
      return { status: 200, body };
    },
  },
  {
    method: 'GET',
    path: '/api/me/balance',
    roles: ['member'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const accountId = await memberAccountId(user);
      return { status: 200, body: { owed_cents: await accountBalanceCents(accountId) } };
    },
  },
  {
    method: 'POST',
    path: '/api/members/:member_number/payments',
    roles: ['owner'],
    idempotent: true,
    handler: async (ctx) => {
      const member = await findUserByMemberNumber(ctx.params.member_number as string);
      if (!member || member.role !== 'member') throw errors.notFound();
      const accountId = await memberAccountId(member);
      const owed = await accountBalanceCents(accountId);
      if (owed <= 0) throw errors.conflict('nothing_owed', 'Nothing is owed.');
      const paidCents = await payFullBalance(accountId);
      return { status: 200, body: { paid_cents: paidCents, owed_cents: 0 } };
    },
  },
  {
    method: 'GET',
    path: '/api/damage-reports',
    roles: ['owner'],
    handler: async () => ({ status: 200, body: await listDamageReports() }),
  },
  {
    method: 'POST',
    path: '/api/damage-reports/:id/confirm',
    roles: ['owner'],
    idempotent: true,
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const report = await findDamageRow(ctx.params.id);
      if (!report) throw errors.notFound();
      if (report.status !== 'reported') {
        throw errors.conflict('already_settled', 'This report is already settled.');
      }
      const raw = ctx.body.amount_cents;
      const amountCents = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
      if (
        !Number.isInteger(amountCents) ||
        (amountCents as number) < MIN_SHELF_CHARGE_CENTS ||
        (amountCents as number) > MAX_SHELF_CHARGE_CENTS
      ) {
        throw errors.unprocessable({
          amount_cents: `Enter a shelf charge from $${formatMoney(MIN_SHELF_CHARGE_CENTS)} to $${formatMoney(MAX_SHELF_CHARGE_CENTS)}`,
        });
      }

      await withTransaction(async (client) => {
        const held = await client.query<{ status: string }>(
          'select status from damage_reports where id = $1 for update',
          [report.id],
        );
        if (held.rows[0]?.status !== 'reported') {
          throw errors.conflict('already_settled', 'This report is already settled.');
        }
        const accountId =
          report.owner_kind === 'member'
            ? await memberAccountId(
                (await findUserById(report.owner_user_id as string)) as NonNullable<
                  Awaited<ReturnType<typeof findUserById>>
                >,
              )
            : (report.kb_account_id as string);
        await postExternalCharge({
          accountId,
          amountCents: amountCents as number,
          description: `Shelf damage Piece ${report.piece_number}`,
        });
        if (
          !(await settleDamageReport(client, {
            id: report.id,
            status: 'charged',
            amountCents: amountCents as number,
          }))
        ) {
          throw errors.conflict('already_settled', 'This report is already settled.');
        }
        await addHistory(client, report.piece_number, user.name, 'damage charged');
      });

      const settled = await findDamageRow(report.id);
      return { status: 200, body: toDamageReport(settled as NonNullable<typeof settled>) };
    },
  },
  {
    method: 'POST',
    path: '/api/damage-reports/:id/waive',
    roles: ['owner'],
    handler: async (ctx) => {
      const user = signedInUser(ctx);
      const report = await findDamageRow(ctx.params.id);
      if (!report) throw errors.notFound();
      await withTransaction(async (client) => {
        if (
          !(await settleDamageReport(client, { id: report.id, status: 'waived', amountCents: null }))
        ) {
          throw errors.conflict('already_settled', 'This report is already settled.');
        }
        await addHistory(client, report.piece_number, user.name, 'damage waived');
      });
      const settled = await findDamageRow(report.id);
      return { status: 200, body: toDamageReport(settled as NonNullable<typeof settled>) };
    },
  },
];
