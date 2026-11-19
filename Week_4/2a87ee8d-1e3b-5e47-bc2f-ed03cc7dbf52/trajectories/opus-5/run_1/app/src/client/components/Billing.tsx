import { useState } from 'react';
import { api, ApiError, newOperationId, reasonOf } from '../lib/api.js';
import { Link } from '../lib/router.js';
import { displayDate } from '../lib/format.js';
import { Modal } from './Common.js';
import type { Billing } from '../../shared/protocol.js';

/**
 * The billing banner sits above the heading whenever the account is past due or read-only.
 */
export function BillingBanner({
  billing,
  onChanged,
}: {
  billing: Billing;
  onChanged: (billing: Billing) => void;
}): JSX.Element | null {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  if (billing.state === 'active') return null;

  const copy =
    billing.state === 'read_only'
      ? 'Your workspace is read-only until the overdue payment is settled.'
      : `Your last payment didn't go through. Settle it by ${
          billing.readOnlyAt === null
            ? 'the due date'
            : displayDate(Date.parse(billing.readOnlyAt), Intl.DateTimeFormat().resolvedOptions().timeZone)
        } to keep editing.`;

  async function retry(): Promise<void> {
    setPending(true);
    setMessage('');
    try {
      const result = await api<{ billing: Billing }>('POST', '/api/billing/payments', {
        clientOpId: newOperationId(),
      });
      onChanged(result.billing);
      setMessage('Payment received. Your workspace is fully editable again.');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'billing_unavailable') {
        setMessage('Billing is unavailable. Try again shortly.');
      } else {
        setMessage(reasonOf(error));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="banner" role="region" aria-label="Billing notice">
      <p>{copy}</p>
      <button type="button" onClick={retry} disabled={pending}>
        {pending ? 'Retrying…' : 'Retry payment'}
      </button>
      <div role="status" aria-live="polite" className="status-line">
        {message}
      </div>
    </section>
  );
}

/** Any facilitator action answered with `plan_limit` opens this dialog. */
export function UpgradeDialog({ error, onClose }: { error: ApiError; onClose: () => void }): JSX.Element {
  return (
    <Modal title="Upgrade your plan" onClose={onClose}>
      <p>{error.message}</p>
      {error.limit !== null && error.used !== null && (
        <p className="mono">
          Used {error.used} of {error.limit}.
        </p>
      )}
      <div className="row">
        <Link to="/billing" className="button-link primary">
          See plans
        </Link>
        <button type="button" onClick={onClose}>
          Not now
        </button>
      </div>
    </Modal>
  );
}
