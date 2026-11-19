import { api } from './api.js';
import { renderMarketing } from './marketing.js';
import { renderSignin, renderSignup, renderInvite, renderNotFound } from './auth.js';
import { OutlineApp, registerApp } from './outline.js';

async function boot(): Promise<void> {
  const root = document.getElementById('app') as HTMLElement;
  root.setAttribute('aria-busy', 'false');
  const path = window.location.pathname;

  window.addEventListener('popstate', () => {
    void boot();
  });

  if (path === '/' || path === '') {
    const me = await api<{ user: unknown }>('/api/me');
    if (me.status === 200 && me.body.user) {
      const app = new OutlineApp(root);
      registerApp(app);
      await app.init();
    } else {
      renderMarketing(root);
    }
    return;
  }
  if (path === '/signup') {
    const me = await api<{ user: unknown }>('/api/me');
    if (me.status === 200 && me.body.user) {
      window.location.href = '/';
      return;
    }
    renderSignup(root);
    return;
  }
  if (path === '/signin') {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    const email = params.get('email');
    const me = await api<{ user: unknown }>('/api/me');
    if (me.status === 200 && me.body.user) {
      window.location.href = next ?? '/';
      return;
    }
    renderSignin(root, next ? `${next}${email ? `&email=${email}` : ''}` : null);
    return;
  }
  if (path.startsWith('/invite/')) {
    renderInvite(root, path.slice('/invite/'.length));
    return;
  }
  if (path.startsWith('/b/')) {
    const app = new OutlineApp(root);
    registerApp(app);
    await app.init();
    return;
  }
  const me = await api<{ user: unknown }>('/api/me');
  if (me.status !== 200 || !me.body.user) {
    window.location.href = `/signin?next=${encodeURIComponent(path)}`;
    return;
  }
  renderNotFound(root);
}

void boot();
