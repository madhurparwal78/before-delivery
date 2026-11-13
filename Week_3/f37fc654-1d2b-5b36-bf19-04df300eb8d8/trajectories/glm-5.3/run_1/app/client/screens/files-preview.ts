/** Files, preview, and the remaining client screens. */
import { getApp, goto, setStatus } from '../app.js';
import { api, ApiError } from '../api.js';
import { el } from '../dom.js';
import type { Commission, CommissionFile, Render } from '../types.js';
import type { RouteContext } from './router.js';

async function loadCommission(id: string): Promise<Commission | null> {
  return api<Commission>(`/commissions/${id}`).catch(() => null);
}

function requireCommission(app: ReturnType<typeof getApp>, commission: Commission | null): commission is Commission {
  if (!commission) {
    app.main.append(el('h1', {}, 'Not found'));
    return false;
  }
  return true;
}

// ---------- Files ----------

export async function filesScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const id = ctx.path.split('/')[2] ?? '';
  const commission = await loadCommission(id);
  if (!requireCommission(app, commission)) return;

  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, 'Files'));
  section.append(el('p', { class: 'muted' }, `${commission.title} — ${commission.venue.name}`));

  const controls = el('div', { class: 'upload-controls' });
  const KINDS: Array<{ kind: string; label: string }> = [
    { kind: 'brief_pdf', label: 'Upload brief PDF' },
    { kind: 'venue_photo', label: 'Upload venue photo' },
    { kind: 'installation_glb', label: 'Upload GLB model' },
  ];
  const fileInputs = new Map<string, HTMLInputElement>();
  for (const { kind, label } of KINDS) {
    const input = el('input', { type: 'file', class: 'visually-hidden' });
    input.accept = kind === 'brief_pdf' ? 'application/pdf' : kind === 'venue_photo' ? 'image/jpeg,image/png' : '.glb';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void upload(commission.id, kind, file);
    });
    const button = el('button', { class: 'btn ghost' }, label);
    button.addEventListener('click', () => input.click());
    controls.append(button, input);
    fileInputs.set(kind, input);
  }
  section.append(controls);

  const listWrap = el('section', { class: 'card' });
  listWrap.append(el('h2', {}, 'Files'));
  const list = el('ul', { class: 'file-list', 'aria-label': 'Files' });
  const files = await api<{ files: CommissionFile[] }>(`/commissions/${id}/files`).catch(() => null);
  if (files && files.files.length > 0) {
    for (const f of files.files) {
      list.append(fileRow(f));
    }
  } else {
    list.append(el('li', { class: 'empty-state' }, 'No files yet. Add a venue photo?'));
  }
  listWrap.append(list);
  app.main.append(section, listWrap);

  async function upload(commissionId: string, kind: string, file: File): Promise<void> {
    setStatus(app.statusRegions.upload, `Uploading ${file.name}...`);
    const formData = new FormData();
    formData.append('kind', kind);
    formData.append('file', file);
    try {
      const created = await api<CommissionFile>(`/commissions/${commissionId}/files`, { method: 'POST', formData });
      setStatus(app.statusRegions.upload, `Stored ${created.fileName} — ${created.sizeBytes} bytes, SHA-256 ${created.sha256}.`);
      const first = list.querySelector('.empty-state');
      first?.remove();
      list.prepend(fileRow(created));
    } catch (e) {
      if (e instanceof ApiError) {
        setStatus(app.statusRegions.upload, e.message || 'Upload failed.');
      }
    }
  }
}

function fileRow(f: CommissionFile): HTMLLIElement {
  const li = el('li', { class: 'file-item' });
  const badge = el('span', { class: 'state-badge stored' }, 'Stored');
  li.append(
    el('span', { class: 'file-name' }, f.fileName),
    el('span', { class: 'muted small' }, f.kind),
    el('span', { class: 'muted small' }, `${f.sizeBytes}`),
    el('span', { class: 'muted small sha' }, f.sha256),
    badge,
  );
  return li;
}

// ---------- Preview ----------

