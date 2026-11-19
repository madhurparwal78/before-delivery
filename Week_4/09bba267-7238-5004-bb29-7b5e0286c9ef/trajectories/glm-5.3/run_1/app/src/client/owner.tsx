import { useCallback, useEffect, useState } from 'react';
import type { Order, Performance } from '../shared/api-types';
import { api } from './api';
import { announce } from './live';
import { TopBar, UpdatesRegion } from './shell';
import { formatCents } from './seat-map-core';

type OwnerTier = {
  id: string;
  name: string;
  faceCents: number;
  remaining: number;
  waitlistLength: number;
  onSale: number;
  held: number;
  sold: number;
  offered: number;
};

type OwnerPerformance = Omit<Performance, 'tiers'> & { tiers: OwnerTier[] };

type OwnerOrder = Order & { killbillAccountId: string; killbillPaymentIds: string[] };

type OutboxRow = {
  id: number;
  to: string;
  subject: string;
  kind: string;
  status: string;
  createdAt: string;
};

export function OwnerPage({ path }: { path: string }) {
  if (path === '/owner/new') {
    return <OwnerPublishPage />;
  }
  if (path === '/owner/orders') {
    return <OwnerOrdersPage />;
  }
  if (path === '/owner/outbox') {
    return <OwnerOutboxPage />;
  }
  return <OwnerDashboardPage />;
}

function useOwnerSession(): { authed: boolean; check: () => Promise<boolean> } {
  const [authed, setAuthed] = useState(false);
  const check = useCallback(async () => {
    const result = await api<unknown>('/api/owner/performances');
    setAuthed(result.ok);
    return result.ok;
  }, []);
  return { authed, check };
}

function OwnerSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [passcode, setPasscode] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <div className="page">
      <TopBar active={null} />
      <UpdatesRegion />
      <main className="content owner">
        <h1>Owner sign-in</h1>
        <form
          className="field"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            const result = await api<unknown>('/api/owner/session', {
              method: 'POST',
              body: { passcode },
            });
            setPending(false);
            if (result.ok) {
              onSignedIn();
              return;
            }
            announce('That passcode is not right.');
          }}
        >
          <label className="field">
            <span>Passcode</span>
            <input type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} />
          </label>
          <button type="submit" disabled={pending}>Sign in</button>
        </form>
      </main>
    </div>
  );
}

function OwnerLinks() {
  return (
    <nav className="owner-links" aria-label="Owner">
      <a href="/owner">Performances</a>
      <a href="/owner/new">Publish performance</a>
      <a href="/owner/orders">Orders</a>
      <a href="/owner/outbox">Outbox</a>
      <button
        className="sign-out"
        onClick={async () => {
          await api<unknown>('/api/owner/session', { method: 'DELETE' });
          window.location.href = '/owner';
        }}
      >
        Sign out
      </button>
    </nav>
  );
}

