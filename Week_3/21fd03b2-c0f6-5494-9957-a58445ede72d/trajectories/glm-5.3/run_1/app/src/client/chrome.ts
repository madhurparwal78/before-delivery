import { api } from './api';
import { h, chip } from './ui';
import { navigate, type Route } from './router';
import { loadMe, signOut, type Me } from './auth';

// The shared toolbar and working-screen scaffolding.

export type ToolbarOpts = {
  runControls?: boolean;
  mode?: 'edit' | 'run';
  paused?: boolean;
  onRun?: () => void;
  onPause?: () => void;
  onStep?: () => void;
  tool?: 'move' | 'rotate' | 'scale';
  onTool?: (t: 'move' | 'rotate' | 'scale') => void;
  snap?: boolean;
  grid?: boolean;
  colliders?: boolean;
  onToggle?: (which: 'snap' | 'grid' | 'colliders') => void;
  workspaceLinks?: boolean;
  people?: string[];
  showPeople?: boolean;
  ownerOnly?: { share?: boolean; publish?: boolean; assets?: boolean; labs?: boolean };
  onAssets?: () => void;
  onShare?: () => void;
  onPublish?: () => void;
  onWindows?: () => void;
  onShortcuts?: () => void;
  onLabs?: () => void;
  viewOnly?: boolean;
};

export type ToolbarHandles = {
  root: HTMLElement;
  runBtn: HTMLButtonElement;
  pauseBtn: HTMLButtonElement;
  stepBtn: HTMLButtonElement;
};

export function toolbar(me: Me | null, opts: ToolbarOpts): ToolbarHandles {
  const root = h('div', { class: 'bench-toolbar', role: 'toolbar', 'aria-label': 'Bench tools' });
  const runBtn = chip(opts.mode === 'run' ? 'Stop' : 'Run', {
    pressed: opts.mode === 'run',
    extraClass: opts.mode === 'run' ? 'go' : '',
    onClick: opts.onRun,
  });
  const pauseBtn = chip(opts.paused ? 'Resume' : 'Pause', {
    disabled: opts.mode !== 'run',
    onClick: opts.onPause,
  });
  const stepBtn = chip('Step', { disabled: opts.mode !== 'run', onClick: opts.onStep });
  root.append(runBtn, pauseBtn, stepBtn);

  if (opts.onTool) {
    root.append(divider());
    root.append(chip('Move', { pressed: opts.tool === 'move', onClick: () => opts.onTool!('move') }));
    root.append(chip('Rotate', { pressed: opts.tool === 'rotate', onClick: () => opts.onTool!('rotate') }));
    root.append(chip('Scale', { pressed: opts.tool === 'scale', onClick: () => opts.onTool!('scale') }));
  }
  if (opts.onToggle) {
    root.append(divider());
    root.append(chip('Snap', { pressed: opts.snap, onClick: () => opts.onToggle!('snap') }));
    root.append(chip('Grid', { pressed: opts.grid, onClick: () => opts.onToggle!('grid') }));
    root.append(chip('Colliders', { pressed: opts.colliders, onClick: () => opts.onToggle!('colliders') }));
  }
  if (opts.workspaceLinks) {
    root.append(divider());
    const labsBtn = chip('Labs', { onClick: opts.onLabs, extraClass: 'publish-chip' });
    labsBtn.tagName; // text link handled as button with link semantics via click
    const assetsBtn = chip('Assets', { onClick: opts.onAssets, extraClass: 'publish-chip' });
    const shareBtn = chip('Share', { onClick: opts.onShare, extraClass: 'publish-chip', disabled: opts.ownerOnly?.share === false, title: opts.ownerOnly?.share === false ? 'Only the workspace owner can share or publish.' : undefined });
    const publishBtn = chip('Publish', { onClick: opts.onPublish, extraClass: 'publish-chip', disabled: opts.ownerOnly?.publish === false, title: opts.ownerOnly?.publish === false ? 'Only the workspace owner can share or publish.' : undefined });
    root.append(labsBtn, assetsBtn, shareBtn, publishBtn, chip('Windows', { onClick: opts.onWindows }));
    root.append(chip('Shortcuts', { onClick: opts.onShortcuts }));
  }
  if (opts.showPeople) {
    root.append(divider());
    const list = h('ul', { role: 'list', 'aria-label': 'People here', style: { display: 'flex', gap: '6px', listStyle: 'none', margin: '0', padding: '0' } });
    for (const person of opts.people ?? []) {
      const li = h('li', {}, person);
      li.style.whiteSpace = 'nowrap';
      list.append(li);
    }
    root.append(list);
  }
  if (me) {
    root.append(accountPill(me));
  }
  root.append(h('span', { class: 'wordmark', 'aria-hidden': 'true' }, 'Rampwright'));
  return { root, runBtn, pauseBtn, stepBtn };
}

