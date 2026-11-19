import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { announce } from '../announce';
import { useConfig } from '../clock';
import { formatCount } from '../format';
import type { ConnectionState, PersonCard as PersonCardData } from '../types';
import { Alert, Button } from '../ui';
import { connectionAnnouncement, connectionButtons, connectionFailure, sendConnectionAction, type ConnectionAction } from './connection';
import { DEGREE_LABELS } from './degree';
import './person-card.css';

export type CardAction = Exclude<ConnectionAction, 'remove'>;

interface PersonCardProps {
  card: PersonCardData;
  /** Runs after an action succeeded, before the parent refetches. */
  onAct?: (action: CardAction, card: PersonCardData) => void;
  /** Text under the headline, such as when the invitation was sent. */
  note?: string;
}

/** The accessible name of a card button: the verb with the member's name. */
function cardButtonName(label: string, name: string): string {
  if (label === 'Withdraw') return `Withdraw request to ${name}`;
  if (label === 'Connect') return `Connect with ${name}`;
  return `${label} ${name}`;
}

/** The person card: name, headline, degree label and the buttons the connection state allows. */
export function PersonCard({ card, onAct, note }: PersonCardProps) {
  const config = useConfig();
  const [state, setState] = useState<ConnectionState>(card.connection_state);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => setState(card.connection_state), [card.connection_state]);

  const act = async (action: CardAction): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      const next = await sendConnectionAction(action, card.id);
      setState(next);
      announce('Network announcements', connectionAnnouncement(action, card.name, next, false));
      onAct?.(action, card);
    } catch (error) {
      if (action === 'connect') announce('Network announcements', 'Invitation not sent.');
      setProblem(action === 'connect' ? connectionFailure(error, card.name, config.time_zone) : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="person-card surface" data-member-id={card.id} data-degree={card.degree} data-connection-state={state}>
      {card.photo_url ? <img className="person-photo" src={card.photo_url} alt="" width="96" height="96" /> : null}
      <div className="person-body">
        <p className="person-name">
          <Link to={`/in/${card.handle}`}>{card.name}</Link>
        </p>
        {card.headline ? <p className="person-headline">{card.headline}</p> : null}
        <p className="person-meta muted">
          <span data-degree-badge data-degree={card.degree}>
            {DEGREE_LABELS[card.degree]}
          </span>
          {card.mutual_count > 0 ? <span>{formatCount(card.mutual_count)} mutual</span> : null}
          {note ? <span>{note}</span> : null}
        </p>
        <div className="person-actions">
          {connectionButtons(state, { remove: false, messageReady: true }).map((button) =>
            button.action ? (
              <Button key={button.id} aria-label={cardButtonName(button.label, card.name)} disabled={busy} onClick={() => void act(button.action as CardAction)}>
                {button.label}
              </Button>
            ) : (
              <Link key={button.id} className="button" aria-label={cardButtonName(button.label, card.name)} to={`/messaging/with/${card.handle}`}>
                {button.label}
              </Link>
            ),
          )}
        </div>
        <Alert>{problem}</Alert>
      </div>
    </li>
  );
}
