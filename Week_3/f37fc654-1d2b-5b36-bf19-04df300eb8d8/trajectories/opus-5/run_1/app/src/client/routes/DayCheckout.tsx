import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiFailure, api } from '../lib/api.js';
import { useAppEvent, useStageScene, useToasts } from '../lib/app-context.js';
import { useReducedMotion } from '../lib/typing.js';
import { Dialog, Problems, RollingAmount } from '../components/ui.js';
import type { CommissionShape, HoldShape, VenueDayShape } from '../lib/shapes.js';
import { formatAmount, formatSharePercent } from '../../shared/money.js';
import * as copy from '../../shared/copy.js';
import {
  addDays,
  daysInMonth,
  formatMonthYear,
  formatVenueDate,
  isoDate,
  weekdayOf,
} from '../../shared/venue-time.js';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The countdown starts from the server's remaining seconds and counts down by
 * elapsed time on the page. It re-syncs with the server every 30 seconds and
 * whenever the page regains focus, and never reads the device clock.
 */
function useHoldCountdown(commissionId: string): {
  hold: HoldShape | null;
  secondsLeft: number;
  resync: () => void;
} {
  const [hold, setHold] = useState<HoldShape | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const baseline = useRef<{ seconds: number; at: number } | null>(null);

  const resync = useCallback(() => {
    void api
      .get<HoldShape>(`/api/commissions/${commissionId}/hold`)
      .then((fresh) => {
        setHold(fresh);
        baseline.current = { seconds: fresh.secondsRemaining, at: performance.now() };
        setSecondsLeft(fresh.secondsRemaining);
      })
      .catch(() => {
        setHold(null);
        baseline.current = null;
        setSecondsLeft(0);
      });
  }, [commissionId]);

  useEffect(resync, [resync]);

  useEffect(() => {
    const tick = setInterval(() => {
      const base = baseline.current;
      if (!base) return;
      const elapsed = (performance.now() - base.at) / 1000;
      const left = Math.max(0, Math.round(base.seconds - elapsed));
      setSecondsLeft(left);
      // At zero the browser asks the server what became of the hold.
      if (left === 0 && base.seconds > 0) {
        baseline.current = null;
        resync();
      }
    }, 500);
    const sync = setInterval(resync, 30_000);
    const onFocus = (): void => resync();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(tick);
      clearInterval(sync);
      window.removeEventListener('focus', onFocus);
    };
  }, [resync]);

  return { hold, secondsLeft, resync };
}

function countdownText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return `${minutes}:${rest} left`;
}

