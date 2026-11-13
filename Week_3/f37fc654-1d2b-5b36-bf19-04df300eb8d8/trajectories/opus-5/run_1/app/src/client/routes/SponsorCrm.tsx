import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiFailure, api, signInHref } from '../lib/api.js';
import { useSession, useStageScene, useToasts } from '../lib/app-context.js';
import { useReducedMotion } from '../lib/typing.js';
import { CueLine, Dialog, Table } from '../components/ui.js';
import type { DeliveryShape, MaintenanceShape, ShareShape } from '../lib/shapes.js';
import { formatAmount, formatSharePercent } from '../../shared/money.js';
import * as copy from '../../shared/copy.js';
import { MAINTENANCE_PLANS, type MaintenancePlan } from '../../shared/seed.js';
import { formatVenueDate } from '../../shared/venue-time.js';

/** The invite link: public summary and the sponsor's own share. */
export function Invite(): JSX.Element {
  const { token = '' } = useParams();
  const { me } = useSession();
  const { notify } = useToasts();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const [share, setShare] = useState<ShareShape | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'expired' | 'invalid'>('loading');
  const accepting = useRef(false);
  const shouldAccept = new URLSearchParams(window.location.search).get('accept') === '1';
  useStageScene({ scene: 'working', silhouette: 'none' });

  useEffect(() => {
    void api
      .get<ShareShape>(`/api/invites/${token}`)
      .then((result) => {
        setShare(result);
        setState('ok');
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 410) setState('expired');
        else setState('invalid');
      });
  }, [token]);

  // Coming back from sign-in, accept the invite and go to the share screen.
  useEffect(() => {
    if (!shouldAccept || !me || accepting.current || state !== 'ok') return;
    accepting.current = true;
    void api
      .post<{ commissionId: string }>(`/api/invites/${token}/accept`)
      .then((result) => {
        notify(copy.INVITE_ACCEPTED);
        navigate(`/c/${result.commissionId}/share`, { replace: true });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.code === 'invite_used') {
          notify(copy.INVITE_TAKEN);
        }
      });
  }, [me, navigate, notify, shouldAccept, state, token]);

  if (state === 'expired') {
    return (
      <main className="column">
        <h1>{copy.INVITE_EXPIRED_PAGE.heading}</h1>
        <p>{copy.INVITE_EXPIRED_PAGE.text}</p>
      </main>
    );
  }
  if (state === 'invalid') {
    return (
      <main className="column">
        <h1>{copy.INVITE_INVALID_PAGE.heading}</h1>
        <p>{copy.INVITE_INVALID_PAGE.text}</p>
      </main>
    );
  }
  if (!share) return <main className="column" />;

  return (
    <main className="column">
      <CueLine text={`Co-fund ${share.commission.title}`} reducedMotion={reducedMotion} />
      <section className="panel">
        <p className="spread">
          <span className="muted">Studio</span>
          <span>{share.commission.studioName}</span>
        </p>
        <p className="spread">
          <span className="muted">Venue</span>
          <span>{share.commission.venueName}</span>
        </p>
        <p className="spread">
          <span className="muted">Installation</span>
          <span>{share.commission.installationType}</span>
        </p>
        {share.commission.installDate ? (
          <p className="spread">
            <span className="muted">Install day</span>
            <span>{formatVenueDate(share.commission.installDate)}</span>
          </p>
        ) : null}
      </section>
      <section className="panel">
        <h2>Your share</h2>
        <p className="spread">
          <span className="muted">Share</span>
          <span className="amount">{formatSharePercent(share.share.bp)}%</span>
        </p>
        <p className="spread">
          <span className="muted">Work</span>
          <span className="amount">{formatAmount(share.share.subtotalCents)}</span>
        </p>
        <p className="spread">
          <span className="muted">Sales tax</span>
          <span className="amount">{formatAmount(share.share.taxCents)}</span>
        </p>
        <p className="spread">
          <strong>Total</strong>
          <strong className="amount">{formatAmount(share.share.amountCents)}</strong>
        </p>
      </section>
      <button
        type="button"
        className="primary"
        onClick={() => {
          window.location.href = signInHref(`/i/${token}?accept=1`);
        }}
      >
        Accept and sign in
      </button>
    </main>
  );
}

