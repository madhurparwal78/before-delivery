import { announce, api, TIMERS, prefersReducedMotion, qsa, focusable, trapFocus, qs } from './core';
import { initTheme } from './theme';

interface PageJson {
  id: string; versionId: string; path: string; title: string; kind: string;
  operationId: string | null; source: string; revision: number; state: string;
  hasDraftChanges: boolean; updatedAt: string; updatedBy: { id: string; name: string };
}

interface NavigationJson {
  versionId: string;
  tabs: { id: string; title: string; groups: { id: string; title: string; pages: string[] }[] }[];
  redirects: { from: string; to: string; kind: string }[];
}

interface PublishReport {
  versionId: string; status: string; publishedAt: string | null; snapshotId: string | null;
  errors: { file: string; line: number; code: string; message: string }[];
}

interface PageMeta { id: string; path: string; title: string }

const state = {
  siteSlug: '', versionSlug: '', versionId: '', siteId: '',
  pageId: '', page: null as PageJson | null,
  navigation: null as NavigationJson | null,
  pages: new Map<string, PageMeta>(),
  groups: new Map<string, { id: string; title: string; tabId: string }>(),
  tabs: [] as { id: string; title: string }[],
  role: 'viewer' as string,
  saveTimer: undefined as number | undefined,
  saving: false,
  conflict: false,
  lastFocusedRow: null as string | null,
  sourceLoaded: '',
  es: null as EventSource | null,
};

const editor = qs<HTMLTextAreaElement>('#editor');
const titleField = qs<HTMLInputElement>('[data-title-field]');
const saveStatus = qs<HTMLElement>('[data-save-status]');
const tree = qs<HTMLElement>('[data-tree]');

function initMeta(): void {
  const body = document.body.dataset;
  state.siteSlug = body.siteSlug ?? '';
  state.versionSlug = body.versionSlug ?? '';
  state.versionId = body.versionId ?? '';
  state.siteId = body.siteId ?? '';
  state.pageId = body.pageId ?? '';
  state.role = body.role ?? 'viewer';
}

async function loadNavigation(): Promise<void> {
  const res = await api<NavigationJson>('GET', `/api/versions/${state.versionId}/navigation`);
  if (res.data) {
    state.navigation = res.data;
    rebuildTree();
  }
}

async function loadPage(): Promise<void> {
  if (!state.pageId) return;
  const res = await api<PageJson>('GET', `/api/pages/${state.pageId}`);
  if (!res.data) return;
  state.page = res.data;
  if (editor && state.role !== 'viewer') editor.value = res.data.source;
  if (titleField) titleField.value = res.data.title;
  state.sourceLoaded = res.data.source;
  renderGutter();
  renderProofMargin();
}

function renderGutter(): void {
  const gutter = qs('[data-gutter]');
  if (!gutter || !editor) return;
  const lines = editor.value.split('\n').length;
  gutter.textContent = '';
  for (let i = 1; i <= lines; i++) {
    const span = document.createElement('span');
    span.dataset.line = String(i);
    span.textContent = String(i);
    gutter.append(span);
  }
}

// ---------- Tree ----------
type Row = { id: string; kind: 'tab' | 'group' | 'page'; title: string; pageId?: string; groupId?: string; tabId?: string; parentId: string | null; depth: number; expanded: boolean };

let rows: Row[] = [];

function computeRows(): Row[] {
  const out: Row[] = [];
  const collapsed = new Set<string>(JSON.parse(localStorage.getItem('galley-collapsed') ?? '[]'));
  if (!state.navigation) return out;
  for (const tab of state.navigation.tabs) {
    out.push({ id: `row-tab-${tab.id}`, kind: 'tab', title: tab.title, tabId: tab.id, parentId: null, depth: 1, expanded: !collapsed.has(tab.id) });
    if (collapsed.has(tab.id)) continue;
    for (const group of tab.groups) {
      out.push({ id: `row-grp-${group.id}`, kind: 'group', title: group.title, groupId: group.id, tabId: tab.id, parentId: `row-tab-${tab.id}`, depth: 2, expanded: !collapsed.has(group.id) });
      if (collapsed.has(group.id)) continue;
      for (const pageId of group.pages) {
        const page = state.pages.get(pageId);
        out.push({ id: `row-${pageId}`, kind: 'page', title: page?.title ?? pageId, pageId, groupId: group.id, parentId: `row-grp-${group.id}`, depth: 3, expanded: true });
      }
    }
  }
  return out;
}