export function InstallDay(): JSX.Element {
  const { commissionId = '' } = useParams();
  const [commission, setCommission] = useState<CommissionShape | null>(null);
  const [days, setDays] = useState<VenueDayShape[]>([]);
  const [month, setMonth] = useState<{ year: number; month: number } | null>(null);
  const [status, setStatus] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const { hold, secondsLeft, resync } = useHoldCountdown(commissionId);

  useStageScene({
    scene: 'working',
    silhouette: commission?.installationType ?? 'none',
    roomWidthM: commission?.room.widthM ?? null,
    roomDepthM: commission?.room.depthM ?? null,
  });

  useEffect(() => {
    void api
      .get<CommissionShape>(`/api/commissions/${commissionId}`)
      .then((loaded) => {
        setCommission(loaded);
        if (!month) {
          const start = addDays(loaded.createdAt.slice(0, 10), 21);
          setMonth({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) });
        }
      })
      .catch(() => undefined);
    // The calendar opens on the first bookable month and then follows the user.
  }, [commissionId]);

  const loadDays = useCallback(() => {
    if (!commission || !month) return;
    const total = daysInMonth(month.year, month.month);
    const from = isoDate(month.year, month.month, 1);
    const to = isoDate(month.year, month.month, total);
    void api
      .get<{ days: VenueDayShape[] }>(
        `/api/venues/${commission.venue.id}/days?from=${from}&to=${to}&commissionId=${commissionId}`,
      )
      .then((result) => setDays(result.days))
      .catch(() => undefined);
  }, [commission, commissionId, month]);

  useEffect(loadDays, [loadDays]);
  useAppEvent('hold.updated', () => {
    loadDays();
    resync();
  });

  const holdDay = async (date: string): Promise<void> => {
    try {
      const placed = await api.post<HoldShape>(`/api/commissions/${commissionId}/hold`, { date });
      setStatus(copy.holdPlaced(formatVenueDate(placed.date)));
      resync();
      loadDays();
    } catch (error) {
      if (error instanceof ApiFailure) {
        const free = error.extra<string[]>('nextFreeDays') ?? [];
        setStatus(
          error.code === 'day_taken'
            ? copy.dayTaken(free.map(formatVenueDate))
            : (Object.values(error.fieldErrors)[0] ?? error.publicMessage ?? ''),
        );
        loadDays();
      }
    }
  };

  const release = async (): Promise<void> => {
    await api.del(`/api/commissions/${commissionId}/hold`).catch(() => undefined);
    resync();
    loadDays();
  };

  if (!commission || !month) return <main className="column" />;
  const leading = weekdayOf(isoDate(month.year, month.month, 1));

  return (
    <main className="column">
      <h1>Install day</h1>
      <p className="muted">{commission.venue.name} · {commission.venue.timeZone}</p>

      <div className="inline">
        <button
          type="button"
          onClick={() =>
            setMonth((current) =>
              current === null
                ? current
                : current.month === 1
                  ? { year: current.year - 1, month: 12 }
                  : { year: current.year, month: current.month - 1 },
            )
          }
        >
          Previous month
        </button>
        <button
          type="button"
          onClick={() =>
            setMonth((current) =>
              current === null
                ? current
                : current.month === 12
                  ? { year: current.year + 1, month: 1 }
                  : { year: current.year, month: current.month + 1 },
            )
          }
        >
          Next month
        </button>
      </div>

      <div className="weekday-head" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div role="grid" aria-label={formatMonthYear(month.year, month.month)} className="calendar">
        {Array.from({ length: leading }, (_, index) => (
          <span key={`pad-${index}`} />
        ))}
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            role="gridcell"
            className="day"
            data-status={day.status}
            aria-label={`${formatVenueDate(day.date)}, ${
              day.status === 'yours' ? 'your hold' : day.status
            }`}
            disabled={day.status !== 'free' && day.status !== 'yours'}
            onClick={() => setChosen(day.date)}
            aria-pressed={chosen === day.date}
          >
            {Number(day.date.slice(8, 10))}
          </button>
        ))}
      </div>

      <div className="inline">
        {chosen ? (
          <button type="button" className="primary" onClick={() => void holdDay(chosen)}>
            Hold {formatVenueDate(chosen)}
          </button>
        ) : null}
        {hold?.status === 'held' ? (
          <>
            <button type="button" onClick={() => void release()}>
              Release hold
            </button>
            <span role="timer" aria-label="Hold time left" className="numeral">
              {countdownText(secondsLeft)}
            </span>
          </>
        ) : null}
      </div>

      <div role="status" aria-label="Hold status" aria-live="polite" className="muted">
        {status}
      </div>
    </main>
  );
}

