import { useEffect, useRef, useState } from 'react';
import { BILLING_DOWN_GENERAL, BILLING_DOWN_WAIVER } from '../../shared/copy';
import { formatDollars } from '../../shared/format';
import { feeStatusWord, shapeClassFor } from '../../shared/status-words';
import type { Fee, Photo } from '../../shared/types';
import { Dialog } from '../components/Dialog';
import { FormProblems, problemsFrom, type Problems } from '../components/FormProblems';
import { PhotoComparison } from '../components/PhotoComparison';
import { Announcements, SIGN_IN_AGAIN_ID } from '../components/Shell';
import { api, ApiFailed } from '../lib/api';
import { useApp } from '../lib/app-context';
import { usePoll } from '../lib/hooks';

interface FeeRead {
  fee: Fee;
  photos: Photo[];
}

export function FeeScreen({ feeId }: { readonly feeId: number }): JSX.Element {
  const app = useApp();
  const { viewer, announce, restoredDraft, consumeDraft } = app;
  const read = usePoll<FeeRead>(`/api/fees/${feeId}`, 10000);
  const fee = read.data?.fee ?? null;

  const heading = useRef<HTMLHeadingElement>(null);
  const linesTable = useRef<HTMLTableElement>(null);
  const payButton = useRef<HTMLButtonElement>(null);
  const waiverOpener = useRef<HTMLButtonElement>(null);
  const decisionButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const summary = useRef<HTMLDivElement>(null);

  const [waiverOpen, setWaiverOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [problems, setProblems] = useState<Problems | null>(null);
  const [payPending, setPayPending] = useState(false);
  const [waiverPending, setWaiverPending] = useState(false);
  const [decisionPending, setDecisionPending] = useState(false);
  const [refusalHeld, setRefusalHeld] = useState(false);
  const announcedWaiver = useRef(false);
  const previousStatus = useRef<Fee['status'] | null>(null);

  const isOwner = viewer?.user.role === 'member' && fee !== null && fee.member_id === viewer.user.id;
  const isCoordinator = viewer?.user.role === 'coordinator';

  useEffect(() => {
    if (!restoredDraft || restoredDraft.waiverReason === null) return;
    setReason(restoredDraft.waiverReason);
    setWaiverOpen(true);
    consumeDraft();
  }, [restoredDraft, consumeDraft]);

  // The member's open Fee page is told once when a waiver is approved elsewhere.
  useEffect(() => {
    if (!fee) return;
    const before = previousStatus.current;
    previousStatus.current = fee.status;
    if (
      before === 'raised' &&
      fee.status === 'waived-by-coordinator' &&
      isOwner &&
      !announcedWaiver.current
    ) {
      announcedWaiver.current = true;
      announce(`Fee ${fee.id} was waived.`);
      const active = document.activeElement;
      if (active === payButton.current || active === waiverOpener.current) {
        window.setTimeout(() => heading.current?.focus(), 0);
      }
    }
  }, [fee, isOwner, announce]);

  function handleSessionEnded(error: ApiFailed, keepReason: string | null): boolean {
    if (!(error.status === 401 && error.error.includes('session'))) return false;
    setWaiverOpen(false);
    app.noteSessionEnded(error.error, {
      fields: {},
      hourRows: {},
      waiverReason: keepReason,
      selectedLoanId: null,
      selectedItemId: null,
    });
    window.setTimeout(() => document.getElementById(SIGN_IN_AGAIN_ID)?.focus(), 0);
    return true;
  }

  async function pay(): Promise<void> {
    if (payPending || !fee) return;
    setPayPending(true);
    try {
      await api.post(`/api/fees/${fee.id}/pay`);
      setRefusalHeld(false);
      announce('Fee settled.');
      await read.reload();
      window.setTimeout(() => linesTable.current?.focus(), 0);
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (handleSessionEnded(error, null)) return;
      announce(error.status === 503 ? BILLING_DOWN_GENERAL : error.error);
      setRefusalHeld(true);
      window.setTimeout(() => payButton.current?.focus(), 0);
    } finally {
      setPayPending(false);
    }
  }

  async function sendWaiver(): Promise<void> {
    if (waiverPending || !fee) return;
    setWaiverPending(true);
    try {
      await api.post(`/api/fees/${fee.id}/waiver-request`, { reason });
      setWaiverOpen(false);
      setProblems(null);
      announce('Waiver requested. The coordinator will decide.');
      await read.reload();
      window.setTimeout(() => payButton.current?.focus(), 0);
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (handleSessionEnded(error, reason)) return;
      if (error.status === 422) {
        setProblems(problemsFrom(error.fields));
        window.setTimeout(() => summary.current?.focus(), 0);
      } else {
        announce(error.error);
        window.setTimeout(() => document.getElementById('waiver-reason')?.focus(), 0);
      }
    } finally {
      setWaiverPending(false);
    }
  }

  async function decide(decision: 'approve' | 'decline'): Promise<void> {
    if (decisionPending || !fee) return;
    setDecisionPending(true);
    try {
      await api.post(`/api/fees/${fee.id}/waiver-decision`, { decision });
      setRefusalHeld(false);
      announce(decision === 'approve' ? 'Fee waived.' : 'Waiver declined.');
      await read.reload();
      window.setTimeout(() => linesTable.current?.focus(), 0);
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (handleSessionEnded(error, null)) return;
      announce(
        error.status === 503 && decision === 'approve' ? BILLING_DOWN_WAIVER : error.error,
      );
      setRefusalHeld(true);
      window.setTimeout(() => decisionButtons.current[decision]?.focus(), 0);
    } finally {
      setDecisionPending(false);
    }
  }

  if (!fee) return <Announcements kind="account" />;

  const raised = fee.status === 'raised';
  const waiverRequested = fee.waiver?.status === 'requested';
  const showMemberButtons = isOwner && (raised || refusalHeld);

  return (
    <>
      <Announcements kind="account" />
      {waiverOpen ? null : <FormProblems problems={problems} ref={summary} onJump={() => undefined} />}
      <section className="panel">
        <h1 ref={heading} tabIndex={-1}>
          Fee {fee.id}
        </h1>
        <p>
          <span className={shapeClassFor(feeStatusWord(fee.status))}>
            {feeStatusWord(fee.status)}
          </span>
        </p>
        <table aria-label="Fee lines" className="ledger" ref={linesTable} tabIndex={-1}>
          <thead>
            <tr>
              <th>Line</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {fee.lines.map((line, index) => (
              <tr key={index}>
                <td>{line.description}</td>
                <td className="numerals">${formatDollars(line.amount_cents)}</td>
              </tr>
            ))}
            <tr className="total-row">
              <td>Total</td>
              <td className="numerals">${formatDollars(fee.total_cents)}</td>
            </tr>
          </tbody>
        </table>
        {fee.waiver ? (
          <p className="waiver-state">
            Waiver {fee.waiver.status}: {fee.waiver.reason}
          </p>
        ) : null}
        {showMemberButtons ? (
          <p className="fee-actions">
            <button
              type="button"
              ref={payButton}
              aria-busy={payPending}
              aria-disabled={payPending}
              onClick={() => void pay()}
            >
              {payPending ? 'Paying...' : `Pay $${formatDollars(fee.total_cents)}`}
            </button>
            {fee.waiver === null || fee.waiver.status === 'declined' ? (
              <button type="button" ref={waiverOpener} onClick={() => setWaiverOpen(true)}>
                Request a waiver
              </button>
            ) : null}
          </p>
        ) : null}
        {isCoordinator && raised && waiverRequested ? (
          <p className="fee-actions">
            <button
              type="button"
              ref={(element) => {
                decisionButtons.current.approve = element;
              }}
              aria-busy={decisionPending}
              aria-disabled={decisionPending}
              onClick={() => void decide('approve')}
            >
              {decisionPending ? 'Saving...' : 'Approve waiver'}
            </button>
            <button
              type="button"
              ref={(element) => {
                decisionButtons.current.decline = element;
              }}
              aria-busy={decisionPending}
              aria-disabled={decisionPending}
              onClick={() => void decide('decline')}
            >
              {decisionPending ? 'Saving...' : 'Decline waiver'}
            </button>
          </p>
        ) : null}
      </section>

      {waiverOpen ? (
        <Dialog
          label="Request a waiver"
          onEscape={() => {
            setWaiverOpen(false);
            window.setTimeout(() => waiverOpener.current?.focus(), 0);
          }}
        >
          <h2>Request a waiver</h2>
          <FormProblems problems={problems} ref={summary} onJump={() => undefined} />
          <label>
            Reason
            <textarea
              id="waiver-reason"
              aria-label="Reason"
                rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button
            type="button"
            aria-busy={waiverPending}
            aria-disabled={waiverPending}
            onClick={() => void sendWaiver()}
          >
            {waiverPending ? 'Sending...' : 'Send request'}
          </button>
        </Dialog>
      ) : null}

      <PhotoComparison photos={read.data?.photos ?? []} />
    </>
  );
}