export async function previewScreen(ctx: RouteContext): Promise<void> {
  const app = getApp();
  app.setScene('working');
  app.main.textContent = '';
  const id = ctx.path.split('/')[2] ?? '';
  const commission = await loadCommission(id);
  if (!requireCommission(app, commission)) return;

  const section = el('section', { class: 'card' });
  section.append(el('h1', { class: 'page-heading' }, 'Concept preview'));
  section.append(el('p', { class: 'muted' }, `${commission.title} — ${commission.venue.name}`));

  const files = await api<{ files: CommissionFile[] }>(`/commissions/${id}/files`).catch(() => null);
  const photos = (files?.files ?? []).filter((f) => f.kind === 'venue_photo');
  if (photos.length === 0) {
    section.append(el('p', { class: 'muted' }, 'No venue photo yet. Upload one from the Files screen.'));
  }

  const group = el('div', { class: 'chip-group', role: 'radiogroup', 'aria-label': 'Venue photo' });
  const pick = el('input', { type: 'hidden' });
  photos.forEach((p, i) => {
    const option = el('label', { class: 'chip-wrap' });
    const input = el('input', { type: 'radio', name: 'photo', value: p.id });
    if (i === 0) input.checked = true;
    option.append(input, el('span', { class: 'chip-label' }, p.fileName));
    group.append(option);
  });
  if (photos.length > 0) section.append(group);
  section.append(pick);

  const refField = el('input', { type: 'text', class: 'answer-field', placeholder: 'https://example.com/reference.jpg' });
  refField.setAttribute('aria-label', 'Reference image address (optional)');

  const request = el('button', { class: 'btn primary' }, 'Request preview');
  const bar = el('progress', { class: 'preview-progress', value: '0', max: '100' });
  bar.setAttribute('aria-label', 'Preview progress');
  const statusRegion = app.statusRegions.preview;
  request.addEventListener('click', async () => {
    const selected = group.querySelector<HTMLInputElement>('input:checked')?.value;
    if (!selected) return;
    try {
      setStatus(statusRegion, 'Preview queued.');
      bar.value = 0;
      const body: Record<string, unknown> = { venuePhotoFileId: selected };
      if (refField.value.trim()) body['referenceImageUrl'] = refField.value.trim();
      const render = await api<Render>(`/commissions/${id}/renders`, { method: 'POST', body });
      void pollRender(render.id, commission.id);
    } catch (e) {
      if (e instanceof ApiError) {
        setStatus(statusRegion, e.message || 'The preview didn\'t render. Try again with another photo.');
      }
    }
  });

  const progressBarWrap = el('div', { class: 'progress-wrap' }, '');
  progressBarWrap.append(bar);
  section.append(refField, request, progressBarWrap);
  app.main.append(section);

  const imageWrap = el('section', { class: 'card' });
  const configureLink = el('a', { href: `/c/${id}/configure`, class: 'btn ghost' }, 'Configure the room');
  configureLink.addEventListener('click', (e) => {
    e.preventDefault();
    goto(`/c/${id}/configure`);
  });
  imageWrap.append(configureLink);
  app.main.append(imageWrap);

  // Show an existing ready render.
  const renders = await api<{ renders: Array<{ id: string; state: string; progress: number }> }>(`/commissions/${id}/renders`).catch(() => null);
  const latest = renders?.renders[0];
  if (latest && latest.state === 'ready') {
    void showPreview(latest.id, id, imageWrap);
  } else if (latest) {
    void pollRender(latest.id, id);
  }

  async function pollRender(renderId: string, commissionId: string): Promise<void> {
    for (let i = 0; i < 300; i++) {
      const render = await api<Render>(`/renders/${renderId}`).catch(() => null);
      if (!render) return;
      bar.value = render.progress;
      setStatus(statusRegion, `Preview rendering — ${render.progress}% done.`);
      if (render.state === 'ready') {
        setStatus(statusRegion, 'Preview ready.');
        await showPreview(renderId, commissionId, imageWrap);
        return;
      }
      if (render.state === 'failed') {
        setStatus(statusRegion, 'The preview didn\'t render. Try again with another photo.');
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function showPreview(renderId: string, commissionId: string, wrap: HTMLElement): Promise<void> {
  wrap.querySelector('img')?.remove();
  const img = el('img', { alt: 'Concept preview', class: 'preview-image' });
  img.src = `/api/renders/${renderId}/preview`;
  const label = el('span', { class: 'visually-hidden' }, 'Concept preview');
  img.setAttribute('aria-label', 'Concept preview');
  wrap.prepend(img, label);
  void commissionId;
}
