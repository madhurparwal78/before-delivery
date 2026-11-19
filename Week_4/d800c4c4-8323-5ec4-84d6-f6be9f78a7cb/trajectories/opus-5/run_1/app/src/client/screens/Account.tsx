import { useEffect, useRef, useState } from 'react';
import { BILLING_DOWN_GENERAL } from '../../shared/copy';
import { formatDollars } from '../../shared/format';
import { feeStatusWord, shapeClassFor } from '../../shared/status-words';
import { TIER_LABELS, type Fee, type Hold, type Loan, type Membership } from '../../shared/types';
import { Dialog } from '../components/Dialog';
import { FormProblems } from '../components/FormProblems';
import { DueLine } from '../components/loan-lines';
import { Announcements, SIGN_IN_AGAIN_ID } from '../components/Shell';
import { api, ApiFailed } from '../lib/api';
import { useApp } from '../lib/app-context';
import { usePoll } from '../lib/hooks';

const MEMBERSHIP_WORDS: Record<Membership['status'], string> = {
  'pending-payment': 'pending payment',
  active: 'active',
  lapsed: 'lapsed',
};

const HOLD_WORDS: Record<Hold['status'], string> = {
  queued: 'queued',
  ready: 'ready',
  collected: 'collected',
  cancelled: 'cancelled',
};

