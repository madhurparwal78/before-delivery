import { useEffect, useState } from 'react';
import type { Clay, DropoffResult, Piece } from '../../shared/types';
import { formatMoney } from '../../shared/labels';
import { ApiFailure, api, newIdempotencyKey } from '../api';
import { PieceForm } from '../components/PieceForm';
import { LiveRegion, type LiveMessage } from '../components/bits';

interface CardState {
  message: LiveMessage;
  sending: boolean;
  paid: boolean;
}

export function CounterScreen(): JSX.Element {
  const [clays, setClays] = useState<Clay[]>([]);
  const [owing, setOwing] = useState<Piece[]>([]);
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [paidCards, setPaidCards] = useState<Piece[]>([]);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');

  const loadOwing = (): void => {
    void api
      .get<Piece[]>('/api/pieces?status=awaiting_payment')
      .then((pieces) => setOwing(pieces));
  };

  useEffect(() => {
    void api.get<Clay[]>('/api/clays').then(setClays);
    loadOwing();
  }, []);

  const logDropoff = async (payload: unknown, key: string): Promise<LiveMessage> => {
    const result = await api.post<DropoffResult>(
      '/api/dropoffs',
      { ...(payload as Record<string, unknown>), guest_name: guestName, guest_email: guestEmail },
      { 'Idempotency-Key': key },
    );
    loadOwing();
    return {
      text: `Piece ${result.piece.number} logged for ${result.piece.owner.name}. Amount due $${formatMoney(
        result.amount_due_cents,
      )}.`,
      tone: 'good',
    };
  };

  const takePayment = async (piece: Piece): Promise<void> => {
    setCards((current) => ({
      ...current,
      [piece.number]: {
        message: { text: 'Recording payment…', tone: 'pending' },
        sending: true,
        paid: false,
      },
    }));
    try {
      const result = await api.post<{ paid_cents: number }>(
        `/api/dropoffs/${piece.number}/payment`,
        {},
        { 'Idempotency-Key': newIdempotencyKey() },
      );
      setCards((current) => ({
        ...current,
        [piece.number]: {
          message: {
            text: `Paid $${formatMoney(result.paid_cents)} — Piece ${piece.number} is in the queue.`,
            tone: 'good',
          },
          sending: false,
          paid: true,
        },
      }));
      setPaidCards((current) => [...current, piece]);
      loadOwing();
    } catch (error) {
      const text =
        error instanceof ApiFailure && error.status === 409
          ? 'Already paid.'
          : 'Payment not recorded — billing is unreachable. The piece stays Owed.';
      setCards((current) => ({
        ...current,
        [piece.number]: { message: { text, tone: 'bad' }, sending: false, paid: false },
      }));
    }
  };

  const cardList = [
    ...owing.filter((piece) => !paidCards.some((paid) => paid.number === piece.number)),
    ...paidCards,
  ];

  return (
    <section>
      <h1>Counter</h1>
      <form
        className="pane"
        aria-label="Guest drop-off"
        onSubmit={(event) => event.preventDefault()}
      >
        <h2>Guest drop-off</h2>
        <PieceForm
          clays={clays}
          submitLabel="Log drop-off"
          resultName="Drop-off result"
          pendingText="Saving photo, charge and receipt…"
          onSubmit={logDropoff}
          renderExtra={(fields) => (
            <>
              <div className="field">
                <label htmlFor="field-guest_name">Guest name</label>
                <input
                  id="field-guest_name"
                  type="text"
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                />
                {fields.guest_name && <p className="field-error">{fields.guest_name}</p>}
              </div>
              <div className="field">
                <label htmlFor="field-guest_email">Guest email</label>
                <input
                  id="field-guest_email"
                  type="text"
                  value={guestEmail}
                  onChange={(event) => setGuestEmail(event.target.value)}
                />
                {fields.guest_email && <p className="field-error">{fields.guest_email}</p>}
              </div>
            </>
          )}
        />
      </form>

      <h2>Drop-offs at the counter</h2>
      {cardList.length === 0 && <p>No drop-offs are waiting to be paid.</p>}
      {cardList.map((piece) => {
        const card = cards[piece.number];
        return (
          <article
            className="card"
            key={piece.number}
            aria-label={`Drop-off Piece ${piece.number}`}
          >
            <h3>Piece {piece.number}</h3>
            <p>{piece.owner.name}</p>
            <p className="mono">Amount due ${formatMoney(piece.fee_cents)}</p>
            <p>
              {card?.paid || piece.payment_status === 'paid' ? (
                <span className="good">Paid</span>
              ) : (
                <strong>Owed</strong>
              )}
            </p>
            <button
              type="button"
              className="primary"
              aria-disabled={card?.sending || card?.paid ? true : undefined}
              onClick={() => {
                if (!card?.sending && !card?.paid) void takePayment(piece);
              }}
            >
              Take payment
            </button>
            {card?.message && <LiveRegion name="Payment result" message={card.message} />}
          </article>
        );
      })}
    </section>
  );
}
