import { mmss } from '../../shared/format';
import type { Session } from '../../shared/types';
import { useCountdown } from '../ui/countdown';

export function SessionClock({ session }: { session: Session }) {
  return (
    <span role="timer" aria-label="Playtest clock" className="clock">
      {mmss(useCountdown(session.remainingSeconds, session))}
    </span>
  );
}
