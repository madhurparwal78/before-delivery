import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { allocate, percentOf } from '../../shared/money';
import { ApiError, newIdempotencyKey, request } from '../lib/api.js';
import { formatEuros, formatTime } from '../lib/festival.js';
import { useRoute, useUser } from '../lib/store.js';
import type { FestivalDay, Hold, Order, PassPrices, Session } from '../lib/types.js';
import { Dialog } from './Dialog.js';
import type { JSX } from 'react';

export type CheckoutStep = 'tickets' | 'details' | 'review';

const STEP_LABELS: Record<CheckoutStep, string> = {
  tickets: 'Tickets',
  details: 'Details',
  review: 'Review and pay',
};

const STEP_ORDER: CheckoutStep[] = ['tickets', 'details', 'review'];

interface Draft {
  fullFestival: number;
  dayPasses: Record<string, number>;
  rate: 'full' | 'reduced';
  voucherCode: string;
  appliedVoucher: string | null;
  attendeeNames: string[];
  idempotencyKey: string;
}

const DRAFT_KEY = 'kerf-checkout-draft';

function readDraft(): Draft {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<Draft>;
      return {
        fullFestival: parsed.fullFestival ?? 0,
        dayPasses: parsed.dayPasses ?? {},
        rate: parsed.rate === 'reduced' ? 'reduced' : 'full',
        voucherCode: parsed.voucherCode ?? '',
        appliedVoucher: parsed.appliedVoucher ?? null,
        attendeeNames: parsed.attendeeNames ?? [],
        idempotencyKey: parsed.idempotencyKey ?? newIdempotencyKey(),
      };
    }
  } catch {
    // a malformed draft is simply replaced
  }
  return {
    fullFestival: 0,
    dayPasses: {},
    rate: 'full',
    voucherCode: '',
    appliedVoucher: null,
    attendeeNames: [],
    idempotencyKey: newIdempotencyKey(),
  };
}

export function suggestedPasses(
  agendaSessions: readonly Session[],
  planetariumId: string,
): { fullFestival: number; dayPasses: Record<string, number> } {
  const passSessions = agendaSessions.filter((session) => session.admission === 'pass');
  const days = new Set(passSessions.map((session) => session.festival_day));
  const atDome = agendaSessions.some((session) => session.venue_id === planetariumId);
  if (atDome || days.size >= 3) return { fullFestival: 1, dayPasses: {} };
  const dayPasses: Record<string, number> = {};
  for (const day of days) dayPasses[day] = 1;
  return { fullFestival: 0, dayPasses };
}

interface PreviewLine {
  key: string;
  title: string;
  holder: string;
  listCents: number;
  discountCents: number;
  voucherCents: number;
  chargedCents: number;
}

interface CheckoutProps {
  open: boolean;
  step: CheckoutStep;
  onStatus: (text: string) => void;
  onProblem: (text: string) => void;
  days: FestivalDay[];
  sessions: Session[];
  prices: PassPrices;
  openerRef: React.MutableRefObject<HTMLElement | null>;
  initialPasses: { fullFestival: number; dayPasses: Record<string, number> } | null;
  onClose: () => void;
  onDone: (order: Order) => void;
}

