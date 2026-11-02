import { type ReactNode, useEffect } from 'react';
import { formatViewerZoneTime } from '../shared/businessTime.ts';
import { COPY } from './lib/copy.ts';
import { useAppState, usePendingFocus } from './lib/hooks.ts';
import { paramsToSearch, store } from './lib/store.ts';
import { Dialogs } from './components/Dialogs.tsx';
import { SignIn } from './screens/SignIn.tsx';
import { Catalog } from './screens/Catalog.tsx';
import { Glossary } from './screens/Glossary.tsx';
import { Admin } from './screens/Admin.tsx';

function TopBar(): ReactNode {
  const state = useAppState();
  const session = state.session;
  if (session === null) return null;
  const go = (path: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    store.navigate(path);
  };
  return (
    <header className="top-bar">
      <span className="wordmark">Quarrystone Strata</span>
      <nav aria-label="Main">
        <a href="/catalog" onClick={go('/catalog')}>
          Catalog
        </a>
        <a href="/glossary" onClick={go('/glossary')}>
          Glossary
        </a>
        {session.role === 'Admin' ? (
          <a href="/admin" onClick={go('/admin')}>
            Admin
          </a>
        ) : null}
      </nav>
      <span className="signed-in">
        {session.name} <span className="role">{session.role}</span>
      </span>
      <button type="button" onClick={() => void store.signOut()}>
        Sign out
      </button>
    </header>
  );
}

function Banners(): ReactNode {
  const state = useAppState();
  const status = state.status;
  if (state.session === null || status === null) return null;
  return (
    <>
      {status.evidence === 'down' ? (
        <div role="alert" aria-label="Evidence storage outage" className="banner">
          {COPY.evidenceOutage}
        </div>
      ) : null}
      {status.mail === 'down' ? (
        <div role="alert" aria-label="Mail relay outage" className="banner">
          <span>{COPY.mailOutage}</span>
          <span className="mono">
            {COPY.queuedNotices} <span data-queued-notices>{status.queued_notices}</span>
          </span>
        </div>
      ) : null}
    </>
  );
}

function PointInTimeNote(): ReactNode {
  const state = useAppState();
  const seq = state.params.asOf;
  if (seq === null || state.route !== 'catalog' || state.session?.role !== 'Admin') return null;
  const recorded =
    seq === 0
      ? COPY.pointInTimeSeedState
      : COPY.pointInTimeRecorded(
          seq,
          state.asOfAt === null ? '' : formatViewerZoneTime(state.asOfAt),
        );
  return (
    <div role="note" aria-label="Point in time" className="note">
      <p>
        <span className="mono">{COPY.pointInTimeHeading(seq)}</span>
      </p>
      <p data-recorded-at className="mono">
        {recorded}
      </p>
      {state.newerChanges > 0 ? (
        <p data-newer-changes>{COPY.pointInTimeNewer(state.newerChanges, seq)}</p>
      ) : null}
      <a
        href={`/catalog${paramsToSearch({ ...state.params, asOf: null })}`}
        onClick={(event) => {
          event.preventDefault();
          store.navigate(`/catalog${paramsToSearch({ ...state.params, asOf: null })}`);
        }}
      >
        Back to the live catalog
      </a>
    </div>
  );
}

export function App(): ReactNode {
  const state = useAppState();
  usePendingFocus(state.pendingFocus);

  useEffect(() => {
    // The stylesheet reads this to switch every transition off at once.
    document.documentElement.dataset.appMotion = state.motion;
  }, [state.motion]);

  if (!state.sessionChecked) return <div className="booting" />;
  if (state.route === 'signin' || state.session === null) return <SignIn />;

  return (
    <>
      <TopBar />
      <main
        {...(state.syncedSeq === null ? {} : { 'data-synced-seq': state.syncedSeq })}
        data-motion={state.motion}
      >
        <Banners />
        <PointInTimeNote />
        {state.route === 'catalog' ? <Catalog /> : null}
        {state.route === 'glossary' ? <Glossary /> : null}
        {state.route === 'admin' ? <Admin /> : null}
      </main>
      <Dialogs />
    </>
  );
}
