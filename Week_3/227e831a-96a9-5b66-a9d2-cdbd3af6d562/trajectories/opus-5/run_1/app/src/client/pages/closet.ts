import { CATEGORY_ORDER } from '../../shared/categories.js';
import type { Item } from '../../shared/types.js';
import { api, upload } from '../api.js';
import type { AppContext } from '../app.js';
import { button, el, focusFirstField, openDialog } from '../dom.js';
import { cache, saveCache } from '../store.js';

const EMPTY_COPY = 'Your closet is empty. Add your first piece of gear or import a gear list.';

interface ClosetView {
  announce: (message: string) => void;
  reload: (then?: () => void) => void;
}

function priceText(priceCents: number | null): string {
  return priceCents === null ? '' : (priceCents / 100).toFixed(2);
}

function parsePrice(text: string): number | null | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const match = /^\$?(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (match === null) return 'invalid';
  const cents = (match[2] ?? '').padEnd(2, '0');
  return Number(match[1]) * 100 + Number(cents);
}

function gearDialog(
  view: ClosetView,
  opener: HTMLElement,
  item: Item | null,
): void {
  const handle = openDialog({
    name: item === null ? 'Add gear' : `Edit ${item.name}`,
    opener,
  });
  const conflict = el('p', { class: 'form-notice' });
  const name = el('input', { type: 'text', id: 'gear-name', class: 'field', value: item?.name ?? '' });
  const category = el('select', { id: 'gear-category', class: 'field' },
    CATEGORY_ORDER.map((option) =>
      el('option', { value: option, selected: item?.category === option }, [option]),
    ),
  );
  const weight = el('input', {
    type: 'number',
    id: 'gear-weight',
    class: 'field figure',
    min: '0',
    step: 'any',
    value: item === null ? '' : String(item.weightGrams),
  });
  const unitGrams = el('input', { type: 'radio', name: 'weight-unit', id: 'unit-g', value: 'g', checked: true });
  const unitOunces = el('input', { type: 'radio', name: 'weight-unit', id: 'unit-oz', value: 'oz' });
  const units = el('input', {
    type: 'number',
    id: 'gear-units',
    class: 'field figure',
    min: '1',
    max: '99',
    value: String(item?.unitsOwned ?? 1),
  });
  const price = el('input', { type: 'text', id: 'gear-price', class: 'field', value: priceText(item?.priceCents ?? null) });
  const notes = el('input', { type: 'text', id: 'gear-notes', class: 'field', value: item?.notes ?? '' });
  const errors = new Map<string, HTMLElement>();
  const field = (label: string, id: string, control: Node, key: string): HTMLElement => {
    const message = el('p', { class: 'field-error' });
    errors.set(key, message);
    return el('div', { class: 'form-row' }, [el('label', { for: id }, [label]), control, message]);
  };
  const save = el('button', { type: 'submit', class: 'primary' }, ['Save gear']);
  const cancel = button('Cancel', { class: 'secondary' }, () => {
    handle.close();
  });
  const form = el('form', { class: 'gear-form' }, [
    conflict,
    field('Name', 'gear-name', name, 'name'),
    field('Category', 'gear-category', category, 'category'),
    field('Weight', 'gear-weight', weight, 'weight'),
    el('fieldset', { class: 'form-row' }, [
      el('legend', {}, ['Weight unit']),
      el('label', { for: 'unit-g' }, [unitGrams, 'g']),
      el('label', { for: 'unit-oz' }, [unitOunces, 'oz']),
    ]),
    field('Units owned', 'gear-units', units, 'unitsOwned'),
    field('Price', 'gear-price', price, 'priceCents'),
    field('Private notes', 'gear-notes', notes, 'notes'),
    el('div', { class: 'form-actions' }, [save, cancel]),
  ]);
  handle.body.append(form);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const message of errors.values()) message.textContent = '';
    const parsedPrice = parsePrice(price.value);
    if (parsedPrice === 'invalid') {
      (errors.get('priceCents') as HTMLElement).textContent = 'Enter a price of 0 or more.';
      price.focus();
      return;
    }
    const body: Record<string, unknown> = {
      name: name.value,
      category: category.value,
      weight: { value: Number(weight.value), unit: unitOunces.checked ? 'oz' : 'g' },
      unitsOwned: Number(units.value),
      priceCents: parsedPrice,
      notes: notes.value,
    };
    view.announce('Saving...');
    const request =
      item === null
        ? api<{ item: Item }>('POST', '/api/closet', { body })
        : api<{ item: Item }>('PATCH', `/api/closet/${item.id}`, {
            body,
            headers: { 'if-match': `"${item.version}"` },
          });
    void request.then((result) => {
      if (result.ok) {
        view.announce(`Saved ${result.data.item.name}.`);
        handle.close();
        view.reload();
        return;
      }
      if (result.status === 412) {
        const message = `${result.message} Close this form and open it again to see the latest.`;
        conflict.textContent = message;
        view.announce(message);
        cancel.focus();
        return;
      }
      if (result.status === 409) {
        conflict.textContent = result.message;
        view.announce(result.message);
        name.focus();
        return;
      }
      if (result.status === 422) {
        let first: HTMLElement | null = null;
        for (const [key, message] of Object.entries(result.fields)) {
          const target = errors.get(key);
          if (target === undefined) continue;
          target.textContent = message;
          const control = target.parentElement?.querySelector<HTMLElement>('.field') ?? null;
          if (first === null) first = control;
        }
        first?.focus();
        return;
      }
      view.announce(result.message);
      handle.close();
      view.reload();
    });
  });
  focusFirstField(handle);
}