function rebuildTree(): void {
  if (!tree || !state.navigation) return;
  state.pages.clear();
  state.groups.clear();
  state.tabs = state.navigation.tabs.map((t) => ({ id: t.id, title: t.title }));
  for (const tab of state.navigation.tabs) {
    for (const group of tab.groups) {
      state.groups.set(group.id, { id: group.id, title: group.title, tabId: tab.id });
      for (const pageId of group.pages) {
        const known = state.pages.get(pageId);
        if (!known) state.pages.set(pageId, { id: pageId, path: '', title: pageId });
      }
    }
  }
  rows = computeRows();
  tree.textContent = '';
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', 'Pages');
  if (tree.tabIndex !== 0) tree.tabIndex = 0;
  const setSize = rows.length;
  rows.forEach((row, idx) => {
    const el = document.createElement('div');
    el.id = row.id;
    el.setAttribute('role', 'treeitem');
    el.setAttribute('aria-level', String(row.depth));
    el.setAttribute('aria-posinset', String(posInSet(row, idx)));
    el.setAttribute('aria-setsize', String(setSizeFor(row)));
    el.tabIndex = -1;
    el.dataset.kind = row.kind;
    el.dataset.pageId = row.pageId ?? '';
    el.dataset.groupId = row.groupId ?? '';
    el.dataset.tabId = row.tabId ?? '';
    el.className = `tree-row depth-${row.depth}`;
    if (row.kind === 'page' && row.pageId === state.pageId) el.setAttribute('aria-current', 'page');
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = row.title;
    el.append(label);
    if (row.kind === 'page' && state.role !== 'viewer') {
      const actions = document.createElement('button');
      actions.type = 'button';
      actions.className = 'row-actions';
      actions.setAttribute('aria-label', `Actions for ${row.title}`);
      actions.setAttribute('aria-haspopup', 'menu');
      actions.textContent = '⋯';
      actions.addEventListener('click', (e) => {
        e.stopPropagation();
        openRowMenu(row, actions);
      });
      el.append(actions);
    }
    el.addEventListener('click', () => {
      if (row.kind === 'page' && row.pageId) openPage(row.pageId);
      focusRow(el.id);
    });
    tree.append(el);
  });
}

function posInSet(row: Row, idx: number): number {
  const siblings = rows.filter((r) => r.parentId === row.parentId);
  return siblings.findIndex((r) => r.id === row.id) + 1;
}

function setSizeFor(row: Row): number {
  return rows.filter((r) => r.parentId === row.parentId).length;
}

function focusRow(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  rows.forEach((r) => {
    const node = document.getElementById(r.id);
    node?.setAttribute('tabindex', '-1');
  });
  el.setAttribute('tabindex', '0');
  el.focus();
  state.lastFocusedRow = id;
}

tree?.addEventListener('keydown', (e) => {
  const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
  const idx = rows.findIndex((r) => r.id === focusedId);
  if (idx === -1) return;
  const row = rows[idx];
  const visible = rows;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = visible[idx + 1];
    if (next) focusRow(next.id);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prev = visible[idx - 1];
    if (prev) focusRow(prev.id);
  } else if (e.key === 'Enter') {
    if (row.kind === 'page' && row.pageId) { e.preventDefault(); openPage(row.pageId); }
  } else if (e.key === 'Home') {
    e.preventDefault();
    focusRow(visible[0].id);
  } else if (e.key === 'End') {
    e.preventDefault();
    focusRow(visible[visible.length - 1].id);
  } else if (e.key === 'F2') {
    if (row.kind === 'page' && state.role !== 'viewer') { e.preventDefault(); beginRename(row); }
  } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    void moveRow(row, e.key === 'ArrowUp' ? -1 : 1);
  }
});

tree?.addEventListener('focus', () => {
  if (!state.lastFocusedRow) focusRow(rows[0]?.id ?? '');
  else focusRow(state.lastFocusedRow);
});

function openPage(pageId: string): void {
  window.location.href = `/app/sites/${state.siteSlug}/${state.versionSlug}/pages/${state.pages.get(pageId)?.path ?? ''}`;
}

async function refreshPageMeta(): Promise<void> {
  for (const [id] of state.pages) {
    const res = await api<PageJson>('GET', `/api/pages/${id}`);
    if (res.data) state.pages.set(id, { id, path: res.data.path, title: res.data.title });
  }
}

// ---------- Row actions menu ----------
function openRowMenu(row: Row, opener: HTMLElement): void {
  const existing = document.getElementById('row-menu');
  existing?.remove();
  const menu = document.createElement('div');
  menu.id = 'row-menu';
  menu.setAttribute('role', 'menu');
  menu.className = 'row-menu';
  const rename = document.createElement('button');
  rename.type = 'button';
  rename.setAttribute('role', 'menuitem');
  rename.textContent = 'Rename';
  rename.addEventListener('click', () => { menu.remove(); beginRename(row); });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.setAttribute('role', 'menuitem');
  remove.textContent = 'Remove';
  remove.addEventListener('click', () => {
    menu.remove();
    void api('DELETE', `/api/pages/${row.pageId}`).then(() => window.location.reload());
  });
  menu.append(rename, remove);
  document.body.append(menu);
  const rect = opener.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  const first = focusable(menu)[0];
  first?.focus();
  trapFocus(menu);
  const close = (e: Event) => {
    if (e.target instanceof Node && menu.contains(e.target)) return;
    menu.remove();
    document.removeEventListener('click', close);
    opener.focus();
  };
  window.setTimeout(() => document.addEventListener('click', close), 0);
}

// ---------- Rename ----------
let renamingRow: Row | null = null;

