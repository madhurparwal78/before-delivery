import { api, failureOf } from '../api.ts';
import { copy } from '../copy.ts';
import { districtCounters } from '../counters.ts';
import { el, setText, trapFocus } from '../dom.ts';
import type { Screen } from '../screen.ts';
import { requireUser } from '../session.ts';
import { dataRow, dataTable } from '../table.ts';
import type { ContractorRecord } from '../types.ts';

/** Contractors, and the clerk's erasure. */

interface RowView {
  row: HTMLElement;
  name: HTMLElement;
  phone: HTMLElement;
  state: HTMLElement;
  erase: HTMLButtonElement | null;
}

export async function contractorsScreen(): Promise<Screen> {
  const user = requireUser();
  const counters = districtCounters();
  const table = dataTable('Contractors', ['Code', 'Name', 'Phone', 'State']);
  const status = el('p', {
    class: 'status',
    attrs: { role: 'status', 'aria-label': 'Contractor status', 'aria-live': 'polite' },
  });
  const dialogHost = el('div');

  const element = el('main', {
    class: 'page',
    children: [
      counters.element,
      el('h1', { text: 'Contractors' }),
      el('section', { class: 'card', children: [table.element, status] }),
      dialogHost,
    ],
  });

  const rows = new Map<string, RowView>();

  const paintRow = (view: RowView, contractor: ContractorRecord): void => {
    setText(view.name, contractor.erased ? copy.erasedName(contractor.code) : contractor.name ?? '');
    setText(view.phone, contractor.erased ? '' : contractor.phone ?? '');
    setText(view.state, contractor.erased ? 'Erased' : 'Active');
    if (view.erase !== null) view.erase.setAttribute('aria-disabled', contractor.erased ? 'true' : 'false');
  };

  const openDialog = (contractor: ContractorRecord, eraseButton: HTMLButtonElement): void => {
    const cancel = el('button', { class: 'button', text: 'Cancel', attrs: { type: 'button' } });
    const confirm = el('button', {
      class: 'button button-primary',
      text: 'Erase for good',
      attrs: { type: 'button' },
    });
    const dialog = el('div', {
      class: 'dialog',
      attrs: {
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-label': `Erase contractor ${contractor.code}`,
      },
      children: [
        el('h2', { text: `Erase contractor ${contractor.code}` }),
        el('p', {
          text: 'Their name, phone and email go for good. Their deliveries keep the operator code.',
        }),
        el('div', { class: 'dialog-actions', children: [cancel, confirm] }),
      ],
    });
    const overlay = el('div', { class: 'overlay', children: [dialog] });
    const release = trapFocus(dialog, () => close());
    const close = (): void => {
      release();
      overlay.remove();
      eraseButton.focus();
    };
    cancel.addEventListener('click', close);
    confirm.addEventListener('click', () => {
      release();
      overlay.remove();
      eraseButton.focus();
      setText(status, copy.erasing);
      void (async () => {
        try {
          await api.del(`/api/contractors/${encodeURIComponent(contractor.code)}`);
          setText(status, copy.contractorErased(contractor.code));
          const view = rows.get(contractor.code);
          if (view !== undefined) {
            paintRow(view, { ...contractor, name: null, phone: null, erased: true });
          }
          eraseButton.focus();
        } catch (cause) {
          const failure = failureOf(cause);
          setText(status, failure?.code === 'already_erased' ? copy.alreadyErased : failure?.message ?? '');
        }
      })();
    });
    dialogHost.appendChild(overlay);
    cancel.focus();
  };

  const refresh = async (): Promise<void> => {
    await counters.refresh();
    const reply = await api.get<{ contractors: ContractorRecord[] }>('/api/contractors');
    for (const contractor of reply.contractors) {
      let view = rows.get(contractor.code);
      if (view === undefined) {
        const name = el('span');
        const phone = el('span');
        const state = el('span');
        let erase: HTMLButtonElement | null = null;
        if (user.role === 'clerk') {
          erase = el('button', {
            class: 'button',
            text: 'Erase',
            attrs: { type: 'button', 'aria-label': `Erase ${contractor.code}` },
          });
          const button = erase;
          button.addEventListener('click', () => {
            if (button.getAttribute('aria-disabled') === 'true') return;
            openDialog(contractor, button);
          });
        }
        const row = dataRow([
          { label: 'Code', content: contractor.code },
          { label: 'Name', content: name },
          { label: 'Phone', content: phone },
          { label: 'State', content: erase === null ? state : [state, erase] },
        ]);
        view = { row, name, phone, state, erase };
        rows.set(contractor.code, view);
        table.body.appendChild(row);
      }
      paintRow(view, contractor);
    }
  };

  await refresh();
  return { element, refresh };
}
