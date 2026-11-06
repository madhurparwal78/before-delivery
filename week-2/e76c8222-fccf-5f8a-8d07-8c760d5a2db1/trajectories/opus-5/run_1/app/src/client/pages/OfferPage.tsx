import { ReactElement, useEffect, useState } from 'react';
import { ApiCallError, api } from '../api';
import { LiveRegion } from '../components/LiveRegion';
import { cardDate, clock, dateAndClock } from '../format';
import { OfferPagePayload, SETTING_LABELS } from '../types';

export function OfferPage({ token }: { token: string }): ReactElement {
  const [offer, setOffer] = useState<OfferPagePayload | null>(null);
  const [message, setMessage] = useState('');
  const [outcome, setOutcome] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void api
      .offer(token)
      .then(setOffer)
      .catch(() => setMessage('That offer link is not valid.'));
  }, [token]);

  const answer = async (choice: 'accept' | 'decline'): Promise<void> => {
    setPending(true);
    setMessage('Sending your answer…');
    try {
      const payload =
        choice === 'accept' ? await api.acceptOffer(token) : await api.declineOffer(token);
      const copy =
        choice === 'accept'
          ? `Accepted. ${payload.request.ref} is on your schedule.`
          : 'Declined. The seat goes back to dispatch.';
      setMessage(copy);
      setOutcome(copy);
      setOffer(await api.offer(token));
    } catch (error) {
      const failure = error instanceof ApiCallError ? error.failure : null;
      const copy =
        failure?.code === 'offer_closed'
          ? `This offer is no longer open (${failure.offer_status ?? 'closed'}).`
          : 'That answer did not go through.';
      setMessage(copy);
      setOutcome(copy);
    } finally {
      setPending(false);
    }
  };

  if (!offer) {
    return (
      <main className="column">
        <h1>Offer</h1>
        <LiveRegion label="Offer status" message={message} />
      </main>
    );
  }

  return (
    <main className="column">
      <h1>Offer for {offer.request.ref}</h1>
      <dl>
        <div className="pair">
          <dt>Organisation</dt>
          <dd>{offer.request.org_name}</dd>
        </div>
        <div className="pair">
          <dt>Setting</dt>
          <dd>{SETTING_LABELS[offer.request.setting]}</dd>
        </div>
        <div className="pair">
          <dt>Assignment</dt>
          <dd>{offer.request.title}</dd>
        </div>
        <div className="pair">
          <dt>Location</dt>
          <dd>{offer.request.location}</dd>
        </div>
        <div className="pair">
          <dt>When</dt>
          <dd className="mono">
            {cardDate(offer.request.start)} {clock(offer.request.start)}–
            {clock(offer.request.end)}
          </dd>
        </div>
        <div className="pair">
          <dt>Seat</dt>
          <dd>
            {offer.seat.position} of {offer.seat.total}
          </dd>
        </div>
        <div className="pair">
          <dt>Offer expires</dt>
          <dd className="mono">{dateAndClock(offer.offer.expires_at)}</dd>
        </div>
        <div className="pair">
          <dt>Interpreter</dt>
          <dd>{offer.interpreter.name}</dd>
        </div>
      </dl>
      {offer.offer.status === 'active' && outcome === '' ? (
        <div className="row-actions">
          <button type="button" disabled={pending} onClick={() => void answer('accept')}>
            Accept offer
          </button>
          <button type="button" disabled={pending} onClick={() => void answer('decline')}>
            Decline offer
          </button>
        </div>
      ) : (
        <p>{outcome || `This offer is no longer open (${offer.offer.status}).`}</p>
      )}
      <LiveRegion label="Offer status" message={message} />
    </main>
  );
}