function beginRename(row: Row): void {
  const el = document.getElementById(row.id);
  if (!el || !row.pageId) return;
  renamingRow = row;
  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('role', 'textbox');
  input.setAttribute('aria-label', 'Path');
  input.className = 'rename-input';
  const currentPath = state.pages.get(row.pageId)?.path ?? '';
  input.value = currentPath;
  el.dataset.splice = '';
  el.classList.add('renaming');
  el.textContent = '';
  el.append(input);
  const error = document.createElement('div');
  error.className = 'rename-error';
  error.id = 'rename-error';
  error.hidden = true;
  input.setAttribute('aria-describedby', 'rename-error');
  el.append(error);
  input.focus();
  input.select();
  const confirm = () => { void commitRename(row, input.value, el, error); };
  const cancel = () => { void loadNavigation().then(() => { focusRow(row.id); }); renamingRow = null; };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

async function commitRename(row: Row, newPath: string, el: HTMLElement, errorEl: HTMLElement): Promise<void> {
  if (!row.pageId || !state.page) return;
  const res = await api<{ page: PageJson; navigation: NavigationJson; linksRewritten: number; redirectAdded: { from: string; to: string } | null }>(
    'POST', `/api/pages/${row.pageId}/rename`, { path: newPath, revision: state.page.revision },
  );
  if (res.error) {
    errorEl.textContent = res.error.message;
    errorEl.hidden = false;
    const input = el.querySelector('input');
    input?.setAttribute('aria-invalid', 'true');
    announce(res.error.message);
    input?.focus();
    return;
  }
  const data = res.data!;
  state.page = data.page;
  state.pages.set(row.pageId, { id: row.pageId, path: data.page.path, title: data.page.title });
  announce(`Renamed to /${data.page.path}. ${data.linksRewritten === 1 ? '1 link rewritten' : `${data.linksRewritten} links rewritten`}. Redirect added from ${data.redirectAdded?.from ?? ''}.`);
  await playSplice(el, data.page.path, data.linksRewritten, data.redirectAdded);
  await loadNavigation();
  await refreshPageMeta().then(() => rebuildTree());
  focusRow(row.id);
}

async function playSplice(el: HTMLElement, newPath: string, links: number, redirect: { from: string; to: string } | null): Promise<void> {
  const reduce = prefersReducedMotion();
  const oldPath = redirect?.from?.slice(1) ?? '';
  el.dataset.splice = 'strike';
  if (!reduce) await wait(TIMERS.spliceStrike);
  el.dataset.splice = 'set';
  const label = el.querySelector('.tree-label');
  if (reduce || !label) {
    if (label) label.textContent = newPath;
    el.dataset.splice = 'file';
    el.dataset.splice = 'count';
    el.dataset.splice = 'done';
  } else {
    for (let i = 1; i <= newPath.length; i++) {
      label.textContent = newPath.slice(0, i);
      const stagger = Math.min(TIMERS.spliceStagger, Math.floor((TIMERS.spliceSet * 6 / 7) / Math.max(1, newPath.length)));
      await wait(Math.max(1, stagger));
    }
    await wait(TIMERS.spliceSet - Math.min(TIMERS.spliceSet, newPath.length * Math.min(TIMERS.spliceStagger, 8)));
    el.dataset.splice = 'file';
    await wait(TIMERS.spliceFile);
    const count = document.getElementById('links-rewritten');
    if (count) {
      el.dataset.splice = 'count';
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        count.textContent = String(Math.round((links * i) / steps));
        await wait(TIMERS.spliceCount / steps);
      }
    }
    el.dataset.splice = 'done';
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// ---------- Moves ----------
async function moveRow(row: Row, direction: 1 | -1): Promise<void> {
  const siblings = rows.filter((r) => r.parentId === row.parentId);
  const idx = siblings.findIndex((r) => r.id === row.id);
  const target = idx + direction;
  if (target < 0 || target >= siblings.length) {
    // move across boundary
    const groups = rows.filter((r) => r.kind === 'group');
    if (row.kind === 'page') {
      const gIdx = groups.findIndex((g) => g.id === row.parentId);
      const nextGroup = direction === -1 ? groups[gIdx - 1] : groups[gIdx + 1];
      if (!nextGroup) { announce(''); return; }
      await doMovePage(row, nextGroup.groupId!, direction === -1 ? (rows.filter((r) => r.parentId === nextGroup.id).length) : 0, nextGroup);
      return;
    }
    if (row.kind === 'group') {
      const tabs = state.navigation?.tabs ?? [];
      const tabIdx = tabs.findIndex((t) => t.id === row.tabId);
      const nextTab = direction === -1 ? tabs[tabIdx - 1] : tabs[tabIdx + 1];
      if (!nextTab) { announce(''); return; }
      const nextTabGroups = nextTab.groups;
      await doMoveGroup(row, nextTab.id, direction === -1 ? nextTabGroups.length : 0, nextTab.title);
      return;
    }
    return;
  }
  if (row.kind === 'page') {
    const group = state.groups.get(row.groupId ?? '');
    await doMovePage(row, row.groupId ?? null, target, { title: group?.title ?? '' });
  } else if (row.kind === 'group') {
    const tab = state.tabs.find((t) => t.id === row.tabId);
    await doMoveGroup(row, row.tabId ?? null, target, tab?.title ?? '');
  }
}

async function doMovePage(row: Row, groupId: string | null, index: number, group: { title: string }): Promise<void> {
  if (!row.pageId) return;
  const res = await api<NavigationJson>('POST', `/api/pages/${row.pageId}/move`, { groupId, index });
  if (!res.data) return;
  state.navigation = res.data;
  rebuildTree();
  focusRow(row.id);
  const pages = rows.filter((r) => r.parentId === (groupId ? `row-grp-${groupId}` : null));
  const pos = pages.findIndex((p) => p.id === row.id) + 1;
  announce(`Moved ${row.title} to position ${pos} of ${pages.length} in ${group.title}.`);
}

async function doMoveGroup(row: Row, tabId: string | null, index: number, tabTitle: string): Promise<void> {
  if (!row.groupId) return;
  const res = await api<NavigationJson>('POST', `/api/groups/${row.groupId}/move`, { tabId, index });
  if (!res.data) return;
  state.navigation = res.data;
  rebuildTree();
  focusRow(row.id);
  const groups = rows.filter((r) => r.kind === 'group' && r.tabId === tabId);
  const pos = groups.findIndex((g) => g.id === row.id) + 1;
  announce(`Moved ${row.title} to position ${pos} of ${groups.length} in ${tabTitle}.`);
}

// ---------- Autosave ----------
function scheduleAutosave(): void {
  if (!editor || state.role === 'viewer' || state.conflict) return;
  if (state.saveTimer) window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => { void savePage(); }, TIMERS.autosavePause);
}

async function savePage(): Promise<void> {
  if (!editor || !state.page || state.role === 'viewer' || state.conflict) return;
  if (state.saving) { scheduleAutosave(); return; }
  const source = editor.value;
  if (source === state.sourceLoaded && (titleField?.value ?? '') === state.page.title) return;
  state.saving = true;
  if (saveStatus) saveStatus.textContent = 'Saving';
  const revision = state.page.revision;
  const res = await api<PageJson>('PUT', `/api/pages/${state.page.id}`, {
    title: titleField?.value ?? state.page.title, source, revision,
  });
  state.saving = false;
  if (res.error) {
    if (res.error.code === 'revision_conflict') {
      state.conflict = true;
      if (saveStatus) saveStatus.textContent = '';
      const name = (res.error as unknown as { savedBy?: { name: string } }).savedBy?.name ?? 'Another editor';
      const msg = `${name} saved this page while you were editing. Copy your changes, then reload to see theirs.`;
      const margin = qs('[data-proof-margin]');
      if (margin) {
        const note = document.createElement('div');
        note.className = 'conflict-note';
        note.setAttribute('role', 'alert');
        note.textContent = msg;
        margin.append(note);
      }
      announce(msg);
    } else {
      if (saveStatus) saveStatus.textContent = "Couldn't save. Check your connection.";
    }
    return;
  }
  if (!res.data) {
    if (saveStatus) saveStatus.textContent = "Couldn't save. Check your connection.";
    return;
  }
  state.page = res.data;
  state.sourceLoaded = res.data.source;
  if (saveStatus) saveStatus.textContent = 'Saved';
  announce('Saved');
  void rerunPanelCheck();
}

editor?.addEventListener('input', () => {
  renderGutter();
  scheduleAutosave();
});

titleField?.addEventListener('input', scheduleAutosave);

// ---------- Slash menu ----------
const COMPONENT_ITEMS = [
  { label: 'Callout', snippet: ['<Callout type="note">', '‸', '</Callout>'] },
  { label: 'Tabs', snippet: ['<Tabs>', '<Tab title="First">', '‸', '</Tab>', '<Tab title="Second">', '', '</Tab>', '</Tabs>'] },
  { label: 'Code group', snippet: ['<CodeGroup>', '```bash Shell', '‸', '```', '```js JavaScript', '', '```', '</CodeGroup>'] },
  { label: 'Steps', snippet: ['<Steps>', '<Step title="First step">', '‸', '</Step>', '</Steps>'] },
  { label: 'Accordion', snippet: ['<Accordion title="Question">', '‸', '</Accordion>'] },
  { label: 'Cards', snippet: ['<Cards>', '<Card title="Title" href="/‸">', '</Card>', '</Cards>'] },
];

let slashState: { active: boolean; startLine: number; startCol: number; filter: string; index: number } | null = null;

function slashMenu(): HTMLElement {
  let menu = document.getElementById('slash-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'slash-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Insert component');
    menu.className = 'slash-menu';
    menu.hidden = true;
    document.body.append(menu);
  }
  return menu;
}

function openSlashMenu(line: number, col: number): void {
  slashState = { active: true, startLine: line, startCol: col, filter: '', index: 0 };
  const menu = slashMenu();
  menu.hidden = false;
  renderSlashOptions('');
  editor?.setAttribute('aria-expanded', 'true');
  editor?.setAttribute('aria-controls', 'slash-menu');
  positionSlashMenu();
}

function closeSlashMenu(keep: boolean): void {
  const menu = slashMenu();
  menu.hidden = true;
  editor?.removeAttribute('aria-expanded');
  editor?.removeAttribute('aria-controls');
  editor?.removeAttribute('aria-activedescendant');
  if (!keep && slashState) {
    // keep typed text
  }
  slashState = null;
}

function positionSlashMenu(): void {
  if (!editor) return;
  const menu = slashMenu();
  const rect = editor.getBoundingClientRect();
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight || '20');
  const before = editor.value.slice(0, editor.selectionStart).split('\n');
  const lineIdx = before.length - 1;
  menu.style.position = 'fixed';
  menu.style.left = `${rect.left + 24}px`;
  menu.style.top = `${rect.top + (lineIdx + 1) * lineHeight}px`;
}

