import { copy } from '../shared/copy.js';
import { newIdempotencyKey, request } from './api.js';
import { alertAnnounce, announce, on, qs, qsa, setFieldError } from './dom.js';
import { page } from './state.js';

interface Tile {
  file: File;
  state: 'uploading' | 'ready' | 'failed';
  imageId: string | null;
  alt: string;
}

const tiles: Tile[] = [];
/** One key is made when the composer opens and reused for every press of "Post" and every retry. */
let idempotencyKey = newIdempotencyKey();

function list(): HTMLElement | null {
  return qs<HTMLElement>('[data-image-tiles]');
}

function renderTiles(): void {
  const container = list();
  if (!container) return;
  const total = tiles.length;
  container.innerHTML = tiles
    .map((tile, index) => {
      const position = index + 1;
      const status =
        tile.state === 'uploading'
          ? `<p class="tile-status">${copy.image.uploading(position)}</p>`
          : tile.state === 'failed'
            ? `<p class="tile-status tile-failed">${copy.image.storageDown}</p>
               <button type="button" data-retry="${index}">Retry upload</button>`
            : '';
      return `<li class="image-tile" id="image-tile-${position}" role="group" aria-label="Image ${position} of ${total}">
        <p class="tile-name">${tile.file.name}</p>
        ${status}
        <label for="alt-${position}">Alt text for image ${position}</label>
        <input id="alt-${position}" type="text" value="${tile.alt.replace(/"/g, '&quot;')}" data-alt="${index}" />
        <div class="tile-actions">
          <button type="button" data-move-up="${index}" aria-label="Move image ${position} up"${
            index === 0 ? ' aria-disabled="true"' : ''
          }>Move image ${position} up</button>
          <button type="button" data-move-down="${index}" aria-label="Move image ${position} down"${
            index === total - 1 ? ' aria-disabled="true"' : ''
          }>Move image ${position} down</button>
          <button type="button" data-remove-tile="${index}" aria-label="Remove image ${position}">Remove image ${position}</button>
        </div>
      </li>`;
    })
    .join('');
}

async function upload(index: number): Promise<void> {
  const tile = tiles[index];
  if (!tile) return;
  tile.state = 'uploading';
  renderTiles();
  const form = new FormData();
  form.append('file', tile.file, tile.file.name);
  const result = await request<{ id: string }>('/api/images', { method: 'POST', form });
  const position = tiles.indexOf(tile) + 1;
  if (result.ok && result.data) {
    tile.state = 'ready';
    tile.imageId = result.data.id;
    renderTiles();
    announce(copy.image.uploaded(position));
    return;
  }
  tile.state = 'failed';
  renderTiles();
  if (result.error?.code === 'STORAGE_UNAVAILABLE') {
    alertAnnounce(copy.image.storageDown);
    const retry = qs<HTMLElement>('[data-retry]');
    retry?.focus();
    return;
  }
  const message = result.error?.fields?.file ?? copy.image.type;
  const tileNode = qs<HTMLElement>(`#image-tile-${position} .tile-status`);
  if (tileNode) tileNode.textContent = message;
  alertAnnounce(message);
}

function addFiles(files: FileList): void {
  for (const file of Array.from(files)) {
    tiles.push({ file, state: 'uploading', imageId: null, alt: '' });
    void upload(tiles.length - 1);
  }
  renderTiles();
}

function swap(from: number, to: number): void {
  if (to < 0 || to >= tiles.length) return;
  const moved = tiles[from];
  tiles[from] = tiles[to];
  tiles[to] = moved;
  renderTiles();
}

