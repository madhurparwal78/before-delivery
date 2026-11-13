import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiFailure, api } from '../lib/api.js';
import { useAppEvent, useStageScene, useToasts } from '../lib/app-context.js';
import { useReducedMotion } from '../lib/typing.js';
import { CueLine, Table } from '../components/ui.js';
import type {
  CommissionSummary,
  CrewDayShape,
  FunderShape,
  JobShape,
} from '../lib/shapes.js';
import { formatAmount, formatSharePercent } from '../../shared/money.js';
import * as copy from '../../shared/copy.js';
import { COMMISSION_STATE_LABELS } from '../../shared/states.js';
import { PIECES } from '../../shared/seed.js';
import { formatMetres } from '../../shared/placement.js';
import { formatVenueDate } from '../../shared/venue-time.js';

/** The producer's board, updating in place as payments are confirmed. */
export function Studio(): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [rows, setRows] = useState<CommissionSummary[] | null>(null);
  const [boardUpdate, setBoardUpdate] = useState('');
  const [chosen, setChosen] = useState<string | null>(
    new URLSearchParams(window.location.search).get('commission'),
  );
  useStageScene({ scene: 'working', silhouette: 'none' });

  const load = useCallback(() => {
    void api
      .get<{ commissions: CommissionSummary[] }>('/api/commissions')
      .then((result) => setRows(result.commissions))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);

  useAppEvent('commission.updated', load);
  useAppEvent('payment.confirmed', (data) => {
    const title =
      rows?.find((row) => row.id === data['commissionId'])?.title ?? '';
    setBoardUpdate(
      copy.boardPayment(
        String(data['payerName'] ?? ''),
        formatAmount(Number(data['amountCents'] ?? 0)),
        title,
      ),
    );
    load();
  });

  if (rows === null) return <main className="column" />;

  return (
    <main className="column wide">
      <h1>Studio</h1>
      <div role="status" aria-label="Board updates" aria-live="polite" className="muted">
        {boardUpdate}
      </div>

      {rows.length === 0 ? (
        <CueLine text={copy.EMPTY_STATES.studio} reducedMotion={reducedMotion} level={2} />
      ) : (
        <Table
          name="Commissions"
          head={
            <tr>
              <th>Commission</th>
              <th>Client</th>
              <th>State</th>
              <th>Install day</th>
              <th>Paid</th>
              <th>Next due</th>
            </tr>
          }
        >
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link to={`/c/${row.id}`}>{row.title}</Link>{' '}
                <button type="button" onClick={() => setChosen(row.id)}>
                  Funders
                </button>
              </td>
              <td>{row.clientName}</td>
              <td>
                <span className="badge">{COMMISSION_STATE_LABELS[row.state]}</span>
              </td>
              <td>{row.installDate ? formatVenueDate(row.installDate) : '—'}</td>
              <td className="amount">{formatAmount(row.paidCents)}</td>
              <td className="amount">
                {row.nextDueCents === null ? '—' : formatAmount(row.nextDueCents)}
              </td>
            </tr>
          ))}
        </Table>
      )}

      {chosen ? <Funders commissionId={chosen} /> : null}
    </main>
  );
}

interface FunderDraft {
  id: string | null;
  kind: 'client' | 'sponsor';
  name: string;
  email: string;
  percent: string;
}

