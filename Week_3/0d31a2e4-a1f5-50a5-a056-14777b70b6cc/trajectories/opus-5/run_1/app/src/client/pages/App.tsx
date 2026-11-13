import { copy } from '../lib/copy.js';
import { Link, useLocation } from '../lib/router.js';
import { store, useApp } from '../lib/store.js';
import { Dock } from '../components/Dock.js';
import { MatchView } from '../components/MatchView.js';
import { LobbyView, PartyInvites, PartyView, ResultsView } from '../components/PartyViews.js';
import { Rail } from '../components/Rail.js';
import { MatchSummaryPage } from './MatchSummary.js';
import { PhotoFinishPage } from './PhotoFinish.js';
import { ProfilePage } from './Profile.js';

function TopBar() {
  const { me, layout, friendsPanelOpen, dockPanelOpen } = useApp();
  if (me === null) return null;
  return (
    <header className="top-bar">
      <Link to="/" className="brand display">
        Pratfall Cup
      </Link>
      {layout === 'narrow' ? (
        <button
          type="button"
          aria-expanded={friendsPanelOpen}
          onClick={() => store.setFriendsPanel(true)}
        >
          Friends
        </button>
      ) : null}
      {layout === 'wide' ? null : (
        <button
          type="button"
          aria-expanded={dockPanelOpen}
          onClick={() => store.setDockPanel(true)}
        >
          Party dock
        </button>
      )}
      <span className="signed-in">{`Signed in as ${me.handle}`}</span>
      <button type="button" onClick={() => void store.signOut()}>
        Sign out
      </button>
    </header>
  );
}

function UnverifiedBanner() {
  const { me, pending } = useApp();
  if (me === null || me.emailVerified) return null;
  return (
    <section className="banner" aria-label="Verify your email">
      <p>{copy.verifyBanner}</p>
      <button
        type="button"
        disabled={pending.resend === true}
        aria-busy={pending.resend === true}
        onClick={() => void store.resendVerification()}
      >
        Resend verification email
      </button>
      {pending.resend === true ? <span className="pending-copy">{copy.sending}</span> : null}
    </section>
  );
}

function StageContent() {
  const { party, round, matchId, resultsMatch } = useApp();
  const { pathname } = useLocation();

  const profile = /^\/u\/([^/]+)$/.exec(pathname);
  if (profile !== null) return <ProfilePage handle={profile[1]} />;
  const replay = /^\/matches\/(\d+)\/rounds\/(\d+)$/.exec(pathname);
  if (replay !== null) {
    return (
      <PhotoFinishPage matchId={Number(replay[1])} roundNumber={Number(replay[2])} />
    );
  }
  const summary = /^\/matches\/(\d+)$/.exec(pathname);
  if (summary !== null) return <MatchSummaryPage matchId={Number(summary[1])} />;

  if (party === null) return <section className="card">Loading your party…</section>;
  if (party.state === 'in_match' && round !== null && matchId !== null) {
    return <MatchView party={party} round={round} matchId={matchId} />;
  }
  if (resultsMatch !== null) return <ResultsView match={resultsMatch} />;
  if (party.state === 'queued' || party.state === 'in_lobby') return <LobbyView party={party} />;
  return <PartyView party={party} />;
}

export function AppShell() {
  const { notice, me } = useApp();
  const { pathname } = useLocation();
  /** Match pages give the replay the whole stage; the dock belongs to the party view. */
  const replayRoute = pathname.startsWith('/matches/');

  if (me === null) return null;

  return (
    <div className="shell">
      <TopBar />
      <div role="status" aria-label="Notices" aria-live="polite" className="notices shell-notices">
        {notice}
      </div>
      <UnverifiedBanner />
      <div className={replayRoute ? 'columns columns-wide-stage' : 'columns'}>
        <Rail />
        <main className="stage">
          <PartyInvites />
          <StageContent />
        </main>
        {replayRoute ? null : <Dock />}
      </div>
    </div>
  );
}
