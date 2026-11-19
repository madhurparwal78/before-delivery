// The wall: the workspace's masonry of references, the cluster tray, and the
// sprocket strip for plucking frames.

import type { ApiError, Cluster, ClusterSummary, Reference, WorkspaceResponse } from '../../shared/types.js';
import { FEED_PAGE_SIZE, STATUS_LABELS } from '../../shared/constants.js';
import { api, announce, el, link, navigate, notFoundPage, session } from '../lib.js';
import { topBar } from '../app.js';
import { errorSummary, clearInvalid, formField, markInvalid } from './signin.js';
import { ClipDetailsDialog } from './clip-details.js';
import { AddToClusterDialog } from './add-to-cluster.js';
import { NewClusterDialog } from './new-cluster.js';
import { SprocketStrip } from './strip.js';
import { Tray } from './tray.js';
import { timecodeOf } from '../../shared/domain.js';

const TRAY_KEY = 'rushes.activeCluster';

export interface WallState {
  slug: string;
  workspace: WorkspaceResponse | null;
  references: Reference[];
  clusters: ClusterSummary[];
  query: string | null;
  trayCluster: Cluster | null;
  strip: SprocketStrip | null;
}

export async function renderWall(slug: string, params: URLSearchParams): Promise<HTMLElement> {
  const acc = session()?.account ?? null;
  if (!acc) {
    navigate(`/signin?next=${encodeURIComponent(`/w/${slug}`)}`, true);
    return el('div');
  }
  const wsRes = await api<WorkspaceResponse>('GET', `/api/workspaces/${slug}`);
  if (!wsRes.ok) return notFoundPage();
  const workspace = wsRes.data!;

  const state: WallState = {
    slug,
    workspace,
    references: [],
    clusters: [],
    query: params.get('q'),
    trayCluster: null,
    strip: null,
  };

  const page = el('div', { class: 'wall-page' });
  page.append(topBar({ account: acc, currentSlug: slug }));

  // Tools: search + upload.
  const tools = el('div', { class: 'wall-tools' });
  const searchForm = el('form', { role: 'search', class: 'search-wrap', id: 'wall-search' }) as HTMLFormElement;
  const searchBox = el('input', {
    type: 'search',
    id: 'wall-search-box',
    placeholder: 'Search this brand',
    value: state.query ?? '',
    'aria-label': 'Search references and clusters',
  }) as HTMLInputElement;
  const searchStatus = el('div', { id: 'search-status', role: 'status', class: 'visually-hidden' });
  searchStatus.setAttribute('aria-live', 'polite');
  searchForm.append(searchBox, searchStatus);
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = searchBox.value;
    if (q.length >= 101) {
      // Pressing Enter on text that is too long shows the error summary.
      document.getElementById('wall-error-summary')?.remove();
      const summary = errorSummary({ q: 'Enter 1 to 100 characters.' }, { q: 'wall-search-box' });
      summary.id = 'wall-error-summary';
      searchForm.before(summary);
      summary.focus();
      markInvalid(searchBox, 'Enter 1 to 100 characters.');
      return;
    }
    runSearch(q, true);
  });
  tools.append(searchForm);

  const uploadBtn = el('button', { class: 'btn', id: 'upload-btn' }, 'Upload');
  uploadBtn.setAttribute('aria-label', 'Upload references');
  uploadBtn.addEventListener('click', () => uploadFlow(state));
  tools.append(uploadBtn);

  const wallAnnouncements = el('div', { id: 'wall-announcements', role: 'status', class: 'visually-hidden' });
  wallAnnouncements.setAttribute('aria-live', 'polite');
  tools.append(wallAnnouncements);

  const layout = el('div', { class: 'wall-layout' });
  const main = el('div', { class: 'wall-main' });
  const resultsRegion = el('section', { id: 'search-results', 'aria-label': 'Search results', class: 'stack' });
  const wallRegion = el('section', { id: 'reference-wall', 'aria-label': 'Reference wall' });
  const masonry = el('div', { class: 'masonry' }) as HTMLDivElement;
  const list = el('ul', { id: 'references-list', 'aria-label': 'References' });
  masonry.append(list);
  wallRegion.append(masonry);

  main.append(tools, resultsRegion, wallRegion);
  const tray = new Tray(state);
  layout.append(main, tray.node);
  page.append(layout);

  // --- Search ------------------------------------------------------------
  let searchTimer: number | undefined;
  let searchSeq = 0;

  async function runSearch(q: string, commit: boolean): Promise<void> {
    const trimmed = q;
    if (trimmed.length >= 101) {
      searchStatus.textContent = 'Enter 1 to 100 characters.';
      announce('search-field-error', 'Enter 1 to 100 characters.');
      return;
    }
    if (trimmed === '') {
      const seq = ++searchSeq;
      void seq;
      state.query = null;
      resultsRegion.replaceChildren();
      resultsRegion.hidden = true;
      wallRegion.hidden = false;
      searchStatus.textContent = '';
      // Clearing replaces the current entry with the address without q.
      history.replaceState(null, '', `/w/${slug}`);
      await loadReferences();
      return;
    }
    searchStatus.textContent = 'Searching...';
    const thisQuery = trimmed;
    const seq = ++searchSeq;
    const r = await api<{ query: string; counts: { clusters: number; references: number }; clusters: ClusterSummary[]; references: Reference[] }>(
      'GET',
      `/api/workspaces/${slug}/search?q=${encodeURIComponent(thisQuery)}`,
    );
    if (seq !== searchSeq) return; // a later answer wins
    if (thisQuery !== searchBox.value) return; // stale answer
    if (!r.ok) {
      searchStatus.textContent = 'The search could not run. Try again.';
      return;
    }
    const data = r.data!;
    state.query = thisQuery;
    wallRegion.hidden = true;
    resultsRegion.hidden = false;
    resultsRegion.replaceChildren();
    const clusterHeading = el('h2', { id: 'cluster-count' }, `${data.counts.clusters} clusters`);
    const clusterList = el('ul', { class: 'search-clusters stack' });
    for (const c of data.clusters) {
      clusterList.append(el('li', {},
        link(`/w/${slug}/clusters/${c.id}`, c.title, 'search-cluster-link'),
        el('span', { class: 'muted small' }, `${STATUS_LABELS[c.status] ?? c.status} · ${c.itemCount} items`),
      ));
    }
    const refHeading = el('h2', { id: 'ref-count' }, `${data.counts.references} references`);
    const refList = el('ul', { class: 'search-refs stack' });
    for (const ref of data.references) {
      refList.append(el('li', {}, referenceCard(state, ref)));
    }
    resultsRegion.append(clusterHeading, clusterList, refHeading, refList);
    const summary =
      data.counts.clusters === 0 && data.counts.references === 0
        ? `Nothing in ${workspace!.name} matches ${thisQuery}.`
        : `${data.counts.clusters} clusters and ${data.counts.references} references match ${thisQuery}.`;
    searchStatus.textContent = summary;
    if (commit) {
      history.replaceState(null, '', `/w/${slug}?q=${encodeURIComponent(thisQuery)}`);
    } else if (state.query !== null) {
      history.replaceState(null, '', `/w/${slug}?q=${encodeURIComponent(thisQuery)}`);
    }
  }

  searchBox.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    const q = searchBox.value;
    if (q.length >= 101) {
      searchStatus.textContent = 'Enter 1 to 100 characters.';
      return;
    }
    searchTimer = window.setTimeout(() => {
      void runSearch(searchBox.value, false);
    }, 250);
  });

  // Initial state: run the search from the address, or load the wall.
  if (state.query !== null && state.query !== '') {
    await runSearch(state.query, false);
  } else {
    resultsRegion.hidden = true;
    await loadReferences();
  }

  async function loadReferences(): Promise<void> {
    const r = await api<{ items: Reference[] }>('GET', `/api/workspaces/${slug}/references?limit=50`);
    if (r.ok) {
      state.references = r.data!.items;
      renderWallCards(state, list);
    }
  }

  void FEED_PAGE_SIZE;

  return page;
}