function Funders({ commissionId }: { commissionId: string }): JSX.Element {
  const { notify } = useToasts();
  const [drafts, setDrafts] = useState<FunderDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<FunderShape[]>([]);

  const load = useCallback(() => {
    void api
      .get<{ funders: FunderShape[] }>(`/api/commissions/${commissionId}/funders`)
      .then((result) => {
        setSaved(result.funders);
        setDrafts(
          result.funders.map((funder) => ({
            id: funder.id,
            kind: funder.kind,
            name: funder.name,
            email: funder.email ?? '',
            percent: formatSharePercent(funder.bp),
          })),
        );
      })
      .catch(() => undefined);
  }, [commissionId]);
  useEffect(load, [load]);

  const save = async (): Promise<void> => {
    setErrors({});
    try {
      await api.put(`/api/commissions/${commissionId}/funders`, {
        funders: drafts.map((draft) => ({
          kind: draft.kind,
          name: draft.name,
          ...(draft.kind === 'sponsor' ? { email: draft.email } : {}),
          bp: Math.round(Number(draft.percent) * 100),
        })),
      });
      notify(copy.FUNDERS_SAVED);
      load();
    } catch (error) {
      if (error instanceof ApiFailure) {
        if (error.code === 'funders_locked') notify(copy.FUNDERS_LOCKED);
        else setErrors(error.fieldErrors);
      }
    }
  };

  return (
    <section className="panel">
      <h2>Funders</h2>
      {Object.values(errors).map((message) => (
        <p className="notice" key={message}>
          {message}
        </p>
      ))}
      <ul className="list">
        {drafts.map((draft, index) => (
          <li className="row inline" key={index}>
            <input
              className="answer-field"
              aria-label="Sponsor name"
              value={draft.name}
              onChange={(event) =>
                setDrafts((current) =>
                  current.map((item, i) =>
                    i === index ? { ...item, name: event.target.value } : item,
                  ),
                )
              }
            />
            {draft.kind === 'sponsor' ? (
              <input
                className="answer-field"
                aria-label="Sponsor email"
                value={draft.email}
                onChange={(event) =>
                  setDrafts((current) =>
                    current.map((item, i) =>
                      i === index ? { ...item, email: event.target.value } : item,
                    ),
                  )
                }
              />
            ) : null}
            <input
              className="answer-field numeral"
              aria-label="Share percent"
              value={draft.percent}
              onChange={(event) =>
                setDrafts((current) =>
                  current.map((item, i) =>
                    i === index ? { ...item, percent: event.target.value } : item,
                  ),
                )
              }
            />
          </li>
        ))}
      </ul>
      <div className="inline">
        <button
          type="button"
          onClick={() =>
            setDrafts((current) => [
              ...current,
              { id: null, kind: 'sponsor', name: '', email: '', percent: '0.00' },
            ])
          }
        >
          Add sponsor
        </button>
        <button type="button" className="primary" onClick={() => void save()}>
          Save funders
        </button>
      </div>
      <ul className="list">
        {saved
          .filter((funder) => funder.kind === 'sponsor')
          .map((funder) => (
            <li className="row spread" key={funder.id}>
              <span>
                {funder.name} · {funder.state} · {formatAmount(funder.amountCents)}
              </span>
              <span className="inline">
                <button
                  type="button"
                  onClick={() => {
                    void api
                      .post(`/api/funders/${funder.id}/invite`)
                      .then(() => notify(copy.FUNDERS_SAVED))
                      .catch(() => undefined);
                  }}
                >
                  Resend invite
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void api
                      .del(`/api/funders/${funder.id}/invite`)
                      .then(load)
                      .catch(() => undefined);
                  }}
                >
                  Revoke invite
                </button>
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}

export function Jobs(): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [rows, setRows] = useState<JobShape[] | null>(null);
  useStageScene({ scene: 'working', silhouette: 'none' });

  const load = useCallback(() => {
    void api
      .get<{ jobs: JobShape[] }>('/api/jobs')
      .then((result) => setRows(result.jobs))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  useAppEvent('job.updated', load);

  useEffect(() => {
    const timer = setInterval(load, 4_000);
    return () => clearInterval(timer);
  }, [load]);

  if (rows === null) return <main className="column" />;
  if (rows.length === 0) {
    return (
      <main className="column">
        <CueLine text={copy.EMPTY_STATES.jobs} reducedMotion={reducedMotion} />
      </main>
    );
  }

  return (
    <main className="column wide">
      <h1>Jobs</h1>
      <Table
        name="Jobs"
        head={
          <tr>
            <th>Kind</th>
            <th>Commission</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Last error</th>
            <th>Finished</th>
          </tr>
        }
      >
        {rows.map((job) => (
          <tr key={job.id}>
            <td>{job.kind}</td>
            <td>{job.commissionId ? job.commissionId.slice(0, 8) : '—'}</td>
            <td>{job.status === 'done' ? 'Done' : job.status}</td>
            <td className="amount">{job.attempts}</td>
            <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>{job.lastError ?? '—'}</td>
            <td>{job.finishedAt ?? '—'}</td>
          </tr>
        ))}
      </Table>
    </main>
  );
}

export function CrewDays(): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [days, setDays] = useState<CrewDayShape[] | null>(null);
  useStageScene({ scene: 'working', silhouette: 'none' });

  useEffect(() => {
    void api
      .get<{ installDays: CrewDayShape[] }>('/api/install-days')
      .then((result) => setDays(result.installDays))
      .catch(() => setDays([]));
  }, []);

  if (days === null) return <main className="column" />;
  if (days.length === 0) {
    return (
      <main className="column">
        <CueLine text={copy.EMPTY_STATES.installDays} reducedMotion={reducedMotion} />
      </main>
    );
  }

  return (
    <main className="column">
      <h1>Install days</h1>
      <ul className="list" aria-label="Install days">
        {days.map((day) => (
          <li key={day.id}>
            <Link className="row card" to={`/crew/days/${day.id}`} style={{ display: 'block' }}>
              <strong>{formatVenueDate(day.date)}</strong>
              <p className="muted">
                {day.commissionTitle} · {day.venue?.name ?? ''}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function CrewDaySheet(): JSX.Element {
  const { installDayId = '' } = useParams();
  const { notify } = useToasts();
  const [day, setDay] = useState<CrewDayShape | null>(null);
  useStageScene({ scene: 'working', silhouette: 'none' });

  const load = useCallback(() => {
    void api
      .get<CrewDayShape>(`/api/install-days/${installDayId}`)
      .then(setDay)
      .catch(() => undefined);
  }, [installDayId]);
  useEffect(load, [load]);

  const confirm = async (): Promise<void> => {
    if (!day) return;
    try {
      await api.post(`/api/commissions/${day.commissionId}/transitions`, { to: 'installed' });
      notify(copy.TRANSITION_MESSAGES.installed);
      load();
    } catch (error) {
      if (error instanceof ApiFailure) notify(copy.TRANSITION_UNAVAILABLE);
    }
  };

  if (!day) return <main className="column" />;

  return (
    <main className="column">
      <h1>{formatVenueDate(day.date)}</h1>
      <section className="panel">
        <p className="spread">
          <span className="muted">Venue</span>
          <span>{day.venue?.name ?? ''}</span>
        </p>
        <p className="spread">
          <span className="muted">Commission</span>
          <span>{day.commissionTitle}</span>
        </p>
        <p className="spread">
          <span className="muted">Client</span>
          <span>{day.clientName}</span>
        </p>
      </section>

      <section>
        <h2>Pieces</h2>
        <ul className="list">
          {day.layout.map((item, index) => (
            <li className="row spread" key={index}>
              <span>{PIECES[item.kind]?.label ?? item.kind}</span>
              <span className="numeral">
                {formatMetres(item.x)} m, {formatMetres(item.y)} m, turned {item.rotationDeg}°
              </span>
            </li>
          ))}
          {day.layout.length === 0 ? <li className="muted">No pieces placed.</li> : null}
        </ul>
      </section>

      <section>
        <h2>Load-in alert</h2>
        <ul className="list">
          {day.alerts.map((alert, index) => (
            <li className="row spread" key={index}>
              <span>{alert.title}</span>
              <span className="muted">{alert.status}</span>
            </li>
          ))}
          {day.alerts.length === 0 ? <li className="muted">No alerts scheduled.</li> : null}
        </ul>
      </section>

      {day.confirmedAt ? (
        <p className="row">Installation confirmed.</p>
      ) : (
        <button type="button" className="primary" onClick={() => void confirm()}>
          Confirm installation
        </button>
      )}
    </main>
  );
}
