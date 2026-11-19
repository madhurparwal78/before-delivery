import { useEffect, useRef, useState } from 'react';
import type {
  CreditLedgerEntry,
  Order,
  Render,
  ServicesResponse,
  SplitsResponse,
  StatementResponse,
} from '../../shared/api.js';
import { consoleStatus, outageBanners, type ServiceName } from '../../shared/copy.js';
import { formatPeriod, formatUsd, periodOf, signedAmountLabel } from '../../shared/money.js';
import { api, ApiFailure, createKeyHolder } from '../lib/api.js';
import { useBreakpoint, useDialogFocus, useLoader } from '../lib/hooks.js';
import { useSession } from '../lib/session.js';
import { ErrorSummary } from '../components/ErrorSummary.js';
import { OutageBanner, StatusRegion } from '../components/StatusRegion.js';

type TabId = 'orders' | 'ledger' | 'renders' | 'statements';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'orders', label: 'Orders' },
  { id: 'ledger', label: 'Credit ledger' },
  { id: 'renders', label: 'Renders' },
  { id: 'statements', label: 'Statements' },
];

function RefundDialog({
  order,
  returnFocusTo,
  onClose,
  onRefunded,
}: {
  order: Order;
  returnFocusTo: React.RefObject<HTMLElement | null>;
  onClose(): void;
  onRefunded(message: string): void;
}): JSX.Element {
  const remaining = order.net_cents - order.refunded_net_cents;
  const dialogRef = useDialogFocus(true, onClose, returnFocusTo);
  const amountRef = useRef<HTMLInputElement | null>(null);
  const [amount, setAmount] = useState((remaining / 100).toFixed(2));
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [refundKey] = useState(() => createKeyHolder());

  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  const submit = (): void => {
    const netCents = Math.round(Number.parseFloat(amount) * 100);
    if (!Number.isFinite(netCents) || netCents < 1 || netCents > remaining) {
      setFieldErrors({ net_cents: consoleStatus.refundAmountOutOfRange(remaining) });
      return;
    }
    setBusy(true);
    setFieldErrors({});
    let status: number | null = null;
    void api
      .post<{ refund: { credit_note_number: string } }>(`/api/admin/orders/${order.id}/refunds`, {
        idempotencyKey: refundKey.next(),
        body: { net_cents: netCents, reason },
      })
      .then((response) => {
        onRefunded(consoleStatus.refundIssued(response.refund.credit_note_number));
        onClose();
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) return;
        status = error.status;
        if (error.code === 'refund_window_closed') {
          onRefunded(consoleStatus.refundWindowClosed);
          onClose();
        } else if (error.status === 422) {
          setFieldErrors({ net_cents: consoleStatus.refundAmountOutOfRange(remaining) });
        } else {
          onRefunded(error.message);
          onClose();
        }
      })
      .finally(() => {
        refundKey.reuseAfterFailure(status);
        setBusy(false);
      });
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Refund order" ref={dialogRef}>
      <div className="modal__panel">
        <h2 className="modal__title display">Refund order.</h2>
        <p className="muted">
          {order.piece_title} · edition {order.edition} of {order.edition_count} ·{' '}
          {order.invoice_number}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <ErrorSummary errors={fieldErrors} labels={{ net_cents: 'Refund amount (USD)' }} />
          <label className="field" htmlFor="net_cents">
            <span className="field__label">Refund amount (USD)</span>
            <input
              id="net_cents"
              ref={amountRef}
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            {fieldErrors.net_cents && <span className="field-error">{fieldErrors.net_cents}</span>}
          </label>
          <label className="field" htmlFor="refund-reason">
            <span className="field__label">Reason</span>
            <input
              id="refund-reason"
              type="text"
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="modal__actions">
            <button type="submit" className="next-action" disabled={busy}>
              Issue refund
            </button>
            <button type="button" className="ghost-button" onClick={onClose}>
              Close
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OrdersTab({ onMessage }: { onMessage(message: string): void }): JSX.Element {
  const breakpoint = useBreakpoint();
  const orders = useLoader(() => api.get<{ orders: Order[] }>('/api/admin/orders'), [], 15000);
  const [refunding, setRefunding] = useState<Order | null>(null);
  const [splits, setSplits] = useState<Record<string, SplitsResponse>>({});
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const rows = orders.data?.orders ?? [];

  const toggleSplits = (order: Order): void => {
    if (splits[order.id]) {
      setSplits((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      return;
    }
    void api
      .get<SplitsResponse>(`/api/admin/orders/${order.id}/splits`)
      .then((value) => setSplits((current) => ({ ...current, [order.id]: value })))
      .catch(() => undefined);
  };

  if (breakpoint === 'phone') {
    return (
      <>
        <ul className="console__stack">
          {rows.map((order) => (
            <li key={order.id} className="console__card">
              <p className="display">{order.piece_title}</p>
              <p className="tabular">
                <span className="muted">Edition</span> {order.edition} of {order.edition_count}
              </p>
              <p>
                <span className="muted">State</span> {order.state}
              </p>
              <p className="tabular mono">
                <span className="muted">Invoice</span> {order.invoice_number ?? '—'}
              </p>
              <p className="tabular">
                <span className="muted">Net</span> ${formatUsd(order.net_cents)}
              </p>
              <p className="tabular">
                <span className="muted">Refunded</span> ${formatUsd(order.refunded_net_cents)}
              </p>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setRefunding(order)}
                disabled={order.state !== 'receipted'}
              >
                Refund
              </button>
            </li>
          ))}
        </ul>
        {refunding && (
          <RefundDialog
            order={refunding}
            returnFocusTo={buttonRef}
            onClose={() => setRefunding(null)}
            onRefunded={(message) => {
              onMessage(message);
              orders.refresh();
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <table className="data-table" aria-label="Orders">
        <thead>
          <tr>
            <th scope="col">Piece</th>
            <th scope="col">Edition</th>
            <th scope="col">State</th>
            <th scope="col">Invoice</th>
            <th scope="col" className="amount">
              Net
            </th>
            <th scope="col" className="amount">
              Refunded
            </th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((order) => (
            <>
              <tr key={order.id}>
                <th scope="row">{order.piece_title}</th>
                <td className="tabular">
                  {order.edition} of {order.edition_count}
                </td>
                <td>{order.state}</td>
                <td className="tabular mono">{order.invoice_number ?? '—'}</td>
                <td className="amount tabular">${formatUsd(order.net_cents)}</td>
                <td className="amount tabular">${formatUsd(order.refunded_net_cents)}</td>
                <td className="console__row-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    ref={buttonRef}
                    onClick={() => setRefunding(order)}
                    disabled={order.state !== 'receipted'}
                  >
                    Refund
                  </button>
                  <button type="button" className="ghost-button" onClick={() => toggleSplits(order)}>
                    Splits
                  </button>
                </td>
              </tr>
              {splits[order.id] && (
                <tr key={`${order.id}-splits`} className="console__splits">
                  <td colSpan={7}>
                    <table className="data-table data-table--nested">
                      <thead>
                        <tr>
                          <th scope="col">Party</th>
                          <th scope="col">Holder</th>
                          <th scope="col">Kind</th>
                          <th scope="col" className="amount">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {splits[order.id]?.rows.map((row, index) => (
                          <tr key={index}>
                            <td>{row.party}</td>
                            <td>{row.holder}</td>
                            <td>{row.kind}</td>
                            <td className="amount tabular">
                              {signedAmountLabel(row.amount_cents, row.kind === 'refund' ? 'refund' : 'credit')}
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={3}>Net</td>
                          <td className="amount tabular">
                            ${formatUsd(splits[order.id]?.net_cents ?? 0)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>

      {refunding && (
        <RefundDialog
          order={refunding}
          returnFocusTo={buttonRef}
          onClose={() => setRefunding(null)}
          onRefunded={(message) => {
            onMessage(message);
            orders.refresh();
          }}
        />
      )}
    </>
  );
}

function LedgerTab(): JSX.Element {
  const ledger = useLoader(
    () =>
      api.get<{ accounts: { account: string; balance: number }[]; entries: CreditLedgerEntry[] }>(
        '/api/admin/credit-ledger',
      ),
    [],
    15000,
  );

  return (
    <>
      <table className="data-table" aria-label="Credit accounts">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col" className="amount">
              Balance
            </th>
          </tr>
        </thead>
        <tbody>
          {(ledger.data?.accounts ?? []).map((account) => (
            <tr key={account.account}>
              <th scope="row" className="mono">
                {account.account}
              </th>
              <td className="amount tabular">
                {account.balance < 0 ? '\u2212' : '+'}
                {Math.abs(account.balance)}{' '}
                <span className="muted">{account.balance < 0 ? 'debit' : 'credit'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="data-table" aria-label="Credit ledger entries">
        <thead>
          <tr>
            <th scope="col">Entry</th>
            <th scope="col">Account</th>
            <th scope="col" className="amount">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {(ledger.data?.entries ?? []).flatMap((entry) =>
            entry.rows.map((row, index) => (
              <tr key={`${entry.id}-${index}`}>
                <th scope="row">{index === 0 ? entry.kind : ''}</th>
                <td className="mono">{row.account}</td>
                <td className="amount tabular">
                  {row.amount < 0 ? '\u2212' : '+'}
                  {Math.abs(row.amount)}{' '}
                  <span className="muted">{row.amount < 0 ? 'debit' : 'credit'}</span>
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </>
  );
}

function RendersTab(): JSX.Element {
  const renders = useLoader(() => api.get<{ renders: Render[] }>('/api/admin/renders'), [], 15000);
  return (
    <table className="data-table" aria-label="Renders">
      <thead>
        <tr>
          <th scope="col">Piece</th>
          <th scope="col">State</th>
          <th scope="col">Failure</th>
          <th scope="col" className="amount">
            Cost
          </th>
          <th scope="col" className="amount">
            Attempts
          </th>
        </tr>
      </thead>
      <tbody>
        {(renders.data?.renders ?? []).map((render) => (
          <tr key={render.id}>
            <th scope="row">{render.piece_slug}</th>
            <td>{render.state}</td>
            <td>{render.failure_reason ?? '—'}</td>
            <td className="amount tabular">{render.cost_credits}</td>
            <td className="amount tabular">{render.attempts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatementsTab({ onMessage }: { onMessage(message: string): void }): JSX.Element {
  const [busy, setBusy] = useState(false);

  // The month that has just ended is the one a founder closes.
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const period = periodOf(lastMonth);
  const statement = useLoader(
    () => api.get<StatementResponse>(`/api/me/statements/${period}`).catch(() => null),
    [period],
  );

  const close = (): void => {
    setBusy(true);
    void api
      .post<{ period: string; creators: number }>('/api/admin/statements', { body: { period } })
      .then((response) => onMessage(consoleStatus.statementsClosed(response.period, response.creators)))
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) return;
        if (error.code === 'period_open') onMessage(consoleStatus.periodOpen(period));
        else onMessage(error.message);
      })
      .finally(() => {
        setBusy(false);
        statement.refresh();
      });
  };

  return (
    <div className="console__statements">
      <button type="button" className="next-action" onClick={close} disabled={busy}>
        Close {formatPeriod(period)}
      </button>
      {statement.data && (
        <p className="muted">
          {formatPeriod(period)} is {statement.data.status}.
        </p>
      )}
    </div>
  );
}

export function Console(): JSX.Element {
  const session = useSession();
  const [tab, setTab] = useState<TabId>('orders');
  const [message, setMessage] = useState<string | null>(null);
  const services = useLoader(() => api.get<ServicesResponse>('/api/admin/services'), [], 10000);

  if (!session.loading && !session.isFounder) {
    return (
      <div className="shell console">
        <h1 className="display">Only the founder-operator can open the console.</h1>
      </div>
    );
  }

  const unreachable = (services.data?.services ?? []).filter((service) => !service.reachable);

  return (
    <div className="shell console">
      <h1 className="console__title display">Console.</h1>

      <section className="console__notices" aria-label="Service notices">
        {unreachable.map((service) => (
          <OutageBanner key={service.name} message={outageBanners[service.name as ServiceName]} />
        ))}
      </section>

      <div className="console__tabs" role="tablist" aria-label="Console">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`panel-${entry.id}`}
            className={`console__tab${tab === entry.id ? ' is-active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div
        className="console__panel"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === 'orders' && <OrdersTab onMessage={setMessage} />}
        {tab === 'ledger' && <LedgerTab />}
        {tab === 'renders' && <RendersTab />}
        {tab === 'statements' && <StatementsTab onMessage={setMessage} />}
      </div>

      <StatusRegion label="Console status" message={message} />
    </div>
  );
}
