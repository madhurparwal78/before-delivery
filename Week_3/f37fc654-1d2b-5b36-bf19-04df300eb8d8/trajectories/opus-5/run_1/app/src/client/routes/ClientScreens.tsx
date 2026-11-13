import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiFailure, api } from '../lib/api.js';
import { useAppEvent, useSession, useStageScene, useToasts } from '../lib/app-context.js';
import { useReducedMotion } from '../lib/typing.js';
import { CueLine, Table } from '../components/ui.js';
import type {
  CommissionShape,
  CommissionSummary,
  DocumentShape,
  LedgerEntry,
} from '../lib/shapes.js';
import { formatAmount, formatSharePercent } from '../../shared/money.js';
import { EMPTY_STATES, ROOM_READY_HEADING, TRANSITION_MESSAGES, TRANSITION_UNAVAILABLE } from '../../shared/copy.js';
import { COMMISSION_STATE_LABELS, type CommissionState } from '../../shared/states.js';
import { INSTALLATION_LABELS } from '../../shared/seed.js';
import { formatVenueDate } from '../../shared/venue-time.js';

function dueLabel(instant: string | null): string {
  if (!instant) return '—';
  return formatVenueDate(instant.slice(0, 10));
}

export function Commissions(): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [rows, setRows] = useState<CommissionSummary[] | null>(null);
  useStageScene({ scene: 'working', silhouette: 'none' });

  const load = useCallback(() => {
    api
      .get<{ commissions: CommissionSummary[] }>('/api/commissions')
      .then((result) => setRows(result.commissions))
      .catch(() => setRows([]));
  }, []);
  useEffect(load, [load]);
  useAppEvent('commission.updated', load);

  if (rows === null) return <main className="column" />;
  if (rows.length === 0) {
    return (
      <main className="column">
        <CueLine text={EMPTY_STATES.commissions} reducedMotion={reducedMotion} />
        <Link to="/brief/new?step=1">Start a commission</Link>
      </main>
    );
  }
  return (
    <main className="column wide">
      <h1>Commissions</h1>
      <Table
        name="Commissions"
        head={
          <tr>
            <th>Commission</th>
            <th>State</th>
            <th>Venue</th>
            <th>Next due</th>
          </tr>
        }
      >
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <Link to={`/c/${row.id}`}>{row.title}</Link>
            </td>
            <td>
              <span className="badge">{COMMISSION_STATE_LABELS[row.state]}</span>
            </td>
            <td>{row.venueName}</td>
            <td className="amount">
              {row.nextDueCents === null ? '—' : formatAmount(row.nextDueCents)}
            </td>
          </tr>
        ))}
      </Table>
    </main>
  );
}

