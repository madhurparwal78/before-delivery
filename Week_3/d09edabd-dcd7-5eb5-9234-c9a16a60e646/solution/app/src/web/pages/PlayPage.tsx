import '../styles/chrome.css';
import '../styles/play.css';
import { LiveTester } from '../play/LiveTester';
import { EndedScreen, StateScreen } from '../play/StateScreen';
import { useAnnouncement } from '../play/useAnnouncement';
import { usePlaytest } from '../play/usePlaytest';

interface ScreenProps {
  token: string;
  playtest: ReturnType<typeof usePlaytest>;
  announce: (message: string) => void;
}

function Screen({ token, playtest, announce }: ScreenProps) {
  const { phase } = playtest;
  switch (phase.kind) {
    case 'live':
      return (
        <LiveTester
          token={token}
          view={phase.view}
          receivedAt={phase.receivedAt}
          markers={playtest.markers}
          announce={announce}
          onJoined={playtest.joined}
          onSolved={playtest.solved}
          onExpire={playtest.sync}
        />
      );
    case 'ended':
      return <EndedScreen session={phase.session} />;
    case 'invalid':
      return (
        <StateScreen>
          <p>This link isn't valid.</p>
        </StateScreen>
      );
    case 'expired':
      return (
        <StateScreen>
          <p>This playtest invite has expired.</p>
        </StateScreen>
      );
    case 'loading':
      return <StateScreen />;
  }
}

/** The remote tester's page, reached by the capability link in their invite. */
export default function PlayPage({ token }: { token: string }) {
  const [status, announce] = useAnnouncement();
  const playtest = usePlaytest(token, announce);

  return (
    <>
      <div role="status" aria-label="Playtest status" className="play-status">
        {status}
      </div>
      <Screen token={token} playtest={playtest} announce={announce} />
    </>
  );
}