function renderSlashOptions(filter: string): void {
  const menu = slashMenu();
  menu.textContent = '';
  const matches = COMPONENT_ITEMS.filter((c) => c.label.toLowerCase().includes(filter.toLowerCase()));
  if (matches.length === 0) {
    const none = document.createElement('div');
    none.className = 'slash-no-match';
    none.textContent = 'No components match';
    menu.append(none);
    return;
  }
  matches.forEach((m, i) => {
    const opt = document.createElement('div');
    opt.setAttribute('role', 'option');
    opt.id = `slash-option-${i}`;
    opt.textContent = m.label;
    opt.dataset.snippet = m.snippet.join('\n');
    opt.dataset.index = String(i);
    if (i === (slashState?.index ?? 0)) {
      opt.classList.add('active');
      editor?.setAttribute('aria-activedescendant', opt.id);
    }
    menu.append(opt);
  });
}

editor?.addEventListener('keydown', (e) => {
  if (slashState?.active) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const opts = Array.from(slashMenu().querySelectorAll('[role="option"]'));
      slashState.index = Math.min(opts.length - 1, slashState.index + 1);
      highlightSlash();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashState.index = Math.max(0, slashState.index - 1);
      highlightSlash();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      insertSlashSnippet();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSlashMenu(true);
      return;
    }
  }
});

