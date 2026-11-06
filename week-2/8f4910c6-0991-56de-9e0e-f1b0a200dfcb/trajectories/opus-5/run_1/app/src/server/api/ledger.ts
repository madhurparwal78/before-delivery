import { query, transaction } from '../db.js';
import { conflict, notFound, validation } from '../http/errors.js';
import type { Ctx, Reply, Route } from '../http/router.js';
import type { MemberRow } from '../data/members.js';
import { findTalentById, type TalentRow } from '../data/talent.js';
import { loadOffice } from '../data/offices.js';
import {
  balanceOfTalent,
  entriesOf,
  findMovement,
  markReversed,
  movementView,
  movementsTouchingTalent,
  talentAccount,
  writeMovement,
} from '../data/ledger.js';
import { buildStatement, type MovementSummary } from '../domain/statements.js';
import { buildCsv } from '../domain/csv.js';
import { formatDecimalCents } from '../../shared/format.js';
import { formatIsoDate, officeDate, parseMonthKey, toIsoInstant } from '../../shared/zone.js';
import { json, readNumber, readString } from './helpers.js';
import { nextCounter } from '../schema.js';
import { createCredit, ensureAccount } from '../services/killbill.js';
import { findBookingRow } from '../data/bookings.js';
import { findClient } from '../data/clients.js';
import { putObject } from '../services/storage.js';

const MOVEMENT_TYPE_NAMES = { booking: 'Booking', advance: 'Advance', reversal: 'Reversal' } as const;

/** A talent reads only their own records; any other id answers like an unknown one. */
async function readableTalent(ctx: Ctx, talentId: string): Promise<TalentRow> {
  const member = ctx.member as MemberRow;
  const talent = await findTalentById(talentId);
  if (!talent) throw notFound();
  if (member.role === 'talent') {
    if (member.talent_id !== talent.id) throw notFound();
    return talent;
  }
  if (member.role === 'accounts_lead' || member.role === 'agency_director') return talent;
  throw notFound();
}

async function summariesFor(talent: TalentRow): Promise<MovementSummary[]> {
  const movements = await movementsTouchingTalent(talent.id);
  const entries = await entriesOf(movements.map((movement) => movement.id));
  const clientIds = movements
    .map((movement) => movement.client_id)
    .filter((id): id is string => id !== null);
  const clients = clientIds.length
    ? await query<{ id: string; company: string }>(
      'SELECT id, company FROM clients WHERE id = ANY($1::text[])',
      [clientIds],
    )
    : [];
  const byId = new Map(movements.map((movement) => [movement.id, movement]));

  return movements.map((movement): MovementSummary => {
    const amount = (entries.get(movement.id) ?? [])
      .filter((entry) => entry.account === talentAccount(talent.id))
      .reduce((sum, entry) => sum + entry.amount_cents, 0);
    const reversed = movement.reversal_of
      ? byId.get(movement.reversal_of) ?? null
      : null;
    return {
      movementId: movement.id,
      kind: movement.kind,
      reference: movement.reference,
      officeDate: movement.office_date,
      client: clients.find((client) => client.id === movement.client_id)?.company ?? '',
      description: movement.description,
      amountCents: amount,
      reversed: movement.reversed_by_movement !== null,
      reversesBooking: reversed?.kind === 'booking',
      createdAt: movement.created_at.getTime(),
    };
  });
}

async function movementReply(movementId: string): Promise<Reply> {
  const row = await findMovement(movementId);
  if (!row) throw notFound();
  const entries = await entriesOf([movementId]);
  return json(201, { movement: movementView(row, entries.get(movementId) ?? []) });
}

