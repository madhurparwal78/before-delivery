// Account: sign in by code, your orders and subscriptions, one order, and running a Trio.
import { useEffect, useRef, useState } from 'preact/hooks';
import { CADENCE_LABELS, type Cadence, coreScent, pick } from '../../shared/catalog.js';
import { formatMoney } from '../../shared/money.js';
import { dropTime, longDate } from '../../shared/toronto.js';
import { api } from '../api';
import { EmailStep } from '../email-step';
import { useCopy } from '../state';
import type { Account, Order, Subscription } from '../types';
import { CadenceMenu, Dialog, EmptyState, Live } from '../ui';
import { OrderSummary } from './checkout';
import { NotFoundPage } from './not-found';
import { FLASH, TrioPrice, TrioScentRadios } from './subscribe';

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { m } = useCopy();
  const [message, setMessage] = useState('');
  return (
    <div class="page narrow">
      <h1 tabIndex={-1}>{m.signIn}</h1>
      <p class="lede">{m.signInIntro}</p>
      <EmailStep purpose="sign_in" signedInAs={null} announce={setMessage} onVerified={onSignedIn} />
      <Live name={m.accountUpdates} text={message} class="result-line" />
    </div>
  );
}

export function AccountPage() {
  const { m, l } = useCopy();
  const [account, setAccount] = useState<Account | null | 'signed-out'>(null);
  const load = async () => {
    const r = await api<Account>('GET', '/api/account');
    setAccount(r.ok ? r.data : 'signed-out');
  };
  useEffect(() => void load(), []);
  if (account === null) return <p class="page">{m.loading}</p>;
  if (account === 'signed-out') return <SignIn onSignedIn={() => void load()} />;
  return (
    <div class="page narrow">
      <h1 tabIndex={-1}>{m.yourAccount}</h1>
      <p class="lede">{account.customer.email}</p>
      <section class="ruled" aria-labelledby="orders-title">
        <h2 id="orders-title">{m.orders}</h2>
        {account.orders.length === 0 ? (
          <EmptyState>{m.noOrders}</EmptyState>
        ) : (
          <ul aria-label={m.orders} class="record-list">
            {account.orders.map((o) => (
              <li key={o.number}>
                <a href={`/account/orders/${o.number}`}>{o.number}</a>
                <span class="muted">{dropTime(new Date(o.placed_at), l)}</span>
                <span class="num">{formatMoney(o.total.cents, l)}</span>
                <span>{m.orderStatus[o.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section class="ruled" aria-labelledby="subs-title">
        <h2 id="subs-title">{m.subscriptions}</h2>
        {account.subscriptions.length === 0 ? (
          <EmptyState>{m.noSubscriptions}</EmptyState>
        ) : (
          <ul aria-label={m.subscriptions} class="record-list">
            {account.subscriptions.map((s) => (
              <li key={s.number}>
                <a href={`/account/subscriptions/${s.number}`}>{s.number}</a>
                <span>{pick(coreScent(s.scent)?.name ?? { en: s.scent, fr: s.scent }, l)}</span>
                <span>{m.stateLabels[s.state]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div class="actions">
        <button
          type="button"
          class="button secondary"
          onClick={async () => {
            await api('POST', '/api/auth/sign-out', {});
            setAccount('signed-out');
          }}
        >
          {m.signOut}
        </button>
      </div>
    </div>
  );
}

export function OrderPage({ number }: { number: string }) {
  const { m, l } = useCopy();
  const [order, setOrder] = useState<Order | null | 401 | 404>(null);
  const load = async () => {
    const r = await api<Order>('GET', `/api/account/orders/${encodeURIComponent(number)}`);
    setOrder(r.ok ? r.data : r.status === 401 ? 401 : 404);
  };
  useEffect(() => void load(), [number]);
  if (order === null) return <p class="page">{m.loading}</p>;
  if (order === 401) return <SignIn onSignedIn={() => void load()} />;
  if (order === 404) return <NotFoundPage />;
  return (
    <div class="page narrow">
      <h1 tabIndex={-1}>{m.orderHeading(order.number)}</h1>
      <p class="lede">
        {m.orderStatus[order.status]} · {m.fulfilment[order.fulfilment]}
      </p>
      <OrderSummary order={order} />
      <p>
        {m.shipsOn}: <span class="num">{longDate(order.ship_on, l)}</span>
      </p>
    </div>
  );
}

type Action = 'skip' | 'unskip' | 'pause' | 'resume' | 'cancel' | 'swap' | 'cadence';

export function SubscriptionPage({ number }: { number: string }) {
  const { m, l } = useCopy();
  const [sub, setSub] = useState<Subscription | null | 401 | 404>(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<Action | null>(null);
  const [scent, setScent] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [focusAfter, setFocusAfter] = useState<'skip' | 'unskip' | 'heading' | null>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const load = async () => {
    const r = await api<Subscription>('GET', `/api/account/subscriptions/${encodeURIComponent(number)}`);
    if (r.ok) {
      setSub(r.data);
      setScent(r.data.scent);
    } else setSub(r.status === 401 ? 401 : 404);
  };
  useEffect(() => {
    void load();
    const flash = sessionStorage.getItem(FLASH);
    if (flash) {
      sessionStorage.removeItem(FLASH);
      setMessage(m.started(formatMoney((JSON.parse(flash) as { cents: number }).cents, l)));
    }
  }, [number]);
  useEffect(() => {
    if (focusAfter === 'heading') document.querySelector<HTMLElement>('main h1')?.focus();
    else if (focusAfter) skipRef.current?.focus();
    setFocusAfter(null);
  }, [focusAfter]);

  if (sub === null) return <p class="page">{m.loading}</p>;
  if (sub === 401) return <SignIn onSignedIn={() => void load()} />;
  if (sub === 404) return <NotFoundPage />;

  const date = (d: string | null) => (d ? longDate(d, l) : '');
  const scentName = (slug: string) => pick(coreScent(slug)?.name ?? { en: slug, fr: slug }, l);

  const act = async (action: Action, value?: string) => {
    if (pending) return;
    setPending(action);
    const r =
      action === 'swap'
        ? await api<{ subscription: Subscription }>('PATCH', `/api/account/subscriptions/${sub.number}`, { scent: value })
        : action === 'cadence'
          ? await api<{ subscription: Subscription }>('PATCH', `/api/account/subscriptions/${sub.number}`, { cadence: value })
          : await api<{ subscription: Subscription }>('POST', `/api/account/subscriptions/${sub.number}/${action}`, {});
    setPending(null);
    if (!r.ok) {
      setMessage(r.status === 0 ? m.network : (Object.values(r.error.fields ?? {})[0] ?? r.error.message));
      if (action === 'cancel') setDialog(false);
      return;
    }
    const next = r.data.subscription;
    setSub(next);
    const messages: Record<Action, string> = {
      skip: m.skipped(date(next.skipped_bill_date), date(next.next_bill_date)),
      unskip: m.unskipped(date(next.next_bill_date)),
      pause: m.pausedMsg(date(next.paused_from)),
      resume: m.resumed(date(next.next_bill_date)),
      cancel: m.cancelled,
      swap: m.swapped(scentName(next.scent)),
      cadence: m.cadenceChanged(date(next.next_bill_date), pick(CADENCE_LABELS[next.pending_cadence ?? next.cadence], l).toLowerCase()),
    };
    setMessage(messages[action]);
    if (action === 'skip') setFocusAfter('unskip');
    if (action === 'unskip') setFocusAfter('skip');
    if (action === 'cancel') {
      setDialog(false);
      setFocusAfter('heading');
    }
  };

  const busy = (action: Action) => (pending === action ? { 'aria-busy': 'true' as const, 'aria-disabled': 'true' as const } : {});
  const label = (action: Action, text: string) => (pending === action ? m.saving : text);
  const active = sub.state === 'active';

  return (
    <div class="page columns">
      <div class="col-main">
        <h1 tabIndex={-1}>{m.subHeading(sub.number)}</h1>
        <Live name={m.accountUpdates} text={message} class="result-line ruled-result" />
        <dl class="facts ruled">
          <div>
            <dt>{m.state}</dt>
            <dd>{m.stateLabels[sub.state]}</dd>
          </div>
          <div>
            <dt>{m.trioScent}</dt>
            <dd>{scentName(sub.scent)}</dd>
          </div>
          <div>
            <dt>{m.cadence}</dt>
            <dd>{pick(CADENCE_LABELS[sub.cadence], l)}</dd>
          </div>
          {sub.pending_cadence && (
            <div>
              <dt>{m.pendingCadence}</dt>
              <dd>{pick(CADENCE_LABELS[sub.pending_cadence], l)}</dd>
            </div>
          )}
          {sub.locks_at && (
            <div>
              <dt>{m.lockDate}</dt>
              <dd class="num">{dropTime(new Date(sub.locks_at), l)}</dd>
            </div>
          )}
        </dl>
        <section aria-label={m.nextBill} class="ruled">
          <h2>{m.nextBill}</h2>
          <p class="num big">{sub.state === 'paused' ? m.pausedWord : date(sub.next_bill_date)}</p>
        </section>
        {sub.state !== 'cancelled' && (
          <div class="ruled controls">
            <TrioScentRadios value={scent} onChange={setScent} />
            <div class="actions">
              <button type="button" class="button secondary" {...busy('swap')} onClick={() => void act('swap', scent ?? sub.scent)}>
                {label('swap', m.swap)}
              </button>
            </div>
            <CadenceMenu value={sub.cadence} busy={pending === 'cadence'} onChoose={(c: Cadence) => void act('cadence', c)} />
            <div class="actions">
              {active &&
                (sub.skipped_bill_date ? (
                  <button type="button" class="button secondary" ref={skipRef} {...busy('unskip')} onClick={() => void act('unskip')}>
                    {label('unskip', m.undoSkip)}
                  </button>
                ) : (
                  <button type="button" class="button secondary" ref={skipRef} {...busy('skip')} onClick={() => void act('skip')}>
                    {label('skip', m.skipNext)}
                  </button>
                ))}
              {active ? (
                <button type="button" class="button secondary" {...busy('pause')} onClick={() => void act('pause')}>
                  {label('pause', m.pause)}
                </button>
              ) : (
                <button type="button" class="button secondary" {...busy('resume')} onClick={() => void act('resume')}>
                  {label('resume', m.resume)}
                </button>
              )}
              <button type="button" class="button secondary danger" ref={cancelRef} onClick={() => setDialog(true)}>
                {m.cancelSub}
              </button>
            </div>
          </div>
        )}
        <Dialog title={m.cancelQ} open={dialog} opener={cancelRef} onClose={() => setDialog(false)}>
          <p>{m.cancelBody}</p>
          <div class="actions">
            <button type="button" class="button primary" {...busy('cancel')} onClick={() => void act('cancel')}>
              {label('cancel', m.yesCancel)}
            </button>
            <button
              type="button"
              class="button secondary"
              onClick={() => {
                setDialog(false);
                cancelRef.current?.focus();
              }}
            >
              {m.keepIt}
            </button>
          </div>
        </Dialog>
      </div>
      <aside class="col-side">
        <div class="sticky-panel">
          <TrioPrice province={sub.shipping.province} charged={false} />
        </div>
      </aside>
    </div>
  );
}

