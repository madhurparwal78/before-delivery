import { CSS } from './ui';
import { parseRoute } from './router';
import { landingScreen, signInScreen, signUpScreen, newWorkspaceScreen, workspaceScreen, projectScreen, settingsScreen, activityScreen, inviteScreen, notFoundScreen } from './screens-basic';
import { editorScreen } from './editor';
import { labScreen } from './lab';
import { viewScreen, viewSceneScreen } from './view';

const style = document.createElement('style');
style.textContent = CSS;
document.head.append(style);

function mount(): void {
  const existing = document.getElementById('root');
  if (existing) existing.remove();
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  const route = parseRoute(location.pathname, location.search);
  switch (route.name) {
    case 'landing': landingScreen(root); break;
    case 'sign-in': signInScreen(root, route); break;
    case 'sign-up': signUpScreen(root, route); break;
    case 'workspaces-new': newWorkspaceScreen(root); break;
    case 'workspace': workspaceScreen(root, route); break;
    case 'project': projectScreen(root, route); break;
    case 'editor': editorScreen(root, route); break;
    case 'settings': settingsScreen(root, route); break;
    case 'activity': activityScreen(root, route); break;
    case 'invite': inviteScreen(root, route); break;
    case 'lab': labScreen(root, route.token); break;
    case 'view': viewScreen(root, route.token); break;
    case 'view-scene': viewSceneScreen(root, route.token, route.sid); break;
    case 'not-found': notFoundScreen(root); break;
  }
}

window.addEventListener('popstate', () => mount());
mount();
