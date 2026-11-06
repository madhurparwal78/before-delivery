import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { Order, Plan, Stage, User } from '../../shared/types.js';
import { ApiError, SessionEnded, newKey, post } from '../api.js';
import { Field } from '../components/Form.js';
import { Money } from '../components/Money.js';
import { useReducedMotion } from '../scene/index.js';

type Step = 'Delivery' | 'Schedule' | 'Deposit';
const STEPS: Step[] = ['Delivery', 'Schedule', 'Deposit'];

export const FIT_NOT_PROVEN = 'Fit not proven. No deposit can be taken.';
export const DONOR_UNCONFIRMED = 'Donor unconfirmed. No deposit can be taken.';

const MESSAGES: Record<string, string> = {
  fit_not_passed: FIT_NOT_PROVEN,
  donor_unconfirmed: DONOR_UNCONFIRMED,
  donor_changed: "This scooter's registration changed. Prove the fit again.",
  quote_changed: 'The inspection fee changed. Check the new total before paying.',
  payments_paused: 'Payments are paused. Nothing has been charged.',
  registry_unreachable: 'Plate registry unreachable. Your fit stays unconfirmed until it answers.',
  payment_refused: 'Deposit failed. Nothing was taken.',
  payment_in_flight: 'A payment is still pending. Try again once it settles.',
};

interface CheckoutProps {
  /** The quoted schedule, when the page has one (a kit quote); a bike shows its total only. */
  schedule: Stage[] | null;
  totalCents: number;
  vatCents: number | null;
  notices: string[];
  /** The body of POST /api/orders for the plan the rider typed. */
  createBody: (plan: Plan) => Record<string, unknown>;
  /** Why no deposit can be taken, in the published words; empty when nothing blocks it. */
  gateReason: string;
  /** Pay deposit stays focusable but does nothing while this is true. */
  blocked: boolean;
  user: User | null;
  onDone: (orderId: string) => void;
}

/** Delivery, schedule and deposit. One open checkout makes one order and one idempotency key. */
export function CheckoutDialog({ schedule, totalCents, vatCents, notices, createBody, gateReason, blocked, user, onDone }: CheckoutProps): ReactNode {
  const reduced = useReducedMotion();
  const [step, setStep] = useState<Step>('Delivery');
  const [plan, setPlan] = useState<Plan>({ name: user?.name ?? '', street: '', postcode: '', city: '' });
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const orderId = useRef<string | null>(null);
  const key = useRef<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!reduced) body.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'linear' });
  }, [step, reduced]);

  const set = (field: keyof Plan) => (value: string): void => setPlan((was) => ({ ...was, [field]: value }));
  const next = (event: FormEvent): void => {
    event.preventDefault();
    setStep(STEPS[STEPS.indexOf(step) + 1]);
  };

  const pay = async (): Promise<void> => {
    if (blocked || gateReason || busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (!orderId.current) {
        const order = await post<Order>('/api/orders', createBody(plan));
        orderId.current = order.id;
      }
      key.current ??= newKey();
      const order = await post<Order>(`/api/orders/${orderId.current}/payments`, { stage: 'deposit' }, { key: key.current });
      onDone(order.id);
    } catch (caught) {
      if (caught instanceof SessionEnded) return;
      if (caught instanceof ApiError && caught.status === 422) {
        setErrors(caught.fields);
        setStep('Delivery');
      } else if (caught instanceof ApiError) {
        setMessage(MESSAGES[caught.code] ?? 'The deposit could not be requested. Nothing was taken.');
      }
    } finally {
      setBusy(false);
    }
  };
  const deposit = schedule?.[0];
  const disabled = blocked || Boolean(gateReason) || busy;

  return (
    <div className="checkout" ref={body}>
      <h2>Checkout</h2>
      <ol className="steps" aria-label="Checkout steps">
        {STEPS.map((s) => <li key={s} aria-current={s === step ? 'step' : undefined}>{s}</li>)}
      </ol>
      {step === 'Delivery' ? (
        <form className="stack" onSubmit={next} aria-label="Delivery details">
          <Field name="name" label="Name" error={errors['name']}>{(p) => <input {...p} type="text" autoComplete="name" required value={plan.name} onChange={(e) => set('name')(e.target.value)} />}</Field>
          <Field name="street" label="Street" error={errors['street']}>{(p) => <input {...p} type="text" autoComplete="address-line1" required value={plan.street} onChange={(e) => set('street')(e.target.value)} />}</Field>
          <Field name="postcode" label="Postcode" error={errors['postcode']}>{(p) => <input {...p} type="text" autoComplete="postal-code" required value={plan.postcode} onChange={(e) => set('postcode')(e.target.value)} />}</Field>
          <Field name="city" label="City" error={errors['city']}>{(p) => <input {...p} type="text" autoComplete="address-level2" required value={plan.city} onChange={(e) => set('city')(e.target.value)} />}</Field>
          <div className="row-actions"><button type="submit" className="btn primary">Next</button></div>
        </form>
      ) : null}
      {step === 'Schedule' ? (
        <div className="stack">
          <p>Four payments cover the whole order. The deposit is taken now; each instalment falls due monthly.</p>
          {schedule ? (
            <table className="ruled-table" role="table" aria-label="Payment schedule review">
              <tbody role="rowgroup">
                {schedule.map((s) => (
                  <tr role="row" key={s.stage}>
                    <td role="cell" data-label="Stage">{s.label}</td>
                    <td role="cell" data-label="Due" className="num">{s.dueDate}</td>
                    <td role="cell" data-label="Amount"><Money cents={s.amountCents} word="quoted" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <p>Total <Money cents={totalCents} word="quoted" />{vatCents === null ? null : <> · VAT <Money cents={vatCents} word="quoted" /></>}</p>
          {notices.length ? <ul className="notices">{notices.map((n) => <li key={n}>{n}</li>)}</ul> : null}
          <div className="row-actions">
            <button type="button" className="btn" onClick={() => setStep('Delivery')}>Back</button>
            <button type="button" className="btn primary" onClick={() => setStep('Deposit')}>Next</button>
          </div>
        </div>
      ) : null}
      {step === 'Deposit' ? (
        <div className="stack">
          {deposit ? <p>Deposit <Money cents={deposit.amountCents} word="quoted" className="big" /></p> : <p>The deposit is 20 percent of the total.</p>}
          <p className="hint">It becomes paid only when Kill Bill confirms it; until then it reads pending.</p>
          {gateReason ? <p className="gate-reason" id="gate-reason">{gateReason}</p> : null}
          {message ? <p className="gate-reason" role="alert">{message}</p> : null}
          <div className="row-actions">
            <button type="button" className="btn" onClick={() => setStep('Schedule')}>Back</button>
            <button type="button" className="btn primary" aria-disabled={disabled} aria-busy={busy} aria-describedby={gateReason ? 'gate-reason' : undefined} onClick={() => { void pay(); }}>Pay deposit</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
