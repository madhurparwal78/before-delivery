/* The submit page: the composer with Write and Preview tabs, image tiles with
   uploads, reordering and retries, one idempotency key per draft. */
import { api, announce, copy, el, idKey, type Me, ApiFailure } from '../lib.js';
import { navigate } from '../lib.js';
import type { Community } from '../ui.js';
import { wireSpoilers } from './post.js';

type UploadState = { id: number | null; alt: string; status: 'uploading' | 'done' | 'failed'; src: string | null; file: File | null };

export async function renderSubmitPage(frame: HTMLElement, me: Me | null, path: string): Promise<void> {
  const name = path.split('/')[2] ?? '';
  const railEl = el('aside', { class: 'rail' });
  const feedCol = el('main', { class: 'feed' });
  frame.append(railEl, feedCol);

  let community: Community;
  try {
    community = await api<Community>(`/api/communities/${name}`);
  } catch {
    feedCol.append(el('p', { class: 'empty' }, 'This community does not exist.'));
    return;
  }

  feedCol.append(el('header', { class: 'post-head' }, el('h1', {}, `Submit to c/${community.name}`)));

  if (me === null) {
    feedCol.append(el('p', { class: 'empty' }, el('a', { href: '/login' }, 'Sign in'), ' to post.'));
    return;
  }
  if (community.type === 'restricted' && !community.viewer.canPost) {
    feedCol.append(el('div', { class: 'banner' }, el('p', {}, copy.restrictedNotice)));
  }
  if (community.type === 'public' && !community.viewer.canPost && !community.viewer.joined) {
    // public communities allow posting to any verified member
  }

  const composer = el('form', { class: 'composer panel', novalidate: true });
  feedCol.append(composer);

  // Title
  const titleInput = el('input', { class: 'input', type: 'text', 'aria-label': 'Title', id: 'title-input' });
  const titleErr = el('p', { id: 'title-error' });
  titleInput.setAttribute('aria-describedby', 'title-error');

  // Body with tabs
  let bodyValue = '';
  let activeTab: 'write' | 'preview' = 'write';
  const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Body editor' });
  const bodyTa = el('textarea', { class: 'textarea', 'aria-label': 'Body', id: 'body-input', placeholder: 'Write your post. Markdown is supported.' });
  const previewEl = el('div', { class: 'post-body', id: 'preview-out' });
  const bodyErr = el('p', { id: 'body-error' });

  const spoilerBox = el('input', { type: 'checkbox', id: 'spoiler-input', 'aria-label': 'Spoiler' });
  const spoilerLabel = el('label', { class: 'checkbox-row', for: 'spoiler-input' }, spoilerBox, 'Spoiler');

  const fileInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: 'true', id: 'file-input', class: 'input' });
  fileInput.setAttribute('aria-label', 'Add images');

  const imagesErr = el('p', { id: 'images-error' });

  const tiles: UploadState[] = [];
  const tileRow = el('div', { class: 'tile-row' });

  const postBtn = el('button', { class: 'btn primary', type: 'submit' }, 'Post');
  const statusEl = el('p', { 'aria-live': 'polite' });

  composer.append(
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Title'), titleInput, titleErr),
    tabs,
    bodyTa,
    previewEl,
    bodyErr,
    spoilerLabel,
    el('label', { class: 'field' }, el('span', { class: 'label' }, 'Images'), fileInput),
    tileRow,
    imagesErr,
    el('div', { class: 'dialog-actions' }, postBtn),
    statusEl,
  );

  const renderTabs = (): void => {
    tabs.replaceChildren();
    for (const t of ['write', 'preview'] as const) {
      const b = el('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': activeTab === t ? 'true' : 'false' }, t === 'write' ? 'Write' : 'Preview');
      b.addEventListener('click', () => { activeTab = t; renderTabs(); renderBodyPane(); });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        activeTab = t === 'write' ? 'preview' : 'write';
        renderTabs();
        renderBodyPane();
      });
      tabs.append(b);
    }
  };
  const renderBodyPane = (): void => {
    if (activeTab === 'write') {
      previewEl.hidden = true;
      bodyTa.hidden = false;
    } else {
      bodyTa.hidden = true;
      previewEl.hidden = false;
      void api<{ html: string }>('/api/markdown/preview', { method: 'POST', body: JSON.stringify({ bodyMd: bodyTa.value }) }).then((r) => {
        previewEl.innerHTML = r.html;
        wireSpoilers(previewEl);
      }).catch(() => undefined);
    }
  };
  renderTabs();
  renderBodyPane();
  bodyTa.addEventListener('input', () => { bodyValue = bodyTa.value; });

  fileInput.addEventListener('change', () => {
    for (const file of Array.from(fileInput.files ?? [])) addTile(file);
    fileInput.value = '';
  });

  const idempotencyKey = idKey();

  async function uploadTile(state: UploadState, tileEl: HTMLElement, retryBtn: HTMLButtonElement | null): Promise<void> {
    if (state.file === null) return;
    state.status = 'uploading';
    renderTiles();
    const fd = new FormData();
    fd.append('file', state.file);
    try {
      const res = await api<{ id: number; src: string; srcset: string }>('/api/images', { method: 'POST', body: fd });
      state.id = res.id;
      state.src = res.src;
      state.status = 'done';
      announce(`Image ${tiles.indexOf(state) + 1} uploaded`);
      renderTiles();
    } catch (err) {
      state.status = 'failed';
      renderTiles();
      if (err instanceof ApiFailure && err.code === 'STORAGE_UNAVAILABLE') {
        announce('Image uploads are unavailable right now. Your draft is kept.', true);
      } else if (err instanceof ApiFailure) {
        const fieldMsg = err.fields.file ?? 'Upload failed';
        announce(fieldMsg, true);
      }
      const first = tileRow.querySelector<HTMLButtonElement>('.retry');
      first?.focus();
    }
    void tileEl;
    void retryBtn;
  }

  function addTile(file: File): void {
    if (tiles.length >= 10) return;
    const state: UploadState = { id: null, alt: '', status: 'uploading', src: null, file };
    tiles.push(state);
    renderTiles();
    void uploadTile(state, tileRow.lastElementChild as HTMLElement, null);
  }

  function renderTiles(): void {
    tileRow.replaceChildren();
    tiles.forEach((state, i) => {
      const tile = el('div', { class: `image-tile${state.status === 'failed' ? ' failed' : ''}`, id: `image-tile-${i + 1}`, role: 'group', 'aria-label': `Image ${i + 1} of ${tiles.length}` });
      const altInput = el('input', { class: 'input', type: 'text', 'aria-label': `Alt text for image ${i + 1}`, value: state.alt });
      altInput.addEventListener('input', () => { state.alt = altInput.value; });
      const statusText = state.status === 'uploading' ? `Uploading image ${i + 1}` : state.status === 'done' ? `Image ${i + 1} uploaded` : 'Upload failed';
      const moveUp = el('button', { class: 'btn', type: 'button', 'aria-label': `Move image ${i + 1} up`, 'aria-disabled': i === 0 ? 'true' : 'false' }, '↑');
      const moveDown = el('button', { class: 'btn', type: 'button', 'aria-label': `Move image ${i + 1} down`, 'aria-disabled': i === tiles.length - 1 ? 'true' : 'false' }, '↓');
      const remove = el('button', { class: 'btn', type: 'button', 'aria-label': `Remove image ${i + 1}` }, 'Remove');
      moveUp.addEventListener('click', () => {
        if (i === 0) return;
        const tmp = tiles[i - 1] as UploadState;
        tiles[i - 1] = tiles[i] as UploadState;
        tiles[i] = tmp;
        renderTiles();
        (tileRow.children[i - 1] as HTMLElement)?.querySelector<HTMLButtonElement>(`[aria-label="Move image ${i} up"]`)?.focus();
      });
      moveDown.addEventListener('click', () => {
        if (i === tiles.length - 1) return;
        const tmp = tiles[i + 1] as UploadState;
        tiles[i + 1] = tiles[i] as UploadState;
        tiles[i] = tmp;
        renderTiles();
        (tileRow.children[i + 1] as HTMLElement)?.querySelector<HTMLButtonElement>(`[aria-label="Move image ${i + 2} down"]`)?.focus();
      });
      remove.addEventListener('click', () => {
        tiles.splice(i, 1);
        renderTiles();
      });
      const actions = el('div', { class: 'tile-actions' }, moveUp, moveDown, remove);
      if (state.status === 'failed') {
        const retry = el('button', { class: 'btn retry', type: 'button', 'aria-label': `Retry upload` }, 'Retry upload');
        retry.addEventListener('click', () => { void uploadTile(state, tile, retry); });
        actions.append(retry);
      }
      tile.append(
        state.src !== null ? el('img', { src: state.src, alt: '' }) : el('div', { class: 'thumb' }),
        el('p', { class: 'status' }, statusText),
        altInput,
        actions,
      );
      tileRow.append(tile);
    });
  }

  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit();
  });

  async function submit(): Promise<void> {
    const title = titleInput.value.trim();
    const fields: Record<string, string> = {};
    if (title.length < 1 || title.length > 300) fields.title = 'Titles are 1 to 300 characters';
    if (bodyTa.value.length > 40_000) fields.bodyMd = 'Bodies are at most 40,000 characters';
    const hasUploading = tiles.some((t) => t.status === 'uploading');
    const hasFailed = tiles.some((t) => t.status === 'failed');
    if (hasUploading || hasFailed) {
      imagesErr.replaceChildren(el('span', { class: 'field-error' }, 'Wait for every image to upload, or remove the ones that failed'));
      if (hasFailed) {
        const first = tileRow.querySelector<HTMLButtonElement>('.retry');
        first?.focus();
      }
      return;
    }
    imagesErr.replaceChildren();
    titleErr.replaceChildren();
    bodyErr.replaceChildren();
    if (Object.keys(fields).length > 0) {
      if (fields.title !== undefined) { titleInput.setAttribute('aria-invalid', 'true'); titleErr.replaceChildren(el('span', { class: 'field-error' }, fields.title)); }
      if (fields.bodyMd !== undefined) { bodyTa.setAttribute('aria-invalid', 'true'); bodyErr.replaceChildren(el('span', { class: 'field-error' }, fields.bodyMd)); }
      const firstInvalid = fields.title !== undefined ? titleInput : bodyTa;
      firstInvalid.focus();
      return;
    }
    postBtn.textContent = 'Posting...';
    try {
      const post = await api<{ url: string }>(`/api/communities/${community.name}/posts`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          title,
          bodyMd: bodyTa.value,
          spoiler: spoilerBox.checked,
          images: tiles.filter((t) => t.id !== null).map((t) => ({ id: t.id, alt: t.alt === '' ? null : t.alt })),
        }),
      });
      announce('Post published');
      navigate(post.url);
    } catch (err) {
      postBtn.textContent = 'Post';
      if (err instanceof ApiFailure) {
        if (err.code === 'EMAIL_UNVERIFIED') announce(copy.voteVerify, true);
        else if (err.code === 'NOT_APPROVED') announce(copy.restrictedNotice, true);
        else {
          for (const [field, message] of Object.entries(err.fields)) {
            const target = field === 'title' ? titleErr : field === 'bodyMd' ? bodyErr : imagesErr;
            target.replaceChildren(el('span', { class: 'field-error' }, message));
          }
          const first = err.fields.title !== undefined ? titleInput : err.fields.bodyMd !== undefined ? bodyTa : fileInput;
          first.focus();
        }
      }
    }
  }
}
