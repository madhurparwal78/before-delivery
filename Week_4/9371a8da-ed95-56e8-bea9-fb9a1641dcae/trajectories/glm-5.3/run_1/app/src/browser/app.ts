import { el } from './dom.js';
import * as api from './api.js';
import { ApiFailure } from './api.js';
import {
  currentRoute, navigate, setApp, requestFocus, takeFocusTarget, rerender,
} from './app-state.js';
import { projectUrl, shareUrl, safeNext } from './router.js';
import { layoutForWidth, prefersReducedMotion, storedOffset, lineCount, lineStart, lineOfOffset, sectionsOf, newRetryKey, formatDateTime, fileKind, moveCaret } from './layout.js';
import { documentOrder, orphansOf, cardNode, isSuggestion, itemAuthor, type CardCallbacks } from './cards.js';
import { dialogFrame, wrapTab, mentionState, updateMention, buildMentionList, mentionKeydown, releaseDialog } from './dialogs.js';
import { isFailure as isFail, resolveSuggestion, postReply, resolveThread, type ProjectHandle } from './actions.js';
import { historyDialog, restoreConfirm } from './history-view.js';
import { peopleDialog } from './people-view.js';
import { citationsDialog, submissionDialog } from './checks-view.js';
import { suggestDialog, commentDialog, newFileDialog, uploadDialog, deleteConfirm, staleDialog } from './file-dialogs.js';
import { renderInvite } from './invite-view.js';
export { renderInvite };

import type { Suggestion, Thread, TextFile, FileSummary, ProjectSummary, LedgerEntry, Label, Member, Invite, ShareLink, CitationReport, Role, UserShape, ExportShape } from '../shared/types.js';

interface ScreenState {
  me: UserShape | null;
  workspaceRole: string | null;
  route: ReturnType<typeof currentRoute>;
  message: string;
  storageMessage: string;
  citationMessage: string;
  notice: string;
}

const state: ScreenState = {
  me: null,
  workspaceRole: null,
  route: { name: 'notfound' },
  message: '',
  storageMessage: '',
  citationMessage: '',
  notice: '',
};

// ---------- Project view state ----------
interface ProjectState {
  project: ProjectSummary | null;
  files: FileSummary[];
  openFile: TextFile | null;
  openFigure: FileSummary | null;
  suggestions: Suggestion[];
  threads: Thread[];
  draft: string;
  lastLoadedRevision: number;
  savePending: boolean;
  retryKey: string | null;
  retryBody: string | null;
  dialog: null | { kind: 'new-project' } | { kind: 'profile' }
    | { kind: 'suggest'; from: number; to: number } | { kind: 'comment'; from: number; to: number }
    | { kind: 'new-file' } | { kind: 'upload' }
    | { kind: 'delete-confirm'; fid: string; path: string }
    | { kind: 'stale'; current: TextFile; unsaved: string }
    | { kind: 'history' } | { kind: 'people' } | { kind: 'citations' } | { kind: 'submission' }
    | { kind: 'restore-confirm'; label: Label }
    | { kind: 'files-dialog' };
  historyEntries: LedgerEntry[];
  labels: Label[];
  citationReport: CitationReport | null;
  members: Member[];
  invites: Invite[];
  shareLink: ShareLink | null;
  focusedCard: string | null;
  pendingCard: string | null;
  lastActionSeq: number;
  lastStorageSeq: number;
  storageStamp: number;
  role: Role | null;
  shareToken: string | null;
  shareProject: { title: string; projectRevision: number } | null;
  shareFiles: FileSummary[];
  shareSopen: number;
  moreOpen: boolean;
  moreFocusLast: boolean;
  phoneTab: 'source' | 'margin';
  layout: 'phone' | 'tablet' | 'desktop';
  uploadFile: File | null;
  uploadFolder: string;
  uploadError: string | null;
  lastLabelRevision: number | null;
  exportResult: { export: ExportShape } | null;
  exportBusy: boolean;
  downloadRev: number | null;
  figureAvailable: Record<string, boolean>;
  previewInFlight: Record<string, number>;
  mention: ReturnType<typeof mentionState>;
  accessTitle: string | null;
  error: string | null;
  selection: { start: number; end: number } | null;
  selectionFile: string | null;
}

const ps: ProjectState = {
  project: null,
  files: [],
  openFile: null,
  openFigure: null,
  suggestions: [],
  threads: [],
  draft: '',
  lastLoadedRevision: 1,
  savePending: false,
  retryKey: null,
  retryBody: null,
  dialog: null,
  historyEntries: [],
  labels: [],
  citationReport: null,
  members: [],
  invites: [],
  shareLink: null,
  focusedCard: null,
  pendingCard: null,
  lastActionSeq: 0,
  lastStorageSeq: 0,
  storageStamp: 0,
  role: null,
  shareToken: null,
  shareProject: null,
  shareFiles: [],
  shareSopen: 0,
  moreOpen: false,
  moreFocusLast: false,
  phoneTab: 'source',
  layout: 'desktop',
  uploadFile: null,
  uploadFolder: 'figures',
  uploadError: null,
  lastLabelRevision: null,
  exportResult: null,
  exportBusy: false,
  downloadRev: null,
  figureAvailable: {},
  previewInFlight: {},
  mention: mentionState(),
  accessTitle: null,
  error: null,
  selection: null,
  selectionFile: null,
};

let refreshTimer: number | null = null;
let lastCaret: number = 0;
let lastSelection: { start: number; end: number } = { start: 0, end: 0 };
let scrollTop = 0;
let sourceFocused = false;
let lastRefreshSignature = '';
let historySignature = '';
let dialogDirty = false;

function isFailure(e: unknown): e is ApiFailure {
  return e instanceof ApiFailure;
}

export function main(): void {
  setApp({ render: renderApp });
  window.addEventListener('popstate', () => {
  state.route = currentRoute();
  // A file change inside one project keeps the status line; only a new screen clears it.
  const before = state.route;
  void loadMe().then(() => {
    const after = currentRoute();
    const sameScreen = before.name === after.name
      && (before.name !== 'project' || before.pid === (after as { pid?: string }).pid);
    if (sameScreen) {
      onRouteKeepMessage();
    } else {
      onRoute();
    }
  });
});
  window.addEventListener('resize', onResize);
  document.addEventListener('selectionchange', () => {
    const ta = document.getElementById('source-box') as HTMLTextAreaElement | null;
    if (ta && document.activeElement === ta) recordSelection();
  });
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (ps.moreOpen) {
        ev.preventDefault();
        ps.moreOpen = false;
        rerender();
        queueMicrotask(() => {
          const btn = document.getElementById('more-button');
          btn?.focus();
        });
      }
    }
  });
  state.route = currentRoute();
  onResize();
  void loadMe().then(() => onRoute());
}

function onResize(): void {
  ps.layout = layoutForWidth(window.innerWidth);
  rerender();
}

function onRouteKeepMessage(): void {
  const message = state.message;
  const notice = state.notice;
  onRoute();
  state.message = message;
  state.notice = notice;
}

function onRoute(): void {
  ps.dialog = null;
  ps.moreOpen = false;
  state.message = '';
  state.notice = '';
  if (state.route.name === 'project' || state.route.name === 'share') {
    void openProject(state.route);
  } else if (state.route.name === 'signin') {
    void checkSignedIn();
  } else if (state.route.name === 'projects') {
    void loadMe().then(() => rerender());
  } else {
    rerender();
  }
}

async function checkSignedIn(): Promise<void> {
  try {
    await api.getMe();
    navigate('/', true);
  } catch {
    rerender();
  }
}

