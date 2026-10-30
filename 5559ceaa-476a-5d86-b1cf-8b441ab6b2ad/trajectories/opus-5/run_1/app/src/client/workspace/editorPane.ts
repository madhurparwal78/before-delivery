import { copy } from '../copy.js';
import { clear, el, on, prefersReducedMotion } from '../dom.js';
import { api, RequestFailed } from '../net.js';
import type { StatusBoard } from './status.js';
import type { OpenFile, WorkspaceStore } from './store.js';

const LINE_HEIGHT = 20;
const SAVE_DELAY_MS = 400;

interface TreeNode {
  label: string;
  path: string;
  folder: boolean;
  depth: number;
  fileId: string | null;
}

function treeRows(paths: { path: string; id: string }[], expanded: Set<string>): TreeNode[] {
  const folders = new Set<string>();
  for (const file of paths) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      folders.add(parts.slice(0, index).join('/'));
    }
  }
  const rows: TreeNode[] = [];
  const visit = (prefix: string, depth: number): void => {
    const here = [...folders]
      .filter((folder) => folder.slice(0, folder.lastIndexOf('/') + 1) === prefix)
      .sort();
    for (const folder of here) {
      rows.push({
        label: folder.slice(prefix.length),
        path: folder,
        folder: true,
        depth,
        fileId: null,
      });
      if (expanded.has(folder)) visit(`${folder}/`, depth + 1);
    }
    for (const file of paths
      .filter((item) => item.path.slice(0, item.path.lastIndexOf('/') + 1) === prefix)
      .sort((a, b) => a.path.localeCompare(b.path))) {
      rows.push({
        label: file.path.slice(prefix.length),
        path: file.path,
        folder: false,
        depth,
        fileId: file.id,
      });
    }
  };
  visit('', 0);
  return rows;
}

export interface EditorPane {
  readonly showFilesButton: HTMLButtonElement;
  readonly filesPanel: HTMLElement;
  readonly fileActions: HTMLElement;
  readonly main: HTMLElement;
  readonly codeArea: HTMLTextAreaElement;
  applyLayout(): void;
  stopFollowing(): void;
  startFollowing(userId: string): Promise<void>;
  describe(): void;
}

