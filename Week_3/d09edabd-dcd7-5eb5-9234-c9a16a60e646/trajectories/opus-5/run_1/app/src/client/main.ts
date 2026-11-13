import { request } from './api.js';
import { copy } from '../shared/copy.js';
import { clear, el } from './dom.js';
import { editorView } from './views/editor/index.js';
import { packView } from './views/pack.js';
import { publicView } from './views/public.js';
import { signInView } from './views/signin.js';
import { testerView } from './views/tester.js';

const root = document.querySelector<HTMLElement>('#root');

function notFound(target: HTMLElement): void {
  document.body.className = 'scrolls';
  target.append(el('div', { class: 'pack-column' }, [el('h1', { text: copy.linkInvalid })]));
}

async function route(target: HTMLElement): Promise<void> {
  clear(target);
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);
  const go = (next: string): void => {
    window.history.pushState(null, '', next);
    void route(target);
  };

  if (path === '/') {
    try {
      await request<unknown>('GET', '/api/me');
      go('/app');
      return;
    } catch {
      publicView(target, go);
      return;
    }
  }
  if (path === '/signin') {
    signInView(target, go);
    return;
  }
  if (path === '/app' || path.startsWith('/app/rooms/')) {
    const roomId = path.startsWith('/app/rooms/') ? path.slice('/app/rooms/'.length) : null;
    editorView(target, roomId === '' ? null : roomId, go);
    return;
  }
  if (path.startsWith('/play/')) {
    testerView(target, path.slice('/play/'.length));
    return;
  }
  if (path.startsWith('/pack/')) {
    packView(target, path.slice('/pack/'.length), query);
    return;
  }
  notFound(target);
}

if (root) {
  window.addEventListener('popstate', () => void route(root));
  void route(root);
}
