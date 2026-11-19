import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { MeJson, ReturnsEnvelope, ReturnJson } from '../../../shared/types';
import { TopBar } from '../components/TopBar';
import type { Session } from '../lib/session';
import { statusLabel, dateLine } from '../lib/design';

const STATUSES = [
  ['not_started', 'Not started'],
  ['prepared', 'Prepared'],
  ['client_approved', 'Client approved'],
  ['filed', 'Filed'],
  ['packeted', 'Packeted'],
  ['amended', 'Amended'],
  ['overdue', 'Overdue'],
] as const;

interface Props {
  me: MeJson;
  route: { path: string; query: Record<string, string>; navigate: (path: string) => void };
  announce: (line: string) => void;
}

export function YearScreen({ me, route }: Props): React.ReactNode {
  const yearParam = route.path.slice('/year/'.length);
  const year = /^\d{4}$/.test(yearParam) ? yearParam : defaultYear(me.now);
  const status = route.query.status ?? '';
  const state = route.query.state ?? '';
  const [envelope, setEnvelope] = useState<ReturnsEnvelope | null>(null);
  const session: Session = { me, signOut: async () => {} };

  const query = new URLSearchParams();
  if (status !== '') query.set('status', status);
  if (state !== '') query.set('state', state);

  const load = async () => {
    setEnvelope(await api.returns(`?year=${year}${query.toString() === '' ? '' : `&${query.toString()}`}`));
  };

  useEffect(() => {
    void load();
  }, [year, status, state]);

  const [stateCodes, setStateCodes] = useState<string[]>([]);
  useEffect(() => {
    void api.returns('').then((all: { returns: ReturnJson[] }) => {
      setStateCodes([...new Set(all.returns.map((r: ReturnJson) => r.state))].sort());
    });
  }, []);

  const setFilter = (kind: 'status' | 'state', value: string) => {
    const next = new URLSearchParams(query);
    if (next.get(kind) === value) {
      next.delete(kind);
    } else {
      next.set(kind, value);
    }
    const params = next.toString();
    route.navigate(`/year/${year}${params === '' ? '' : `?${params}`}`);
    void load();
    void 0;
  };

  if (envelope === null) {
    return (
      <>
        <TopBar session={session} route={route} />
        <main className="page">Loading</main>
      </>
    );
  }

  return (
    <>
      <TopBar session={session} route={route} />
      <main className="page year-page">
        <h1 className="page-title">Returns by year</h1>
        <h2>{year}</h2>
        <div className="year-filters">
          {STATUSES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              className={`chip-filter ${status === value ? 'chip-filter-on' : ''}`}
              onClick={() => setFilter('status', value)}
            >
              {`Status: ${label}`}
            </button>
          ))}
          {stateCodes.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={state === code}
              className={`chip-filter ${state === code ? 'chip-filter-on' : ''}`}
              onClick={() => setFilter('state', code)}
            >
              {`State: ${code}`}
            </button>
          ))}
        </div>
        <p role="status" aria-label="Result count">{`Result count: ${envelope.counts.total}`}</p>
        <a
          className="button button-secondary"
          href={`/api/year/${year}/export.csv${query.toString() === '' ? '' : `?${query.toString()}`}`}
          onClick={(event) => {
            event.preventDefault();
            void fetch(`/api/year/${year}/export.csv${query.toString() === '' ? '' : `?${query.toString()}`}`).then(async (response) => {
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `duefield-${year}.csv`;
              link.click();
              URL.revokeObjectURL(url);
            });
          }}
        >
          Export CSV
        </a>
        <table aria-label="Returns" className="year-table">
          <thead>
            <tr>
              <th scope="col">Client</th>
              <th scope="col">State</th>
              <th scope="col">Period</th>
              <th scope="col">Status</th>
              <th scope="col">Due</th>
              <th scope="col">Zone</th>
              <th scope="col">Gross sales</th>
              <th scope="col">Tax due</th>
              <th scope="col">Rate</th>
              <th scope="col">Edition</th>
            </tr>
          </thead>
          <tbody>
            {envelope.returns.map((ret) => (
              <YearRow key={ret.id} ret={ret} />
            ))}
          </tbody>
        </table>
        {envelope.counts.total === 0 ? <p className="quiet">No returns match these filters.</p> : null}
      </main>
    </>
  );
}

function YearRow({ ret }: { ret: ReturnJson }): React.ReactNode {
  return (
    <tr
      data-return-id={ret.id}
      data-status={ret.status}
      data-overdue={String(ret.overdue)}
      data-due-at={ret.due_at}
      data-state={ret.state}
      data-version={ret.version}
      data-rate={ret.edition.rate}
      data-edition={ret.edition.effective_date}
    >
      <td data-label="Client">{ret.client.name}</td>
      <td data-label="State">{ret.state}</td>
      <td data-label="Period">{ret.period_label}</td>
      <td data-label="Status">{statusLabel(ret.status)}{ret.overdue ? ' · Overdue' : ''}</td>
      <td data-label="Due">{dateLine(ret.due_date)}</td>
      <td data-label="Zone">{ret.zone}</td>
      <td data-label="Gross sales">{ret.gross_sales ?? ''}</td>
      <td data-label="Tax due">{ret.tax_due ?? ''}</td>
      <td data-label="Rate">{ret.edition.rate}</td>
      <td data-label="Edition">{ret.edition.effective_date}</td>
    </tr>
  );
}

function defaultYear(nowISO: string): string {
  const now = new Date(nowISO);
  const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  return String(central.getFullYear());
}