export function createEditorPane(
  store: WorkspaceStore,
  statuses: StatusBoard,
  hooks: { onFollowChange: () => void },
): EditorPane {
  const tree = el('div', { role: 'tree', 'aria-label': 'Files' });
  const fileActions = el('div', { class: 'file-actions' });
  const filesPanel = el('div', { class: 'files-panel' }, [tree, fileActions]);
  const showFilesButton = el('button', { type: 'button', class: 'show-files quiet' }, [
    'Show files',
  ]);

  const tablist = el('div', { role: 'tablist', 'aria-label': 'Open files' });
  const lineNumbers = el('div', { class: 'line-numbers' });
  const writeStripe = el('div', { class: 'write-stripe' });
  const gutter = el('div', { class: 'gutter', 'aria-hidden': 'true' }, [lineNumbers, writeStripe]);
  const codeArea = el('textarea', {
    'aria-label': 'Code editor',
    spellcheck: 'false',
    wrap: 'off',
  });
  const carets = el('div', { class: 'carets', 'aria-hidden': 'true' });
  const codeScroll = el('div', { class: 'code-scroll' }, [codeArea, carets]);
  const editorStatus = statuses.create('Editor status', 'editor-status');
  const main = el('div', { class: 'editor-main' }, [
    tablist,
    el('div', { class: 'code-area' }, [gutter, codeScroll]),
    editorStatus,
  ]);

  let saveTimer = 0;
  let escaped = false;

  const current = (): OpenFile | undefined =>
    store.activeFileId === null ? undefined : store.open.get(store.activeFileId);

  function charWidth(): number {
    const probe = el('span', {}, ['0'.repeat(10)]);
    probe.style.cssText =
      'position:absolute;visibility:hidden;font-family:var(--mono);font-size:13px';
    codeScroll.append(probe);
    const width = probe.getBoundingClientRect().width / 10;
    probe.remove();
    return width;
  }

  function renderGutter(): void {
    const text = current()?.text ?? '';
    const lines = text.split('\n').length;
    clear(lineNumbers);
    clear(writeStripe);
    const driverTint = store.driverId === null ? null : store.tintOf(store.driverId);
    for (let line = 1; line <= lines; line += 1) {
      lineNumbers.append(el('div', {}, [String(line)]));
      const segment = el('span', {});
      segment.style.background = store.driverId === null ? 'var(--grey)' : (driverTint ?? '');
      writeStripe.append(segment);
    }
    gutter.scrollTop = codeArea.scrollTop;
  }

  /** Recolours the stripe to amber line by line, from the top visible line down. */
  function paintStripe(immediate: boolean): void {
    const segments = [...writeStripe.children] as HTMLElement[];
    const first = Math.floor(codeArea.scrollTop / LINE_HEIGHT);
    const last = Math.min(
      segments.length - 1,
      first + Math.ceil(codeArea.clientHeight / LINE_HEIGHT),
    );
    const visible = Math.max(1, last - first + 1);
    segments.forEach((segment, index) => {
      if (index < first || index > last) {
        segment.style.background = 'var(--amber)';
        return;
      }
      const delay = immediate ? 0 : ((index - first) / visible) * 170;
      window.setTimeout(() => {
        segment.style.background = 'var(--amber)';
      }, delay);
    });
  }

  function renderCarets(): void {
    clear(carets);
    const width = charWidth();
    for (const [userId, cursor] of store.cursors) {
      if (userId === store.user.id) continue;
      if (cursor.file_id !== store.activeFileId) continue;
      const caret = el('div', {
        class: userId === store.driverId ? 'caret' : 'caret viewer',
      });
      caret.style.color = store.tintOf(userId);
      caret.style.background = userId === store.driverId ? store.tintOf(userId) : 'transparent';
      caret.style.left = `${8 + cursor.column * width - codeArea.scrollLeft}px`;
      caret.style.top = `${8 + cursor.line * LINE_HEIGHT - codeArea.scrollTop}px`;
      carets.append(caret);
    }
  }

  function renderTree(): void {
    for (const file of store.files) {
      const parts = file.path.split('/');
      for (let index = 1; index < parts.length; index += 1) {
        store.expandedFolders.add(parts.slice(0, index).join('/'));
      }
    }
    const rows = treeRows(
      store.files.map((file) => ({ path: file.path, id: file.id })),
      store.expandedFolders,
    );
    if (store.selectedPath !== null && !rows.some((row) => row.path === store.selectedPath)) {
      store.selectedPath = null;
    }
    const selected = store.selectedPath ?? rows[0]?.path ?? null;
    clear(tree);
    for (const row of rows) {
      const item = el(
        'div',
        {
          role: 'treeitem',
          class: row.folder ? 'folder' : 'file',
          'aria-selected': String(row.path === selected),
          'aria-level': String(row.depth + 1),
          tabindex: row.path === selected ? '0' : '-1',
          'data-path': row.path,
          'data-file': row.fileId,
          ...(row.folder ? { 'aria-expanded': String(store.expandedFolders.has(row.path)) } : {}),
        },
        [row.label],
      );
      item.style.paddingLeft = `${0.2 + row.depth * 0.7}rem`;
      on(item, 'click', () => {
        store.selectedPath = row.path;
        if (row.folder) toggleFolder(row.path);
        else if (row.fileId !== null) void store.openFile(row.fileId);
        store.emit('tree');
      });
      tree.append(item);
    }
  }

  function toggleFolder(path: string): void {
    if (store.expandedFolders.has(path)) store.expandedFolders.delete(path);
    else store.expandedFolders.add(path);
  }

  on(tree, 'keydown', (event) => {
    const rows = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const index = rows.findIndex((row) => row.getAttribute('tabindex') === '0');
    const row = rows[index];
    if (row === undefined) return;
    const path = row.dataset['path'] ?? '';
    const move = (next: number): void => {
      const target = rows[next];
      if (target === undefined) return;
      event.preventDefault();
      store.selectedPath = target.dataset['path'] ?? null;
      store.emit('tree');
      tree.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'ArrowRight' && row.classList.contains('folder')) {
      event.preventDefault();
      store.expandedFolders.add(path);
      store.emit('tree');
      tree.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    } else if (event.key === 'ArrowLeft' && row.classList.contains('folder')) {
      event.preventDefault();
      store.expandedFolders.delete(path);
      store.emit('tree');
      tree.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    } else if (event.key === 'Enter') {
      const fileId = row.dataset['file'];
      if (fileId !== undefined && fileId !== 'null') {
        event.preventDefault();
        void store.openFile(fileId);
      }
    }
  });

  function renderTabs(): void {
    clear(tablist);
    for (const id of store.open.keys()) {
      const path = store.pathOf(id);
      const active = id === store.activeFileId;
      const close = el(
        'button',
        { type: 'button', class: 'close', tabindex: '-1', 'aria-label': `Close ${path}` },
        ['×'],
      );
      on(close, 'click', (event) => {
        event.stopPropagation();
        store.closeFile(id);
      });
      const tab = el(
        'button',
        {
          type: 'button',
          role: 'tab',
          'aria-selected': String(active),
          'aria-label': path,
          tabindex: active ? '0' : '-1',
          'data-file': id,
        },
        [el('span', {}, [path]), close],
      );
      on(tab, 'click', () => void store.openFile(id));
      tablist.append(tab);
    }
  }

  on(tablist, 'keydown', (event) => {
    const tabs = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')];
    const index = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step !== 0) {
      const target = tabs[index + step];
      if (target !== undefined) {
        event.preventDefault();
        void store.openFile(target.dataset['file'] ?? '');
        window.setTimeout(() => tablist.querySelector<HTMLElement>('[tabindex="0"]')?.focus(), 0);
      }
      return;
    }
    if (event.key === 'Delete') {
      const target = tabs[index];
      if (target !== undefined) {
        event.preventDefault();
        store.closeFile(target.dataset['file'] ?? '');
      }
    }
  });

  function renderCode(): void {
    const file = current();
    codeArea.value = file?.text ?? '';
    const writable = store.mayWrite && file !== undefined;
    codeArea.readOnly = !writable;
    codeArea.setAttribute('aria-readonly', String(!writable));
    renderGutter();
    renderCarets();
    if (store.isDriving) paintStripe(true);
    describeEditor();
  }

  function describeEditor(): void {
    if (store.removed) {
      statuses.error('Editor status', copy.editor.removed);
      return;
    }
    if (store.following !== null) {
      const cursor = store.cursors.get(store.following);
      const path = cursor === undefined ? store.pathOf(store.activeFileId) : cursor.path;
      statuses.set('Editor status', copy.editor.following(store.nameOf(store.following), path));
      return;
    }
    const running = store.sessions.find(
      (item) => item.state === 'live' || item.state === 'paused',
    );
    if (running?.state === 'paused') {
      statuses.set('Editor status', copy.editor.paused);
      return;
    }
    if (running?.state === 'live' && running.driver_id !== store.user.id) {
      statuses.set('Editor status', copy.editor.viewing(store.nameOf(running.driver_id)));
      return;
    }
    statuses.set('Editor status', copy.editor.saved);
  }

  async function save(): Promise<void> {
    const file = current();
    if (file === undefined || !file.dirty) return;
    const path = store.pathOf(file.id);
    statuses.set('Editor status', copy.editor.saving);
    try {
      const saved = await api<{ file: { revision: number } }>(
        `/api/projects/${store.projectId}/files/${file.id}`,
        { method: 'PUT', body: { content: file.text, base_revision: file.revision } },
      );
      file.revision = saved.file.revision;
      file.dirty = false;
      statuses.set('Editor status', copy.editor.saved);
    } catch (cause) {
      if (!(cause instanceof RequestFailed)) throw cause;
      if (cause.code === 'stale_revision') {
        await store.openFile(file.id);
        statuses.error('Editor status', copy.editor.stale(path));
        return;
      }
      if (cause.code === 'validation') {
        statuses.error('Editor status', copy.editor.tooLarge(path));
        return;
      }
      if (cause.code === 'not_found') {
        statuses.error('Editor status', copy.editor.deleted(path));
        return;
      }
      describeEditor();
    }
  }

  on(codeArea, 'input', () => {
    const file = current();
    if (file === undefined) return;
    file.text = codeArea.value;
    file.dirty = true;
    renderGutter();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), SAVE_DELAY_MS);
  });

  on(codeArea, 'keydown', (event) => {
    if (event.key === 'Escape') {
      escaped = true;
      if (store.following !== null) stopFollowing();
      return;
    }
    if (event.key === 'Tab' && !escaped) {
      event.preventDefault();
      const at = codeArea.selectionStart;
      codeArea.setRangeText('  ', at, codeArea.selectionEnd, 'end');
      codeArea.dispatchEvent(new Event('input'));
      return;
    }
    if (store.following !== null && event.key.length === 1) stopFollowing();
  });

  on(codeArea, 'focus', () => {
    escaped = false;
  });

  on(codeArea, 'mousedown', () => {
    if (store.following !== null) stopFollowing();
  });

  const reportCursor = (): void => {
    const file = current();
    if (file === undefined) return;
    const before = codeArea.value.slice(0, codeArea.selectionStart).split('\n');
    store.send({
      type: 'cursor',
      file_id: file.id,
      line: before.length - 1,
      column: (before[before.length - 1] ?? '').length,
    });
  };

  on(codeArea, 'keyup', reportCursor);
  on(codeArea, 'click', reportCursor);
  on(codeArea, 'scroll', () => {
    gutter.scrollTop = codeArea.scrollTop;
    renderCarets();
  });

  function stopFollowing(): void {
    if (store.following === null) return;
    store.following = null;
    hooks.onFollowChange();
    describeEditor();
  }

  async function startFollowing(userId: string): Promise<void> {
    store.following = userId;
    hooks.onFollowChange();
    const cursor = store.cursors.get(userId);
    if (cursor !== undefined) await store.openFile(cursor.file_id);
    describeEditor();
    scrollToFollowed();
  }

  function scrollToFollowed(): void {
    if (store.following === null) return;
    const cursor = store.cursors.get(store.following);
    if (cursor === undefined || cursor.file_id !== store.activeFileId) return;
    const top = cursor.line * LINE_HEIGHT;
    if (top < codeArea.scrollTop || top > codeArea.scrollTop + codeArea.clientHeight - LINE_HEIGHT) {
      codeArea.scrollTop = Math.max(0, top - codeArea.clientHeight / 2);
    }
  }

  function applyLayout(): void {
    const overlay = store.band !== 'wide';
    showFilesButton.hidden = !overlay;
    filesPanel.hidden = overlay && !store.filesOverlayOpen;
    showFilesButton.setAttribute('aria-expanded', String(!filesPanel.hidden));
  }

  on(showFilesButton, 'click', () => {
    store.filesOverlayOpen = !store.filesOverlayOpen;
    applyLayout();
  });

  on(document, 'mousedown', (event) => {
    if (store.band === 'wide' || !store.filesOverlayOpen) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (filesPanel.contains(target) || showFilesButton.contains(target)) return;
    store.filesOverlayOpen = false;
    applyLayout();
  });

  store.on('tree', renderTree);
  store.on('tabs', renderTabs);
  store.on('cursors', () => {
    renderCarets();
    if (store.following !== null) {
      scrollToFollowed();
      describeEditor();
    }
  });
  store.on('code', renderCode);
  store.on('baton', () => {
    const file = current();
    const writable = store.mayWrite && file !== undefined;
    codeArea.readOnly = !writable;
    codeArea.setAttribute('aria-readonly', String(!writable));
    renderGutter();
    if (store.isDriving) paintStripe(prefersReducedMotion());
    renderCarets();
    describeEditor();
  });
  store.on('access', describeEditor);
  store.on('layout', applyLayout);

  return {
    showFilesButton,
    filesPanel,
    fileActions,
    main,
    codeArea,
    applyLayout,
    stopFollowing,
    startFollowing,
    describe: describeEditor,
  };
}