editor?.addEventListener('input', () => {
  if (!editor) return;
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineText = before.slice(lineStart);
  if (!slashState?.active) {
    if (lineText === '/') {
      openSlashMenu(before.split('\n').length - 1, 1);
    }
    return;
  }
  const filter = lineText.slice(1);
  slashState.filter = filter;
  renderSlashOptions(filter);
  slashState.index = 0;
  highlightSlash();
});

function highlightSlash(): void {
  const opts = Array.from(slashMenu().querySelectorAll('[role="option"]'));
  opts.forEach((o, i) => {
    o.classList.toggle('active', i === (slashState?.index ?? 0));
    if (i === (slashState?.index ?? 0)) editor?.setAttribute('aria-activedescendant', o.id);
  });
}

function insertSlashSnippet(): void {
  if (!editor || !slashState) return;
  const opts = Array.from(slashMenu().querySelectorAll<HTMLElement>('[role="option"]'));
  const chosen = opts[slashState.index];
  if (!chosen) { closeSlashMenu(true); return; }
  const snippetLines = (chosen.dataset.snippet ?? '').split('\n');
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  const lineStart = before.lastIndexOf('\n') + 1;
  const caretLine = snippetLines.indexOf('‸');
  const finalLines = snippetLines.filter((l) => l !== '‸');
  const replacement = finalLines.join('\n');
  editor.setRangeText(replacement, lineStart, pos, 'end');
  const newLines = editor.value.slice(0, lineStart).split('\n').length + (caretLine >= 0 ? caretLine : 0);
  const caretOffset = finalLines.slice(0, caretLine >= 0 ? caretLine : 0).join('\n').length + (caretLine > 0 ? 1 : 0);
  const finalPos = lineStart + (caretLine >= 0 ? finalLines.slice(0, caretLine).join('\n').length + (caretLine > 0 ? 1 : 0) : 0);
  editor.selectionStart = editor.selectionEnd = finalPos;
  closeSlashMenu(false);
  renderGutter();
  scheduleAutosave();
  editor.focus();
}

