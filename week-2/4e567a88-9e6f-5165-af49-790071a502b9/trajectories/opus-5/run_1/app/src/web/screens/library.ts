import { ApiFailure, AssetView, LineageView, api } from '../api';
import { clear, el, num, openDialog } from '../dom';
import { bytes as formatBytes, longDate } from '../format';
import { Shell, alertError, go, notice } from '../shell';
import { modelName, state } from '../state';

let pendingInput: string | null = null;
let searchBox: HTMLInputElement | null = null;

export function setPendingInput(assetId: string): void {
  pendingInput = assetId;
}

export function takePendingInput(): string | null {
  const value = pendingInput;
  pendingInput = null;
  return value;
}

function glyphFor(mediaType: string): string {
  if (mediaType.startsWith('video')) return 'VID';
  if (mediaType.startsWith('audio')) return 'AUD';
  return 'IMG';
}

function mediaNode(asset: AssetView): Node {
  if (asset.url === null) return el('p', { class: 'media-hidden', text: 'Media is hidden for your role.' });
  if (asset.media_type.startsWith('image/')) {
    return el('img', { src: asset.url, alt: '', class: 'asset-media' });
  }
  if (asset.media_type.startsWith('audio/')) {
    return el('audio', { src: asset.url, controls: true, class: 'asset-media' });
  }
  return el('a', { href: asset.url, class: 'asset-link', text: 'Open media in a new tab', target: '_blank', rel: 'noreferrer' });
}

function lineageList(lineage: LineageView): HTMLElement {
  const list = el('ul', { class: 'dialog-lineage', role: 'list' });
  for (const node of lineage.nodes) {
    if (node.state === 'tombstone') {
      list.append(
        el('li', {}, [
          el('button', {
            type: 'button',
            class: 'lineage-node lineage-tombstone',
            'aria-label': `Removed asset ${node.id}`,
            text: `Removed ${longDate(node.removed_at)} (${node.reason})`,
          }),
        ]),
      );
      continue;
    }
    const button = el('button', { type: 'button', class: 'lineage-node', 'aria-label': `Asset ${node.id}` }, [
      num(node.id),
    ]);
    button.addEventListener('click', () => void openAssetDialog(node.id, { opener: button }));
    list.append(el('li', {}, [button]));
  }
  return list;
}

