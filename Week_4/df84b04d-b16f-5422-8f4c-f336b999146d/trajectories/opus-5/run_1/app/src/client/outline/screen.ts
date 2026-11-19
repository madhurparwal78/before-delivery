import { alerts, announce as say, fixed } from '../../shared/copy.js';
import type { Bullet, MeResponse, OutlineView, SearchResult } from '../../shared/types.js';
import { displayText } from '../../shared/types.js';
import { api, failureOf } from '../api.js';
import { clear, el } from '../dom.js';
import { alertNow, announce, isTouch, reducedMotion } from '../regions.js';
import { renderBoard } from './board.js';
import { caretOffset, caretToEnd, placeCaret, selectionIsCollapsed, textOf } from './caret.js';
import {
  buildAppBar,
  buildBulletToolbar,
  buildToolbar,
  type BulletAction,
  type BulletToolbar,
  type ToolbarButtons
} from './chrome.js';
import { LiveLink } from './live.js';
import {
  buildTree,
  hiddenCompletedCount,
  nodeName,
  indexOf,
  siblingsOf,
  visibleRows,
  type Node,
  type Tree
} from './model.js';
import { renderRow, renderRowText } from './rows.js';
import { openShareDialog } from './share.js';
import { openDeleteDialog } from './dialogs.js';
import { Suggestions } from './suggestions.js';

export interface ScreenHost {
  go(path: string): void;
}

const SAVE_DELAY = 600;
const TITLE_KEY = '@branch-title';
const SEARCH_DELAY = 250;

/** The signed-in outline: one window, one tree, one live link. */
export class OutlineScreen {
  private data: OutlineView = { root: null, ancestors: [], seq: 0, bullets: [] };
  private tree: Tree = buildTree(this.data);
  private rootId: string | null = null;
  private boardView = false;
  private focusKey: string | null = null;
  private searchResult: SearchResult | null = null;
  private searchTimer = 0;
  private saveTimers = new Map<string, number>();
  /** Text typed but not yet saved, with the revision the tab last saw for that bullet. */
  private pending = new Map<string, { text: string; revision: number }>();
  private ownSeqs = new Set<number>();
  private link: LiveLink | null = null;
  private paused = false;
  private revoked = false;
  private zoomMotion: 'in' | 'out' | null = null;
  private readonly unfolded = new Set<string>();
  private suggestToken = 0;
  /** The bullet whose row takes focus once the next branch is on screen. */
  private pendingFocusId: string | null = null;

  private readonly toolbar: ToolbarButtons = buildToolbar();
  private readonly bulletToolbar: BulletToolbar = buildBulletToolbar();
  private readonly appBar = buildAppBar();
  private readonly titleSlot = el('h1', { class: 'view-title' });
  private readonly liveSync = el('div', { class: 'live-sync' });
  private readonly treeElement = el('ul', { role: 'tree', class: 'tree', 'aria-label': 'Outline' });
  private readonly boardElement = el('div', { class: 'board' });
  private readonly stateBlock = el('div', { class: 'state-block' });
  private readonly hiddenNote = el('p', { class: 'hidden-note muted' });
  private readonly body = el('div', { class: 'window-body' });
  private readonly suggestions = new Suggestions();

  constructor(
    private readonly mount: HTMLElement,
    private me: MeResponse,
    private readonly host: ScreenHost
  ) {}

  /** Builds the screen once; later navigation only changes the view. */
  start(rootId: string | null, boardView: boolean): void {
    this.rootId = rootId;
    this.boardView = boardView;
    clear(this.mount);
    this.body.append(this.titleSlot, this.liveSync, this.stateBlock, this.treeElement, this.boardElement, this.hiddenNote);
    this.mount.append(
      this.appBar.element,
      el('main', {}, [
        el('section', { class: 'outline-window app-window' }, [
          this.toolbar.toolbar,
          this.bulletToolbar.element,
          this.body
        ])
      ])
    );
    if (isTouch()) document.documentElement.classList.add('touch');
    this.wireToolbar();
    this.wireBulletToolbar();
    this.wireTree();
    this.wireKeys();
    this.drawAppBar();
    void this.load({ announceZoom: false });
  }

  stop(): void {
    this.link?.stop();
    this.link = null;
  }

  /** Shows another branch, or the same branch as a board. */
  show(rootId: string | null, boardView: boolean): void {
    const previous = this.rootId;
    this.boardView = boardView;
    if (rootId === previous) {
      this.render();
      return;
    }
    const zoomingOut =
      rootId === null ||
      this.data.ancestors.some((ancestor) => ancestor.id === rootId) ||
      rootId === this.shareRootId();
    this.zoomMotion = zoomingOut ? 'out' : 'in';
    if (zoomingOut && previous !== null) this.pendingFocusId = previous;
    this.rootId = rootId;
    this.searchResult = null;
    this.toolbar.search.value = '';
    this.toolbar.searchCount.textContent = '';
    void this.load({ announceZoom: true });
  }

  private isCollaborator(): boolean {
    return this.shareRootId() !== null;
  }

  /** The shared bullet that bounds the view, worked out from what the branch shows. */
  private shareRootId(): string | null {
    if (this.rootId === null) return null;
    const direct = this.me.shared.find((share) => share.bulletId === this.rootId);
    if (direct !== undefined) return direct.bulletId;
    const root = this.data.root;
    if (root === null) return null;
    const top = this.data.ancestors[0] ?? root;
    if (this.data.ancestors.length < root.depth) return top.parentId;
    return null;
  }

  private homePath(): string {
    const shareRoot = this.shareRootId();
    return shareRoot === null ? '/' : `/b/${shareRoot}`;
  }

