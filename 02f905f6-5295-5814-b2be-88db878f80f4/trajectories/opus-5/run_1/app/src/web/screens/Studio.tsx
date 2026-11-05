import { useEffect, useState } from 'react';
import type {
  DamageReport,
  Kiln,
  OwedAccount,
  OwedSummary,
  StudioSummary,
} from '../../shared/types';
import { DAMAGE_KIND_LABELS, DAMAGE_STATUS_LABELS, formatMoney } from '../../shared/labels';
import { ApiFailure, api, newIdempotencyKey } from '../api';
import { Dialog, LiveRegion, PhotoMat, quiet, type LiveMessage } from '../components/bits';

const BILLING_DOWN = "Billing is down — we can't show what's owed right now.";

export function StudioScreen(): JSX.Element {
  const [owed, setOwed] = useState<OwedSummary | null>(null);
  const [billingDown, setBillingDown] = useState(false);
  const [summary, setSummary] = useState<StudioSummary | null>(null);
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [reports, setReports] = useState<DamageReport[]>([]);
  const [payment, setPayment] = useState<LiveMessage>(quiet);
  const [damage, setDamage] = useState<LiveMessage>(quiet);
  const [open, setOpen] = useState<DamageReport | null>(null);
  const [charge, setCharge] = useState('');

  const load = (): void => {
    api
      .get<OwedSummary>('/api/studio/owed')
      .then((result) => {
        setOwed(result);
        setBillingDown(false);
      })
      .catch(() => {
        setOwed(null);
        setBillingDown(true);
      });
    void api.get<StudioSummary>('/api/studio/summary').then(setSummary);
    void api.get<Kiln[]>('/api/kilns').then(setKilns);
    void api.get<DamageReport[]>('/api/damage-reports').then(setReports);
  };

  useEffect(load, []);

  const recordPayment = async (account: OwedAccount): Promise<void> => {
    setPayment({ text: 'Recording payment…', tone: 'pending' });
    try {
      const result = await api.post<{ paid_cents: number }>(
        `/api/members/${account.member_number}/payments`,
        {},
        { 'Idempotency-Key': newIdempotencyKey() },
      );
      setPayment({
        text: `Recorded $${formatMoney(result.paid_cents)} from ${account.name}.`,
        tone: 'good',
      });
    } catch (error) {
      setPayment({
        text:
          error instanceof ApiFailure && error.body.error === 'nothing_owed'
            ? 'Nothing is owed.'
            : 'Payment not recorded — billing is unreachable.',
        tone: 'bad',
      });
    }
    load();
  };

  const confirmCharge = async (report: DamageReport): Promise<void> => {
    setDamage({ text: 'Posting charge…', tone: 'pending' });
    const amountCents = Math.round(Number(charge) * 100);
    try {
      await api.post(
        `/api/damage-reports/${report.id}/confirm`,
        { amount_cents: amountCents },
        { 'Idempotency-Key': newIdempotencyKey() },
      );
      setDamage({
        text: `Shelf charge of $${formatMoney(amountCents)} posted to ${report.account_name}.`,
        tone: 'good',
      });
      setOpen(null);
    } catch (error) {
      setDamage({
        text:
          error instanceof ApiFailure && error.body.error === 'already_settled'
            ? 'This report is already settled.'
            : error instanceof ApiFailure && error.status === 422
              ? (error.fields.amount_cents ?? 'Check the shelf charge')
              : 'Charge not posted — billing is unreachable. The report stays open.',
        tone: 'bad',
      });
    }
    load();
  };

  const waive = async (report: DamageReport): Promise<void> => {
    try {
      await api.post(`/api/damage-reports/${report.id}/waive`);
      setDamage({ text: `Damage waived for Piece ${report.piece_number}.`, tone: 'good' });
      setOpen(null);
    } catch (error) {
      setDamage({
        text:
          error instanceof ApiFailure && error.body.error === 'already_settled'
            ? 'This report is already settled.'
            : 'The studio server is unreachable.',
        tone: 'bad',
      });
    }
    load();
  };

  return (
    <section>
      <h1>Studio</h1>
      <div className="studio-grid">
        <div className="pane" role="region" aria-label="Amounts owed">
          <h2>Amounts owed</h2>
          {billingDown && (
            <p role="alert" className="alert">
              {BILLING_DOWN}
            </p>
          )}
          <table aria-label="Amounts owed">
            <caption>Amounts owed</caption>
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Owed</th>
                <th scope="col">Payment</th>
              </tr>
            </thead>
            <tbody>
              {(owed?.accounts ?? []).map((account) => (
                <tr key={`${account.kind}-${account.member_number ?? account.piece_number}`}>
                  <td>
                    {account.name}
                    {account.kind === 'guest' ? ` (Piece ${account.piece_number})` : ''}
                  </td>
                  <td className="mono">${formatMoney(account.owed_cents)}</td>
                  <td>
                    {account.kind === 'member' && (
                      <button type="button" onClick={() => void recordPayment(account)}>
                        Record payment from {account.name}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!owed && (
                <tr>
                  <td colSpan={3}>{billingDown ? 'No amounts to show.' : 'Loading…'}</td>
                </tr>
              )}
            </tbody>
          </table>
          <LiveRegion name="Payment result" message={payment} />
        </div>

        <div>
          <div className="pane" role="region" aria-label="Kilns">
            <h2>Kilns</h2>
            {kilns.map((kiln) => {
              const row = summary?.kilns.find((item) => item.kiln_id === kiln.id);
              return (
                <p key={kiln.id}>
                  {kiln.name}:{' '}
                  <span className="mono">
                    {row?.firing_id ? `Load ${row.fill_percent}% full` : 'No load'}
                  </span>
                </p>
              );
            })}
          </div>

          <div className="pane" role="region" aria-label="Awaiting pickup">
            <h2>Awaiting pickup</h2>
            <p className="big-number">{summary?.awaiting_pickup ?? 0}</p>
          </div>

          <div className="pane" role="region" aria-label="Damage reports">
            <h2>Damage reports</h2>
            {reports.length === 0 && <p>No damage reports.</p>}
            {reports.map((report) => (
              <div className="card" key={report.id}>
                <p>
                  <span className="mono">Piece {report.piece_number}</span> —{' '}
                  {DAMAGE_KIND_LABELS[report.kind]} — {DAMAGE_STATUS_LABELS[report.status]}
                  {report.amount_cents !== null && (
                    <span className="mono"> ${formatMoney(report.amount_cents)}</span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setDamage(quiet);
                    setCharge('');
                    setOpen(report);
                  }}
                >
                  Review Piece {report.piece_number}
                </button>
              </div>
            ))}
            {!open && <LiveRegion name="Damage result" message={damage} />}
          </div>
        </div>
      </div>

      {open && (
        <Dialog name={`Damage report for Piece ${open.piece_number}`} onClose={() => setOpen(null)}>
          <h2>Damage report for Piece {open.piece_number}</h2>
          <p>
            {DAMAGE_KIND_LABELS[open.kind]} reported by {open.reported_by} —{' '}
            <span className="mono">{open.reported_at_label}</span>
          </p>
          {open.note && <p>{open.note}</p>}
          <div className="photo-pair">
            <PhotoMat
              photoId={open.intake_photo_id}
              alt={`Intake photo of Piece ${open.piece_number}`}
              caption={`Piece ${open.piece_number} — intake photo`}
            />
            <PhotoMat
              photoId={open.unload_photo_id}
              alt={`Unload photo of Piece ${open.piece_number}`}
              caption={`Piece ${open.piece_number} — unload photo`}
            />
          </div>
          <div className="field">
            <label htmlFor="shelf-charge">Shelf charge ($)</label>
            <input
              id="shelf-charge"
              type="number"
              step="0.01"
              min="1"
              max="200"
              value={charge}
              onChange={(event) => setCharge(event.target.value)}
            />
          </div>
          <p>
            <button type="button" className="primary" onClick={() => void confirmCharge(open)}>
              Confirm and charge
            </button>{' '}
            <button type="button" onClick={() => void waive(open)}>
              Waive
            </button>
          </p>
          <LiveRegion name="Damage result" message={damage} />
        </Dialog>
      )}
    </section>
  );
}