export function renderWallCards(state: WallState, list: HTMLUListElement): void {
  list.replaceChildren();
  for (const ref of state.references) {
    list.append(el('li', {}, referenceCard(state, ref)));
  }
}

export function referenceCard(state: WallState, ref: Reference): HTMLElement {
  const card = el('article', { class: 'ref-card', 'data-ref-id': ref.id });
  const isClip = ref.kind === 'clip';
  const isStill = ref.kind === 'still';

  let media: HTMLElement;
  if (isClip) {
    const video = el('video', { src: ref.mediaUrl, preload: 'metadata', muted: true }) as HTMLVideoElement;
    media = video;
  } else {
    const img = el('img', { src: ref.mediaUrl, alt: '', loading: 'lazy' }) as HTMLImageElement;
    img.addEventListener('error', () => {
      const note = el('div', { class: 'ref-preview-unavailable' }, 'Preview unavailable');
      img.replaceWith(note);
    });
    media = img;
  }
  card.append(media);

  const title = el('div', { class: 'ref-title-full' }, ref.title);
  if (isClip) {
    title.append(el('span', { class: 'clip-tag' }, ` · ${ref.totalFrames} frames`));
  }
  if (isStill && ref.sourceClipTitle && ref.timecode) {
    title.append(el('div', { class: 'still-meta' }, `${ref.sourceClipTitle} · ${ref.timecode}`));
  }
  card.append(title);

  const actions = el('div', { class: 'ref-actions' });
  const addBtn = el('button', { class: 'btn small' }, 'Add to cluster');
  addBtn.setAttribute('aria-label', `Add ${ref.title} to cluster`);
  addBtn.addEventListener('click', () => {
    const dialog = new AddToClusterDialog(state, ref, addBtn);
    dialog.open();
  });
  actions.append(addBtn);

  if (isClip) {
    const openBtn = el('button', { class: 'btn small' }, 'Open clip');
    openBtn.setAttribute('aria-label', `Open clip ${ref.title}`);
    openBtn.addEventListener('click', () => {
      openStrip(state, ref, openBtn);
    });
    actions.append(openBtn);
  }
  card.append(actions);
  return card;
}