  private async load(options: { announceZoom: boolean }): Promise<void> {
    this.treeElement.setAttribute('aria-busy', 'true');
    this.drawLoading();
    try {
      this.data = await api.outline(this.rootId);
    } catch (error) {
      if (failureOf(error)?.status === 404) {
        this.renderNotFound();
        return;
      }
      throw error;
    }
    this.revoked = false;
    this.tree = buildTree(this.data);
    this.treeElement.removeAttribute('aria-busy');
    const motion = this.zoomMotion;
    this.render();
    if (options.announceZoom) {
      const root = this.data.root;
      if (motion === 'out') {
        announce(root === null ? say.zoomOutHome : say.zoomOut(displayText(root)));
      } else if (root !== null) {
        announce(say.zoomIn(displayText(root)));
      }
    }
    if (this.pendingFocusId !== null) this.focusZoomedRow();
    else if (motion === 'in') this.titleSlot.querySelector<HTMLElement>('.branch-title')?.focus();
    this.connect();
  }

  private connect(): void {
    this.link?.stop();
    this.link = new LiveLink(this.rootId, this.data.seq, {
      onChange: (bullets, removed, seq) => this.applyChange(bullets, removed, seq),
      onReload: () => {
        void this.refresh().then(() => announce(say.branchReloaded));
      },
      onRevoked: () => this.showRevoked(),
      onPaused: (paused) => this.setPaused(paused)
    });
    this.link.start();
  }

  private setPaused(paused: boolean): void {
    const was = this.paused;
    this.paused = paused;
    this.drawLiveSync();
    if (was && !paused) {
      announce(say.syncResumed);
      void this.refresh();
    }
  }

  private showRevoked(): void {
    this.revoked = true;
    this.link?.stop();
    this.drawLiveSync();
  }

  private applyChange(bullets: Bullet[], removed: string[], seq: number): void {
    if (this.ownSeqs.delete(seq)) return;
    let structural = removed.length > 0;
    for (const bullet of bullets) {
      if (this.data.root !== null && this.data.root.id === bullet.id) {
        if (this.pending.has(bullet.id)) continue;
        this.data.root = bullet;
        const title = this.titleSlot.querySelector<HTMLElement>('.branch-title');
        if (title !== null && title !== document.activeElement) title.textContent = bullet.text;
        continue;
      }
      const nodes = this.tree.byId.get(bullet.id);
      if (nodes === undefined) {
        structural = true;
        continue;
      }
      for (const node of nodes) {
        if (
          node.bullet.position !== bullet.position ||
          node.bullet.childCount !== bullet.childCount ||
          (node.bullet.parentId !== bullet.parentId && node.parent === null)
        ) {
          structural = true;
        }
        // a live update never replaces unsaved text, and leaves the revision the tab
        // last saw in place, so its next save is refused as stale
        if (this.pending.has(bullet.id)) continue;
        node.bullet = bullet;
      }
    }
    if (structural) {
      void this.refresh();
      return;
    }
    if (this.patchRows(bullets.map((bullet) => bullet.id))) return;
    const held = this.heldCaret();
    this.render();
    this.restoreCaret(held);
  }

  /**
   * Writes a content change straight into the rows that show it, so an open
   * suggestions list and the caret stay where they are.
   */
  private patchRows(ids: readonly string[]): boolean {
    for (const id of new Set(ids)) {
      for (const node of this.tree.byId.get(id) ?? []) {
        if (this.me.user.hideCompleted && node.bullet.completed) return false;
        const item = this.treeElement.querySelector<HTMLElement>(
          `[data-key="${CSS.escape(node.key)}"]`
        );
        if (item === null) return false;
        item.setAttribute('aria-label', nodeName(node.bullet));
        item.setAttribute('data-completed', node.bullet.completed ? 'true' : 'false');
        item.setAttribute('data-collapsed', node.bullet.collapsed ? 'true' : 'false');
        if (node.bullet.childCount > 0) {
          item.setAttribute('aria-expanded', node.bullet.collapsed ? 'false' : 'true');
        }
        const text = item.querySelector<HTMLElement>('.bullet-text');
        if (text === null) continue;
        if (text === document.activeElement || this.pending.has(node.bullet.id)) continue;
        renderRowText(text, node.bullet, false);
      }
    }
    this.drawToolbarState();
    return true;
  }

  /** Reloads the branch from the server, keeping focus and caret where they were. */
  private async refresh(): Promise<void> {
    const held = this.heldCaret();
    try {
      this.data = await api.outline(this.rootId);
    } catch (error) {
      if (failureOf(error)?.status === 404) {
        if (this.isCollaborator()) this.showRevoked();
        else this.renderNotFound();
        return;
      }
      throw error;
    }
    this.tree = buildTree(this.data);
    for (const [bulletId, held] of this.pending) {
      for (const node of this.tree.byId.get(bulletId) ?? []) {
        node.bullet = { ...node.bullet, text: held.text, revision: held.revision };
      }
    }
    if (this.searchResult !== null) await this.runSearch(this.toolbar.search.value, false);
    this.render();
    this.restoreCaret(held);
  }

  private heldCaret(): { key: string; offset: number } | null {
    const active = document.activeElement as HTMLElement | null;
    if (active === null) return null;
    if (active.classList.contains('branch-title')) {
      return { key: TITLE_KEY, offset: caretOffset(active) };
    }
    if (!active.classList.contains('bullet-text')) return null;
    const key = active.closest<HTMLElement>('.row-item')?.dataset['key'];
    if (key === undefined) return null;
    return { key, offset: caretOffset(active) };
  }

  private restoreCaret(held: { key: string; offset: number } | null): void {
    if (held === null) return;
    const text =
      held.key === TITLE_KEY
        ? this.titleSlot.querySelector<HTMLElement>('.branch-title')
        : this.textElementFor(held.key);
    if (text === null) return;
    text.focus();
    placeCaret(text, Math.min(held.offset, textOf(text).length));
  }