export function Commission(): JSX.Element {
  const { commissionId = '' } = useParams();
  const { me } = useSession();
  const { notify } = useToasts();
  const reducedMotion = useReducedMotion();
  const [commission, setCommission] = useState<CommissionShape | null>(null);
  const [documents, setDocuments] = useState<DocumentShape[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);

  const load = useCallback(() => {
    void api
      .get<CommissionShape>(`/api/commissions/${commissionId}`)
      .then(setCommission)
      .catch(() => undefined);
    void api
      .get<{ documents: DocumentShape[] }>(`/api/commissions/${commissionId}/documents`)
      .then((result) => setDocuments(result.documents))
      .catch(() => undefined);
    void api
      .get<{ entries: LedgerEntry[] }>(`/api/commissions/${commissionId}/ledger`)
      .then((result) => setLedger(result.entries))
      .catch(() => undefined);
  }, [commissionId]);

  useEffect(load, [load]);
  useAppEvent('commission.updated', load);
  useAppEvent('payment.confirmed', load);

  useStageScene({
    scene: 'working',
    silhouette: commission?.installationType ?? 'none',
    roomWidthM: commission?.room.widthM ?? null,
    roomDepthM: commission?.room.depthM ?? null,
  });

  const move = async (to: CommissionState): Promise<void> => {
    try {
      const updated = await api.post<CommissionShape>(
        `/api/commissions/${commissionId}/transitions`,
        { to },
      );
      setCommission(updated);
      notify(TRANSITION_MESSAGES[to as keyof typeof TRANSITION_MESSAGES] ?? '');
      load();
    } catch (error) {
      if (error instanceof ApiFailure) notify(TRANSITION_UNAVAILABLE);
    }
  };

  if (!commission) return <main className="column" />;
  const isProducer = me?.roles.includes('producer') ?? false;
  const isOwner = me?.id === commission.clientId;

  return (
    <main className="column wide">
      <CueLine text={ROOM_READY_HEADING} reducedMotion={reducedMotion} />
      <div className="spread">
        <h2>{commission.title}</h2>
        <span className="badge">{COMMISSION_STATE_LABELS[commission.state]}</span>
      </div>
      <p className="muted">
        {INSTALLATION_LABELS[commission.installationType]} · {commission.venue.name},{' '}
        {commission.venue.city}
      </p>

      <nav className="inline">
        <Link to={`/c/${commission.id}/files`}>Files</Link>
        <Link to={`/c/${commission.id}/preview`}>Preview</Link>
        <Link to={`/c/${commission.id}/configure`}>Configure</Link>
        <Link to={`/c/${commission.id}/day`}>Install day</Link>
        <Link to={`/c/${commission.id}/checkout`}>Checkout</Link>
        <Link to={`/c/${commission.id}/webhooks`}>CRM deliveries</Link>
        <Link to={`/c/${commission.id}/maintenance`}>Maintenance</Link>
      </nav>

      <Table
        name="Milestones"
        head={
          <tr>
            <th>Milestone</th>
            <th>Amount</th>
            <th>Due</th>
            <th>State</th>
            <th>Invoice</th>
          </tr>
        }
      >
        {commission.milestones.map((milestone) => (
          <tr key={milestone.id}>
            <td>{milestone.label}</td>
            <td className="amount">{formatAmount(milestone.amountCents)}</td>
            <td>{dueLabel(milestone.dueAt)}</td>
            <td>{milestone.state}</td>
            <td>{milestone.killbillInvoiceId ?? '—'}</td>
          </tr>
        ))}
      </Table>

      <section>
        <h3>Documents</h3>
        <ul className="list" aria-label="Documents">
          {documents.length === 0 ? (
            <li className="muted">No documents yet.</li>
          ) : (
            documents.map((document) => (
              <li className="row spread" key={document.id}>
                <span>{document.label}</span>
                <span className="muted">
                  {document.status === 'issued' ? (
                    <a href={`/api/documents/${document.id}/pdf`}>{document.sha256?.slice(0, 16)}</a>
                  ) : (
                    'preparing'
                  )}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      <section>
        <h3>Funders</h3>
        <ul className="list">
          {commission.funders.map((funder) => (
            <li className="row spread" key={funder.id}>
              <span>
                {funder.name} · {funder.kind}
              </span>
              <span className="amount">
                {formatSharePercent(funder.bp)}% · {formatAmount(funder.amountCents)} ·{' '}
                {funder.state}
              </span>
            </li>
          ))}
        </ul>
        {isProducer ? <Link to={`/studio?commission=${commission.id}`}>Edit funders</Link> : null}
      </section>

      <Table
        name="Ledger"
        head={
          <tr>
            <th>Payer</th>
            <th>Label</th>
            <th>Amount</th>
            <th>Payment</th>
          </tr>
        }
      >
        {ledger.map((entry) => (
          <tr key={entry.id}>
            <td>{entry.payerName}</td>
            <td>{entry.label}</td>
            <td className="amount">{formatAmount(entry.amountCents)}</td>
            <td>{entry.killbillPaymentId.slice(0, 12)}</td>
          </tr>
        ))}
      </Table>

      <div className="inline">
        {isOwner && commission.state === 'contracted' ? (
          <button type="button" className="primary" onClick={() => void move('concept_approved')}>
            Approve concept
          </button>
        ) : null}
        {isOwner && commission.state === 'installed' ? (
          <button type="button" className="primary" onClick={() => void move('accepted')}>
            Sign acceptance
          </button>
        ) : null}
        {isProducer && commission.state === 'concept_approved' ? (
          <button type="button" className="primary" onClick={() => void move('fabricating')}>
            Start fabrication
          </button>
        ) : null}
        {isProducer ? (
          <button type="button" onClick={() => void move('cancelled')}>
            Cancel commission
          </button>
        ) : null}
      </div>
    </main>
  );
}
