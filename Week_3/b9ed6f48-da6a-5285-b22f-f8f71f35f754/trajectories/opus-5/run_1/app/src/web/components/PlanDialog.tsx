import { useEffect, useState } from 'react';
import { api, ApiError, LostReplyError, newIdempotencyKey } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { useCatalog } from '../lib/hooks.js';
import { Dialog, ErrorSummary } from './Dialog.js';
import {
  TIER_NAMES,
  cancelEndOfTermNotice,
  cancelOverdueNotice,
  copy,
  downgradeNotice,
  joinNotice,
  planPriceLine,
  scheduledChangeLine,
  undoNotice,
  upgradeNotice,
  type TierKey,
} from '../../shared/copy.js';
import { CURRENCIES, type Currency } from '../../shared/money.js';
import { formatDayKey } from '../../shared/lisbon.js';
import type { Membership } from '../../shared/types.js';

const TIERS: TierKey[] = ['reader', 'fellow', 'patron'];

interface MembershipResponse {
  membership: Membership | null;
  order?: unknown;
  receipt_email?: 'sent' | 'delayed';
}

export function PlanDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { user, announce, setServiceNotice } = useStore();
  const catalog = useCatalog();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [tier, setTier] = useState<TierKey>('fellow');
  const [currency, setCurrency] = useState<Currency>('EUR');
  const [card, setCard] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loadedOnce, setLoadedOnce] = useState(false);

  const lockedCurrency = membership?.currency ?? null;

  useEffect(() => {
    if (!user) return;
    void api<MembershipResponse>('/api/me/membership')
      .then((result) => {
        setMembership(result.membership);
        if (!loadedOnce) {
          if (result.membership) {
            setTier(result.membership.tier);
            setCurrency(result.membership.currency);
          }
          setLoadedOnce(true);
        }
      })
      .catch(() => undefined);
    /* The dialog keeps the supporter's unsaved choices, so this runs only on open. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const tierPrices = catalog.data?.tiers.find((entry) => entry.tier === tier);
  const priceMinor = tierPrices?.prices[currency] ?? null;
  const upcoming = (tierPrices?.scheduled_changes ?? []).filter((change) => change.currency === currency);

  async function refreshMembership(): Promise<Membership | null> {
    try {
      const result = await api<MembershipResponse>('/api/me/membership');
      setMembership(result.membership);
      return result.membership;
    } catch {
      return membership;
    }
  }

  async function run(
    action: 'join' | 'change' | 'cancel' | 'undo',
    notice: (confirmed: Membership | null) => string,
  ): Promise<void> {
    setPending(true);
    setMessage(null);
    setFields({});
    announce(copy.paymentPending);
    const key = newIdempotencyKey();
    try {
      if (action === 'join') {
        await api<MembershipResponse>('/api/me/membership', {
          method: 'POST',
          body: { tier, currency, card_number: card },
          idempotencyKey: key,
        });
      } else if (action === 'change') {
        await api<MembershipResponse>('/api/me/membership/change', {
          method: 'POST',
          body: { tier },
          idempotencyKey: key,
        });
      } else if (action === 'cancel') {
        await api<MembershipResponse>('/api/me/membership/cancel', {
          method: 'POST',
          body: {},
          idempotencyKey: key,
        });
      } else {
        await api<MembershipResponse>('/api/me/membership/undo', {
          method: 'POST',
          body: {},
          idempotencyKey: key,
        });
      }
      const confirmed = await refreshMembership();
      announce(notice(confirmed));
      setPending(false);
    } catch (error) {
      const confirmed = await refreshMembership();
      if (confirmed) {
        setTier(confirmed.tier);
      }
      if (error instanceof ApiError) {
        setMessage(error.message);
        setFields(error.fields);
        if (error.code === 'billing_unavailable' || error.code === 'storage_unavailable') {
          setServiceNotice(error.message);
        }
      } else if (error instanceof LostReplyError) {
        setMessage(copy.donationLostReply);
      }
      announce('');
      setPending(false);
    }
  }

  const status = membership?.status ?? null;
  const isMember = status !== null && status !== 'cancelled';

  return (
    <Dialog title="Supporter plan" onClose={onClose}>
      <ErrorSummary message={message} fields={fields} fieldIds={{ card_number: 'plan-card' }} />

      <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="catalogue">Tier</legend>
        <div className="radio-row" role="radiogroup" aria-label="Tier">
          {TIERS.map((entry) => (
            <label key={entry}>
              <input
                type="radio"
                name="plan-tier"
                checked={tier === entry}
                onChange={() => setTier(entry)}
                aria-label={TIER_NAMES[entry]}
              />
              {TIER_NAMES[entry]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="catalogue">Currency</legend>
        <div className="radio-row" role="radiogroup" aria-label="Currency">
          {CURRENCIES.map((entry) => (
            <label key={entry}>
              <input
                type="radio"
                name="plan-currency"
                checked={currency === entry}
                disabled={lockedCurrency !== null && lockedCurrency !== entry}
                onChange={() => setCurrency(entry)}
                aria-label={entry}
              />
              {entry}
            </label>
          ))}
        </div>
        {lockedCurrency ? (
          <p className="secondary">
            Your supporter account pays in {lockedCurrency}. Choose {lockedCurrency} to continue.
          </p>
        ) : null}
      </fieldset>

      <p role="status" aria-label="Plan price" className="readout">
        {priceMinor !== null ? planPriceLine(priceMinor, currency) : catalog.error ? copy.pricesUnavailable : ''}
      </p>
      {upcoming.map((change) => (
        <p key={`${change.currency}-${change.effective_on}`} className="secondary">
          {scheduledChangeLine(formatDayKey(change.effective_on), change.amount_minor, change.currency)}
        </p>
      ))}

      <div className="field">
        <label htmlFor="plan-card">Card number</label>
        <input
          id="plan-card"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="Card number"
          value={card}
          onChange={(event) => setCard(event.target.value)}
        />
        {fields.card_number ? <span className="field-error">{fields.card_number}</span> : null}
      </div>

      <div className="inline-actions">
        {!user ? (
          <button type="button" onClick={onClose}>
            Sign in to join
          </button>
        ) : null}
        {user && !isMember ? (
          <button type="button" disabled={pending} onClick={() => void run('join', () => joinNotice(TIER_NAMES[tier]))}>
            Join
          </button>
        ) : null}
        {user && status === 'active' ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void run('change', (confirmed) =>
                confirmed?.pending?.kind === 'downgrade'
                  ? downgradeNotice(TIER_NAMES[confirmed.pending.tier], formatDayKey(confirmed.pending.effective_on))
                  : upgradeNotice(TIER_NAMES[tier]),
              )
            }
          >
            Change plan
          </button>
        ) : null}
        {user && (status === 'active' || status === 'overdue') ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void run('cancel', (confirmed) =>
                confirmed?.pending?.kind === 'cancel'
                  ? cancelEndOfTermNotice(formatDayKey(confirmed.pending.effective_on))
                  : cancelOverdueNotice,
              )
            }
          >
            Cancel membership
          </button>
        ) : null}
        {user && status === 'pending_change' ? (
          <button type="button" disabled={pending} onClick={() => void run('undo', () => undoNotice)}>
            Undo pending change
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}
