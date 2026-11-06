import { createRoot } from 'react-dom/client';
import { useEffect, type JSX } from 'react';
import { AccountDialog, UnlockVaultDialog } from './Account';
import { ContextPane } from './Context';
import { NoteColumn, Rail, TopBar } from './Notebook';
import { ApprovalPage, InvitePage, OpsConsole } from './Pages';
import { store } from './state';
import { useCairn } from './ui';

function NotebookScreen(): JSX.Element {
  const state = useCairn();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (state.railOpen) store.setRailOpen(false);
      else if (state.contextOpen) store.setContextOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.railOpen, state.contextOpen]);

  return (
    <div
      className={`shell${state.railOpen ? ' rail-open' : ''}${state.contextOpen ? ' context-open' : ''}${
        state.contextTab === 'publish' ? ' publish-wide' : ''
      }`}
    >
      <TopBar />
      <div className="columns">
        <Rail />
        <main className="note-main">
          <NoteColumn />
        </main>
        <ContextPane />
      </div>
      <AccountDialog />
      <UnlockVaultDialog />
    </div>
  );
}

function Screen(): JSX.Element {
  const state = useCairn();
  const path = window.location.pathname;
  const approval = /^\/devices\/approve\/(.+)$/.exec(path);
  const invite = /^\/invites\/(.+)$/.exec(path);

  if (!state.ready) return <p className="loading">Opening your notebook…</p>;
  if (approval?.[1]) return <ApprovalPage token={approval[1]} />;
  if (invite?.[1]) return <InvitePage token={invite[1]} />;
  if (path === '/ops') return <OpsConsole />;
  return <NotebookScreen />;
}

const root = document.getElementById('cairn-root');
if (root) {
  createRoot(root).render(<Screen />);
  void store.init();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
}
