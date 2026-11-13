import type { PlaySession } from '../../shared/types';
import { utcStamp } from '../../shared/format';
import { JOIN_FORM, type JoinState } from './useJoin';

interface Props {
  session: PlaySession;
  joined: boolean;
  join: JoinState;
}

/** Above the transport: what the session is waiting for, and the Display name field until the tester has joined. */
export function WaitingCard({ session, joined, join }: Props) {
  const waiting =
    session.state === 'scheduled' ? `This playtest starts ${utcStamp(session.startsAt)} UTC.` : session.state === 'lobby' ? 'Waiting for the game master to start.' : null;
  if (!waiting && joined) return null;
  return (
    <div className="play-card">
      {waiting ? <p>{waiting}</p> : null}
      {joined ? null : (
        <form id={JOIN_FORM} className="field" onSubmit={join.submit}>
          <label htmlFor="display-name">Display name</label>
          <input
            id="display-name"
            name="displayName"
            autoComplete="nickname"
            value={join.displayName}
            onChange={(event) => join.setDisplayName(event.target.value)}
            aria-describedby={join.refusal ? 'display-name-error' : undefined}
          />
          {join.refusal ? (
            <p id="display-name-error" className="field-error">
              {join.refusal}
            </p>
          ) : null}
        </form>
      )}
    </div>
  );
}
