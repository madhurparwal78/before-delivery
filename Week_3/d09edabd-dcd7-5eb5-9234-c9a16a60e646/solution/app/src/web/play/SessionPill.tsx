import type { PlaySession } from '../../shared/types';
import { PlaytestClock } from './PlaytestClock';

const STATUS_WORD = { scheduled: 'Scheduled', lobby: 'Lobby', running: 'Running', ended: 'Ended', cancelled: 'Cancelled' } as const;

interface Props {
  roomName: string;
  session: PlaySession;
  receivedAt: number;
  onExpire: () => void;
}

/** The top-centre pill: the room, the status word and, while the session runs, the playtest clock. */
export function SessionPill({ roomName, session, receivedAt, onExpire }: Props) {
  const running = session.state === 'running';
  return (
    <header className="pill play-pill" data-live={running}>
      <span className="status-dot" aria-hidden="true" />
      <h1 className="room-name">{roomName}</h1>
      <span className="status-word">{STATUS_WORD[session.state]}</span>
      {running ? <PlaytestClock remainingSeconds={session.remainingSeconds} receivedAt={receivedAt} onExpire={onExpire} /> : null}
    </header>
  );
}