// ---------- Image upload ----------
const imageButton = qs<HTMLButtonElement>('[data-image-button]');
imageButton?.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const type = file.type;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
      announce('Images must be PNG, JPEG or WebP.');
      return;
    }
    if (file.size > 5000000) {
      announce('Images must be 5,000,000 bytes or smaller.');
      return;
    }
    void file.arrayBuffer().then((buf) => {
      const res = fetch(`/api/sites/${state.siteId}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': type },
        body: new Uint8Array(buf),
        credentials: 'same-origin',
      }).then(async (r) => {
        if (r.status === 503) {
          announce('Image upload failed: file storage is unavailable. Your page is saved.');
          return null;
        }
        return (await r.json()) as { id: string; url: string };
      });
      void res.then((data) => {
        if (!data || !editor) return;
        const line = `![${file.name}](${data.url})`;
        const pos = editor.selectionStart;
        editor.setRangeText(`\n${line}\n`, pos, pos, 'end');
        announce('Image uploaded.');
        renderGutter();
        scheduleAutosave();
      });
    });
  });
  input.click();
});

// ---------- Publish ----------
const publishButton = qs<HTMLButtonElement>('[data-publish]');

async function runPublishCheck(): Promise<{ pages: number; errors: PublishReport['errors'] } | null> {
  const res = await api<{ pages: number; errors: PublishReport['errors'] }>('POST', `/api/versions/${state.versionId}/check`);
  return res.data;
}

function publishDialog(): HTMLElement {
  let el = document.getElementById('publish-dialog');
  if (!el) {
    el = document.createElement('div');
    el.id = 'publish-dialog';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.className = 'modal publish-dialog';
    el.hidden = true;
    document.body.append(el);
  }
  return el;
}

let publishOpen = false;

async function handlePublish(): Promise<void> {
  if (state.role === 'viewer') return;
  if (!publishButton) return;
  publishButton.setAttribute('aria-busy', 'true');
  announce('Checking pages.');
  const check = await runPublishCheck();
  publishButton.removeAttribute('aria-busy');
  if (!check) return;
  if (check.errors.length > 0) {
    announce(`Found ${check.errors.length} problem${check.errors.length === 1 ? '' : 's'}. Publish is blocked.`);
    showBlockedDialog(check.errors, publishButton);
  } else {
    announce('No problems found.');
    showConfirmDialog(publishButton);
  }
}

function showBlockedDialog(errors: PublishReport['errors'], opener: HTMLElement): void {
  const dialog = publishDialog();
  dialog.textContent = '';
  dialog.hidden = false;
  publishOpen = true;
  const heading = document.createElement('h2');
  heading.id = 'publish-dialog-heading';
  heading.textContent = `Publish blocked: ${errors.length === 1 ? '1 problem' : `${errors.length} problems`}`;
  dialog.append(heading);
  const list = document.createElement('div');
  list.className = 'problem-list';
  for (const err of errors) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'problem-row';
    row.textContent = `${err.file}:${err.line} ${err.message}`;
    row.dataset.file = err.file;
    row.dataset.line = String(err.line);
    row.addEventListener('click', () => { void jumpToProblem(err); });
    list.append(row);
  }
  dialog.append(list);
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.addEventListener('click', () => { closePublishDialog(opener); showPanel(errors); });
  dialog.append(close);
  dialog.setAttribute('aria-labelledby', 'publish-dialog-heading');
  trapFocus(dialog);
  heading.focus();
}

function closePublishDialog(opener: HTMLElement): void {
  const dialog = publishDialog();
  dialog.hidden = true;
  publishOpen = false;
  opener.focus();
}

function showPanel(errors: PublishReport['errors']): void {
  const panel = qs('[data-publish-panel]');
  if (!panel) return;
  panel.hidden = false;
  const heading = panel.querySelector<HTMLElement>('h2, h3');
  if (heading) heading.textContent = `Publish blocked: ${errors.length === 1 ? '1 problem' : `${errors.length} problems`}`;
  const list = panel.querySelector<HTMLElement>('[data-panel-list]');
  if (list) {
    list.textContent = '';
    for (const err of errors) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'problem-row';
      row.textContent = `${err.file}:${err.line} ${err.message}`;
      row.addEventListener('click', () => { void jumpToProblem(err); });
      list.append(row);
    }
  }
}

async function rerunPanelCheck(): Promise<void> {
  const panel = qs('[data-publish-panel]');
  if (!panel || panel.hidden) return;
  const check = await runPublishCheck();
  if (!check) return;
  if (check.errors.length === 0) {
    const text = panel.querySelector('[data-panel-text]');
    if (text) text.textContent = 'No problems left.';
    const list = panel.querySelector('[data-panel-list]');
    if (list) list.textContent = '';
    announce('No problems left.');
  } else {
    showPanel(check.errors);
    announce(`${check.errors.length} problem${check.errors.length === 1 ? '' : 's'} left.`);
  }
}

async function jumpToProblem(err: PublishReport['errors'][number]): Promise<void> {
  const file = err.file;
  const path = file.replace(/^pages\//, '').replace(/\.md$/, '');
  if (state.pages.get(state.pageId)?.path !== path) {
    window.sessionStorage.setItem('galley-goto', JSON.stringify({ path, line: err.line }));
    window.location.href = `/app/sites/${state.siteSlug}/${state.versionSlug}/pages/${path}`;
    return;
  }
  focusEditorLine(err.line);
}

function focusEditorLine(line: number): void {
  if (!editor) return;
  const lines = editor.value.split('\n');
  let offset = 0;
  for (let i = 0; i < Math.min(line - 1, lines.length); i++) offset += lines[i].length + 1;
  editor.focus();
  editor.selectionStart = editor.selectionEnd = offset;
  const gutter = qs('[data-gutter]');
  if (gutter) {
    gutter.querySelectorAll('span').forEach((s) => {
      if (s.dataset.line === String(line)) s.dataset.error = 'true';
      else delete s.dataset.error;
    });
  }
}

function showConfirmDialog(opener: HTMLElement): void {
  const dialog = publishDialog();
  dialog.textContent = '';
  dialog.hidden = false;
  publishOpen = true;
  const heading = document.createElement('h2');
  heading.id = 'publish-dialog-heading';
  const versionTitle = document.body.dataset.versionTitle ?? '';
  heading.textContent = `Publish ${versionTitle}?`;
  const text = document.createElement('p');
  text.textContent = '1 page changes.';
  const publishNow = document.createElement('button');
  publishNow.type = 'button';
  publishNow.textContent = 'Publish now';
  publishNow.addEventListener('click', () => {
    publishNow.setAttribute('aria-busy', 'true');
    announce(`Publishing ${versionTitle}.`);
    void api<PublishReport>('POST', `/api/versions/${state.versionId}/publish`, undefined, {
      headers: { 'Idempotency-Key': `pub-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    }).then((res) => {
      publishNow.removeAttribute('aria-busy');
      if (res.status === 200 && res.data) {
        closePublishDialog(opener);
        announce(`Published ${versionTitle}.`);
        void loadNavigation();
      } else if (res.error) {
        announce(res.error.message);
        if (res.error.code !== 'storage_unavailable') {
          closePublishDialog(opener);
        }
      }
    });
  });
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => closePublishDialog(opener));
  dialog.append(heading, text, publishNow, cancel);
  dialog.setAttribute('aria-labelledby', 'publish-dialog-heading');
  trapFocus(dialog);
  publishNow.focus();
}

