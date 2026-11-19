/** Entry point: routes by address to the owner, buyer, inspector and ended-link pages. */
import { mountOwner } from './owner.js';
import { mountBuyer } from './buyer.js';
import { mountInspector } from './inspector.js';
import { mountEnded } from './ended.js';

const root = document.getElementById('app') as HTMLElement;

function route(): void {
  const path = window.location.pathname;
  const tokenMatch = /^\/l\/([A-Za-z0-9_-]+)$/.exec(path);
  if (path === '/l/ended' || path === '/l/unknown') { mountEnded(root, path === '/l/ended' ? 'ended' : 'unknown'); return; }
  if (tokenMatch) {
    const token = tokenMatch[1];
    void fetch(`/api/link/${token}`).then(async (reply) => {
      if (reply.ok) {
        const view = await reply.json() as { role: string };
        if (view.role === 'buyer') { mountBuyer(root, token); return; }
        mountInspector(root, token);
        return;
      }
      if (reply.status === 404) { mountEnded(root, 'unknown'); return; }
      mountEnded(root, 'ended');
    }).catch(() => mountEnded(root, 'unknown'));
    return;
  }
  if (path === '/' || path === '/owner' || path.startsWith('/owner/')) {
    mountOwner(root);
    return;
  }
  root.innerHTML = `<div class="notice-panel" style="margin:60px auto;max-width:520px"><h1>We could not find that page</h1></div>`;
}

route();
