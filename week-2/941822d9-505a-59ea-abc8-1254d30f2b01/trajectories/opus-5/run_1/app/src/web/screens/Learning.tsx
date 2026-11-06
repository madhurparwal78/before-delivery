import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { fieldErrorOf, request } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.js';
import { ENROLMENT_STATE_LABELS, fundingLabel } from '../lib/format.js';
import { Link } from '../lib/router.js';
import { Dialog } from '../components/Dialog.js';
import { ProgressBar } from '../components/Glyph.js';
import type { Enrolment, User } from '../lib/types.js';

function refundCopy(code: string): string | null {
  if (code === 'already_certified' || code === 'not_refundable' || code === 'refund_pending') {
    return 'This enrolment can\u2019t be refunded.';
  }
  return null;
}

export function Learning({ user }: { readonly user: User }): ReactNode {
  const feedback = useFeedback();
  const [enrolments, setEnrolments] = useState<Enrolment[]>([]);
  const [refundFor, setRefundFor] = useState<Enrolment | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    const result = await request<{ enrolments: Enrolment[] }>('/api/me/enrolments');
    setEnrolments(result.enrolments);
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  async function sendRequest(): Promise<void> {
    if (refundFor === null || pending) return;
    setPending(true);
    setReasonError(null);
    feedback.announce('Sending your request…');
    try {
      await request(`/api/enrolments/${refundFor.id}/refund-request`, {
        method: 'POST',
        body: { reason },
      });
      setRefundFor(null);
      setReason('');
      await load();
      feedback.announce('Refund requested. The nurse planner will review it.');
    } catch (error) {
      const message = fieldErrorOf(error, 'reason');
      if (message !== null) {
        setReasonError(message);
        feedback.clear();
      } else {
        feedback.report(error, refundCopy);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h1>My learning</h1>
      {enrolments.length === 0 ? <p className="hint">You have no enrolments yet.</p> : null}
      <ul className="rows">
        {enrolments.map((enrolment) => {
          const first = enrolment.modules.find((module) => module.status === 'unverified') ?? enrolment.modules[0];
          const refundable = enrolment.state === 'confirmed' && enrolment.funding !== 'seat';
          return (
            <li key={enrolment.id} className="row">
              <span className="row__main">
                <span className="row__title">{enrolment.course_title}</span>
                <div className="hint">
                  {ENROLMENT_STATE_LABELS[enrolment.state] ?? enrolment.state} ·{' '}
                  {fundingLabel(enrolment.funding, user.organisation?.name ?? null)}
                </div>
                <ProgressBar
                  label={`${enrolment.course_title} progress`}
                  percent={enrolment.progress_percent}
                />
              </span>
              <span className="row__figures inline-actions">
                {enrolment.state === 'confirmed' || enrolment.state === 'completed' ? (
                  <Link to={`/learn/${enrolment.id}/${first?.id ?? 'evaluation'}`} className="button">
                    Continue
                  </Link>
                ) : null}
                {enrolment.certificate_id === null ? null : (
                  <Link to={`/learn/${enrolment.id}/seal`} className="button button--quiet">
                    Your seal
                  </Link>
                )}
                {refundable ? (
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => {
                      setReason('');
                      setReasonError(null);
                      setRefundFor(enrolment);
                    }}
                  >
                    Request refund
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      {refundFor === null ? null : (
        <Dialog title="Request a refund" onClose={() => setRefundFor(null)}>
          <div className="field">
            <label htmlFor="refund-reason">Reason</label>
            <textarea
              id="refund-reason"
              value={reason}
              aria-describedby={reasonError === null ? undefined : 'refund-reason-error'}
              onChange={(event) => setReason(event.target.value)}
            />
            {reasonError === null ? null : (
              <p className="field__error" id="refund-reason-error">
                {reasonError}
              </p>
            )}
          </div>
          <div className="dialog__actions">
            <button type="button" disabled={pending} onClick={() => void sendRequest()}>
              {pending ? 'Sending your request…' : 'Send request'}
            </button>
            <button type="button" className="quiet" onClick={() => setRefundFor(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
