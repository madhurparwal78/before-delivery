import { setSession } from './api';
import { el } from './dom';
import { renderEditor } from './editor';
import { renderDiagrams } from './screens/diagrams';
import { renderInvite } from './screens/invite';
import { renderNotFound } from './screens/notfound';
import { renderSignIn } from './screens/signin';
import { setNotFoundHandler, startRouter } from './router';

interface BootData {
  user: { id: string; email: string; displayName: string } | null;
  csrfToken: string | null;
  notFound: 'diagram' | 'page' | null;
  firstPageId: string | null;
}

declare global {
  interface Window {
    __BOOT__?: BootData;
  }
}

const boot: BootData = window.__BOOT__ ?? { user: null, csrfToken: null, notFound: null, firstPageId: null };
setSession(boot.user, boot.csrfToken);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('missing root element');
const root: HTMLElement = rootElement;

const announcements = el('div', {
  role: 'status',
  'aria-live': 'polite',
  'aria-label': 'Announcements',
  class: 'announcements',
  'data-announcements': 'true',
});
document.body.append(announcements);

let bootHandled = false;

setNotFoundHandler((kind) => {
  renderNotFound(root, kind);
});

function render(path: string): void {
  if (!bootHandled && boot.notFound) {
    bootHandled = true;
    renderNotFound(root, boot.notFound);
    return;
  }
  bootHandled = true;
  const invite = /^\/invite\/(.+)$/.exec(path);
  if (invite?.[1]) {
    void renderInvite(root, invite[1]);
    return;
  }
  if (path === '/signin') {
    renderSignIn(root);
    return;
  }
  if (path === '/') {
    void renderDiagrams(root);
    return;
  }
  const page = /^\/d\/([^/]+)\/p\/([^/]+)$/.exec(path);
  if (page?.[1] && page[2]) {
    void renderEditor(root, page[1], page[2]);
    return;
  }
  const diagram = /^\/d\/([^/]+)$/.exec(path);
  if (diagram?.[1]) {
    void renderEditor(root, diagram[1], null);
    return;
  }
  renderNotFound(root, 'page');
}

startRouter(render);
