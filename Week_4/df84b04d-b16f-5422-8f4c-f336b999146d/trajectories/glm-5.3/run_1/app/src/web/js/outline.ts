import { api, el, icon, announce, problem, trimmedName, countBullets, formatDate, PLACEHOLDER_COPY } from './api.js';
import type { BulletView, MePayload, OutlinePayload, SharePayload } from './api.js';
import { renderNotFound } from './auth.js';

function signOutNav(): HTMLElement {
  const button = el('button', { class: 'pill' }, 'Sign out');
  button.addEventListener('click', () => {
    void api('/api/session', { method: 'DELETE' }).then(() => {
      window.location.href = '/';
    });
  });
  return el('nav', {}, button);
}

interface TreeNode {
  bullet: BulletView;
  children: TreeNode[];
}

interface BoardColumn {
  bullet: BulletView;
  cards: BulletView[];
}

export class OutlineApp {
  root: HTMLElement;
  me: MePayload['user'] | null = null;
  shared: MePayload['shared'] = [];
  rootId: string | null = null;
  zoomRootId: string | null = null;
  rootBullet: BulletView | null = null;
  ancestors: BulletView[] = [];
  nodes: TreeNode[] = [];
  byId = new Map<string, BulletView>();
  focusedId: string | null = null;
  seq = 0;
  hideCompleted = false;
  view: 'list' | 'board' = 'list';
  searchText = '';
  searchMatches: Set<string> | null = null;
  searchContext: Set<string> | null = null;
  undoDepthAnnounced = false;
  socket: WebSocket | null = null;
  paused = false;
  lastSeenSeq = 0;
  saveTimers = new Map<string, number>();
  pendingSaves = new Map<string, { text: string; revision: number }>();
  typingBulletId: string | null = null;
  suggestionsEl: HTMLElement | null = null;
  suggestionKind: 'tag' | 'mention' | null = null;
  suggestionPrefix = '';
  suggestionItems: string[] = [];
  suggestionIndex = 0;
  isCollaborator = false;
  collaboratorHome: string | null = null;
  plannedFocusAfterRender: string | null = null;
  caretAtStart = false;
  touchMode = false;
  zoomMotionRow: string | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.touchMode = window.matchMedia('(pointer: coarse)').matches;
  }

  homeHref(): string {
    if (this.isCollaborator && this.collaboratorHome) return `/b/${this.collaboratorHome}`;
    return '/';
  }

  async init(): Promise<void> {
    const meResult = await api<MePayload>('/api/me');
    if (meResult.status !== 200 || !meResult.body.user) {
      window.location.href = `/signin?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    this.me = meResult.body.user;
    this.shared = meResult.body.shared ?? [];
    this.hideCompleted = this.me.hideCompleted;
    const path = window.location.pathname;
    if (path.startsWith('/b/')) {
      this.zoomRootId = path.slice(3);
      const accepted = this.shared.find((s) => s.bulletId === this.zoomRootId);
      if (accepted) {
        this.isCollaborator = true;
        this.collaboratorHome = accepted.bulletId;
      }
    } else if (path === '/') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('share') && this.shared.some((s) => s.bulletId === params.get('share'))) {
        this.isCollaborator = true;
        this.collaboratorHome = params.get('share');
        this.zoomRootId = this.collaboratorHome;
      }
    }
    if (params_view() === 'board') this.view = 'board';
    await this.loadView(false);
    this.connectLive();
    this.attachGlobalKeys();
  }

  async loadView(keepFocus: boolean, focusId: string | null = null): Promise<void> {
    const rootParam = this.zoomRootId ?? '';
    const url = `/api/outline${rootParam ? `?root=${encodeURIComponent(rootParam)}` : ''}`;
    const result = await api<OutlinePayload>(url);
    if (result.status === 404) {
      if (this.zoomRootId && this.shared.some((s) => s.bulletId === this.zoomRootId)) {
        renderNotFound(this.root);
        return;
      }
      renderNotFound(this.root);
      return;
    }
    const payload = result.body;
    this.rootBullet = payload.root;
    this.ancestors = payload.ancestors ?? [];
    this.seq = payload.seq;
    this.lastSeenSeq = payload.seq;
    this.byId = new Map();
    for (const bullet of payload.bullets) this.byId.set(bullet.id, bullet);
    for (const a of this.ancestors) this.byId.set(a.id, a);
    if (this.rootBullet) this.byId.set(this.rootBullet.id, this.rootBullet);
    if (this.rootBullet) {
      this.rootId = this.rootBullet.id;
      if (!this.isCollaborator) {
        this.rootId = this.rootBullet.id;
      }
    } else {
      this.rootId = null;
    }
    this.nodes = this.buildTree(payload.bullets);
    if (!keepFocus) this.focusedId = this.firstVisible();
    if (focusId) this.focusedId = focusId;
    this.render();
  }

  firstVisible(): string | null {
    const visit = (nodes: TreeNode[]): string | null => {
      for (const node of nodes) {
        if (this.visibleNode(node)) {
          const inside = visit(node.children);
          if (inside) return inside;
          return node.bullet.id;
        }
      }
      return null;
    };
    return visit(this.nodes);
  }

  visibleNode(node: TreeNode): boolean {
    if (this.searchMatches) {
      return this.searchMatches.has(node.bullet.id) || this.searchContext?.has(node.bullet.id) === true;
    }
    if (this.hideCompleted && node.bullet.completed) return false;
    return true;
  }

  buildTree(bullets: BulletView[]): TreeNode[] {
    const nodeMap = new Map<string, TreeNode>();
    for (const bullet of bullets) {
      nodeMap.set(bullet.id, { bullet, children: [] });
    }
    const roots: TreeNode[] = [];
    for (const bullet of bullets) {
      const node = nodeMap.get(bullet.id) as TreeNode;
      if (bullet.parentId && nodeMap.has(bullet.parentId)) {
        nodeMap.get(bullet.parentId)?.children.push(node);
      } else {
        roots.push(node);
      }
    }
    const sortRec = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => a.bullet.position - b.bullet.position);
      nodes.forEach((n) => sortRec(n.children));
    };
    sortRec(roots);
    return roots;
  }

  // ---------- Live sync ----------

  connectLive(): void {
    const rootParam = this.zoomRootId ?? 'home';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${window.location.host}/api/live?root=${encodeURIComponent(rootParam)}&since=${this.lastSeenSeq}`);
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as Record<string, unknown>;
      this.handleLiveMessage(message);
    });
    socket.addEventListener('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        window.setTimeout(() => this.connectLive(), 1200);
        window.setTimeout(() => this.markPausedIfNeeded(), (this.pauseAfterSeconds || 3) * 1000);
      }
    });
  }

  attachGlobalKeys(): void {
    window.addEventListener('keydown', (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.defaultPrevented) return;
      const inDialog = document.querySelector('dialog[open]') !== null;
      if (inDialog) return;
      const target = keyEvent.target as HTMLElement;
      const inShareEmail = target?.closest?.('dialog') !== null;
      if (inShareEmail) return;
      const inTextInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (keyEvent.key === 'ArrowLeft' && keyEvent.altKey) {
        keyEvent.preventDefault();
        void this.zoomOut();
        return;
      }
      if (keyEvent.key === 'ArrowRight' && keyEvent.altKey && !inTextInput) {
        keyEvent.preventDefault();
        if (this.focusedId) void this.zoomIn(this.focusedId);
        return;
      }
      this.handleGlobalKeys(keyEvent);
    });
  }

  pauseAfterSeconds = 3;
  heartbeatSeconds = 15;
  lastHeartbeatAt = Date.now();

  markPausedIfNeeded(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    this.setPaused(true);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.renderLiveRegion();
    if (!paused) announce('Live sync is back.');
  }

  renderLiveRegion(): void {
    const region = document.querySelector('[data-live-region]');
    if (!region) return;
    region.innerHTML = '';
    if (!this.paused) return;
    const banner = el('div', { class: 'banner' },
      el('span', null, 'Live sync paused. Your edits are saved and other tabs will catch up when it returns.'),
      el('button', { class: 'pill-outline', 'data-action': 'reload-branch' }, 'Reload branch'),
    );
    region.appendChild(banner);
  }

  handleLiveMessage(message: Record<string, unknown>): void {
    const type = message.type as string;
    if (type === 'heartbeat') {
      this.lastHeartbeatAt = Date.now();
      if (typeof message.pauseAfter === 'number') this.pauseAfterSeconds = message.pauseAfter;
      if (typeof message.heartbeat === 'number') this.heartbeatSeconds = message.heartbeat;
      this.setPaused(message.fanout === 'paused');
      return;
    }
    if (type === 'change') {
      const seq = Number(message.seq ?? 0);
      const bullets = (message.bullets ?? []) as BulletView[];
      const removed = (message.removed ?? []) as string[];
      this.applyChange(bullets, removed);
      this.lastSeenSeq = Math.max(this.lastSeenSeq, seq);
      return;
    }
    if (type === 'reload') {
      announce('This branch was reloaded to catch up with recent changes.');
      void this.loadView(true, this.focusedId);
      return;
    }
    if (type === 'revoked') {
      this.renderRevoked();
      return;
    }
  }

  renderRevoked(): void {
    this.root.innerHTML = '';
    document.title = 'Access ended — Twigline';
    this.root.appendChild(el('header', { class: 'topbar' },
      el('a', { class: 'brand', href: '/' }, 'Twigline'),
      signOutNav(),
    ));
    const windowEl = el('div', { class: 'window' },
      el('div', { class: 'window-body' },
        el('div', { 'data-live-region': 'true' },
          el('div', { class: 'not-found' },
            el('h2', null, 'This branch is no longer shared with you.'),
            el('a', { class: 'pill', href: '/' }, 'Back to Home'),
          ),
        ),
      ),
    );
    this.root.appendChild(el('main', { class: 'outline-shell' }, windowEl));
  }

  applyChange(bullets: BulletView[], removed: string[]): void {
    for (const bullet of bullets) {
      this.byId.set(bullet.id, bullet);
    }
    for (const id of removed) {
      this.byId.delete(id);
    }
    if (removed.includes(this.zoomRootId ?? '')) {
      this.renderRevoked();
      return;
    }
    this.rebuildTreeFromById();
    for (const bullet of bullets) {
      const originalId = bullet.mirrorOf ?? bullet.id;
      for (const [id, view] of [...this.byId]) {
        if ((view.mirrorOf ?? view.id) === originalId && view.id !== bullet.id) {
          this.byId.set(id, { ...view, text: bullet.text, tags: bullet.tags, mentions: bullet.mentions, date: bullet.date, completed: bullet.completed, revision: bullet.revision });
        }
      }
    }
    for (const bullet of bullets) {
      const textbox = document.querySelector(`[data-text-id="${bullet.id}"]`) as HTMLInputElement | null;
      if (!textbox) continue;
      if (this.focusedId === bullet.id && this.pendingSaves.has(bullet.id)) continue;
      const isTyping = this.typingBulletId === bullet.id && document.activeElement === textbox;
      if (isTyping) continue;
      if (textbox.value !== bullet.text) textbox.value = bullet.text;
    }
    this.render();
  }

  rebuildTreeFromById(): void {
    const all = [...this.byId.values()].filter((b) => b.id !== this.rootBullet?.id);
    this.nodes = this.buildTree(all.filter((b) => {
      if (!b.parentId) return true;
      return this.byId.has(b.parentId);
    }));
  }

  // ---------- Rendering ----------

  render(): void {
    const path = window.location.pathname;
    const expectedPath = this.zoomRootId ? `/b/${this.zoomRootId}` : '/';
    if (path !== expectedPath) {
      window.history.pushState({}, '', expectedPath + (this.view === 'board' ? '?view=board' : ''));
    } else {
      const params = new URLSearchParams(window.location.search);
      if (this.view === 'board' && params.get('view') !== 'board') {
        window.history.replaceState({}, '', expectedPath + '?view=board');
      } else if (this.view !== 'board' && params.get('view') === 'board') {
        window.history.replaceState({}, '', expectedPath);
      }
    }
    const title = this.rootBullet ? (this.rootBullet.text || 'Untitled') : 'Home';
    document.title = `${title} — Twigline`;
    this.root.innerHTML = '';
    this.root.appendChild(this.renderTopBar());
    const shell = el('main', { class: 'outline-shell' });
    const windowEl = el('div', { class: 'window outline-window' });
    windowEl.appendChild(this.renderToolbar());
    const body = el('div', { class: 'outline-body' });
    body.appendChild(el('div', { 'data-live-region': 'true' }));
    if (this.paused) this.renderLiveRegion();
    const heading = el('h1', { class: 'outline-title' });
    if (this.rootBullet) {
      const titleInput = el('input', {
        type: 'text',
        value: this.rootBullet.text,
        'aria-label': 'Branch title',
        'data-title-input': this.rootBullet.id,
      });
      titleInput.addEventListener('input', () => {
        this.queueTextSave(this.rootBullet as BulletView, titleInput.value);
        document.title = `${titleInput.value || 'Untitled'} — Twigline`;
      });
      titleInput.addEventListener('keydown', (event) => {
        const keyEvent = event as KeyboardEvent;
        if (keyEvent.key === 'ArrowDown') {
          const first = this.firstVisible();
          if (first) {
            this.focusBullet(first, 'end');
            keyEvent.preventDefault();
          }
        }
        if (keyEvent.key === 'Enter') {
          keyEvent.preventDefault();
          const first = this.firstVisible();
          if (first) this.focusBullet(first, 'end');
        }
        if (keyEvent.key === 'ArrowLeft' && keyEvent.altKey) {
          keyEvent.preventDefault();
          void this.zoomOut();
          return;
        }
        if (keyEvent.key === 'ArrowRight' && keyEvent.altKey) {
          keyEvent.preventDefault();
          return;
        }
        this.handleGlobalKeys(keyEvent);
      });
      heading.appendChild(titleInput);
    } else {
      heading.textContent = 'Home';
    }
    body.appendChild(heading);
    if (this.view === 'board' && !this.searchText) {
      body.appendChild(this.renderBoard());
    } else {
      body.appendChild(this.renderTree());
    }
    windowEl.appendChild(body);
    windowEl.appendChild(this.renderActionsToolbar());
    shell.appendChild(windowEl);
    this.root.appendChild(shell);
    if (this.plannedFocusAfterRender) {
      const id = this.plannedFocusAfterRender;
      this.plannedFocusAfterRender = null;
      this.focusBullet(id, this.caretAtStart ? 'start' : 'end');
    }
  }

  renderTopBar(): HTMLElement {
    const nav = el('nav', null,
      el('a', { href: this.homeHref() }, 'Home'),
      el('button', { 'data-action': 'sign-out', class: 'ghost-button' }, 'Sign out'),
    );
    const bar = el('header', { class: 'topbar' },
      el('a', { class: 'brand', href: this.homeHref() }, 'Twigline'),
      nav,
    );
    if (this.shared.length > 0) {
      const menuButton = el('button', { 'aria-haspopup': 'true', 'data-action': 'shared-menu' }, 'Shared with you');
      nav.prepend(menuButton);
    }
    return bar;
  }

  renderToolbar(): HTMLElement {
    const toolbar = this.renderToolbarContent();
    toolbar.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest('[data-action]') as HTMLElement | null;
      if (!button) return;
      const action = button.getAttribute('data-action');
      switch (action) {
        case 'go-back':
          window.history.back();
          break;
        case 'go-forward':
          window.history.forward();
          break;
        case 'go-home':
          window.location.href = this.homeHref();
          break;
        case 'hide-completed':
          void this.toggleHideCompleted();
          break;
        case 'show-board':
          this.view = 'board';
          this.render();
          break;
        case 'show-list':
          this.view = 'list';
          this.render();
          break;
        case 'undo':
          void this.undo();
          break;
        case 'redo':
          void this.redo();
          break;
        case 'share':
          if (this.rootBullet) this.openShareDialog(this.rootBullet.id);
          break;
        case 'download-menu':
          this.openDownloadMenu();
          break;
      }
    });
    return toolbar;
  }

  renderToolbarContent(): HTMLElement {
    const crumbs = el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });
    if (this.isCollaborator && this.collaboratorHome) {
      const shared = this.byId.get(this.collaboratorHome);
      crumbs.appendChild(el('a', { href: `/b/${this.collaboratorHome}` }, trimmedName(shared?.text ?? '')));
      for (const ancestor of this.ancestors.slice(this.ancestors.findIndex((a) => a.id === this.collaboratorHome) + 1)) {
        crumbs.appendChild(el('a', { href: `/b/${ancestor.id}` }, trimmedName(ancestor.text)));
      }
      if (this.rootBullet) {
        crumbs.appendChild(el('span', { class: 'current', 'aria-current': 'page' }, trimmedName(this.rootBullet.text)));
      }
    } else if (this.rootBullet) {
      crumbs.appendChild(el('a', { href: '/' }, 'Home'));
      for (const ancestor of this.ancestors) {
        crumbs.appendChild(el('a', { href: `/b/${ancestor.id}` }, trimmedName(ancestor.text)));
      }
      crumbs.appendChild(el('span', { class: 'current', 'aria-current': 'page' }, trimmedName(this.rootBullet.text)));
    } else {
      crumbs.appendChild(el('a', { href: '/', 'aria-current': 'page' }, 'Home'));
    }

    const backButton = el('button', { 'aria-label': 'Go back', 'data-action': 'go-back' }, icon('left'));
    const forwardButton = el('button', { 'aria-label': 'Go forward', 'data-action': 'go-forward' }, icon('right'));
    const homeButton = el('button', { 'aria-label': 'Go home', 'data-action': 'go-home' }, icon('home'));

    const searchInput = el('input', {
      type: 'search',
      placeholder: 'Search outline',
      'aria-label': 'Search outline',
      value: this.searchText,
      'data-search': 'true',
    });
    searchInput.addEventListener('input', () => {
      this.searchText = searchInput.value;
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        void this.runSearch();
      }, 250);
    });
    searchInput.addEventListener('keydown', (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === 'Escape') {
        searchInput.value = '';
        this.searchText = '';
        this.searchMatches = null;
        this.searchContext = null;
        this.updateMatchCount(null);
        this.render();
      }
    });

    const count = el('span', { class: 'match-count', 'data-match-count': 'true' }, this.pendingMatchCount ?? '');

    const hideSwitch = el('button', {
      role: 'switch',
      'aria-checked': String(this.hideCompleted),
      class: 'switch',
      'aria-label': 'Hide completed',
      'data-action': 'hide-completed',
    },
      el('span', { class: 'track' }, el('span', { class: 'knob' })),
      el('span', { class: 'switch-label' }, 'Hide completed'),
    );

    const viewButton = el('button', { 'data-action': this.view === 'list' ? 'show-board' : 'show-list' },
      this.view === 'list' ? 'Show as board' : 'Show as list');

    const downloadButton = el('button', { 'data-action': 'download-menu', 'aria-haspopup': 'menu' }, icon('download'), el('span', { class: 'btn-label' }, 'Download'));
    const undoButton = el('button', { 'aria-label': 'Undo', 'data-action': 'undo' }, icon('undo'), el('span', { class: 'btn-label' }, 'Undo'));
    const redoButton = el('button', { 'aria-label': 'Redo', 'data-action': 'redo' }, icon('redo'), el('span', { class: 'btn-label' }, 'Redo'));

    const toolbar = el('div', { class: 'outline-toolbar' },
      backButton, forwardButton, homeButton,
      crumbs,
      el('span', { class: 'spacer' }),
      el('div', { class: 'search-wrap' }, searchInput, count),
      hideSwitch,
      viewButton,
      undoButton,
      redoButton,
    );
    if (!this.isCollaborator && this.rootBullet && this.me) {
      const shareButton = el('button', { 'data-action': 'share' }, icon('share'), el('span', { class: 'btn-label' }, 'Share'));
      toolbar.appendChild(shareButton);
    }
    toolbar.appendChild(downloadButton);
    return toolbar;
  }

  searchTimer = 0;

  async runSearch(): Promise<void> {
    if (!this.searchText) {
      this.searchMatches = null;
      this.searchContext = null;
      this.updateMatchCount(null);
      this.render();
      return;
    }
    const rootParam = this.zoomRootId ?? '';
    const result = await api<{ count: number; matches: string[]; context: string[] }>(
      `/api/search?q=${encodeURIComponent(this.searchText)}${rootParam ? `&root=${encodeURIComponent(rootParam)}` : ''}`,
    );
    if (result.status === 422 && result.body.errors?.q) {
      const errorEl = document.querySelector('[data-search-error]');
      if (errorEl) errorEl.textContent = result.body.errors.q;
      return;
    }
    this.searchMatches = new Set(result.body.matches ?? []);
    this.searchContext = new Set(result.body.context ?? []);
    const n = result.body.count ?? 0;
    const copy = n === 0 ? 'No matching bullets' : n === 1 ? '1 matching bullet' : `${n} matching bullets`;
    this.pendingMatchCount = copy;
    announce(copy);
    this.render();
  }

  pendingMatchCount: string | null = null;

  updateMatchCount(n: number | null): void {
    const elCount = document.querySelector('[data-match-count]');
    const copy = n === null ? '' : n === 0 ? 'No matching bullets' : n === 1 ? '1 matching bullet' : `${n} matching bullets`;
    if (elCount) {
      elCount.textContent = copy;
    }
  }

  renderTree(): HTMLElement {
    const tree = el('ul', {
      role: 'tree',
      'aria-label': 'Outline',
      'data-zoom-root': this.zoomRootId ?? (this.isCollaborator && this.collaboratorHome ? this.collaboratorHome : 'home'),
    });
    if (this.loading) {
      tree.setAttribute('aria-busy', 'true');
      const loading = el('div', { class: 'loading-rows' },
        el('div', { class: 'loading-row' }),
        el('div', { class: 'loading-row' }),
        el('div', { class: 'loading-row' }),
      );
      const wrap = el('div');
      wrap.appendChild(loading);
      return wrap;
    }
    if (this.nodes.length === 0) {
      const empty = el('div', { class: 'empty-state' });
      if (this.rootBullet) {
        empty.appendChild(el('p', null, 'Nothing inside this bullet yet.'));
        const add = el('button', { class: 'pill' }, 'Add bullet');
        add.addEventListener('click', () => void this.addFirstBullet());
        empty.appendChild(add);
      } else {
        empty.appendChild(el('p', null, 'Your outline is empty. Start with one thought.'));
        const add = el('button', { class: 'pill' }, 'Add first bullet');
        add.addEventListener('click', () => void this.addFirstBullet());
        empty.appendChild(add);
      }
      tree.appendChild(el('li', null, empty));
      return tree;
    }
    const searchError = el('div', { class: 'error', 'data-search-error': 'true' });
    const wrap = el('div');
    wrap.appendChild(searchError);
    wrap.appendChild(tree);
    const appendNodes = (parent: HTMLElement, nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (!this.visibleNode(node)) continue;
        parent.appendChild(this.renderRow(node));
      }
    };
    appendNodes(tree, this.nodes);
    if (this.hideCompleted && !this.searchText) {
      let hiddenCount = 0;
      const countHidden = (nodes: TreeNode[]) => {
        for (const node of nodes) {
          if (node.bullet.completed) hiddenCount += 1;
          countHidden(node.children);
        }
      };
      countHidden(this.nodes);
      const line = el('div', { class: 'alt', style: 'color:var(--quiet);font-size:0.8125rem;margin-top:8px' },
        hiddenCount === 0 ? 'No completed bullets hidden' : hiddenCount === 1 ? '1 completed bullet hidden' : `${hiddenCount} completed bullets hidden`);
      wrap.appendChild(line);
    }
    return wrap;
  }

  loading = false;

  renderRow(node: TreeNode): HTMLLIElement {
    const bullet = node.bullet;
    const hasChildren = node.children.length > 0 && this.anyVisibleChild(node);
    const li = el('li', {
      role: 'treeitem',
      'aria-level': String(this.ariaLevel(bullet)),
      'data-bullet-id': bullet.id,
      'data-depth': String(bullet.depth),
      'data-collapsed': String(bullet.collapsed),
      'data-completed': String(bullet.completed),
      'aria-selected': String(this.focusedId === bullet.id),
    });
    if (bullet.mirrorOf) li.setAttribute('data-mirror-of', bullet.mirrorOf);
    if (bullet.childCount > 0) {
      li.setAttribute('aria-expanded', String(!bullet.collapsed));
    }
    if (this.searchMatches) {
      if (this.searchMatches.has(bullet.id)) li.setAttribute('data-search', 'match');
      else if (this.searchContext?.has(bullet.id)) li.setAttribute('data-search', 'context');
    }
    const displayText = bullet.placeholder ? PLACEHOLDER_COPY : bullet.text;
    li.setAttribute('aria-label', bullet.placeholder ? PLACEHOLDER_COPY : (bullet.text || 'Untitled'));

    const row = el('div', { class: `row${hasChildren ? ' parent-row' : ''}`, 'data-row-id': bullet.id });
    for (let i = 0; i < this.viewDepth(bullet); i += 1) {
      row.appendChild(el('span', { class: 'indent', style: 'width:24px;flex:none' }));
    }
    const dot = el('a', { class: 'dot-link', href: `/b/${bullet.id}`, 'aria-label': `Zoom into ${trimmedName(displayText)}` });
    row.appendChild(dot);
    if (bullet.childCount > 0) {
      const disclosure = el('button', {
        class: 'disclosure',
        'aria-expanded': String(!bullet.collapsed),
        'aria-label': `Toggle children of ${trimmedName(displayText)}`,
      }, icon('chevron'));
      disclosure.addEventListener('click', () => {
        void this.toggleCollapse(bullet);
      });
      row.appendChild(disclosure);
    } else {
      row.appendChild(el('span', { class: 'disclosure', style: 'visibility:hidden' }));
    }
    const textbox = el('input', {
      type: 'text',
      class: 'bullet-text',
      value: displayText,
      'aria-label': 'Bullet text',
      'data-text-id': bullet.id,
    });
    if (bullet.placeholder) {
      textbox.setAttribute('readonly', '');
      textbox.classList.add('placeholder-text');
    }
    textbox.addEventListener('input', () => {
      this.typingBulletId = bullet.id;
      this.pendingSaves.set(bullet.id, { text: textbox.value, revision: bullet.revision });
      this.queueTextSave(bullet, textbox.value);
    });
    textbox.addEventListener('keydown', (event) => {
      this.handleBulletKey(event as KeyboardEvent, node, textbox);
    });
    textbox.addEventListener('focus', () => {
      this.focusedId = bullet.id;
      this.updateSelection();
    });
    textbox.addEventListener('blur', () => {
      if (this.typingBulletId === bullet.id) {
        this.typingBulletId = null;
      }
      void this.flushSave(bullet);
    });
    row.appendChild(textbox);
    if (!bullet.placeholder && (bullet.date || bullet.tags.length > 0 || bullet.mentions.length > 0)) {
      const chips = el('span', { class: 'chips' });
      for (const tag of bullet.tags) chips.appendChild(el('span', { class: 'chip' }, `#${tag}`));
      for (const mention of bullet.mentions) chips.appendChild(el('span', { class: 'chip' }, `@${mention}`));
      if (bullet.date) chips.appendChild(el('span', { class: 'chip' }, formatDate(bullet.date)));
      row.appendChild(chips);
    }
    row.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('.dot-link') || target.closest('.disclosure')) return;
      this.focusedId = bullet.id;
      this.updateSelection();
    });
    this.attachSwipe(row, bullet);
    li.appendChild(row);

    if (hasChildren && !bullet.collapsed) {
      const group = el('ul', { role: 'group', class: 'group' });
      for (const child of node.children) {
        if (!this.visibleNode(child)) continue;
        group.appendChild(this.renderRow(child));
      }
      li.appendChild(group);
    }
    return li;
  }

  anyVisibleChild(node: TreeNode): boolean {
    if (!this.searchMatches && !this.hideCompleted) return node.children.length > 0;
    return node.children.some((child) => this.visibleNode(child));
  }

  viewDepth(bullet: BulletView): number {
    return bullet.depth - (this.rootBullet ? 1 : 0);
  }

  ariaLevel(bullet: BulletView): number {
    return Math.max(1, bullet.depth - (this.rootBullet ? 1 : 0) + 1);
  }

  attachSwipe(row: HTMLElement, bullet: BulletView): void {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    row.addEventListener('touchstart', (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    }, { passive: true });
    row.addEventListener('touchend', (event) => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy)) {
        this.focusedId = bullet.id;
        if (dx > 0) void this.doMove(bullet.id, 'indent');
        else void this.doMove(bullet.id, 'outdent');
      }
    }, { passive: true });
  }

  renderActionsToolbar(): HTMLElement {
    const buttons: [string, string, () => void][] = [
      ['Indent', 'indent', () => this.focusedId && void this.doMove(this.focusedId, 'indent')],
      ['Outdent', 'outdent', () => this.focusedId && void this.doMove(this.focusedId, 'outdent')],
      ['Move up', 'up', () => this.focusedId && void this.doMove(this.focusedId, 'up')],
      ['Move down', 'down', () => this.focusedId && void this.doMove(this.focusedId, 'down')],
      ['Collapse', 'collapse', () => this.focusedId && void this.toggleCollapse(this.byId.get(this.focusedId) as BulletView)],
      ['Complete', 'complete', () => this.focusedId && void this.toggleComplete(this.byId.get(this.focusedId) as BulletView)],
      ['Zoom in', 'zoom-in', () => this.focusedId && void this.zoomIn(this.focusedId)],
      ['Zoom out', 'zoom-out', () => void this.zoomOut()],
      ['Mirror', 'mirror', () => this.focusedId && void this.mirror(this.focusedId)],
      ['Delete bullet', 'delete', () => this.focusedId && void this.confirmDelete(this.focusedId)],
    ];
    const focused = this.focusedId ? this.byId.get(this.focusedId) : null;
    const pressState = (name: string): string | null => {
      if (!focused) return null;
      if (name === 'Collapse') return String(focused.collapsed);
      if (name === 'Complete') return String(focused.completed);
      return null;
    };
    const toolbar = el('div', { class: 'bullet-actions', role: 'toolbar', 'aria-label': 'Bullet actions' });
    for (const [label, action, handler] of buttons) {
      const button = el('button', { 'aria-label': label, 'data-action': action }, label);
      const pressed = pressState(label);
      if (pressed !== null) button.setAttribute('aria-pressed', pressed);
      button.addEventListener('click', () => {
        handler();
      });
      toolbar.appendChild(button);
    }
    return toolbar;
  }

  // ---------- Keyboard ----------

  handleBulletKey(event: KeyboardEvent, node: TreeNode, textbox: HTMLInputElement): void {
    const bullet = node.bullet;
    const caret = textbox.selectionStart ?? textbox.value.length;
    if (this.suggestionsEl && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      this.moveSuggestion(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (this.suggestionsEl && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      this.insertSuggestion(textbox);
      return;
    }
    if (this.suggestionsEl && event.key === 'Escape') {
      event.preventDefault();
      this.closeSuggestions();
      return;
    }
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      void this.enterSplit(bullet, textbox, caret);
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      void this.doMove(bullet.id, 'indent');
      return;
    }
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault();
      void this.doMove(bullet.id, 'outdent');
      return;
    }
    if (event.key === 'ArrowUp' && event.ctrlKey) {
      event.preventDefault();
      void this.doMove(bullet.id, 'up');
      return;
    }
    if (event.key === 'ArrowDown' && event.ctrlKey) {
      event.preventDefault();
      void this.doMove(bullet.id, 'down');
      return;
    }
    if (event.key === 'ArrowUp' && !event.altKey) {
      event.preventDefault();
      this.moveFocus(bullet.id, -1);
      return;
    }
    if (event.key === 'ArrowDown' && !event.altKey) {
      event.preventDefault();
      this.moveFocus(bullet.id, 1);
      return;
    }
    if (event.key === ' ' && event.ctrlKey) {
      event.preventDefault();
      void this.toggleCollapse(bullet);
      return;
    }
    if (event.key === 'ArrowRight' && event.altKey) {
      event.preventDefault();
      void this.zoomIn(bullet.id);
      return;
    }
    if (event.key === 'ArrowLeft' && event.altKey) {
      event.preventDefault();
      void this.zoomOut();
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.toggleComplete(bullet);
      return;
    }
    if (event.key === 'Backspace' && textbox.value === '' && caret === 0) {
      const hasChildren = bullet.childCount > 0;
      if (hasChildren) {
        event.preventDefault();
        problem('Can’t delete with Backspace: this bullet has bullets inside. Press Ctrl+Shift+Backspace to delete it.');
        return;
      }
      event.preventDefault();
      void this.backspaceDelete(bullet);
      return;
    }
    if (event.key === 'Backspace' && event.ctrlKey && event.shiftKey) {
      event.preventDefault();
      void this.confirmDelete(bullet.id);
      return;
    }
    if (event.key === 'Backspace' && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      event.preventDefault();
      void this.confirmDelete(bullet.id);
      return;
    }
    if (event.key.toLowerCase() === 'm' && event.ctrlKey && event.shiftKey) {
      event.preventDefault();
      void this.mirror(bullet.id);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      (textbox.closest('[role="treeitem"]') as HTMLElement)?.focus();
      return;
    }
    this.handleGlobalKeys(event);
    this.maybeOpenSuggestions(event, textbox);
  }

  handleGlobalKeys(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key === 'z' && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
      event.preventDefault();
      void this.undo();
      return;
    }
    if (key === 'z' && (event.ctrlKey || event.metaKey) && event.shiftKey) {
      event.preventDefault();
      void this.redo();
      return;
    }
  }

  maybeOpenSuggestions(event: KeyboardEvent, textbox: HTMLInputElement): void {
    const value = textbox.value;
    const caret = textbox.selectionStart ?? value.length;
    if (event.key === '#' || event.key === '@') {
      const afterSpace = caret === 0 || /\s$/.test(value.slice(0, caret));
      if (afterSpace) {
        window.setTimeout(() => this.openSuggestions(event.key === '#' ? 'tag' : 'mention', textbox), 10);
      }
      return;
    }
    if (this.suggestionKind) {
      const kind = this.suggestionKind;
      if (event.key.length === 1) {
        window.setTimeout(() => this.openSuggestions(kind, textbox), 10);
      }
    }
  }

  async openSuggestions(kind: 'tag' | 'mention', textbox: HTMLInputElement): Promise<void> {
    const value = textbox.value;
    const caret = textbox.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const symbol = kind === 'tag' ? '#' : '@';
    const match = before.match(new RegExp(`${symbol}([A-Za-z0-9_-]*)$`));
    if (!match) {
      this.closeSuggestions();
      return;
    }
    const currentPrefix = match[1] ?? '';
    this.suggestionKind = kind;
    this.suggestionPrefix = currentPrefix;
    const rootParam = this.zoomRootId ?? '';
    const result = await api<{ suggestions: { value: string; count: number }[] }>(
      `/api/suggest?kind=${kind}&prefix=${encodeURIComponent(currentPrefix)}${rootParam ? `&root=${encodeURIComponent(rootParam)}` : ''}`,
    );
    if (result.status !== 200) return;
    this.suggestionItems = result.body.suggestions.map((s) => s.value);
    if (this.suggestionItems.length === 0) {
      this.closeSuggestions();
      return;
    }
    this.suggestionIndex = 0;
    this.closeSuggestions();
    const list = el('ul', { class: 'suggestions', role: 'listbox', 'aria-label': 'Suggestions' });
    this.suggestionItems.forEach((item, index) => {
      const li = el('li', { role: 'option', 'aria-selected': String(index === 0) }, item);
      li.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.suggestionIndex = index;
        this.insertSuggestion(textbox);
      });
      list.appendChild(li);
    });
    this.suggestionsEl = list;
    const wrap = textbox.parentElement as HTMLElement;
    wrap.style.position = 'relative';
    wrap.appendChild(list);
  }

  moveSuggestion(delta: number): void {
    if (!this.suggestionsEl) return;
    this.suggestionIndex = (this.suggestionIndex + delta + this.suggestionItems.length) % this.suggestionItems.length;
    const items = this.suggestionsEl.querySelectorAll('li');
    items.forEach((li, index) => li.setAttribute('aria-selected', String(index === this.suggestionIndex)));
  }

  insertSuggestion(textbox: HTMLInputElement): void {
    const chosen = this.suggestionItems[this.suggestionIndex];
    if (!chosen) return;
    const value = textbox.value;
    const caret = textbox.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const symbol = this.suggestionKind === 'tag' ? '#' : '@';
    const replaced = before.replace(new RegExp(`${symbol}([A-Za-z0-9_-]*)$`), `${chosen} `);
    textbox.value = replaced + after;
    textbox.dispatchEvent(new Event('input'));
    const pos = replaced.length;
    textbox.setSelectionRange(pos, pos);
    this.closeSuggestions();
    textbox.focus();
  }

  closeSuggestions(): void {
    if (this.suggestionsEl) {
      this.suggestionsEl.remove();
      this.suggestionsEl = null;
    }
    this.suggestionKind = null;
    this.suggestionPrefix = '';
  }

  // ---------- Text saving ----------

  queueTextSave(bullet: BulletView, text: string): void {
    const existing = this.saveTimers.get(bullet.id);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      this.saveTimers.delete(bullet.id);
      void this.saveText(bullet.id, text, bullet.revision);
    }, 600);
    this.saveTimers.set(bullet.id, timer);
  }

  async flushSave(bullet: BulletView): Promise<void> {
    const timer = this.saveTimers.get(bullet.id);
    if (timer) {
      window.clearTimeout(timer);
      this.saveTimers.delete(bullet.id);
    }
    const pending = this.pendingSaves.get(bullet.id);
    if (pending && pending.text !== bullet.text) {
      await this.saveText(bullet.id, pending.text, pending.revision);
    } else if (pending) {
      this.pendingSaves.delete(bullet.id);
    }
  }

  async saveText(bulletId: string, text: string, revision: number): Promise<void> {
    const result = await api<{ bullet: BulletView }>(`/api/bullets/${bulletId}`, {
      method: 'PATCH',
      body: JSON.stringify({ text, revision }),
    });
    if (result.status === 200 && result.body.bullet) {
      this.byId.set(bulletId, result.body.bullet);
      const originalId = result.body.bullet.mirrorOf ?? result.body.bullet.id;
      for (const [id, view] of this.byId) {
        if ((view.mirrorOf ?? view.id) === originalId) {
          const updated = { ...view, text: result.body.bullet.text, tags: result.body.bullet.tags, mentions: result.body.bullet.mentions, date: result.body.bullet.date, completed: result.body.bullet.completed, revision: result.body.bullet.revision };
          this.byId.set(id, updated);
        }
      }
      this.pendingSaves.delete(bulletId);
      this.rebuildTreeFromById();
      this.render();
      return;
    }
    if (result.status === 409 && result.body.error === 'stale_revision') {
      const current = result.body.current?.text ?? '';
      const editorName = result.body.editor?.name ?? 'Someone';
      this.pendingSaves.delete(bulletId);
      const view = this.byId.get(bulletId);
      if (view) {
        this.byId.set(bulletId, { ...view, text: current, revision: result.body.current?.revision ?? view.revision });
        this.rebuildTreeFromById();
        this.render();
      }
      problem(`${editorName} changed this bullet first. Their text is shown; your edit was not saved.`);
      return;
    }
    if (result.status === 422 && result.body.errors?.text) {
      problem(result.body.errors.text);
      return;
    }
    if (!result.ok) {
      problem('Couldn’t save your last change. Retrying when the connection returns.');
    }
  }

  // ---------- Operations ----------

  async addFirstBullet(): Promise<void> {
    const parentId = this.rootBullet ? this.rootBullet.id : null;
    const result = await api<{ bullet: BulletView }>('/api/bullets', {
      method: 'POST',
      body: JSON.stringify({ parentId, afterId: null, text: '' }),
    });
    if (result.status === 201) {
      await this.loadView(true, result.body.bullet.id);
      this.focusBullet(result.body.bullet.id, 'end');
    }
  }

  async enterSplit(bullet: BulletView, textbox: HTMLInputElement, caret: number): Promise<void> {
    await this.flushSave(bullet);
    const value = textbox.value;
    if (caret === 0 && value.length > 0) {
      const above = await api<{ bullet: BulletView }>('/api/bullets', {
        method: 'POST',
        body: JSON.stringify({ parentId: bullet.parentId, afterId: null, text: '' }),
      });
      if (above.status === 201) {
        await this.loadView(true, bullet.id);
        this.focusBullet(bullet.id, 'start');
      }
      return;
    }
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const newText = after;
    const result = await api<{ bullet: BulletView }>('/api/bullets', {
      method: 'POST',
      body: JSON.stringify({ parentId: bullet.parentId, afterId: bullet.id, text: newText }),
    });
    if (result.status !== 201) return;
    if (before !== bullet.text) {
      await this.saveText(bullet.id, before, bullet.revision);
    }
    await this.loadView(true, result.body.bullet.id);
    this.focusBullet(result.body.bullet.id, 'start');
  }

  async backspaceDelete(bullet: BulletView): Promise<void> {
    const result = await api<{ result: string }>(`/api/bullets/${bullet.id}`, { method: 'DELETE' });
    if (result.status === 200) {
      announce('Deleted empty bullet');
      const above = this.visibleSiblingAbove(bullet.id);
      await this.loadView(true, above ?? null);
      if (above) this.focusBullet(above, 'end');
    }
  }

  visibleSiblingAbove(bulletId: string): string | null {
    const bullet = this.byId.get(bulletId);
    if (!bullet) return null;
    const siblings = [...this.byId.values()].filter((b) => b.parentId === bullet.parentId).sort((a, b) => a.position - b.position);
    const index = siblings.findIndex((b) => b.id === bulletId);
    return index > 0 ? siblings[index - 1]?.id ?? null : null;
  }

  async doMove(bulletId: string, op: 'indent' | 'outdent' | 'up' | 'down'): Promise<void> {
    const bullet = this.byId.get(bulletId);
    if (!bullet) return;
    if (this.isCollaborator && bulletId === this.collaboratorHome) {
      problem('The shared bullet stays where its owner put it.');
      return;
    }
    if (this.isViewEdgeRefusal(bullet, op)) {
      const copy = op === 'up' ? 'Can’t move up: it is already first.'
        : op === 'down' ? 'Can’t move down: it is already last.'
        : op === 'outdent' ? 'Can’t outdent: it is already at the top level.'
        : "Can't indent: there is no bullet above it at this level.";
      problem(copy);
      return;
    }
    const result = await api<{ bullet: BulletView }>(`/api/bullets/${bulletId}/move`, {
      method: 'POST',
      body: JSON.stringify({ op }),
    });
    if (result.status === 200) {
      await this.loadView(true, bulletId);
      this.announceMove(bulletId, op);
      this.focusBullet(bulletId, 'end');
    } else {
      this.announceApiRefusal(result.body.message ?? '');
    }
  }

  isViewEdgeRefusal(bullet: BulletView, op: string): boolean {
    if (this.isCollaborator) return false;
    const viewTopId = this.rootBullet?.id ?? null;
    if (viewTopId !== null && bullet.parentId === viewTopId) {
      const siblings = this.siblingsOf(bullet);
      const index = siblings.findIndex((b) => b.id === bullet.id);
      if (op === 'up' && index === 0) return true;
      if (op === 'down' && index === siblings.length - 1) return true;
      if (op === 'outdent') return true;
    }
    if (bullet.parentId === null && (op === 'up' || op === 'down' || op === 'outdent')) {
      return true;
    }
    if (op === 'indent' && bullet.parentId === null) {
      const siblings = this.siblingsOf(bullet);
      const index = siblings.findIndex((b) => b.id === bullet.id);
      if (index === 0) return true;
    }
    return false;
  }

  siblingsOf(bullet: BulletView): BulletView[] {
    return [...this.byId.values()]
      .filter((b) => b.parentId === bullet.parentId)
      .sort((a, b) => a.position - b.position);
  }

  announceMove(bulletId: string, op: string): void {
    const bullet = this.byId.get(bulletId);
    if (!bullet) return;
    const siblings = [...this.byId.values()].filter((b) => b.parentId === bullet.parentId).sort((a, b) => a.position - b.position);
    const i = siblings.findIndex((b) => b.id === bulletId) + 1;
    const n = siblings.length;
    if (op === 'indent' || op === 'outdent') {
      if (op === 'indent') {
        const parent = this.byId.get(bullet.parentId ?? '');
        announce(`Indented under ${trimmedName(parent?.text ?? '')}`);
      } else if (bullet.parentId === null) {
        announce('Outdented to top level');
      } else {
        const parent = this.byId.get(bullet.parentId);
        announce(`Outdented under ${trimmedName(parent?.text ?? '')}`);
      }
      return;
    }
    const parent = bullet.parentId ? this.byId.get(bullet.parentId) : null;
    if (parent) {
      announce(`Moved to position ${i} of ${n} under ${trimmedName(parent.text)}`);
    } else {
      announce(`Moved to position ${i} of ${n} at top level`);
    }
  }

  announceApiRefusal(message: string): void {
    problem(message);
  }

  async toggleCollapse(bullet: BulletView): Promise<void> {
    const result = await api<{ bullet: BulletView }>(`/api/bullets/${bullet.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ collapsed: !bullet.collapsed }),
    });
    if (result.status === 200) {
      announce(bullet.collapsed ? `Expanded ${trimmedName(bullet.text)}` : `Collapsed ${trimmedName(bullet.text)}`);
      await this.loadView(true, bullet.id);
      this.focusBullet(bullet.id, 'end');
    }
  }

  async toggleComplete(bullet: BulletView): Promise<void> {
    const result = await api<{ bullet: BulletView }>(`/api/bullets/${bullet.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ completed: !bullet.completed }),
    });
    if (result.status === 200) {
      const nowCompleted = result.body.bullet.completed;
      announce(nowCompleted ? `Completed ${trimmedName(bullet.text)}` : `Marked ${trimmedName(bullet.text)} not complete`);
      await this.loadView(true, bullet.id);
      this.focusBullet(bullet.id, 'end');
    }
  }

  async mirror(bulletId: string): Promise<void> {
    const result = await api<{ bullet: BulletView }>(`/api/bullets/${bulletId}/mirror`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    if (result.status === 201) {
      announce(`Mirrored ${trimmedName(result.body.bullet.text)}`);
      await this.loadView(true, result.body.bullet.id);
      this.focusBullet(result.body.bullet.id, 'end');
    } else {
      this.announceApiRefusal(result.body.message ?? '');
    }
  }

  confirmDelete(bulletId: string): void {
    const bullet = this.byId.get(bulletId);
    if (!bullet) return;
    if (bullet.childCount === 0) {
      void this.deleteBullet(bulletId);
      return;
    }
    const dialog = el('dialog', { 'aria-label': 'Delete bullet' });
    const card = el('div', { class: 'dialog-card' });
    card.appendChild(el('h2', null, 'Delete bullet'));
    card.appendChild(el('p', null, `Delete ${trimmedName(bullet.text)} and the ${countBullets(bullet.childCount)} inside it?`));
    const actions = el('div', { class: 'dialog-actions' });
    const cancel = el('button', { 'data-action': 'cancel' }, 'Cancel');
    const confirm = el('button', { class: 'pill', 'data-action': 'confirm' }, 'Delete');
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    card.appendChild(actions);
    dialog.appendChild(card);
    document.body.appendChild(dialog);
    dialog.showModal();
    cancel.focus();

    const close = (focusTarget: string) => {
      dialog.close();
      dialog.remove();
      this.focusBullet(focusTarget, 'end');
    };
    cancel.addEventListener('click', () => close(bulletId));
    confirm.addEventListener('click', async () => {
      dialog.close();
      dialog.remove();
      await this.deleteBullet(bulletId);
    });
    dialog.addEventListener('keydown', (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        close(bulletId);
      }
      if (keyEvent.key === 'Tab') {
        keyEvent.preventDefault();
        if (document.activeElement === cancel) confirm.focus();
        else cancel.focus();
      }
    });
  }

  async deleteBullet(bulletId: string): Promise<void> {
    const bullet = this.byId.get(bulletId);
    const result = await api<{ result: string; count: number }>(`/api/bullets/${bulletId}`, { method: 'DELETE' });
    if (result.status === 200) {
      if (result.body.result === 'copy_removed') {
        announce(`Removed copy of ${trimmedName(bullet?.text ?? '')}`);
      } else {
        announce(`Moved ${trimmedName(bullet?.text ?? '')} to trash`);
      }
      const above = this.visibleSiblingAbove(bulletId);
      await this.loadView(true, above ?? null);
      const target = above ?? this.firstVisible();
      if (target) this.focusBullet(target, 'end');
    }
  }

  async undo(): Promise<void> {
    if (this.focusedId) await this.flushSave(this.byId.get(this.focusedId) as BulletView);
    const result = await api<{ step: string }>('/api/undo', { method: 'POST', body: '{}' });
    if (result.status === 200) {
      announce(`Undid ${result.body.step}`);
      await this.loadView(true, this.focusedId);
    } else if (result.body.error === 'nothing_to_undo') {
      problem('Nothing more to undo.');
    } else if (result.body.error === 'edited_since') {
      problem(`Can’t undo: ${result.body.message?.includes('edited') ? '' : ''}${result.body.message ?? 'someone has edited this bullet since.'}`);
    } else if (result.body.error === 'origin_gone') {
      problem("Can’t undo: the place it came from was deleted.");
    }
  }

  async redo(): Promise<void> {
    const result = await api<{ step: string }>('/api/redo', { method: 'POST', body: '{}' });
    if (result.status === 200) {
      announce(`Redid ${result.body.step}`);
      await this.loadView(true, this.focusedId);
    } else if (result.body.error === 'nothing_to_redo') {
      problem('Nothing more to redo.');
    }
  }

  async zoomIn(bulletId: string): Promise<void> {
    const bullet = this.byId.get(bulletId);
    if (!bullet) return;
    if (this.focusedId) {
      const focused = this.byId.get(this.focusedId);
      if (focused) await this.flushSave(focused);
    }
    this.zoomRootId = bulletId;
    const acceptedShare = this.shared.find((s) => s.bulletId === bulletId);
    if (acceptedShare && !this.isCollaborator) {
      // owner zooming their own shared bullet stays owner
    }
    await this.loadView(false);
    announce(`Zoomed into ${trimmedName(bullet.text)}`);
    const titleInput = document.querySelector('[data-title-input]') as HTMLInputElement | null;
    if (titleInput) titleInput.focus();
  }

  async zoomOut(): Promise<void> {
    if (!this.rootBullet) return;
    const previousZoom = this.zoomRootId;
    if (this.isCollaborator && this.rootBullet.id === this.collaboratorHome) {
      announce('Zoomed out to Home');
      return;
    }
    const parent = this.rootBullet.parentId;
    this.zoomRootId = parent ?? null;
    const previousId = previousZoom;
    await this.loadView(false, previousId);
    if (previousId) {
      announce(`Zoomed out to ${trimmedName(this.byId.get(previousId)?.text ?? '')}`);
      this.plannedFocusAfterRender = previousId;
      this.caretAtStart = false;
      this.render();
      this.focusBullet(previousId, 'end');
    } else {
      announce('Zoomed out to Home');
    }
  }

  moveFocus(fromId: string, delta: number): void {
    const ordered = this.orderedVisible();
    const index = ordered.findIndex((id) => id === fromId);
    const next = ordered[index + delta];
    if (next) {
      this.focusBullet(next, 'end');
    }
  }

  orderedVisible(): string[] {
    const out: string[] = [];
    const visit = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (!this.visibleNode(node)) continue;
        out.push(node.bullet.id);
        if (!node.bullet.collapsed) visit(node.children);
      }
    };
    visit(this.nodes);
    return out;
  }

  focusBullet(id: string, caret: 'start' | 'end'): void {
    const textbox = document.querySelector(`[data-text-id="${id}"]`) as HTMLInputElement | null;
    if (textbox) {
      textbox.focus();
      const pos = caret === 'start' ? 0 : textbox.value.length;
      textbox.setSelectionRange(pos, pos);
      this.focusedId = id;
      this.updateSelection();
    } else {
      this.plannedFocusAfterRender = id;
      this.caretAtStart = caret === 'start';
      this.render();
    }
  }

  updateSelection(): void {
    document.querySelectorAll('[data-row-id]').forEach((row) => {
      row.setAttribute('data-focussed', String(row.getAttribute('data-row-id') === this.focusedId));
    });
    document.querySelectorAll('[role="treeitem"]').forEach((item) => {
      item.setAttribute('aria-selected', String(item.getAttribute('data-bullet-id') === this.focusedId));
    });
  }

  // ---------- Board ----------

  renderBoard(): HTMLElement {
    const board = el('div', { class: 'board', role: 'list' });
    const columns: BoardColumn[] = this.nodes.map((node) => ({
      bullet: node.bullet,
      cards: node.children.map((child) => child.bullet),
    }));
    for (const column of columns) {
      const region = el('section', { class: 'board-column', role: 'region', 'aria-label': trimmedName(column.bullet.text) });
      region.appendChild(el('h3', null, trimmedName(column.bullet.text)));
      const visibleCards = column.cards.filter((card) => !(this.hideCompleted && card.completed));
      region.appendChild(el('div', { class: 'count' }, countBullets(visibleCards.length) === '' ? '' : `${visibleCards.length} cards`));
      const list = el('ul', { class: 'cards', role: 'list' });
      visibleCards.forEach((card, index) => {
        const item = el('li', {
          class: 'board-card',
          role: 'listitem',
          tabindex: '0',
          'data-bullet-id': card.id,
          'aria-label': card.text,
        }, card.text);
        this.attachCardKeyboard(item, card, column, index);
        this.attachCardDrag(item, card, column);
        list.appendChild(item);
      });
      region.appendChild(list);
      board.appendChild(region);
    }
    if (columns.length === 0) {
      const empty = el('div', { class: 'empty-state' },
        el('p', null, this.rootBullet ? 'Nothing inside this bullet yet.' : 'Your outline is empty. Start with one thought.'));
      const add = el('button', { class: 'pill' }, this.rootBullet ? 'Add bullet' : 'Add first bullet');
      add.addEventListener('click', () => void this.addFirstBullet());
      empty.appendChild(add);
      return empty;
    }
    return board;
  }

  attachCardKeyboard(item: HTMLElement, card: BulletView, column: BoardColumn, index: number): void {
    let lifted = false;
    item.addEventListener('keydown', (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === ' ') {
        keyEvent.preventDefault();
        if (!lifted) {
          lifted = true;
          item.setAttribute('data-lifted', 'true');
          announce(`Picked up ${trimmedName(card.text)}. Use the arrow keys to move it, Space to drop, Escape to cancel.`);
        } else {
          void this.dropCard(item, card, column);
          lifted = false;
        }
        return;
      }
      if (!lifted) return;
      if (keyEvent.key === 'ArrowUp' || keyEvent.key === 'ArrowDown') {
        keyEvent.preventDefault();
        void this.moveCard(card, column, keyEvent.key === 'ArrowUp' ? index - 1 : index + 2, column);
        return;
      }
      if (keyEvent.key === 'ArrowLeft' || keyEvent.key === 'ArrowRight') {
        keyEvent.preventDefault();
        const columns = this.nodes.map((n) => n.bullet);
        const colIndex = columns.findIndex((c) => c.id === column.bullet.id);
        const nextCol = columns[colIndex + (keyEvent.key === 'ArrowRight' ? 1 : -1)];
        if (nextCol) {
          const nextColumn = this.nodes.find((n) => n.bullet.id === nextCol.id);
          if (nextColumn) {
            const target = nextColumn.children.length;
            void this.moveCard(card, column, target, { bullet: nextCol, cards: nextColumn.children.map((c) => c.bullet) });
          }
        }
        return;
      }
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        lifted = false;
        item.removeAttribute('data-lifted');
        announce(`Move cancelled. ${trimmedName(card.text)} is back in ${trimmedName(column.bullet.text)}.`);
      }
    });
  }

  attachCardDrag(item: HTMLElement, card: BulletView, column: BoardColumn): void {
    let pressTimer = 0;
    item.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse') {
        startDrag(event, item, card, column);
        return;
      }
      pressTimer = window.setTimeout(() => {
        startDrag(event, item, card, column);
      }, 500);
    });
    item.addEventListener('pointerup', () => {
      window.clearTimeout(pressTimer);
    });
    item.addEventListener('pointercancel', () => {
      window.clearTimeout(pressTimer);
    });
  }

  async dropCard(item: HTMLElement, card: BulletView, column: BoardColumn): Promise<void> {
    item.removeAttribute('data-lifted');
    const siblings = [...(item.parentElement?.children ?? [])];
    const index = siblings.findIndex((child) => child === item);
    await this.moveCard(card, column, index === -1 ? 0 : index, column);
  }

  async moveCard(card: BulletView, _fromColumn: BoardColumn, index: number, toColumn: BoardColumn): Promise<void> {
    const result = await api<{ bullet: BulletView }>(`/api/bullets/${card.id}/move`, {
      method: 'POST',
      body: JSON.stringify({ parentId: toColumn.bullet.id, index }),
    });
    if (result.status === 200) {
      const siblings = [...this.byId.values()].filter((b) => b.parentId === toColumn.bullet.id);
      const i = siblings.findIndex((b) => b.id === card.id) + 1;
      announce(`Dropped ${trimmedName(card.text)} in ${trimmedName(toColumn.bullet.text)}, position ${i} of ${siblings.length}`);
      await this.loadView(true, card.id);
    }
  }

  // ---------- Share dialog ----------

  openShareDialog(bulletId: string): void {
    const dialog = el('dialog', { 'aria-label': 'Share bullet' });
    const card = el('div', { class: 'dialog-card' });
    card.appendChild(el('h2', null, 'Share bullet'));
    const list = el('ul', { class: 'invitation-list', 'aria-label': 'Invitations' });
    card.appendChild(list);
    const emailInput = el('input', { type: 'email', placeholder: 'collaborator@example.com', 'aria-label': 'Collaborator email' });
    const emailError = el('div', { class: 'error', 'data-share-error': 'true' });
    const sendButton = el('button', { class: 'pill' }, 'Send invitation');
    const closeButton = el('button', { 'aria-label': 'Close' }, 'Close');
    const sendRow = el('div', { class: 'field' }, emailInput, emailError);
    card.appendChild(sendRow);
    card.appendChild(sendButton);
    card.appendChild(el('div', { class: 'dialog-actions' }, closeButton));
    dialog.appendChild(card);
    document.body.appendChild(dialog);
    dialog.showModal();
    emailInput.focus();

    const load = async () => {
      const result = await api<{ shares: SharePayload[] }>(`/api/bullets/${bulletId}/shares`);
      list.innerHTML = '';
      if (result.status === 200) {
        for (const share of result.body.shares) {
          const row = el('li', null,
            el('span', null, share.email),
            el('span', { class: 'status' }, statusWord(share.status)),
            el('span', { class: 'row-actions' }),
          );
          const actions = row.querySelector('.row-actions') as HTMLElement;
          if (share.status === 'not_sent') {
            const retry = el('button', { 'aria-label': `Retry invitation to ${share.email}` }, 'Retry');
            retry.addEventListener('click', async () => {
              const retryResult = await api<{ share: SharePayload }>(`/api/shares/${share.id}/retry`, { method: 'POST', body: '{}' });
              if (retryResult.status === 409) {
                problem(retryResult.body.message ?? "That invitation can't be retried.");
              }
              announce(`Invitation sent to ${share.email}`);
              await load();
            });
            actions.appendChild(retry);
          }
          if (share.status !== 'revoked') {
            const remove = el('button', { 'aria-label': `Remove access for ${share.email}` }, 'Remove access');
            remove.addEventListener('click', async () => {
              const removeResult = await api<{ share: SharePayload }>(`/api/shares/${share.id}`, { method: 'DELETE' });
              if (removeResult.status === 409) {
                problem(removeResult.body.message ?? 'That share is already closed.');
                return;
              }
              announce(`Removed access for ${share.email}`);
              await load();
            });
            actions.appendChild(remove);
          }
          list.appendChild(row);
        }
      }
    };
    void load();

    const send = async () => {
      emailError.textContent = '';
      sendButton.textContent = 'Sending';
      sendButton.setAttribute('aria-busy', 'true');
      sendButton.setAttribute('disabled', '');
      const result = await api<{ share: SharePayload }>(`/api/bullets/${bulletId}/shares`, {
        method: 'POST',
        body: JSON.stringify({ email: emailInput.value }),
      });
      sendButton.textContent = 'Send invitation';
      sendButton.removeAttribute('aria-busy');
      sendButton.removeAttribute('disabled');
      if (result.status === 422 && result.body.errors?.email) {
        emailError.textContent = result.body.errors.email;
        return;
      }
      if (result.status === 409) {
        emailError.textContent = result.body.message ?? 'This address already has an open invitation to this bullet.';
        return;
      }
      if (result.status === 201) {
        if (result.body.share.status === 'sent') {
          announce(`Invitation sent to ${result.body.share.email}`);
        } else {
          problem(`Invitation not sent to ${result.body.share.email}. Mail can't be delivered right now; use Retry.`);
        }
        emailInput.value = '';
        await load();
      }
    };
    sendButton.addEventListener('click', () => void send());
    emailInput.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault();
        void send();
      }
    });
    closeButton.addEventListener('click', () => {
      dialog.close();
      dialog.remove();
      const shareButton = document.querySelector('[data-action="share"]') as HTMLElement | null;
      shareButton?.focus();
    });
    dialog.addEventListener('keydown', (event) => {
      const keyEvent = event as KeyboardEvent;
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        dialog.close();
        dialog.remove();
      }
      if (keyEvent.key === 'Tab') {
        const focusables = [emailInput, sendButton, closeButton, ...list.querySelectorAll('button')];
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (keyEvent.shiftKey && document.activeElement === first) {
          keyEvent.preventDefault();
          last?.focus();
        } else if (!keyEvent.shiftKey && document.activeElement === last) {
          keyEvent.preventDefault();
          first?.focus();
        }
      }
    });
  }

  openDownloadMenu(): void {
    const menu = el('div', { role: 'menu', class: 'suggestions', style: 'position:absolute;right:16px;z-index:50' });
    const formats: [string, string][] = [['Plain text', 'text'], ['Markdown', 'markdown'], ['OPML', 'opml']];
    for (const [label, format] of formats) {
      const item = el('div', { role: 'menuitem', tabindex: '0' }, label);
      item.addEventListener('click', () => {
        const rootParam = this.zoomRootId ?? '';
        window.location.href = `/api/export?format=${format}${rootParam ? `&root=${encodeURIComponent(rootParam)}` : ''}`;
        menu.remove();
      });
      menu.appendChild(item);
    }
    const toolbar = document.querySelector('.outline-toolbar') as HTMLElement | null;
    if (toolbar) {
      toolbar.style.position = 'relative';
      toolbar.appendChild(menu);
    }
    window.setTimeout(() => {
      window.addEventListener('click', function close() {
        menu.remove();
        window.removeEventListener('click', close);
      }, { once: true });
    }, 10);
  }

  async toggleHideCompleted(): Promise<void> {
    this.hideCompleted = !this.hideCompleted;
    await api('/api/me', { method: 'PATCH', body: JSON.stringify({ hideCompleted: this.hideCompleted }) });
    if (this.hideCompleted) {
      const hidden = this.countCompletedInView();
      announce(hidden === 0 ? 'No completed bullets hidden' : hidden === 1 ? '1 completed bullet hidden' : `${hidden} completed bullets hidden`);
    } else {
      announce('Showing completed bullets');
    }
    this.render();
  }

  countCompletedInView(): number {
    let count = 0;
    const visit = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.bullet.completed) count += 1;
        visit(node.children);
      }
    };
    visit(this.nodes);
    return count;
  }
}

function statusWord(status: string): string {
  if (status === 'pending_send' || status === 'sending') return 'Sending';
  if (status === 'sent') return 'Sent';
  if (status === 'not_sent') return 'Not sent';
  if (status === 'accepted') return 'Accepted';
  if (status === 'lapsed') return 'Expired';
  return status;
}

function params_view(): string | null {
  return new URLSearchParams(window.location.search).get('view');
}

function startDrag(event: PointerEvent, item: HTMLElement, card: BulletView, column: BoardColumn): void {
  item.setAttribute('data-lifted', 'true');
  const move = (moveEvent: PointerEvent) => {
    item.style.transform = `translate(${moveEvent.clientX - event.clientX}px, ${moveEvent.clientY - event.clientY}px)`;
  };
  const drop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', drop);
    item.style.transform = '';
    item.removeAttribute('data-lifted');
    const newIndex = [...item.parentElement?.children ?? []].findIndex((child) => child === item);
    const app = currentApp;
    if (app) {
      void app.moveCard(card, column, newIndex === -1 ? 0 : newIndex, column);
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', drop, { once: true });
}

let currentApp: OutlineApp | null = null;
export function registerApp(app: OutlineApp): void {
  currentApp = app;
}
