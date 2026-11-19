import { api, loadMe, setAlert, busyButton } from './types';
import { initHome } from './assembly';
import { initWeight, initWheel, initMotion, initRuleFocus } from './figures';
import { initLibrary } from './library';
import { initRequest } from './request';
import { initRequests, initQueue } from './lists';
import { initEditor } from './editor';
import { initAdminAssets, initAdminGrants, initAdminAudit, initAdminPeople } from './admin';

async function boot(): Promise<void> {
  const page = document.body.dataset.page ?? '';
  const me = await loadMe().catch(() => null);
  if (me) {
    (window as unknown as { __weightDelay?: number }).__weightDelay = me.weightAnnounceDelayMs;
  }

  wireSignOut();
  wireSignIn();
  wireActivate();
  connectLive();

  switch (page) {
    case 'home':
      initHome();
      break;
    case 'typography':
      initWeight();
      break;
    case 'colour':
      initWheel();
      break;
    case 'motion':
      initMotion();
      break;
    case 'library':
      await initLibrary();
      break;
    case 'request':
      await initRequest();
      break;
    case 'requests':
      await initRequests();
      break;
    case 'queue':
      await initQueue();
      break;
    case 'editor':
      await initEditor();
      break;
    case 'admin-assets':
      await initAdminAssets();
      break;
    case 'admin-grants':
      await initAdminGrants();
      break;
    case 'admin-audit':
      await initAdminAudit();
      break;
    case 'admin-people':
      await initAdminPeople();
      break;
    default:
      initRuleFocus();
      break;
  }
}

function wireSignOut(): void {
  const button = document.getElementById('sign-out');
  if (!button) return;
  button.addEventListener('click', async () => {
    const restore = busyButton(button as HTMLButtonElement, 'Saving');
    try {
      await api('/api/session', { method: 'DELETE' });
      window.location.href = '/';
    } finally {
      restore();
    }
  });
}

function wireSignIn(): void {
  const form = document.getElementById('signin-form') as HTMLFormElement | null;
  if (!form) return;
  const slot = form.querySelector<HTMLElement>('.alert-slot');
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!submit) return;
    const restore = busyButton(submit, 'Signing in');
    try {
      await api('/api/session', {
        method: 'POST',
        body: JSON.stringify({
          email: (form.querySelector('#email') as HTMLInputElement).value,
          password: (form.querySelector('#password') as HTMLInputElement).value,
        }),
      });
      window.location.href = '/library';
    } catch (err) {
      setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
    } finally {
      restore();
    }
  });
}

function wireActivate(): void {
  const form = document.getElementById('activate-form') as HTMLFormElement | null;
  if (!form) return;
  const slot = form.querySelector<HTMLElement>('.alert-slot');
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!submit) return;
    const restore = busyButton(submit, 'Saving');
    const token = form.dataset.token ?? '';
    try {
      await api(`/api/invitations/${encodeURIComponent(token)}/activate`, {
        method: 'POST',
        body: JSON.stringify({ password: (form.querySelector('#password') as HTMLInputElement).value }),
      });
      window.location.href = '/library';
    } catch (err) {
      setAlert(err instanceof Error ? err.message : 'Something went wrong.', slot);
    } finally {
      restore();
    }
  });
}

function connectLive(): void {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${window.location.host}/api/live`);
  socket.addEventListener('message', (event) => {
    let payload: { type?: string; requestId?: string } | null = null;
    try {
      payload = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!payload?.type) return;
    switch (payload.type) {
      case 'request.updated':
        window.dispatchEvent(new CustomEvent('rulehouse:request-updated', { detail: payload }));
        break;
      case 'queue.updated':
        window.dispatchEvent(new CustomEvent('rulehouse:queue-updated'));
        break;
      case 'library.updated':
        window.dispatchEvent(new CustomEvent('rulehouse:library-updated'));
        break;
      case 'grant.updated':
        window.dispatchEvent(new CustomEvent('rulehouse:grant-updated'));
        break;
      case 'chapter.updated':
        if (window.location.pathname.startsWith('/chapters/') || window.location.pathname === '/') {
          window.location.reload();
        }
        break;
    }
  });
  socket.addEventListener('close', () => {
    window.setTimeout(connectLive, 2000);
  });
}

void boot();