  private textElementFor(key: string): HTMLElement | null {
    const item = this.treeElement.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    return item?.querySelector<HTMLElement>('.bullet-text') ?? null;
  }

  private nodeById(id: string): Node | null {
    return this.tree.byId.get(id)?.[0] ?? null;
  }

  private focusedNode(): Node | null {
    if (this.focusKey === null) return null;
    return this.tree.byKey.get(this.focusKey) ?? null;
  }

  private parentTextOf(node: Node): string | null {
    if (node.parent !== null) return displayText(node.parent.bullet);
    if (node.bullet.parentId === null) return null;
    return this.data.root === null ? null : displayText(this.data.root);
  }

  // ---------------------------------------------------------------- rendering

  private render(): void {
    this.drawTitle();
    this.drawBreadcrumb();
    this.drawToolbarState();
    this.drawLiveSync();
    this.drawAppBar();
    if (this.boardView) {
      this.treeElement.hidden = true;
      this.boardElement.hidden = false;
      clear(this.stateBlock);
      this.hiddenNote.textContent = '';
      renderBoard(
        { tree: this.tree, move: (id, parentId, index) => this.moveTo(id, parentId, index) },
        this.boardElement
      );
      return;
    }
    this.boardElement.hidden = true;
    this.treeElement.hidden = false;
    this.drawTree();
  }

  private drawTitle(): void {
    clear(this.titleSlot);
    const root = this.data.root;
    document.title = root === null ? 'Home — Twigline' : `${displayText(root)} — Twigline`;
    if (root === null) {
      this.titleSlot.append(document.createTextNode('Home'));
      return;
    }
    const title = el('div', {
      role: 'textbox',
      class: 'branch-title',
      'aria-label': 'Branch title',
      contenteditable: 'plaintext-only',
      spellcheck: 'false'
    });
    title.textContent = this.pending.get(root.id)?.text ?? root.text;
    title.addEventListener('input', () => {
      this.queueSave(root.id, textOf(title));
    });
    title.addEventListener('blur', () => {
      void this.flush();
    });
    this.titleSlot.append(title);
    if (this.zoomMotion === 'in' && !reducedMotion()) {
      title.classList.add('title-grow');
      window.setTimeout(() => title.classList.remove('title-grow'), 240);
    }
  }

