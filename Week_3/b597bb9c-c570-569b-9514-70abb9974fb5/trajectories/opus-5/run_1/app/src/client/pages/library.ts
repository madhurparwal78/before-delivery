/** The media library: a contact sheet of files grouped by folder, and resumable uploads. */
import { ApiCallError, call, get, post, remove } from '../api.js';
import { openDialog } from '../dialog.js';
import { clear, el, find, findAll } from '../dom.js';
import { band, loadAllowance, loadStatus, mount, notice, noticesStrip, renderOutages, setAllowance, shared } from '../shell.js';
import { checksumColour } from '../../domain/layers.js';
import type { AllowanceRecord, MediaRecord } from '../../shared/types.js';

interface OpenUpload {
  upload_id: string;
  file_name: string;
  folder: string;
  bytes: number;
  sha256: string;
  chunks: number;
  chunks_received: number[];
  state: string;
}

const CHUNK_BYTES = 5242880;

async function checksumOf(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function progressRow(name: string, percent: number, copy: string): HTMLElement {
  return el('li', { class: 'upload-row' }, [
    el('div', {
      class: 'progress',
      role: 'progressbar',
      'aria-label': name,
      'aria-valuenow': String(percent),
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuetext': copy,
      'data-upload-name': name,
      text: copy,
    }),
  ]);
}

function percentOf(received: number, chunks: number): number {
  return Math.floor((received / Math.max(1, chunks)) * 100);
}

async function renderUploads(): Promise<OpenUpload[]> {
  const list = find<HTMLElement>('[data-uploads]');
  if (list === null) return [];
  let items: OpenUpload[] = [];
  try {
    items = (await get<{ items: OpenUpload[] }>('/api/uploads')).items;
  } catch {
    items = [];
  }
  clear(list);
  for (const upload of items) {
    const percent = percentOf(upload.chunks_received.length, upload.chunks);
    list.append(
      progressRow(upload.file_name, percent, `${upload.file_name} — ${percent}% · choose the file again to resume`),
    );
  }
  return items;
}

function mediaTile(item: MediaRecord): HTMLElement {
  const colour = checksumColour(item.sha256);
  const figure = el('div', { class: 'media-tile', 'data-media-id': item.id, 'data-kind': item.kind });
  if (item.kind === 'wav') {
    const strip = el('div', { class: 'waveform', 'data-waveform': item.id, role: 'img', 'aria-label': `${item.name} waveform` });
    figure.append(strip);
    void get<{ peaks: number[] }>(`/api/media/${item.id}/peaks`)
      .then((payload) => {
        const points = payload.peaks
          .map((peak, index) => `${(index / (payload.peaks.length - 1)) * 100},${50 - peak * 50}`)
          .concat(
            payload.peaks
              .map((peak, index) => `${((payload.peaks.length - 1 - index) / (payload.peaks.length - 1)) * 100},${50 + peak * 50}`),
          )
          .join(' ');
        strip.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="${points}" fill="#ffffff"></polygon></svg>`;
      })
      .catch(() => undefined);
  } else {
    const ratio = item.width !== null && item.height !== null ? `${item.width} / ${item.height}` : '16 / 9';
    figure.append(
      el('div', {
        class: 'media-box',
        role: 'img',
        'aria-label': item.name,
        style: `aspect-ratio: ${ratio}; background:${colour}`,
      }),
    );
  }
  figure.append(el('p', { class: 'media-name', text: item.name }));
  figure.append(el('button', { type: 'button', class: 'delete-media', 'data-delete': item.id, text: `Delete ${item.name}` }));
  return figure;
}

function deleteDialog(item: MediaRecord, opener: HTMLElement | null, refresh: () => void): void {
  const handle = openDialog(
    'Delete media',
    [
      el('p', { text: `${item.name} will be removed from the library.` }),
      el('div', { class: 'dialog-actions' }, [
        el('button', { type: 'button', class: 'primary', 'data-confirm': '', text: 'Delete' }),
        el('button', { type: 'button', 'data-keep': '', text: 'Keep' }),
      ]),
    ],
    opener,
  );
  find<HTMLButtonElement>('[data-keep]', handle.dialog)?.addEventListener('click', handle.close);
  find<HTMLButtonElement>('[data-confirm]', handle.dialog)?.addEventListener('click', () => {
    void remove(`/api/media/${item.id}`)
      .then(() => {
        handle.close();
        notice(`${item.name} deleted.`);
        refresh();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) notice(error.failure.message);
        handle.close();
      });
  });
}

async function renderSheet(query: string): Promise<void> {
  const host = find<HTMLElement>('[data-library-sheet]');
  if (host === null) return;
  let page: { items: MediaRecord[] };
  try {
    page = await get<{ items: MediaRecord[] }>(`/api/media?limit=100${query === '' ? '' : `&q=${encodeURIComponent(query)}`}`);
  } catch (error) {
    if (error instanceof ApiCallError) {
      notice(error.failure.errors?.q ?? error.failure.message);
      return;
    }
    return;
  }
  clear(host);
  if (page.items.length === 0) {
    host.append(
      el('p', {
        class: 'empty',
        text: query === '' ? 'No files yet. Upload rushes to start the library.' : `No files match ${query}.`,
      }),
    );
    return;
  }
  const folders = [...new Set(page.items.map((item) => item.folder))];
  for (const folder of folders) {
    const items = page.items.filter((item) => item.folder === folder);
    const used = [...new Set(items.flatMap((item) => item.used_in))];
    host.append(
      el('section', { class: 'folder', role: 'group', 'aria-label': folder }, [
        el('p', { class: 'folder-title', text: folder }),
        el('p', { class: 'muted folder-used', text: used.length === 0 ? 'Not used yet' : `Used in ${used.join(', ')}` }),
        el('div', { class: 'folder-run' }, items.map(mediaTile)),
      ]),
    );
  }
  for (const button of findAll<HTMLButtonElement>('[data-delete]', host)) {
    button.addEventListener('click', () => {
      const item = page.items.find((candidate) => candidate.id === button.dataset.delete);
      if (item !== undefined) deleteDialog(item, button, () => void renderSheet(query));
    });
  }
}

async function sendUpload(file: File, open: OpenUpload[]): Promise<void> {
  const sha256 = await checksumOf(file);
  const existing = open.find((upload) => upload.sha256 === sha256);
  let created: { upload_id: string; chunks: number; chunks_received: number[]; duplicate?: boolean; media?: MediaRecord };
  try {
    created = await post<typeof created>('/api/uploads', {
      file_name: file.name,
      bytes: file.size,
      sha256,
      folder: existing?.folder ?? 'Uploads',
    });
  } catch (error) {
    if (error instanceof ApiCallError) notice(error.failure.message);
    return;
  }
  if (created.duplicate === true && created.media !== undefined) {
    notice(`${file.name} is already in the library as ${created.media.name}.`);
    return;
  }
  const chunks = created.chunks;
  const received = new Set(created.chunks_received);
  const bar = find<HTMLElement>(`[data-upload-name="${CSS.escape(file.name)}"]`);
  const show = (): void => {
    const percent = percentOf(received.size, chunks);
    const copy = `Uploading ${file.name} — ${percent}%`;
    const node = bar ?? find<HTMLElement>(`[data-upload-name="${CSS.escape(file.name)}"]`);
    if (node !== null) {
      node.textContent = copy;
      node.setAttribute('aria-valuenow', String(percent));
      node.setAttribute('aria-valuetext', copy);
    }
  };
  show();
  for (let n = 0; n < chunks; n += 1) {
    if (received.has(n)) continue;
    const slice = file.slice(n * CHUNK_BYTES, Math.min(file.size, (n + 1) * CHUNK_BYTES));
    try {
      await call('PUT', `/api/uploads/${created.upload_id}/chunks/${n}`, new Uint8Array(await slice.arrayBuffer()));
    } catch (error) {
      if (error instanceof ApiCallError) notice(error.failure.message);
      return;
    }
    received.add(n);
    show();
  }
  try {
    const done = await post<{ duplicate: boolean; media: MediaRecord }>(`/api/uploads/${created.upload_id}/complete`);
    notice(
      done.duplicate
        ? `${file.name} is already in the library as ${done.media.name}.`
        : `${file.name} is in the library.`,
    );
  } catch (error) {
    if (error instanceof ApiCallError) notice(error.failure.message);
  }
}

export async function renderLibrary(): Promise<void> {
  await Promise.all([loadAllowance(), loadStatus()]);
  try {
    shared.projects = (await get<{ items: never[] }>('/api/projects')).items;
  } catch {
    shared.projects = [];
  }
  const search = el('input', { type: 'search', id: 'search-media', 'aria-label': 'Search media', placeholder: 'Search media' });
  const upload = el('input', { type: 'file', id: 'upload-files', multiple: true });
  const main = el('main', { class: 'sheet-area library' }, [
    el('div', { class: 'library-controls' }, [
      el('div', { class: 'field' }, [el('label', { for: 'search-media', text: 'Search media' }), search]),
      el('div', { class: 'field' }, [el('label', { for: 'upload-files', text: 'Upload files' }), upload]),
    ]),
    el('ul', { class: 'uploads', 'aria-label': 'Uploads', 'data-uploads': '' }),
    el('section', { class: 'sheet library-sheet', role: 'region', 'aria-label': 'Media library', 'data-library-sheet': '' }),
  ]);
  mount(band(), noticesStrip(), main);
  renderOutages();
  const open = await renderUploads();
  await renderSheet('');
  let timer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void renderSheet(search.value.trim()), 200);
  });
  upload.addEventListener('change', () => {
    const files = [...(upload.files ?? [])];
    const list = find<HTMLElement>('[data-uploads]');
    for (const file of files) {
      if (find<HTMLElement>(`[data-upload-name="${CSS.escape(file.name)}"]`) === null && list !== null) {
        list.append(progressRow(file.name, 0, `Uploading ${file.name} — 0%`));
      }
    }
    void (async () => {
      for (const file of files) await sendUpload(file, open);
      await renderUploads();
      await renderSheet(search.value.trim());
      await loadAllowance();
      if (shared.allowance !== null) setAllowance(shared.allowance as AllowanceRecord);
    })();
  });
}
