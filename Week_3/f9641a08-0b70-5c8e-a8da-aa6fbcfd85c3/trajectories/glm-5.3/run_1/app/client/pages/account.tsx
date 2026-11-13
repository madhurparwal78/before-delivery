import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { api } from '../lib/api.js';
import { navigate, usePath } from '../lib/router.js';
import { store, useStore } from '../lib/store.js';
import { LoadingPanel, signOut, announce } from '../app.js';
import { rupees, dateTimeText } from '../lib/format.js';

const TABS = ['Orders', 'Returns', 'Trials', 'Warranty', 'Addresses', 'Notifications'] as const;
type Tab = (typeof TABS)[number];

export function Account(): JSX.Element {
  useStore();
  const path = usePath();
  const url = new URL(path, location.origin);
  const initial = url.searchParams.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(initial !== null && TABS.includes(initial) ? initial : 'Orders');

  if (store.user === null) {
    return <LoadingPanel />;
  }

  return (
    <div class="account-page">
      <h1>Account</h1>
      <div role="tablist" aria-label="Account" class="tabs">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} class={t === tab ? 'selected' : ''} onClick={() => { setTab(t); navigate(`/account?tab=${t}`, true); }}>{t}</button>
        ))}
      </div>
      <button class="secondary" onClick={() => { void signOut(); }}>Sign out</button>
      {tab === 'Orders' ? <OrdersTab /> : null}
      {tab === 'Returns' ? <CasesTab kind="returns" /> : null}
      {tab === 'Trials' ? <CasesTab kind="trials" /> : null}
      {tab === 'Warranty' ? <CasesTab kind="warranty" /> : null}
      {tab === 'Addresses' ? <AddressesTab /> : null}
      {tab === 'Notifications' ? <NotificationsTab /> : null}
    </div>
  );
}

function OrdersTab(): JSX.Element {
  const [orders, setOrders] = useState<{ number: string; status: string; placed_at: string; total: number }[] | null>(null);
  useEffect(() => {
    void api.get<{ number: string; status: string; placed_at: string; total: number }[]>('/api/orders')
      .then(setOrders)
      .catch(() => setOrders([]));
  }, []);
  if (orders === null) return <LoadingPanel />;
  if (orders.length === 0) return <p>No orders yet.</p>;
  return (
    <ul role="list" class="account-list">
      {orders.map((o) => (
        <li key={o.number}>
          <a href={`/orders/${o.number}`} onClick={(e) => { e.preventDefault(); navigate(`/orders/${o.number}`); }}>
            {o.number} — {rupees(o.total)} — {statusWord(o.status)}
          </a>
        </li>
      ))}
    </ul>
  );
}

const STATUS_WORDS: Record<string, string> = {
  placed: 'Placed', packed: 'Packed', partially_shipped: 'Partially shipped', shipped: 'Shipped',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled',
  requested: 'Requested', approved: 'Approved', rejected: 'Rejected', in_transit: 'In transit',
  received: 'Received', inspected: 'Inspected', refunded: 'Refunded', exchanged: 'Exchanged',
  returned: 'Returned', submitted: 'Submitted', under_review: 'Under review', repair: 'Repair',
  replacement: 'Replacement', resolved: 'Resolved',
};

function statusWord(status: string): string {
  return STATUS_WORDS[status] ?? status;
}

