import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { ApiError, ValidationError, illegalState, notFound } from '../http/errors.js';
import { bodyObject, pathParam, route } from '../http/handler.js';
import { requireCaller } from '../http/session.js';
import { commissionFor, commissionForTransition, ownedCommissionFor } from '../domain/access.js';
import {
  currentQuote,
  findCommission,
  installDayOf,
  issueQuote,
  listFunders,
  listMilestones,
  requiredPiecesOf,
  shapeCommission,
  venueOf,
  type CommissionRow,
} from '../domain/commissions.js';
import { applyRequestedTransition, markPlacedIfComplete } from '../domain/transitions.js';
import { queueCrewAlert } from '../domain/notifications.js';
import { computeQuote } from '../../shared/money.js';
import { FIELD_ERRORS } from '../../shared/copy.js';
import {
  ADDON_ORDER,
  PIECES,
  type AddOn,
  type PieceKind,
  type SizeOption,
} from '../../shared/seed.js';
import {
  LAYOUT_EDITABLE_STATES,
  OPTIONS_EDITABLE_STATES,
  REQUESTABLE_STATES,
  type CommissionState,
} from '../../shared/states.js';
import { validateLayout, type LayoutItem } from '../../shared/placement.js';
import { isoUtc } from '../../shared/venue-time.js';

export const commissionsRouter = Router();

const SIZES: readonly SizeOption[] = ['compact', 'standard', 'grand'];

commissionsRouter.get(
  '/api/commissions',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const isProducer = caller.user.roles.includes('producer');
    const isClient = caller.user.roles.includes('client');
    if (!isProducer && !isClient) {
      res.json({ commissions: [] });
      return;
    }
    const rows = await query<CommissionRow>(
      isProducer
        ? 'SELECT * FROM commissions ORDER BY created_at DESC'
        : 'SELECT * FROM commissions WHERE client_id = $1 ORDER BY created_at DESC',
      isProducer ? [] : [caller.user.id],
    );
    const commissions = await Promise.all(
      rows.rows.map(async (commission) => {
        const venue = venueOf(commission);
        const [quote, milestones, day, client] = await Promise.all([
          currentQuote(commission.id),
          listMilestones(commission.id),
          installDayOf(commission.id),
          query<{ name: string }>('SELECT name FROM app_users WHERE id = $1', [
            commission.client_id,
          ]),
        ]);
        const paidCents = milestones
          .filter((m) => m.state === 'paid')
          .reduce((sum, m) => sum + m.amount_cents, 0);
        const nextDue = milestones.find((m) => m.state !== 'paid' && m.due_at !== null);
        return {
          id: commission.id,
          title: commission.title,
          state: commission.state,
          venueName: venue.name,
          clientName: client.rows[0]?.name ?? '',
          totalCents: quote?.total_cents ?? 0,
          paidCents,
          nextDueAt: nextDue?.due_at ? isoUtc(nextDue.due_at) : null,
          nextDueCents: nextDue?.amount_cents ?? null,
          installDate: day?.install_date ?? null,
        };
      }),
    );
    res.json({ commissions });
  }),
);

commissionsRouter.get(
  '/api/commissions/:commissionId',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await commissionFor(pathParam(req, 'commissionId'), caller);
    res.json(await shapeCommission(commission));
  }),
);

commissionsRouter.get(
  '/api/commissions/:commissionId/ledger',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await commissionFor(pathParam(req, 'commissionId'), caller);
    const result = await query<{
      id: string;
      payer_name: string;
      label: string;
      amount_cents: number;
      killbill_payment_id: string;
      at: Date;
    }>('SELECT * FROM ledger_entries WHERE commission_id = $1 ORDER BY at', [commission.id]);
    res.json({
      entries: result.rows.map((row) => ({
        id: row.id,
        payerName: row.payer_name,
        label: row.label,
        amountCents: row.amount_cents,
        killbillPaymentId: row.killbill_payment_id,
        at: isoUtc(row.at),
      })),
    });
  }),
);