export function initComposer(): void {
  const form = qs<HTMLFormElement>('[data-composer]');
  if (!form || !page.community) return;
  const community = page.community.name;
  const title = qs<HTMLInputElement>('#title', form);
  const body = qs<HTMLTextAreaElement>('#body', form);
  const spoiler = qs<HTMLInputElement>('#spoiler', form);
  const submit = qs<HTMLButtonElement>('[data-submit]', form);
  const input = qs<HTMLInputElement>('[data-image-input]', form);

  if (input) {
    on(input, 'change', () => {
      if (input.files) addFiles(input.files);
      input.value = '';
    });
    on(input, 'drop', (event) => {
      const drop = event as DragEvent;
      drop.preventDefault();
      if (drop.dataTransfer?.files) addFiles(drop.dataTransfer.files);
    });
    on(input, 'dragover', (event) => event.preventDefault());
  }

  on(form, 'click', (event) => {
    const target = event.target as HTMLElement | null;
    const up = target?.closest<HTMLElement>('[data-move-up]');
    const down = target?.closest<HTMLElement>('[data-move-down]');
    const remove = target?.closest<HTMLElement>('[data-remove-tile]');
    const retry = target?.closest<HTMLElement>('[data-retry]');
    if (up) {
      const index = Number(up.dataset.moveUp);
      if (index === 0) return;
      swap(index, index - 1);
      qs<HTMLElement>(`[data-move-up="${index - 1}"]`)?.focus();
    } else if (down) {
      const index = Number(down.dataset.moveDown);
      if (index === tiles.length - 1) return;
      swap(index, index + 1);
      qs<HTMLElement>(`[data-move-down="${index + 1}"]`)?.focus();
    } else if (remove) {
      tiles.splice(Number(remove.dataset.removeTile), 1);
      renderTiles();
    } else if (retry) {
      void upload(Number(retry.dataset.retry));
    }
  });

  on(form, 'input', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && target.dataset.alt !== undefined) {
      const index = Number(target.dataset.alt);
      const tile = tiles[index];
      if (tile) tile.alt = (target as HTMLInputElement).value;
    }
  });

  const tabs = qsa<HTMLElement>('[data-editor-tabs] [role="tab"]', form);
  const preview = qs<HTMLElement>('[data-preview]', form);
  const bodyPanel = qs<HTMLElement>('#body-panel', form);
  const selectTab = async (tab: HTMLElement) => {
    for (const candidate of tabs) {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
      candidate.tabIndex = selected ? 0 : -1;
    }
    tab.focus();
    const previewing = tab.dataset.editor === 'preview';
    if (bodyPanel) bodyPanel.hidden = previewing;
    if (preview) preview.hidden = !previewing;
    if (previewing && preview) {
      const result = await request<{ html: string }>('/api/markdown/preview', {
        method: 'POST',
        body: { bodyMd: body?.value ?? '' },
      });
      preview.innerHTML = result.ok && result.data ? result.data.html : '';
    }
  };
  for (const tab of tabs) on(tab, 'click', () => void selectTab(tab));
  on(qs('[data-editor-tabs]', form) ?? form, 'keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    const index = tabs.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    if (keyboard.key === 'ArrowRight' || keyboard.key === 'ArrowLeft') {
      keyboard.preventDefault();
      void selectTab(tabs[(index + (keyboard.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]);
    }
  });

  on(form, 'submit', (event) => {
    event.preventDefault();
    setFieldError(title, null);
    setFieldError(body, null);
    const imagesError = qs<HTMLElement>('#images-error', form);
    if (imagesError) imagesError.hidden = true;

    const titleValue = title?.value.trim() ?? '';
    if (titleValue.length < 1 || titleValue.length > 300) {
      setFieldError(title, copy.post.titleInvalid);
      title?.focus();
      return;
    }
    if ((body?.value.length ?? 0) > 40000) {
      setFieldError(body, copy.post.bodyInvalid);
      body?.focus();
      return;
    }
    if (tiles.some((tile) => tile.state !== 'ready')) {
      if (imagesError) {
        imagesError.textContent = copy.post.imagesNotReady;
        imagesError.hidden = false;
      }
      announce(copy.post.imagesNotReady);
      const retry = qs<HTMLElement>('[data-retry]');
      retry?.focus();
      return;
    }

    if (submit) {
      submit.textContent = copy.post.pending;
      submit.disabled = true;
    }

    void (async () => {
      const result = await request<{ url: string }>(`/api/communities/${community}/posts`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: {
          title: titleValue,
          bodyMd: body?.value ?? '',
          spoiler: spoiler?.checked === true,
          images: tiles.map((tile) => ({ id: tile.imageId, alt: tile.alt })),
        },
      });
      if (submit) {
        submit.textContent = 'Post';
        submit.disabled = false;
      }
      if (result.ok && result.data) {
        announce(copy.post.published);
        idempotencyKey = newIdempotencyKey();
        window.location.assign(result.data.url);
        return;
      }
      const error = result.error;
      if (error?.fields) {
        if (error.fields.title) setFieldError(title, error.fields.title);
        if (error.fields.bodyMd) setFieldError(body, error.fields.bodyMd);
        if (error.fields.images && imagesError) {
          imagesError.textContent = error.fields.images;
          imagesError.hidden = false;
        }
      }
      if (error?.code === 'STORAGE_UNAVAILABLE') alertAnnounce(copy.image.storageDown);
      else if (error?.code === 'NOT_APPROVED') announce(copy.fixed.restrictedComposer);
      else if (error?.code === 'EMAIL_UNVERIFIED') announce(copy.post.unverified);
      else if (error?.code === 'IMAGES_NOT_READY') announce(copy.post.imagesNotReady);
      else alertAnnounce(error?.message ?? copy.vote.failed);
    })();
  });
}
