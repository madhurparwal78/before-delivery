import { useCallback, useEffect, useState } from 'react';
import { displayCoopDateString } from '../../domain/time.js';
import { parsePercentToBasisPoints } from '../../domain/money.js';
import {
  NoAnswer,
  RequestFailed,
  request,
  type CommissionRates,
  type StatementBody,
} from '../api.js';
import { displayMoney, displayPercent, monthLabel } from '../format.js';

const NETWORK_FAILURE = 'Couldn’t reach Saltprint Desk. Nothing was changed; try again.';

function failureText(failure: unknown): string {
  if (failure instanceof RequestFailed) {
    const fields = failure.body.fields;
    if (fields) return Object.values(fields)[0] ?? failure.body.message;
    return failure.body.message;
  }
  if (failure instanceof NoAnswer) return NETWORK_FAILURE;
  return NETWORK_FAILURE;
}

export function Rates(): React.ReactElement {
  const [rates, setRates] = useState<CommissionRates | null>(null);
  const [from, setFrom] = useState('');
  const [rate, setRate] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    void request<CommissionRates>('/api/commission-rates')
      .then((result) => setRates(result.data))
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  const schedule = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const basisPoints = parsePercentToBasisPoints(rate);
    try {
      await request('/api/commission-rates', {
        method: 'POST',
        body: { effective_from: from, rate_bp: basisPoints ?? rate },
      });
      setStatus(`Rate of ${displayPercent(basisPoints ?? 0)}% scheduled from ${displayCoopDateString(from)}.`);
    } catch (failure) {
      setStatus(failureText(failure));
    } finally {
      load();
    }
  };

  const marks: Record<string, string> = { current: 'Current', scheduled: 'Scheduled', past: 'Past' };

  return (
    <main>
      <h1>Commission rates</h1>
      <table className="stacked" aria-label="Commission rates">
        <thead>
          <tr>
            <th>Effective from</th>
            <th>Rate</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(rates?.rates ?? []).map((row) => (
            <tr key={row.effective_from}>
              <td data-label="Effective from" className="mono">
                {displayCoopDateString(row.effective_from)}
              </td>
              <td data-label="Rate" className="mono">
                {displayPercent(row.rate_bp)}%
              </td>
              <td data-label="Status" className="mono">
                {marks[row.status]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={(event) => void schedule(event)}>
        <div className="row">
          <div className="field">
            <label htmlFor="rate-from">Effective from (co-op date)</label>
            <input
              id="rate-from"
              type="text"
              className="mono"
              placeholder="YYYY-MM-DD"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="rate-percent">Rate (percent)</label>
            <input
              id="rate-percent"
              type="text"
              className="mono"
              placeholder="25.00"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
          </div>
          <button type="submit">Schedule rate</button>
        </div>
      </form>
      <span className="status" role="status" aria-label="Rate status">
        {status}
      </span>
    </main>
  );
}

export function Statements(): React.ReactElement {
  const [month, setMonth] = useState('');
  const [statement, setStatement] = useState<StatementBody | null>(null);
  const [status, setStatus] = useState('');

  const run = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      const result = await request<StatementBody>('/api/royalty-statements', {
        method: 'POST',
        body: { month },
      });
      setStatement(result.data);
      setStatus(`Statement for ${monthLabel(result.data.month)} ready.`);
    } catch (failure) {
      setStatus(failureText(failure));
    }
  };

  const recordPayouts = async (): Promise<void> => {
    if (!statement) return;
    try {
      const result = await request<StatementBody>(
        `/api/royalty-statements/${statement.month}/payouts`,
        { method: 'POST', body: {} },
      );
      setStatement(result.data);
      const queued = result.data.payouts.filter((payout) => payout.state === 'queued').length;
      setStatus(
        queued > 0
          ? `${queued} payouts queued — billing is unreachable; they are recorded automatically when it returns.`
          : 'Payouts recorded.',
      );
    } catch (failure) {
      setStatus(failureText(failure));
    }
  };

  const contributors = statement?.totals.contributors ?? [];

  return (
    <main>
      <h1>Statements</h1>
      <form onSubmit={(event) => void run(event)}>
        <div className="row">
          <div className="field">
            <label htmlFor="statement-month">Statement month</label>
            <input
              id="statement-month"
              type="text"
              className="mono"
              placeholder="YYYY-MM"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </div>
          <button type="submit">Run statement</button>
        </div>
      </form>
      <span className="status" role="status" aria-label="Statement status">
        {status}
      </span>
      {statement ? (
        <>
          <table className="stacked" aria-label="Statement lines">
            <thead>
              <tr>
                <th>Licence</th>
                <th>Essay</th>
                <th>Newsroom</th>
                <th>Confirmed</th>
                <th>Amount</th>
                <th>Rate</th>
                <th>Commission</th>
                <th>Shares</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line) => (
                <tr key={line.licence_id}>
                  <td data-label="Licence" className="mono">
                    {line.licence_id}
                  </td>
                  <td data-label="Essay">{line.essay_title}</td>
                  <td data-label="Newsroom">{line.newsroom.name}</td>
                  <td data-label="Confirmed" className="mono">
                    {line.confirmed_display}
                  </td>
                  <td data-label="Amount" className="mono">
                    {displayMoney(line.amount_minor)}
                  </td>
                  <td data-label="Rate" className="mono">
                    {displayPercent(line.rate_bp)}%
                  </td>
                  <td data-label="Commission" className="mono">
                    {displayMoney(line.commission_minor)}
                  </td>
                  <td data-label="Shares" className="mono">
                    {line.shares
                      .map((share) => `${share.name} ${displayMoney(share.amount_minor)}`)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="totals">
            <div>
              <dt>Invoiced</dt>
              <dd className="mono">{displayMoney(statement.totals.invoiced_minor)}</dd>
            </div>
            <div>
              <dt>Commission</dt>
              <dd className="mono">{displayMoney(statement.totals.commission_minor)}</dd>
            </div>
            {contributors.map((contributor) => (
              <div key={contributor.handle}>
                <dt>{contributor.name}</dt>
                <dd className="mono">{displayMoney(contributor.amount_minor)}</dd>
              </div>
            ))}
          </dl>
          <button type="button" onClick={() => void recordPayouts()}>
            Record payouts
          </button>
          <table className="stacked" aria-label="Payouts">
            <thead>
              <tr>
                <th>Contributor</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {statement.payouts.map((payout) => {
                const contributor = contributors.find((entry) => entry.handle === payout.handle);
                return (
                  <tr key={payout.handle}>
                    <td data-label="Contributor">{contributor?.name ?? payout.handle}</td>
                    <td data-label="State" className={`mono state-${payout.state}`}>
                      {payout.state === 'recorded' ? 'Recorded' : 'Queued'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}
    </main>
  );
}
