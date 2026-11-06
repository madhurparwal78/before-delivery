import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { COPY, planChangePendingStatus, planChanged, pastDueBillingStatus } from '../../shared/copy.js';
import { PLANS, PLAN_IDS, type PlanId } from '../../shared/domain.js';
import type { BillingObject } from '../../shared/types.js';
import { ApiFailure, get, postFull } from '../api.js';
import { useInterval } from '../ui.js';

/**
 * The Billing status region holds the outage message, the status word, the
 * plan, the balance due and the status message, each in its own block.
 */
function BillingStatusRegion({
  billing,
  message,
}: {
  billing: BillingObject | null;
  message: string;
}): ReactNode {
  const outage = billing !== null && !billing.provider_reachable;
  return (
    <div role="status" aria-label="Billing status" aria-live="polite">
      {outage ? <p>{COPY.billingOutage}</p> : null}
      {billing !== null ? (
        <>
          <p className="status-word">{billing.status_word}</p>
          <p>{`Plan: ${PLANS[billing.plan].name}`}</p>
          <p className="amount">{`${billing.balance} USD due`}</p>
        </>
      ) : null}
      {!outage && message !== '' ? <p>{message}</p> : null}
    </div>
  );
}

/** The status message a fresh read shows, taken from the Billing state. */
function stateMessage(billing: BillingObject): string {
  if (!billing.provider_reachable) return '';
  if (billing.payment_pending) return COPY.billingPaymentSent;
  switch (billing.status) {
    case 'pending_approval':
      return COPY.billingWaitingConfirm;
    case 'active':
      return billing.pending_plan === null
        ? COPY.billingConfirmed
        : planChangePendingStatus(PLANS[billing.pending_plan].name);
    case 'past_due':
      return pastDueBillingStatus(billing.suspends_at_label ?? '');
    case 'suspended':
      return COPY.billingSuspended;
  }
}

export function BillingPage({ slug }: { slug: string }): ReactNode {
  const [billing, setBilling] = useState<BillingObject | null>(null);
  const [message, setMessage] = useState('');
  const [plan, setPlan] = useState<PlanId | ''>('');
  const [busy, setBusy] = useState(false);
  /* After an action the status message is that action's, until the next action
     or a reload. A background re-read updates only lines 2 to 4. */
  const pinned = useRef(false);

  const read = useCallback(
    async (fresh: boolean) => {
      try {
        const next = await get<BillingObject>(`/api/servers/${slug}/billing`);
        setBilling(next);
        setPlan((current) => (current === '' ? next.plan : current));
        if (fresh || !pinned.current) {
          setMessage(stateMessage(next));
          pinned.current = false;
        }
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'billing_unavailable') {
          setMessage('');
        }
      }
    },
    [slug],
  );

  useEffect(() => {
    pinned.current = false;
    void read(true);
  }, [read]);

  useInterval(10000, () => {
    void read(false);
  });

  const act = async (
    path: string,
    body: unknown,
    describe: (answer: BillingObject, status: number) => string,
  ): Promise<void> => {
    if (busy) return;
    setBusy(true);
    pinned.current = true;
    setMessage(COPY.billingAsking);
    try {
      const sent = await postFull<BillingObject>(path, body);
      setBilling(sent.body);
      setPlan(sent.body.pending_plan ?? sent.body.plan);
      setMessage(describe(sent.body, sent.status));
    } catch (error) {
      if (error instanceof ApiFailure) {
        setMessage(billingRefusal(error));
        if (error.code === 'billing_unavailable') {
          setBilling((current) =>
            current === null ? current : { ...current, provider_reachable: false },
          );
        } else {
          void read(false);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page split">
      <div className="stack">
        <div className="card">
          <h1>Billing</h1>
          <BillingStatusRegion billing={billing} message={message} />
        </div>
        <div className="card">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              void act(`/api/servers/${slug}/billing/payments`, {}, (answer, status) => {
                if (status === 202) return COPY.billingPaymentSent;
                if (answer.pending_plan === null && answer.plan !== billing?.plan) {
                  return planChanged(PLANS[answer.plan].name);
                }
                return Number(answer.balance) <= 0
                  ? COPY.billingConfirmed
                  : COPY.billingNotConfirmedYet;
              });
            }}
          >
            Approve payment
          </button>
        </div>
      </div>
      <div className="stack">
        <div className="card">
          <fieldset role="radiogroup" aria-label="Plan">
            <legend>Plan</legend>
            {PLAN_IDS.map((id) => (
              <label className="radio-row" key={id}>
                <input
                  type="radio"
                  name="billing-plan"
                  checked={plan === id}
                  aria-label={`${PLANS[id].name}, ${PLANS[id].price} USD a month`}
                  onChange={() => setPlan(id)}
                />
                <span>{`${PLANS[id].name}, ${PLANS[id].price} USD a month`}</span>
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (plan === '') return;
              void act(`/api/servers/${slug}/plan`, { plan }, (answer) =>
                answer.pending_plan === null
                  ? planChanged(PLANS[answer.plan].name)
                  : planChangePendingStatus(PLANS[answer.pending_plan].name),
              );
            }}
          >
            Change plan
          </button>
        </div>
        <div className="card">
          <a href={`/api/servers/${slug}/billing/statement.csv`} download>
            Download statement
          </a>
        </div>
      </div>
    </div>
  );
}

const billingRefusal = (error: ApiFailure): string => {
  switch (error.code) {
    case 'billing_unavailable':
      return COPY.billingOutage;
    case 'nothing_due':
      return COPY.billingNothingDue;
    case 'payment_pending':
      return COPY.billingPaymentPending;
    case 'same_plan':
      return COPY.billingSamePlan;
    case 'plan_change_pending':
      return COPY.billingPlanChangePending;
    case 'server_not_active':
      return COPY.billingServerNotActive;
    case 'precondition_failed':
      return COPY.staleVersion;
    default:
      return error.message;
  }
};
