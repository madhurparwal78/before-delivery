import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgencySettings, Contract, InvoiceLine, WeekStatement } from '../../shared/api.js';
import { jsonRequest, noteActionFinished, sendAction } from '../api.js';
import {
  BILLING_UNAVAILABLE_LINE,
  errorCopy,
  NETWORK_FAILURE,
  PENDING,
  SUCCESS,
  weekTotalsLine,
} from '../copy.js';
import { money } from '../format.js';
import { usePolledResource } from '../hooks.js';
import { useLive } from '../live.js';
import { Field } from '../components/Field.js';

function mondayOf(dateOnly: string): string {
  const [year, month, day] = dateOnly.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(year, month - 1, day));
  const weekday = (at.getUTCDay() + 6) % 7;
  at.setUTCDate(at.getUTCDate() - weekday);
  return at.toISOString().slice(0, 10);
}

export function BillingHome({ agency }: { agency: AgencySettings }): ReactNode {
  const live = useLive();
  const contracts = usePolledResource<{ contracts: Contract[] }>('/api/contracts');
  const [orgId, setOrgId] = useState('');
  const [weekField, setWeekField] = useState(() => mondayOf(agency.today));
  const [shown, setShown] = useState<{ orgId: string; weekStart: string } | null>(null);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const statement = usePolledResource<WeekStatement>(
    shown === null ? null : `/api/billing/weeks/${shown.orgId}/${shown.weekStart}`,
  );
  const [rateDraft, setRateDraft] = useState({
    effective_from: '',
    hourly_rate_cents: '',
    team_surcharge_bp: '',
    mileage_cents_per_mile: '',
  });
  const [rateErrors, setRateErrors] = useState<Record<string, string>>({});

  const contractList = contracts.data?.contracts ?? [];
  const effectiveOrgId = orgId === '' ? (contractList[0]?.org_id ?? '') : orgId;
  const contract = contractList.find((entry) => entry.org_id === effectiveOrgId) ?? null;
  const week = statement.data;
  const lines = week?.lines ?? [];
  const line = lines.find((entry) => entry.line_ref === selectedLine) ?? null;
  const closeButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (shown === null && effectiveOrgId !== '') {
      setShown({ orgId: effectiveOrgId, weekStart: mondayOf(agency.today) });
    }
  }, [shown, effectiveOrgId, agency.today]);

  const closeWeek = async (): Promise<void> => {
    if (shown === null) return;
    live.startAction();
    live.announceStatus(PENDING.closeWeek);
    const outcome = await sendAction<WeekStatement>(
      jsonRequest('POST', `/api/billing/weeks/${shown.orgId}/${shown.weekStart}/close`),
    );
    noteActionFinished();
    if (outcome.kind === 'ok') {
      live.announceStatus(
        SUCCESS.closeWeek(
          outcome.data.week_start,
          outcome.data.org_name,
          outcome.data.relayline_total_cents,
          outcome.data.billing_total_cents ?? 0,
        ),
      );
      statement.apply(outcome.data);
      return;
    }
    if (outcome.kind === 'network') {
      live.announceError(NETWORK_FAILURE);
      return;
    }
    if (outcome.kind !== 'error') return;
    const base = errorCopy({ action: 'closeWeek', code: outcome.body.error });
    const totals =
      outcome.body.error === 'total_mismatch'
        ? ` Relayline ${money(outcome.body.relayline_total_cents ?? 0)} · billing ${money(outcome.body.billing_total_cents ?? 0)}.`
        : '';
    live.announceError(`${base}${totals}`);
    void statement.reload();
  };

  const addRate = async (): Promise<void> => {
    if (contract === null) return;
    live.startAction();
    live.announceStatus(PENDING.addRate);
    setRateErrors({});
    const outcome = await sendAction<Contract>(
      jsonRequest('POST', `/api/contracts/${contract.id}/rates`, {
        effective_from: rateDraft.effective_from,
        hourly_rate_cents: Math.round(Number(rateDraft.hourly_rate_cents) * 100),
        team_surcharge_bp: Math.round(Number(rateDraft.team_surcharge_bp) * 100),
        mileage_cents_per_mile: Number(rateDraft.mileage_cents_per_mile),
      }),
    );
    noteActionFinished();
    if (outcome.kind === 'ok') {
      live.announceStatus(SUCCESS.addRate(rateDraft.effective_from));
      void contracts.reload();
      return;
    }
    if (outcome.kind === 'network') {
      live.announceError(NETWORK_FAILURE);
      return;
    }
    if (outcome.kind !== 'error') return;
    setRateErrors(outcome.body.fields ?? {});
    live.announceError(
      errorCopy({
        action: 'other',
        code: outcome.body.error,
        fields: outcome.body.fields,
        ...(outcome.body.earliest_allowed === undefined
          ? {}
          : { earliestAllowed: outcome.body.earliest_allowed }),
      }),
    );
  };

  const syncCell = (entry: InvoiceLine): string => {
    const label = entry.sync_status === 'synced' ? 'Synced' : 'Pending sync';
    const differs =
      entry.billing_amount_cents !== null && entry.billing_amount_cents !== entry.amount_cents;
    return differs ? `${label} Differs` : label;
  };

  return (
    <div className="panes">
      <section className="pane-list">
        <div className="list-controls">
          <Field id="billing-client" label="Client">
            <select
              id="billing-client"
              value={effectiveOrgId}
              onChange={(event) => setOrgId(event.target.value)}
            >
              {contractList.map((entry) => (
                <option key={entry.org_id} value={entry.org_id}>
                  {entry.org_name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="billing-week" label="Week starting">
            <input
              id="billing-week"
              type="date"
              value={weekField}
              onChange={(event) => setWeekField(event.target.value)}
            />
          </Field>
          <button
            type="button"
            onClick={() => {
              setSelectedLine(null);
              setShown({ orgId: effectiveOrgId, weekStart: weekField });
            }}
          >
            Show week
          </button>
        </div>
        <table>
          <caption className="visually-hidden">Invoice lines</caption>
          <thead>
            <tr>
              <th scope="col">Line</th>
              <th scope="col">Booking</th>
              <th scope="col">Date</th>
              <th scope="col">Billable time</th>
              <th scope="col">Interpreters</th>
              <th scope="col">Amount</th>
              <th scope="col">Billing amount</th>
              <th scope="col">Sync</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={8}>No invoice lines for this week.</td>
              </tr>
            ) : (
              lines.map((entry) => (
                <tr
                  key={entry.line_ref}
                  {...(entry.line_ref === selectedLine
                    ? { 'aria-current': 'true' as const }
                    : {})}
                >
                  <td>
                    <button
                      type="button"
                      className="plain"
                      onClick={() => setSelectedLine(entry.line_ref)}
                    >
                      {entry.line_ref}
                    </button>
                  </td>
                  <td>{entry.booking_ref}</td>
                  <td className="mono">{entry.assignment_date}</td>
                  <td className="num">{entry.billable_minutes}</td>
                  <td className="num">{entry.interpreter_count}</td>
                  <td className="num">{money(entry.amount_cents)}</td>
                  <td className="num">
                    {entry.billing_amount_cents === null
                      ? '—'
                      : money(entry.billing_amount_cents)}
                  </td>
                  <td>{syncCell(entry)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="pane-detail">
        <section className="panel" aria-label="Line breakdown">
          <h3 className="label">Line breakdown</h3>
          {line === null ? (
            <p className="empty-row">Choose a line to see its calculation.</p>
          ) : (
            <dl className="facts">
              <dt>Rate in force from</dt>
              <dd className="mono">{line.rate_effective_from}</dd>
              <dt>Hourly rate</dt>
              <dd className="mono">{money(line.hourly_rate_cents)}</dd>
              <dt>Team surcharge</dt>
              <dd className="mono">{`${line.team_surcharge_bp / 100}%`}</dd>
              <dt>Basis minutes</dt>
              <dd className="mono">{line.basis_minutes}</dd>
              <dt>Billable minutes</dt>
              <dd className="mono">{line.billable_minutes}</dd>
              <dt>Interpreters</dt>
              <dd className="mono">{line.interpreter_count}</dd>
              <dt>Time amount</dt>
              <dd className="mono">{money(line.time_amount_cents)}</dd>
              <dt>Mileage</dt>
              <dd className="mono">{`${line.mileage_miles} mi × ${line.mileage_cents_per_mile}c = ${money(line.mileage_amount_cents)}`}</dd>
              <dt>Line amount</dt>
              <dd className="mono">{money(line.amount_cents)}</dd>
              <dt>Billing amount</dt>
              <dd className="mono">
                {line.billing_amount_cents === null ? '—' : money(line.billing_amount_cents)}
              </dd>
            </dl>
          )}
        </section>

        <section className="panel" aria-label="Week totals">
          <h3 className="label">Week totals</h3>
          <p className="mono">
            {week === null
              ? 'No week shown yet.'
              : `${weekTotalsLine(week.relayline_total_cents, week.billing_total_cents)}${week.billing_reachable ? '' : ` ${BILLING_UNAVAILABLE_LINE}`}`}
          </p>
          <button type="button" ref={closeButton} onClick={() => void closeWeek()}>
            Close week
          </button>
        </section>

        <section className="panel" aria-label="Contract rates">
          <h3 className="label">Contract rates</h3>
          <ul className="plain-list" role="list">
            {(contract?.rates ?? []).map((rate) => (
              <li key={rate.effective_from} className="mono">
                {`${rate.effective_from} · ${money(rate.hourly_rate_cents)} · ${rate.team_surcharge_bp / 100}% · ${rate.mileage_cents_per_mile}c/mi`}
              </li>
            ))}
          </ul>
          <form
            aria-label="Add rate"
            onSubmit={(event) => {
              event.preventDefault();
              void addRate();
            }}
          >
            <Field
              id="rate-effective"
              label="Effective from"
              error={rateErrors['effective_from']}
            >
              <input
                id="rate-effective"
                type="date"
                value={rateDraft.effective_from}
                onChange={(event) =>
                  setRateDraft((current) => ({ ...current, effective_from: event.target.value }))
                }
              />
            </Field>
            <Field
              id="rate-hourly"
              label="Hourly rate (dollars)"
              error={rateErrors['hourly_rate_cents']}
            >
              <input
                id="rate-hourly"
                type="number"
                step="0.01"
                value={rateDraft.hourly_rate_cents}
                onChange={(event) =>
                  setRateDraft((current) => ({
                    ...current,
                    hourly_rate_cents: event.target.value,
                  }))
                }
              />
            </Field>
            <Field
              id="rate-surcharge"
              label="Team surcharge (percent)"
              error={rateErrors['team_surcharge_bp']}
            >
              <input
                id="rate-surcharge"
                type="number"
                step="0.01"
                value={rateDraft.team_surcharge_bp}
                onChange={(event) =>
                  setRateDraft((current) => ({
                    ...current,
                    team_surcharge_bp: event.target.value,
                  }))
                }
              />
            </Field>
            <Field
              id="rate-mileage"
              label="Mileage rate (cents per mile)"
              error={rateErrors['mileage_cents_per_mile']}
            >
              <input
                id="rate-mileage"
                type="number"
                value={rateDraft.mileage_cents_per_mile}
                onChange={(event) =>
                  setRateDraft((current) => ({
                    ...current,
                    mileage_cents_per_mile: event.target.value,
                  }))
                }
              />
            </Field>
            <div className="dialog-buttons">
              <button type="submit">Add rate</button>
            </div>
          </form>
        </section>
      </section>
    </div>
  );
}