export function SponsorShare(): JSX.Element {
  const { commissionId = '' } = useParams();
  const [share, setShare] = useState<ShareShape | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('');
  const [nameOnCard, setNameOnCard] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [paying, setPaying] = useState(false);
  const attemptKey = useRef<string | null>(null);
  useStageScene({ scene: 'working', silhouette: 'none' });

  const load = useCallback(() => {
    void api
      .get<ShareShape>(`/api/commissions/${commissionId}/share`)
      .then(setShare)
      .catch(() => undefined);
  }, [commissionId]);
  useEffect(load, [load]);

  const pay = async (): Promise<void> => {
    const funderId = share?.share.id;
    if (!funderId) return;
    setPaying(true);
    setPaymentStatus(copy.PAYMENT_PENDING);
    if (!attemptKey.current) attemptKey.current = crypto.randomUUID();
    try {
      const result = await api.post<{ amountCents: number }>(
        `/api/funders/${funderId}/payments`,
        { nameOnCard, cardNumber },
        { 'idempotency-key': attemptKey.current },
      );
      setPaymentStatus(copy.paymentPaid(formatAmount(result.amountCents)));
      attemptKey.current = null;
      load();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setPaymentStatus(
          error.code === 'already_paid'
            ? copy.ALREADY_PAID
            : error.code === 'idempotency_conflict'
              ? copy.PAYMENT_KEY_REUSED
              : (error.publicMessage ??
                Object.values(error.fieldErrors)[0] ??
                copy.PAYMENT_FAILED),
        );
        attemptKey.current = null;
      }
    } finally {
      setPaying(false);
    }
  };

  if (!share) return <main className="column" />;

  return (
    <main className="column">
      <h1>{share.commission.title}</h1>
      <section className="panel">
        <p className="spread">
          <span className="muted">Studio</span>
          <span>{share.commission.studioName}</span>
        </p>
        <p className="spread">
          <span className="muted">Venue</span>
          <span>{share.commission.venueName}</span>
        </p>
        <p className="spread">
          <span className="muted">Installation</span>
          <span>{share.commission.installationType}</span>
        </p>
      </section>
      <section className="panel">
        <h2>Your share</h2>
        <p className="spread">
          <span className="muted">Share</span>
          <span className="amount">{formatSharePercent(share.share.bp)}%</span>
        </p>
        <p className="spread">
          <span className="muted">Work</span>
          <span className="amount">{formatAmount(share.share.subtotalCents)}</span>
        </p>
        <p className="spread">
          <span className="muted">Sales tax</span>
          <span className="amount">{formatAmount(share.share.taxCents)}</span>
        </p>
        <p className="spread">
          <strong>Total</strong>
          <strong className="amount">{formatAmount(share.share.amountCents)}</strong>
        </p>
        {share.share.dueAt ? (
          <p className="spread">
            <span className="muted">Due</span>
            <span>{formatVenueDate(share.share.dueAt.slice(0, 10))}</span>
          </p>
        ) : null}
        <p className="spread">
          <span className="muted">State</span>
          <span className="badge">{share.share.state === 'paid' ? 'Paid' : share.share.state}</span>
        </p>
      </section>

      {share.share.state !== 'paid' ? (
        <button type="button" className="primary" onClick={() => setSheetOpen(true)}>
          Pay my share
        </button>
      ) : null}

      {sheetOpen ? (
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
            <button type="button" className="primary" disabled={paying} onClick={() => void pay()}>
              Pay {formatAmount(share.share.amountCents)}
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
    </main>
  );
}

export function CrmSettings(): JSX.Element {
  const { notify } = useToasts();
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useStageScene({ scene: 'working', silhouette: 'none' });

  useEffect(() => {
    void api
      .get<{ url: string | null; signingSecret?: string }>('/api/me/crm-endpoint')
      .then((result) => {
        setUrl(result.url ?? '');
        setSecret(result.signingSecret ?? '');
      })
      .catch(() => undefined);
  }, []);

  const save = async (): Promise<void> => {
    setErrors({});
    try {
      const saved = await api.put<{ url: string; signingSecret: string }>(
        '/api/me/crm-endpoint',
        { url },
      );
      setSecret(saved.signingSecret);
      notify(copy.CRM_SAVED);
    } catch (error) {
      if (error instanceof ApiFailure) {
        if (error.code === 'webhooks_unavailable') notify(copy.CRM_SVIX_DOWN);
        else setErrors(error.fieldErrors);
      }
    }
  };

  return (
    <main className="column">
      <h1>CRM settings</h1>
      <div>
        <label htmlFor="field-url">CRM endpoint URL</label>
        <input
          id="field-url"
          className="answer-field"
          aria-label="CRM endpoint URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        {errors['url'] ? <p className="muted">{errors['url']}</p> : null}
      </div>
      <button type="button" className="primary" onClick={() => void save()}>
        Save endpoint
      </button>
      {secret ? (
        <p className="row">
          <span className="muted">Signing secret </span>
          <span style={{ wordBreak: 'break-all' }}>{secret}</span>
        </p>
      ) : null}
    </main>
  );
}

export function Deliveries(): JSX.Element {
  const { commissionId = '' } = useParams();
  const reducedMotion = useReducedMotion();
  const [rows, setRows] = useState<DeliveryShape[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useStageScene({ scene: 'working', silhouette: 'none' });

  useEffect(() => {
    void api
      .get<{ deliveries: DeliveryShape[] }>(
        `/api/commissions/${commissionId}/webhook-deliveries`,
      )
      .then((result) => setRows(result.deliveries))
      .catch(() => setRows([]));
  }, [commissionId]);

  if (rows === null) return <main className="column" />;
  if (rows.length === 0) {
    return (
      <main className="column">
        <CueLine text={copy.EMPTY_STATES.webhooks} reducedMotion={reducedMotion} />
      </main>
    );
  }

  return (
    <main className="column wide">
      <h1>CRM deliveries</h1>
      <Table
        name="CRM deliveries"
        head={
          <tr>
            <th>Event</th>
            <th>Type</th>
            <th>Created</th>
            <th>Attempts</th>
            <th>Final state</th>
          </tr>
        }
      >
        {rows.map((row) => (
          <tr key={row.eventId}>
            <td>
              <button type="button" onClick={() => setOpen(open === row.eventId ? null : row.eventId)}>
                {row.eventId.slice(0, 8)}
              </button>
              {open === row.eventId ? (
                <ul className="list">
                  {row.attempts.map((attempt, index) => (
                    <li key={index} className="muted">
                      {attempt.at} · {attempt.responseStatus} · {attempt.status}
                    </li>
                  ))}
                </ul>
              ) : null}
            </td>
            <td>{row.eventType}</td>
            <td>{row.createdAt}</td>
            <td className="amount">{row.attempts.length}</td>
            <td>{row.finalState}</td>
          </tr>
        ))}
      </Table>
    </main>
  );
}

export function Maintenance(): JSX.Element {
  const { commissionId = '' } = useParams();
  const { notify } = useToasts();
  const [plan, setPlan] = useState<MaintenancePlan>('essential');
  const [current, setCurrent] = useState<MaintenanceShape | null>(null);
  const [proration, setProration] = useState<MaintenanceShape['invoices'][number] | null>(null);
  useStageScene({ scene: 'working', silhouette: 'none' });

  const load = useCallback(() => {
    void api
      .get<MaintenanceShape>(`/api/commissions/${commissionId}/maintenance`)
      .then((result) => {
        setCurrent(result);
        if (result.plan) setPlan(result.plan as MaintenancePlan);
      })
      .catch(() => undefined);
  }, [commissionId]);
  useEffect(load, [load]);

  const start = async (): Promise<void> => {
    try {
      await api.post(`/api/commissions/${commissionId}/maintenance`, { plan });
      notify(copy.maintenanceStarted(MAINTENANCE_PLANS[plan].label));
      load();
    } catch (error) {
      if (error instanceof ApiFailure) notify(error.publicMessage ?? copy.TRANSITION_UNAVAILABLE);
    }
  };

  const change = async (): Promise<void> => {
    try {
      const result = await api.put<{ invoice: MaintenanceShape['invoices'][number] | null }>(
        `/api/commissions/${commissionId}/maintenance`,
        { plan },
      );
      setProration(result.invoice);
      notify(copy.maintenanceSwitched(MAINTENANCE_PLANS[plan].label));
      load();
    } catch (error) {
      if (error instanceof ApiFailure) {
        notify(
          error.code === 'same_plan'
            ? copy.MAINTENANCE_SAME_PLAN
            : (error.publicMessage ?? copy.TRANSITION_UNAVAILABLE),
        );
      }
    }
  };

  return (
    <main className="column wide">
      <h1>Maintenance</h1>
      <div role="radiogroup" aria-label="Maintenance plan" className="chip-grid few">
        {(['essential', 'priority'] as MaintenancePlan[]).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={plan === option}
            className="chip"
            onClick={() => setPlan(option)}
          >
            <span className="box" aria-hidden="true">
              {plan === option ? '✓' : ''}
            </span>
            <span className="label">
              {MAINTENANCE_PLANS[option].label} · {formatAmount(MAINTENANCE_PLANS[option].priceCents)}
            </span>
          </button>
        ))}
      </div>

      <div className="inline">
        {current?.plan ? (
          <button type="button" className="primary" onClick={() => void change()}>
            Change plan
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => void start()}>
            Start maintenance
          </button>
        )}
      </div>

      {current?.plan ? (
        <section className="panel">
          <p className="spread">
            <span className="muted">Current plan</span>
            <span>{MAINTENANCE_PLANS[current.plan as MaintenancePlan]?.label ?? current.plan}</span>
          </p>
          <p className="spread">
            <span className="muted">Charged through</span>
            <span>{current.chargedThroughDate ?? '—'}</span>
          </p>
        </section>
      ) : null}

      {proration ? (
        <Table
          name="Proration"
          head={
            <tr>
              <th>Item</th>
              <th>From</th>
              <th>To</th>
              <th>Amount</th>
            </tr>
          }
        >
          {proration.items.map((item, index) => (
            <tr key={index}>
              <td>{item.description}</td>
              <td>{item.startDate ?? '—'}</td>
              <td>{item.endDate ?? '—'}</td>
              <td className="amount">{formatAmount(item.amountCents)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3}>
              <strong>Invoice total</strong>
            </td>
            <td className="amount">
              <strong>{formatAmount(proration.amountCents)}</strong>
            </td>
          </tr>
        </Table>
      ) : null}
    </main>
  );
}