commissionsRouter.post(
  '/api/commissions/:commissionId/transitions',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await commissionForTransition(pathParam(req, 'commissionId'), caller);
    const to = bodyObject(req)['to'];
    if (typeof to !== 'string' || !REQUESTABLE_STATES.includes(to as CommissionState)) {
      throw new ApiError(409, 'illegal_transition', `A commission can't move from ${commission.state} to ${String(to)}.`, {
        from: commission.state,
        to,
      });
    }
    await applyRequestedTransition(commission, to as CommissionState, caller);
    const updated = await findCommission(commission.id);
    if (!updated) throw notFound();
    res.json(await shapeCommission(updated));
  }),
);

function readLayoutItems(value: unknown, required: readonly PieceKind[]): LayoutItem[] {
  if (!Array.isArray(value)) throw new ValidationError({ items: 'Send the layout items.' });
  return value.map((raw, index) => {
    if (raw === null || typeof raw !== 'object') {
      throw new ValidationError({
        [`items[${index}]`]: "That piece isn't part of this commission.",
      });
    }
    const item = raw as Record<string, unknown>;
    const kind = String(item['kind'] ?? '');
    if (!(kind in PIECES)) {
      throw new ValidationError({
        [`items[${index}]`]: "That piece isn't part of this commission.",
      });
    }
    void required;
    return {
      kind: kind as PieceKind,
      x: Number(item['x']),
      y: Number(item['y']),
      rotationDeg: Number(item['rotationDeg']),
    };
  });
}

commissionsRouter.put(
  '/api/commissions/:commissionId/layout',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await ownedCommissionFor(pathParam(req, 'commissionId'), caller);
    if (!LAYOUT_EDITABLE_STATES.includes(commission.state)) throw illegalState();

    const body = bodyObject(req);
    const version = Number(body['version']);
    if (!Number.isInteger(version)) {
      throw new ValidationError({ version: 'Send the version you edited.' });
    }
    if (version !== commission.layout_version) {
      throw new ApiError(412, 'version_conflict', undefined, {
        currentVersion: commission.layout_version,
      });
    }

    const required = requiredPiecesOf(commission) as PieceKind[];
    const items = readLayoutItems(body['items'], required);
    const venue = venueOf(commission);
    void venue;
    const failure = validateLayout(
      items,
      {
        widthM: Number(commission.width_m),
        depthM: Number(commission.depth_m),
        doorWall: commission.door_wall,
      },
      required,
    );
    if (failure) {
      throw new ValidationError({ [`items[${failure.index}]`]: failure.message });
    }

    const updated = await query<CommissionRow>(
      `UPDATE commissions
          SET layout_items = $2, layout_version = layout_version + 1, updated_at = now()
        WHERE id = $1 AND layout_version = $3
        RETURNING *`,
      [commission.id, JSON.stringify(items), version],
    );
    const row = updated.rows[0];
    if (!row) {
      const fresh = await findCommission(commission.id);
      throw new ApiError(412, 'version_conflict', undefined, {
        currentVersion: fresh?.layout_version ?? commission.layout_version,
      });
    }

    await markPlacedIfComplete(row);
    // Saving a layout while a day is booked tells the crew the placement changed.
    const day = await installDayOf(row.id);
    if (day) {
      await withTransaction((tx) =>
        queueCrewAlert(tx, {
          commissionId: row.id,
          commissionTitle: row.title,
          installDayId: day.id,
          kind: 'placement_changed',
          venue: venueOf(row),
          date: day.install_date,
        }),
      );
    }
    res.json({ version: row.layout_version, items: row.layout_items });
  }),
);

