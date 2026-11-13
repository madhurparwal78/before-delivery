import { api, type UploadRecord } from '../api';
import { el, announce, copy, sha256Hex, chunkSize, checksumColour, reducedMotion } from '../ui';
import { renderBand } from '../main';
import type { Media } from '../../shared/types';

/** The media library: search, resumable uploads, the contact sheet. */
export async function renderLibrary(root: HTMLElement): Promise<HTMLElement> {
  const main = el('main', null);
  main.append(renderBand(root), noticesStrip());
  const holder = el('div', { class: 'panel' });
  const search = el('input', { type: 'search', 'aria-label': 'Search media', placeholder: 'Search media' });
  const upload = el('input', { type: 'file', multiple: 'multiple', 'aria-label': 'Upload files' });
  const uploadLabel = el('label', { class: 'btn' });
  uploadLabel.append(document.createTextNode('Upload files'), upload);
  upload.style.display = 'none';
  const tools = el('div', { style: 'display:flex; gap:14px; align-items:center; padding: 14px 0;' });
  tools.append(search, uploadLabel);

  const uploadsRegion = el('section', { 'aria-label': 'Uploads' });
  const uploadsList = el('ul', { class: 'list', role: 'list', 'aria-label': 'Uploads' });
  uploadsRegion.append(uploadsList);

  const library = el('section', { role: 'region', 'aria-label': 'Media library' });
  holder.append(tools, uploadsRegion, library);
  main.append(holder);

  const state = { items: [] as Media[], uploads: [] as UploadRecord[] };

  async function refresh(): Promise<void> {
    const [media, uploads] = await Promise.all([api.media(search.value), api.uploads()]);
    state.items = media.items;
    state.uploads = uploads.items;
    drawUploads();
    drawLibrary();
    void statusProbes();
  }

  function drawUploads(): void {
    uploadsList.textContent = '';
    for (const uploadRecord of state.uploads) {
      const percent = Math.floor((uploadRecord.chunks_received.length / uploadRecord.chunks) * 100);
      const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-label': uploadRecord.file_name });
      bar.append(el('div', { class: 'fill', style: `width:${percent}%` }));
      const li = el('li');
      li.append(el('span', { class: 'progress-label', text: copy.uploadResume(uploadRecord.file_name, percent) }), bar);
      uploadsList.append(li);
    }
  }

  function drawLibrary(): void {
    library.textContent = '';
    if (state.items.length === 0) {
      library.append(el('p', { class: 'muted', text: search.value === '' ? 'No files yet. Upload rushes to start the library.' : `No files match ${search.value}.` }));
      return;
    }
    const folders = new Map<string, Media[]>();
    for (const item of state.items) {
      const list = folders.get(item.folder) ?? [];
      list.push(item);
      folders.set(item.folder, list);
    }
    for (const [folder, files] of folders) {
      const group = el('div', { role: 'group', 'aria-label': folder });
      group.append(el('h3', { text: folder }));
      const usedIn = files[0]?.used_in ?? [];
      group.append(el('p', { class: 'muted', text: usedIn.length === 0 ? 'Not used yet' : `Used in ${usedIn.join(', ')}` }));
      const grid = el('div', { style: 'display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:14px;' });
      for (const file of files) {
        const card = el('div', { 'data-media-id': file.id });
        const box = el('div', { style: `height:96px; display:flex; align-items:center; justify-content:center;` });
        if (file.kind === 'wav') {
          const strip = el('div', { style: 'height:2px; width:100%; background:#ffffff;' });
          box.append(strip);
        } else {
          const colour = checksumColour(file.sha256);
          const ratio = file.width !== null && file.height !== null ? file.width / file.height : 16 / 9;
          box.append(el('div', { style: `width:${Math.min(100, ratio * 50)}%; aspect-ratio:${ratio}; background:${colour};` }));
        }
        card.append(box, el('p', { text: file.name }), el('p', { class: 'muted', text: folder }));
        const del = el('button', { class: 'btn', text: `Delete ${file.name}` });
        del.addEventListener('click', () => {
          void (async () => {
            try {
              await api.deleteMedia(file.id);
              await refresh();
            } catch (err) {
              const body = (err as { body?: { message?: string; projects?: string[] } }).body ?? {};
              announce('Notices', body.message ?? body.projects?.join(', ') ?? 'Check the highlighted fields.');
            }
          })();
        });
        card.append(del);
        grid.append(card);
      }
      group.append(grid);
      library.append(group);
    }
  }

  async function statusProbes(): Promise<void> {
    if (!reducedMotion()) return;
  }

  upload.addEventListener('change', () => {
    const files = Array.from(upload.files ?? []);
    void (async () => {
      for (const file of files) {
        await uploadFile(file);
      }
      await refresh();
    })();
  });

  async function uploadFile(file: File): Promise<void> {
    const sha = await sha256Hex(file);
    const created = await api.createUpload({
      file_name: file.name,
      bytes: file.size,
      sha256: sha,
      folder: 'Rushes',
    });
    if (created.duplicate === true && created.media !== undefined) {
      announce('Notices', copy.alreadyInLibrary(file.name, created.media.name));
      return;
    }
    const chunkBytes = chunkSize();
    const total = Math.max(1, Math.ceil(file.size / chunkBytes));
    const received = new Set(created.chunks_received);
    const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-label': file.name });
    const fillBar = el('div', { class: 'fill' });
    bar.append(fillBar);
    const label = el('span', { class: 'progress-label' });
    const li = el('li');
    li.append(label, bar);
    uploadsList.append(li);
    const setPercent = (): void => {
      const percent = Math.floor((received.size / total) * 100);
      fillBar.style.width = `${percent}%`;
      label.textContent = copy.upload(file.name, percent);
    };
    setPercent();
    for (let n = 0; n < total; n++) {
      if (received.has(n)) continue;
      const start = n * chunkBytes;
      const slice = file.slice(start, Math.min(file.size, start + chunkBytes));
      const buffer = await slice.arrayBuffer();
      await api.sendChunk(created.upload_id, n, buffer);
      received.add(n);
      setPercent();
    }
    const done = await api.completeUpload(created.upload_id);
    if (done.duplicate) {
      announce('Notices', copy.alreadyInLibrary(file.name, done.media.name));
    } else {
      announce('Notices', copy.inLibrary(file.name));
    }
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener('input', () => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void refresh();
    }, 200);
  });

  await refresh();
  return main;
}

function noticesStrip(): HTMLElement {
  return el('div', { role: 'status', 'aria-label': 'Notices', id: 'status-notices', class: 'notices' });
}
