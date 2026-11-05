import { useState, type ReactNode } from 'react';
import { formatDollars } from '../shared/money.js';
import {
  CHECKING_HOLD,
  DEPOSITS_CLOSED_LINE,
  PROCESSING_PAYMENT,
  groupConfirmationHeading,
} from '../shared/copy.js';
import { PRICES } from '../shared/prices.js';
import { Dialog, Field } from './ui.js';
import { useLab } from './store.js';

export const HOLD_HEADING_ID = 'hold-panel-heading';

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${(whole % 60).toString().padStart(2, '0')}`;
}

function BenchHeading({
  bench,
  kinetic,
}: {
  readonly bench: string;
  readonly kinetic: boolean;
}): ReactNode {
  const full = `Bench ${bench}`;
  return (
    <h3 className="hold-heading" id={HOLD_HEADING_ID} tabIndex={-1} aria-label={full}>
      {kinetic ? (
        <>
          <span aria-hidden="true">Bench&nbsp;</span>
          {[...bench].map((character, index) => (
            <span
              key={`${character}-${index}`}
              data-letter={character}
              aria-hidden="true"
              className="letter num"
              style={{ animationDelay: `${index * 70}ms` }}
            >
              {character}
            </span>
          ))}
        </>
      ) : (
        full
      )}
    </h3>
  );
}

export function CheckoutDialog({
  kind,
  onClose,
}: {
  readonly kind: 'deposit' | 'full';
  readonly onClose: () => void;
}): ReactNode {
  const lab = useLab();
  const [held] = useState(() => lab.holdReservations[0]);
  const [billingName, setBillingName] = useState(lab.me?.account.name ?? '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (held === undefined) return null;
  const amount =
    kind === 'deposit' ? PRICES[held.tier].depositCents : held.price_cents - held.paid_cents;
  const confirmed = lab.notice.kind === 'confirmed' ? lab.notice.heading : null;

  return (
    <Dialog
      name="Checkout"
      onClose={onClose}
      restoreFocusTo={done ? () => document.getElementById(HOLD_HEADING_ID) : undefined}
    >
      {done && confirmed !== null ? (
        <>
          <h2>{confirmed}</h2>
          <p>{lab.notice.text}</p>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </>
      ) : (
        <>
          <h2>Checkout</h2>
          <p className="checkout-bench num">
            Bench {held.bench} — ${formatDollars(amount)}
          </p>
          {lab.billingOffline ? (
            <p role="alert" className="banner">
              {lab.notice.text}
            </p>
          ) : null}
          <Field
            label="Name for the receipt"
            value={billingName}
            onChange={setBillingName}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void lab.pay(kind, billingName).then((ok) => {
                setBusy(false);
                if (ok) setDone(true);
              });
            }}
          >
            {busy
              ? PROCESSING_PAYMENT
              : kind === 'deposit'
                ? `Pay deposit $${formatDollars(amount)}`
                : `Pay in full $${formatDollars(amount)}`}
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </>
      )}
    </Dialog>
  );
}

export function GroupCheckoutDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  const lab = useLab();
  const [seats] = useState(() => lab.holdReservations);
  const [billingName, setBillingName] = useState(lab.me?.account.name ?? '');
  const [names, setNames] = useState<Record<string, string>>({});
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const total = seats.reduce((sum, seat) => sum + seat.price_cents, 0);

  return (
    <Dialog
      name="Group checkout"
      onClose={onClose}
      restoreFocusTo={done ? () => document.getElementById(HOLD_HEADING_ID) : undefined}
    >
      {done ? (
        <>
          <h2>{groupConfirmationHeading(seats.length)}</h2>
          <p>{lab.notice.text}</p>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </>
      ) : (
        <>
          <h2>Group checkout</h2>
          {lab.billingOffline ? (
            <p role="alert" className="banner">
              {lab.notice.text}
            </p>
          ) : null}
          {seats.map((seat) => (
            <fieldset key={seat.id}>
              <legend className="num">Bench {seat.bench}</legend>
              <Field
                label={`Colleague name for Bench ${seat.bench}`}
                value={names[seat.bench] ?? ''}
                onChange={(value) => setNames((current) => ({ ...current, [seat.bench]: value }))}
              />
              <Field
                label={`Colleague email for Bench ${seat.bench}`}
                value={emails[seat.bench] ?? ''}
                onChange={(value) => setEmails((current) => ({ ...current, [seat.bench]: value }))}
              />
            </fieldset>
          ))}
          <Field label="Name for the receipt" value={billingName} onChange={setBillingName} />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              const assignments = seats
                .filter(
                  (seat) =>
                    (names[seat.bench] ?? '').trim() !== '' &&
                    (emails[seat.bench] ?? '').trim() !== '',
                )
                .map((seat) => ({
                  bench: seat.bench,
                  name: (names[seat.bench] ?? '').trim(),
                  email: (emails[seat.bench] ?? '').trim(),
                }));
              void lab.payGroup(billingName, assignments).then((ok) => {
                setBusy(false);
                if (ok) setDone(true);
              });
            }}
          >
            {busy ? PROCESSING_PAYMENT : `Pay group invoice $${formatDollars(total)}`}
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </>
      )}
    </Dialog>
  );
}

export function HoldPanel({
  kinetic,
  compact,
}: {
  readonly kinetic: boolean;
  readonly compact?: boolean;
}): ReactNode {
  const lab = useLab();
  const [checkout, setCheckout] = useState<'deposit' | 'full' | 'group' | null>(null);
  const held = lab.holdReservations;
  const first = held[0];
  const depositsOpen = lab.benches?.deposits_open ?? true;
  const isClinic = lab.me?.account.role === 'clinic';
  const confirmed = lab.notice.kind === 'confirmed';

  return (
    <section className={compact === true ? 'hold-panel hold-panel-compact' : 'hold-panel'} aria-label="Your hold">
      {lab.pendingBenches !== null ? (
        <p className="hold-pending">{lab.notice.text}</p>
      ) : confirmed ? (
        <>
          <h3 className="hold-heading" id={HOLD_HEADING_ID} tabIndex={-1}>
            {lab.notice.heading}
          </h3>
          <p>{lab.notice.text}</p>
        </>
      ) : first !== undefined ? (
        <>
          <BenchHeading bench={first.bench} kinetic={kinetic} />
          {held.length > 1 ? (
            <p className="num">
              {held.map((seat) => seat.bench).join(', ')}
            </p>
          ) : null}
          {lab.holdExpiredLocally ? (
            <p className="hold-checking">{CHECKING_HOLD}</p>
          ) : (
            <p
              role="timer"
              aria-label="Hold time remaining"
              className="hold-timer num"
              aria-live="off"
            >
              {clock(lab.holdSecondsRemaining)}
            </p>
          )}
          {lab.notice.kind === 'pending' || lab.notice.kind === 'billing' ? (
            <p className={lab.notice.kind === 'billing' ? 'banner' : 'hold-note'} role={lab.notice.kind === 'billing' ? 'alert' : undefined}>
              {lab.notice.text}
            </p>
          ) : null}
          {isClinic && first.group_id !== null ? (
            <button type="button" onClick={() => setCheckout('group')}>
              Pay group invoice
            </button>
          ) : (
            <>
              {depositsOpen ? (
                <button type="button" onClick={() => setCheckout('deposit')}>
                  Pay deposit
                </button>
              ) : (
                <p className="deposits-closed">{DEPOSITS_CLOSED_LINE}</p>
              )}
              <button type="button" onClick={() => setCheckout('full')}>
                Pay in full
              </button>
            </>
          )}
          <button type="button" onClick={() => void lab.releaseHold()}>
            Release bench
          </button>
        </>
      ) : isClinic && lab.selection.length > 0 ? (
        <>
          <h3 className="hold-heading" id={HOLD_HEADING_ID} tabIndex={-1}>
            Selected benches
          </h3>
          <p className="num">{lab.selection.join(', ')}</p>
          <button type="button" onClick={() => void lab.holdBenches(lab.selection)}>
            Hold {lab.selection.length} benches
          </button>
        </>
      ) : (
        <>
          <h3 className="hold-heading" id={HOLD_HEADING_ID} tabIndex={-1}>
            No bench held
          </h3>
          {compact === true ? null : (
            <p>Pick an open bench on the map to hold it on server time.</p>
          )}
        </>
      )}
      {checkout === 'group' ? (
        <GroupCheckoutDialog onClose={() => setCheckout(null)} />
      ) : checkout !== null ? (
        <CheckoutDialog kind={checkout} onClose={() => setCheckout(null)} />
      ) : null}
    </section>
  );
}