function readOptions(body: Record<string, unknown>): { size: SizeOption; addOns: AddOn[] } {
  const errors: Record<string, string> = {};
  const size = String(body['size'] ?? '');
  if (!SIZES.includes(size as SizeOption)) errors['size'] = FIELD_ERRORS.size;
  const raw = body['addOns'];
  const addOns = Array.isArray(raw) ? raw : [];
  if (!addOns.every((a) => ADDON_ORDER.includes(a as AddOn)) || new Set(addOns).size !== addOns.length) {
    errors['addOns'] = FIELD_ERRORS.addOns;
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return {
    size: size as SizeOption,
    addOns: ADDON_ORDER.filter((a) => addOns.includes(a)),
  };
}

commissionsRouter.post(
  '/api/commissions/:commissionId/quote-preview',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await commissionFor(pathParam(req, 'commissionId'), caller);
    const options = readOptions(bodyObject(req));
    const venue = venueOf(commission);
    const amounts = computeQuote(
      commission.installation_type,
      options.size,
      options.addOns,
      venue.taxRateBp,
    );
    res.json({
      lines: amounts.lines,
      subtotalCents: amounts.subtotalCents,
      taxCents: amounts.taxCents,
      totalCents: amounts.totalCents,
    });
  }),
);

/** Options are locked once a sponsor accepts or the commission moves on. */
async function assertOptionsEditable(commission: CommissionRow): Promise<void> {
  if (!OPTIONS_EDITABLE_STATES.includes(commission.state)) {
    throw new ApiError(409, 'options_locked');
  }
  const funders = await listFunders(commission.id);
  if (funders.some((f) => f.kind === 'sponsor' && (f.state === 'accepted' || f.state === 'paid'))) {
    throw new ApiError(409, 'options_locked');
  }
}

commissionsRouter.put(
  '/api/commissions/:commissionId/options',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await ownedCommissionFor(pathParam(req, 'commissionId'), caller);
    await assertOptionsEditable(commission);
    const options = readOptions(bodyObject(req));
    const venue = venueOf(commission);

    const nextRequired = new Set<PieceKind>([
      ...(requiredPiecesOf({ ...commission, add_ons: options.addOns }) as PieceKind[]),
    ]);
    const keptItems = commission.layout_items.filter((item) => nextRequired.has(item.kind));
    const layoutChanged = keptItems.length !== commission.layout_items.length;

    const updated = await withTransaction(async (tx) => {
      const result = await tx.query<CommissionRow>(
        `UPDATE commissions
            SET size_option = $2,
                add_ons = $3,
                layout_items = $4,
                layout_version = layout_version + $5,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [
          commission.id,
          options.size,
          options.addOns,
          JSON.stringify(keptItems),
          layoutChanged ? 1 : 0,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('options update produced no row');
      await issueQuote(tx, row, venue);
      return row;
    });

    const quote = await currentQuote(commission.id);
    res.json({
      options: { size: updated.size_option, addOns: updated.add_ons },
      quote: quote
        ? {
            quoteId: quote.id,
            lines: quote.lines,
            subtotalCents: quote.subtotal_cents,
            taxCents: quote.tax_cents,
            totalCents: quote.total_cents,
            issuedAt: isoUtc(quote.issued_at),
            validUntil: isoUtc(quote.valid_until),
          }
        : null,
      layout: { version: updated.layout_version, items: updated.layout_items },
    });
  }),
);

commissionsRouter.post(
  '/api/commissions/:commissionId/quote/refresh',
  route(async (req, res) => {
    const caller = await requireCaller(req);
    const commission = await ownedCommissionFor(pathParam(req, 'commissionId'), caller);
    const milestones = await listMilestones(commission.id);
    const deposit = milestones.find((m) => m.milestone_key === 'deposit');
    if (deposit?.state === 'paid') throw illegalState();

    const venue = venueOf(commission);
    const quote = await withTransaction((tx) => issueQuote(tx, commission, venue));
    res.json({
      quote: {
        quoteId: quote.id,
        lines: quote.lines,
        subtotalCents: quote.subtotal_cents,
        taxCents: quote.tax_cents,
        totalCents: quote.total_cents,
        issuedAt: isoUtc(quote.issued_at),
        validUntil: isoUtc(quote.valid_until),
      },
    });
  }),
);
