import { randomUUID } from 'node:crypto';
import { releaseActionAllowed, type ReleaseAction } from '../../shared/releasestates';
import { HOUSE_TIME_ZONE } from '../../shared/zurich';
import { withTransaction, query, type Tx } from '../db';
import { VALIDATION_MESSAGES, fail, type FieldErrors } from '../http/errors';
import type { RequestContext, Route } from '../http/pipeline';
import {
  ITEM_SELECT,
  loadCarRow,
  toCar,
  toItem,
  type ItemRow,
} from '../domain/cars';
import { holdingInvoicesFor } from '../domain/invoices';
import { queueMail, releaseBookedMail, releasedMail } from '../domain/mailer';
import {
  RELEASE_SELECT,
  appendEvent,
  checkSlot,
  earliestSlot,
  loadReleaseRow,
  loadReleaseRows,
  toRelease,
  type ReleaseRow,
} from '../domain/releases';
import { sendMail } from '../providers/smtp';
import { queueSubscriptionEffect } from '../queue';

const SLOT_MESSAGES = {
  format: VALIDATION_MESSAGES.slotFormat,
  grid: VALIDATION_MESSAGES.slotGrid,
  notice: VALIDATION_MESSAGES.slotNotice,
} as const;
import { ownerScope } from './cars';

const UNIQUE_VIOLATION = '23505';

function constraintOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  if ((error as { code?: string }).code !== UNIQUE_VIOLATION) return '';
  return String((error as { constraint?: string }).constraint ?? '');
}

async function releaseResult(releaseId: string): Promise<{
  kind: 'json';
  status: number;
  body: unknown;
}> {
  const row = await loadReleaseRow(releaseId, null);
  if (row === null) throw fail.notFound();
  return { kind: 'json', status: 200, body: { release: await toRelease(row) } };
}

async function moveRelease(
  ctx: RequestContext,
  action: ReleaseAction,
  after: (tx: Tx, row: ReleaseRow) => Promise<void>,
): Promise<{ kind: 'json'; status: number; body: unknown }> {
  const releaseId = ctx.params.id ?? '';
  const visible = await loadReleaseRow(releaseId, ownerScope(ctx));
  if (visible === null) throw fail.notFound();
  if (action === 'cancel') {
    ctx.requireRole('owner', 'concierge', 'house_manager');
  } else {
    ctx.requireRole('concierge', 'house_manager');
  }
  const actor = ctx.user().role === 'owner' ? 'owner' : 'staff';

  await withTransaction(async (tx) => {
    await tx.lock(`release:${releaseId}`);
    const row = await tx.queryOne<ReleaseRow>(`${RELEASE_SELECT} where r.id = $1`, [releaseId]);
    if (row === null) throw fail.notFound();
    if (!releaseActionAllowed(row.status, action, actor)) throw fail.conflict('invalid_transition');
    const status =
      action === 'book'
        ? 'booked'
        : action === 'stage'
          ? 'staged'
          : action === 'complete'
            ? 'released'
            : 'cancelled';
    await tx.query('update releases set status = $2 where id = $1', [releaseId, status]);
    await appendEvent(tx, releaseId, status, ctx.user().id, ctx.now);
    await after(tx, row);
  });
  return releaseResult(releaseId);
}