publishButton?.addEventListener('click', () => { void handlePublish(); });
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
    e.preventDefault();
    void handlePublish();
  }
});

// ---------- Proof margin ----------
function renderProofMargin(): void {
  const margin = qs('[data-proof-margin]');
  if (!margin || !state.navigation || !state.page) return;
  const list = margin.querySelector<HTMLElement>('[data-redirects-list]');
  if (list) {
    list.textContent = '';
    for (const r of state.navigation.redirects) {
      const chip = document.createElement('li');
      chip.textContent = `${r.from} → ${r.to}`;
      chip.className = 'redirect-chip';
      chip.dataset.kind = r.kind;
      list.append(chip);
    }
  }
  const count = document.getElementById('links-rewritten');
  if (count) count.textContent = '0';
}

// ---------- Live events ----------
function subscribeEvents(): void {
  const url = `/api/events?versionId=${state.versionId}&pageId=${state.pageId}`;
  const es = new EventSource(url);
  state.es = es;
  es.addEventListener('navigation', (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as NavigationJson;
    state.navigation = data;
    rebuildTree();
  });
  es.addEventListener('page', (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as PageJson;
    if (data.id !== state.pageId) return;
    if (state.conflict) return;
    if (editor && editor.value === state.sourceLoaded) {
      state.page = data;
      editor.value = data.source;
      if (titleField) titleField.value = data.title;
      state.sourceLoaded = data.source;
      renderGutter();
    } else {
      if (state.page) state.page = { ...state.page, revision: data.revision };
    }
  });
  es.addEventListener('presence', (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as { editors: { id: string; name: string }[] };
    const box = qs('[data-presence]');
    if (!box) return;
    box.textContent = '';
    for (const ed of data.editors) {
      if (ed.id === document.body.dataset.userId) continue;
      const note = document.createElement('div');
      note.className = 'presence-note';
      note.textContent = `${ed.name} is also editing this page.`;
      box.append(note);
      announce(`${ed.name} is also editing this page.`);
    }
  });
  es.addEventListener('role', (ev) => {
    const data = JSON.parse((ev as MessageEvent).data) as { userId: string; role: string };
    if (data.userId === document.body.dataset.userId) {
      const labels: Record<string, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
      announce(`Your role is now ${labels[data.role] ?? data.role}.`);
      window.setTimeout(() => window.location.reload(), 600);
    }
  });
}

// ---------- Boot ----------
initMeta();
initTheme();
void loadNavigation().then(() => void loadPage()).then(() => { subscribeEvents(); });
void refreshPageMeta().then(() => { rebuildTree(); });

const pending = window.sessionStorage.getItem('galley-goto');
if (pending) {
  window.sessionStorage.removeItem('galley-goto');
  try {
    const { line } = JSON.parse(pending) as { path: string; line: number };
    window.setTimeout(() => focusEditorLine(line), 400);
  } catch { /* ignore */ }
}

