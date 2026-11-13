import { useEffect, useState } from 'react';
import type { Deck, DeckSummary, HostRoom } from '../../shared/protocol';
import { api } from '../lib/api';
import { copy } from '../lib/copy';
import { Link, useRouter } from '../lib/router';
import { FieldError, HostHeader, StatusRegion, describedBy } from '../components';

export function Decks({ onSignedOut }: { onSignedOut: () => void }): JSX.Element {
  const { navigate } = useRouter();
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    const result = await api.get<{ decks: DeckSummary[] }>('/api/decks');
    if (result.ok) setDecks(result.data.decks);
  };

  useEffect(() => {
    void load();
  }, []);

  const createDeck = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setTitleError(undefined);
    setStatus(copy.creatingDeck);
    const result = await api.post<{ deck: Deck }>('/api/decks', { title });
    setBusy(false);
    if (result.ok) {
      setTitle('');
      setStatus(copy.deckCreated);
      await load();
      return;
    }
    setTitleError(result.failure.fields['title']);
    setStatus(result.failure.code === 'validation_failed' ? '' : copy.somethingWentWrong);
  };

  const openRoom = async (deckId: string): Promise<void> => {
    setStatus(copy.openingRoom);
    const result = await api.post<{ room: HostRoom }>('/api/rooms', { deckId });
    if (result.ok) {
      navigate(`/stage/${result.data.room.id}`);
      return;
    }
    setStatus(
      result.failure.fields['deckId'] === 'Deck has no questions'
        ? copy.emptyDeck
        : copy.somethingWentWrong,
    );
  };

  const signOut = async (): Promise<void> => {
    await api.post('/api/auth/logout');
    onSignedOut();
    navigate('/host/login');
  };

  return (
    <main className="page">
      <HostHeader title="Decks">
        <Link to="/host/nights">Past nights</Link>
        <button className="button button-quiet" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </HostHeader>
      <h1>Your decks</h1>
      <form className="deck-create" onSubmit={createDeck}>
        <div className="field">
          <label htmlFor="new-deck-title">New deck title</label>
          <input
            id="new-deck-title"
            type="text"
            value={title}
            maxLength={80}
            aria-describedby={describedBy('new-deck-error', titleError)}
            onChange={(event) => setTitle(event.target.value)}
          />
          <FieldError id="new-deck-error" message={titleError} />
        </div>
        <button className="button button-primary" type="submit" disabled={busy}>
          Create deck
        </button>
      </form>
      <StatusRegion label="Decks status" text={status} />
      <ul className="deck-list" aria-label="Decks">
        {decks.map((deck) => (
          <li className="deck-row" key={deck.id}>
            <div className="deck-main">
              <div className="deck-title">
                <Link to={`/host/decks/${deck.id}`}>{deck.title}</Link>
              </div>
              <span className="deck-count">{deck.questionCount} questions</span>
            </div>
            <button
              className="button"
              type="button"
              aria-label={`Open room for ${deck.title}`}
              onClick={() => void openRoom(deck.id)}
            >
              Open room
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