function CasesTab(props: { kind: 'returns' | 'trials' | 'warranty' }): JSX.Element {
  const [cases, setCases] = useState<{ number: string; status: string; refund_amount: number | null; rejection_reason: string | null }[] | null>(null);
  useEffect(() => {
    const path = props.kind === 'warranty' ? '/api/warranty/claims' : `/api/${props.kind}`;
    void api.get<{ number: string; status: string; refund_amount?: number | null; rejection_reason?: string | null }[]>(path)
      .then((list) => setCases(list.map((c) => ({
        number: c.number, status: c.status,
        refund_amount: c.refund_amount ?? null, rejection_reason: c.rejection_reason ?? null,
      }))))
      .catch(() => setCases([]));
  }, [props.kind]);
  if (cases === null) return <LoadingPanel />;
  if (cases.length === 0) return <p>No orders yet.</p>;
  return (
    <ul role="list" class="account-list">
      {cases.map((c) => (
        <li key={c.number}>
          <p>{c.number}</p>
          <p class={`case-status ${c.status}`}>{statusWord(c.status)}</p>
          {c.status === 'approved' ? <p>Approved</p> : null}
          {c.status === 'refunded' && c.refund_amount !== null ? <p>Refund issued: {rupees(c.refund_amount)}.</p> : null}
          {c.status === 'rejected' && c.rejection_reason !== null ? <p>Rejected: {c.rejection_reason}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function AddressesTab(): JSX.Element {
  const [addresses, setAddresses] = useState<{ id: number; label: string; name: string; line1: string; line2: string; city: string; state: string; postcode: string; phone: string }[]>([]);
  const [form, setForm] = useState({ label: '', name: '', line1: '', line2: '', city: '', state: '', postcode: '', phone: '' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.get<typeof addresses>('/api/addresses').then(setAddresses).catch(() => undefined);
  }, []);

  const add = async (): Promise<void> => {
    setError(null);
    try {
      const created = await api.post<typeof addresses[0]>('/api/addresses', form);
      setAddresses([...addresses, created]);
      setForm({ label: '', name: '', line1: '', line2: '', city: '', state: '', postcode: '', phone: '' });
    } catch (err) {
      const failure = err as { body: { message: string; fields?: Record<string, string> } };
      setError(failure.body.message);
    }
  };

  return (
    <div class="addresses">
      <ul role="list">
        {addresses.map((a) => (
          <li key={a.id}><p>{a.label}: {a.name}, {a.line1}, {a.city}, {a.state} {a.postcode}</p></li>
        ))}
      </ul>
      <form onSubmit={(e) => { e.preventDefault(); void add(); }} novalidate>
        <label><span>Address label</span><input value={form.label} onInput={(e) => setForm({ ...form, label: (e.target as HTMLInputElement).value })} /></label>
        <label><span>Full name</span><input value={form.name} onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} /></label>
        <label><span>Address line 1</span><input value={form.line1} onInput={(e) => setForm({ ...form, line1: (e.target as HTMLInputElement).value })} /></label>
        <label><span>Address line 2</span><input value={form.line2} onInput={(e) => setForm({ ...form, line2: (e.target as HTMLInputElement).value })} /></label>
        <label><span>Town or city</span><input value={form.city} onInput={(e) => setForm({ ...form, city: (e.target as HTMLInputElement).value })} /></label>
        <label><span>State</span><input value={form.state} onInput={(e) => setForm({ ...form, state: (e.target as HTMLInputElement).value })} /></label>
        <label><span>PIN code</span><input value={form.postcode} onInput={(e) => setForm({ ...form, postcode: (e.target as HTMLInputElement).value })} /></label>
        <label><span>Mobile number</span><input value={form.phone} onInput={(e) => setForm({ ...form, phone: (e.target as HTMLInputElement).value })} /></label>
        <button class="primary">Add address</button>
        {error !== null ? <p role="alert" class="field-error">{error}</p> : null}
      </form>
    </div>
  );
}

function NotificationsTab(): JSX.Element {
  const [items, setItems] = useState<{ id: number; text: string; at: string; email_status: string }[] | null>(null);
  useEffect(() => {
    void api.get<{ id: number; text: string; at: string; email_status: string }[]>('/api/notifications')
      .then(setItems)
      .catch(() => setItems([]));
  }, []);
  if (items === null) return <LoadingPanel />;
  return (
    <div role="region" aria-label="Notifications">
      <ul role="list" class="account-list">
        {items.map((n) => (
          <li key={n.id}>
            <p>{n.text}</p>
            <p class="muted">{n.email_status === 'emailed' ? 'Emailed' : 'Email pending'} — {dateTimeText(n.at)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