async function loadMe(): Promise<void> {
  try {
    const res = await api.getMe();
    state.me = res.user;
    state.workspaceRole = res.workspace?.role ?? null;
  } catch {
    state.me = null;
    state.workspaceRole = null;
  }
}

async function signOut(): Promise<void> {
  await api.deleteSession().catch(() => {});
  state.me = null;
  navigate('/signin', true);
}

// ---------- Opening the project ----------
async function openProject(route: ReturnType<typeof currentRoute>): Promise<void> {
  if (route.name === 'project') {
    try {
      const me = await api.getMe();
      state.me = me.user;
      state.workspaceRole = me.workspace?.role ?? null;
      const [projRes, reviewRes, cites, membersRes] = await Promise.all([
        api.getProject(route.pid),
        api.getReview(route.pid),
        api.getCitations(route.pid),
        api.getMembers(route.pid),
      ]);
      ps.project = projRes.project;
      ps.role = projRes.project.role;
      ps.files = projRes.files;
      ps.members = membersRes.members;
      ps.suggestions = reviewRes.suggestions;
      ps.threads = reviewRes.threads;
      ps.citationReport = cites;
      ps.accessTitle = projRes.project.title;
      state.citationMessage = undefinedCountText(cites.undefined.length);
      await openTargetFile(route);
    } catch (e) {
      if (isFailure(e) && e.shape.status === 401) {
        navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`, true);
        return;
      }
      if (isFailure(e) && e.shape.status === 404) {
        state.notice = ps.accessTitle
          ? `You no longer have access to ${ps.accessTitle}.`
          : 'You do not have access to that project.';
        navigate('/', true);
        return;
      }
      rerender();
      return;
    }
    startRefresh();
    rerender();
    return;
  }
  if (route.name === 'share') {
    try {
      const [projRes, reviewRes] = await Promise.all([
        api.getShareProject(route.token),
        api.getShareReview(route.token),
      ]);
      ps.shareToken = route.token;
      ps.shareProject = projRes.project;
      ps.shareFiles = projRes.files;
      ps.suggestions = reviewRes.suggestions;
      ps.threads = reviewRes.threads;
      ps.shareSopen = reviewRes.openSuggestions;
      await openShareTargetFile(route);
    } catch {
      ps.shareProject = null;
    }
    startRefresh();
    rerender();
  }
}

async function openTargetFile(route: { file?: string; line?: number; thread?: string; pid: string }): Promise<void> {
  let targetPath = route.file;
  let focusThread: string | undefined = route.thread;
  let line = route.line;
  if (focusThread) {
    const t = ps.threads.find((x) => x.id === focusThread);
    if (t) {
      const file = ps.files.find((f) => f.id === t.fileId);
      targetPath = file?.path ?? 'main.tex';
      if (t.status === 'resolved') {
        state.message = `This thread was resolved by ${t.resolvedBy?.displayName ?? ''}`;
      }
    } else {
      state.message = 'That comment is no longer available';
      focusThread = undefined;
    }
  }
  if (!targetPath) {
    targetPath = ps.files.find((f) => f.path === 'main.tex')?.path ?? ps.files[0]?.path;
  }
  if (!targetPath) return;
  const file = ps.files.find((f) => f.path === targetPath);
  if (!file) return;
  await openFile(file, line, focusThread);
}

async function openShareTargetFile(route: { file?: string }): Promise<void> {
  const targetPath = route.file ?? ps.shareFiles.find((f) => f.path === 'main.tex')?.path ?? ps.shareFiles[0]?.path;
  if (!targetPath) return;
  const file = ps.shareFiles.find((f) => f.path === targetPath);
  if (!file) return;
  if (file.kind === 'text') {
    const res = await api.getShareFile(ps.shareToken as string, file.id);
    ps.openFile = res.file as TextFile;
    ps.openFigure = null;
    ps.draft = ps.openFile.content;
    ps.lastLoadedRevision = ps.openFile.revision;
  } else {
    ps.openFigure = file;
    ps.openFile = null;
  }
}

async function openFile(file: FileSummary, line?: number, focusThread?: string): Promise<void> {
  if (file.kind === 'text') {
    const res = await api.getFile(ps.project?.id as string, file.id);
    ps.openFile = res.file as TextFile;
    ps.openFigure = null;
    ps.draft = ps.openFile.content;
    ps.lastLoadedRevision = ps.openFile.revision;
    if (line !== undefined) {
      requestFocus('source');
      pendingLine = line;
    } else if (focusThread) {
      ps.focusedCard = focusThread;
      requestFocus(`card-${focusThread}`);
    }
  } else {
    ps.openFigure = file;
    ps.openFile = null;
    requestFocus(`figure-${file.id}`);
  }
}

let pendingLine: number | null = null;

function startRefresh(): void {
  if (refreshTimer !== null) return;
  refreshTimer = window.setInterval(() => void refresh(), 5000);
}

async function refresh(): Promise<void> {
  const route = currentRoute();
  const sentAt = Date.now();
  if (route.name === 'project') {
    try {
      const [projRes, reviewRes, cites] = await Promise.all([
        api.getProject(route.pid),
        api.getReview(route.pid),
        api.getCitations(route.pid),
      ]);
      if (sentAt < ps.lastActionSeq) return; // a late answer: discard
      const before = JSON.stringify({
        rev: projRes.project.projectRevision, role: projRes.project.role,
        files: projRes.files.length, s: reviewRes.suggestions.length,
        t: reviewRes.threads.length, c: cites.undefined.length,
        statuses: reviewRes.suggestions.map((x) => x.status).join(','),
        threadStates: reviewRes.threads.map((x) => x.status).join(','),
      });
      const changed = before !== lastRefreshSignature;
      if (!changed && ps.dialog === null) return;
      lastRefreshSignature = before;
      ps.project = projRes.project;
      ps.role = projRes.project.role;
      ps.files = projRes.files;
      ps.suggestions = reviewRes.suggestions;
      ps.threads = reviewRes.threads;
      ps.citationReport = cites;
      state.citationMessage = undefinedCountText(cites.undefined.length);
      if (ps.openFile) {
        const still = ps.files.find((f) => f.id === ps.openFile?.id);
        if (still && still.kind === 'text' && still.revision > ps.lastLoadedRevision && !hasUnsavedChanges() && ps.dialog === null) {
          const res = await api.getFile(route.pid, still.id);
          if (sentAt >= ps.lastActionSeq) {
            ps.openFile = res.file as TextFile;
            ps.draft = ps.openFile.content;
            ps.lastLoadedRevision = ps.openFile.revision;
          }
        }
      }
      if (ps.dialog?.kind === 'history') {
        const h = await api.getHistory(route.pid);
        if (sentAt >= ps.lastActionSeq) ps.historyEntries = h.entries;
        const labels = await api.getLabels(route.pid);
        if (sentAt >= ps.lastActionSeq) ps.labels = labels.labels;
        dialogDirty = JSON.stringify(h.entries) !== historySignature;
        historySignature = JSON.stringify(h.entries);
      }
      if (ps.dialog?.kind === 'people') {
        const peopleSig = JSON.stringify([ps.members, ps.invites, ps.shareLink]);
        await refreshPeople(route.pid, sentAt);
        dialogDirty = dialogDirty || peopleSig !== JSON.stringify([ps.members, ps.invites, ps.shareLink]);
      }
      if (ps.dialog?.kind === 'citations' || ps.dialog?.kind === 'submission') {
        const rep = await api.getCitations(route.pid);
        if (sentAt >= ps.lastActionSeq) {
          const repSig = JSON.stringify(ps.citationReport);
          ps.citationReport = rep;
          dialogDirty = dialogDirty || repSig !== JSON.stringify(rep);
        }
      }
      // The 5-second refresh leaves the editor untouched when nothing is newer.
      if (dialogDirty) rerender();
      dialogDirty = false;
    } catch (e) {
      if (isFailure(e) && e.shape.status === 401) {
        navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`, true);
      } else if (isFailure(e) && e.shape.status === 404) {
        state.notice = ps.accessTitle
          ? `You no longer have access to ${ps.accessTitle}.`
          : 'You do not have access to that project.';
        navigate('/', true);
      }
    }
  } else if (route.name === 'share') {
    try {
      const [projRes, reviewRes] = await Promise.all([
        api.getShareProject(route.token),
        api.getShareReview(route.token),
      ]);
      ps.shareProject = projRes.project;
      ps.shareFiles = projRes.files;
      ps.suggestions = reviewRes.suggestions;
      ps.threads = reviewRes.threads;
      if (ps.openFile) {
        const still = ps.shareFiles.find((f) => f.id === ps.openFile?.id);
        if (still && still.kind === 'text' && still.revision > ps.lastLoadedRevision) {
          const res = await api.getShareFile(route.token, still.id);
          ps.openFile = res.file as TextFile;
          ps.draft = ps.openFile.content;
          ps.lastLoadedRevision = ps.openFile.revision;
        }
      }
      rerender();
    } catch (e) {
      if (isFailure(e) && e.shape.status === 404) {
        ps.shareProject = null;
        rerender();
      }
    }
  }
}

