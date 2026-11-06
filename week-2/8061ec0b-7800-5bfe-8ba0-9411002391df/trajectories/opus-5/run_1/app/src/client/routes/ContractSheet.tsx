import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { animate } from 'motion';
import { formatMoney, formatTaxPercent } from '../../shared/money';
import { equityEntryText, historyLine } from '../../shared/labels';
import { formatStoreDate, formatStoreDateTime } from '../../shared/time';
import { STRING_SIZES } from '../../shared/types';
import type {
  ConditionEvent,
  Contract,
  EquityStatement,
  Invoice,
  Payment,
  Quote,
} from '../../shared/types';
import { useSession } from '../app';
import { api, ApiFailure, NetworkFailure, newIdempotencyKey } from '../lib/api';
import { NETWORK_COPY, PENDING } from '../lib/copy';
import { prefersReducedMotion, SPEED } from '../lib/motion';
import { takeRowOrigin } from '../lib/transition';
import { BuyoutRail, railAnnouncement } from '../components/BuyoutRail';
import { Dialog } from '../components/Dialog';
import { InstrumentModel } from '../components/InstrumentModel';
import { StatusLine } from '../components/StatusLine';

const STATUS_WORDS: Record<string, string> = {
  reserved: 'Reserved',
  agreement_sent: 'Agreement sent',
  signed: 'Signed',
  active: 'Active',
  expired: 'Expired',
  exchanged: 'Exchanged',
  paid_off: 'Owned',
  returned: 'Returned',
  written_off: 'Written off',
};

interface SheetData {
  contract: Contract;
  invoice: Invoice | null;
  equity: EquityStatement | null;
  quotes: Quote[];
  events: ConditionEvent[];
  payments: Payment[];
  parentEmail: string;
}

