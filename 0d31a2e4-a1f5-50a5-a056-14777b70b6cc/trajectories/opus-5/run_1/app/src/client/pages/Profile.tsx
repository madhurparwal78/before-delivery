import { useEffect, useState } from 'react';
import { roundKindForNumber, roundName } from '../../shared/rounds.js';
import type { ProfilePayload } from '../../shared/types.js';
import { api } from '../lib/api.js';
import { copy, errorCopy } from '../lib/copy.js';
import { Link } from '../lib/router.js';
import { store, useApp } from '../lib/store.js';
import { Bean } from '../lib/ui.js';

function placementText(outcome: 'winner' | 'eliminated', round: number | null): string {
  if (outcome === 'winner') return 'Winner';
  const n = round ?? 1;
  return `Out in ${roundName(roundKindForNumber(n))}`;
}

export function ProfilePage({ handle }: { handle: string }) {
  const { me, friends, pending } = useApp();
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [missing, setMissing] = useState(false);

  const reload = async (): Promise<void> => {
    try {
      setProfile(await api.get<ProfilePayload>(`/api/users/${handle.toLowerCase()}`));
    } catch (error) {
      setMissing(true);
      store.notice(errorCopy(error, { user_not_found: copy.noPlayer(handle) }));
    }
  };

  useEffect(() => {
    void reload();
  }, [handle, friends]);

  if (missing) {
    return (
      <section className="card">
        <h1>{handle}</h1>
        <p>{copy.noPlayer(handle)}</p>
      </section>
    );
  }
  if (profile === null) return <section className="card">Loading profile…</section>;

  const isMe = me !== null && me.id === profile.user.id;
  const target = profile.user;

  return (
    <div className="profile-page">
      <section className="card profile-card">
        <Bean hue={target.hue} size={96} />
        <h1>{target.handle}</h1>
        <p className="profile-counts">{`Matches played: ${profile.played}`}</p>
        <p className="profile-counts">{`Wins: ${profile.wins}`}</p>
        {isMe ? null : (
          <div className="profile-actions">
            {profile.friendship === 'none' || profile.friendship === 'pending_in' ? (
              <button
                type="button"
                className="primary"
                disabled={pending['send-request'] === true}
                aria-busy={pending['send-request'] === true}
                onClick={async () => {
                  await store.sendFriendRequest(target.handle);
                  await reload();
                }}
              >
                Add friend
              </button>
            ) : null}
            {profile.friendship === 'friends' ? (
              <button
                type="button"
                onClick={async () => {
                  await store.removeFriend(target.id, target.handle);
                  await reload();
                }}
              >
                {`Remove ${target.handle} from friends`}
              </button>
            ) : null}
            {profile.friendship === 'blocked' ? (
              <button
                type="button"
                onClick={async () => {
                  await store.unblockPlayer(target.id, target.handle);
                  await reload();
                }}
              >
                {`Unblock ${target.handle}`}
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  await store.blockPlayer(target.id, target.handle);
                  await reload();
                }}
              >
                {`Block ${target.handle}`}
              </button>
            )}
          </div>
        )}
      </section>
      <section className="card">
        <h2>Match history</h2>
        <ul className="match-history" aria-label="Match history">
          {profile.matches.map((entry) => (
            <li key={entry.id} className="history-row">
              <Link to={`/matches/${entry.id}`}>{`Cup #${entry.id}`}</Link>
              <span className={entry.outcome === 'winner' ? 'tag-qualified' : 'tag-eliminated'}>
                {placementText(entry.outcome, entry.round)}
              </span>
            </li>
          ))}
          {profile.matches.length === 0 ? <li className="empty-hint">No finished matches yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}
