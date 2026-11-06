import { ApiFailure } from './api';
import { Shell, buildShell, onNavigate, onTeamChange } from './shell';
import { canReach, homePath, loadSignedIn, state } from './state';
import { mountAdmin } from './screens/admin';
import { mountFinance } from './screens/finance';
import { mountJobs } from './screens/jobs';
import { mountLibrary } from './screens/library';
import { mountRun } from './screens/run';
import { mountSignIn } from './screens/signin';
import { mountWebhooks } from './screens/webhooks';

type Cleanup = () => void;

let cleanup: Cleanup | null = null;

const SCREENS: Record<string, { screen: string; mount: (shell: Shell) => Cleanup }> = {
  '/run': { screen: 'run', mount: mountRun },
  '/jobs': { screen: 'jobs', mount: mountJobs },
  '/library': { screen: 'library', mount: mountLibrary },
  '/webhooks': { screen: 'webhooks', mount: mountWebhooks },
  '/finance': { screen: 'finance', mount: mountFinance },
  '/admin': { screen: 'admin', mount: mountAdmin },
};

function render(path: string): void {
  cleanup?.();
  cleanup = null;
  if (!state.member) {
    mountSignIn(() => {
      void start(homePath());
    });
    return;
  }
  const entry = SCREENS[path];
  if (!entry || !canReach(entry.screen)) {
    const fallback = homePath();
    if (fallback !== path) {
      window.history.replaceState({}, '', fallback);
      render(fallback);
    }
    return;
  }
  const shell = buildShell(path);
  cleanup = entry.mount(shell);
}

function navigate(path: string): void {
  window.history.pushState({}, '', path);
  render(path);
}

async function start(path: string): Promise<void> {
  try {
    await loadSignedIn();
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    state.member = null;
    window.history.replaceState({}, '', '/signin');
    render('/signin');
    return;
  }
  const target = path === '/' || path === '/signin' ? homePath() : path;
  window.history.replaceState({}, '', target);
  render(target);
}

onNavigate((path) => {
  if (path === '/signin') {
    state.member = null;
    window.history.pushState({}, '', path);
    render(path);
    return;
  }
  navigate(path);
});

onTeamChange(() => {
  render(window.location.pathname);
});

window.addEventListener('popstate', () => {
  render(window.location.pathname);
});

void start(window.location.pathname);
