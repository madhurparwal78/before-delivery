// Editor chrome: role modes, layout, presence, pins, cursors, banners, URL.
import type { Breakpoint } from '../shared/domain.js';
import { el } from './canvas.js';
import type { EditorState } from './state.js';

export function renderPresence(state: EditorState): void {
  const holder = document.getElementById('presence')!;
  holder.innerHTML = '';
  const people = [...state.people];
  people.sort((a, b) => (a.id === state.userId ? -1 : b.id === state.userId ? 1 : 0));
  for (const person of people) {
    const suffix = person.role === 'viewer' ? 'viewing' : 'editing';
    const btn = el('button', {
      'aria-label': `${person.name}, ${suffix}`,
      'data-user-id': person.id,
      title: `${person.name}, ${suffix}`,
    }, person.name.slice(0, 2).toUpperCase());
    holder.appendChild(btn);
  }
}

export function renderCursors(state: EditorState): void {
  const holder = document.getElementById('cursors')!;
  holder.innerHTML = '';
  for (const [userId, cursor] of state.cursors) {
    const c = el('div', { id: `cursor-${userId}`, 'aria-hidden': 'true', class: 'remote-cursor' }, cursor.name);
    c.style.left = `${cursor.x}px`;
    c.style.top = `${cursor.y}px`;
    holder.appendChild(c);
  }
}

export function renderPins(state: EditorState): void {
  const holder = document.getElementById('pins')!;
  holder.innerHTML = '';
  const canvas = document.getElementById('canvas');
  if (!canvas) return;
  for (const thread of state.threads) {
    if (thread.status !== 'open' || thread.pageId !== state.pageId) continue;
    const nodeEl = canvas.querySelector<HTMLElement>(`[data-node-id="${thread.nodeId}"]`);
    const pin = el('button', {
      id: `pin-${thread.id}`,
      'aria-label': `Comment by ${thread.author.name} on ${thread.nodeName}`,
      class: 'pin',
    }, '•');
    if (nodeEl) {
      const rect = nodeEl.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      pin.style.position = 'absolute';
      pin.style.left = `${rect.right - canvasRect.left + canvas.scrollLeft - 12}px`;
      pin.style.top = `${rect.top - canvasRect.top + canvas.scrollTop - 12}px`;
    }
    pin.addEventListener('click', () => {
      const ev = new CustomEvent('plinth:open-thread', { detail: { threadId: thread.id } });
      document.dispatchEvent(ev);
    });
    holder.appendChild(pin);
  }
}

export function showPreviewBanner(state: EditorState, versionName: string): void {
  const banner = document.getElementById('preview-banner')!;
  banner.innerHTML = '';
  banner.hidden = false;
  banner.appendChild(document.createTextNode(`Previewing ${versionName}. Restore it or go back to the latest.`));
  if (state.canEdit) {
    const restore = el('button', {}, 'Restore this version');
    restore.addEventListener('click', () => {
      const ev = new CustomEvent('plinth:restore-version');
      document.dispatchEvent(ev);
    });
    banner.appendChild(restore);
  }
  const back = el('button', {}, 'Back to latest');
  back.addEventListener('click', () => {
    location.href = `${location.pathname}?page=${state.pageId ?? ''}`;
  });
  banner.appendChild(back);
}

export function syncUrl(state: EditorState, panel: string | null): void {
  const params = new URLSearchParams();
  if (state.pageId) params.set('page', state.pageId);
  if (state.bp !== 'desktop') params.set('bp', state.bp);
  if (panel) params.set('panel', panel);
  if (state.versionId) params.set('version', state.versionId);
  const qs = params.toString();
  history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
}

export type LayoutMode = 'wide' | 'tablet' | 'phone';

export function layoutMode(): LayoutMode {
  const w = window.innerWidth;
  if (w >= 1280) return 'wide';
  if (w >= 768) return 'tablet';
  return 'phone';
}

export function applyLayoutMode(): void {
  const mode = layoutMode();
  const nav = document.getElementById('navigator')!;
  const stylePanel = document.getElementById('style-panel')!;
  const phoneToolbar = document.getElementById('phone-toolbar')!;
  const editTools = document.getElementById('edit-tools')!;
  const fanBtn = document.getElementById('btn-fan') as HTMLButtonElement | null;
  const navigatorBtn = document.getElementById('btn-navigator') as HTMLButtonElement | null;
  const bpGroup = document.getElementById('bp-group')!;

  if (mode === 'wide') {
    nav.removeAttribute('inert');
    nav.hidden = false;
    if (navigatorBtn) navigatorBtn.hidden = true;
    stylePanel.removeAttribute('inert');
    phoneToolbar.hidden = true;
    bpGroup.hidden = false;
  } else if (mode === 'tablet') {
    if (nav.getAttribute('data-open') !== 'true') {
      nav.hidden = true;
      nav.setAttribute('inert', '');
    } else {
      nav.removeAttribute('inert');
      nav.hidden = false;
    }
    if (navigatorBtn) {
      navigatorBtn.hidden = false;
      navigatorBtn.setAttribute('aria-expanded', nav.getAttribute('data-open') === 'true' ? 'true' : 'false');
    }
    stylePanel.removeAttribute('inert');
    phoneToolbar.hidden = true;
    bpGroup.hidden = false;
  } else {
    nav.hidden = true;
    nav.setAttribute('inert', '');
    stylePanel.hidden = true;
    stylePanel.setAttribute('inert', '');
    editTools.hidden = true;
    phoneToolbar.hidden = false;
    if (fanBtn) fanBtn.hidden = true;
    if (navigatorBtn) navigatorBtn.hidden = true;
    bpGroup.hidden = true;
  }
}

export function applyRoleMode(state: EditorState): void {
  const viewer = state.role === 'viewer' || state.readonly;
  const editTools = document.getElementById('edit-tools')!;
  const banner = document.getElementById('mode-banner')!;
  const stylePanel = document.getElementById('style-panel')!;
  if (viewer) {
    for (const btn of [...editTools.querySelectorAll<HTMLButtonElement>('button')]) {
      if (btn.id === 'btn-comments') continue;
      btn.hidden = true;
    }
    banner.textContent = `Comment mode. Ask the owner for edit access.`;
    banner.hidden = state.readonly;
    stylePanel.setAttribute('inert', '');
  } else {
    for (const btn of [...editTools.querySelectorAll<HTMLButtonElement>('button')]) btn.hidden = false;
    const share = document.getElementById('btn-share') as HTMLButtonElement | null;
    if (share) share.hidden = !state.isOwner;
    banner.hidden = true;
    stylePanel.removeAttribute('inert');
  }
}