function retireDialog(view: ClosetView, opener: HTMLElement, item: Item, heading: HTMLElement): void {
  const handle = openDialog({ name: `Retire ${item.name}`, opener });
  const key = crypto.randomUUID();
  const units = el('input', {
    type: 'number',
    id: 'retire-units',
    class: 'field figure',
    min: '1',
    max: String(item.unitsOwned),
    value: '1',
  });
  const reasons = (['Sold', 'Retired', 'Lost'] as const).map((label) =>
    el('input', {
      type: 'radio',
      name: 'retire-reason',
      id: `reason-${label}`,
      value: label.toLowerCase(),
      checked: label === 'Sold',
    }),
  );
  const confirm = el('button', { type: 'submit', class: 'primary' }, ['Confirm retire']);
  const form = el('form', { class: 'gear-form' }, [
    el('div', { class: 'form-row' }, [el('label', { for: 'retire-units' }, ['Units']), units]),
    el('fieldset', { class: 'form-row' }, [
      el('legend', {}, ['Reason']),
      ...(['Sold', 'Retired', 'Lost'] as const).map((label, index) =>
        el('label', { for: `reason-${label}` }, [reasons[index] as HTMLElement, label]),
      ),
    ]),
    el('div', { class: 'form-actions' }, [
      confirm,
      button('Cancel', { class: 'secondary' }, () => {
        handle.close();
      }),
    ]),
  ]);
  handle.body.append(form);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const chosen = reasons.find((radio) => radio.checked);
    const requested = Number(units.value);
    void api<{ item: Item }>('POST', `/api/closet/${item.id}/retire`, {
      body: { units: requested, reason: chosen?.value ?? 'sold' },
      headers: { 'idempotency-key': key },
    }).then((result) => {
      if (result.ok) {
        view.announce(`Retired ${requested} of ${item.name}.`);
        const retired = result.data.item.unitsOwned === 0;
        handle.close({ restoreFocus: false });
        view.reload(() => {
          if (retired) heading.focus();
          else document.querySelector<HTMLElement>(`[data-edit="${item.id}"]`)?.focus();
        });
        return;
      }
      if (result.offline) {
        view.announce("Couldn't reach Skinout. Your retirement was not confirmed; confirm again.");
        confirm.focus();
        return;
      }
      if (result.code === 'request_in_progress' || result.code === 'idempotency_key_reused') {
        view.announce(result.message);
        confirm.focus();
        return;
      }
      if (result.code === 'item_retired') {
        view.announce(`${item.name} is already retired.`);
        handle.close();
        view.reload();
        return;
      }
      if (result.status === 422) {
        view.announce(Object.values(result.fields)[0] ?? result.message);
        confirm.focus();
        return;
      }
      view.announce(result.message);
      handle.close();
      view.reload();
    });
  });
  focusFirstField(handle);
}

