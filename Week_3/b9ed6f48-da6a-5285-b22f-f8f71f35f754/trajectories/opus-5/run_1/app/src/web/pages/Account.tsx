import { useState } from 'react';
import { api, ApiError, newIdempotencyKey } from '../lib/api.js';
import { Link } from '../lib/router.js';
import { useResource } from '../lib/hooks.js';
import { useStore } from '../lib/store.js';
import { Dialog, ErrorSummary } from '../components/Dialog.js';
import { useBookmarks, refreshBookmarks } from '../components/BookmarkButton.js';
import {
  MEMBERSHIP_STATUS_LABELS,
  copy,
  nextChargeLine,
  overdueLine,
  pendingCancellationLine,
  pendingDowngradeLine,
  retrySuccessNotice,
  messageFor,
  TIER_NAMES,
} from '../../shared/copy.js';
import { formatDayKey } from '../../shared/lisbon.js';
import { formatPrice } from '../../shared/money.js';
import { numeralFor } from '../../shared/sightline.js';
import type { Membership, Order, SavedPath } from '../../shared/types.js';

function UpdateCardDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): JSX.Element {
  const { announce } = useStore();
  const [card, setCard] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Dialog title="Update card" onClose={onClose}>
      <ErrorSummary message={message} fields={fields} fieldIds={{ card_number: 'update-card' }} />
      <div className="field">
        <label htmlFor="update-card">Card number</label>
        <input
          id="update-card"
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
        <button
          type="button"
          onClick={() => {
            void api('/api/me/membership/card', { method: 'PUT', body: { card_number: card } })
              .then(() => {
                announce(copy.cardUpdated);
                onSaved();
                onClose();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiError) {
                  setMessage(error.message);
                  setFields(error.fields);
                }
              });
          }}
        >
          Save card
        </button>
      </div>
    </Dialog>
  );
}

function MembershipRegion(): JSX.Element {
  const { announce, setServiceNotice } = useStore();
  const membership = useResource<{ membership: Membership | null }>('/api/me/membership');
  const [cardOpen, setCardOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = membership.data?.membership ?? null;

  return (
    <section aria-label="Membership">
      <h2>Membership</h2>
      {message ? <p className="accent">{message}</p> : null}
      {!current ? (
        <p className="secondary">{messageFor('not_a_member')}</p>
      ) : (
        <>
          <p className="readout">{TIER_NAMES[current.tier]}</p>
          <p>{MEMBERSHIP_STATUS_LABELS[current.status]}</p>
          {current.pending?.kind === 'downgrade' ? (
            <p>
              {pendingDowngradeLine(TIER_NAMES[current.pending.tier], formatDayKey(current.pending.effective_on))}
            </p>
          ) : null}
          {current.pending?.kind === 'cancel' ? (
            <p>{pendingCancellationLine(formatDayKey(current.pending.effective_on))}</p>
          ) : null}
          {current.status === 'overdue' && current.amount_due_minor !== null ? (
            <p>{overdueLine(current.amount_due_minor, current.currency)}</p>
          ) : null}
          {current.next_charge ? (
            <p>
              {nextChargeLine(
                current.next_charge.amount_minor,
                current.currency,
                formatDayKey(current.next_charge.on),
              )}
            </p>
          ) : null}
          {current.status === 'overdue' ? (
            <div className="inline-actions">
              <button
                type="button"
                onClick={() => {
                  setMessage(null);
                  announce(copy.paymentPending);
                  void api('/api/me/membership/retry', {
                    method: 'POST',
                    body: {},
                    idempotencyKey: newIdempotencyKey(),
                  })
                    .then(() => {
                      announce(retrySuccessNotice);
                      membership.reload();
                    })
                    .catch((error: unknown) => {
                      if (error instanceof ApiError) {
                        setMessage(error.message);
                        if (error.code === 'billing_unavailable') setServiceNotice(error.message);
                      }
                      announce('');
                      membership.reload();
                    });
                }}
              >
                Retry payment
              </button>
              <button type="button" onClick={() => setCardOpen(true)}>
                Update card
              </button>
            </div>
          ) : null}
        </>
      )}
      {cardOpen ? <UpdateCardDialog onClose={() => setCardOpen(false)} onSaved={() => membership.reload()} /> : null}
    </section>
  );
}

export function Account(): JSX.Element {
  const { user } = useStore();
  const orders = useResource<{ orders: Order[] }>('/api/me/orders');
  const path = useResource<{ path: SavedPath }>('/api/me/path');
  const bookmarks = useBookmarks(Boolean(user));

  if (!user) {
    return (
      <>
        <h1>Your account</h1>
        <p className="secondary">{messageFor('unauthenticated')}</p>
      </>
    );
  }

  const saved = path.data?.path ?? null;

  return (
    <>
      <h1>Your account</h1>
      <div className="sections">
        <MembershipRegion />

        <section>
          <h2>Orders</h2>
          <div className="table-scroll">
            <table aria-label="Orders">
              <thead>
                <tr>
                  <th scope="col">Receipt</th>
                  <th scope="col">Item</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {(orders.data?.orders ?? []).map((order) => (
                  <tr key={order.id}>
                    <td>
                      <a href={order.receipt_url}>{`Receipt ${order.receipt_number}`}</a>
                    </td>
                    <td>{order.description}</td>
                    <td className="figure">{formatPrice(order.amount_minor, order.currency)}</td>
                    <td>{order.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-label="Your path">
          <h2>Your path</h2>
          {saved && saved.last_chapter !== null ? (
            <p>
              <Link to={`/chapters/${saved.last_chapter}`}>
                {`Continue at chapter ${numeralFor(saved.last_chapter)}`}
              </Link>
            </p>
          ) : null}
          <ul>
            {(saved?.resolved ?? []).map((number) => (
              <li key={number}>
                <Link to={`/chapters/${number}`}>{`Chapter ${numeralFor(number)}`}</Link>
                <span className="accent"> Resolved</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Bookmarks">
          <h2>Bookmarks</h2>
          <ul>
            {bookmarks.map((bookmark) => (
              <li key={bookmark.id}>
                {bookmark.title}
                <button
                  type="button"
                  aria-label={`Remove bookmark ${bookmark.title}`}
                  onClick={() => {
                    void api(`/api/me/bookmarks/${bookmark.id}`, { method: 'DELETE' })
                      .then(() => refreshBookmarks())
                      .catch(() => undefined);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