  private drawBreadcrumb(): void {
    const bar = this.toolbar.breadcrumb;
    clear(bar);
    const crumbs: HTMLElement[] = [];
    const atHome = this.rootId === null || this.rootId === this.shareRootId();
    const homeLink = el('a', { class: 'crumb', href: this.homePath() }, ['Home']);
    if (atHome) homeLink.setAttribute('aria-current', 'page');
    crumbs.push(homeLink);
    for (const ancestor of this.data.ancestors) {
      crumbs.push(
        el('a', { class: 'crumb', href: `/b/${ancestor.id}` }, [displayText(ancestor)])
      );
    }
    if (!atHome && this.data.root !== null) {
      const current = el('span', { class: 'crumb crumb-current', 'aria-current': 'page' }, [
        displayText(this.data.root)
      ]);
      crumbs.push(current);
      if (this.zoomMotion === 'in' && !reducedMotion()) {
        current.classList.add('crumb-in');
        window.setTimeout(() => current.classList.remove('crumb-in'), 240);
      }
    }
    for (const [index, crumb] of crumbs.entries()) {
      if (index > 0) bar.append(el('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, ['/']));
      if (index > 0 && index < crumbs.length - 2) crumb.classList.add('crumb-middle');
      bar.append(crumb);
    }
  }

  private drawToolbarState(): void {
    const zoomed = this.rootId !== null;
    this.toolbar.share.hidden = !(zoomed && !this.isCollaborator());
    this.toolbar.hideCompleted.setAttribute(
      'aria-checked',
      this.me.user.hideCompleted ? 'true' : 'false'
    );
    this.toolbar.hideCompleted.classList.toggle('on', this.me.user.hideCompleted);
    const label = this.boardView ? 'Show as list' : 'Show as board';
    this.toolbar.viewSwitch.setAttribute('aria-label', label);
    const text = this.toolbar.viewSwitch.querySelector('.button-label');
    if (text !== null) text.textContent = label;
    const node = this.focusedNode();
    const collapse = this.bulletToolbar.buttons.get('Collapse');
    const complete = this.bulletToolbar.buttons.get('Complete');
    collapse?.setAttribute('aria-pressed', node?.bullet.collapsed === true ? 'true' : 'false');
    complete?.setAttribute('aria-pressed', node?.bullet.completed === true ? 'true' : 'false');
  }

  private drawAppBar(): void {
    const shares = this.me.shared;
    this.appBar.sharedButton.hidden = shares.length === 0;
    clear(this.appBar.sharedMenu);
    const own = el('button', { type: 'button', role: 'menuitem', class: 'menu-item' }, ['My outline']);
    own.addEventListener('click', () => {
      this.appBar.sharedMenu.hidden = true;
      this.host.go('/');
    });
    this.appBar.sharedMenu.append(own);
    for (const share of shares) {
      const item = el('button', { type: 'button', role: 'menuitem', class: 'menu-item' }, [share.text]);
      item.addEventListener('click', () => {
        this.appBar.sharedMenu.hidden = true;
        this.host.go(`/b/${share.bulletId}`);
      });
      this.appBar.sharedMenu.append(item);
    }
  }

  private drawLoading(): void {
    clear(this.stateBlock);
    clear(this.treeElement);
    this.treeElement.setAttribute('data-zoom-root', this.rootId ?? 'home');
    this.treeElement.hidden = false;
    this.boardElement.hidden = true;
    for (let row = 0; row < 3; row += 1) {
      this.treeElement.append(
        el('li', { class: 'loading-row', 'aria-hidden': 'true' }, [
          el('span', { class: 'loading-dot' }),
          el('span', { class: 'loading-dot' }),
          el('span', { class: 'loading-dot' })
        ])
      );
    }
  }

  private drawLiveSync(): void {
    clear(this.liveSync);
    if (this.revoked) {
      this.liveSync.setAttribute('role', 'region');
      this.liveSync.setAttribute('aria-label', 'Live sync');
      this.treeElement.hidden = true;
      this.boardElement.hidden = true;
      clear(this.stateBlock);
      this.hiddenNote.textContent = '';
      this.liveSync.append(
        el('p', { class: 'muted' }, [fixed.accessEnded]),
        el('a', { class: 'pill pill-accent', href: '/' }, ['Back to Home'])
      );
      return;
    }
    if (this.paused) {
      this.liveSync.setAttribute('role', 'region');
      this.liveSync.setAttribute('aria-label', 'Live sync');
      const reload = el('button', { type: 'button', class: 'pill pill-accent' }, ['Reload branch']);
      reload.addEventListener('click', () => void this.refresh());
      this.liveSync.append(el('p', { class: 'muted' }, [fixed.syncPaused]), reload);
      return;
    }
    this.liveSync.removeAttribute('role');
    this.liveSync.removeAttribute('aria-label');
  }

  private searchState(node: Node): 'match' | 'context' | null {
    if (this.searchResult === null) return null;
    return this.searchResult.matches.includes(node.bullet.id) ? 'match' : 'context';
  }

  private drawTree(): void {
    clear(this.treeElement);
    clear(this.stateBlock);
    this.treeElement.setAttribute('data-zoom-root', this.rootId ?? 'home');
    const filters = {
      hideCompleted: this.me.user.hideCompleted,
      search: this.searchResult
    };
    const rows = visibleRows(this.tree, filters);
    const holders = new Map<string, HTMLElement>();
    let animated = 0;
    const activeKey = this.heldCaret()?.key ?? null;
    for (const node of rows) {
      const parts = renderRow(node, this.searchState(node));
      const pending = this.pending.get(node.bullet.id);
      if (pending !== undefined) parts.text.textContent = pending.text;
      else if (node.key === activeKey) renderRowText(parts.text, node.bullet, true);
      const host =
        node.parent === null ? this.treeElement : (holders.get(node.parent.key) ?? this.treeElement);
      host.append(parts.item);
      holders.set(node.key, parts.group);
      if (node.bullet.collapsed && this.searchResult === null) parts.group.classList.add('folded');
      else if (this.unfolded.delete(node.key)) parts.group.classList.add('unfolding');
      if (this.zoomMotion !== null && !reducedMotion() && node.level === 1) {
        parts.item.style.animationDelay = `${Math.min(animated, 11) * 40}ms`;
        parts.item.classList.add(this.zoomMotion === 'in' ? 'zoom-in-row' : 'zoom-out-row');
        animated += 1;
      }
    }
    this.zoomMotion = null;
    if (rows.length === 0) this.drawEmptyState();
    this.drawHiddenNote();
    this.applySelection();
  }

  private drawEmptyState(): void {
    if (this.searchResult !== null) return;
    const atHome = this.rootId === null;
    const label = atHome ? 'Add first bullet' : 'Add bullet';
    const button = el('button', { type: 'button', class: 'pill pill-accent' }, [label]);
    button.addEventListener('click', () => void this.addFirstBullet());
    this.stateBlock.append(
      el('p', { class: 'muted' }, [atHome ? fixed.emptyHome : fixed.emptyBranch]),
      button
    );
  }

  private drawHiddenNote(): void {
    if (!this.me.user.hideCompleted || this.searchResult !== null) {
      this.hiddenNote.textContent = '';
      return;
    }
    this.hiddenNote.textContent = say.hiddenCount(hiddenCompletedCount(this.tree));
  }

  private applySelection(): void {
    for (const item of this.treeElement.querySelectorAll<HTMLElement>('.row-item')) {
      const selected = item.dataset['key'] === this.focusKey;
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
      item.classList.toggle('selected', selected);
    }
  }

  private renderNotFound(): void {
    this.link?.stop();
    clear(this.stateBlock);
    clear(this.treeElement);
    this.treeElement.hidden = true;
    this.boardElement.hidden = true;
    this.hiddenNote.textContent = '';
    clear(this.titleSlot);
    this.titleSlot.append(document.createTextNode(fixed.notFoundHeading));
    clear(this.toolbar.breadcrumb);
    this.stateBlock.append(
      el('p', { class: 'muted' }, [fixed.notFoundSentence]),
      el('a', { class: 'pill pill-accent', href: '/' }, ['Back to Home'])
    );
  }

  // ------------------------------------------------------------------ wiring

  private wireToolbar(): void {
    this.toolbar.back.addEventListener('click', () => {
      void this.flush().then(() => window.history.back());
    });
    this.toolbar.forward.addEventListener('click', () => {
      void this.flush().then(() => window.history.forward());
    });
    this.toolbar.home.addEventListener('click', () => {
      void this.flush().then(() => this.host.go(this.homePath()));
    });
    this.toolbar.search.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer);
      const value = this.toolbar.search.value;
      this.searchTimer = window.setTimeout(() => void this.runSearch(value, true), SEARCH_DELAY);
    });
    this.toolbar.search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.toolbar.search.value = '';
        void this.runSearch('', true);
      }
    });
    this.toolbar.hideCompleted.addEventListener('click', () => void this.toggleHideCompleted());
    this.toolbar.viewSwitch.addEventListener('click', () => this.toggleView());
    this.toolbar.share.addEventListener('click', () => {
      const root = this.data.root;
      if (root === null) return;
      openShareDialog(root.id, displayText(root), this.toolbar.share);
    });
    this.toolbar.download.addEventListener('click', () => this.toggleDownloadMenu());
    for (const [label, format] of [
      ['Plain text', 'text'],
      ['Markdown', 'markdown'],
      ['OPML', 'opml']
    ] as const) {
      const item = el('button', { type: 'button', role: 'menuitem', class: 'menu-item' }, [label]);
      item.addEventListener('click', () => {
        this.toolbar.downloadMenu.hidden = true;
        this.toolbar.download.setAttribute('aria-expanded', 'false');
        const root = this.rootId === null ? '' : `&root=${encodeURIComponent(this.rootId)}`;
        window.location.href = `/api/export?format=${format}${root}`;
      });
      this.toolbar.downloadMenu.append(item);
    }
    this.toolbar.undo.addEventListener('click', () => void this.undo());
    this.toolbar.redo.addEventListener('click', () => void this.redo());
    this.appBar.signOut.addEventListener('click', () => {
      void api.signOut().then(() => {
        window.location.href = '/';
      });
    });
    this.appBar.sharedButton.addEventListener('click', () => {
      const open = !this.appBar.sharedMenu.hidden;
      this.appBar.sharedMenu.hidden = open;
      this.appBar.sharedButton.setAttribute('aria-expanded', open ? 'false' : 'true');
    });
  }

  private toggleDownloadMenu(): void {
    const open = !this.toolbar.downloadMenu.hidden;
    this.toolbar.downloadMenu.hidden = open;
    this.toolbar.download.setAttribute('aria-expanded', open ? 'false' : 'true');
  }

  private wireBulletToolbar(): void {
    const run: Record<BulletAction, (node: Node) => void> = {
      Indent: (node) => void this.indent(node),
      Outdent: (node) => void this.outdent(node),
      'Move up': (node) => void this.moveStep(node, 'up'),
      'Move down': (node) => void this.moveStep(node, 'down'),
      Collapse: (node) => void this.toggleCollapse(node),
      Complete: (node) => void this.toggleComplete(node),
      'Zoom in': (node) => void this.zoomInto(node),
      'Zoom out': () => void this.zoomOut(),
      Mirror: (node) => void this.mirror(node),
      'Delete bullet': (node) => void this.remove(node)
    };
    for (const [action, button] of this.bulletToolbar.buttons) {
      button.addEventListener('click', () => {
        const node = this.focusedNode();
        if (node === null) return;
        run[action](node);
      });
    }
  }

  private wireTree(): void {
    this.treeElement.addEventListener('focusin', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('.row-item');
      const key = item?.dataset['key'];
      if (key === undefined) return;
      this.focusKey = key;
      this.applySelection();
      this.drawToolbarState();
      const target = event.target as HTMLElement;
      if (target.classList.contains('bullet-text')) {
        const node = this.tree.byKey.get(key);
        if (node !== undefined && !node.bullet.placeholder) renderRowText(target, node.bullet, true);
      }
    });
    this.treeElement.addEventListener('focusout', (event) => {
      const target = event.target as HTMLElement;
      if (!target.classList.contains('bullet-text')) return;
      const item = target.closest<HTMLElement>('.row-item');
      const key = item?.dataset['key'];
      const node = key === undefined ? undefined : this.tree.byKey.get(key);
      void this.flush();
      if (node !== undefined) renderRowText(target, node.bullet, false);
      this.suggestions.close();
    });
    this.treeElement.addEventListener('input', (event) => {
      const target = event.target as HTMLElement;
      if (!target.classList.contains('bullet-text')) return;
      const item = target.closest<HTMLElement>('.row-item');
      const id = item?.dataset['bulletId'];
      if (id === undefined) return;
      this.queueSave(id, textOf(target));
      void this.offerSuggestions(target);
    });
    let swipe: { x: number; y: number; key: string } | null = null;
    this.treeElement.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch') return;
      const key = (event.target as HTMLElement).closest<HTMLElement>('.row-item')?.dataset['key'];
      swipe = key === undefined ? null : { x: event.clientX, y: event.clientY, key };
    });
    this.treeElement.addEventListener('pointerup', (event) => {
      if (swipe === null || event.pointerType !== 'touch') return;
      const start = swipe;
      swipe = null;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx)) return;
      const node = this.tree.byKey.get(start.key);
      if (node === undefined) return;
      event.preventDefault();
      this.focusKey = start.key;
      if (dx > 0) void this.indent(node);
      else void this.outdent(node);
    });
    this.treeElement.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const disclosure = target.closest<HTMLElement>('.disclosure');
      if (disclosure !== null) {
        event.preventDefault();
        const key = disclosure.closest<HTMLElement>('.row-item')?.dataset['key'];
        const node = key === undefined ? undefined : this.tree.byKey.get(key);
        if (node !== undefined) void this.toggleCollapse(node);
        return;
      }
      if (target.closest('.bullet-dot') !== null || target.closest('.bullet-text') !== null) return;
      const key = target.closest<HTMLElement>('.row-item')?.dataset['key'];
      if (key !== undefined) this.focusNode(key, 'end');
    });
  }

  private wireKeys(): void {
    document.addEventListener('keydown', (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement;
      if (target.closest('.share-dialog') !== null) return;
      event.preventDefault();
      if (event.shiftKey) void this.redo();
      else void this.undo();
    });
    document.addEventListener('keydown', (event) => {
      if (!event.altKey || event.key !== 'ArrowLeft') return;
      if ((event.target as HTMLElement).closest('.dialog') !== null) return;
      event.preventDefault();
      void this.zoomOut();
    });
    this.titleSlot.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'Enter') return;
      event.preventDefault();
      const first = this.tree.roots[0];
      if (first === undefined) return;
      void this.flush().then(() => this.focusNode(first.key, 'end'));
    });
    this.treeElement.addEventListener('keydown', (event) => this.onTreeKey(event));
  }

  // ------------------------------------------------------------------- typing

  private queueSave(bulletId: string, text: string): void {
    const seen = this.pending.get(bulletId);
    const revision =
      seen?.revision ??
      this.nodeById(bulletId)?.bullet.revision ??
      this.data.root?.revision ??
      1;
    this.pending.set(bulletId, { text, revision });
    window.clearTimeout(this.saveTimers.get(bulletId) ?? 0);
    this.saveTimers.set(
      bulletId,
      window.setTimeout(() => void this.saveText(bulletId), SAVE_DELAY)
    );
  }

  /** Saves every pending text edit, which happens before any zoom or navigation. */
  async flush(): Promise<void> {
    for (const id of [...this.pending.keys()]) await this.saveText(id);
  }

  private async saveText(bulletId: string): Promise<void> {
    const held = this.pending.get(bulletId);
    if (held === undefined) return;
    this.pending.delete(bulletId);
    window.clearTimeout(this.saveTimers.get(bulletId) ?? 0);
    const { text, revision } = held;
    try {
      const result = await api.patch(bulletId, { text, revision });
      this.ownSeqs.add(result.seq);
      this.link?.seen(result.seq);
      for (const held of this.tree.byId.get(bulletId) ?? []) held.bullet = result.bullet;
      if (this.data.root !== null && this.data.root.id === bulletId) {
        this.data.root = result.bullet;
      }
    } catch (error) {
      const failure = failureOf(error);
      if (failure === null) {
        // the connection is gone: keep the text and the revision, and try again
        this.pending.set(bulletId, held);
        this.saveTimers.set(
          bulletId,
          window.setTimeout(() => void this.saveText(bulletId), SAVE_DELAY)
        );
        alertNow(alerts.saveFailed);
        return;
      }
      if (failure.error === 'stale_revision' && failure.current !== undefined) {
        const current = failure.current;
        for (const held of this.tree.byId.get(bulletId) ?? []) {
          held.bullet = { ...held.bullet, text: current.text, revision: current.revision };
        }
        if (this.data.root !== null && this.data.root.id === bulletId) {
          this.data.root = { ...this.data.root, text: current.text, revision: current.revision };
        }
        const held = this.heldCaret();
        this.render();
        this.restoreCaret(held);
        if (failure.message !== undefined) alertNow(failure.message);
        return;
      }
      if (failure.errors?.['text'] !== undefined) {
        alertNow(failure.errors['text']);
        return;
      }
      if (failure.status >= 500) alertNow(alerts.saveFailed);
    }
  }

  private async offerSuggestions(target: HTMLElement): Promise<void> {
    const token = ++this.suggestToken;
    const offset = caretOffset(target);
    const before = textOf(target).slice(0, offset);
    const match = /(^|\s)([#@])([A-Za-z0-9_-]*)$/.exec(before);
    if (match === null) {
      this.suggestions.close();
      return;
    }
    const kind = match[2] === '#' ? 'tag' : 'mention';
    const prefix = match[3] ?? '';
    const result = await api.suggest(kind, prefix, this.rootId);
    if (token !== this.suggestToken) return;
    if (result.suggestions.length === 0) {
      this.suggestions.close();
      return;
    }
    const start = offset - (prefix.length + 1);
    this.suggestions.open(target, result.suggestions, (value) => {
      const text = textOf(target);
      const next = `${text.slice(0, start)}${value} ${text.slice(offset)}`;
      target.textContent = next;
      placeCaret(target, start + value.length + 1);
      this.queueSave(this.idOf(target) ?? '', next);
    });
  }

  private idOf(target: HTMLElement): string | null {
    return target.closest<HTMLElement>('.row-item')?.dataset['bulletId'] ?? null;
  }

  // ------------------------------------------------------------------ actions

  private visibleOrder(): Node[] {
    return visibleRows(this.tree, {
      hideCompleted: this.me.user.hideCompleted,
      search: this.searchResult
    });
  }

  private focusNode(key: string, caret: 'end' | 'start'): void {
    this.focusKey = key;
    const text = this.textElementFor(key);
    if (text === null) return;
    text.focus();
    if (caret === 'end') caretToEnd(text);
    else placeCaret(text, 0);
    this.applySelection();
    this.drawToolbarState();
  }

  private focusById(bulletId: string, caret: 'end' | 'start' = 'end'): void {
    const node = this.nodeById(bulletId);
    if (node === null) return;
    this.focusNode(node.key, caret);
  }

  private async withRefresh(work: () => Promise<number>): Promise<boolean> {
    try {
      const seq = await work();
      this.ownSeqs.add(seq);
      this.link?.seen(seq);
      await this.refresh();
      return true;
    } catch (error) {
      const failure = failureOf(error);
      if (failure?.message !== undefined) alertNow(failure.message);
      else if (failure?.errors !== undefined) {
        const first = Object.values(failure.errors)[0];
        if (first !== undefined) alertNow(first);
      }
      return false;
    }
  }

  private async addFirstBullet(): Promise<void> {
    const parentId = this.rootId;
    const created = await api.create({ parentId, afterId: null, text: '' });
    this.ownSeqs.add(created.seq);
    this.link?.seen(created.seq);
    await this.refresh();
    this.focusById(created.bullet.id);
  }

  private async addSibling(node: Node, where: 'below' | 'above'): Promise<void> {
    await this.flush();
    const parentId = node.bullet.parentId ?? this.rootId;
    const siblings = siblingsOf(this.tree, node);
    const index = indexOf(this.tree, node);
    const afterId =
      where === 'below'
        ? node.bullet.id
        : (siblings[index - 1]?.bullet.id ?? null);
    const created = await api.create({ parentId, afterId, text: '' });
    this.ownSeqs.add(created.seq);
    this.link?.seen(created.seq);
    await this.refresh();
    if (where === 'below') this.focusById(created.bullet.id);
    else this.focusById(node.bullet.id);
  }

  private async splitBullet(node: Node, offset: number): Promise<void> {
    const held = this.pending.get(node.bullet.id);
    const text = held?.text ?? node.bullet.text;
    const revision = held?.revision ?? node.bullet.revision;
    this.pending.delete(node.bullet.id);
    const head = text.slice(0, offset);
    const tail = text.slice(offset);
    const created = await api.create({
      parentId: node.bullet.parentId ?? this.rootId,
      afterId: node.bullet.id,
      text: tail,
      splitFrom: { id: node.bullet.id, text: head, revision }
    });
    this.ownSeqs.add(created.seq);
    this.link?.seen(created.seq);
    await this.refresh();
    this.focusById(created.bullet.id, 'start');
  }

  private async indent(node: Node): Promise<void> {
    await this.flush();
    if (indexOf(this.tree, node) === 0) {
      alertNow(alerts.noPreviousSibling);
      return;
    }
    const id = node.bullet.id;
    const done = await this.withRefresh(async () => (await api.move(id, { op: 'indent' })).seq);
    if (!done) return;
    const moved = this.nodeById(id);
    if (moved !== null) {
      this.focusById(id);
      const parent = this.parentTextOf(moved);
      announce(say.indented(parent ?? 'top level'));
    }
  }

  private async outdent(node: Node): Promise<void> {
    await this.flush();
    if (node.level === 1) {
      alertNow(alerts.atTop);
      return;
    }
    const id = node.bullet.id;
    const done = await this.withRefresh(async () => (await api.move(id, { op: 'outdent' })).seq);
    if (!done) return;
    const moved = this.nodeById(id);
    if (moved !== null) {
      this.focusById(id);
      const parent = this.parentTextOf(moved);
      announce(parent === null ? say.outdentedTopLevel : say.outdented(parent));
    }
  }

  private async moveStep(node: Node, direction: 'up' | 'down'): Promise<void> {
    await this.flush();
    const index = indexOf(this.tree, node);
    const siblings = siblingsOf(this.tree, node);
    if (node.level === 1) {
      if (direction === 'up' && index === 0) {
        alertNow(alerts.atFirst);
        return;
      }
      if (direction === 'down' && index === siblings.length - 1) {
        alertNow(alerts.atLast);
        return;
      }
    }
    const id = node.bullet.id;
    const done = await this.withRefresh(async () => (await api.move(id, { op: direction })).seq);
    if (!done) return;
    this.focusById(id);
    this.announceMove(id);
  }

  private announceMove(bulletId: string): void {
    const moved = this.nodeById(bulletId);
    if (moved === null) return;
    const siblings = siblingsOf(this.tree, moved);
    const position = indexOf(this.tree, moved) + 1;
    const parent = this.parentTextOf(moved);
    announce(
      parent === null
        ? say.movedTopLevel(position, siblings.length)
        : say.moved(position, siblings.length, parent)
    );
  }

  private async moveTo(bulletId: string, parentId: string, index: number): Promise<boolean> {
    const done = await this.withRefresh(
      async () => (await api.move(bulletId, { parentId, index })).seq
    );
    return done;
  }

  private async toggleComplete(node: Node): Promise<void> {
    const id = node.bullet.id;
    const next = !node.bullet.completed;
    const name = displayText(node.bullet);
    const done = await this.withRefresh(
      async () => (await api.patch(id, { completed: next })).seq
    );
    if (!done) return;
    this.focusById(id);
    announce(next ? say.completed(name) : say.notCompleted(name));
  }

  private async toggleCollapse(node: Node): Promise<void> {
    const id = node.bullet.id;
    const key = node.key;
    const next = !node.bullet.collapsed;
    const name = displayText(node.bullet);
    const held = this.tree.byKey.get(key);
    if (held !== undefined) held.bullet = { ...held.bullet, collapsed: next };
    if (!next) this.unfolded.add(key);
    this.drawTree();
    this.focusNode(key, 'end');
    announce(next ? say.collapsed(name) : say.expanded(name));
    try {
      const result = await api.patch(id, { collapsed: next });
      this.ownSeqs.add(result.seq);
      this.link?.seen(result.seq);
    } catch {
      alertNow(alerts.saveFailed);
    }
  }

  private async mirror(node: Node): Promise<void> {
    await this.flush();
    const name = displayText(node.bullet);
    let copyId = '';
    const done = await this.withRefresh(async () => {
      const result = await api.mirror(node.bullet.id);
      copyId = result.bullet.id;
      return result.seq;
    });
    if (!done) return;
    this.focusById(copyId);
    announce(say.mirrored(name));
  }

  private async remove(node: Node): Promise<void> {
    if (node.bullet.mirrorOf !== null) {
      await this.deleteNow(node, say.copyRemoved(displayText(node.bullet)));
      return;
    }
    const inside = this.countInside(node);
    if (inside > 0) {
      openDeleteDialog(displayText(node.bullet), inside, () => {
        void this.deleteNow(node, say.trashed(displayText(node.bullet)));
      }, this.textElementFor(node.key) ?? this.treeElement);
      return;
    }
    await this.deleteNow(node, say.trashed(displayText(node.bullet)));
  }

  private countInside(node: Node): number {
    let count = 0;
    const walk = (nodes: Node[]): void => {
      for (const child of nodes) {
        count += 1;
        walk(child.children);
      }
    };
    walk(node.children);
    return count;
  }

  private async deleteNow(node: Node, message: string): Promise<void> {
    const order = this.visibleOrder();
    const at = order.findIndex((row) => row.key === node.key);
    const neighbour = order[at - 1] ?? order[at + 1] ?? null;
    const neighbourId = neighbour?.bullet.id ?? null;
    const done = await this.withRefresh(async () => (await api.remove(node.bullet.id)).seq);
    if (!done) return;
    announce(message);
    if (neighbourId !== null) this.focusById(neighbourId);
  }

  private async backspaceDelete(node: Node): Promise<void> {
    if (node.bullet.childCount > 0) {
      alertNow(alerts.backspaceWithChildren);
      return;
    }
    const order = this.visibleOrder();
    const at = order.findIndex((row) => row.key === node.key);
    const above = order[at - 1] ?? null;
    const aboveId = above?.bullet.id ?? null;
    this.pending.delete(node.bullet.id);
    const done = await this.withRefresh(async () => (await api.remove(node.bullet.id)).seq);
    if (!done) return;
    announce(say.emptyDeleted);
    if (aboveId !== null) this.focusById(aboveId);
  }

  private async zoomInto(node: Node): Promise<void> {
    await this.flush();
    this.zoomMotion = 'in';
    this.host.go(`/b/${node.bullet.id}`);
  }

  private async zoomOut(): Promise<void> {
    await this.flush();
    if (this.rootId === null) return;
    const shareRoot = this.shareRootId();
    if (this.rootId === shareRoot) return;
    const zoomedId = this.rootId;
    const parent = this.data.ancestors[this.data.ancestors.length - 1] ?? null;
    this.zoomMotion = 'out';
    const target = parent === null ? this.homePath() : `/b/${parent.id}`;
    this.pendingFocusId = zoomedId;
    this.host.go(target);
  }

  /** After zooming out, focus returns to the row of the bullet that was zoomed. */
  private focusZoomedRow(): void {
    if (this.pendingFocusId === null) return;
    const node = this.nodeById(this.pendingFocusId);
    this.pendingFocusId = null;
    if (node !== null) this.focusNode(node.key, 'end');
  }

  private async undo(): Promise<void> {
    await this.flush();
    try {
      const result = await api.undo(this.shareRootId());
      this.ownSeqs.add(result.seq);
      this.link?.seen(result.seq);
      await this.refresh();
      announce(say.undid(result.step));
    } catch (error) {
      const failure = failureOf(error);
      if (failure?.message !== undefined) alertNow(failure.message);
    }
  }

  private async redo(): Promise<void> {
    await this.flush();
    try {
      const result = await api.redo(this.shareRootId());
      this.ownSeqs.add(result.seq);
      this.link?.seen(result.seq);
      await this.refresh();
      announce(say.redid(result.step));
    } catch (error) {
      const failure = failureOf(error);
      if (failure?.message !== undefined) alertNow(failure.message);
    }
  }

  private async toggleHideCompleted(): Promise<void> {
    const next = !this.me.user.hideCompleted;
    this.me = await api.setHideCompleted(next);
    this.render();
    announce(next ? say.hiddenCount(hiddenCompletedCount(this.tree)) : say.showingCompleted);
  }

  private toggleView(): void {
    this.boardView = !this.boardView;
    const path = this.rootId === null ? '/' : `/b/${this.rootId}`;
    this.host.go(this.boardView ? `${path}?view=board` : path);
  }

  private async runSearch(query: string, speak: boolean): Promise<void> {
    const trimmed = query.trim();
    this.toolbar.searchError.textContent = '';
    if (trimmed === '') {
      this.searchResult = null;
      this.toolbar.searchCount.textContent = '';
      this.render();
      return;
    }
    try {
      this.searchResult = await api.search(trimmed, this.rootId);
    } catch (error) {
      const failure = failureOf(error);
      if (failure?.errors?.['q'] !== undefined) this.toolbar.searchError.textContent = failure.errors['q'];
      return;
    }
    this.toolbar.searchCount.textContent = say.searchCount(this.searchResult.count);
    this.render();
    if (speak) announce(say.searchCount(this.searchResult.count));
  }

  // --------------------------------------------------------------------- keys

  private onTreeKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const item = target.closest<HTMLElement>('.row-item');
    const key = item?.dataset['key'];
    const node = key === undefined ? undefined : this.tree.byKey.get(key);
    if (node === undefined) return;
    const editing = target.classList.contains('bullet-text');

    if (this.suggestions.isOpen()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.suggestions.move(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        this.suggestions.take();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.suggestions.close();
        return;
      }
    }

    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      void this.zoomInto(node);
      return;
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'm') {
      event.preventDefault();
      void this.mirror(node);
      return;
    }
    if (event.ctrlKey && event.shiftKey && event.key === 'Backspace') {
      event.preventDefault();
      void this.remove(node);
      return;
    }
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      void this.toggleComplete(node);
      return;
    }
    if (event.ctrlKey && (event.key === ' ' || event.key === 'Spacebar')) {
      event.preventDefault();
      void this.toggleCollapse(node);
      return;
    }
    if (event.ctrlKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      void this.moveStep(node, event.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    if (event.key === 'Tab' && editing) {
      event.preventDefault();
      if (event.shiftKey) void this.outdent(node);
      else void this.indent(node);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!editing) {
        void this.addSibling(node, 'below');
        return;
      }
      const text = textOf(target);
      const offset = caretOffset(target);
      if (offset >= text.length) void this.addSibling(node, 'below');
      else if (offset === 0 && text.length > 0) void this.addSibling(node, 'above');
      else void this.splitBullet(node, offset);
      return;
    }
    if (event.key === 'Backspace' && editing) {
      const text = textOf(target);
      if (text === '' && selectionIsCollapsed()) {
        event.preventDefault();
        void this.backspaceDelete(node);
      }
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const order = this.visibleOrder();
      const at = order.findIndex((row) => row.key === node.key);
      const next = order[at + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next !== undefined) this.focusNode(next.key, 'end');
      return;
    }
    if (event.key === 'Escape' && editing) {
      event.preventDefault();
      item?.focus();
    }
  }
}
