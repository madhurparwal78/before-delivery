import { el, announce } from '../dom.js';
import { api } from '../api.js';
import { openDialog } from '../dialogs.js';
import { navigate } from '../router.js';
import { state, loadCloset, currentUnit } from '../main.js';
import type { Item } from '../apiTypes.js';
import { CATEGORIES } from '../../domain/types.js';
import { convertNumberToGrams } from '../../domain/weights.js';
import { formatWeight } from '../../domain/format.js';

/**
 * The Closet page: the ledger of every active closet item, grouped by
 * category in the fixed order, with retired gear in its own section.
 */

export async function renderCloset(page: HTMLElement): Promise<void> {
  await loadCloset();
  page.textContent = '';
  page.append(el('h1', { text: 'Closet' }));
  const actions = el('div', { class: 'page-head' });
  const addGear = el('button', { type: 'button', text: 'Add gear' });
  addGear.addEventListener('click', () => openGearDialog(null, addGear));
  const importGear = el('button', { type: 'button', text: 'Import gear list' });
  importGear.addEventListener('click', () => {
    navigate('/imports');
    // The Imports page opens its dialog when asked from the Closet.
    window.dispatchEvent(new CustomEvent('skinout:open-import'));
  });
  actions.append(addGear, importGear);
  page.append(actions);

  const active = state.items.filter((item) => item.status === 'active');
  const retired = state.items.filter((item) => item.status === 'retired');

  if (active.length === 0) {
    const empty = el('div', { class: 'empty-state', text: "Your closet is empty. Add your first piece of gear or import a gear list." });
    page.append(empty);
  } else {
    const table = el('table', { class: 'ledger', 'aria-label': 'Closet ledger' });
    const head = el('thead');
    head.append(el('tr', {}, [el('th', { text: 'Photo' }), el('th', { text: 'Name' }), el('th', { text: 'Category' }), el('th', { text: 'Weight', class: 'mono-header' }), el('th', { text: 'Units' }), el('th', { text: 'Actions' })]));
    table.append(head);
    const body = el('tbody');
    for (const category of CATEGORIES) {
      const rows = active.filter((item) => item.category === category);
      if (rows.length === 0) continue;
      body.append(el('tr', { class: 'group-heading-row' }, [el('td', { colspan: '6' }, [el('h3', { text: category })])]));
      for (const item of rows) {
        body.append(activeRow(item));
      }
    }
    table.append(body);
    page.append(table);
  }

  page.append(el('h2', { text: 'Retired gear' }));
  if (retired.length > 0) {
    const retiredTable = el('table', { class: 'ledger', 'aria-label': 'Retired gear' });
    const body = el('tbody');
    for (const item of retired) {
      const row = el('tr');
      row.append(el('td', {}, [item.photo !== null ? el('img', { class: 'thumb', src: item.photo.url, alt: `Photo of ${item.name}` }) : null]));
      row.append(el('td', { class: 'name-cell', text: item.name }));
      row.append(el('td', { text: item.category }));
      row.append(el('td', { class: 'mono', text: formatWeight(item.weightGrams, currentUnit()) }));
      row.append(el('td', { text: `Packed in ${item.packedInLists} / owned ${item.unitsOwned}` }));
      const actionsCell = el('td', { class: 'row-controls' });
      const deleteButton = el('button', { type: 'button', text: `Delete ${item.name}` });
      deleteButton.addEventListener('click', () => {
        void (async () => {
          const answer = await api.delete(`/api/closet/${item.id}`);
          if (answer.ok) {
            announce('Closet updates', `Deleted ${item.name}.`);
            await renderCloset(page);
            document.querySelector('h1')?.focus?.();
            (page.querySelector('h1') as HTMLElement | null)?.focus();
          } else {
            const failure = answer.failure;
            if (failure.code === 'item_in_lists') announce('Closet updates', `${item.name} is on a trip list and can't be deleted. Retire it instead.`);
            else if (failure.code === 'storage_unavailable') announce('Closet updates', `Photo storage is unavailable, so ${item.name} was not deleted.`);
            else announce('Closet updates', failure.message);
          }
        })();
      });
      actionsCell.append(deleteButton);
      row.append(actionsCell);
      body.append(row);
    }
    retiredTable.append(body);
    page.append(retiredTable);
  } else {
    page.append(el('div', { class: 'empty-state', text: 'No retired gear.' }));
  }
}

