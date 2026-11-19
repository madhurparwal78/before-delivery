import type { Collection, CollectionSummary, PenSummary } from '../../shared/api';
import { copy } from '../../shared/copy';
import { api, ApiFailure } from '../api';
import { combobox } from '../components/combobox';
import { panel, penRow } from '../components/penlist';
import { siteHeader, verifyBanner, watchVerification } from '../components/shell';
import { h, replace, say, status } from '../dom';
import { mountPage, splitPage } from '../layout';
import { PreviewHost } from '../preview';
import { goto } from '../router';
import { live, me } from '../store';

export const collectionsPage = async (): Promise<void> => {
  if (!me()) {
    window.location.replace('/signin');
    return;
  }
  const { root, stage, column } = splitPage(siteHeader(), 'stage-list');
  stage.appendChild(h('div', { class: 'stage-inner' }));
  const banner = verifyBanner();
  const list = h('div', { class: 'list-holder' });
  replace(column, [
    banner,
    h('button', {
      type: 'button',
      class: 'action accent',
      text: 'New collection',
      onclick: async () => {
        const made = await api.post<Collection>('/api/collections');
        goto(`/collections/${made.id}`);
      },
    }),
    list,
  ]);
  mountPage(root);
  live([], { account: watchVerification(banner) });

  const collections = (await api.get<{ collections: CollectionSummary[] }>('/api/collections'))
    .collections;
  replace(list, [
    collections.length === 0
      ? panel(copy.collectionsEmpty)
      : h(
          'ul',
          { class: 'rows', 'aria-label': 'Your collections' },
          collections.map((collection) =>
            h('li', { class: 'row' }, [
              h('a', {
                href: `/collections/${collection.id}`,
                class: 'row-title',
                text: collection.title,
              }),
              h('span', { class: 'muted tabular', text: `${collection.count} pens` }),
            ]),
          ),
        ),
  ]);
};

export const collectionPage = async (params: Record<string, string>): Promise<void> => {
  if (!me()) {
    window.location.replace('/signin');
    return;
  }
  const { root, stage, column } = splitPage(siteHeader(), 'stage-list');
  const region = h('div', { class: 'stage-inner' });
  stage.appendChild(region);

  const banner = verifyBanner();
  const collectionStatus = status('Collection status');
  const rows = h('div', { class: 'list-holder' });
  const title = h('input', { type: 'text', 'aria-label': 'Collection title', class: 'title-box' });
  const addHolder = h('div', { class: 'add-holder' });

  replace(column, [
    banner,
    title,
    addHolder,
    rows,
    collectionStatus,
    h('button', {
      type: 'button',
      class: 'ghost',
      text: 'Delete collection',
      onclick: async () => {
        await api.delete(`/api/collections/${params.id}`);
        goto('/collections');
      },
    }),
  ]);
  mountPage(root);

  const preview = new PreviewHost({ region, crossfade: true });
  live([], { account: watchVerification(banner) });

  let collection = await api.get<Collection>(`/api/collections/${params.id}`);
  let choices: PenSummary[] = [];
  title.value = collection.title;
  title.addEventListener('change', () => {
    void api.patch(`/api/collections/${params.id}`, { title: title.value });
  });

  const move = async (penId: string, direction: number): Promise<void> => {
    const order = collection.pens.map((pen) => pen.id);
    const from = order.indexOf(penId);
    const to = from + direction;
    if (to < 0 || to >= order.length) return;
    order.splice(to, 0, ...order.splice(from, 1));
    collection = await api.patch<Collection>(`/api/collections/${params.id}`, { order });
    paint();
    const moved = collection.pens[to]!;
    say(collectionStatus, copy.collectionMoved(moved.title, to + 1, collection.pens.length));
    rows.querySelectorAll<HTMLElement>('.row-title')[to]?.focus();
  };

  const paint = (): void => {
    if (collection.pens.length === 0) {
      replace(rows, [panel(copy.collectionEmpty)]);
      return;
    }
    replace(rows, [
      h(
        'ul',
        { class: 'rows', 'aria-label': 'Collection pens' },
        collection.pens.map((pen) => {
          const row = penRow(pen, {
            preview,
            showOwner: true,
            trailing: () => [
              h('button', {
                type: 'button',
                class: 'ghost',
                text: `Remove ${pen.title}`,
                onclick: async () => {
                  await api.delete(`/api/collections/${params.id}/pens/${pen.id}`);
                  collection = await api.get<Collection>(`/api/collections/${params.id}`);
                  paint();
                },
              }),
            ],
          });
          row.querySelector('.row-title')!.addEventListener('keydown', (event) => {
            const key = event as KeyboardEvent;
            if (!key.altKey) return;
            if (key.key === 'ArrowUp') {
              key.preventDefault();
              void move(pen.id, -1);
            } else if (key.key === 'ArrowDown') {
              key.preventDefault();
              void move(pen.id, 1);
            }
          });
          return row;
        }),
      ),
    ]);
  };

  const addBox = combobox({
    label: 'Add a pen',
    options: () => choices.map((pen) => ({ id: pen.id, label: pen.title })),
    onChoose: async (option) => {
      if (!option) return;
      try {
        collection = await api.post<Collection>(`/api/collections/${params.id}/pens`, {
          pen_id: option.id,
        });
        paint();
        say(collectionStatus, copy.collectionAdded(option.label));
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'duplicate') {
          say(collectionStatus, copy.collectionDuplicate(option.label));
          return;
        }
        throw error;
      }
    },
  });
  replace(addHolder, [addBox.root]);

  choices = (await api.get<{ pens: PenSummary[] }>('/api/pens')).pens;
  addBox.refresh();
  paint();
};
