import { useEffect, useRef, useState } from 'react';
import { BILLING_STATE_BADGE, COPY, PLAN_LABELS } from '../copy.js';
import { RequestFailed, del, get, post, put } from '../api.js';
import { formatAmount, inZone } from '../format.js';
import { Shell } from '../components/Shell.js';
import { Dialog } from '../components/Dialog.js';
import { Banner } from '../components/Banner.js';
import type { ApiKeyRecord, Billing, Me, Plan, Webhooks } from '../api.js';

const PLANS: Plan[] = ['sandbox', 'builder', 'desk'];
const BILLING_POLL_MS = 5000;

export function BuilderScreen(props: { me: Me }): React.JSX.Element {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [chosen, setChosen] = useState<Plan>('sandbox');
  const [billingStatus, setBillingStatus] = useState('');
  const [billingOutage, setBillingOutage] = useState(false);
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [keyDialog, setKeyDialog] = useState(false);
  const [webhooks, setWebhooks] = useState<Webhooks | null>(null);
  const [endpointUrl, setEndpointUrl] = useState('');
  const [webhookStatus, setWebhookStatus] = useState('');

  const loadBilling = (): void => {
    void get<Billing>('/api/billing')
      .then((value) => {
        setBilling(value);
        setChosen(value.plan);
        setBillingOutage(value.provider === 'unavailable');
      })
      .catch(() => undefined);
  };
  const loadKeys = (): void => {
    void get<{ keys: ApiKeyRecord[] }>('/api/keys')
      .then((value) => setKeys(value.keys))
      .catch(() => undefined);
  };
  const loadWebhooks = (): void => {
    void get<Webhooks>('/api/webhooks')
      .then((value) => {
        setWebhooks(value);
        setEndpointUrl(value.endpoint?.url ?? '');
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    loadBilling();
    loadKeys();
    loadWebhooks();
    /** The badge changes only when Kill Bill reports a change. */
    const timer = setInterval(loadBilling, BILLING_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const changePlan = async (): Promise<void> => {
    setBillingStatus(COPY.planPending);
    try {
      const updated = await post<Billing>('/api/billing/plan', { plan: chosen });
      setBilling(updated);
      setBillingOutage(false);
      setBillingStatus(
        updated.pending_plan !== null && updated.pending_effective_date !== null
          ? COPY.planPendingChange(updated.pending_plan, updated.pending_effective_date)
          : COPY.planUpdated(updated.plan),
      );
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.code === 'plan_locked') setBillingStatus(COPY.planLocked);
      else if (error.code === 'billing_unavailable') {
        setBillingOutage(true);
        setBillingStatus('');
      } else setBillingStatus('');
    }
  };

  const payOutstanding = async (): Promise<void> => {
    setBillingStatus(COPY.payPending);
    try {
      setBilling(await post<Billing>('/api/billing/pay'));
      setBillingOutage(false);
      setBillingStatus(COPY.paymentReceived);
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.code === 'billing_unavailable') {
        setBillingOutage(true);
        setBillingStatus('');
      } else setBillingStatus(COPY.paymentReceived);
    }
    loadBilling();
  };

  const saveEndpoint = async (): Promise<void> => {
    setWebhookStatus(COPY.endpointPending);
    try {
      await put('/api/webhooks/endpoint', { url: endpointUrl });
      setWebhookStatus(COPY.endpointSaved);
      loadWebhooks();
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.code === 'validation') setWebhookStatus(COPY.endpointUrlError);
      else setWebhookStatus('');
      if (error.code === 'webhooks_unavailable') loadWebhooks();
    }
  };

  const revoke = async (key: ApiKeyRecord): Promise<void> => {
    await del(`/api/keys/${key.id}`);
    loadKeys();
  };

  const state = billing?.state ?? 'active';

  return (
    <Shell me={props.me} path="/builder" field="olive" stickers={['dial']}>
      <h1>Builder</h1>

      <section className="builder-grid">
        <div role="region" aria-label="Plan">
          <h2>Plan</h2>
          {state === 'payment_failed' ? <Banner>{COPY.bannerPaymentFailed}</Banner> : null}
          {state === 'downgraded' ? <Banner>{COPY.bannerDowngraded}</Banner> : null}
          {billingOutage ? <Banner>{COPY.billingUnavailable}</Banner> : null}
          <p>
            <span className="badge">{BILLING_STATE_BADGE[state]}</span>
          </p>
          <p className="label">
            Effective plan {PLAN_LABELS[billing?.effective_plan ?? 'sandbox']} ·{' '}
            {billing?.rate_per_second ?? 2} requests per second
          </p>
          {billing?.pending_plan !== null && billing?.pending_effective_date != null ? (
            <p className="label">
              {COPY.planPendingChange(billing.pending_plan as Plan, billing.pending_effective_date)}
            </p>
          ) : null}
          <div className="card">
            <fieldset>
              <legend>Builder plan</legend>
              <div className="radio-row" role="radiogroup" aria-label="Builder plan">
                {PLANS.map((plan) => (
                  <label key={plan}>
                    <input
                      type="radio"
                      name="plan"
                      value={plan}
                      checked={chosen === plan}
                      onChange={() => setChosen(plan)}
                    />
                    {PLAN_LABELS[plan]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="row-actions">
              <button type="button" className="pill" onClick={() => void changePlan()}>
                Change plan
              </button>
              {state !== 'active' ? (
                <button type="button" className="pill pill--quiet" onClick={() => void payOutstanding()}>
                  Pay outstanding balance
                </button>
              ) : null}
            </div>
            <span className="status" role="status" aria-live="polite" aria-label="Billing status">
              {billingStatus}
            </span>
            <div className="table-scroll">
              <table aria-label="Invoices">
                <thead>
                  <tr>
                    <th scope="col">Number</th>
                    <th scope="col">Date</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Balance</th>
                    <th scope="col">Items</th>
                  </tr>
                </thead>
                <tbody>
                  {(billing?.invoices ?? []).map((invoice) => (
                    <tr key={invoice.id}>
                      <td>{invoice.number}</td>
                      <td>{invoice.invoice_date}</td>
                      <td>{formatAmount(invoice.amount_cents)}</td>
                      <td>{formatAmount(invoice.balance_cents)}</td>
                      <td>
                        {invoice.items
                          .map((item) => `${item.description} ${formatAmount(item.amount_cents)}`)
                          .join('; ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          <h2>API keys</h2>
          <div className="card">
            <button type="button" className="pill" onClick={() => setKeyDialog(true)}>
              Create API key
            </button>
            <div className="table-scroll">
              <table aria-label="API keys">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Created</th>
                    <th scope="col">State</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id}>
                      <td>{key.name}</td>
                      <td>{inZone(props.me.venue?.time_zone ?? 'UTC', key.created_at)}</td>
                      <td>{key.revoked_at === null ? 'active' : 'revoked'}</td>
                      <td>
                        {key.revoked_at === null ? (
                          <button type="button" className="pill" onClick={() => void revoke(key)}>
                            Revoke {key.name}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2>Webhooks</h2>
        {webhooks?.delivery === 'delayed' ? <Banner>{COPY.webhooksDelayed}</Banner> : null}
        <div className="card">
          <div className="form-inline">
            <div>
              <label htmlFor="endpoint-url">Endpoint URL</label>
              <input
                id="endpoint-url"
                type="text"
                value={endpointUrl}
                onChange={(event) => setEndpointUrl(event.target.value)}
              />
            </div>
            <button type="button" className="pill" onClick={() => void saveEndpoint()}>
              Save endpoint
            </button>
          </div>
          <span className="status" role="status" aria-live="polite" aria-label="Webhook status">
            {webhookStatus}
          </span>
          <div className="table-scroll">
            <table aria-label="Delivery attempts">
              <thead>
                <tr>
                  <th scope="col">Message</th>
                  <th scope="col">Event type</th>
                  <th scope="col">Event id</th>
                  <th scope="col">Status</th>
                  <th scope="col">Response</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {(webhooks?.attempts ?? []).map((attempt) => (
                  <tr key={`${attempt.message_id}-${attempt.timestamp}`}>
                    <td>{attempt.message_id}</td>
                    <td>{attempt.event_type}</td>
                    <td>{attempt.event_id ?? ''}</td>
                    <td>{attempt.status}</td>
                    <td>{attempt.response_status ?? ''}</td>
                    <td>{inZone(props.me.venue?.time_zone ?? 'UTC', attempt.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {keyDialog ? (
        <NewKeyDialog
          onClose={() => setKeyDialog(false)}
          onCreated={() => {
            loadKeys();
          }}
        />
      ) : null}
    </Shell>
  );
}

function NewKeyDialog(props: { onClose: () => void; onCreated: () => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  const create = async (): Promise<void> => {
    setStatus(COPY.keyPending);
    try {
      const created = await post<{ secret: string }>('/api/keys', { name });
      setSecret(created.secret);
      setStatus(COPY.keyShownOnce);
      props.onCreated();
    } catch (error) {
      if (error instanceof RequestFailed && error.code === 'validation') {
        setStatus(COPY.keyNameError);
        return;
      }
      throw error;
    }
  };

  return (
    <Dialog label="New API key" initialFocus={nameRef} onClose={props.onClose}>
      <h2>New API key</h2>
      {secret === null ? (
        <>
          <div className="form-row">
            <label htmlFor="key-name">Key name</label>
            <input
              id="key-name"
              ref={nameRef}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <span className="status" role="status" aria-live="polite">
            {status}
          </span>
          <div className="dialog__actions">
            <button type="button" className="pill" onClick={() => void create()}>
              Create key
            </button>
            <button type="button" className="pill pill--quiet" onClick={props.onClose}>
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="secret">{secret}</p>
          <span className="status" role="status" aria-live="polite">
            {status}
          </span>
          <div className="dialog__actions">
            <button
              type="button"
              className="pill"
              onClick={() => void navigator.clipboard?.writeText(secret).catch(() => undefined)}
            >
              Copy key
            </button>
            <button type="button" className="pill pill--quiet" onClick={props.onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