function activeRow(item: Item): HTMLElement {
  const row = el('tr');
  row.append(el('td', {}, [item.photo !== null ? el('img', { class: 'thumb', src: item.photo.url, alt: `Photo of ${item.name}` }) : null]));
  const nameCell = el('td', { class: 'name-cell' });
  nameCell.append(el('strong', { text: item.name }), el('div', { text: item.category, class: 'left-count' }));
  row.append(nameCell);
  row.append(el('td', { class: 'mono', text: formatWeight(item.weightGrams, currentUnit()) }));
  row.append(el('td', { text: `Packed in ${item.packedInLists} / owned ${item.unitsOwned}` }));
  const actionsCell = el('td', { class: 'row-controls' });
  const edit = el('button', { type: 'button', text: `Edit ${item.name}` });
  edit.addEventListener('click', () => openGearDialog(item, edit));
  const retire = el('button', { type: 'button', text: `Retire ${item.name}` });
  retire.addEventListener('click', () => openRetireDialog(item, retire));
  const photo = el('button', { type: 'button', text: `Add photo for ${item.name}` });
  photo.addEventListener('click', () => {
    const input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' }) as HTMLInputElement;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      announce('Closet updates', 'Uploading photo...');
      void (async () => {
        const answer = await api.upload(`/api/closet/${item.id}/photo`, file, 'photo');
        if (answer.ok) {
          announce('Closet updates', 'Photo ready.');
          await loadCloset();
          refreshPage();
        } else if (answer.failure.code === 'validation_failed') {
          announce('Closet updates', answer.failure.fields?.['photo'] ?? 'Use a JPEG, PNG or WebP image.');
        } else if (answer.failure.code === 'storage_unavailable') {
          announce('Closet updates', 'Photo storage is unavailable. The item was saved without a new photo.');
        } else {
          announce('Closet updates', answer.failure.message);
        }
      })();
    });
    input.click();
  });
  actionsCell.append(edit, retire, photo);
  row.append(actionsCell);
  return row;
}

function refreshPage(): void {
  const path = window.location.pathname;
  if (path === '/closet') navigate('/closet', true);
}

/** The Add gear / Edit <name> dialog. */
function openGearDialog(item: Item | null, opener: HTMLElement): void {
  const fields: Record<string, HTMLElement> = {};
  const conflict = el('div', { class: 'field-error', hidden: 'hidden' });
  openDialog(item === null ? 'Add gear' : `Edit ${item.name}`, (dialog) => {
    const form = el('form');
    const addField = (name: string, labelText: string, input: HTMLElement, hint?: HTMLElement): void => {
      const wrap = el('div', { class: 'field' });
      const label = el('label', { class: 'field-label', for: input.id, text: labelText });
      wrap.append(label, input);
      const error = el('div', { class: 'field-error', id: `${name}-error`, hidden: 'hidden' });
      fields[name] = error;
      wrap.append(error);
      if (hint !== undefined) wrap.append(hint);
      form.append(wrap);
    };
    const name = el('input', { id: 'gear-name', type: 'text', value: item?.name ?? '' }) as HTMLInputElement;
    const category = el('select', { id: 'gear-category' }) as HTMLSelectElement;
    for (const candidate of CATEGORIES) {
      const option = el('option', { value: candidate, text: candidate });
      if (item !== null && item.category === candidate) option.setAttribute('selected', 'selected');
      category.append(option);
    }
    const weight = el('input', { id: 'gear-weight', type: 'number', step: 'any', min: '0' }) as HTMLInputElement;
    weight.value = item !== null ? String(item.weightGrams) : '';
    const unit = el('select', { id: 'gear-weight-unit' }) as HTMLSelectElement;
    unit.append(el('option', { value: 'g', text: 'g', selected: 'selected' }), el('option', { value: 'oz', text: 'oz' }));
    const unitsOwned = el('input', { id: 'gear-units', type: 'number', min: '1', max: '99', value: String(item?.unitsOwned ?? 1) }) as HTMLInputElement;
    const price = el('input', { id: 'gear-price', type: 'text', value: item !== null && item.priceCents !== null ? (item.priceCents / 100).toFixed(2) : '' }) as HTMLInputElement;
    const notes = el('textarea', { id: 'gear-notes', rows: '3' }) as HTMLTextAreaElement;
    notes.value = item?.notes ?? '';

    addField('name', 'Name', name);
    addField('category', 'Category', category);
    addField('weight', 'Weight', el('div', { class: 'mode-group' }, [weight, unit]));
    addField('unitsOwned', 'Units owned', unitsOwned);
    addField('priceCents', 'Price', price);
    addField('notes', 'Private notes', notes);

    const save = el('button', { type: 'submit', text: 'Save gear' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    form.append(conflict, save, cancel);
    dialog.append(form);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void (async () => {
        conflict.setAttribute('hidden', 'hidden');
        for (const error of Object.values(fields)) error.setAttribute('hidden', 'hidden');
        void convertNumberToGrams;
        const body: Record<string, unknown> = {
          name: name.value,
          category: category.value,
          weight: { value: Number(weight.value), unit: unit.value === 'oz' ? 'oz' : 'g' },
          unitsOwned: Number(unitsOwned.value),
          priceCents: price.value === '' ? null : Math.round(Number(price.value) * 100),
          notes: notes.value,
        };
        announce('Closet updates', 'Saving...');
        const answer =
          item === null
            ? await api.post<{ item: Item }>('/api/closet', body)
            : await api.patch<{ item: Item }>(`/api/closet/${item.id}`, body, { 'If-Match': `"${item.version}"` });
        if (answer.ok) {
          announce('Closet updates', `Saved ${answer.body.item.name}.`);
          dialog.remove();
          opener.focus();
          await loadCloset();
          refreshPage();
          return;
        }
        if (answer.failure.status === 412 || answer.failure.status === 428) {
          const currentName = answer.failure.message.replace(' changed on another device.', '');
          conflict.textContent = `${currentName} changed on another device. Close this form and open it again to see the latest.`;
          conflict.removeAttribute('hidden');
          announce('Closet updates', `${currentName} changed on another device. Close this form and open it again to see the latest.`);
          cancel.focus();
          return;
        }
        if (answer.failure.fields !== undefined) {
          for (const [field, message] of Object.entries(answer.failure.fields)) {
            const target = fields[field];
            if (target !== undefined) {
              target.textContent = message;
              target.removeAttribute('hidden');
            }
          }
          return;
        }
        announce('Closet updates', answer.failure.message);
      })();
    });
    cancel.addEventListener('click', () => {
      dialog.remove();
      opener.focus();
    });
  }, opener);
  void fields;
}

