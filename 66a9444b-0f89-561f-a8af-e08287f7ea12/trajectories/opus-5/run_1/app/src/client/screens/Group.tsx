import { useCallback, useEffect, useRef, useState } from 'react';
import { Checkout, checkoutStepFromQuery } from '../components/Checkout.js';
import { ProblemMark } from '../components/Mark.js';
import { request } from '../lib/api.js';
import { formatDate, formatEuros } from '../lib/festival.js';
import { useRoute, useUser } from '../lib/store.js';
import type { CreditNote, FestivalDay, Invoice, Order, PassPrices, Session } from '../lib/types.js';
import type { JSX } from 'react';

interface Dashboard {
  organisation: { id: string; name: string };
  orders: number;
  tickets: number;
  invoiced_cents: number;
  credited_cents: number;
  paid_cents: number;
  outstanding_cents: number;
}

interface Attendee {
  name: string;
  order_ref: string;
  line_id: string;
  item_title: string;
  state: string;
}

export function GroupScreen(): JSX.Element {
  const { user, loading } = useUser();
  const route = useRoute();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [query, setQuery] = useState('');
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [status, setStatus] = useState('');
  const [problem, setProblem] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [days, setDays] = useState<FestivalDay[]>([]);
  const [prices, setPrices] = useState<PassPrices | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const checkoutStep = checkoutStepFromQuery(route.query.get('checkout'));

  const load = useCallback(async () => {
    const [dash, orderBody, invoiceBody, programme] = await Promise.all([
      request<Dashboard>('/api/group/dashboard'),
      request<{ orders: Order[] }>('/api/orders'),
      request<{ invoices: Invoice[] }>('/api/invoices'),
      request<{ sessions: Session[]; festival_days: FestivalDay[]; price_policy: PassPrices }>(
        '/api/programme',
      ),
    ]);
    setDashboard(dash);
    setOrders(orderBody.orders.filter((order) => order.organisation_id !== null));
    setInvoices(invoiceBody.invoices);
    setSessions(programme.sessions);
    setDays(programme.festival_days);
    setPrices(programme.price_policy);

    const notes: CreditNote[] = [];
    for (const invoice of invoiceBody.invoices) {
      for (const id of invoice.credit_note_ids) {
        notes.push(await request<CreditNote>(`/api/credit-notes/${id}`));
      }
    }
    setCreditNotes(notes);
  }, []);

  useEffect(() => {
    if (user === null || user.role !== 'group_booker') return;
    void load();
  }, [user, load]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setAttendees([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void request<{ attendees: Attendee[] }>(
        `/api/group/attendees?q=${encodeURIComponent(query.trim())}`,
      )
        .then((body) => setAttendees(body.attendees))
        .catch(() => setAttendees([]));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  if (loading) return <section className="wide ground-paper">Loading…</section>;
  if (user === null || user.role !== 'group_booker') {
    return (
      <section className="narrow ground-paper">
        <h1 className="display">Group</h1>
        <p>Only group bookers can use this screen.</p>
      </section>
    );
  }

  return (
    <section className="group wide ground-paper">
      <h1 className="display">{dashboard?.organisation.name ?? 'Group'}</h1>
      <p className="status" role="status" aria-label="Group status">
        {status}
      </p>

      <section className="totals" aria-label="Organisation totals">
        <dl className="ruled">
          <div>
            <dt>Orders</dt>
            <dd className="figures">{dashboard?.orders ?? 0}</dd>
          </div>
          <div>
            <dt>Tickets</dt>
            <dd className="figures">{dashboard?.tickets ?? 0}</dd>
          </div>
          <div>
            <dt>Invoiced</dt>
            <dd className="figures">{formatEuros(dashboard?.invoiced_cents ?? 0)}</dd>
          </div>
          <div>
            <dt>Credited</dt>
            <dd className="figures">{formatEuros(dashboard?.credited_cents ?? 0)}</dd>
          </div>
          <div>
            <dt>Paid</dt>
            <dd className="figures">{formatEuros(dashboard?.paid_cents ?? 0)}</dd>
          </div>
          <div>
            <dt>Outstanding</dt>
            <dd className="figures">{formatEuros(dashboard?.outstanding_cents ?? 0)}</dd>
          </div>
        </dl>
      </section>

      <div className="field">
        <label htmlFor="attendee-search">Search attendees</label>
        <input
          id="attendee-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <ul className="ruled" aria-label="Attendee results">
        {attendees.map((attendee) => (
          <li key={attendee.line_id}>
            <span>{attendee.name}</span>
            <span>{attendee.item_title}</span>
            <span>{attendee.order_ref}</span>
            <span>{attendee.state}</span>
          </li>
        ))}
      </ul>

      <a href="/api/group/export.csv" download>
        Export CSV
      </a>

      <button
        type="button"
        className="primary"
        onClick={(event) => {
          opener.current = event.currentTarget;
          route.setQuery({ checkout: 'tickets' });
        }}
      >
        New group booking
      </button>

      <table className="ruled" aria-label="Group orders">
        <thead>
          <tr>
            <th scope="col">Ref</th>
            <th scope="col">Date</th>
            <th scope="col">Tickets</th>
            <th scope="col">Status</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>
                <a
                  href={`/orders/${order.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    route.navigate(`/orders/${order.id}`);
                  }}
                >
                  {order.ref}
                </a>
              </td>
              <td className="figures">{formatDate(order.created_at)}</td>
              <td className="figures">{order.lines.length}</td>
              <td>{order.status.replace(/_/g, ' ')}</td>
              <td className="figures">{formatEuros(order.total_cents)}</td>
            </tr>
          ))}
          {orders.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                No group orders yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <table className="ruled" aria-label="Invoices">
        <thead>
          <tr>
            <th scope="col">Number</th>
            <th scope="col">Status</th>
            <th scope="col">Amount</th>
            <th scope="col">Balance</th>
            <th scope="col">Due</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td>{invoice.number}</td>
              <td>{invoice.status.replace(/_/g, ' ')}</td>
              <td className="figures">{formatEuros(invoice.amount_cents)}</td>
              <td className="figures">{formatEuros(invoice.balance_cents)}</td>
              <td className="figures">{formatDate(invoice.due_at)}</td>
            </tr>
          ))}
          {invoices.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                No invoices yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <table className="ruled" aria-label="Credit notes">
        <thead>
          <tr>
            <th scope="col">Number</th>
            <th scope="col">Invoice</th>
            <th scope="col">Amount</th>
            <th scope="col">Issued</th>
          </tr>
        </thead>
        <tbody>
          {creditNotes.map((note) => (
            <tr key={note.id}>
              <td>{note.number}</td>
              <td>{invoices.find((invoice) => invoice.id === note.invoice_id)?.number ?? ''}</td>
              <td className="figures">{formatEuros(note.amount_cents)}</td>
              <td className="figures">{formatDate(note.issued_at)}</td>
            </tr>
          ))}
          {creditNotes.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                No credit notes.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="live-bar">
        <p className="status" role="status" aria-label="Checkout status">
          {status}
        </p>
        <ProblemMark label="Checkout problem" text={problem} />
      </div>

      {prices !== null ? (
        <Checkout
          open={checkoutStep !== null}
          step={checkoutStep ?? 'tickets'}
          onStatus={setStatus}
          onProblem={setProblem}
          days={days}
          sessions={sessions}
          prices={prices}
          openerRef={opener}
          initialPasses={null}
          onClose={() => route.setQuery({ checkout: null })}
          onDone={(order) => route.navigate(`/orders/${order.id}`)}
        />
      ) : null}
    </section>
  );
}
