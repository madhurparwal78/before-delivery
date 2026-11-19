import { useEffect, useRef, useState } from 'react';
import { COPY } from '../copy.js';
import { RequestFailed, get, post } from '../api.js';
import { formatAmount, inZone } from '../format.js';
import { Shell } from '../components/Shell.js';
import { Dialog } from '../components/Dialog.js';
import { Banner } from '../components/Banner.js';
import { useStream } from '../stream.js';
import type { Balance, Deposit, Market, Me, Positions } from '../api.js';

export function BalanceScreen(props: { me: Me }): React.JSX.Element {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [positions, setPositions] = useState<Positions | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [paused, setPaused] = useState(false);
  const depositButtonRef = useRef<HTMLButtonElement | null>(null);

  const reload = (): void => {
    void get<Balance>('/api/balance').then(setBalance).catch(() => undefined);
    void get<{ deposits: Deposit[] }>('/api/deposits')
      .then((value) => setDeposits(value.deposits))
      .catch(() => undefined);
    void get<Positions>('/api/positions').then(setPositions).catch(() => undefined);
  };

  useEffect(() => {
    reload();
    void get<{ markets: Market[] }>('/api/markets')
      .then((value) => setMarkets(value.markets))
      .catch(() => undefined);
  }, []);

  useStream(null, { balance: setBalance });

  const symbolOf = (marketId: string): string =>
    markets.find((market) => market.id === marketId)?.symbol ?? marketId.slice(0, 8);

  return (
    <Shell me={props.me} path="/balance" field="slate" stickers={['cube']}>
      <h1>Balance</h1>
      {paused ? <Banner>{COPY.paymentsPaused}</Banner> : null}
      <div className="grid grid--two">
        <div className="card">
          <span className="label">Available</span>
          <span className="numeral">{formatAmount(balance?.available_cents ?? 0)}</span>
        </div>
        <div className="card">
          <span className="label">Held</span>
          <span className="numeral">{formatAmount(balance?.held_cents ?? 0)}</span>
        </div>
        <div className="card">
          <span className="label">Collateral</span>
          <span className="numeral">{formatAmount(balance?.collateral_cents ?? 0)}</span>
        </div>
        <div className="card">
          <span className="label">Total</span>
          <span className="numeral">{formatAmount(balance?.total_cents ?? 0)}</span>
        </div>
      </div>

      <div className="card">
        <button type="button" className="pill" ref={depositButtonRef} onClick={() => setOpen(true)}>
          Deposit by card
        </button>
        <span className="status" role="status" aria-live="polite" aria-label="Deposit status">
          {status}
        </span>
      </div>

      <div className="card">
        <h2>Deposits</h2>
        <div className="table-scroll">
          <table aria-label="Deposits">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Amount</th>
                <th scope="col">Refunded</th>
                <th scope="col">Card</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((deposit) => (
                <tr key={deposit.id}>
                  <td>{inZone(props.me.venue?.time_zone ?? 'UTC', deposit.created_at)}</td>
                  <td>{formatAmount(deposit.amount_cents)}</td>
                  <td>{formatAmount(deposit.refunded_cents)}</td>
                  <td>•••• {deposit.card_last4}</td>
                  <td>{deposit.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Positions</h2>
        <div className="table-scroll">
          <table aria-label="Positions">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Market</th>
                <th scope="col">Detail</th>
                <th scope="col">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {(positions?.spot ?? []).map((holding) => (
                <tr key={`spot-${holding.market_id}`}>
                  <td>Spot units</td>
                  <td>{symbolOf(holding.market_id)}</td>
                  <td>{holding.reserved} reserved</td>
                  <td>{holding.quantity}</td>
                </tr>
              ))}
              {(positions?.margin ?? []).map((position) => (
                <tr key={`margin-${position.id}`}>
                  <td>Margin {position.side}</td>
                  <td>{symbolOf(position.market_id)}</td>
                  <td>
                    {position.status}, collateral {formatAmount(position.collateral_cents)}, equity{' '}
                    {formatAmount(position.equity_cents)}, maintenance{' '}
                    {formatAmount(position.maintenance_cents)}
                  </td>
                  <td>{position.quantity}</td>
                </tr>
              ))}
              {(positions?.event ?? []).map((position) => (
                <tr key={`event-${position.market_id}-${position.outcome}`}>
                  <td>Event contracts</td>
                  <td>{symbolOf(position.market_id)}</td>
                  <td>{position.outcome === 'yes' ? 'Yes' : 'No'}</td>
                  <td>{position.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open ? (
        <DepositDialog
          onClose={() => setOpen(false)}
          onStatus={setStatus}
          onPaused={setPaused}
          onDone={() => {
            setOpen(false);
            reload();
          }}
        />
      ) : null}
    </Shell>
  );
}

function DepositDialog(props: {
  onClose: () => void;
  onStatus: (text: string) => void;
  onPaused: (paused: boolean) => void;
  onDone: () => void;
}): React.JSX.Element {
  const [amount, setAmount] = useState('50.00');
  const [card, setCard] = useState('4242 4242 4242 4242');
  const [errors, setErrors] = useState<{ amount?: string; card?: string }>({});
  const sending = useRef(false);
  const amountRef = useRef<HTMLInputElement | null>(null);

  const submit = async (): Promise<void> => {
    if (sending.current) return;
    sending.current = true;
    setErrors({});
    props.onStatus(COPY.depositPending);
    const amountCents = Math.round(Number(amount) * 100);
    try {
      const deposit = await post<Deposit>('/api/deposits', {
        amount_cents: Number.isFinite(amountCents) ? amountCents : 0,
        card_number: card,
      });
      props.onPaused(false);
      props.onStatus(COPY.depositConfirmed(deposit.amount_cents));
      props.onDone();
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.code === 'validation') {
        setErrors({
          ...(error.fields.amount_cents === undefined ? {} : { amount: COPY.depositAmountError }),
          ...(error.fields.card_number === undefined ? {} : { card: COPY.depositCardError }),
        });
        props.onStatus('');
      } else if (error.code === 'payment_declined') {
        props.onStatus(COPY.depositDeclined);
      } else if (error.code === 'payments_unavailable') {
        props.onPaused(true);
        props.onStatus('');
      } else {
        props.onStatus('');
      }
      sending.current = false;
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <Dialog label="Deposit by card" initialFocus={amountRef} onClose={props.onClose}>
      <h2>Deposit by card</h2>
      <div onKeyDown={onKeyDown}>
        <div className="form-row">
          <label htmlFor="deposit-amount">Amount (USD)</label>
          <input
            id="deposit-amount"
            ref={amountRef}
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          {errors.amount !== undefined ? <p className="banner">{errors.amount}</p> : null}
        </div>
        <div className="form-row">
          <label htmlFor="deposit-card">Card number</label>
          <input
            id="deposit-card"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={card}
            onChange={(event) => setCard(event.target.value)}
          />
          {errors.card !== undefined ? <p className="banner">{errors.card}</p> : null}
        </div>
      </div>
      <div className="dialog__actions">
        <button type="button" className="pill" onClick={() => void submit()}>
          Deposit
        </button>
        <button type="button" className="pill pill--quiet" onClick={props.onClose}>
          Back
        </button>
      </div>
    </Dialog>
  );
}
