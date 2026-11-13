import { useEffect, useState } from 'react';

import { useStore } from './store.js';
import { api } from './api.js';
import { Landing } from './landing.js';
import { SignIn } from './signin.js';
import { Board } from './board.js';
import { SettingsPage } from './settings.js';
import { ImportsPage } from './imports.js';
import { HistoryPage } from './history.js';
import { QuestPage } from './history.js';
import { PlayerBar, RestBanner } from './playerbar.js';
import { ImportDialog, NoticeDialogs } from './dialogs.js';

function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return [path, (p: string) => { window.history.pushState({}, '', p); setPath(p); }] as const;
}

export function navigate(p: string): void {
  window.history.pushState({}, '', p);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function App() {
  const { player } = useStore();
  const [path, setPath] = usePath();
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (player && path === '/') {
      setPath('/board');
    }
  }, [player]);

  if (!player) {
    if (path === '/signin') return <SignIn />;
    return <Landing />;
  }

  const signedInPage = (() => {
    if (path === '/settings') return <SettingsPage />;
    if (path === '/imports') return <ImportsPage />;
    if (path === '/history') return <HistoryPage />;
    if (path.startsWith('/quests/')) return <QuestPage questId={path.slice('/quests/'.length)} />;
    return <Board />;
  })();

  const isQuestDetail = path.startsWith('/quests/');

  return (
    <div className="app-shell">
      <PlayerBar player={player} onImportTasks={() => setImportOpen(true)} />
      {player.resting && <RestBanner />}
      <main className={isQuestDetail ? 'page page-narrow' : 'page'}>{signedInPage}</main>
      {importOpen && (
        <ImportDialog onClose={() => setImportOpen(false)} />
      )}
      <NoticeDialogs />
    </div>
  );
}


