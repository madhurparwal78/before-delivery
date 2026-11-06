import { api, failure } from '../lib/api.js';
import { el } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { handleAccessFailure, staffPage } from '../lib/chrome.js';
import {
  createMessageBox,
  FieldSet,
  handOffMessage,
  takeHandOffMessage,
  withPending,
  type MessageBox,
} from '../lib/forms.js';
import { link, navigate, type RouteContext } from '../lib/router.js';
import {
  button,
  combobox,
  definitionList,
  listItem,
  namedList,
  quietButton,
  radioGroup,
  textbox,
} from '../lib/views.js';
import { MESSAGES, MOVEMENT_KIND_WORDS } from '../../shared/copy.js';
import type { StoreItem } from '../lib/types.js';

export async function storesScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const yachtSlug = context.params.yachtSlug;
  const yachtResult = await api.get<{ yacht: { name: string } }>(
    `/api/w/${workspaceSlug}/yachts/${yachtSlug}`,
  );
  if (!yachtResult.ok) {
    const { notFoundScreen } = await import('./feedbackPages.js');
    await notFoundScreen(host);
    return;
  }
  const page = await staffPage(host, workspaceSlug, `${yachtResult.data.yacht.name} stores`);
  if (page === null) return;
  const messages = createMessageBox();
  takeHandOffMessage(messages);
  const search = el('input', {
    class: 'textbox searchbox',
    type: 'search',
    id: 'search-stores',
  }) as HTMLInputElement;
  const searchField = el(
    'div',
    { class: 'search-field' },
    el('label', { class: 'field-label', for: 'search-stores' }, 'Search stores'),
    search,
  );
  const items = namedList('Stores', 'No items match.');
  const loadMore = button('Load more');
  loadMore.hidden = true;
  const addItem = button('Add item');
  page.main.append(
    el('div', { class: 'stores-controls' }, searchField, addItem),
    messages.node,
    items.section,
    loadMore,
  );

  let cursor: string | null = null;
  let loaded: StoreItem[] = [];
  let token = 0;

  const paint = (): void => {
    items.setItems(
      loaded.map((item) =>
        listItem(
          el(
            'div',
            { class: 'store-card' },
            el(
              'h3',
              { class: 'card-heading' },
              link(item.name, `/w/${workspaceSlug}/yachts/${yachtSlug}/stores/${item.id}`),
            ),
            el('p', { class: 'card-figure' }, `${item.onHandQty} ${item.unit} on hand`),
            movementButton(workspaceSlug, yachtSlug, item, messages, () => void reload()),
          ),
        ),
      ),
    );
    loadMore.hidden = cursor === null;
  };

  const fetchPage = async (nextCursor: string | null): Promise<void> => {
    const current = (token += 1);
    const query = new URLSearchParams();
    if (search.value !== '') query.set('q', search.value);
    if (nextCursor !== null) query.set('cursor', nextCursor);
    const result = await api.get<{ items: readonly StoreItem[]; nextCursor: string | null }>(
      `/api/w/${workspaceSlug}/yachts/${yachtSlug}/stores?${query.toString()}`,
    );
    if (current !== token || !result.ok) return;
    loaded = nextCursor === null ? [...result.data.items] : [...loaded, ...result.data.items];
    cursor = result.data.nextCursor;
    paint();
  };

  const reload = async (): Promise<void> => {
    await fetchPage(null);
  };

  search.addEventListener('input', () => void fetchPage(null));
  loadMore.addEventListener('click', () => void fetchPage(cursor));
  addItem.addEventListener('click', () => {
    openDialog({
      name: 'Add item',
      opener: addItem,
      build: (handle) => {
        const fields = new FieldSet(true);
        const name = textbox('Item name');
        const unit = textbox('Unit');
        const category = combobox(
          'Category',
          [
            { value: 'provisions', label: 'Provisions' },
            { value: 'drinks', label: 'Drinks' },
            { value: 'cleaning', label: 'Cleaning' },
            { value: 'engine_room', label: 'Engine room' },
            { value: 'safety', label: 'Safety' },
          ],
          'provisions',
        );
        const dialogMessage = createMessageBox();
        const confirm = button('Add item');
        const cancel = quietButton('Cancel');
        cancel.addEventListener('click', () => handle.close());
        confirm.addEventListener('click', () => {
          void withPending(confirm, 'Adding item', async () => {
            const result = await api.post<{ item: StoreItem }>(
              `/api/w/${workspaceSlug}/yachts/${yachtSlug}/stores`,
              { name: name.value, unit: unit.value, category: category.value },
            );
            if (result.ok) {
              handle.close();
              handOffMessage(MESSAGES.itemAdded(result.data.item.name));
              navigate(
                `/w/${workspaceSlug}/yachts/${yachtSlug}/stores/${result.data.item.id}`,
              );
              return;
            }
            const body = failure(result);
            if (body.error === 'item_exists') {
              dialogMessage.show(MESSAGES.itemExists(name.value.trim()), 'problem');
            } else if (body.errors !== undefined) {
              fields.showErrors(body.errors)?.focus();
              return;
            } else if (!handleAccessFailure(result, dialogMessage)) {
              dialogMessage.show(MESSAGES.unexpected, 'problem');
            }
            confirm.focus();
          });
        });
        return {
          body: [
            fields.field('name', 'Item name', name),
            fields.field('unit', 'Unit', unit),
            fields.field('category', 'Category', category),
            dialogMessage.node,
            el('div', { class: 'dialog-actions' }, confirm, cancel),
          ],
          first: () => name,
        };
      },
    });
  });

  await reload();
}