export function Checkout(props: CheckoutProps): JSX.Element | null {
  const { user } = useUser();
  const route = useRoute();
  const [holds, setHolds] = useState<Hold[]>([]);
  const [draft, setDraft] = useState<Draft>(readDraft);
  const setStatus = props.onStatus;
  const setProblem = props.onProblem;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [paying, setPaying] = useState(false);
  const [voucherBalance, setVoucherBalance] = useState(0);
  const appliedInitial = useRef(false);

  const isGroup = user?.role === 'group_booker';

  useEffect(() => {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  const loadHolds = useCallback(async () => {
    try {
      const body = await request<{ holds: Hold[] }>('/api/holds');
      setHolds(body.holds);
    } catch {
      setHolds([]);
    }
  }, []);

  useEffect(() => {
    if (!props.open) return;
    void loadHolds();
  }, [props.open, loadHolds]);

  useEffect(() => {
    if (!props.open || props.initialPasses === null || appliedInitial.current) return;
    appliedInitial.current = true;
    setDraft((current) => ({
      ...current,
      fullFestival: props.initialPasses?.fullFestival ?? current.fullFestival,
      dayPasses: props.initialPasses?.dayPasses ?? current.dayPasses,
    }));
  }, [props.open, props.initialPasses]);

  /** When a hold's time passes, the client asks the server for its holds again. */
  useEffect(() => {
    if (!props.open || holds.length === 0) return;
    const soonest = Math.min(...holds.map((hold) => new Date(hold.expires_at).getTime()));
    const delay = Math.max(500, soonest - Date.now() + 250);
    const timer = window.setTimeout(() => {
      const lapsed = holds.filter((hold) => new Date(hold.expires_at).getTime() <= Date.now());
      void loadHolds().then(() => {
        const first = lapsed[0];
        if (first === undefined) return;
        const session = props.sessions.find((candidate) => candidate.id === first.session_id);
        setStatus(
          `Your hold on ${session?.title ?? 'that session'} expired and the seat was released.`,
        );
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [props.open, holds, loadHolds, props.sessions]);

  const seatLines = useMemo(() => {
    const lines: PreviewLine[] = [];
    for (const hold of holds) {
      const session = props.sessions.find((candidate) => candidate.id === hold.session_id);
      for (let seat = 0; seat < hold.quantity; seat += 1) {
        const price =
          draft.rate === 'reduced'
            ? (session?.price_reduced_cents ?? 0)
            : (session?.price_full_cents ?? 0);
        lines.push({
          key: `${hold.id}-${seat}`,
          title: session?.title ?? 'Seat',
          holder: '',
          listCents: price,
          discountCents: 0,
          voucherCents: 0,
          chargedCents: price,
        });
      }
    }
    return lines;
  }, [holds, props.sessions, draft.rate]);

  const passLines = useMemo(() => {
    const lines: PreviewLine[] = [];
    for (let index = 0; index < draft.fullFestival; index += 1) {
      const price =
        draft.rate === 'reduced'
          ? props.prices.full_festival_reduced_cents
          : props.prices.full_festival_full_cents;
      lines.push({
        key: `full-${index}`,
        title: 'Full-festival pass',
        holder: '',
        listCents: price,
        discountCents: 0,
        voucherCents: 0,
        chargedCents: price,
      });
    }
    for (const day of props.days) {
      const count = draft.dayPasses[day.date] ?? 0;
      for (let index = 0; index < count; index += 1) {
        const price =
          draft.rate === 'reduced' ? props.prices.day_reduced_cents : props.prices.day_full_cents;
        lines.push({
          key: `day-${day.date}-${index}`,
          title: `Day pass, ${day.label}`,
          holder: '',
          listCents: price,
          discountCents: 0,
          voucherCents: 0,
          chargedCents: price,
        });
      }
    }
    return lines;
  }, [draft.fullFestival, draft.dayPasses, draft.rate, props.days, props.prices]);

  const preview = useMemo(() => {
    const lines = [...seatLines, ...passLines].map((line, index) => ({
      ...line,
      holder: isGroup ? (draft.attendeeNames[index] ?? '') : (user?.name ?? ''),
    }));
    const subtotal = lines.reduce((sum, line) => sum + line.listCents, 0);
    const discount = isGroup ? percentOf(subtotal, props.prices.group_discount_percent) : 0;
    const discountShares = allocate(discount, lines.map((line) => line.listCents));
    const voucher =
      draft.appliedVoucher === null ? 0 : Math.min(voucherBalance, subtotal - discount);
    const voucherShares = allocate(
      voucher,
      lines.map((line, index) => line.listCents - (discountShares[index] as number)),
    );
    const detailed = lines.map((line, index) => {
      const discountShare = discountShares[index] as number;
      const voucherShare = voucherShares[index] as number;
      return {
        ...line,
        discountCents: discountShare,
        voucherCents: voucherShare,
        chargedCents: line.listCents - discountShare - voucherShare,
      };
    });
    return { lines: detailed, subtotal, discount, voucher, total: subtotal - discount - voucher };
  }, [
    seatLines,
    passLines,
    isGroup,
    draft.attendeeNames,
    draft.appliedVoucher,
    voucherBalance,
    props.prices.group_discount_percent,
    user?.name,
  ]);

  const goToStep = (step: CheckoutStep): void => {
    route.setQuery({ checkout: step });
  };

  const applyVoucher = async (): Promise<void> => {
    const code = draft.voucherCode.trim();
    setFieldErrors({});
    if (code.length === 0) {
      setFieldErrors({ voucher_code: "We don't recognise this voucher code." });
      setProblem("We don't recognise this voucher code.");
      return;
    }
    try {
      const body = await request<{ code: string; balance_cents: number }>(
        `/api/vouchers/${encodeURIComponent(code)}`,
      );
      if (body.balance_cents <= 0) {
        setFieldErrors({ voucher_code: 'This voucher has no balance left.' });
        setProblem('This voucher has no balance left.');
        setDraft((current) => ({ ...current, appliedVoucher: null }));
        return;
      }
      setVoucherBalance(body.balance_cents);
      setDraft((current) => ({ ...current, appliedVoucher: body.code }));
      setProblem('');
      setStatus(`Voucher applied: ${formatEuros(body.balance_cents)} available.`);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setFieldErrors({ voucher_code: "We don't recognise this voucher code." });
      setProblem("We don't recognise this voucher code.");
      setDraft((current) => ({ ...current, appliedVoucher: null }));
    }
  };

  const releaseSeat = async (hold: Hold): Promise<void> => {
    try {
      await request(`/api/holds/${hold.id}`, { method: 'DELETE' });
    } finally {
      await loadHolds();
    }
  };

  const pay = async (): Promise<void> => {
    setPaying(true);
    setProblem('');
    setFieldErrors({});
    setStatus('Processing payment…');
    const passes: Array<{ product: 'full_festival' | 'day'; festival_day?: string }> = [];
    for (let index = 0; index < draft.fullFestival; index += 1) passes.push({ product: 'full_festival' });
    for (const day of props.days) {
      const count = draft.dayPasses[day.date] ?? 0;
      for (let index = 0; index < count; index += 1) {
        passes.push({ product: 'day', festival_day: day.date });
      }
    }
    try {
      const order = await request<Order>('/api/checkout', {
        method: 'POST',
        headers: { 'idempotency-key': draft.idempotencyKey },
        body: {
          hold_ids: holds.map((hold) => hold.id),
          passes,
          rate: isGroup ? 'full' : draft.rate,
          voucher_code: draft.appliedVoucher,
          attendee_names: isGroup ? preview.lines.map((line) => line.holder) : null,
        },
      });
      window.sessionStorage.removeItem(DRAFT_KEY);
      props.onDone(order);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setStatus('');
      describeFailure(error, setProblem, setFieldErrors, props.sessions);
    } finally {
      setPaying(false);
    }
  };

  if (!props.open) return null;

  const stepIndex = STEP_ORDER.indexOf(props.step);

  return (
    <Dialog
      label="Checkout"
      openerRef={props.openerRef}
      onClose={props.onClose}
      closeLabel="Close checkout"
    >
      <ol className="steps" aria-label="Checkout steps">
        {STEP_ORDER.map((step) => (
          <li key={step} aria-current={step === props.step ? 'step' : undefined}>
            {STEP_LABELS[step]}
          </li>
        ))}
      </ol>

      {props.step === 'tickets' ? (
        <section className="checkout-step">
          <ul className="held-seats">
            {holds.flatMap((hold) => {
              const session = props.sessions.find((candidate) => candidate.id === hold.session_id);
              return Array.from({ length: hold.quantity }, (_unused, seat) => (
                <li key={`${hold.id}-${seat}`}>
                  <span className="held-title">{session?.title ?? 'Seat'}</span>
                  <span className="figures">{`Held until ${formatTime(hold.expires_at)}`}</span>
                  <button type="button" onClick={() => void releaseSeat(hold)}>
                    {`Release seat for ${session?.title ?? 'this session'}`}
                  </button>
                </li>
              ));
            })}
            {holds.length === 0 ? <li className="muted">No seats held.</li> : null}
          </ul>

          <div className="pass-counts">
            <label>
              Full-festival passes
              <input
                type="number"
                min={0}
                max={10}
                value={draft.fullFestival}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    fullFestival: Math.max(0, Number(event.target.value) || 0),
                  }))
                }
              />
            </label>
            {props.days.map((day) => (
              <label key={day.date}>
                {`Day passes for ${day.label}`}
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={draft.dayPasses[day.date] ?? 0}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      dayPasses: {
                        ...current.dayPasses,
                        [day.date]: Math.max(0, Number(event.target.value) || 0),
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>

          <div className="dialog-actions">
            <button type="button" className="primary" onClick={() => goToStep('details')}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {props.step === 'details' ? (
        <section className="checkout-step">
          {isGroup ? null : (
            <fieldset role="radiogroup" aria-label="Rate">
              <legend>Rate</legend>
              <label>
                <input
                  type="radio"
                  name="rate"
                  checked={draft.rate === 'full'}
                  onChange={() => setDraft((current) => ({ ...current, rate: 'full' }))}
                />
                Full rate
              </label>
              <label>
                <input
                  type="radio"
                  name="rate"
                  checked={draft.rate === 'reduced'}
                  onChange={() => setDraft((current) => ({ ...current, rate: 'reduced' }))}
                />
                Reduced rate (student or jobseeker)
              </label>
            </fieldset>
          )}

          <div className="field">
            <label htmlFor="voucher-code">Gift voucher code</label>
            <input
              id="voucher-code"
              type="text"
              value={draft.voucherCode}
              aria-describedby={fieldErrors['voucher_code'] !== undefined ? 'voucher-error' : undefined}
              onChange={(event) =>
                setDraft((current) => ({ ...current, voucherCode: event.target.value }))
              }
            />
            {fieldErrors['voucher_code'] !== undefined ? (
              <p className="field-error" id="voucher-error">
                {fieldErrors['voucher_code']}
              </p>
            ) : null}
            <button type="button" onClick={() => void applyVoucher()}>
              Apply voucher
            </button>
          </div>

          {isGroup
            ? preview.lines.map((line, index) => (
                <div className="field" key={line.key}>
                  <label htmlFor={`attendee-${index}`}>{`Attendee ${index + 1} name`}</label>
                  <input
                    id={`attendee-${index}`}
                    type="text"
                    value={draft.attendeeNames[index] ?? ''}
                    aria-describedby={
                      fieldErrors['attendee_names'] !== undefined ? 'attendee-error' : undefined
                    }
                    onChange={(event) =>
                      setDraft((current) => {
                        const names = [...current.attendeeNames];
                        names[index] = event.target.value;
                        return { ...current, attendeeNames: names };
                      })
                    }
                  />
                </div>
              ))
            : null}
          {fieldErrors['attendee_names'] !== undefined ? (
            <p className="field-error" id="attendee-error">
              {fieldErrors['attendee_names']}
            </p>
          ) : null}
          {fieldErrors['items'] !== undefined ? <p className="field-error">{fieldErrors['items']}</p> : null}

          <div className="dialog-actions">
            <button type="button" onClick={() => goToStep('tickets')}>
              Back
            </button>
            <button type="button" className="primary" onClick={() => goToStep('review')}>
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {props.step === 'review' ? (
        <section className="checkout-step">
          <table className="ruled" aria-label="Order summary">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Holder</th>
                <th scope="col">Price</th>
                <th scope="col">Group discount</th>
                <th scope="col">Voucher</th>
                <th scope="col">To pay</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((line) => (
                <tr key={line.key}>
                  <td>{line.title}</td>
                  <td>{line.holder}</td>
                  <td className="figures">{formatEuros(line.listCents)}</td>
                  <td className="figures">{formatEuros(line.discountCents)}</td>
                  <td className="figures">{formatEuros(line.voucherCents)}</td>
                  <td className="figures">{formatEuros(line.chargedCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={5}>
                  Total
                </th>
                <td className="figures">{formatEuros(preview.total)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="dialog-actions">
            <button type="button" onClick={() => goToStep('details')}>
              Back
            </button>
            <button type="button" className="primary" disabled={paying} onClick={() => void pay()}>
              {isGroup ? 'Place order on invoice' : `Pay ${formatEuros(preview.total)}`}
            </button>
          </div>
        </section>
      ) : null}

      <p className="muted figures">{`Step ${stepIndex + 1} of 3`}</p>
    </Dialog>
  );
}

function describeFailure(
  error: ApiError,
  setProblem: (text: string) => void,
  setFieldErrors: (fields: Record<string, string>) => void,
  sessions: readonly Session[],
): void {
  const { failure } = error;
  if (failure.status === 422) {
    const fields: Record<string, string> = {};
    for (const [field, code] of Object.entries(failure.fields)) {
      fields[field] = fieldMessage(field, code);
    }
    setFieldErrors(fields);
    setProblem(Object.values(fields)[0] ?? 'Check the details and try again.');
    return;
  }
  if (failure.code === 'payment_unavailable') {
    setProblem(
      'Payments are unavailable right now. Nothing was charged and your seats stay held. Try again in a moment.',
    );
    return;
  }
  if (failure.code === 'storage_unavailable') {
    setProblem("We couldn't issue your passes right now. Nothing was charged. Try again in a moment.");
    return;
  }
  if (failure.code === 'session_cancelled') {
    const cancelled = sessions.find((session) => session.status === 'cancelled');
    setProblem(`${cancelled?.title ?? 'That session'} was cancelled. Remove it to continue.`);
    return;
  }
  if (failure.code === 'hold_expired') {
    setProblem('Your hold expired and the seat was released.');
    return;
  }
  setProblem('Something went wrong. Try again in a moment.');
}

function fieldMessage(field: string, code: string): string {
  if (field === 'voucher_code' && code === 'unknown') return "We don't recognise this voucher code.";
  if (field === 'voucher_code' && code === 'empty') return 'This voucher has no balance left.';
  if (field === 'items' && code === 'group_minimum') return 'Group bookings need at least 5 tickets.';
  if (field === 'items' && code === 'empty') return 'Add a seat or a pass before you continue.';
  if (field === 'attendee_names') return 'Enter a name for every attendee.';
  if (field === 'rate' && code === 'not_for_groups') return 'Group orders are always at the full rate.';
  return `${field.replace(/_/g, ' ')}: ${code.replace(/_/g, ' ')}`;
}

export function checkoutStepFromQuery(value: string | null): CheckoutStep | null {
  return value === 'tickets' || value === 'details' || value === 'review' ? value : null;
}
