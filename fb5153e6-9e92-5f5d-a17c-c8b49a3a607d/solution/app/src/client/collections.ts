import { all, one, readState } from './dom.js';
import { call } from './api.js';
import { notify, showFailure } from './forms.js';
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
const names = new Map<string, string>((state?.collections ?? []).map((c) => [c.slug, c.name]));
const nameFor = (slug: string): string => names.get(slug) ?? slug;
const titleFor = (slug: string): string => state?.titles[slug] ?? slug;
const createForm = one<HTMLFormElement>('[data-create-collection]');

function secondary(text: string, data: Readonly<Record<string, string>>): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-secondary';
  for (const [key, value] of Object.entries(data)) button.dataset[key] = value;
  button.textContent = text;
  return button;
}

function option(value: string, text: string | null): HTMLOptionElement {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = text;
  return node;
}

function modelOptions(): HTMLOptionElement[] {
  const template = one<HTMLSelectElement>('[data-add-slug]');
  if (template === null) return [];
  return Array.from(template.options).map((o) => option(o.value, o.textContent));
}

function itemFor(collection: string, slug: string): HTMLLIElement {
  const item = document.createElement('li');
  item.append(document.createTextNode(`${titleFor(slug)} `));
  item.append(
    secondary(moveModel(titleFor(slug), locale), { moveModel: slug, collection }),
    document.createTextNode(' '),
    secondary(removeModel(titleFor(slug), locale), { removeModel: slug, collection }),
    document.createTextNode(' '),
  );
  return item;
}

function sectionFor(slug: string): HTMLElement {
  const section = document.createElement('section');
  section.setAttribute('role', 'region');
  section.dataset.collection = slug;
  section.append(document.createElement('h2'), document.createElement('ul'));

  const add = document.createElement('select');
  add.dataset.addSlug = slug;
  add.setAttribute('aria-label', s('addToCollection', locale));
  add.append(...modelOptions());

  const move = document.createElement('select');
  move.dataset.moveTarget = slug;
  move.setAttribute('aria-label', s('moveTo', locale));

  const controls = document.createElement('div');
  controls.className = 'viewer-controls';
  controls.append(
    add,
    move,
    secondary(s('addToCollection', locale), { addModel: slug }),
    secondary(s('deleteCollection', locale), { deleteCollection: slug }),
  );
  section.append(controls);
  return section;
}

function regionFor(slug: string): HTMLElement | null {
  return one<HTMLElement>(`section[data-collection="${slug}"]`);
}

function place(section: HTMLElement): void {
  const existing = all<HTMLElement>('section[data-collection]');
  const last = existing[existing.length - 1];
  if (last === undefined) createForm?.after(section);
  else last.after(section);
}

async function refreshRegions(): Promise<void> {
  const reply = await call<{ items: CollectionPayload[] }>('/api/studio/collections', { locale });
  for (const collection of reply.items) {
    names.set(collection.slug, collection.name);
    let region = regionFor(collection.slug);
    if (region === null) {
      region = sectionFor(collection.slug);
      place(region);
    }
    const label = collectionRegionName(collection.name, collection.item_count);
    region.setAttribute('aria-label', label);
    const heading = one('h2', region);
    if (heading !== null) heading.textContent = label;
    const list = one<HTMLUListElement>('ul', region);
    if (list !== null) {
      list.replaceChildren(
        ...collection.models.map((slug) => itemFor(collection.slug, slug)),
      );
    }
  }

  const live = new Set(reply.items.map((collection) => collection.slug));
  for (const region of all<HTMLElement>('section[data-collection]')) {
    const slug = region.dataset.collection ?? '';
    if (!live.has(slug)) {
      region.remove();
      names.delete(slug);
    }
  }

  for (const collection of reply.items) {
    const select = one<HTMLSelectElement>(`[data-move-target="${collection.slug}"]`);
    if (select === null) continue;
    select.replaceChildren(
      ...reply.items
        .filter((other) => other.slug !== collection.slug)
        .map((other) => option(other.slug, other.name)),
    );
  }
}

createForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    const field = one<HTMLInputElement>('[name="name"]', createForm);
    try {
      await call('/api/studio/collections', {
        method: 'POST',
        locale,
        body: { name: field?.value ?? '' },
      });
      if (field !== null) field.value = '';
      await refreshRegions();
      notify(s('noticeSaved', locale));
    } catch (error) {
      showFailure(alertNode, error, locale, createForm);
    }
  })();
});

function delegate(selector: string, run: (button: HTMLButtonElement) => Promise<void>): void {
  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(selector);
    if (button === null || button === undefined) return;
    void run(button).catch((error: unknown) => {
      showFailure(alertNode, error, locale, null);
    });
  });
}

delegate('[data-add-model]', async (button) => {
  const collection = button.dataset.addModel ?? '';
  const slug = one<HTMLSelectElement>(`[data-add-slug="${collection}"]`)?.value ?? '';
  await call(`/api/studio/collections/${collection}/items`, {
    method: 'POST',
    locale,
    body: { model: slug },
  });
  await refreshRegions();
  notify(addedToCollection(nameFor(collection), locale));
});

delegate('[data-remove-model]', async (button) => {
  const collection = button.dataset.collection ?? '';
  await call(
    `/api/studio/collections/${collection}/items/${button.dataset.removeModel ?? ''}`,
    { method: 'DELETE', locale },
  );
  await refreshRegions();
  notify(removedFromCollection(nameFor(collection), locale));
});

delegate('[data-move-model]', async (button) => {
  const from = button.dataset.collection ?? '';
  const to = one<HTMLSelectElement>(`[data-move-target="${from}"]`)?.value ?? '';
  if (to === '') return;
  await call(`/api/studio/collections/${from}/items/${button.dataset.moveModel ?? ''}/move`, {
    method: 'POST',
    locale,
    body: { to },
  });
  await refreshRegions();
  notify(modelMovedToCollection(nameFor(to), locale));
});

delegate('[data-delete-collection]', async (button) => {
  const slug = button.dataset.deleteCollection ?? '';
  await call(`/api/studio/collections/${slug}`, { method: 'DELETE', locale });
  regionFor(slug)?.remove();
  names.delete(slug);
  await refreshRegions();
  notify(s('noticeCollectionDeleted', locale));
});