// ---------- New page / group / version dialogs ----------
qsa<HTMLButtonElement>('[data-new-page]').forEach((b) => b.addEventListener('click', () => openNewPageDialog(b)));
qsa<HTMLButtonElement>('[data-new-group]').forEach((b) => b.addEventListener('click', () => openNewGroupDialog(b)));
qsa<HTMLButtonElement>('[data-new-version]').forEach((b) => b.addEventListener('click', () => openNewVersionDialog(b)));
qsa<HTMLButtonElement>('[data-import-openapi]').forEach((b) => b.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 1000000) { announce('This file is larger than 1,000,000 bytes.'); return; }
    void file.arrayBuffer().then((buf) => {
      void fetch(`/api/versions/${state.versionId}/openapi?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: new Uint8Array(buf),
        credentials: 'same-origin',
      }).then(async (r) => {
        const data = await r.json().catch(() => null);
        if (r.status === 201 && data) {
          announce(`Imported ${data.pages.length} operation${data.pages.length === 1 ? '' : 's'}.`);
          await loadNavigation();
        } else if (data?.error) {
          announce(data.error.message);
        }
      });
    });
  });
  input.click();
}));

function modalShell(title: string, opener: HTMLElement): { dialog: HTMLElement; close(): void } {
  let el = document.getElementById('modal-shell');
  el?.remove();
  const dialog = document.createElement('div');
  dialog.id = 'modal-shell';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.className = 'modal';
  const heading = document.createElement('h2');
  heading.textContent = title;
  dialog.append(heading);
  document.body.append(dialog);
  trapFocus(dialog);
  const close = () => { dialog.remove(); opener.focus(); };
  dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  return { dialog, close };
}

function openNewPageDialog(opener: HTMLButtonElement): void {
  const { dialog, close } = modalShell('New page', opener);
  const titleInput = labelledInput(dialog, 'Title', 'text');
  const pathInput = labelledInput(dialog, 'Path', 'text');
  const groupSelect = document.createElement('select');
  groupSelect.setAttribute('aria-label', 'Group');
  for (const [, group] of state.groups) {
    const opt = document.createElement('option');
    opt.value = group.id;
    opt.textContent = group.title;
    groupSelect.append(opt);
  }
  dialog.append(groupSelect);
  appendDialogActions(dialog, 'Create page', () => {
    void api<PageJson>('POST', `/api/versions/${state.versionId}/pages`, {
      title: titleInput.value, path: pathInput.value, groupId: groupSelect.value,
    }).then((res) => {
      if (res.data) { close(); window.location.href = `/app/sites/${state.siteSlug}/${state.versionSlug}/pages/${res.data.path}`; }
      else if (res.error) announce(res.error.message);
    });
  }, close);
  titleInput.focus();
}

function openNewGroupDialog(opener: HTMLButtonElement): void {
  const { dialog, close } = modalShell('New group', opener);
  const titleInput = labelledInput(dialog, 'Title', 'text');
  const tabSelect = document.createElement('select');
  tabSelect.setAttribute('aria-label', 'Tab');
  for (const tab of state.tabs) {
    const opt = document.createElement('option');
    opt.value = tab.id;
    opt.textContent = tab.title;
    tabSelect.append(opt);
  }
  dialog.append(tabSelect);
  appendDialogActions(dialog, 'Create group', () => {
    void api<NavigationJson>('POST', `/api/versions/${state.versionId}/groups`, {
      tabId: tabSelect.value, title: titleInput.value,
    }).then((res) => {
      if (res.data) { state.navigation = res.data; rebuildTree(); close(); }
      else if (res.error) announce(res.error.message);
    });
  }, close);
  titleInput.focus();
}

function openNewVersionDialog(opener: HTMLButtonElement): void {
  const { dialog, close } = modalShell('New version', opener);
  const copySelect = document.createElement('select');
  copySelect.setAttribute('aria-label', 'Copy from');
  for (const tab of state.tabs) { void tab; }
  const versions: { id: string; slug: string; title: string }[] = JSON.parse(document.body.dataset.versions ?? '[]');
  for (const v of versions) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.title;
    copySelect.append(opt);
  }
  const slugInput = labelledInput(dialog, 'Slug', 'text');
  const titleInput = labelledInput(dialog, 'Title', 'text');
  dialog.insertBefore(copySelect, slugInput.parentElement ?? dialog);
  appendDialogActions(dialog, 'Create version', () => {
    void api('POST', `/api/sites/${state.siteId}/versions`, {
      fromVersionId: copySelect.value, slug: slugInput.value, title: titleInput.value,
    }).then((res) => {
      const version = res.data as { id: string; slug: string } | null;
      if (version) { close(); window.location.href = `/app/sites/${state.siteSlug}/${version.slug}/pages/`; }
      else if (res.error) announce(res.error.message);
    });
  }, close);
  slugInput.focus();
}

function labelledInput(parent: HTMLElement, label: string, type: string): HTMLInputElement {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.setAttribute('aria-label', label);
  wrap.append(span, input);
  parent.append(wrap);
  return input;
}

function appendDialogActions(parent: HTMLElement, okLabel: string, onOk: () => void, onCancel: () => void): void {
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.textContent = okLabel;
  ok.addEventListener('click', onOk);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', onCancel);
  parent.append(ok, cancel);
}

// ---------- Share preview ----------
qsa<HTMLButtonElement>('[data-share-preview]').forEach((b) => b.addEventListener('click', () => {
  void api<{ id: string; url: string; expiresAt: string }>('POST', `/api/pages/${state.pageId}/preview-links`).then((res) => {
    if (!res.data) return;
    announce('Preview link created.');
    const { dialog, close } = modalShell('Share preview', b);
    const linkField = document.createElement('input');
    linkField.readOnly = true;
    linkField.setAttribute('aria-label', 'Preview link');
    linkField.value = `${window.location.origin}${res.data.url}`;
    dialog.append(linkField);
    linkField.focus();
    linkField.select();
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy link';
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(linkField.value).then(() => announce('Copied'));
    });
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.textContent = 'Revoke';
    revoke.addEventListener('click', () => {
      void api('DELETE', `/api/preview-links/${res.data!.id}`).then(() => {
        announce('Preview link revoked.');
        close();
      });
    });
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', close);
    dialog.append(copy, revoke, closeBtn);
  });
}));

// ---------- Sign out ----------
qsa<HTMLButtonElement>('[data-sign-out]').forEach((b) => b.addEventListener('click', () => {
  void api('DELETE', '/api/session').then(() => { window.location.href = '/signin'; });
}));

// ---------- Pages drawer (phone) ----------
const pagesDrawerButton = qs<HTMLButtonElement>('[data-pages-drawer-button]');
if (pagesDrawerButton) {
  const drawer = qs<HTMLElement>('[data-pages-drawer]');
  if (drawer) {
    pagesDrawerButton.addEventListener('click', () => {
      drawer.hidden = false;
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-modal', 'true');
      drawer.setAttribute('aria-label', 'Pages');
      drawer.dataset.motion = prefersReducedMotion() ? 'open' : 'opening';
      trapFocus(drawer);
      (focusable(drawer)[0] ?? drawer).focus();
    });
  }
}
