import { getJson, remove, RequestFailed } from './lib/api.js';
import { buildShell, setOffline } from './lib/shell.js';
import { renderAccount, renderNotFound } from './views/account.js';
import { leaveJob, renderJob } from './views/job.js';
import { renderJobs } from './views/jobs.js';
import { renderSignIn } from './views/signin.js';

function navigate(path: string): void {
  if (path !== location.pathname + location.search) {
    history.pushState({}, '', path);
  }
  void route();
}

async function route(): Promise<void> {
  const path = location.pathname;
  const search = new URLSearchParams(location.search);

  if (path === '/signin') {
    leaveJob();
    renderSignIn(navigate, search.get('signedout') === '1');
    return;
  }

  try {
    await getJson('/api/me');
  } catch (error) {
    if (error instanceof RequestFailed && error.status === 401) {
      leaveJob();
      renderSignIn(navigate, true);
      return;
    }
    setOffline(true);
  }

  const jobItem = /^\/jobs\/([^/]+)\/items\/([^/]+)$/.exec(path);
  const jobOnly = /^\/jobs\/([^/]+)$/.exec(path);

  try {
    if (path === '/' || path === '/jobs') {
      leaveJob();
      await renderJobs(navigate);
    } else if (jobOnly !== null) {
      await renderJob(jobOnly[1], null, navigate);
    } else if (jobItem !== null) {
      await renderJob(jobItem[1], jobItem[2], navigate);
    } else if (path === '/account') {
      leaveJob();
      renderAccount();
    } else {
      leaveJob();
      renderNotFound();
    }
  } catch (error) {
    leaveJob();
    if (error instanceof RequestFailed && error.status === 401) {
      renderSignIn(navigate, true);
      return;
    }
    renderNotFound();
  }
}

function start(): void {
  buildShell();
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }
  setOffline(!navigator.onLine);
  window.addEventListener('online', () => setOffline(false));
  window.addEventListener('offline', () => setOffline(true));

  document.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement).closest('a[data-link]') as HTMLAnchorElement | null;
    if (link === null) return;
    event.preventDefault();
    navigate(link.getAttribute('href') ?? '/jobs');
  });

  document.getElementById('signout')?.addEventListener('click', () => {
    void (async () => {
      try {
        await remove('/api/session');
      } catch {
        // Signing out locally is enough when the network is gone.
      }
      leaveJob();
      navigate('/signin?signedout=1');
    })();
  });

  window.addEventListener('popstate', () => void route());
  void route();
}

start();
