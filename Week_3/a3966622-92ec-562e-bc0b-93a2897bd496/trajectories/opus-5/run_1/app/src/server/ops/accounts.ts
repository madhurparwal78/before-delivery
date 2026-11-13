import {
  type Wall,
  formatInstantSeconds,
  parsePortDateTime,
  wallToInstant,
} from '../../domain/porttime.ts';
import type { TariffRevision, TonnageBand } from '../../domain/tariff.ts';
import type { App } from '../app.ts';
import { tariffEffectiveInstants } from '../derive.ts';
import { conflict, forbidden, notFound } from '../errors.ts';
import type { InvoiceRecord, StoreState, UserRecord } from '../store/types.ts';
import { canReadInvoice, canReadMove, invoiceView } from '../views.ts';
import type { ActionResult } from './moves.ts';
import { FieldErrors, TIME_DOES_NOT_EXIST, asRecord, definite } from './validate.ts';

const LABEL_MESSAGE = 'Label must be one line of 1 to 40 characters';

function wholeCents(
  fields: Record<string, unknown>,
  field: string,
  errors: FieldErrors,
  maximum = 100_000_000,
): number {
  const raw = fields[field];
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > maximum) {
    errors.add(field, 'A whole number of 0 or more is required');
    return 0;
  }
  return raw;
}

function readBands(fields: Record<string, unknown>, errors: FieldErrors): TonnageBand[] {
  const raw = fields.tonnage_bands;
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.add('tonnage_bands', 'At least one tonnage band is required');
    return [];
  }
  const bands: TonnageBand[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      errors.add('tonnage_bands', 'Each tonnage band needs from_gt, to_gt and cents');
      return;
    }
    const band = entry as Record<string, unknown>;
    const from = band.from_gt;
    const to = band.to_gt ?? null;
    const cents = band.cents;
    if (typeof from !== 'number' || !Number.isInteger(from) || from < 0) {
      errors.add('tonnage_bands', 'Each band starts at a whole gross tonnage of 0 or more');
      return;
    }
    if (to !== null && (typeof to !== 'number' || !Number.isInteger(to) || to < from)) {
      errors.add('tonnage_bands', 'Each band ends at a whole gross tonnage above its start');
      return;
    }
    if (typeof cents !== 'number' || !Number.isInteger(cents) || cents < 0) {
      errors.add('tonnage_bands', 'Each band amount is a whole number of cents');
      return;
    }
    if (index === 0 && from !== 0) {
      errors.add('tonnage_bands', 'The first band starts at 0 gross tons');
      return;
    }
    const previous = bands[index - 1];
    if (previous !== undefined) {
      if (previous.to_gt === null) {
        errors.add('tonnage_bands', 'Only the last band has no upper limit');
        return;
      }
      if (from !== previous.to_gt + 1) {
        errors.add('tonnage_bands', 'Each band starts one above the previous band');
        return;
      }
    }
    if (to === null && index !== raw.length - 1) {
      errors.add('tonnage_bands', 'Only the last band has no upper limit');
      return;
    }
    bands.push({ from_gt: from, to_gt: to as number | null, cents });
  });
  return bands;
}

