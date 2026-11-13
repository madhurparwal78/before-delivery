/** Account: addresses, saved cards, balance, gift cards and the password change. */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiFailure } from '../api.ts';
import { useSession } from '../state.tsx';
import { Amount, PendingButton, StatusRegion } from '../components/ui.tsx';
import { COPY } from '../../shared/messages.js';
import type { Address, SavedCard } from '../../shared/types.js';

export function AccountPage(): ReactNode {
  const { account, balancePaise, reload } = useSession();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [status, setStatus] = useState('');
  const [giftCard, setGiftCard] = useState('');
  const [giftMessage, setGiftMessage] = useState('');

  useEffect(() => {
    void api<{ addresses: Address[] }>('/api/account/addresses')
      .then((response) => setAddresses(response.addresses))
      .catch(() => setAddresses([]));
    void api<{ cards: SavedCard[] }>('/api/account/cards')
      .then((response) => setCards(response.cards))
      .catch(() => setCards([]));
  }, []);

  return (
    <>
      <h1>account</h1>
      <div className="grid grid-2">
        <section className="panel">
          <h3>addresses</h3>
          <ul className="plain">
            {addresses.map((address) => (
              <li key={address.id}>
                {`${address.label}: ${address.line1}, ${address.city} ${address.pincode}`}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel panel-black">
          <h3>saved cards</h3>
          <ul className="plain">
            {cards.map((card) => (
              <li key={card.card_id}>
                {`${card.network} ending ${card.last4} · ${String(card.expiry_month).padStart(2, '0')}/${card.expiry_year}`}
              </li>
            ))}
          </ul>
        </section>
        <section className="panel panel-yellow">
          <h3>balance</h3>
          <p className="price">
            {'Chauraha balance '}
            <Amount paise={balancePaise} />
          </p>
          <label htmlFor="gift-card">Gift card code</label>
          <input
            id="gift-card"
            type="text"
            aria-label="Gift card code"
            value={giftCard}
            onChange={(event) => setGiftCard(event.target.value)}
          />
          <PendingButton
            label="Redeem"
            onPress={async () => {
              try {
                await api('/api/balance/redeem', { method: 'POST', body: { code: giftCard } });
                await reload();
                setGiftMessage('');
              } catch (error) {
                if (error instanceof ApiFailure) {
                  setGiftMessage(error.field('code') ?? error.body.message);
                }
              }
            }}
          />
          {giftMessage === '' ? null : <p className="panel panel-pink">{giftMessage}</p>}
        </section>
        <section className="panel">
          <h3>change password</h3>
          <label htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            type="password"
            aria-label="Current password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            aria-label="New password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
          <PendingButton
            label="Change password"
            onPress={async () => {
              try {
                await api('/api/account/password', {
                  method: 'POST',
                  body: { current_password: current, new_password: next },
                });
                setStatus(COPY.passwordChanged);
                setCurrent('');
                setNext('');
              } catch (error) {
                if (error instanceof ApiFailure) {
                  setStatus(
                    error.field('current_password') ?? error.field('new_password') ?? error.body.message,
                  );
                }
              }
            }}
          />
          <StatusRegion name="Sign-in status" message={status} />
        </section>
      </div>
      <p className="muted">{account === null ? '' : `signed in as ${account.name}`}</p>
    </>
  );
}
