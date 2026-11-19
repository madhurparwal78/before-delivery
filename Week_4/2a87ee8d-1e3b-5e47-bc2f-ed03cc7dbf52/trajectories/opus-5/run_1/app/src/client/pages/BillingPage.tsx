import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, newOperationId, reasonOf } from '../lib/api.js';
import { useRouter } from '../lib/router.js';
import { displayAmount, displayDateOnly, displayTime, displayDate } from '../lib/format.js';
import { Meter } from '../components/Common.js';
import { BillingBanner } from '../components/Billing.js';
import {
  PLAN_LABELS,
  TERM_LABELS,
  type Billing,
  type BillingInvoice,
  type BillingTerm,
  type Facilitator,
  type PlanCode,
} from '../../shared/protocol.js';

const PLANS: readonly PlanCode[] = ['free', 'studio', 'agency'];
const TERMS: readonly BillingTerm[] = ['monthly', 'annual'];

export function BillingPage(): JSX.Element {
  const { navigate } = useRouter();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [facilitator, setFacilitator] = useState<Facilitator | null>(null);
  const [plan, setPlan] = useState<PlanCode>('free');
  const [term, setTerm] = useState<BillingTerm>('monthly');
  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState('');
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [bill, session] = await Promise.all([
        api<Billing>('GET', '/api/billing'),
        api<{ facilitator: Facilitator }>('GET', '/api/session'),
      ]);
      setBilling(bill);
      setFacilitator(session.facilitator);
      setPlan(bill.plan);
      setTerm(bill.term);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) navigate('/signin');
    }
  }, [navigate]);

  // The billing page refreshes its billing data on load and after every billing action.
  useEffect(() => {
    void load();
  }, [load]);

  if (!billing || !facilitator) {
    return (
      <main className="column">
        <h1>Plan and billing</h1>
      </main>
    );
  }

  const unchanged = plan === billing.plan && term === billing.term;
  const canChange = !unchanged || billing.pendingChange !== null;

  async function changePlan(): Promise<void> {
    setPending(true);
    setStatus('');
    setProblem('');
    try {
      const result = await api<{ billing: Billing; invoice: BillingInvoice | null }>(
        'POST',
        '/api/billing/plan',
        { clientOpId: newOperationId(), plan, term },
      );
      setBilling(result.billing);
      setStatus(changeMessage(result.billing, result.invoice, plan, term));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'billing_unavailable') {
        setProblem("Billing is unavailable. Your plan hasn't changed — try again shortly.");
      } else {
        setProblem(reasonOf(error));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="column billing-page">
      <BillingBanner billing={billing} onChanged={setBilling} />
      <h1>Plan and billing</h1>

      <p className="current-plan">
        {PLAN_LABELS[billing.plan]} ({TERM_LABELS[billing.term]}) — renews on{' '}
        {billing.renewsOn === null ? '—' : displayDateOnly(billing.renewsOn)}
      </p>
      {billing.stale && billing.syncedAt !== null && (
        <p className="muted">
          Showing your plan as of {displayDate(Date.parse(billing.syncedAt), facilitator.timeZone)},{' '}
          {displayTime(Date.parse(billing.syncedAt), facilitator.timeZone)} — billing is unavailable.
        </p>
      )}
      {billing.pendingChange && (
        <p className="pending-change">
          Changes on {displayDateOnly(billing.pendingChange.effectiveDate)} to{' '}
          {PLAN_LABELS[billing.pendingChange.plan]} ({TERM_LABELS[billing.pendingChange.term]})
        </p>
      )}

      <section className="ruled">
        <fieldset role="radiogroup" aria-label="Plan">
          <span className="field-label">Plan</span>
          {PLANS.map((code) => (
            <label key={code} className="row option-row">
              <input type="radio" name="plan" checked={plan === code} onChange={() => setPlan(code)} />
              <span>{PLAN_LABELS[code]}</span>
            </label>
          ))}
        </fieldset>

        <fieldset role="radiogroup" aria-label="Billing term">
          <span className="field-label">Billing term</span>
          {TERMS.map((code) => (
            <label key={code} className="row option-row">
              <input
                type="radio"
                name="billing-term"
                checked={term === code}
                onChange={() => setTerm(code)}
              />
              <span>{TERM_LABELS[code]}</span>
            </label>
          ))}
        </fieldset>

        <button type="button" className="primary" disabled={!canChange || pending} onClick={changePlan}>
          {pending ? 'Changing…' : 'Change plan'}
        </button>
      </section>

      <div role="status" aria-live="polite" aria-label="Billing activity" className="status-line">
        {status}
      </div>
      <div role="alert" aria-live="assertive" aria-label="Billing problems" className="status-line problem">
        {problem}
      </div>

      <section className="ruled">
        <h2>Usage</h2>
        <ul className="rule-list" aria-label="Usage">
          <Meter
            label="Active workshops"
            used={billing.usage.activeWorkshops}
            cap={billing.entitlements.activeWorkshops}
          />
          <Meter
            label="Invites today"
            used={billing.usage.invitesToday}
            cap={billing.entitlements.invitesPerDay}
          />
        </ul>
      </section>

      <section className="ruled">
        <h2>Invoices</h2>
        <ul className="rule-list" aria-label="Invoices">
          {billing.invoices.map((invoice) => (
            <li key={invoice.id} className="mono">
              {displayDateOnly(invoice.date)} — Invoice {invoice.number} — €{displayAmount(invoice.amount)} —{' '}
              {invoice.status === 'paid' ? 'Paid' : 'Unpaid'}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function changeMessage(
  billing: Billing,
  invoice: BillingInvoice | null,
  plan: PlanCode,
  term: BillingTerm,
): string {
  if (billing.pendingChange) {
    return `${PLAN_LABELS[billing.pendingChange.plan]} (${TERM_LABELS[billing.pendingChange.term]}) starts on ${displayDateOnly(billing.pendingChange.effectiveDate)}.`;
  }
  if (invoice) {
    return `Plan changed to ${PLAN_LABELS[plan]} (${TERM_LABELS[term]}). Invoice ${invoice.number} for €${displayAmount(invoice.amount)}.`;
  }
  if (billing.plan === plan && billing.term === term) {
    return `Plan changed to ${PLAN_LABELS[plan]} (${TERM_LABELS[term]}).`;
  }
  return `Scheduled change cancelled. You stay on ${PLAN_LABELS[billing.plan]} (${TERM_LABELS[billing.term]}).`;
}
