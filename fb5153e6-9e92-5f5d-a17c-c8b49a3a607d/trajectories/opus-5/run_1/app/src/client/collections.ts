import { all, one, readState } from './dom.js';
import { call } from './api.js';
import { notify, notifyThenRefresh, showFailure } from './forms.js';
import { localeFromLang } from '../shared/locale.js';
import {
  addedToCollection,
  collectionRegionName,
  modelMovedToCollection,
  moveModel,
  removeModel,
  removedFromCollection,
  s,
} from '../shared/strings.js';

interface CollectionsState {
  collections: { slug: string; name: string }[];
  titles: Record<string, string>;
}

interface CollectionPayload {
  slug: string;
  name: string;
  item_count: number;
  models: string[];
}

const locale = localeFromLang(new URL(window.location.href).searchParams.get('lang'));
const alertNode = one('[data-collections-alert]');
const state = readState<CollectionsState>('collections-state');
const nameFor = (slug: string): string =>
  state?.collections.find((c) => c.slug === slug)?.name ?? slug;
const titleFor = (slug: string): string => state?.titles[slug] ?? slug;

/** Counts and lists are redrawn from a recount, so the notice is not lost. */
async function refreshRegions(): Promise<void> {
  const reply = await call<{ items: CollectionPayload[] }>('/api/studio/collections', { locale });
  for (const collection of reply.items) {
    const region = one<HTMLElement>(`[data-collection="${collection.slug}"]`);
    if (region === null) continue;
    const label = collectionRegionName(collection.name, collection.item_count);
    region.setAttribute('aria-label', label);
    const heading = one('h2', region);
    if (heading !== null) heading.textContent = label;

    const list = one<HTMLUListElement>('ul', region);
    if (list === null) continue;
    list.replaceChildren(
      ...collection.models.map((slug) => {
        const item = document.createElement('li');
        item.append(document.createTextNode(`${titleFor(slug)} `));
        const buttons: [string, string][] = [
          ['move', moveModel(titleFor(slug), locale)],
          ['remove', removeModel(titleFor(slug), locale)],
        ];
        for (const [action, text] of buttons) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'button button-secondary';
          button.dataset.collection = collection.slug;
          if (action === 'move') button.dataset.moveModel = slug;
          else button.dataset.removeModel = slug;
          button.textContent = text;
          item.append(button, document.createTextNode(' '));
        }
        return item;
      }),
    );
  }
}

const createForm = one<HTMLFormElement>('[data-create-collection]');
createForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    try {
      await call('/api/studio/collections', {
        method: 'POST',
        locale,
        body: { name: one<HTMLInputElement>('[name="name"]', createForm)?.value ?? '' },
      });
      // A new region has to be laid out, so the screen is rebuilt.
      notifyThenRefresh(s('noticeSaved', locale));
    } catch (error) {
      showFailure(alertNode, error, locale, createForm);
    }
  })();
});

for (const button of all<HTMLButtonElement>('[data-add-model]')) {
  const collection = button.dataset.addModel ?? '';
  button.addEventListener('click', () => {
    void (async () => {
      const slug = one<HTMLSelectElement>(`[data-add-slug="${collection}"]`)?.value ?? '';
      try {
        await call(`/api/studio/collections/${collection}/items`, {
          method: 'POST',
          locale,
          body: { model: slug },
        });
        await refreshRegions();
        notify(addedToCollection(nameFor(collection), locale));
      } catch (error) {
        showFailure(alertNode, error, locale, null);
      }
    })();
  });
}

document.addEventListener('click', (event) => {
  const target = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-remove-model]');
  if (target === null || target === undefined) return;
  void (async () => {
    const collection = target.dataset.collection ?? '';
    await call(`/api/studio/collections/${collection}/items/${target.dataset.removeModel ?? ''}`, {
      method: 'DELETE',
      locale,
    });
    await refreshRegions();
    notify(removedFromCollection(nameFor(collection), locale));
  })();
});

document.addEventListener('click', (event) => {
  const target = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-move-model]');
  if (target === null || target === undefined) return;
  void (async () => {
    const from = target.dataset.collection ?? '';
    const to = one<HTMLSelectElement>(`[data-move-target="${from}"]`)?.value ?? '';
    if (to === '') return;
    try {
      await call(`/api/studio/collections/${from}/items/${target.dataset.moveModel ?? ''}/move`, {
        method: 'POST',
        locale,
        body: { to },
      });
      await refreshRegions();
      notify(modelMovedToCollection(nameFor(to), locale));
    } catch (error) {
      showFailure(alertNode, error, locale, null);
    }
  })();
});

for (const button of all<HTMLButtonElement>('[data-delete-collection]')) {
  button.addEventListener('click', () => {
    void (async () => {
      await call(`/api/studio/collections/${button.dataset.deleteCollection ?? ''}`, {
        method: 'DELETE',
        locale,
      });
      notifyThenRefresh(s('noticeCollectionDeleted', locale));
    })();
  });
}
