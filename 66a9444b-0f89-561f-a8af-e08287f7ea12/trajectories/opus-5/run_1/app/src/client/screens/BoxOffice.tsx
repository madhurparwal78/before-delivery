import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, request } from '../lib/api.js';
import { formatDeadline, formatTime } from '../lib/festival.js';
import { useUser } from '../lib/store.js';
import type { FestivalDay, Proof, Session } from '../lib/types.js';
import type { JSX } from 'react';

interface Admissions {
  festival_day: string;
  length_hours: number;
  venues: Array<{ venue_id: string; name: string; admissions: number }>;
  total: number;
}

const REFUSAL_COPY: Record<string, string> = {
  pass_transferred: 'This pass was transferred — ask for the new pass',
  pass_refunded: 'This pass was refunded',
  pass_voided: 'This pass is not valid',
  not_entitled: "This pass doesn't cover this session",
  session_cancelled: 'This session is cancelled',
};

export function BoxOfficeScreen(): JSX.Element {
  const { user, loading } = useUser();
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [days, setDays] = useState<FestivalDay[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [passCode, setPassCode] = useState('');
  const [scanResult, setScanResult] = useState('');
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const [day, setDay] = useState('');
  const [admissions, setAdmissions] = useState<Admissions | null>(null);
  const [tab, setTab] = useState<'proofs' | 'door' | 'admissions'>('proofs');
  const codeRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const [proofBody, programme] = await Promise.all([
      request<{ proofs: Proof[] }>('/api/box-office/proofs?status=pending'),
      request<{ sessions: Session[]; festival_days: FestivalDay[] }>('/api/programme'),
    ]);
    setProofs(proofBody.proofs);
    setSessions(programme.sessions);
    setDays(programme.festival_days);
    setSessionId((current) => (current === '' ? (programme.sessions[0]?.id ?? '') : current));
    setDay((current) => (current === '' ? (programme.festival_days[0]?.date ?? '') : current));
  }, []);

  useEffect(() => {
    if (user === null || user.role !== 'box_office') return;
    void load();
  }, [user, load, tab]);

  const loadAdmissions = useCallback(async (date: string) => {
    if (date === '') return;
    const body = await request<Admissions>(
      `/api/box-office/admissions?festival_day=${encodeURIComponent(date)}`,
    );
    setAdmissions(body);
  }, []);

  useEffect(() => {
    void loadAdmissions(day);
  }, [day, loadAdmissions]);

  if (loading) return <section className="wide ground-paper">Loading…</section>;
  if (user === null || user.role !== 'box_office') {
    return (
      <section className="narrow ground-paper">
        <h1 className="display">Box office</h1>
        <p>Only box-office staff can use this screen.</p>
      </section>
    );
  }

  const viewProof = async (proof: Proof): Promise<void> => {
    try {
      const link = await request<{ url: string }>(`/api/box-office/proofs/${proof.id}/read`, {
        method: 'POST',
      });
      window.open(link.url, '_blank', 'noopener');
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setDecision("We couldn't open that document right now. Try again in a moment.");
    }
  };

  const decide = async (proof: Proof, choice: 'approve' | 'reject'): Promise<void> => {
    try {
      await request(`/api/box-office/proofs/${proof.id}/decision`, {
        method: 'POST',
        body: { decision: choice, reason: choice === 'reject' ? reason : null },
      });
      setDecision(
        choice === 'approve'
          ? `Approved — payment taken for order ${proof.order_ref}.`
          : `Rejected — authorisation released for order ${proof.order_ref}.`,
      );
      await load();
      await loadAdmissions(day);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const code = error.failure.code;
      if (code === 'proof_hold_expired') {
        setDecision(
          `The proof deadline for order ${proof.order_ref} has passed; the authorisation was released.`,
        );
      } else if (code === 'payment_unavailable') {
        setDecision('The payment service is unavailable. Nothing changed — try again in a moment.');
      } else if (code === 'storage_unavailable') {
        setDecision(
          "Passes can't be issued right now. Nothing changed — the proof is still pending. Try again in a moment.",
        );
      } else if (error.failure.fields['reason'] !== undefined) {
        setDecision('Write a reason for the rejection.');
      } else if (code === 'already_decided') {
        setDecision('That proof was already decided.');
      } else {
        setDecision('That decision was refused.');
      }
      await load();
    }
  };

  const scan = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const code = passCode.trim();
    setPassCode('');
    codeRef.current?.focus();
    if (code === '') return;
    try {
      const body = await request<{ holder_name: string; item_title: string }>(
        '/api/box-office/scans',
        { method: 'POST', body: { pass_code: code, session_id: sessionId } },
      );
      setScanResult(`Admitted — ${body.holder_name}, ${body.item_title}`);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.code === 'unknown_pass') {
        setScanResult('Unknown pass code');
      } else if (error.failure.code === 'admission_refused') {
        const refusal = String(error.failure.extra['reason'] ?? '');
        if (refusal === 'already_admitted') {
          const at = error.failure.extra['first_admitted_at'];
          setScanResult(
            `Already admitted at ${typeof at === 'string' ? formatTime(at) : 'an earlier time'}`,
          );
        } else {
          setScanResult(REFUSAL_COPY[refusal] ?? 'This pass was refused');
        }
      } else {
        setScanResult('We could not read that scan.');
      }
    }
    await loadAdmissions(day);
  };

  return (
    <section className="box-office wide ground-paper">
      <h1 className="display">Box office</h1>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'proofs'} onClick={() => setTab('proofs')}>
          Proof queue
        </button>
        <button type="button" role="tab" aria-selected={tab === 'door'} onClick={() => setTab('door')}>
          Door scan
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'admissions'}
          onClick={() => setTab('admissions')}
        >
          Admissions
        </button>
      </div>

      <section className={tab === 'proofs' ? 'region' : 'region hide-mobile'} aria-label="Proof queue">
        <h2>Proof queue</h2>
        <p className="status" role="status" aria-label="Proof decision">
          {decision}
        </p>
        <div className="field">
          <label htmlFor="reject-reason">Reason</label>
          <input
            id="reject-reason"
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <ul className="ruled">
          {proofs.map((proof) => (
            <li key={proof.id}>
              <span>{proof.order_ref}</span>
              <span>{proof.buyer_name ?? ''}</span>
              <span>{proof.kind}</span>
              <span className="figures">{`Decide by ${formatDeadline(proof.deadline)}`}</span>
              <button type="button" onClick={() => void viewProof(proof)}>
                {`View proof for ${proof.order_ref}`}
              </button>
              <button type="button" className="primary" onClick={() => void decide(proof, 'approve')}>
                {`Approve ${proof.order_ref}`}
              </button>
              <button type="button" onClick={() => void decide(proof, 'reject')}>
                {`Reject ${proof.order_ref}`}
              </button>
            </li>
          ))}
          {proofs.length === 0 ? <li className="muted">Nothing waiting.</li> : null}
        </ul>
      </section>

      <section className={tab === 'door' ? 'region' : 'region hide-mobile'} aria-label="Door scan">
        <h2>Door scan</h2>
        <p className="status" role="status" aria-label="Door scan result">
          {scanResult}
        </p>
        <form onSubmit={(event) => void scan(event)}>
          <div className="field">
            <label htmlFor="scan-session">Session</label>
            <select
              id="scan-session"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="scan-code">Pass code</label>
            <input
              id="scan-code"
              type="text"
              ref={codeRef}
              value={passCode}
              autoComplete="off"
              onChange={(event) => setPassCode(event.target.value)}
            />
          </div>
          <button type="submit" className="primary">
            Scan
          </button>
        </form>
      </section>

      <section
        className={tab === 'admissions' ? 'region' : 'region hide-mobile'}
        aria-label="Admissions"
      >
        <h2>Admissions</h2>
        <div className="field">
          <label htmlFor="admissions-day">Festival day</label>
          <select
            id="admissions-day"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          >
            {days.map((candidate) => (
              <option key={candidate.date} value={candidate.date}>
                {candidate.label}
              </option>
            ))}
          </select>
        </div>
        <table className="ruled" aria-label="Admissions by venue">
          <thead>
            <tr>
              <th scope="col">Venue</th>
              <th scope="col">Admissions</th>
            </tr>
          </thead>
          <tbody>
            {(admissions?.venues ?? []).map((venue) => (
              <tr key={venue.venue_id}>
                <td>{venue.name}</td>
                <td className="figures">{venue.admissions}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{`Total (${admissions?.length_hours ?? 24} hours)`}</th>
              <td className="figures">{admissions?.total ?? 0}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </section>
  );
}