export const releaseRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/releases/earliest-slot',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const earliest = earliestSlot(ctx.now);
      return {
        kind: 'json',
        status: 200,
        body: {
          earliest: earliest.slot,
          earliest_label: earliest.label,
          time_zone: HOUSE_TIME_ZONE,
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/releases',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const rows = await loadReleaseRows(ownerScope(ctx));
      const releases = await Promise.all(rows.map((row) => toRelease(row)));
      return { kind: 'json', status: 200, body: { releases } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/releases/:id',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const row = await loadReleaseRow(ctx.params.id ?? '', ownerScope(ctx));
      if (row === null) throw fail.notFound();
      return { kind: 'json', status: 200, body: { release: await toRelease(row) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/releases',
    body: 'json',
    session: 'required',
    idempotent: true,
    async handle(ctx) {
      const carId = typeof ctx.body.car_id === 'string' ? ctx.body.car_id.trim() : '';
      const owner = ownerScope(ctx);
      const cars = await query<{ id: string; owner_id: string; status: string }>(
        `select id, owner_id, status from cars where id = $1 ${owner === null ? '' : 'and owner_id = $2'}`,
        owner === null ? [carId] : [carId, owner],
      );
      const car = cars[0];
      if (car === undefined) throw fail.notFound();
      ctx.requireRole('owner');

      const releaseId = await withTransaction(async (tx) => {
        await tx.lock(`car:${carId}`);
        const current = await tx.queryOne<{ status: string }>(
          'select status from cars where id = $1',
          [carId],
        );
        if (current === null) throw fail.notFound();
        if (current.status !== 'stored') throw fail.conflict('car_not_stored');
        const working = await tx.queryOne<{ id: string }>(
          "select id from jobs where car_id = $1 and status = 'in_progress'",
          [carId],
        );
        if (working !== null) throw fail.conflict('car_in_workshop');
        const open = await tx.queryOne<{ id: string }>(
          "select id from releases where car_id = $1 and status in ('requested','booked','staged')",
          [carId],
        );
        if (open !== null) throw fail.conflict('release_already_open');

        const checked = checkSlot(ctx.body.slot, ctx.now);
        const errors: FieldErrors = {};
        if (ctx.idempotencyKey === null) {
          errors.idempotency_key = VALIDATION_MESSAGES.idempotencyKey;
        }
        if (typeof checked === 'string') {
          errors.slot = SLOT_MESSAGES[checked];
          throw fail.validation(errors);
        }
        if (Object.keys(errors).length > 0) throw fail.validation(errors);
        const slot = checked;

        const taken = await tx.queryOne<{ id: string }>(
          `select id from releases where slot = $1 and status in ('requested','booked','staged')`,
          [slot.slot],
        );
        if (taken !== null) throw fail.conflict('slot_taken');

        const newId = `rel-${randomUUID()}`;
        try {
          await tx.query(
            `insert into releases (id, car_id, owner_id, slot, slot_at, status, created_at)
             values ($1,$2,$3,$4,$5,'requested',$6)`,
            [newId, carId, car.owner_id, slot.slot, slot.at, ctx.now],
          );
        } catch (error) {
          const constraint = constraintOf(error);
          if (constraint.includes('releases_one_open_per_slot')) throw fail.conflict('slot_taken');
          if (constraint.includes('releases_one_open_per_car')) {
            throw fail.conflict('release_already_open');
          }
          throw error;
        }
        await appendEvent(tx, newId, 'requested', ctx.user().id, ctx.now);
        return newId;
      });

      const row = await loadReleaseRow(releaseId, null);
      if (row === null) throw fail.notFound();
      return { kind: 'json', status: 201, body: { release: await toRelease(row) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/releases/:id/book',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      return moveRelease(ctx, 'book', async (tx, row) => {
        const owner = await tx.queryOne<{ name: string; email: string }>(
          'select name, email from users where id = $1',
          [row.owner_id],
        );
        if (owner === null) throw fail.notFound();
        const release = await toRelease(row);
        await queueMail(
          tx,
          releaseBookedMail({
            to: owner.email,
            ownerName: owner.name,
            carName: release.car.name,
            slotLabel: release.slot_label,
            bayCode: release.bay_code ?? '',
            releaseId: row.id,
          }),
        );
      });
    },
  },
  {
    method: 'POST',
    pattern: '/api/releases/:id/stage',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      return moveRelease(ctx, 'stage', async () => undefined);
    },
  },
  {
    method: 'POST',
    pattern: '/api/releases/:id/cancel',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      return moveRelease(ctx, 'cancel', async () => undefined);
    },
  },
  {
    method: 'POST',
    pattern: '/api/releases/:id/complete',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const releaseId = ctx.params.id ?? '';
      const visible = await loadReleaseRow(releaseId, ownerScope(ctx));
      if (visible === null) throw fail.notFound();
      ctx.requireRole('concierge', 'house_manager');

      await withTransaction(async (tx) => {
        await tx.lock(`release:${releaseId}`);
        const row = await tx.queryOne<ReleaseRow>(`${RELEASE_SELECT} where r.id = $1`, [releaseId]);
        if (row === null) throw fail.notFound();
        await tx.lock(`car:${row.car_id}`);
        if (!releaseActionAllowed(row.status, 'complete', 'staff')) {
          throw fail.conflict('invalid_transition');
        }

        const holding = await holdingInvoicesFor(row.car_id);
        if (holding.length > 0) throw fail.invoiceUnpaid(holding);

        const items = await tx.query<ItemRow>(ITEM_SELECT, [row.car_id]);
        const checkedIn = items.map(toItem).filter((item) => item.count_in > 0);
        if (checkedIn.length > 0) throw fail.belongingsCheckedIn(checkedIn);

        const bayCode = row.current_bay_code ?? row.bay_code;
        await tx.query("update releases set status = 'released', bay_code = $2 where id = $1", [
          releaseId,
          bayCode,
        ]);
        await appendEvent(tx, releaseId, 'released', ctx.user().id, ctx.now);
        await tx.query(
          "update cars set status = 'released', bay_id = null, released_at = $2 where id = $1",
          [row.car_id, ctx.now],
        );
        await tx.query('update subscriptions set cancel_requested = true where car_id = $1', [
          row.car_id,
        ]);
        await queueSubscriptionEffect(tx, 'subscription_cancel', row.car_id);

        const owner = await tx.queryOne<{ name: string; email: string }>(
          'select name, email from users where id = $1',
          [row.owner_id],
        );
        if (owner === null) throw fail.notFound();
        const release = await toRelease(row);
        await sendMail(
          releasedMail({
            to: owner.email,
            ownerName: owner.name,
            carName: release.car.name,
            at: ctx.now,
            bayCode: bayCode ?? '',
          }),
        );
      });

      const row = await loadReleaseRow(releaseId, null);
      if (row === null) throw fail.notFound();
      const carRow = await loadCarRow(row.car_id, null);
      if (carRow === null) throw fail.notFound();
      return {
        kind: 'json',
        status: 200,
        body: { release: await toRelease(row), car: toCar(carRow, ctx.now) },
      };
    },
  },
];