async function refreshPeople(pid: string, sentAt: number): Promise<void> {
  if (ps.role !== 'owner') {
    const members = await api.getMembers(pid);
    if (sentAt >= ps.lastActionSeq) ps.members = members.members;
    return;
  }
  const [members, invites, shareLink] = await Promise.all([
    api.getMembers(pid), api.getInvites(pid), api.getShareLink(pid),
  ]);
  if (sentAt < ps.lastActionSeq) return;
  ps.members = members.members;
  ps.invites = invites.invites;
  ps.shareLink = shareLink.shareLink;
}

function hasUnsavedChanges(): boolean {
  return ps.openFile !== null && ps.draft !== ps.openFile.content;
}

function undefinedCountText(n: number): string {
  if (n === 0) return 'No undefined citations';
  if (n === 1) return '1 undefined citation';
  return `${n} undefined citations`;
}

// ---------- Saving ----------
async function doSave(): Promise<void> {
  if (!ps.openFile || ps.savePending) return;
  if (ps.role !== 'owner' && ps.role !== 'editor') return;
  if (ps.draft === ps.openFile.content) return;
  const key = newRetryKey();
  const content = ps.draft;
  const baseRevision = ps.lastLoadedRevision;
  ps.savePending = true;
  ps.retryKey = key;
  ps.retryBody = content;
  ps.lastActionSeq = Date.now();
  state.message = `Saving ${ps.openFile.path}…`;
  rerender();
  try {
    const res = await api.putFile(ps.project?.id as string, ps.openFile.id, content, baseRevision, key);
    ps.lastActionSeq = Date.now();
    ps.savePending = false;
    ps.retryKey = null;
    ps.retryBody = null;
    ps.lastLoadedRevision = res.file.revision;
    ps.openFile = { ...ps.openFile, revision: res.file.revision, content: res.file.content, size: res.file.size };
    if (ps.draft === content) {
      ps.draft = res.file.content;
    }
    state.message = `Saved ${res.file.path} as r${res.projectRevision}`;
    const rep = await api.getCitations(ps.project?.id as string);
    ps.citationReport = rep;
    state.citationMessage = undefinedCountText(rep.undefined.length);
    rerender();
  } catch (e) {
    ps.lastActionSeq = Date.now();
    ps.savePending = false;
    if (isFailure(e)) {
      if (e.shape.status === 412 && e.shape.current) {
        state.message = `Not saved: a newer version of ${ps.openFile.path} exists`;
        ps.dialog = { kind: 'stale', current: e.shape.current.file, unsaved: content };
        rerender();
        return;
      }
      if (e.shape.status === 422) {
        state.message = `Not saved: ${ps.openFile.path} contains a character that cannot be stored`;
        ps.retryKey = null;
        ps.retryBody = null;
        rerender();
        return;
      }
      state.message = 'Not saved. Your text is still here; try again.';
      ps.retryKey = null;
      ps.retryBody = null;
      rerender();
      return;
    }
    // No answer: retry once after 2 seconds with the same key and body.
    state.message = `Saving ${ps.openFile.path}…`;
    rerender();
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await api.putFile(ps.project?.id as string, ps.openFile.id, content, baseRevision, key);
      ps.lastActionSeq = Date.now();
      ps.lastLoadedRevision = res.file.revision;
      ps.openFile = { ...ps.openFile, revision: res.file.revision, content: res.file.content, size: res.file.size };
      if (ps.draft === content) ps.draft = res.file.content;
      state.message = `Saved ${res.file.path} as r${res.projectRevision}`;
      rerender();
    } catch {
      ps.lastActionSeq = Date.now();
      state.message = 'Not saved. Your text is still here; try again.';
      rerender();
    }
  }
}

// ---------- Rendering ----------
// The source textarea survives a full re-render without being detached,
// so its caret, selection and focus are never disturbed.
let carriedTextarea: HTMLTextAreaElement | null = null;

function renderApp(): void {
  const route = state.route;
  const root = document.getElementById('app');
  if (!root) return;
  const priorTa = document.getElementById('source-box') as HTMLTextAreaElement | null;
  if (priorTa && priorTa.getAttribute('data-file') === (ps.openFile?.id ?? '')) {
    carriedTextarea = priorTa;
  } else {
    carriedTextarea = null;
  }
  root.replaceChildren();
  void carriedTextarea;
  if (route.name === 'signin') {
    root.appendChild(renderSignin());
  } else if (route.name === 'projects') {
    root.appendChild(renderProjects());
  } else if (route.name === 'project') {
    root.appendChild(renderProjectView());
  } else if (route.name === 'invite') {
    void renderInvite(root, route.token);
  } else if (route.name === 'share') {
    root.appendChild(renderShareView());
  } else {
    root.appendChild(el('div', { class: 'page' }, el('h1', {}, 'Not found')));
  }
  applyFocusTarget();
}

function applyFocusTarget(): void {
  const target = takeFocusTarget();
  if (target) {
    const elById = document.getElementById(target.id);
    if (elById) {
      elById.focus();
      return;
    }
  }
}

function renderSignin(): HTMLElement {
  const card = el('div', { class: 'signin-card' });
  card.appendChild(el('h1', {}, 'Sign in to Marginalia'));
  const form = el('form', {
    onsubmit: async (ev: Event) => {
      ev.preventDefault();
      const email = (document.getElementById('si-email') as HTMLInputElement).value;
      const password = (document.getElementById('si-password') as HTMLInputElement).value;
      try {
        await api.postSession(email, password);
        const next = state.route.name === 'signin' ? safeNext(state.route.next) : null;
        navigate(next ?? '/', true);
      } catch {
        const err = el('p', { class: 'field-error', role: 'alert' }, 'Email or password is incorrect.');
        form.querySelector('.field-error')?.remove();
        form.insertBefore(err, form.firstChild?.nextSibling ?? null);
      }
    },
  });
  const emailField = el('div', { class: 'field' },
    el('label', { for: 'si-email' }, 'Email'),
    el('input', { id: 'si-email', type: 'email', autocomplete: 'email' }));
  const passwordField = el('div', { class: 'field' },
    el('label', { for: 'si-password' }, 'Password'),
    el('input', { id: 'si-password', type: 'password', autocomplete: 'current-password' }));
  form.appendChild(emailField);
  form.appendChild(passwordField);
  form.appendChild(el('button', { type: 'submit', class: 'primary' }, 'Sign in'));
  card.appendChild(form);
  return el('div', { class: 'signin-wrap' }, card);
}