export function openStrip(state: WallState, clip: Reference, opener: HTMLElement): void {
  if (state.strip) {
    state.strip.close();
  }
  const strip = new SprocketStrip(state, clip, opener);
  state.strip = strip;
  strip.open();
}

export async function uploadFlow(state: WallState): Promise<void> {
  const input = el('input', { type: 'file', multiple: true, accept: 'image/jpeg,image/png,image/webp,video/mp4,video/webm' }) as HTMLInputElement;
  input.addEventListener('change', async () => {
    const files = Array.from(input.files ?? []);
    for (const file of files) {
      await uploadOne(state, file);
    }
  });
  input.click();
}

async function uploadOne(state: WallState, file: File): Promise<void> {
  const isClip = /\.(mp4|webm)$/i.test(file.name) || file.type.startsWith('video/');
  if (isClip) {
    const dialog = new ClipDetailsDialog(state, file);
    dialog.open();
    return;
  }
  announce('wall-announcements', `Uploading ${file.name}...`);
  const form = new FormData();
  form.append('file', file, file.name);
  const r = await api<Reference>('POST', `/api/workspaces/${state.slug}/references`, form);
  if (r.ok && r.data) {
    state.references.unshift(r.data);
    const list = document.getElementById('references-list') as HTMLUListElement | null;
    if (list) {
      list.prepend(el('li', {}, referenceCard(state, r.data)));
    }
    announce('wall-announcements', `Uploaded ${r.data.title}.`);
  } else {
    const err = r.error as ApiError | null;
    const code = err?.error;
    if (code === 'storage_unavailable') {
      announce('wall-announcements', `Storage is unreachable. ${file.name} was not uploaded.`);
    } else if (code === 'too_large') {
      announce('wall-announcements', `${file.name} is larger than the limit for its type.`);
    } else if (code === 'unsupported_media_type') {
      announce('wall-announcements', `${file.name} is not a supported image or clip.`);
    } else if (code === 'seat_required') {
      announce('wall-announcements', 'You need a pro seat to make changes. Ask your design ops lead.');
    } else {
      announce('wall-announcements', `${file.name} was not uploaded.`);
    }
  }
}

export function rememberTrayCluster(clusterId: string): void {
  try {
    localStorage.setItem(TRAY_KEY, clusterId);
  } catch {
    // private mode
  }
}

export function recalledTrayCluster(): string | null {
  try {
    return localStorage.getItem(TRAY_KEY);
  } catch {
    return null;
  }
}

export function clusterStatusTag(status: string): HTMLElement {
  const icons: Record<string, string> = {
    draft: 'icon-pencil',
    in_review: 'icon-eye',
    embargoed: 'icon-clock',
    public: 'icon-globe',
    withdrawn: 'icon-archived',
  };
  const span = el('span', { class: 'status-label' });
  span.append(el('span', { class: `icon ${icons[status] ?? ''}`, 'aria-hidden': 'true' }));
  span.append(STATUS_LABELS[status] ?? status);
  return span;
}

export function timecodeFor(ref: Reference): string | null {
  if (ref.kind === 'still' && ref.frameIndex !== null && ref.timecode) return ref.timecode;
  return null;
}
