import { createRoot } from 'react-dom/client';
import { JoinPage, PublicPage, SetEditor, ShowPage, Workspace } from './components/pages.js';

function Route() {
  const path = window.location.pathname;
  if (path === '/workspace') return <Workspace />;
  const set = /^\/sets\/([^/]+)$/.exec(path);
  if (set !== null) return <SetEditor setId={set[1] as string} />;
  const join = /^\/join\/([^/]+)$/.exec(path);
  if (join !== null) return <JoinPage token={join[1] as string} />;
  const show = /^\/show\/([^/]+)$/.exec(path);
  if (show !== null) return <ShowPage token={show[1] as string} />;
  return <PublicPage />;
}

const container = document.getElementById('root');
if (container !== null) createRoot(container).render(<Route />);