export function mountCloset(root: HTMLElement, context: AppContext): void {
  const live = el('div', { class: 'live', role: 'status', 'aria-label': 'Closet updates' });
  const heading = el('h1', { tabindex: '-1' }, ['Closet']);
  const ledgerHolder = el('div', { class: 'ledger-holder' });
  const retiredHolder = el('div', { class: 'ledger-holder' });
  const actions = el('div', { class: 'row-actions' });
  const addGear = button('Add gear', { class: 'primary' }, (event) => {
    gearDialog(view, event.currentTarget as HTMLElement, null);
  });
  const importGear = button('Import gear list', { class: 'secondary' }, () => {
    context.navigate('/imports', { openImport: true });
  });
  actions.append(addGear, importGear);
  root.append(
    el('div', { class: 'sheet' }, [heading, actions, live, ledgerHolder, retiredHolder]),
  );

  const view: ClosetView = {
    announce: (message) => {
      live.textContent = message;
    },
    reload: (then) => {
      void api<{ items: Item[] }>('GET', '/api/closet').then((result) => {
        if (result.ok) {
          cache.items = result.data.items;
          saveCache();
          context.setOffline(false);
        } else if (result.offline) {
          context.setOffline(true);
        } else if (result.status === 401) {
          context.signedOut();
          return;
        }
        paint();
        then?.();
      });
    },
  };

  function photoCell(item: Item): HTMLElement {
    const cell = el('td', { class: 'photo-cell' });
    if (item.photo !== null) {
      cell.append(el('img', { src: item.photo.url, alt: `Photo of ${item.name}`, class: 'thumb' }));
    }
    return cell;
  }

  function row(item: Item, retired: boolean): HTMLElement {
    const cells: HTMLElement[] = [
      photoCell(item),
      el('td', {}, [
        el('span', { class: 'line-name' }, [item.name]),
        el('span', { class: 'line-meta' }, [item.category]),
      ]),
      el('td', { class: 'weight figure' }, [item.weightDisplay]),
      el('td', {}, [
        el('span', {}, [String(item.unitsOwned)]),
        el('span', { class: 'line-meta' }, [
          `Packed in ${item.packedInLists} / owned ${item.unitsOwned}`,
        ]),
      ]),
    ];
    const rowActions = el('td', { class: 'row-actions' });
    if (retired) {
      rowActions.append(
        button('Delete', { class: 'secondary', 'aria-label': `Delete ${item.name}` }, (event) => {
          const target = event.currentTarget as HTMLElement;
          void api('DELETE', `/api/closet/${item.id}`).then((result) => {
            if (result.ok) {
              view.announce(`Deleted ${item.name}.`);
              view.reload(() => heading.focus());
              return;
            }
            if (result.code === 'item_in_lists') {
              view.announce(`${item.name} is on a trip list and can't be deleted. Retire it instead.`);
            } else if (result.code === 'storage_unavailable') {
              view.announce(`Photo storage is unavailable, so ${item.name} was not deleted.`);
            } else {
              view.announce(result.message);
            }
            target.focus();
          });
        }),
      );
    } else {
      const edit = button('Edit', { class: 'secondary', 'data-edit': item.id, 'aria-label': `Edit ${item.name}` }, (event) => {
        gearDialog(view, event.currentTarget as HTMLElement, item);
      });
      const retire = button('Retire', { class: 'secondary', 'aria-label': `Retire ${item.name}` }, (event) => {
        retireDialog(view, event.currentTarget as HTMLElement, item, heading);
      });
      const picker = el('input', { type: 'file', class: 'file-hidden', accept: 'image/*' });
      const photo = button('Add photo', { class: 'secondary', 'aria-label': `Add photo for ${item.name}` }, () => {
        picker.click();
      });
      picker.addEventListener('change', () => {
        const file = picker.files?.[0];
        if (file === undefined) return;
        view.announce('Uploading photo...');
        void upload(`/api/closet/${item.id}/photo`, 'photo', file).then((result) => {
          if (result.ok) {
            view.announce('Photo ready.');
            view.reload(() => {
              document.querySelector<HTMLElement>(`[data-edit="${item.id}"]`)?.focus();
            });
            return;
          }
          if (result.code === 'storage_unavailable' || result.offline) {
            view.announce('Photo storage is unavailable. The item was saved without a new photo.');
          } else if (result.status === 422) {
            view.announce(result.fields['photo'] ?? result.message);
          } else {
            view.announce(result.message);
          }
          photo.focus();
        });
      });
      rowActions.append(edit, retire, photo, picker);
    }
    cells.push(rowActions);
    return el('tr', { class: 'ledger-row' }, cells);
  }

  function table(items: Item[], caption: string, retired: boolean): HTMLElement {
    const body = el('tbody');
    for (const category of CATEGORY_ORDER) {
      const inCategory = items.filter((item) => item.category === category);
      if (inCategory.length === 0) continue;
      body.append(
        el('tr', { class: 'group-row' }, [
          el('th', { colspan: '5', scope: 'colgroup' }, [
            el('h2', { class: 'group-heading' }, [category]),
          ]),
        ]),
      );
      for (const item of inCategory) body.append(row(item, retired));
    }
    return el('table', { class: 'ledger' }, [el('caption', {}, [caption]), body]);
  }

  function paint(): void {
    const items = cache.items;
    const active = items.filter((item) => item.status === 'active');
    const retired = items.filter((item) => item.status === 'retired');
    ledgerHolder.replaceChildren(
      active.length === 0
        ? el('p', { class: 'empty' }, [EMPTY_COPY])
        : table(active, 'Closet ledger', false),
    );
    retiredHolder.replaceChildren(
      ...(retired.length === 0
        ? []
        : [el('h2', { tabindex: '-1' }, ['Retired gear']), table(retired, 'Retired gear', true)]),
    );
  }

  paint();
  view.reload();
}