export async function openAssetDialog(
  assetId: string,
  options: { opener?: HTMLElement | null; onChanged?: () => void; onUseAsInput?: (assetId: string) => void } = {},
): Promise<void> {
  let asset: AssetView;
  try {
    const response = await api.get<{ asset: AssetView }>(`/api/assets/${assetId}`);
    asset = response.asset;
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    alertError(error.status === 410 ? 'That asset is already gone.' : error.message);
    return;
  }
  let lineage: LineageView = { nodes: [], edges: [] };
  try {
    lineage = await api.get<LineageView>(`/api/assets/${assetId}/lineage`);
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
  }

  const role = state.member!.role;
  openDialog({
    label: `Asset ${asset.id}`,
    opener: options.opener ?? null,
    content: (close) => {
      const actions: Node[] = [];
      if (role === 'member') {
        const useButton = el('button', { type: 'button', class: 'primary', text: 'Use as input' });
        useButton.addEventListener('click', () => {
          setPendingInput(asset.id);
          close();
          if (options.onUseAsInput) options.onUseAsInput(asset.id);
          else go('/run');
        });
        actions.push(useButton);
      }
      if (role === 'compliance' || role === 'admin') {
        const deleteButton = el('button', { type: 'button', class: 'secondary', text: 'Delete' });
        deleteButton.addEventListener('click', () => {
          openDialog({
            label: 'Delete asset',
            role: 'alertdialog',
            opener: deleteButton,
            initialFocus: '.keep-button',
            content: (closeAlert) => {
              const keep = el('button', { type: 'button', class: 'secondary keep-button', text: 'Keep' });
              keep.addEventListener('click', closeAlert);
              const confirm = el('button', { type: 'button', class: 'primary', text: 'Delete permanently' });
              confirm.addEventListener('click', () => {
                notice('Deleting…');
                void api
                  .del(`/api/assets/${asset.id}`)
                  .then(() => {
                    notice(`Asset ${asset.id} deleted from storage, search and lineage.`);
                    closeAlert();
                    close();
                    options.onChanged?.();
                    searchBox?.focus();
                  })
                  .catch((error: unknown) => {
                    if (!(error instanceof ApiFailure)) throw error;
                    if (error.status === 410) alertError('That asset is already gone.');
                    else if (error.status === 503) {
                      alertError('Storage is unreachable, so nothing was deleted. Try again when it returns.');
                    } else alertError(error.message);
                  });
              });
              return [
                el('h2', { class: 'dialog-title', text: 'Delete asset' }),
                el('p', { text: `Asset ${asset.id} will be removed from storage, search and lineage.` }),
                el('div', { class: 'dialog-actions' }, [keep, confirm]),
              ];
            },
          });
        });
        actions.push(deleteButton);
      }
      const closeButton = el('button', { type: 'button', class: 'secondary', text: 'Close' });
      closeButton.addEventListener('click', close);
      actions.push(closeButton);

      return [
        el('h2', { class: 'dialog-title', text: `Asset ${asset.id}` }),
        mediaNode(asset),
        el('dl', { class: 'detail-list' }, [
          el('div', { class: 'detail-row' }, [
            el('dt', { text: 'Model' }),
            el('dd', { text: asset.model === null ? 'Upload' : modelName(asset.model) }),
          ]),
          el('div', { class: 'detail-row' }, [
            el('dt', { text: 'Created' }),
            el('dd', {}, [num(longDate(asset.created_at))]),
          ]),
          el('div', { class: 'detail-row' }, [
            el('dt', { text: 'Expires' }),
            el('dd', {}, [num(longDate(asset.expires_at))]),
          ]),
          el('div', { class: 'detail-row' }, [
            el('dt', { text: 'Size' }),
            el('dd', {}, [num(formatBytes(asset.bytes))]),
          ]),
          el('div', { class: 'detail-row' }, [
            el('dt', { text: 'Prompt' }),
            el('dd', { text: asset.prompt === undefined ? 'Hidden — restricted payload' : asset.prompt ?? '—' }),
          ]),
        ]),
        el('h3', { class: 'section-heading', text: 'Lineage' }),
        lineageList(lineage),
        el('div', { class: 'dialog-actions' }, actions),
      ];
    },
  });
}

export function mountLibrary(shell: Shell): () => void {
  const search = el('input', {
    type: 'search',
    class: 'control search-box',
    'aria-label': 'Search media',
    placeholder: 'Model or prompt words',
  });
  searchBox = search;
  const results = el('ul', { class: 'results', role: 'list', 'aria-label': 'Results' });
  const empty = el('p', { class: 'empty-note', text: 'No media matches.' });
  empty.hidden = true;

  async function load(): Promise<void> {
    const query = search.value.trim();
    const response = await api.get<{ assets: AssetView[] }>(`/api/assets?q=${encodeURIComponent(query)}`);
    clear(results);
    empty.hidden = response.assets.length > 0;
    for (const asset of response.assets) {
      const button = el('button', { type: 'button', class: 'asset-card', 'aria-label': `Asset ${asset.id}` }, [
        asset.media_type.startsWith('image/') && asset.url !== null
          ? el('img', { src: asset.url, alt: '', class: 'card-thumb' })
          : el('span', { class: 'media-glyph', text: glyphFor(asset.media_type) }),
        el('span', { class: 'card-model', text: asset.model === null ? 'Upload' : modelName(asset.model) }),
        el('span', { class: 'card-dates' }, [
          num(longDate(asset.created_at)),
          el('span', { text: ' → ' }),
          num(longDate(asset.expires_at)),
        ]),
      ]);
      button.addEventListener('click', () => void openAssetDialog(asset.id, { opener: button, onChanged: () => void load() }));
      results.append(el('li', {}, [button]));
    }
  }

  let debounce = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void load(), 200);
  });

  shell.main.append(
    el('h1', { class: 'screen-title', text: 'Library' }),
    el('div', { class: 'library-controls' }, [search]),
    results,
    empty,
  );
  void load();
  return () => {
    window.clearTimeout(debounce);
    searchBox = null;
  };
}