export function publishTariffRevision(app: App, user: UserRecord, body: unknown): ActionResult {
  if (user.role !== 'clerk') throw forbidden();
  const now = Date.now();
  const fields = asRecord(body);
  const errors = new FieldErrors();
  const label = fields.label;
  if (typeof label !== 'string' || /[\r\n]/.test(label) || label.length < 1 || label.length > 40) {
    errors.add('label', LABEL_MESSAGE);
  }
  const effectiveText = fields.effective_at;
  let effectiveWall: Wall | null = null;
  let effectiveInstant: number | null = null;
  if (typeof effectiveText !== 'string') {
    errors.add('effective_at', 'A port time of the form YYYY-MM-DDTHH:MM is required');
  } else {
    effectiveWall = parsePortDateTime(effectiveText);
    if (effectiveWall === null) {
      errors.add('effective_at', 'A port time of the form YYYY-MM-DDTHH:MM is required');
    } else {
      effectiveInstant = wallToInstant(effectiveWall);
      if (effectiveInstant === null) errors.add('effective_at', TIME_DOES_NOT_EXIST);
      else if (effectiveInstant <= now) {
        errors.add('effective_at', 'The effective time must be later than now');
      }
    }
  }
  const draftFoot = wholeCents(fields, 'draft_foot_cents', errors);
  const minimum = wholeCents(fields, 'minimum_cents', errors);
  const detentionHalfHour = wholeCents(fields, 'detention_half_hour_cents', errors);
  const cancellation = wholeCents(fields, 'cancellation_cents', errors);
  const allowance = wholeCents(fields, 'detention_allowance_half_hours', errors, 1000);
  const nightPercentRaw = fields.night_percent;
  if (
    typeof nightPercentRaw !== 'number' ||
    !Number.isInteger(nightPercentRaw) ||
    nightPercentRaw < 0 ||
    nightPercentRaw > 100
  ) {
    errors.add('night_percent', 'A whole percent from 0 to 100 is required');
  }
  const bands = readBands(fields, errors);
  errors.throwIfAny();
  const effective = definite(typeof effectiveText === 'string' ? effectiveText : null, 'effective_at');
  const revisionLabel = definite(typeof label === 'string' ? label : null, 'label');
  const nightPercent = definite(
    typeof nightPercentRaw === 'number' ? nightPercentRaw : null,
    'night_percent',
  );
  const state = app.store.read();
  if (state.tariff_revisions.some((revision) => revision.effective_at === effective.slice(0, 16))) {
    throw conflict('effective_time_taken', 'Another revision takes effect at that time');
  }

  const revision: TariffRevision = {
    id: app.store.mutate(() => app.store.nextId('revision', 'TR')),
    label: revisionLabel,
    effective_at: effective.slice(0, 16),
    draft_foot_cents: draftFoot,
    minimum_cents: minimum,
    tonnage_bands: bands,
    night_percent: nightPercent,
    detention_half_hour_cents: detentionHalfHour,
    detention_allowance_half_hours: allowance,
    cancellation_cents: cancellation,
  };
  app.store.mutate((live) => {
    live.tariff_revisions.push(revision);
  });
  return { status: 201, json: revisionWithMoves(app.store.read(), revision, user) };
}

export function revisionWithMoves(
  state: StoreState,
  revision: TariffRevision,
  viewer: UserRecord,
): Record<string, unknown> {
  const moves = state.moves
    .filter((move) => canReadMove(viewer, move))
    .filter((move) =>
      move.billing_events.some((event) => {
        const invoice = state.invoices.find((entry) => entry.id === event.invoice_id);
        return invoice?.lines.some((line) => line.tariff_revision === revision.label) === true;
      }),
    )
    .map((move) => move.ref);
  return { ...revision, moves };
}

export function listTariffRevisions(app: App, user: UserRecord): ActionResult {
  const state = app.store.read();
  const instants = tariffEffectiveInstants(state);
  const revisions = [...state.tariff_revisions]
    .sort((left, right) => (instants.get(left.id) ?? 0) - (instants.get(right.id) ?? 0))
    .map((revision) => revisionWithMoves(state, revision, user));
  return { status: 200, json: { revisions } };
}

export function invoiceOrNotFound(app: App, user: UserRecord, id: string): InvoiceRecord {
  const invoice = app.store.read().invoices.find((entry) => entry.id === id);
  if (invoice === undefined || !canReadInvoice(user, invoice)) throw notFound();
  return invoice;
}

/** Reading an issued invoice re-reads the balance when the provider answers. */
export async function refreshInvoiceBalance(app: App, invoice: InvoiceRecord): Promise<void> {
  if (invoice.state !== 'issued' || invoice.killbill_invoice_id === null) return;
  if (app.services.latest().billing === 'down') return;
  try {
    const confirmed = await app.billing.readInvoice(invoice.killbill_invoice_id);
    app.store.mutate(() => {
      invoice.balance_cents = confirmed.balanceCents;
      invoice.number = confirmed.invoiceNumber;
      invoice.balance_confirmed_at = formatInstantSeconds(Date.now());
    });
  } catch {
    /* the stored truth stands when the provider does not answer */
  }
}

export async function issueInvoice(
  app: App,
  user: UserRecord,
  invoice: InvoiceRecord,
): Promise<ActionResult> {
  if (user.role !== 'clerk') throw forbidden();
  if (invoice.state === 'issued') {
    return { status: 200, json: invoiceView(invoice) };
  }
  app.store.mutate((state) => {
    invoice.issue_requested = true;
    const existing = state.steps.find(
      (step) => step.kind === 'invoice_commit' && step.target_id === invoice.id,
    );
    if (existing === undefined) {
      state.steps.push({
        id: `ST-${invoice.id}-commit`,
        kind: 'invoice_commit',
        target_id: invoice.id,
        state: 'pending',
        attempts: 0,
        last_attempt_at: null,
        last_error: null,
      });
    }
  });
  await app.steps.runForTarget('invoice_commit', invoice.id);
  const settled = app.store.read().invoices.find((entry) => entry.id === invoice.id);
  if (settled === undefined) throw notFound();
  return { status: settled.state === 'issued' ? 200 : 202, json: invoiceView(settled) };
}
