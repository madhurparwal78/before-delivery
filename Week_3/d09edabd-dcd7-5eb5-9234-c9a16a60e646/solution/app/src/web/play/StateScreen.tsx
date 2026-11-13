import type { ReactNode } from 'react';
import type { PlaySession } from '../../shared/types';
import { outcomeLine } from '../../shared/format';

/** A full-window screen with one centred message: a link that does not work, or a session that is over. */
export function StateScreen({ children }: { children?: ReactNode }) {
  return (
    <main className="stage-region play-screen">
      {children ? <div className="play-message">{children}</div> : null}
    </main>
  );
}

/** The tester's ended screen. The outcome line is there when an event or a solve told the page how it ended. */
export function EndedScreen({ session }: { session: PlaySession | null }) {
  return (
    <StateScreen>
      <h1>Playtest ended</h1>
      {session?.outcome ? <p>{outcomeLine(session.outcome, session.durationSeconds - session.remainingSeconds)}</p> : null}
    </StateScreen>
  );
}
