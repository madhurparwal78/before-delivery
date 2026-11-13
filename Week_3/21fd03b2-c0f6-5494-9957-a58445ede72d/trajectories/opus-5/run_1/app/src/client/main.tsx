import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { matchPath, navigate, useLocation } from './nav.js';
import { Activity } from './screens/Activity.jsx';
import { Editor } from './screens/Editor.jsx';
import { Invite } from './screens/Invite.jsx';
import { Lab } from './screens/Lab.jsx';
import { Landing } from './screens/Landing.jsx';
import { NewWorkspace } from './screens/NewWorkspace.jsx';
import { NotFound } from './screens/NotFound.jsx';
import { Project } from './screens/Project.jsx';
import { Settings } from './screens/Settings.jsx';
import { SignIn } from './screens/SignIn.jsx';
import { SignUp } from './screens/SignUp.jsx';
import { ViewProject, ViewScene } from './screens/ViewLink.jsx';
import { Workspace } from './screens/Workspace.jsx';

function App(): JSX.Element {
  const location = useLocation();
  const match = matchPath(location.path);
  switch (match.name) {
    case 'landing':
      return <Landing />;
    case 'sign-in':
      return <SignIn />;
    case 'sign-up':
      return <SignUp />;
    case 'new-workspace':
      return <NewWorkspace />;
    case 'workspace':
      return <Workspace workspaceId={match.params.wid} />;
    case 'project':
      return <Project workspaceId={match.params.wid} projectId={match.params.pid} />;
    case 'editor':
      return <Editor workspaceId={match.params.wid} sceneId={match.params.sid} />;
    case 'settings':
      return <Settings workspaceId={match.params.wid} />;
    case 'activity':
      return <Activity workspaceId={match.params.wid} />;
    case 'invite':
      return <Invite token={match.params.token} />;
    case 'lab':
      return <Lab token={match.params.token} />;
    case 'view-project':
      return <ViewProject token={match.params.token} />;
    case 'view-scene':
      return <ViewScene token={match.params.token} sceneId={match.params.sid} />;
    default:
      return <NotFound />;
  }
}

/** Same-origin links move within the app without a reload. */
document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
  const anchor = (event.target as HTMLElement | null)?.closest('a');
  if (!anchor || anchor.target === '_blank') return;
  const href = anchor.getAttribute('href');
  if (!href || !href.startsWith('/')) return;
  event.preventDefault();
  navigate(href);
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