function divider(): HTMLElement {
  return h('span', { class: 'tb-divider', 'aria-hidden': 'true' });
}

function accountPill(me: Me): HTMLElement {
  const wrap = h('div', { style: { position: 'relative', display: 'inline-block' } });
  const btn = h('button', { class: 'account-pill', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
  const initials = me.user.displayName.split(/\s+/).map((p) => p.charAt(0)).slice(0, 2).join('').toUpperCase() || 'U';
  btn.append(h('span', { class: 'avatar-disc', 'aria-hidden': 'true' }, initials));
  const nameSpan = h('span', { style: { fontWeight: '700' } }, me.user.displayName);
  const wsName = me.workspaces.find((w) => w.id === currentWorkspaceId()) ?? me.workspaces[0];
  if (wsName) btn.append(h('span', { style: { color: 'var(--muted)' } }, wsName.name));
  btn.append(nameSpan.parentElement ?? nameSpan);
  btn.append(h('span', { 'aria-hidden': 'true' }, ' ▾'));
  const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': 'Account', style: { display: 'none', right: '0', top: '100%' } });
  for (const ws of me.workspaces) {
    menu.append(h('button', { class: 'menu-item', role: 'menuitemradio', 'aria-checked': String(ws.id === currentWorkspaceId()), onclick: () => { hide(); navigate(`/w/${ws.id}`); } }, ws.name));
  }
  menu.append(h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { hide(); navigate('/workspaces/new'); } }, 'New workspace'));
  menu.append(h('button', { class: 'menu-item', role: 'menuitem', onclick: () => { hide(); void signOut(); } }, 'Sign out'));
  const hide = (): void => {
    menu.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.style.display !== 'none';
    menu.style.display = open ? 'none' : 'block';
    btn.setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('click', () => hide());
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      menu.style.display = 'block';
      const first = menu.querySelector<HTMLElement>('button');
      first?.focus();
    }
  });
  menu.addEventListener('keydown', (e) => {
    const items = Array.from(menu.querySelectorAll<HTMLElement>('button'));
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (items[idx + 1] ?? items[0]!)?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (items[idx - 1] ?? items[items.length - 1]!)?.focus();
    } else if (e.key === 'Escape') {
      hide();
      btn.focus();
    }
  });
  wrap.append(btn, menu);
  return wrap;
}

let workspaceId: string | null = null;
export function setWorkspaceContext(wid: string | null): void {
  workspaceId = wid;
}
function currentWorkspaceId(): string | null {
  return workspaceId;
}

export async function withWorkspaceNav(route: Route, mePromise: Promise<Me | null> | null): Promise<Me | null> {
  const me = await (mePromise ?? loadMe());
  if (me === null) {
    const path = routePath(route);
    navigate(`/sign-in?return=${encodeURIComponent(path)}`);
    return null;
  }
  return me;
}

function routePath(route: Route): string {
  switch (route.name) {
    case 'workspace': return `/w/${route.wid}`;
    case 'project': return `/w/${route.wid}/p/${route.pid}`;
    case 'editor': return `/w/${route.wid}/s/${route.sid}`;
    case 'settings': return `/w/${route.wid}/settings`;
    case 'activity': return `/w/${route.wid}/activity`;
    default: return '/';
  }
}

export async function apiGet<T>(path: string): Promise<{ data: T | null; error?: { status: number; code: string } }> {
  const result = await api('GET', path);
  if (!result.ok) {
    return { data: null, error: { status: result.error.status, code: result.error.code } };
  }
  return { data: result.body as T };
}
