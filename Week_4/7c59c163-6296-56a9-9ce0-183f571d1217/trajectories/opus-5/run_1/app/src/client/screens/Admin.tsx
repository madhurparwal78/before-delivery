import { useEffect, useRef, useState } from 'react';
import { COPY, marketStatusText } from '../copy.js';
import { RequestFailed, get, post } from '../api.js';
import { formatAmount, inZone } from '../format.js';
import { Shell } from '../components/Shell.js';
import { Dialog } from '../components/Dialog.js';
import { Banner } from '../components/Banner.js';
import type { Deposit, DocumentRecord, Market, Me, Outcome } from '../api.js';

type Action = 'open' | 'halt' | 'resume';

const ACTION_LABEL: Record<Action, string> = {
  open: 'Open trading',
  halt: 'Halt',
  resume: 'Resume',
};

function actionsFor(market: Market): Action[] {
  switch (market.status) {
    case 'listed':
      return ['open'];
    case 'trading':
      return ['halt'];
    case 'halted':
      return ['resume'];
    default:
      return [];
  }
}

export function AdminScreen(props: { me: Me }): React.JSX.Element {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [status, setStatus] = useState('');
  const [paused, setPaused] = useState(false);
  const [documentsOutage, setDocumentsOutage] = useState(false);
  const [listing, setListing] = useState(false);
  const [resolving, setResolving] = useState<Market | null>(null);
  const [refunding, setRefunding] = useState<Deposit | null>(null);

  const loadMarkets = (): void => {
    void get<{ markets: Market[] }>('/api/markets')
      .then((value) => setMarkets(value.markets))
      .catch(() => undefined);
  };
  const loadDeposits = (): void => {
    void get<{ deposits: Deposit[] }>('/api/admin/deposits')
      .then((value) => setDeposits(value.deposits))
      .catch(() => undefined);
  };

  useEffect(() => {
    loadMarkets();
    loadDeposits();
    void get<{ documents: DocumentRecord[] }>('/api/admin/documents')
      .then((value) => setDocuments(value.documents))
      .catch(() => undefined);
  }, []);

  const act = async (market: Market, action: Action): Promise<void> => {
    try {
      await post<Market>(`/api/markets/${market.id}/${action}`);
      setStatus(`${ACTION_LABEL[action]} applied to ${market.symbol}.`);
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      setStatus(`${market.symbol} could not change state.`);
    }
    loadMarkets();
  };

  const runLiquidations = async (market: Market): Promise<void> => {
    try {
      const result = await post<{ checked: number; liquidated: unknown[] }>(
        `/api/markets/${market.id}/liquidations`,
      );
      setStatus(`Checked ${result.checked} positions, liquidated ${result.liquidated.length}.`);
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      setStatus(`${market.symbol} is not a pair.`);
    }
    loadMarkets();
  };

  const openDocument = async (id: string): Promise<void> => {
    try {
      const link = await get<{ url: string }>(`/api/admin/documents/${id}/link`);
      setDocumentsOutage(false);
      window.open(link.url, '_blank', 'noopener');
    } catch (error) {
      if (error instanceof RequestFailed && error.code === 'documents_unavailable') {
        setDocumentsOutage(true);
        return;
      }
      throw error;
    }
  };

  return (
    <Shell me={props.me} path="/admin" field="sage" stickers={['cube']}>
      <h1>Market admin</h1>
      {paused ? <Banner>{COPY.paymentsPaused}</Banner> : null}
      {documentsOutage ? <Banner>{COPY.documentsUnavailable}</Banner> : null}

      <div className="card">
        <h2>Markets</h2>
        <button type="button" className="pill" onClick={() => setListing(true)}>
          List market
        </button>
        <div className="table-scroll">
          <table aria-label="Markets">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Kind</th>
                <th scope="col">Status</th>
                <th scope="col">Closes</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((market) => (
                <tr key={market.id}>
                  <td>{market.symbol}</td>
                  <td>{market.kind === 'pair' ? 'Spot and margin' : 'Event'}</td>
                  <td>{marketStatusText(market.status, market.outcome)}</td>
                  <td>
                    {market.closes_at === null
                      ? '—'
                      : inZone(props.me.venue?.time_zone ?? 'UTC', market.closes_at)}
                  </td>
                  <td>
                    <div className="row-actions">
                      {actionsFor(market).map((action) => (
                        <button
                          key={action}
                          type="button"
                          className="pill"
                          onClick={() => void act(market, action)}
                        >
                          {ACTION_LABEL[action]}
                        </button>
                      ))}
                      {market.status === 'closed' ? (
                        <button type="button" className="pill" onClick={() => setResolving(market)}>
                          Resolve
                        </button>
                      ) : null}
                      {market.kind === 'pair' ? (
                        <button
                          type="button"
                          className="pill pill--quiet"
                          onClick={() => void runLiquidations(market)}
                        >
                          Run liquidations
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Deposits</h2>
        <div className="table-scroll">
          <table aria-label="Deposits">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">When</th>
                <th scope="col">Amount</th>
                <th scope="col">Refunded</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((deposit) => (
                <tr key={deposit.id}>
                  <td>{deposit.member?.display_name ?? ''}</td>
                  <td>{inZone(props.me.venue?.time_zone ?? 'UTC', deposit.created_at)}</td>
                  <td>{formatAmount(deposit.amount_cents)}</td>
                  <td>{formatAmount(deposit.refunded_cents)}</td>
                  <td>{deposit.status}</td>
                  <td>
                    {deposit.status === 'succeeded' ? (
                      <button type="button" className="pill" onClick={() => setRefunding(deposit)}>
                        Refund
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>ID documents</h2>
        <div className="table-scroll">
          <table aria-label="ID documents">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">File</th>
                <th scope="col">Type</th>
                <th scope="col">Uploaded</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td>{document.member?.display_name ?? ''}</td>
                  <td>{document.filename}</td>
                  <td>{document.content_type}</td>
                  <td>{inZone(props.me.venue?.time_zone ?? 'UTC', document.uploaded_at)}</td>
                  <td>
                    <a
                      className="skip-link"
                      href={`/api/admin/documents/${document.id}/link`}
                      onClick={(click) => {
                        click.preventDefault();
                        void openDocument(document.id);
                      }}
                    >
                      View document
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <span className="status" role="status" aria-live="polite" aria-label="Admin updates">
        {status}
      </span>

      {listing ? (
        <ListMarketDialog
          onClose={() => setListing(false)}
          onCreated={() => {
            setListing(false);
            loadMarkets();
          }}
        />
      ) : null}
      {resolving !== null ? (
        <ResolveDialog
          market={resolving}
          onClose={() => setResolving(null)}
          onResolved={() => {
            setResolving(null);
            loadMarkets();
          }}
        />
      ) : null}
      {refunding !== null ? (
        <RefundDialog
          deposit={refunding}
          onClose={() => setRefunding(null)}
          onStatus={setStatus}
          onPaused={setPaused}
          onDone={() => {
            setRefunding(null);
            loadDeposits();
          }}
        />
      ) : null}
    </Shell>
  );
}

function ListMarketDialog(props: { onClose: () => void; onCreated: () => void }): React.JSX.Element {
  const [kind, setKind] = useState<'pair' | 'event'>('event');
  const [symbol, setSymbol] = useState('');
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState('5');
  const [message, setMessage] = useState('');
  const symbolRef = useRef<HTMLInputElement | null>(null);

  const create = async (): Promise<void> => {
    const closesAt = new Date(Date.now() + Math.max(1, Number(minutes)) * 60_000).toISOString();
    try {
      await post<Market>('/api/markets', {
        kind,
        symbol: symbol.toUpperCase(),
        title,
        ...(kind === 'event' ? { closes_at: closesAt } : {}),
      });
      props.onCreated();
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      setMessage(error.code === 'symbol_taken' ? 'That symbol is taken.' : 'Check the market details.');
    }
  };

  return (
    <Dialog label="List market" initialFocus={symbolRef} onClose={props.onClose}>
      <h2>List market</h2>
      <fieldset>
        <legend>Kind</legend>
        <div className="radio-row" role="radiogroup" aria-label="Kind">
          {(['event', 'pair'] as const).map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="kind"
                value={option}
                checked={kind === option}
                onChange={() => setKind(option)}
              />
              {option === 'event' ? 'Event' : 'Spot and margin'}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="form-row">
        <label htmlFor="market-symbol">Symbol</label>
        <input
          id="market-symbol"
          ref={symbolRef}
          type="text"
          value={symbol}
          onChange={(event) => setSymbol(event.target.value)}
        />
      </div>
      <div className="form-row">
        <label htmlFor="market-title">Title</label>
        <input
          id="market-title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      {kind === 'event' ? (
        <div className="form-row">
          <label htmlFor="market-minutes">Closes in minutes</label>
          <input
            id="market-minutes"
            type="number"
            min={1}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </div>
      ) : null}
      {message !== '' ? <p className="banner">{message}</p> : null}
      <div className="dialog__actions">
        <button type="button" className="pill" onClick={() => void create()}>
          List market
        </button>
        <button type="button" className="pill pill--quiet" onClick={props.onClose}>
          Back
        </button>
      </div>
    </Dialog>
  );
}

function ResolveDialog(props: {
  market: Market;
  onClose: () => void;
  onResolved: () => void;
}): React.JSX.Element {
  const [outcome, setOutcome] = useState<Outcome>('yes');
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const resolve = async (): Promise<void> => {
    await post<Market>(`/api/markets/${props.market.id}/resolve`, { outcome }).catch(() => undefined);
    props.onResolved();
  };

  return (
    <Dialog label={`Resolve ${props.market.symbol}`} initialFocus={confirmRef} onClose={props.onClose}>
      <h2>Resolve {props.market.symbol}</h2>
      <div className="radio-row" role="radiogroup" aria-label="Outcome">
        {(['yes', 'no'] as const).map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="outcome"
              value={option}
              checked={outcome === option}
              onChange={() => setOutcome(option)}
            />
            {option === 'yes' ? 'Yes' : 'No'}
          </label>
        ))}
      </div>
      <div className="dialog__actions">
        <button type="button" className="pill" ref={confirmRef} onClick={() => void resolve()}>
          Confirm resolution
        </button>
        <button type="button" className="pill pill--quiet" onClick={props.onClose}>
          Back
        </button>
      </div>
    </Dialog>
  );
}

function RefundDialog(props: {
  deposit: Deposit;
  onClose: () => void;
  onStatus: (text: string) => void;
  onPaused: (paused: boolean) => void;
  onDone: () => void;
}): React.JSX.Element {
  const refundable = props.deposit.amount_cents - props.deposit.refunded_cents;
  const [amount, setAmount] = useState((refundable / 100).toFixed(2));
  const [message, setMessage] = useState('');
  const amountRef = useRef<HTMLInputElement | null>(null);

  const issue = async (): Promise<void> => {
    props.onStatus(COPY.refundPending);
    const amountCents = Math.round(Number(amount) * 100);
    try {
      await post('/api/deposits/' + props.deposit.id + '/refunds', { amount_cents: amountCents });
      props.onPaused(false);
      props.onStatus(COPY.refundIssued(amountCents));
      props.onDone();
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.code === 'payments_unavailable') {
        props.onPaused(true);
        props.onStatus('');
        props.onClose();
        return;
      }
      props.onStatus('');
      setMessage(
        error.fields.amount_cents === 'exceeds_refundable'
          ? COPY.refundExceeds(refundable)
          : COPY.refundExceeds(refundable),
      );
    }
  };

  return (
    <Dialog label="Refund deposit" initialFocus={amountRef} onClose={props.onClose}>
      <h2>Refund deposit</h2>
      <div className="form-row">
        <label htmlFor="refund-amount">Refund amount (USD)</label>
        <input
          id="refund-amount"
          ref={amountRef}
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      {message !== '' ? <p className="banner">{message}</p> : null}
      <div className="dialog__actions">
        <button type="button" className="pill" onClick={() => void issue()}>
          Issue refund
        </button>
        <button type="button" className="pill pill--quiet" onClick={props.onClose}>
          Back
        </button>
      </div>
    </Dialog>
  );
}