export const ledgerRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/talent/:id/advances',
    auth: 'session',
    roles: ['accounts_lead', 'agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      if (!(await findTalentById(ctx.params.id))) throw notFound();
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const talent = await findTalentById(ctx.params.id);
      if (!talent) throw notFound();
      const amountCents = readNumber(ctx.json, 'amountCents');
      if (amountCents === null || !Number.isInteger(amountCents) || amountCents <= 0) {
        throw validation({ amountCents: 'Enter amount.' });
      }
      const note = (readString(ctx.json, 'note') ?? '').trim();
      const office = await loadOffice(talent.office_id);
      const reference = `ADV-${String(await nextCounter('advance')).padStart(6, '0')}`;
      const movementId = await transaction(async (tx) =>
        writeMovement(tx, {
          kind: 'advance',
          reference,
          talentId: talent.id,
          bookingId: null,
          clientId: null,
          reversalOf: null,
          description: note,
          createdBy: member.id,
          createdByName: member.name,
          officeDate: formatIsoDate(officeDate(office.timeZone, ctx.nowMs)),
          nowMs: ctx.nowMs,
          entries: [
            { account: talentAccount(talent.id), amountCents: -amountCents },
            { account: 'agency_cash', amountCents },
          ],
        }));
      return movementReply(movementId);
    },
  },
  {
    method: 'GET',
    path: '/api/talent/:id/ledger',
    auth: 'session',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const talent = await readableTalent(ctx, ctx.params.id);
      const movements = await movementsTouchingTalent(talent.id);
      const entries = await entriesOf(movements.map((movement) => movement.id));
      return json(200, {
        balanceCents: await balanceOfTalent(talent.id),
        movements: movements.map((movement) => movementView(movement, entries.get(movement.id) ?? [])),
      });
    },
  },
  {
    method: 'POST',
    path: '/api/ledger/movements/:id/reversal',
    auth: 'session',
    roles: ['accounts_lead', 'agency_director'],
    body: 'json',
    load: async (ctx: Ctx): Promise<void> => {
      if (!(await findMovement(ctx.params.id))) throw notFound();
    },
    handler: async (ctx: Ctx): Promise<Reply> => {
      const member = ctx.member as MemberRow;
      const movement = await findMovement(ctx.params.id);
      if (!movement) throw notFound();
      if (movement.reversed_by_movement) {
        throw conflict('already_reversed', {
          reversedBy: movement.reversed_by_name,
          reversedAt: movement.reversed_at ? toIsoInstant(movement.reversed_at.getTime()) : null,
        });
      }
      const booking = movement.booking_id ? await findBookingRow(movement.booking_id) : null;
      if (booking && booking.state !== 'invoiced') throw conflict('not_invoiced');
      const reason = (readString(ctx.json, 'reason') ?? '').trim();
      if (!reason) throw validation({ reason: 'Enter reason.' });

      if (booking) {
        const client = await findClient(booking.client_id);
        if (!client) throw notFound();
        const accountId = await ensureAccount(client);
        await createCredit(accountId, {
          description: `Reversal of ${booking.reference}`,
          amountCents: booking.total_cents,
        });
      }

      const entries = await entriesOf([movement.id]);
      const mirrored = (entries.get(movement.id) ?? []).map((entry) => ({
        account: entry.account,
        amountCents: -entry.amount_cents,
      }));
      const office = await loadOffice(
        (await findTalentById(movement.talent_id ?? ''))?.office_id ?? (member.office_id),
      );
      const reference = `REV-${String(await nextCounter('reversal')).padStart(6, '0')}`;
      const movementId = await transaction(async (tx) => {
        const id = await writeMovement(tx, {
          kind: 'reversal',
          reference,
          talentId: movement.talent_id,
          bookingId: movement.booking_id,
          clientId: movement.client_id,
          reversalOf: movement.id,
          description: reason,
          createdBy: member.id,
          createdByName: member.name,
          officeDate: formatIsoDate(officeDate(office.timeZone, ctx.nowMs)),
          nowMs: ctx.nowMs,
          entries: mirrored,
        });
        await markReversed(tx, movement.id, id, member.name, ctx.nowMs);
        if (movement.booking_id) {
          await tx.query(`UPDATE bookings SET state = 'corrected' WHERE id = $1`, [movement.booking_id]);
        }
        return id;
      });
      return movementReply(movementId);
    },
  },
  {
    method: 'GET',
    path: '/api/talent/:id/statements/:month.csv',
    auth: 'session',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const talent = await readableTalent(ctx, ctx.params.id);
      if (!parseMonthKey(ctx.params.month)) throw notFound();
      const statement = await statementOf(talent, ctx.params.month);
      const csv = buildCsv(
        ['Date', 'Type', 'Reference', 'Client', 'Description', 'Amount (CAD)', 'Balance (CAD)'],
        statement.lines.map((line) => [
          line.officeDate,
          MOVEMENT_TYPE_NAMES[line.kind],
          line.reference,
          line.client,
          line.description,
          formatDecimalCents(line.amountCents),
          formatDecimalCents(line.balanceCents),
        ]),
        ['number', 'text', 'text', 'text', 'text', 'number', 'number'],
      );
      await putObject(`statements/${talent.id}/${ctx.params.month}.csv`, Buffer.from(csv, 'utf8'), 'text/csv');
      return {
        status: 200,
        body: csv,
        contentType: 'text/csv; charset=utf-8',
        headers: {
          'Content-Disposition': `attachment; filename="statement-${talent.slug}-${ctx.params.month}.csv"`,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/talent/:id/statements/:month',
    auth: 'session',
    handler: async (ctx: Ctx): Promise<Reply> => {
      const talent = await readableTalent(ctx, ctx.params.id);
      if (!parseMonthKey(ctx.params.month)) throw notFound();
      return json(200, await statementOf(talent, ctx.params.month));
    },
  },
];

async function statementOf(talent: TalentRow, month: string): Promise<ReturnType<typeof buildStatement>> {
  return buildStatement({
    talentId: talent.id,
    displayName: talent.display_name,
    month,
    movements: await summariesFor(talent),
  });
}


