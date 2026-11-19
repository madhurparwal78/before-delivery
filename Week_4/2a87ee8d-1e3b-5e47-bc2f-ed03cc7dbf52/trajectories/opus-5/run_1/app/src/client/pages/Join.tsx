import { useEffect, useState } from 'react';
import { api, ApiError, reasonOf } from '../lib/api.js';
import { useRouter } from '../lib/router.js';
import { displayWallClock } from '../lib/format.js';
import type { JoinPageWorkshop } from '../../shared/protocol.js';

/** The messages a join link can answer with, in the wording the brief publishes. */
function joinMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return reasonOf(error);
  switch (error.code) {
    case 'not_found':
      return "We couldn't find that workshop link.";
    case 'link_revoked':
      return 'This join link has been turned off. Ask your facilitator for a new one.';
    case 'link_expired':
      return 'This join link has expired. Ask your facilitator for a new one.';
    case 'workshop_not_open':
      return "This workshop hasn't opened yet. Try again when your facilitator opens the room.";
    case 'workshop_closed':
      return 'This workshop has ended.';
    case 'room_full':
      return 'This room is full. Ask your facilitator to free a place.';
    case 'rate_limited':
      return `Too many attempts — try again in ${error.retryAfter ?? 0} seconds.`;
    default:
      return error.message;
  }
}

export function Join({ token }: { token: string }): JSX.Element {
  const { navigate } = useRouter();
  const [workshop, setWorkshop] = useState<JoinPageWorkshop | null>(null);
  const [blocked, setBlocked] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const result = await api<{ workshop: JoinPageWorkshop }>('GET', `/api/join/${token}`);
        setWorkshop(result.workshop);
      } catch (failure) {
        setBlocked(joinMessage(failure));
      }
    })();
  }, [token]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const result = await api<{ workshopId: string }>('POST', `/api/join/${token}`, { displayName });
      navigate(`/w/${result.workshopId}`);
    } catch (failure) {
      setError(joinMessage(failure));
    } finally {
      setPending(false);
    }
  }

  if (blocked !== '') {
    return (
      <main className="column join">
        <h1>Join a workshop</h1>
        <p role="alert">{blocked}</p>
      </main>
    );
  }

  return (
    <main className="column join">
      <h1>{workshop?.title ?? 'Join a workshop'}</h1>
      {workshop && (
        <p className="mono muted">
          {displayWallClock(workshop.scheduledStart)} to {displayWallClock(workshop.scheduledEnd)} (
          {workshop.timeZone})
        </p>
      )}
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="join-name">Your name</label>
          <input
            id="join-name"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <button type="submit" className="primary" disabled={pending}>
          {pending ? 'Joining…' : 'Join workshop'}
        </button>
      </form>
      <div role="alert" className="status-line problem">
        {error}
      </div>
    </main>
  );
}