/** The Retire <name> dialog, with its one Idempotency-Key per opening. */
function openRetireDialog(item: Item, opener: HTMLElement): void {
  const key = `retire-${crypto.randomUUID()}`;
  let inFlight = false;
  openDialog(`Retire ${item.name}`, (dialog) => {
    const units = el('input', { id: 'retire-units', type: 'number', min: '1', max: String(item.unitsOwned), value: '1' }) as HTMLInputElement;
    const unitsError = el('div', { class: 'field-error', hidden: 'hidden' });
    const reason = el('select', { id: 'retire-reason' }) as HTMLSelectElement;
    reason.append(el('option', { value: 'sold', text: 'Sold', selected: 'selected' }), el('option', { value: 'retired', text: 'Retired' }), el('option', { value: 'lost', text: 'Lost' }));
    const confirmButton = el('button', { type: 'button', text: 'Confirm retire' });
    const cancelButton = el('button', { type: 'button', text: 'Cancel' });
    const wrap = el('div', { class: 'field' });
    wrap.append(el('label', { class: 'field-label', for: 'retire-units', text: 'Units' }), units, unitsError);
    const reasonWrap = el('div', { class: 'field' });
    reasonWrap.append(el('label', { class: 'field-label', for: 'retire-reason', text: 'Reason' }), reason);
    dialog.append(wrap, reasonWrap, el('div', { class: 'actions' }, [confirmButton, cancelButton]));

    confirmButton.addEventListener('click', () => {
      if (inFlight) return;
      inFlight = true;
      void (async () => {
        const answer = await api.post<{ item: Item; affectedLines: number }>(`/api/closet/${item.id}/retire`, { units: Number(units.value), reason: reason.value }, { 'Idempotency-Key': key });
        inFlight = false;
        if (answer.ok) {
          announce('Closet updates', `Retired ${Number(units.value)} of ${answer.body.item.name}.`);
          dialog.remove();
          if (answer.body.item.status === 'retired') {
            document.querySelector('h1')?.focus();
          } else {
            opener.focus();
          }
          await loadCloset();
          refreshPage();
          return;
        }
        if (answer.failure.network) {
          announce('Closet updates', "Couldn't reach Skinout. Your retirement was not confirmed; confirm again.");
          confirmButton.focus();
          return;
        }
        if (answer.failure.code === 'request_in_progress' || answer.failure.code === 'idempotency_key_reused') {
          announce('Closet updates', answer.failure.message);
          confirmButton.focus();
          return;
        }
        if (answer.failure.code === 'item_retired') {
          announce('Closet updates', `${item.name} is already retired.`);
          dialog.remove();
          opener.focus();
          await loadCloset();
          refreshPage();
          return;
        }
        if (answer.failure.fields !== undefined) {
          const message = answer.failure.fields['units'] ?? answer.failure.fields['reason'];
          if (message !== undefined) {
            unitsError.textContent = message;
            unitsError.removeAttribute('hidden');
            units.setAttribute('aria-invalid', 'true');
          }
          return;
        }
        announce('Closet updates', answer.failure.message);
        dialog.remove();
        opener.focus();
      })();
    });
    cancelButton.addEventListener('click', () => {
      dialog.remove();
      opener.focus();
    });
  }, opener);
}