export function Checkout(): JSX.Element {
  const { commissionId = '' } = useParams();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const { notify } = useToasts();
  const [commission, setCommission] = useState<CommissionShape | null>(null);
  const [signatureName, setSignatureName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [signed, setSigned] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('');
  const [holdStatus, setHoldStatus] = useState('');
  const [nameOnCard, setNameOnCard] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [paying, setPaying] = useState(false);
  const attemptKey = useRef<string | null>(null);
  const { hold, secondsLeft, resync } = useHoldCountdown(commissionId);

  useStageScene({
    scene: 'working',
    silhouette: commission?.installationType ?? 'none',
    roomWidthM: commission?.room.widthM ?? null,
    roomDepthM: commission?.room.depthM ?? null,
  });

  const load = useCallback(() => {
    void api
      .get<CommissionShape>(`/api/commissions/${commissionId}`)
      .then((loaded) => {
        setCommission(loaded);
        setSigned(loaded.milestones.some((m) => m.milestoneKey === 'deposit' && m.invoicedAt));
      })
      .catch(() => undefined);
  }, [commissionId]);
  useEffect(load, [load]);
  useAppEvent('commission.updated', load);

  // When the hold ends mid-checkout the state appears in place; the open sheet
  // and everything typed into it stay as they are.
  useEffect(() => {
    if (hold && hold.status === 'expired') {
      setHoldStatus(copy.holdEnded(formatVenueDate(hold.date)));
    } else if (hold?.status === 'held') {
      setHoldStatus('');
    }
  }, [hold]);

  const deposit = commission?.milestones.find((m) => m.milestoneKey === 'deposit') ?? null;

  const sign = async (): Promise<void> => {
    setErrors({});
    try {
      await api.post(`/api/commissions/${commissionId}/sign`, {
        signatureName,
        acceptTerms: accepted,
      });
      notify(copy.AGREEMENT_SIGNED);
      setSigned(true);
      load();
    } catch (error) {
      if (error instanceof ApiFailure) {
        if (error.code === 'quote_expired') notify(copy.QUOTE_EXPIRED);
        else if (error.code === 'hold_expired') setHoldStatus(copy.holdEnded(hold?.date ?? ''));
        else setErrors(error.fieldErrors);
      }
    }
  };

  const pay = async (): Promise<void> => {
    if (!deposit) return;
    setPaying(true);
    setPaymentStatus(copy.PAYMENT_PENDING);
    // Each press after a failure creates a new attempt; a double tap reuses it.
    if (!attemptKey.current) attemptKey.current = crypto.randomUUID();
    try {
      const result = await api.post<{ amountCents: number }>(
        `/api/milestones/${deposit.id}/payments`,
        { nameOnCard, cardNumber },
        { 'idempotency-key': attemptKey.current },
      );
      setPaymentStatus(copy.paymentPaid(formatAmount(result.amountCents)));
      attemptKey.current = null;
      load();
      resync();
    } catch (error) {
      if (error instanceof ApiFailure) {
        if (error.code === 'already_paid') setPaymentStatus(copy.ALREADY_PAID);
        else if (error.code === 'idempotency_conflict') setPaymentStatus(copy.PAYMENT_KEY_REUSED);
        else if (error.code === 'hold_expired') {
          setPaymentStatus(copy.holdEnded(formatVenueDate(hold?.date ?? '')));
          setHoldStatus(copy.holdEnded(formatVenueDate(hold?.date ?? '')));
        } else if (error.code === 'quote_expired') setPaymentStatus(copy.QUOTE_EXPIRED);
        else {
          setPaymentStatus(
            error.publicMessage ??
              Object.values(error.fieldErrors)[0] ??
              copy.PAYMENT_FAILED,
          );
        }
        // A fresh attempt is named next time.
        attemptKey.current = null;
      }
    } finally {
      setPaying(false);
    }
  };

  if (!commission) return <main className="column" />;
  const quote = commission.quote;
  const holdEnded = hold !== null && hold.status === 'expired';

  return (
    <main className="column">
      <h1>Checkout</h1>

      {quote ? (
        <section className="panel">
          <h2>Review</h2>
          <ul className="list">
            {quote.lines.map((line) => (
              <li className="spread" key={line.label}>
                <span>{line.label}</span>
                <span className="amount">{formatAmount(line.amountCents)}</span>
              </li>
            ))}
          </ul>
          <p className="spread">
            <strong>Total</strong>
            <strong>
              <RollingAmount amount={formatAmount(quote.totalCents)} reducedMotion={reducedMotion} />
            </strong>
          </p>
          <h3>Payment schedule</h3>
          <ul className="list">
            {commission.milestones.map((milestone) => (
              <li className="spread" key={milestone.id}>
                <span>{milestone.label}</span>
                <span className="amount">{formatAmount(milestone.amountCents)}</span>
              </li>
            ))}
          </ul>
          <h3>Funders</h3>
          <ul className="list">
            {commission.funders.map((funder) => (
              <li className="spread" key={funder.id}>
                <span>{funder.name}</span>
                <span className="amount">
                  {formatSharePercent(funder.bp)}% · {formatAmount(funder.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {holdEnded ? (
        <section className="panel">
          <h2>{copy.HOLD_ENDED_HEADING}</h2>
          <button
            type="button"
            className="primary"
            onClick={() => {
              void api
                .post(`/api/commissions/${commissionId}/hold`, { date: hold?.date })
                .then(() => {
                  setHoldStatus('');
                  resync();
                })
                .catch(() => undefined);
            }}
          >
            Hold {formatVenueDate(hold?.date ?? '')} again
          </button>
        </section>
      ) : null}

      {!signed ? (
        <section className="panel">
          <Problems errors={errors} />
          <div>
            <label htmlFor="field-signatureName">Full name as signature</label>
            <input
              id="field-signatureName"
              className="answer-field"
              aria-label="Full name as signature"
              value={signatureName}
              onChange={(event) => setSignatureName(event.target.value)}
            />
          </div>
          <button
            type="button"
            role="checkbox"
            aria-checked={accepted}
            className="chip"
            id="field-acceptTerms"
            onClick={() => setAccepted((value) => !value)}
          >
            <span className="box" aria-hidden="true">
              {accepted ? '✓' : ''}
            </span>
            <span className="label">I agree to the commission agreement</span>
          </button>
          <button type="button" className="primary" onClick={() => void sign()}>
            Sign agreement
          </button>
        </section>
      ) : null}

      <div className="inline">
        {hold?.status === 'held' ? (
          <span role="timer" aria-label="Hold time left" className="numeral">
            {countdownText(secondsLeft)}
          </span>
        ) : null}
        {signed && deposit ? (
          <button type="button" className="primary" onClick={() => setSheetOpen(true)}>
            Pay deposit {formatAmount(deposit.amountCents)}
          </button>
        ) : null}
      </div>

      <div role="status" aria-label="Hold status" aria-live="polite" className="muted">
        {holdStatus}
      </div>

      {sheetOpen && deposit ? (
        <Dialog
          title="Payment"
          closeLabel="Cancel"
          variant="bottom"
          onClose={() => setSheetOpen(false)}
        >
          <p className="muted">{copy.PAYMENT_TEST_MODE_NOTE}</p>
          <div>
            <label htmlFor="field-nameOnCard">Name on card</label>
            <input
              id="field-nameOnCard"
              className="answer-field"
              aria-label="Name on card"
              value={nameOnCard}
              onChange={(event) => setNameOnCard(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="field-cardNumber">Card number</label>
            <input
              id="field-cardNumber"
              className="answer-field"
              aria-label="Card number"
              inputMode="numeric"
              value={cardNumber}
              onChange={(event) => setCardNumber(event.target.value)}
            />
          </div>
          <div className="inline">
            <button
              type="button"
              className="primary"
              disabled={paying}
              onClick={() => void pay()}
            >
              Pay {formatAmount(deposit.amountCents)}
            </button>
            <button type="button" onClick={() => setSheetOpen(false)}>
              Cancel
            </button>
          </div>
          <div role="status" aria-label="Payment status" aria-live="polite" className="muted">
            {paymentStatus}
          </div>
        </Dialog>
      ) : null}

      <button type="button" onClick={() => navigate(`/c/${commissionId}`)}>
        Back to commission
      </button>
    </main>
  );
}
