import { useEffect } from 'react';
import { todayOnDevice } from '../domain/format.ts';
import { Shell } from './components/Shell.tsx';
import { useStore } from './hooks.ts';
import { navigate, useRoute } from './router.ts';
import { DocumentList, createDocument } from './routes/DocumentList.tsx';
import { DocumentScreen } from './routes/DocumentScreen.tsx';
import { Journal } from './routes/Journal.tsx';
import { NotFound } from './routes/NotFound.tsx';
import { RecordsList } from './routes/RecordsList.tsx';
import { Settings } from './routes/Settings.tsx';
import { Shared } from './routes/Shared.tsx';
import { TableScreen } from './routes/TableScreen.tsx';
import { Templates } from './routes/Templates.tsx';
import { Trash } from './routes/Trash.tsx';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function Screen(props: { path: string }) {
  const path = props.path;
  if (path === '/') return <DocumentList />;
  if (path === '/trash') return <Trash />;
  if (path === '/records') return <RecordsList />;
  if (path === '/templates') return <Templates />;
  if (path === '/settings') return <Settings />;

  const documentMatch = /^\/doc\/([^/]+)$/.exec(path);
  if (documentMatch) return <DocumentScreen documentId={decodeURIComponent(documentMatch[1])} />;

  const tableMatch = /^\/records\/([^/]+)$/.exec(path);
  if (tableMatch) return <TableScreen tableId={decodeURIComponent(tableMatch[1])} />;

  const journalMatch = /^\/journal\/([^/]+)$/.exec(path);
  if (journalMatch && DATE.test(journalMatch[1])) return <Journal date={journalMatch[1]} />;

  return <NotFound kind="page" />;
}

export function App() {
  const route = useRoute();
  const state = useStore();

  useEffect(() => {
    if (route.path === '/journal') navigate(`/journal/${todayOnDevice()}`, { replace: true });
  }, [route.path]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.altKey && (event.key === 'n' || event.key === 'N')) {
        event.preventDefault();
        void createDocument();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const sharedMatch = /^\/s\/([^/]+)$/.exec(route.path);
  if (sharedMatch) return <Shared token={decodeURIComponent(sharedMatch[1])} />;

  return <Shell>{state.ready && route.path !== '/journal' ? <Screen path={route.path} /> : null}</Shell>;
}