function movementButton(
  workspaceSlug: string,
  yachtSlug: string,
  item: StoreItem,
  messages: MessageBox,
  afterSave: () => void,
): HTMLButtonElement {
  const trigger = button(`Log movement for ${item.name}`);
  trigger.addEventListener('click', () =>
    openLogMovement({ opener: trigger, workspaceSlug, yachtSlug, item, messages, afterSave }),
  );
  return trigger;
}

function openLogMovement(options: {
  readonly opener: HTMLButtonElement;
  readonly workspaceSlug: string;
  readonly yachtSlug: string;
  readonly item: StoreItem;
  readonly messages: MessageBox;
  readonly afterSave: () => void;
}): void {
  openDialog({
    name: 'Log movement',
    kind: 'sheet',
    opener: options.opener,
    build: (handle) => {
      const fields = new FieldSet(true);
      const kind = radioGroup(
        'Movement',
        [
          { value: 'received', label: 'Received' },
          { value: 'used', label: 'Used' },
          { value: 'spoiled', label: 'Spoiled' },
        ],
        'received',
      );
      const quantity = textbox('Quantity');
      const dialogMessage = createMessageBox();
      const confirm = button('Log movement');
      const cancel = quietButton('Cancel');
      cancel.addEventListener('click', () => handle.close());
      confirm.addEventListener('click', () => {
        void withPending(confirm, 'Logging movement', async () => {
          const result = await api.post<{ item: StoreItem }>(
            `/api/w/${options.workspaceSlug}/yachts/${options.yachtSlug}/stores/${options.item.id}/movements`,
            { kind: kind.value(), quantity: Number(quantity.value) },
          );
          if (result.ok) {
            handle.close();
            options.messages.show(
              MESSAGES.movementLogged(
                Number(quantity.value),
                result.data.item.unit,
                MOVEMENT_KIND_WORDS[kind.value() as 'received' | 'used' | 'spoiled'],
                result.data.item.onHandQty,
              ),
            );
            options.afterSave();
            return;
          }
          const body = failure(result);
          if (body.error === 'insufficient_stock') {
            dialogMessage.show(
              MESSAGES.insufficientStock(Number(body.onHandQty), options.item.unit),
              'problem',
            );
          } else if (body.errors !== undefined) {
            fields.showErrors(body.errors)?.focus();
            return;
          } else if (!handleAccessFailure(result, dialogMessage)) {
            dialogMessage.show(MESSAGES.unexpected, 'problem');
          }
          confirm.focus();
        });
      });
      return {
        body: [
          kind.node,
          fields.field('quantity', 'Quantity', quantity),
          dialogMessage.node,
          el('div', { class: 'dialog-actions' }, confirm, cancel),
        ],
        first: () => kind.node.querySelector<HTMLElement>('input'),
      };
    },
  });
}

export async function storeItemScreen(host: HTMLElement, context: RouteContext): Promise<void> {
  const workspaceSlug = context.params.ws;
  const yachtSlug = context.params.yachtSlug;
  const itemId = context.params.itemId;
  const result = await api.get<{ item: StoreItem }>(
    `/api/w/${workspaceSlug}/yachts/${yachtSlug}/stores/${itemId}`,
  );
  if (!result.ok) {
    const { notFoundScreen } = await import('./feedbackPages.js');
    await notFoundScreen(host);
    return;
  }
  let item = result.data.item;
  const page = await staffPage(host, workspaceSlug, item.name);
  if (page === null) return;
  const messages = createMessageBox();
  takeHandOffMessage(messages);
  const counts = el('div', {});
  const actions = el('div', { class: 'card-links' });
  page.main.append(messages.node, counts, actions);

  const paint = (): void => {
    counts.replaceChildren(
      definitionList([
        ['Unit', item.unit],
        ['Received', String(item.receivedQty)],
        ['Used', String(item.usedQty)],
        ['Spoiled', String(item.spoiledQty)],
        ['On hand', `${item.onHandQty} ${item.unit}`],
      ]),
    );
    actions.replaceChildren();
    const logMovement = movementButton(workspaceSlug, yachtSlug, item, messages, async () => {
      const reloaded = await api.get<{ item: StoreItem }>(
        `/api/w/${workspaceSlug}/yachts/${yachtSlug}/stores/${itemId}`,
      );
      if (reloaded.ok) {
        item = reloaded.data.item;
        paint();
      }
    });
    logMovement.textContent = 'Log movement';
    const remove = button('Remove item');
    remove.addEventListener('click', () => {
      openDialog({
        name: 'Remove item',
        opener: remove,
        build: (handle) => {
          const keep = quietButton('Keep item');
          keep.addEventListener('click', () => handle.close());
          const confirm = button('Remove item');
          confirm.addEventListener('click', () => {
            void withPending(confirm, 'Removing item', async () => {
              const removed = await api.delete(
                `/api/w/${workspaceSlug}/yachts/${yachtSlug}/stores/${itemId}`,
              );
              handle.close();
              if (removed.ok) {
                handOffMessage(MESSAGES.itemRemoved(item.name));
                navigate(`/w/${workspaceSlug}/yachts/${yachtSlug}/stores`);
              } else if (!handleAccessFailure(removed, messages)) {
                messages.show(MESSAGES.unexpected, 'problem');
              }
            });
          });
          return {
            body: [el('div', { class: 'dialog-actions' }, keep, confirm)],
            first: () => keep,
          };
        },
      });
    });
    actions.append(logMovement, remove);
  };
  paint();
}