function OwnerDashboardPage() {
  const { authed, check } = useOwnerSession();
  const [performances, setPerformances] = useState<OwnerPerformance[]>([]);

  useEffect(() => {
    if (!authed) {
      void check();
      return;
    }
    void load();
    const interval = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(interval);
  }, [authed, check]);

  const load = async () => {
    const result = await api<{ performances: OwnerPerformance[] }>('/api/owner/performances');
    if (result.ok) setPerformances(result.value.performances);
  };

  if (!authed) {
    return <OwnerSignIn onSignedIn={() => void check()} />;
  }

  return (
    <div className="page">
      <TopBar active={null} />
      <UpdatesRegion />
      <main className="content owner">
        <h1>Performances</h1>
        <OwnerLinks />
        {performances.map((performance) => (
          <section key={performance.id} aria-label={performance.title} className="owner-performance">
            <h2>{performance.title}</h2>
            <p className="start-label">{performance.startsAtVenue}</p>
            <table aria-label={performance.title} className="owner-table">
              <thead>
                <tr>
                  <th scope="col">Tier</th>
                  <th scope="col">On sale</th>
                  <th scope="col">Held</th>
                  <th scope="col">Sold</th>
                  <th scope="col">Offered</th>
                  <th scope="col">Waitlist</th>
                </tr>
              </thead>
              <tbody>
                {performance.tiers.map((tier) => (
                  <tr key={tier.id}>
                    <th scope="row">{tier.name}</th>
                    <td>{tier.onSale}</td>
                    <td>{tier.held}</td>
                    <td>{tier.sold}</td>
                    <td>{tier.offered}</td>
                    <td>{tier.waitlistLength}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </main>
    </div>
  );
}

function OwnerPublishPage() {
  const { authed, check } = useOwnerSession();
  const [title, setTitle] = useState('');
  const [startsLocal, setStartsLocal] = useState('');
  const [tiers, setTiers] = useState<Array<{ name: string; faceDollars: string; rowsAndSeats: string }>>([
    { name: '', faceDollars: '', rowsAndSeats: '' },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void check();
  }, [check]);

  if (!authed) {
    return <OwnerSignIn onSignedIn={() => void check()} />;
  }

  const publish = async () => {
    setPending(true);
    const builtTiers = tiers.map((tier) => {
      const ids = tier.rowsAndSeats
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      const rows: string[] = [];
      const seats: string[] = [];
      for (const id of ids) {
        if (/^[A-Z]{2}-[A-P]$/.test(id)) rows.push(id);
        else seats.push(id);
      }
      return {
        name: tier.name,
        faceCents: Math.round(Number(tier.faceDollars) * 100),
        rows,
        seats,
      };
    });
    const result = await api<{ performance: Performance }>('/api/owner/performances', {
      method: 'POST',
      body: { title, startsLocal, tiers: builtTiers },
    });
    setPending(false);
    if (result.ok) {
      announce(`Published ${title}.`);
      window.location.href = '/owner';
      return;
    }
    if (result.fields) {
      setErrors(result.fields);
      announce('Check these details.');
      return;
    }
    announce('Check these details.');
  };

  return (
    <div className="page">
      <TopBar active={null} />
      <UpdatesRegion />
      <main className="content owner">
        <h1>Publish performance</h1>
        <OwnerLinks />
        {Object.keys(errors).length > 0 && (
          <div className="error-summary">
            <h3>Check these details</h3>
            <ul>
              {Object.entries(errors).map(([field, message]) => (
                <li key={field}>
                  <a href={`#publish-${field}`}>{message}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <label className="field">
          <span>Title</span>
          <input id="publish-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="field">
          <span>Start (venue time)</span>
          <input id="publish-startsLocal" placeholder="YYYY-MM-DDTHH:MM" value={startsLocal} onChange={(event) => setStartsLocal(event.target.value)} />
        </label>
        {tiers.map((tier, index) => (
          <fieldset key={index} className="tier-fieldset" role="group" aria-label={`Tier ${index + 1}`}>
            <legend>Tier {index + 1}</legend>
            <label className="field">
              <span>Tier name</span>
              <input value={tier.name} onChange={(event) => {
                const next = [...tiers];
                next[index] = { ...tier, name: event.target.value };
                setTiers(next);
              }} />
            </label>
            <label className="field">
              <span>Face value in dollars</span>
              <input
                inputMode="decimal"
                value={tier.faceDollars}
                onChange={(event) => {
                  const next = [...tiers];
                  next[index] = { ...tier, faceDollars: event.target.value };
                  setTiers(next);
                }}
              />
            </label>
            <label className="field">
              <span>Rows and seats</span>
              <input
                placeholder="ST-B or ST-A-15, comma separated"
                value={tier.rowsAndSeats}
                onChange={(event) => {
                  const next = [...tiers];
                  next[index] = { ...tier, rowsAndSeats: event.target.value };
                  setTiers(next);
                }}
              />
            </label>
            {tiers.length > 1 && (
              <button
                type="button"
                className="remove-tier"
                onClick={() => setTiers((current) => current.filter((_, i) => i !== index))}
              >
                Remove tier {index + 1}
              </button>
            )}
          </fieldset>
        ))}
        <button type="button" className="add-tier" onClick={() => setTiers((current) => [...current, { name: '', faceDollars: '', rowsAndSeats: '' }])}>
          Add tier
        </button>
        <button type="button" className="publish-button" disabled={pending} onClick={() => void publish()}>
          Publish
        </button>
      </main>
    </div>
  );
}

function OwnerOrdersPage() {
  const { authed, check } = useOwnerSession();
  const [orders, setOrders] = useState<OwnerOrder[]>([]);

  useEffect(() => {
    if (!authed) {
      void check();
      return;
    }
    void load();
    const interval = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(interval);
  }, [authed, check]);

  const load = async () => {
    const result = await api<{ orders: OwnerOrder[] }>('/api/owner/orders');
    if (result.ok) setOrders(result.value.orders);
  };

  if (!authed) {
    return <OwnerSignIn onSignedIn={() => void check()} />;
  }

  return (
    <div className="page">
      <TopBar active={null} />
      <UpdatesRegion />
      <main className="content owner">
        <h1>Orders</h1>
        <OwnerLinks />
        <table aria-label="Orders" className="owner-table orders-table">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Performance</th>
              <th scope="col">Buyer</th>
              <th scope="col">Status</th>
              <th scope="col">Total</th>
              <th scope="col">Net paid</th>
              <th scope="col">Kill Bill payment</th>
              <th scope="col">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>{order.id}</td>
                <td>{order.performanceTitle}</td>
                <td>{order.email}</td>
                <td>{order.status.replace(/_/g, ' ')}</td>
                <td className="amount">{formatCents(order.totalCents)}</td>
                <td className="amount">{formatCents(order.netPaidCents)}</td>
                <td>{order.killbillPaymentIds.length > 0 ? order.killbillPaymentIds.join(', ') : '—'}</td>
                <td>{order.receipt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}

function OwnerOutboxPage() {
  const { authed, check } = useOwnerSession();
  const [messages, setMessages] = useState<OutboxRow[]>([]);

  useEffect(() => {
    if (!authed) {
      void check();
      return;
    }
    void load();
    const interval = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(interval);
  }, [authed, check]);

  const load = async () => {
    const result = await api<{ messages: OutboxRow[] }>('/api/owner/outbox');
    if (result.ok) setMessages(result.value.messages);
  };

  if (!authed) {
    return <OwnerSignIn onSignedIn={() => void check()} />;
  }

  return (
    <div className="page">
      <TopBar active={null} />
      <UpdatesRegion />
      <main className="content owner">
        <h1>Outbox</h1>
        <OwnerLinks />
        <table aria-label="Outbox" className="owner-table outbox-table">
          <thead>
            <tr>
              <th scope="col">To</th>
              <th scope="col">Subject</th>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr key={message.id}>
                <td>{message.to}</td>
                <td>{message.subject}</td>
                <td>{message.kind}</td>
                <td>{message.status === 'sent' ? 'Sent' : 'Queued'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}