async function renderProjectsData(): Promise<HTMLElement | null> {
  try {
    const res = await api.getProjects();
    const list = el('div', { class: 'project-list' });
    for (const p of res.projects) {
      list.appendChild(el('div', { class: 'project-row' },
        el('a', { href: projectUrl(p.id, { file: 'main.tex' }), onclick: (ev: Event) => { ev.preventDefault(); navigate(projectUrl(p.id, { file: 'main.tex' })); } }, p.title),
        el('span', { class: 'role' }, p.role),
        el('span', { class: 'rev' }, `r${p.projectRevision}`),
      ));
    }
    return list;
  } catch (e) {
    if (isFailure(e) && e.shape.status === 401) {
      navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`, true);
      return null;
    }
    return el('p', {}, 'Something went wrong. Try again.');
  }
}

function renderProjects(): HTMLElement {
  const page = el('div', { class: 'page' });
  const header = el('div', { class: 'app-header' });
  const who = el('div', { class: 'who' });
  if (state.me) {
    who.appendChild(el('button', {
      onclick: () => { ps.dialog = { kind: 'profile' }; rerender(); },
    }, state.me.displayName));
    who.appendChild(el('button', { onclick: () => void signOut() }, 'Sign out'));
  }
  header.appendChild(who);
  page.appendChild(header);
  page.appendChild(el('h1', { class: 'heading-rule' }, 'Projects'));
  const container = el('div');
  page.appendChild(container);
  void renderProjectsData().then((list) => {
    if (list) container.appendChild(list);
    const notice = el('div', { class: 'status-region', role: 'status', 'aria-live': 'polite', id: 'access-notice' }, state.notice);
    page.appendChild(notice);
  });
  if (state.workspaceRole === 'owner') {
    page.appendChild(el('button', {
      onclick: () => { ps.dialog = { kind: 'new-project' }; rerender(); },
    }, 'New project'));
  }
  const dlg = renderDialogs();
  if (dlg) page.appendChild(dlg);
  return page;
}

function toolbarButtons(): HTMLElement {
  const bar = el('div', { class: 'toolbar' });
  bar.appendChild(el('a', { href: '/', class: 'project-link', onclick: (ev: Event) => { ev.preventDefault(); navigate('/'); } }, 'Projects'));
  bar.appendChild(el('span', { class: 'title' }, ps.project?.title ?? ps.shareProject?.title ?? ''));
  if (state.route.name === 'share') return bar;
  const canEdit = ps.role === 'owner' || ps.role === 'editor';
  const canSuggest = canEdit || ps.role === 'reviewer';
  const addBtn = (label: string, onclick: () => void, extra: Record<string, unknown> = {}) => {
    bar.appendChild(el('button', { onclick, ...extra }, label));
  };
  addBtn('Save', () => void doSave(), { disabled: ps.savePending });
  if (hasUnsavedChanges()) bar.appendChild(el('span', { class: 'unsaved' }, 'Unsaved changes'));
  const selection = sourceSelection();
  addBtn('Suggest edit', () => openSuggestDialog(), { disabled: !canSuggest || !selection, 'data-action': 'suggest' });
  addBtn('Comment', () => openCommentDialog(), { disabled: !canSuggest || selection?.start === selection?.end, 'data-action': 'comment' });
  addBtn('New file', () => { ps.dialog = { kind: 'new-file' }; rerender(); }, { disabled: !canEdit });
  addBtn('Upload file', () => { ps.dialog = { kind: 'upload' }; rerender(); }, { disabled: !canEdit });
  bar.appendChild(el('button', {
    onclick: () => { ps.dialog = { kind: 'citations' }; rerender(); },
  }, 'Citation warnings'));
  bar.appendChild(el('span', { class: 'spacer' }));
  bar.appendChild(el('span', { class: 'citation-check' }, state.citationMessage));
  addBtn('History', () => void openHistory());
  addBtn('People and sharing', () => void openPeople());
  addBtn('Submission check', () => { ps.dialog = { kind: 'submission' }; rerender(); });
  return bar;
}

/** The textarea's selection read at this moment, however it was set. */
function liveSelection(): { start: number; end: number } | null {
  const ta = document.getElementById('source-box') as HTMLTextAreaElement | null;
  if (!ta || !ps.openFile || ta.getAttribute('data-file') !== ps.openFile.id) return null;
  const start = ta.selectionStart ?? 0;
  const end = ta.selectionEnd ?? 0;
  if (start === 0 && end === 0) return null;
  return { start, end };
}

function sourceSelection(): { start: number; end: number } | null {
  if (!ps.openFile) return null;
  if (ps.selection) return ps.selection;
  const ta = document.getElementById('source-box') as HTMLTextAreaElement | null;
  if (!ta) return null;
  return { start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 };
}

function moreMenu(canEdit: boolean, canSuggest: boolean, selection: { start: number; end: number } | null): HTMLElement {
  const items: { label: string; action: () => void; disabled: boolean }[] = [
    { label: 'Suggest edit', action: () => openSuggestDialog(), disabled: !canSuggest || !selection },
    { label: 'Comment', action: () => openCommentDialog(), disabled: !canSuggest || !selection || selection.start === selection.end },
    { label: 'New file', action: () => { ps.dialog = { kind: 'new-file' }; rerender(); }, disabled: !canEdit },
    { label: 'Upload file', action: () => { ps.dialog = { kind: 'upload' }; rerender(); }, disabled: !canEdit },
    { label: 'Citation warnings', action: () => { ps.dialog = { kind: 'citations' }; rerender(); }, disabled: false },
    { label: 'History', action: () => void openHistory(), disabled: false },
    { label: 'People and sharing', action: () => void openPeople(), disabled: false },
    { label: 'Submission check', action: () => { ps.dialog = { kind: 'submission' }; rerender(); }, disabled: false },
  ];
  const menu = el('div', {
    class: 'menu', role: 'menu', 'aria-label': 'More',
    style: 'right:0;top:100%',
    onkeydown: (ev: Event) => {
      const kev = ev as KeyboardEvent;
      const nodes = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      const idx = nodes.findIndex((n) => n === document.activeElement);
      if (kev.key === 'ArrowDown') { kev.preventDefault(); nodes[(idx + 1) % nodes.length].focus(); }
      else if (kev.key === 'ArrowUp') { kev.preventDefault(); nodes[(idx - 1 + nodes.length) % nodes.length].focus(); }
      else if (kev.key === 'Home') { kev.preventDefault(); nodes[0].focus(); }
      else if (kev.key === 'End') { kev.preventDefault(); nodes[nodes.length - 1].focus(); }
      else if (kev.key === 'Escape') { ps.moreOpen = false; rerender(); requestFocus('more-button'); }
    },
  });
  items.forEach((item, i) => {
    const node = el('button', {
      role: 'menuitem',
      id: i === 0 ? 'menuitem-first' : (i === items.length - 1 ? 'menuitem-last' : ''),
      'aria-disabled': item.disabled ? 'true' : undefined,
      onclick: () => {
        if (item.disabled) return;
        ps.moreOpen = false;
        item.action();
      },
    }, item.label);
    if (item.disabled) node.setAttribute('aria-disabled', 'true');
    menu.appendChild(node);
  });
  return menu;
}

function renderProjectView(): HTMLElement {
  const shell = el('div', { class: 'project-shell' });
  const skip = el('a', {
    href: '#source-box', class: 'skip-link',
    onclick: (ev: Event) => {
      ev.preventDefault();
      if (ps.layout === 'phone') ps.phoneTab = 'source';
      requestFocus('source-box');
      rerender();
    },
  }, 'Skip to source');
  shell.appendChild(skip);
  const bar = toolbarButtons();
  if (ps.layout === 'phone') {
    bar.appendChild(el('span', { class: 'spacer' }));
    bar.appendChild(el('button', {
      id: 'more-button',
      'aria-haspopup': 'menu',
      'aria-expanded': ps.moreOpen ? 'true' : 'false',
      onclick: () => {
        ps.moreOpen = !ps.moreOpen;
        rerender();
        if (ps.moreOpen) queueMicrotask(() => {
          const item = document.getElementById(ps.moreFocusLast ? 'menuitem-last' : 'menuitem-first');
          item?.focus();
        });
        if (!ps.moreOpen) requestFocus('more-button');
      },
      onkeydown: (ev: Event) => {
        const kev = ev as KeyboardEvent;
        if (kev.key === 'Enter' || kev.key === ' ' || kev.key === 'ArrowDown') {
          kev.preventDefault(); ps.moreOpen = true; rerender(); requestFocus('menuitem-first');
        } else if (kev.key === 'ArrowUp') {
          kev.preventDefault(); ps.moreOpen = true; rerender(); requestFocus('menuitem-last');
        } else if (kev.key === 'Escape' && ps.moreOpen) {
          kev.preventDefault(); ps.moreOpen = false; rerender(); requestFocus('more-button');
        } else if (kev.key === 'Tab' && ps.moreOpen) {
          ps.moreOpen = false; rerender();
        }
      },
    }, 'More'));
    if (ps.moreOpen) {
      const wrap = el('span', { class: 'more-wrap' });
      wrap.appendChild(moreMenu(ps.role === 'owner' || ps.role === 'editor', (ps.role === 'owner' || ps.role === 'editor' || ps.role === 'reviewer'), sourceSelection()));
      bar.appendChild(wrap);
    }
  }
  shell.appendChild(bar);

  if (ps.layout === 'phone') {
    shell.appendChild(phoneTablist());
  }

  const columns = el('div', { class: 'columns' });
  if (ps.layout === 'desktop') {
    columns.appendChild(leftRail());
  }
  const centre = el('div', { class: `centre${ps.layout === 'phone' && ps.phoneTab === 'margin' ? ' phone-hidden' : ''}` });
  centre.appendChild(sourceArea());
  columns.appendChild(centre);
  const rail = marginRail();
  if (ps.layout === 'phone') {
    rail.classList.add('phone-visible');
    if (ps.phoneTab !== 'margin') rail.classList.add('phone-hidden');
  }
  columns.appendChild(rail);
  shell.appendChild(columns);

  const status = el('div', { class: 'statusline' },
    el('span', { role: 'status', 'aria-live': 'polite', id: 'project-updates' }, state.message),
    el('span', { role: 'status', 'aria-live': 'polite', id: 'storage-status', class: 'storage' }, state.storageMessage),
  );
  shell.appendChild(status);

  const dlg = renderDialogs();
  if (dlg) shell.appendChild(dlg);
  return shell;
}

function phoneTablist(): HTMLElement {
  const list = el('div', {
    class: 'tablist phone-visible', role: 'tablist', 'aria-label': 'Project view',
  });
  const sourceTab = el('button', {
    role: 'tab', 'aria-selected': ps.phoneTab === 'source' ? 'true' : 'false',
    'aria-controls': 'source-panel',
    onclick: () => { ps.phoneTab = 'source'; rerender(); },
    onkeydown: (ev: Event) => {
      const kev = ev as KeyboardEvent;
      if (kev.key === 'ArrowRight' || kev.key === 'ArrowLeft') {
        kev.preventDefault();
        ps.phoneTab = ps.phoneTab === 'source' ? 'margin' : 'source';
        rerender();
        requestFocus(ps.phoneTab === 'source' ? 'tab-source' : 'tab-margin');
      } else if (kev.key === 'Home') { kev.preventDefault(); ps.phoneTab = 'source'; rerender(); }
      else if (kev.key === 'End') { kev.preventDefault(); ps.phoneTab = 'margin'; rerender(); }
    },
  }, 'Source');
  sourceTab.id = 'tab-source';
  const marginTab = el('button', {
    role: 'tab', 'aria-selected': ps.phoneTab === 'margin' ? 'true' : 'false',
    'aria-controls': 'margin-panel',
    onclick: () => { ps.phoneTab = 'margin'; rerender(); },
    onkeydown: (ev: Event) => {
      const kev = ev as KeyboardEvent;
      if (kev.key === 'ArrowRight' || kev.key === 'ArrowLeft') {
        kev.preventDefault();
        ps.phoneTab = ps.phoneTab === 'source' ? 'margin' : 'source';
        rerender();
        requestFocus(ps.phoneTab === 'source' ? 'tab-source' : 'tab-margin');
      } else if (kev.key === 'Home') { kev.preventDefault(); ps.phoneTab = 'source'; rerender(); }
      else if (kev.key === 'End') { kev.preventDefault(); ps.phoneTab = 'margin'; rerender(); }
    },
  }, 'Margin');
  marginTab.id = 'tab-margin';
  list.appendChild(sourceTab);
  list.appendChild(marginTab);
  return list;
}

function leftRail(): HTMLElement {
  const rail = el('aside', { class: 'left-rail' });
  rail.appendChild(fileTree(false));
  const sections = el('nav', { 'aria-label': 'Sections' });
  const list = el('ul', { class: 'ruled-list', role: 'list', 'aria-label': 'Sections' });
  if (ps.openFile) {
    for (const s of sectionsOf(ps.openFile.content)) {
      list.appendChild(el('li', {}, el('a', {
        href: '#',
        onclick: (ev: Event) => {
          ev.preventDefault();
          const start = lineStart(ps.openFile?.content ?? '', s.line);
          const ta = document.getElementById('source-box') as HTMLTextAreaElement | null;
          if (ta) {
            ta.focus();
            ta.setSelectionRange(start, start);
            const lineH = 1.5 * 14;
            ta.scrollTop = (s.line - 1) * lineH;
          }
        },
      }, s.title)));
    }
  }
  sections.appendChild(list);
  rail.appendChild(sections);
  return rail;
}

interface TreeNode {
  path: string;
  children: Map<string, TreeNode>;
  fileId?: string;
  kind?: string;
}

function buildTree(files: FileSummary[]): TreeNode {
  const root: TreeNode = { path: '', children: new Map() };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    parts.forEach((part, idx) => {
      const isLeaf = idx === parts.length - 1;
      const childPath = node.path ? `${node.path}/${part}` : part;
      if (!node.children.has(part)) {
        node.children.set(part, { path: childPath, children: new Map() });
      }
      node = node.children.get(part) as TreeNode;
      if (isLeaf) {
        node.fileId = f.id;
        node.kind = f.kind;
      }
    });
  }
  return root;
}

function fileTree(inDialog: boolean): HTMLElement {
  const tree = el('div', {
    role: 'tree', 'aria-label': 'Project files',
    onkeydown: (ev: Event) => {
      const kev = ev as KeyboardEvent;
      const items = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))
        .filter((n) => n.getAttribute('aria-hidden') !== 'true' && n.offsetParent !== null);
      const idx = items.findIndex((n) => n === document.activeElement);
      if (kev.key === 'ArrowDown' && idx >= 0) { kev.preventDefault(); items[Math.min(idx + 1, items.length - 1)].focus(); }
      else if (kev.key === 'ArrowUp' && idx >= 0) { kev.preventDefault(); items[Math.max(idx - 1, 0)].focus(); }
      else if (kev.key === 'Home') { kev.preventDefault(); items[0]?.focus(); }
      else if (kev.key === 'End') { kev.preventDefault(); items[items.length - 1]?.focus(); }
    },
  });
  const root = buildTree(ps.files.length > 0 ? ps.files : ps.shareFiles);
  const openFilePath = ps.openFile?.path ?? ps.openFigure?.path;
  const renderNode = (node: TreeNode, depth: number) => {
    const entries = [...node.children.entries()].sort((a, b) => {
      const aFolder = (a[1].children.size > 0) ? 0 : 1;
      const bFolder = (b[1].children.size > 0) ? 0 : 1;
      if (aFolder !== bFolder) return aFolder - bFolder;
      return a[0] < b[0] ? -1 : 1;
    });
    for (const [name, child] of entries) {
      const isFolder = child.children.size > 0;
      if (isFolder) {
        const group = el('div', { role: 'group', 'aria-label': child.path });
        const folderItem = el('div', {
          role: 'treeitem', 'aria-expanded': 'true', tabindex: openFilePath?.startsWith(child.path + '/') ? '0' : '-1',
          'data-folder': child.path,
          onclick: () => { folderOpen[child.path] = !(folderOpen[child.path] ?? true); rerender(); },
          onkeydown: (ev: Event) => {
            const kev = ev as KeyboardEvent;
            if (kev.key === 'ArrowRight') { kev.preventDefault(); folderOpen[child.path] = true; rerender(); }
            else if (kev.key === 'ArrowLeft') { kev.preventDefault(); folderOpen[child.path] = false; rerender(); }
          },
        }, `${folderOpen[child.path] === false ? '▸' : '▾'} ${name}/`);
        group.appendChild(folderItem);
        if (folderOpen[child.path] !== false) {
          for (const sub of renderNodeInner(child, depth + 1)) group.appendChild(sub);
        }
        tree.appendChild(group);
      } else {
        tree.appendChild(leafItem(child, name));
      }
    }
  };
  const renderNodeInner = (node: TreeNode, depth: number): HTMLElement[] => {
    const out: HTMLElement[] = [];
    const entries = [...node.children.entries()].sort((a, b) => {
      const aFolder = (a[1].children.size > 0) ? 0 : 1;
      const bFolder = (b[1].children.size > 0) ? 0 : 1;
      if (aFolder !== bFolder) return aFolder - bFolder;
      return a[0] < b[0] ? -1 : 1;
    });
    for (const [name, child] of entries) {
      if (child.children.size > 0) {
        const group = el('div', { role: 'group', 'aria-label': child.path });
        group.appendChild(el('div', {
          role: 'treeitem', 'aria-expanded': 'true',
          onclick: () => { folderOpen[child.path] = !(folderOpen[child.path] ?? true); rerender(); },
        }, `${folderOpen[child.path] === false ? '▸' : '▾'} ${name}/`));
        if (folderOpen[child.path] !== false) {
          for (const sub of renderNodeInner(child, depth + 1)) group.appendChild(sub);
        }
        out.push(group);
      } else {
        out.push(leafItem(child, name));
      }
    }
    return out;
  };
  const leafItem = (child: TreeNode, name: string) => {
    const isOpen = child.path === openFilePath;
    const item = el('div', {
      role: 'treeitem',
      'aria-selected': isOpen ? 'true' : 'false',
      tabindex: isOpen ? '0' : '-1',
      'data-path': child.path,
      onclick: () => void chooseFile(child),
      onkeydown: (ev: Event) => {
        const kev = ev as KeyboardEvent;
        if (kev.key === 'Enter') void chooseFile(child);
      },
    }, name);
    return item;
  };
  void inDialog;
  renderNode(root, 0);
  return tree;
}

const folderOpen: Record<string, boolean> = {};

async function chooseFile(child: { fileId?: string; path: string }): Promise<void> {
  if (state.route.name === 'share' && ps.shareToken) {
    navigate(shareUrl(ps.shareToken, child.path), false);
    return;
  }
  const pid = ps.project?.id;
  if (!pid || !child.fileId) return;
  const file = ps.files.find((f) => f.id === child.fileId);
  if (!file) return;
  navigate(projectUrl(pid, { file: file.path }));
}

function sourceArea(): HTMLElement {
  const wrap = el('div', { class: 'source-area', id: 'source-panel' });
  if (ps.openFigure) {
    wrap.appendChild(figurePreview(ps.openFigure));
    return wrap;
  }
  if (!ps.openFile) return wrap;
  const header = el('div', { class: 'file-header' },
    el('span', { class: 'path' }, ps.openFile.path));
  if (ps.role === 'owner' || ps.role === 'editor') {
    header.appendChild(el('button', {
      id: `delete-${ps.openFile.id}`,
      onclick: () => {
        ps.dialog = { kind: 'delete-confirm', fid: ps.openFile?.id as string, path: ps.openFile?.path as string };
        rerender();
      },
    }, `Delete ${ps.openFile.path}`));
  }
  wrap.appendChild(header);

  const text = ps.draft;
  const readOnly = !(ps.role === 'owner' || ps.role === 'editor');
  const prior = carriedTextarea;
  const reuse = prior !== null && prior.getAttribute('data-file') === ps.openFile.id
    && prior.getAttribute('data-role') === (readOnly ? 'ro' : 'rw');
  const restoreSelection = ps.selection !== null && ps.selectionFile === ps.openFile.id;
  const textarea = (reuse ? prior : el('textarea', {
    id: 'source-box',
    class: 'source-box',
    'aria-label': `Source of ${ps.openFile.path}`,
    value: text,
    readonly: readOnly ? 'readonly' : undefined,
    spellcheck: 'false',
    'data-file': ps.openFile.id,
    'data-role': readOnly ? 'ro' : 'rw',
    oninput: (ev: Event) => {
      ps.draft = (ev.target as HTMLTextAreaElement).value;
      const marker = document.getElementById('unsaved-marker');
      if (marker) marker.textContent = hasUnsavedChanges() ? 'Unsaved changes' : '';
    },
    onkeydown: (ev: Event) => {
      const kev = ev as KeyboardEvent;
      if ((kev.ctrlKey || kev.metaKey) && kev.key === 's') {
        kev.preventDefault();
        void doSave();
      }
    },
    onselect: () => recordSelection(),
    onfocus: () => { sourceFocused = true; },
    onblur: () => { sourceFocused = false; },
  })) as HTMLTextAreaElement;
  ps.selectionFile = ps.openFile.id;
  if (textarea.value !== text) {
    // Newer text loads in place: the caret and selection follow the replaced span.
    const oldStart = ps.selection?.start ?? textarea.selectionStart ?? 0;
    const oldEnd = ps.selection?.end ?? textarea.selectionEnd ?? 0;
    const span = spanOfChange(textarea.value, text);
    const newStart = moveCaret(oldStart, span.a, span.b, span.n);
    const newEnd = moveCaret(oldEnd, span.a, span.b, span.n);
    textarea.value = text;
    textarea.setSelectionRange(Math.min(newStart, text.length), Math.min(newEnd, text.length));
    ps.selection = { start: Math.min(newStart, text.length), end: Math.min(newEnd, text.length) };
  }
  const lines = lineCount(text);
  const gutter = el('div', { class: 'gutter', 'aria-hidden': 'true' });
  for (let i = 1; i <= lines; i++) {
    gutter.appendChild(el('div', {}, String(i)));
  }
  const measure = el('div', { class: 'source-measure' });
  measure.appendChild(el('div', { class: 'source-wrap' }, gutter, textarea));
  wrap.appendChild(measure);
  // Appending into a fresh tree clears the textarea's selection: put it back.
  queueMicrotask(() => {
      if (pendingLine !== null) {
      const lineNo = Math.min(pendingLine, lineCount(textarea.value));
      const start = lineStart(textarea.value, lineNo);
      textarea.focus();
      textarea.setSelectionRange(start, start);
      textarea.scrollTop = (lineNo - 1) * 21;
      pendingLine = null;
      recordSelection();
      return;
    }
    if (restoreSelection) {
      const start = Math.min(ps.selection?.start ?? 0, textarea.value.length);
      const end = Math.min(ps.selection?.end ?? 0, textarea.value.length);
      textarea.setSelectionRange(start, end);
    }
  });
  return wrap;
}

/** The replaced span of a text change, by stripping common ends. */
function spanOfChange(oldText: string, newText: string): { a: number; b: number; n: number } {
  let a = 0;
  const maxA = Math.min(oldText.length, newText.length);
  while (a < maxA && oldText[a] === newText[a]) a++;
  let end = 0;
  const maxEnd = Math.min(oldText.length - a, newText.length - a);
  while (end < maxEnd && oldText[oldText.length - 1 - end] === newText[newText.length - 1 - end]) end++;
  return { a, b: oldText.length - end, n: newText.length - a - end };
}

function recordSelection(): void {
  const ta = document.getElementById('source-box') as HTMLTextAreaElement | null;
  if (!ta) return;
  lastSelection = { start: ta.selectionStart ?? 0, end: ta.selectionEnd ?? 0 };
  ps.selection = { ...lastSelection };
  updateToolbarSelection();
}

/** Enable Suggest edit and Comment from the live selection, without a rerender. */
function updateToolbarSelection(): void {
  const canSuggest = ps.role === 'owner' || ps.role === 'editor' || ps.role === 'reviewer';
  const sel = ps.selection;
  const suggestBtns = document.querySelectorAll<HTMLButtonElement>('[data-action="suggest"]');
  const commentBtns = document.querySelectorAll<HTMLButtonElement>('[data-action="comment"]');
  for (const b of suggestBtns) b.disabled = !canSuggest || sel === null;
  for (const b of commentBtns) b.disabled = !canSuggest || sel === null || sel.start === sel.end;
  for (const b of suggestBtns) b.toggleAttribute('aria-disabled', !canSuggest || sel === null);
}

function figurePreview(file: FileSummary): HTMLElement {
  const wrap = el('div', { class: 'figure-preview' });
  const header = el('div', { class: 'file-header' }, el('span', { class: 'path' }, file.path));
  if (ps.role === 'owner' || ps.role === 'editor') {
    header.appendChild(el('button', {
      id: `delete-${file.id}`,
      onclick: () => {
        ps.dialog = { kind: 'delete-confirm', fid: file.id, path: file.path };
        rerender();
      },
    }, `Delete ${file.path}`));
  }
  wrap.appendChild(header);
  if (ps.figureAvailable[file.id] === false) {
    wrap.appendChild(el('p', { class: 'figure-unavailable' }, 'Figure unavailable'));
    wrap.appendChild(el('p', { class: 'meta' }, `${file.path}, ${file.size} bytes, ${'contentType' in file ? file.contentType : ''}`));
    return wrap;
  }
  const img = el('img', {
    alt: file.path,
    id: `figure-${file.id}`,
  });
  const src = state.route.name === 'share'
    ? `/api/share/${ps.shareToken}/files/${file.id}/raw`
    : `/api/projects/${ps.project?.id}/files/${file.id}/raw`;
  (img as HTMLImageElement).src = src;
  (img as HTMLImageElement).onerror = () => {
    ps.figureAvailable[file.id] = false;
    state.storageMessage = 'Figure storage unavailable. Text editing still works; try again shortly.';
    ps.storageStamp = Date.now();
    rerender();
  };
  (img as HTMLImageElement).onload = () => {
    ps.figureAvailable[file.id] = true;
  };
  wrap.appendChild(img);
  wrap.appendChild(el('p', { class: 'meta' }, `${file.path}, ${file.size} bytes, ${'contentType' in file ? file.contentType : ''}`));
  return wrap;
}

function marginRail(): HTMLElement {
  const rail = el('aside', {
    class: 'margin-rail', role: 'complementary', 'aria-label': 'Margin', id: 'margin-panel',
  });
  const orphans = orphansOf(ps.suggestions, ps.threads);
  const cbs: CardCallbacks = {
    canDecide: ps.role === 'owner' || ps.role === 'editor',
    canReply: ps.role === 'owner' || ps.role === 'editor' || ps.role === 'reviewer',
    canResolve: ps.role === 'owner' || ps.role === 'editor',
    shareMode: state.route.name === 'share',
    focusedId: ps.focusedCard ?? undefined,
    pendingId: ps.pendingCard ?? undefined,
    onAccept: (s) => void resolveSuggestion(projectHandle(), s, 'accept'),
    onReject: (s) => void resolveSuggestion(projectHandle(), s, 'reject'),
    onReply: (t, body) => void postReply(projectHandle(), t, body),
    onResolve: (t) => void resolveThread(projectHandle(), t),
    onFocus: (item) => {
      ps.focusedCard = item.id;
      const file = ps.files.find((f) => f.id === item.fileId);
      if (file && file.id !== ps.openFile?.id) {
        void chooseFile({ fileId: file.id, path: file.path });
      }
    },
  };
  if (orphans.length > 0) {
    const group = el('section', { class: 'orphaned-group', role: 'region', 'aria-label': 'Orphaned' });
    group.appendChild(el('h3', {}, 'Orphaned'));
    for (const item of orphans) group.appendChild(cardNode(item, cbs));
    rail.appendChild(group);
  }
  if (ps.openFile) {
    const fileCards = documentOrder(ps.suggestions, ps.threads, ps.openFile.id);
    for (const item of fileCards) rail.appendChild(cardNode(item, cbs));
  }
  return rail;
}

// ---------- Dialog helpers ----------
function openSuggestDialog(): void {
  if (!ps.openFile) return;
  const sel = liveSelection() ?? sourceSelection();
  if (!sel) return;
  const from = storedOffset(ps.openFile.content, sel.start);
  const to = storedOffset(ps.openFile.content, sel.end);
  ps.dialog = { kind: 'suggest', from, to };
  rerender();
}

function openCommentDialog(): void {
  if (!ps.openFile) return;
  const sel = liveSelection() ?? sourceSelection();
  if (!sel || sel.start === sel.end) return;
  const from = storedOffset(ps.openFile.content, sel.start);
  const to = storedOffset(ps.openFile.content, sel.end);
  ps.dialog = { kind: 'comment', from, to };
  rerender();
}

async function openHistory(): Promise<void> {
  const [history, labels] = await Promise.all([
    api.getHistory(ps.project?.id as string),
    api.getLabels(ps.project?.id as string),
  ]);
  ps.historyEntries = history.entries;
  ps.labels = labels.labels;
  ps.dialog = { kind: 'history' };
  rerender();
}

async function openPeople(): Promise<void> {
  const pid = ps.project?.id as string;
  ps.members = (await api.getMembers(pid)).members;
  if (ps.role === 'owner') {
    const [invites, shareLink] = await Promise.all([
      api.getInvites(pid), api.getShareLink(pid),
    ]);
    ps.invites = invites.invites;
    ps.shareLink = shareLink.shareLink;
  }
  ps.dialog = { kind: 'people' };
  rerender();
}

function projectHandle(): ProjectHandle {
  return {
    pid: ps.project?.id as string,
    role: ps.role,
    openFile: ps.openFile,
    draft: ps.draft,
    lastLoadedRevision: ps.lastLoadedRevision,
    suggestions: ps.suggestions,
    threads: ps.threads,
    members: ps.members,
    invites: ps.invites,
    setInvites: (invites) => { ps.invites = invites; },
    historyEntries: ps.historyEntries,
    labels: ps.labels,
    citationReport: ps.citationReport,
    files: ps.files,
    exportResult: ps.exportResult,
    exportBusy: ps.exportBusy,
    shareLink: ps.shareLink,
    focusedCard: ps.focusedCard,
    pendingCard: ps.pendingCard,
    lastActionSeq: ps.lastActionSeq,
    uploadFile: ps.uploadFile,
    uploadFolder: ps.uploadFolder,
    dialog: ps.dialog,
    message: (m) => { state.message = m; },
    storageMessage: (m) => { state.storageMessage = m; },
    roleChanged: (role) => { ps.role = role; },
    refresh: () => refresh(),
    openFileByPath: async (path) => {
      const file = ps.files.find((f) => f.path === path);
      if (file) await openFile(file);
    },
  };
}

function renderDialogs(): HTMLElement | null {
  const dialog = ps.dialog;
  if (!dialog) return null;
  const close = () => { ps.dialog = null; rerender(); };
  const h = projectHandle();
  switch (dialog.kind) {
    case 'suggest':
      return suggestDialog(h, dialog.from, dialog.to, close);
    case 'comment':
      return commentDialog(h, dialog.from, dialog.to, close);
    case 'new-file':
      return newFileDialog(h, close);
    case 'upload':
      return uploadDialog(h, close);
    case 'delete-confirm':
      return deleteConfirm(h, dialog.fid, dialog.path, close);
    case 'stale':
      return staleDialog(h, dialog.current, dialog.unsaved, close);
    case 'history':
      return historyDialog(h, close);
    case 'people':
      return peopleDialog(h, close);
    case 'citations':
      return citationsDialog(h, close);
    case 'submission':
      return submissionDialog(h, close);
    case 'restore-confirm':
      return restoreConfirm(h, dialog.label.name, () => { ps.dialog = { kind: 'history' }; rerender(); });
    case 'new-project':
      return newProjectDialog(close);
    case 'profile':
      return profileDialog(close);
    default:
      return null;
  }
}

function newProjectDialog(close: () => void): HTMLElement {
  let title = '';
  let template = 'thesis-numbered';
  let error: string | undefined;
  return dialogFrame({ title: 'New project', close }, (body) => {
    const titleInput = el('input', {
      type: 'text', id: 'np-title', 'aria-label': 'Title',
      oninput: (e: Event) => { title = (e.target as HTMLInputElement).value; },
    }) as HTMLInputElement;
    const field = el('div', { class: 'field' }, el('label', { for: 'np-title' }, 'Title'), titleInput);
    const errBox = el('div', { id: 'np-error' });
    field.appendChild(errBox);
    body.appendChild(field);
    const group = el('div', { class: 'field', role: 'radiogroup', 'aria-label': 'Template' });
    for (const t of [{ id: 'thesis-numbered', name: 'Thesis, numbered chapters' }, { id: 'article-single', name: 'Article, single file' }]) {
      const input = el('input', {
        type: 'radio', name: 'template', id: `tpl-${t.id}`, value: t.id,
        onchange: () => { template = t.id; },
      }) as HTMLInputElement;
      if (t.id === template) input.checked = true;
      group.appendChild(el('label', { for: `tpl-${t.id}` }, input, ` ${t.name}`));
    }
    body.appendChild(group);
    body.appendChild(el('div', { class: 'actions-row' },
      el('button', {
        class: 'primary',
        onclick: async () => {
          error = undefined;
          if (title.trim().length < 1 || title.length > 120) {
            error = 'Enter a title of 1 to 120 characters.';
            errBox.replaceChildren(el('p', { class: 'field-error', role: 'alert' }, error));
            titleInput.focus();
            return;
          }
          try {
            const res = await api.postProject(title, template);
            state.workspaceRole = state.workspaceRole ?? 'owner';
            close();
            navigate(projectUrl(res.project.id, { file: 'main.tex' }));
            requestFocus('source-box');
          } catch (e) {
            if (isFail(e) && e.shape.status === 422) {
              error = 'Enter a title of 1 to 120 characters.';
              errBox.replaceChildren(el('p', { class: 'field-error', role: 'alert' }, error));
              titleInput.focus();
            } else {
              state.message = 'Something went wrong. Try again.';
              rerender();
            }
          }
        },
      }, 'Create project')));
    queueMicrotask(() => titleInput.focus());
  });
}

function profileDialog(close: () => void): HTMLElement {
  let name = state.me?.displayName ?? '';
  return dialogFrame({ title: 'Profile', close }, (body) => {
    const input = el('input', {
      type: 'text', id: 'pf-name', 'aria-label': 'Display name', value: name,
      oninput: (e: Event) => { name = (e.target as HTMLInputElement).value; },
    }) as HTMLInputElement;
    input.value = name;
    const field = el('div', { class: 'field' }, el('label', { for: 'pf-name' }, 'Display name'), input);
    const errBox = el('div', { id: 'pf-error' });
    field.appendChild(errBox);
    body.appendChild(field);
    body.appendChild(el('div', { class: 'actions-row' },
      el('button', {
        class: 'primary',
        onclick: async () => {
          if (name.trim().length < 1 || name.trim().length > 80) {
            errBox.replaceChildren(el('p', { class: 'field-error', role: 'alert' }, 'Enter a display name of 1 to 80 characters.'));
            input.focus();
            return;
          }
          try {
            const res = await api.patchMe(name);
            state.me = res.user;
            close();
            rerender();
          } catch {
            errBox.replaceChildren(el('p', { class: 'field-error', role: 'alert' }, 'Something went wrong. Try again.'));
          }
        },
      }, 'Save name')));
    queueMicrotask(() => input.focus());
  });
}

// ---------- Share draft view ----------
function renderShareView(): HTMLElement {
  const shell = el('div', { class: 'project-shell' });
  if (!ps.shareProject) {
    shell.appendChild(el('div', { class: 'page' }, el('h1', {}, 'This link is no longer active')));
    return shell;
  }
  shell.appendChild(el('div', { class: 'share-banner', role: 'banner' }, el('strong', {}, 'Read-only view'), el('span', {}, ps.shareProject.title)));
  const bar = el('div', { class: 'toolbar' });
  if (ps.layout !== 'desktop') {
    bar.appendChild(el('button', {
      onclick: () => { ps.dialog = { kind: 'files-dialog' }; rerender(); },
    }, 'Files'));
  }
  shell.appendChild(bar);
  if (ps.layout === 'phone') {
    shell.appendChild(phoneTablist());
  }
  const columns = el('div', { class: 'columns' });
  if (ps.layout === 'desktop') {
    columns.appendChild(leftRail());
  }
  const centre = el('div', { class: `centre${ps.layout === 'phone' && ps.phoneTab === 'margin' ? ' phone-hidden' : ''}` });
  centre.appendChild(sourceArea());
  columns.appendChild(centre);
  const rail = marginRail();
  if (ps.layout === 'phone') {
    rail.classList.add('phone-visible');
    if (ps.phoneTab !== 'margin') rail.classList.add('phone-hidden');
  }
  columns.appendChild(rail);
  shell.appendChild(columns);
  if (ps.dialog?.kind === 'files-dialog') {
    shell.appendChild(filesDialogNode());
  }
  return shell;
}

function filesDialogNode(): HTMLElement {
  const close = () => { ps.dialog = null; rerender(); };
  return dialogFrame({ title: 'Project files', close }, (body) => {
    const tree = fileTree(true);
    body.appendChild(tree);
  });
}