export function ContractSheet(): ReactNode {
  const { id = '' } = useParams();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation() as { state: { status?: string } | null };
  const [data, setData] = useState<SheetData | null>(null);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState(location.state?.status ?? '');
  const [statusError, setStatusError] = useState(false);
  const [railStatus, setRailStatus] = useState('');
  const [month, setMonth] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [openDialog, setOpenDialog] = useState<
    'payment' | 'reversal' | 'exchange' | 'return' | 'write-off' | 'buyout' | 'condition' | null
  >(null);
  const [reversalPaymentId, setReversalPaymentId] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const isTech = user?.role === 'tech';
  const canSeeMoney = user?.role === 'owner' || user?.role === 'parent';

  const load = useCallback(async () => {
    try {
      const contractAnswer = await api<{ contract: Contract }>(`/contracts/${id}`);
      const contract = contractAnswer.contract;
      const events = (await api<{ events: ConditionEvent[] }>(`/contracts/${id}/condition-events`)).events;
      let invoice: Invoice | null = null;
      let equity: EquityStatement | null = null;
      let quotes: Quote[] = [];
      let payments: Payment[] = [];
      let email = user?.role === 'parent' ? user.email : '';
      if (user?.role === 'owner' || user?.role === 'parent') {
        invoice = (await api<{ invoice: Invoice }>(`/contracts/${id}/invoice`)).invoice;
        equity = await api<EquityStatement>(`/contracts/${id}/equity`);
        payments = (await api<{ payments: Payment[] }>(`/contracts/${id}/payments`)).payments;
        if (contract.status === 'signed' || contract.status === 'active') {
          quotes = (await api<{ quotes: Quote[] }>(`/contracts/${id}/quotes`)).quotes;
        }
      }
      if (user?.role === 'owner') {
        const families = await api<{ families: Array<{ id: string; email: string }> }>('/families');
        email = families.families.find((family) => family.id === contract.family_id)?.email ?? '';
      }
      setData({ contract, invoice, equity, quotes, events, payments, parentEmail: email });
      setMissing(false);
    } catch (error) {
      if (error instanceof ApiFailure && (error.status === 404 || error.status === 403)) setMissing(true);
      else if (error instanceof NetworkFailure) {
        setStatus(NETWORK_COPY);
        setStatusError(true);
      }
    }
  }, [id, user?.role, user?.email]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (data === null || month !== null) return;
    const wanted = Number(params.get('month'));
    const term = data.contract.terms.term_months;
    if (params.get('month') !== null && Number.isInteger(wanted) && wanted >= 0 && wanted <= term) {
      setMonth(wanted);
    } else {
      setMonth(data.contract.contract_month);
    }
  }, [data, month, params]);

  useLayoutEffect(() => {
    const element = header.current;
    if (element === null || prefersReducedMotion()) return;
    const origin = takeRowOrigin(id);
    if (origin === null) return;
    const box = element.getBoundingClientRect();
    const scale = box.width === 0 ? 1 : origin.width / box.width;
    element.style.transformOrigin = 'top left';
    element.style.transform = `translate(${origin.left - box.left}px, ${origin.top - box.top}px) scale(${scale}, ${
      box.height === 0 ? 1 : origin.height / box.height
    })`;
    void animate(
      element,
      { transform: [element.style.transform, 'translate(0px, 0px) scale(1, 1)'] },
      { duration: SPEED.medium, ease: 'easeOut' },
    );
  }, [data, month, id]);

  if (missing) {
    return (
      <main className="page">
        <h1>Contract not found</h1>
        {user?.role === 'parent' ? <Link to="/family">My family</Link> : <Link to="/register">Back to the register</Link>}
      </main>
    );
  }

  if (data === null || month === null) return <main className="page">Loading…</main>;

  const { contract, invoice, equity, quotes, events, payments, parentEmail } = data;
  const currentQuote = quotes[contract.contract_month];
  const railQuote = quotes[month];
  const equityFraction =
    contract.status === 'paid_off'
      ? 1
      : quotes.length > 0 && railQuote !== undefined
        ? railQuote.equity_cents / contract.terms.purchase_price_cents
        : contract.equity_cents / contract.terms.purchase_price_cents;
  const percent = Math.floor(equityFraction * 100);

  const closeDialog = (): void => {
    setOpenDialog(null);
    setReversalPaymentId(null);
    openerRef.current?.focus();
  };

  const finish = async (text: string, isError = false): Promise<void> => {
    setStatus(text);
    setStatusError(isError);
    await load();
    requestAnimationFrame(() => statusRef.current?.focus());
  };

  const runAction = async (
    pending: string,
    call: () => Promise<string>,
    errorCopy: (error: ApiFailure) => string,
  ): Promise<void> => {
    setBusy(true);
    setStatus(pending);
    setStatusError(false);
    try {
      const message = await call();
      setOpenDialog(null);
      setReversalPaymentId(null);
      await finish(message);
    } catch (error) {
      if (error instanceof ApiFailure) await finish(errorCopy(error), true);
      else if (error instanceof NetworkFailure) await finish(NETWORK_COPY, true);
    } finally {
      setBusy(false);
    }
  };

  const openWith = (
    dialog: 'payment' | 'reversal' | 'exchange' | 'return' | 'write-off' | 'buyout' | 'condition',
    event: React.MouseEvent | React.KeyboardEvent,
  ): void => {
    openerRef.current = event.currentTarget as HTMLElement;
    setOpenDialog(dialog);
  };

  const sendSigningLink = (): void =>
    void runAction(
      PENDING.sendLink,
      async () => {
        const answer = await api<{ contract: Contract }>(`/contracts/${id}/signing-link`, {
          method: 'POST',
          body: {},
        });
        const expires = answer.contract.signing_link.expires_at ?? '';
        return `Signing link queued for ${parentEmail}. It works until ${formatStoreDateTime(expires)}.`;
      },
      (error) => (error.status === 409 ? "This contract can't be sent for signing now." : error.message),
    );

  const revokeSigningLink = (): void =>
    void runAction(
      PENDING.revokeLink,
      async () => {
        await api(`/contracts/${id}/signing-link/revoke`, { method: 'POST', body: {} });
        return 'Signing link revoked.';
      },
      (error) => (error.code === 'no_live_link' ? 'There is no live signing link to revoke.' : error.message),
    );

  const activate = (): void =>
    void runAction(
      PENDING.activate,
      async () => {
        await api(`/contracts/${id}/activate`, { method: 'POST', body: {} });
        return 'Contract active. Monthly billing is set up.';
      },
      (error) => {
        if (error.code === 'invalid_transition') return "This contract can't be activated now.";
        if (error.code === 'agreement_not_stored') return "The signed agreement isn't stored yet.";
        if (error.code === 'billing_unavailable') {
          return 'Billing is unreachable. The contract is still signed; try again in a moment.';
        }
        if (error.code === 'storage_unavailable') {
          return 'File storage is unreachable. The contract is still signed; try again in a moment.';
        }
        return error.message;
      },
    );

  const close = (kind: 'return' | 'write-off'): void =>
    void runAction(
      PENDING.close,
      async () => {
        await api(`/contracts/${id}/${kind}`, { method: 'POST', body: {} });
        return kind === 'return' ? 'Contract marked returned.' : 'Contract written off.';
      },
      (error) =>
        error.status === 503
          ? "Billing is unreachable or hasn't confirmed the cancellation. Nothing was changed; try again in a moment."
          : error.message,
    );

  const railStatusFor = (next: number): void => {
    setRailStatus(railAnnouncement(next, quotes[next]));
    const nextParams = new URLSearchParams(params);
    nextParams.set('month', String(next));
    setParams(nextParams, { replace: true });
  };

  return (
    <main className="page">
      <div className="contract-header" ref={header} role="group" aria-label="Contract header">
        <h1>{`${contract.id} · ${contract.instrument.label} ${contract.instrument.serial}`}</h1>
        <p>
          <span className="mono">{contract.instrument.serial}</span> · {contract.student.name} ·{' '}
          {contract.school.name} · {STATUS_WORDS[contract.status] ?? contract.status}
        </p>
      </div>

      <StatusLine name="Contract status" text={status} error={statusError} ref={statusRef} />

      {user?.role === 'owner' ? (
        <p className="dialog-actions">
          {contract.status === 'reserved' || contract.status === 'agreement_sent' ? (
            <button type="button" onClick={sendSigningLink} disabled={busy}>
              Send signing link
            </button>
          ) : null}
          {contract.signing_link.status === 'live' ? (
            <button type="button" onClick={revokeSigningLink} disabled={busy}>
              Revoke signing link
            </button>
          ) : null}
          {contract.status === 'signed' ? (
            <button type="button" className="primary" onClick={activate} disabled={busy}>
              Activate contract
            </button>
          ) : null}
          {contract.status === 'active' ? (
            <button type="button" onClick={(event) => openWith('payment', event)}>
              Record payment
            </button>
          ) : null}
          {contract.status === 'active' &&
          (contract.instrument.instrument_type === 'violin' || contract.instrument.instrument_type === 'cello') ? (
            <button type="button" onClick={(event) => openWith('exchange', event)}>
              Exchange size
            </button>
          ) : null}
          {contract.status === 'active' ? (
            <button type="button" onClick={(event) => openWith('return', event)}>
              Mark returned
            </button>
          ) : null}
          {contract.status === 'active' ? (
            <button type="button" className="danger" onClick={(event) => openWith('write-off', event)}>
              Write off
            </button>
          ) : null}
          {contract.status === 'active' && currentQuote !== undefined ? (
            <button type="button" className="primary" onClick={(event) => openWith('buyout', event)}>
              {`Buy out for ${formatMoney(currentQuote.total_cents)}`}
            </button>
          ) : null}
          {['signed', 'active', 'exchanged', 'returned'].includes(contract.status) ? (
            <button type="button" onClick={(event) => openWith('condition', event)}>
              Record condition
            </button>
          ) : null}
        </p>
      ) : null}

      {user?.role === 'parent' && contract.status === 'active' && currentQuote !== undefined ? (
        <p>
          <button type="button" className="primary" onClick={(event) => openWith('buyout', event)}>
            {`Buy out for ${formatMoney(currentQuote.total_cents)}`}
          </button>
        </p>
      ) : null}

      {isTech ? (
        <p>
          {['signed', 'active', 'exchanged', 'returned'].includes(contract.status) ? (
            <button type="button" onClick={(event) => openWith('condition', event)}>
              Record condition
            </button>
          ) : null}
        </p>
      ) : null}

      <div className="sheet-columns">
        <div>
          <div className="drawing-group" role="group" aria-label={`${contract.instrument.label} drawing`}>
            <InstrumentModel
              type={contract.instrument.instrument_type}
              size={contract.instrument.size}
              label={contract.instrument.label}
              fraction={canSeeMoney ? equityFraction : null}
            />
            {canSeeMoney ? (
              <span
                className="equity-gauge"
                role="img"
                aria-label={`Equity fill, ${percent}% owned`}
                style={{ height: `${Math.max(0, Math.min(100, equityFraction * 100))}%` }}
              />
            ) : null}
          </div>
        </div>

        <div>
          {canSeeMoney ? (
            <>
              <section aria-label="Terms">
                <h2>Terms</h2>
                <ul className="terms-list">
                  <li>
                    <span className="label">Price list</span>
                    <span className="mono">{contract.terms.price_list_id}</span>
                  </li>
                  <li>
                    <span className="label">Monthly rent</span>
                    <span className="figure">{formatMoney(contract.terms.base_rent_cents)}</span>
                  </li>
                  <li>
                    <span className="label">Waiver</span>
                    <span className="figure">
                      {contract.waiver ? formatMoney(contract.terms.waiver_cents) : 'Not included'}
                    </span>
                  </li>
                  <li>
                    <span className="label">Sales tax today</span>
                    <span className="figure">{formatTaxPercent(contract.terms.tax_rate_bp)}</span>
                  </li>
                  <li>
                    <span className="label">Purchase price</span>
                    <span className="figure">{formatMoney(contract.terms.purchase_price_cents)}</span>
                  </li>
                  <li>
                    <span className="label">Term</span>
                    <span className="figure">{`${contract.terms.term_months} months`}</span>
                  </li>
                  {contract.terms.tiers.map((tier) => (
                    <li key={tier.name}>
                      <span className="label">Tier</span>
                      <span>{tier.label}</span>
                    </li>
                  ))}
                  <li>
                    <span className="figure">
                      {contract.billing_anchor_date === null
                        ? 'Billing anchor —'
                        : `Billing anchor ${formatStoreDate(contract.billing_anchor_date)}`}
                    </span>
                  </li>
                  <li>
                    <span className="figure">
                      {contract.next_billing_date === null
                        ? 'Next billing —'
                        : `Next billing ${formatStoreDate(contract.next_billing_date)}`}
                    </span>
                  </li>
                  <li>
                    <span className="label">Equity</span>
                    <span className="brass">{formatMoney(contract.equity_cents)}</span>
                  </li>
                </ul>
              </section>

              {invoice === null ? null : (
                <table className="stacked-table" aria-label="Monthly invoice">
                  <caption>
                    {invoice.billing_date === null
                      ? 'Not billing'
                      : `Due ${formatStoreDate(invoice.billing_date)}`}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Line</th>
                      <th scope="col">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lines.map((line) => (
                      <tr key={line.code}>
                        <td data-label="Line">{line.label}</td>
                        <td data-label="Amount" className="figure">
                          {formatMoney(line.amount_cents)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td data-label="Line">Total</td>
                      <td data-label="Amount" className="figure">
                        {formatMoney(invoice.total_cents)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
              {equity === null ? null : (
                <table className="stacked-table" aria-label="Equity ledger">
                  <caption>Equity ledger</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Entry</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Equity after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equity.entries.map((entry, index) => {
                      const runningTotal = equity.entries
                        .slice(0, index + 1)
                        .reduce((sum, item) => sum + item.amount_cents, 0);
                      const text = equityEntryText(entry, contract.successor_id, contract.predecessor_id);
                      return (
                        <tr key={entry.id} className={entry.kind === 'reversal' ? 'ledger-reversal' : undefined}>
                          <td data-label="Date" className="figure">
                            {formatStoreDate(entry.created_at.slice(0, 10))}
                          </td>
                          <td data-label="Entry">
                            {entry.reversed === true ? `${text} (reversed)` : text}
                            {user?.role === 'owner' &&
                            contract.status === 'active' &&
                            entry.kind === 'payment' &&
                            entry.reversed === false ? (
                              <>
                                {' '}
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={(event) => {
                                    setReversalPaymentId(entry.payment_id);
                                    openWith('reversal', event);
                                  }}
                                >
                                  {`Reverse ${entry.payment_id ?? ''}`}
                                </button>
                              </>
                            ) : null}
                          </td>
                          <td data-label="Amount" className={entry.amount_cents < 0 ? 'figure amount' : 'figure amount brass'}>
                            {formatMoney(entry.amount_cents)}
                          </td>
                          <td data-label="Equity after" className="figure">
                            {formatMoney(runningTotal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              <p>
                {contract.agreement_stored ? (
                  <a href={`/api/contracts/${contract.id}/agreement.pdf`}>Signed agreement (PDF)</a>
                ) : null}
                {contract.bill_of_sale_stored ? (
                  <>
                    {' '}
                    <a href={`/api/contracts/${contract.id}/bill-of-sale.pdf`}>Bill of sale (PDF)</a>
                  </>
                ) : null}
              </p>

              {user?.role === 'owner' ? (
                <p>
                  <span className="label">Signing link </span>
                  {contract.signing_link.status}
                  {contract.signing_link.expires_at === null
                    ? ''
                    : ` until ${formatStoreDateTime(contract.signing_link.expires_at)}`}
                </p>
              ) : null}

              <h2>Contract history</h2>
              <ul className="history-list" aria-label="Contract history">
                {contract.history.map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>{historyLine(entry)}</li>
                ))}
              </ul>
            </>
          ) : null}

          <h2>Condition history</h2>
          <ul className="plain" aria-label="Condition history">
            {events.length === 0 ? <li>No condition checks yet.</li> : null}
            {events.map((event) => (
              <li key={event.id}>
                <span className="label">{event.kind}</span> {formatStoreDateTime(event.created_at)} ·{' '}
                {event.recorded_by}
                {event.notes === null || event.notes === '' ? null : ` · ${event.notes}`}
                <ul className="thumbs">
                  {event.photos.map((photo) => (
                    <li key={photo.id}>
                      <img src={photo.url} alt={`Condition photo ${photo.id}`} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {canSeeMoney && (contract.status === 'signed' || contract.status === 'active') && quotes.length > 0 ? (
        <BuyoutRail
          quotes={quotes}
          tiers={contract.terms.tiers}
          termMonths={contract.terms.term_months}
          contractMonth={contract.contract_month}
          month={month}
          onMonth={setMonth}
          onRelease={railStatusFor}
          status={railStatus}
        />
      ) : null}

      {canSeeMoney && contract.status === 'paid_off' ? <p className="brass">Owned</p> : null}

      <PaymentDialog
        open={openDialog === 'payment'}
        busy={busy}
        onCancel={closeDialog}
        onSave={(amountCents) =>
          void runAction(
            PENDING.payment,
            async () => {
              const answer = await api<{ payment: { base_rent_cents: number; waiver_cents: number; tax_cents: number }; contract: Contract }>(
                `/contracts/${id}/payments`,
                { method: 'POST', body: { amount_cents: amountCents }, idempotencyKey: newIdempotencyKey() },
              );
              const paidOff = answer.contract.status === 'paid_off';
              return `Payment of ${formatMoney(amountCents)} recorded: ${formatMoney(
                answer.payment.base_rent_cents,
              )} rent toward ownership, ${formatMoney(answer.payment.waiver_cents)} waiver, ${formatMoney(
                answer.payment.tax_cents,
              )} tax. Receipt queued for ${parentEmail}.${paidOff ? ' The instrument is now owned.' : ''}`;
            },
            (error) => {
              if (error.status === 422 && error.fields?.amount_cents === 'exceeds_remaining') {
                return "That's more than the remaining balance. Use buyout instead.";
              }
              if (error.status === 422) return 'Enter an amount above $0.00.';
              if (error.code === 'invalid_transition') return "This contract can't take payments now.";
              if (error.code === 'idempotency_conflict') {
                return 'Billing already holds a different charge for this payment. Nothing was recorded.';
              }
              if (error.code === 'billing_unavailable') {
                return 'Billing is unreachable. Nothing was recorded; try again in a moment.';
              }
              if (error.code === 'storage_unavailable') {
                return "File storage is unreachable, so this final payment can't close the contract. Nothing was recorded; try again in a moment.";
              }
              return error.message;
            },
          )
        }
      />

      <ReversalDialog
        open={openDialog === 'reversal'}
        busy={busy}
        paymentId={reversalPaymentId}
        contract={contract}
        payments={payments}
        onCancel={closeDialog}
        onConfirm={(reason) =>
          void runAction(
            PENDING.reversal,
            async () => {
              const answer = await api<{ reversal: { amount_cents: number; base_rent_cents: number } }>(
                `/contracts/${id}/payments/${reversalPaymentId ?? ''}/reversal`,
                { method: 'POST', body: { reason }, idempotencyKey: newIdempotencyKey() },
              );
              return `Payment ${reversalPaymentId ?? ''} reversed: ${formatMoney(
                answer.reversal.amount_cents,
              )} refunded, ${formatMoney(answer.reversal.base_rent_cents)} equity removed.`;
            },
            (error) => {
              if (error.code === 'payment_reversed') return `Payment ${reversalPaymentId ?? ''} was already reversed.`;
              if (error.code === 'invalid_transition') return 'Payments can only be reversed on an active contract.';
              if (error.status === 422) return 'Choose a reason.';
              if (error.status === 503) return 'Billing is unreachable. Nothing was reversed; try again in a moment.';
              return error.message;
            },
          )
        }
      />

      <ExchangeDialog
        open={openDialog === 'exchange'}
        busy={busy}
        contract={contract}
        onCancel={closeDialog}
        onConfirm={(size) =>
          void runAction(
            PENDING.exchange,
            async () => {
              const answer = await api<{ new_contract: Contract; old_contract: Contract }>(
                `/contracts/${id}/exchange`,
                { method: 'POST', body: { size }, idempotencyKey: newIdempotencyKey() },
              );
              const successor = answer.new_contract;
              const message = `Exchanged to ${successor.instrument.label} ${successor.instrument.serial}. ${formatMoney(
                successor.equity_cents,
              )} equity moved from ${answer.old_contract.id}.`;
              navigate(`/contracts/${successor.id}`, { state: { status: message } });
              return message;
            },
            (error) => {
              if (error.code === 'unavailable') return 'That size is no longer available.';
              if (error.code === 'billing_unavailable') {
                return 'Billing is unreachable. Nothing was exchanged; try again in a moment.';
              }
              if (error.code === 'storage_unavailable') {
                return 'File storage is unreachable. Nothing was exchanged; try again in a moment.';
              }
              return error.message;
            },
          )
        }
      />

      <Dialog name="Confirm return" open={openDialog === 'return'} onCancel={closeDialog}>
        <h2>Confirm return</h2>
        <p>{`Mark ${contract.id} returned and release ${contract.instrument.serial}?`}</p>
        <div className="dialog-actions">
          <button type="button" className="primary" disabled={busy} onClick={() => close('return')}>
            Confirm
          </button>
          <button type="button" onClick={closeDialog}>
            Cancel
          </button>
        </div>
      </Dialog>

      <Dialog name="Confirm write-off" open={openDialog === 'write-off'} onCancel={closeDialog}>
        <h2>Confirm write-off</h2>
        <p>{`Write off ${contract.id} and retire ${contract.instrument.serial}?`}</p>
        <div className="dialog-actions">
          <button type="button" className="danger" disabled={busy} onClick={() => close('write-off')}>
            Confirm
          </button>
          <button type="button" onClick={closeDialog}>
            Cancel
          </button>
        </div>
      </Dialog>

      <Dialog name="Confirm buyout" open={openDialog === 'buyout'} onCancel={closeDialog}>
        <h2>Confirm buyout</h2>
        <p>
          {currentQuote === undefined
            ? ''
            : `Pay ${formatMoney(currentQuote.total_cents)} now (${formatMoney(
                currentQuote.payoff_cents,
              )} plus ${formatMoney(currentQuote.tax_cents)} tax) and own ${contract.instrument.serial}. ${
                currentQuote.tier.label
              } applies.`}
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              void runAction(
                PENDING.buyout,
                async () => {
                  const answer = await api<{ buyout: { total_cents: number } }>(`/contracts/${id}/buyout`, {
                    method: 'POST',
                    body: { expected_payoff_cents: currentQuote?.payoff_cents ?? 0 },
                    idempotencyKey: newIdempotencyKey(),
                  });
                  return `Bought out for ${formatMoney(answer.buyout.total_cents)}. ${
                    contract.student.name
                  } owns ${contract.instrument.serial}. Ownership letter queued for ${parentEmail}.`;
                },
                (error) => {
                  if (error.code === 'quote_changed' && error.quote !== undefined) {
                    return `The payoff is now ${formatMoney(error.quote.total_cents)} with tax. Review and confirm again.`;
                  }
                  if (error.code === 'invalid_transition') return "This contract can't be bought out now.";
                  if (error.code === 'billing_unavailable') {
                    return 'Billing is unreachable. The contract is unchanged; try again in a moment.';
                  }
                  if (error.code === 'storage_unavailable') {
                    return 'File storage is unreachable. Nothing was charged; the contract is unchanged.';
                  }
                  return error.message;
                },
              )
            }
          >
            Confirm buyout
          </button>
          <button type="button" onClick={closeDialog}>
            Cancel
          </button>
        </div>
      </Dialog>

      <ConditionDialog
        open={openDialog === 'condition'}
        contractId={id}
        onCancel={closeDialog}
        onSaved={(count) => {
          setOpenDialog(null);
          void finish(`Condition recorded with ${count} photos.`);
        }}
      />
    </main>
  );
}

function PaymentDialog({
  open,
  busy,
  onCancel,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (amountCents: number) => void;
}): ReactNode {
  const [amount, setAmount] = useState('');

  const submit = (): void => {
    const trimmed = amount.trim().replace(/[$,]/g, '');
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
    const cents = match === null ? 0 : Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
    onSave(cents);
  };

  return (
    <Dialog name="Record payment" open={open} onCancel={onCancel}>
      <h2>Record payment</h2>
      <div className="field">
        <label htmlFor="payment-amount">Amount</label>
        <input
          id="payment-amount"
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
        />
      </div>
      <div className="dialog-actions">
        <button type="button" className="primary" disabled={busy} onClick={submit}>
          Save payment
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

function ReversalDialog({
  open,
  busy,
  paymentId,
  contract,
  payments,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  paymentId: string | null;
  contract: Contract;
  payments: Payment[];
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}): ReactNode {
  const [reason, setReason] = useState('returned_check');
  const payment = payments.find((item) => item.id === paymentId);

  return (
    <Dialog name="Reverse payment" open={open} onCancel={onCancel}>
      <h2>Reverse payment</h2>
      <p>
        {`Refund ${formatMoney(payment?.amount_cents ?? 0)} and remove ${formatMoney(
          payment?.base_rent_cents ?? 0,
        )} of equity from ${contract.id}?`}
      </p>
      <p className="label">Reason</p>
      <div role="radiogroup" aria-label="Reason" className="radio-row">
        {(
          [
            ['returned_check', 'Returned check'],
            ['chargeback', 'Chargeback'],
            ['entered_in_error', 'Entered in error'],
          ] as const
        ).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="reversal-reason"
              value={value}
              checked={reason === value}
              onChange={() => setReason(value)}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <button type="button" className="danger" disabled={busy} onClick={() => onConfirm(reason)}>
          Confirm reversal
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

function ExchangeDialog({
  open,
  busy,
  contract,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  contract: Contract;
  onCancel: () => void;
  onConfirm: (size: string) => void;
}): ReactNode {
  const [sizes, setSizes] = useState<Array<{ size: string; available: number }>>([]);
  const [chosen, setChosen] = useState('');

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const answer = await api<{ items: Array<{ instrument_type: string; size: string; available: number }> }>(
        '/availability',
      );
      const current = STRING_SIZES.indexOf(contract.instrument.size as (typeof STRING_SIZES)[number]);
      const larger = answer.items.filter(
        (item) =>
          item.instrument_type === contract.instrument.instrument_type &&
          STRING_SIZES.indexOf(item.size as (typeof STRING_SIZES)[number]) > current,
      );
      setSizes(larger.map((item) => ({ size: item.size, available: item.available })));
      setChosen(larger.find((item) => item.available > 0)?.size ?? '');
    })();
  }, [open, contract.instrument.instrument_type, contract.instrument.size]);

  return (
    <Dialog name="Exchange size" open={open} onCancel={onCancel}>
      <h2>Exchange size</h2>
      <p className="label">New size</p>
      <div role="radiogroup" aria-label="New size" className="radio-row">
        {sizes.map((entry) => (
          <label key={entry.size}>
            <input
              type="radio"
              name="new-size"
              value={entry.size}
              disabled={entry.available === 0}
              checked={chosen === entry.size}
              onChange={() => setChosen(entry.size)}
            />
            {`${entry.size}, ${entry.available} available`}
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <button type="button" className="primary" disabled={busy || chosen === ''} onClick={() => onConfirm(chosen)}>
          Confirm exchange
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

interface ChosenPhoto {
  file: File;
  url: string;
  refused: boolean;
}

function ConditionDialog({
  open,
  contractId,
  onCancel,
  onSaved,
}: {
  open: boolean;
  contractId: string;
  onCancel: () => void;
  onSaved: (count: number) => void;
}): ReactNode {
  const [kind, setKind] = useState('checkout');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<ChosenPhoto[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const removeRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (open) return;
    setPhotos([]);
    setStatus('');
    setNotes('');
  }, [open]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setStatus(PENDING.condition);
    const form = new FormData();
    form.set('kind', kind);
    form.set('notes', notes);
    for (const photo of photos) form.append('photos', photo.file, photo.file.name);
    try {
      await api(`/contracts/${contractId}/condition-events`, { method: 'POST', form });
      onSaved(photos.length);
      setPhotos([]);
      setStatus('');
    } catch (error) {
      if (error instanceof ApiFailure) {
        const index = error.photoIndex;
        const fileName = index === undefined ? '' : photos[index]?.file.name ?? '';
        if (index !== undefined) {
          setPhotos((current) => current.map((photo, position) => ({ ...photo, refused: position === index })));
          requestAnimationFrame(() => removeRefs.current[index]?.focus());
        }
        if (error.code === 'unsupported_image') {
          setStatus(`${fileName} isn't a JPEG, PNG or WebP photo. Nothing was saved.`);
        } else if (error.code === 'photo_too_large') {
          setStatus(`${fileName} is over 5,000,000 bytes. Nothing was saved.`);
        } else if (error.status === 422 && error.fields?.photos === 'dimensions') {
          setStatus(`${fileName} is over 8,000 pixels on a side. Nothing was saved.`);
        } else if (error.status === 422 && error.fields?.photos === 'count') {
          setStatus('Add between 1 and 6 photos.');
        } else if (error.code === 'payload_too_large') {
          setStatus('These photos are too large to send together. Nothing was saved.');
        } else if (error.code === 'contract_not_open') {
          setStatus("Condition can't be recorded on this contract.");
        } else if (error.status === 503) {
          setStatus('File storage is unreachable. Nothing was saved; try again in a moment.');
        } else {
          setStatus(error.message);
        }
      } else if (error instanceof NetworkFailure) {
        setStatus(NETWORK_COPY);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog name="Record condition" open={open} onCancel={onCancel}>
      <h2>Record condition</h2>
      <p className="label">Condition check</p>
      <div role="radiogroup" aria-label="Condition check" className="radio-row">
        {(
          [
            ['checkout', 'Check-out'],
            ['exchange', 'Exchange'],
            ['return', 'Return'],
          ] as const
        ).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="condition-kind"
              value={value}
              checked={kind === value}
              onChange={() => setKind(value)}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor="condition-notes">Notes</label>
        <textarea id="condition-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="condition-photos">Photos</label>
        <input
          id="condition-photos"
          type="file"
          multiple
          accept="image/*"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            setPhotos((current) => [
              ...current,
              ...files.map((file) => ({ file, url: URL.createObjectURL(file), refused: false })),
            ]);
            event.target.value = '';
          }}
        />
      </div>
      <ul className="thumbs">
        {photos.map((photo, index) => (
          <li key={`${photo.file.name}-${index}`}>
            <img src={photo.url} alt={photo.file.name} />
            {photo.refused ? <span className="field-error">Not saved</span> : null}
            <button
              type="button"
              ref={(element) => {
                removeRefs.current[index] = element;
              }}
              onClick={() => {
                setPhotos((current) => current.filter((_, position) => position !== index));
                setStatus('');
              }}
            >
              {`Remove ${photo.file.name}`}
            </button>
          </li>
        ))}
      </ul>
      <p className="status" role="status" aria-label="Condition status">
        {status}
      </p>
      <div className="dialog-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          Save condition
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