export function Account(): JSX.Element {
  const app = useApp();
  const { viewer, board, announce, navigate, joinLanding } = app;
  const membership = viewer?.membership ?? null;
  const pendingPayment = membership?.status === 'pending-payment';

  const loans = usePoll<{ loans: Loan[] }>('/api/loans', 10000);
  const holds = usePoll<{ holds: Hold[] }>('/api/holds', 10000);
  const fees = usePoll<{ fees: Fee[] }>('/api/fees', 10000);

  const heading = useRef<HTMLHeadingElement>(null);
  const cancelOpener = useRef<HTMLButtonElement>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const sawPending = useRef(false);
  const announcedActive = useRef(false);
  const announcedHolds = useRef(new Set<number>());
  const holdStatuses = useRef(new Map<number, Hold['status']>());

  // The pending check runs every three seconds and stops for good once active;
  // from then on the membership follows the server on the ordinary refresh.
  const { reloadViewer } = app;
  useEffect(() => {
    const timer = setInterval(() => void reloadViewer(), pendingPayment ? 3000 : 10000);
    return () => clearInterval(timer);
  }, [pendingPayment, reloadViewer]);

  useEffect(() => {
    const status = membership?.status;
    if (status === 'pending-payment') {
      sawPending.current = true;
      return;
    }
    if (status === 'active' && !announcedActive.current && (sawPending.current || joinLanding)) {
      announcedActive.current = true;
      announce('Your membership is active.');
    }
  }, [membership?.status, joinLanding, announce]);

  const itemNameFor = (itemId: number): string =>
    board?.items.find((item) => item.id === itemId)?.name ?? '';
  const itemTagFor = (itemId: number): string =>
    board?.items.find((item) => item.id === itemId)?.tag ?? '';

  useEffect(() => {
    const current = holds.data?.holds;
    if (!current) return;
    const freshlyReady: Hold[] = [];
    for (const hold of current) {
      const before = holdStatuses.current.get(hold.id);
      if (before === 'queued' && hold.status === 'ready' && !announcedHolds.current.has(hold.id)) {
        announcedHolds.current.add(hold.id);
        freshlyReady.push(hold);
      }
      holdStatuses.current.set(hold.id, hold.status);
    }
    if (freshlyReady.length > 0) {
      announce(
        freshlyReady
          .sort((left, right) => left.id - right.id)
          .map((hold) => `Your hold on ${itemNameFor(hold.item_id)} is ready.`)
          .join(' '),
      );
    }
  });

  async function confirmCancel(): Promise<void> {
    if (cancelPending) return;
    setCancelPending(true);
    try {
      const result = await api.post<{ membership: Membership }>('/api/membership/cancel');
      setCancelOpen(false);
      announce(`Your membership ends on ${result.membership.active_until ?? ''}.`);
      await app.reloadViewer();
      window.setTimeout(() => heading.current?.focus(), 0);
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (error.status === 401 && error.error.includes('session')) {
        setCancelOpen(false);
        app.noteSessionEnded(error.error, {
          fields: {},
          hourRows: {},
          waiverReason: null,
          selectedLoanId: null,
          selectedItemId: null,
        });
        window.setTimeout(() => document.getElementById(SIGN_IN_AGAIN_ID)?.focus(), 0);
        return;
      }
      announce(error.status === 503 ? BILLING_DOWN_GENERAL : error.error);
    } finally {
      setCancelPending(false);
    }
  }

  async function cancelHold(hold: Hold): Promise<void> {
    try {
      await api.remove(`/api/holds/${hold.id}`);
      announce('Hold cancelled.');
      await holds.reload();
      await app.reloadBoard();
    } catch (error) {
      if (error instanceof ApiFailed) announce(error.error);
    }
  }

  const showCancelButton = membership?.status === 'active' && !membership.ends_at_term;

  return (
    <>
      <Announcements kind="account" />
      <FormProblems problems={null} onJump={() => undefined} />
      <section className="panel">
        <h1 ref={heading} tabIndex={-1}>
          Your membership
        </h1>
        <p className="membership-line">
          <span className={shapeClassFor(membership?.status ?? 'lapsed')}>
            {membership ? MEMBERSHIP_WORDS[membership.status] : 'lapsed'}
          </span>
          <span className="tier">{membership ? TIER_LABELS[membership.tier] : ''}</span>
          {membership?.ends_at_term && membership.active_until ? (
            <span className="numerals">Active until {membership.active_until}</span>
          ) : null}
        </p>
        {showCancelButton ? (
          <button type="button" ref={cancelOpener} onClick={() => setCancelOpen(true)}>
            Cancel at end of term
          </button>
        ) : null}
      </section>

      {cancelOpen ? (
        <Dialog
          label="Cancel membership"
          onEscape={() => {
            setCancelOpen(false);
            window.setTimeout(() => cancelOpener.current?.focus(), 0);
          }}
        >
          <h2>Cancel membership</h2>
          <p>Your membership stays active until the end of its paid term.</p>
          <button
            type="button"
            aria-busy={cancelPending}
            aria-disabled={cancelPending}
            onClick={() => void confirmCancel()}
          >
            {cancelPending ? 'Cancelling...' : 'Confirm cancel'}
          </button>
          <button
            type="button"
            onClick={() => {
              setCancelOpen(false);
              window.setTimeout(() => cancelOpener.current?.focus(), 0);
            }}
          >
            Keep membership
          </button>
        </Dialog>
      ) : null}

      <section className="panel">
        <h2>Your loans</h2>
        <table aria-label="Your loans" className="ledger">
          <thead>
            <tr>
              <th>Loan</th>
              <th>Tools</th>
              <th>Status</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {(loans.data?.loans ?? []).map((loan) => (
              <tr key={loan.id}>
                <td>
                  <a
                    className="numerals"
                    href={`/loans/${loan.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(`/loans/${loan.id}`);
                    }}
                  >
                    {loan.ref}
                  </a>
                </td>
                <td>{loan.items.map((item) => item.name).join(', ')}</td>
                <td>{loan.status}</td>
                <td>{loan.status === 'returned-complete' ? '' : <DueLine loan={loan} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Your holds</h2>
        <table aria-label="Your holds" className="ledger">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Tag</th>
              <th>Status</th>
              <th>Place</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(holds.data?.holds ?? []).map((hold) => (
              <tr key={hold.id}>
                <td>{itemNameFor(hold.item_id)}</td>
                <td className="numerals">{itemTagFor(hold.item_id)}</td>
                <td>{HOLD_WORDS[hold.status]}</td>
                <td className="numerals">
                  {hold.status === 'queued' && hold.position !== null
                    ? `position ${hold.position}`
                    : ''}
                </td>
                <td>
                  {hold.status === 'queued' || hold.status === 'ready' ? (
                    <button type="button" onClick={() => void cancelHold(hold)}>
                      Cancel hold {itemNameFor(hold.item_id)}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Your fees</h2>
        <table aria-label="Your fees" className="ledger">
          <thead>
            <tr>
              <th>Fee</th>
              <th>Loan</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(fees.data?.fees ?? []).map((fee) => (
              <tr key={fee.id}>
                <td>
                  <a
                    className="numerals"
                    href={`/fees/${fee.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(`/fees/${fee.id}`);
                    }}
                  >
                    Fee {fee.id}
                  </a>
                </td>
                <td className="numerals">{fee.loan_ref}</td>
                <td className="numerals">${formatDollars(fee.total_cents)}</td>
                <td>
                  <span className={shapeClassFor(feeStatusWord(fee.status))}>
                    {feeStatusWord(fee.status)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
