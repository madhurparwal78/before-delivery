import { clear, el } from './dom.js';
import { navigate, startRouter, type Screen } from './router.js';
import { entryScreens } from './screens/index.js';
import { currentIdentity, landingRoute, loadIdentity, may, type Identity } from './state.js';
import { ConsoleShell } from './ui/shell.js';

const root = document.getElementById('app');
if (root === null) throw new Error('app root missing');

const projectTabs = ['keys', 'sessions', 'review', 'synthesis', 'settings'] as const;
type ProjectTab = (typeof projectTabs)[number];

let screen: Screen | null = null;
let shell: ConsoleShell | null = null;

const mountStandalone = (next: Screen): void => {
  screen?.destroy?.();
  shell?.destroy();
  shell = null;
  screen = next;
  clear(root);
  root.append(next.node);
};

const mountConsole = (identity: Identity, path: string, next: Screen): void => {
  screen?.destroy?.();
  screen = next;
  if (shell === null) {
    shell = new ConsoleShell(identity);
    clear(root);
    root.append(shell.node);
  }
  shell.setRoute(path);
  clear(shell.workspace);
  shell.workspace.append(next.node);
};

const consoleScreen = (identity: Identity, path: string, search: URLSearchParams): Screen | null => {
  const role = identity.user.role;
  if (path === '/console/projects') {
    if (!may(role, 'projects')) return null;
    return entryScreens.projects(identity);
  }
  const projectMatch = /^\/console\/projects\/([^/]+)\/([^/]+)$/.exec(path);
  if (projectMatch !== null) {
    const tab = projectMatch[2] as ProjectTab;
    if (!projectTabs.includes(tab)) return null;
    return entryScreens.project(identity, projectMatch[1] as string, tab);
  }
  const sessionMatch = /^\/console\/sessions\/([^/]+)$/.exec(path);
  if (sessionMatch !== null) {
    if (!may(role, 'sessions')) return null;
    return entryScreens.sessionDetail(identity, sessionMatch[1] as string, search.get('segment'));
  }
  if (path === '/console/usage') {
    if (!may(role, 'usage')) return null;
    return entryScreens.usage();
  }
  if (path === '/console/org/members') {
    if (!may(role, 'members')) return null;
    return entryScreens.members();
  }
  if (path === '/console/org/plan') {
    if (!may(role, 'plan')) return null;
    return entryScreens.plan();
  }
  return null;
};

const notFound = (): Screen => ({
  node: el('main', { class: 'entry' }, [
    el('section', { class: 'entry-card' }, [
      el('h1', { class: 'entry-title', text: 'Not found' }),
      el('a', { href: '/', class: 'link', text: 'Back to the public site' }),
    ]),
  ]),
});

const render = async (path: string, search: URLSearchParams): Promise<void> => {
  if (path === '/') {
    mountStandalone(entryScreens.publicSite());
    return;
  }
  if (path === '/sign-in') {
    mountStandalone(entryScreens.signIn());
    return;
  }
  const joinMatch = /^\/join\/([^/]+)$/.exec(path);
  if (joinMatch !== null) {
    mountStandalone(entryScreens.join(joinMatch[1] as string));
    return;
  }
  if (!path.startsWith('/console/')) {
    mountStandalone(notFound());
    return;
  }

  const identity = currentIdentity() ?? (await loadIdentity());
  if (identity === null) {
    navigate('/sign-in', { replace: true });
    return;
  }
  const next = consoleScreen(identity, path, search);
  if (next === null) {
    navigate(landingRoute(identity.user.role), { replace: true });
    return;
  }
  mountConsole(identity, path, next);
};

void loadIdentity().then(() => startRouter((path, search) => void render(path, search)));
