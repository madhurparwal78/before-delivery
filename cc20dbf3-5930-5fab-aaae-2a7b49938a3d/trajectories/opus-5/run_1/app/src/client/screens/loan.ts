import { ApiFailure, request } from '../api.js';
import { addDays } from '../../domain/calendar.js';
import { FIELD_COPY } from '../../shared/errors.js';
import type { Loan, Photo, Settlement } from '../../shared/api.js';
import { parseDollarsToCents } from '../../domain/money.js';
import {
  instantFromLocalInput,
  localDateTimeValue,
  loanWord,
  localTime,
  money,
  openDay,
} from '../format.js';
import { dropKey, keyFor, retainKey } from '../keys.js';
import { isStaff, state, type Screen } from '../shell.js';
import {
  announce,
  clear,
  element,
  labelledField,
  liveRegion,
  markPending,
  prefersReducedMotion,
  region,
  setFieldError,
} from '../ui/dom.js';
import { statusChip } from '../ui/chips.js';

const MAX_RENEWAL_DAYS = 7;

function receiptLines(settlement: Settlement): string[] {
  return [
    `Deposit held: ${money(settlement.deposit_cents)}`,
    `Deposit released: ${money(settlement.released_cents)}`,
    `Damage charge: ${money(settlement.damage_cents)}`,
    `Charged beyond deposit: ${money(settlement.extra_damage_cents)}`,
    `Late fee: ${money(settlement.late_fee_cents)} (${settlement.late_days} late days)`,
    `Total charged: ${money(settlement.total_charged_cents)}`,
  ];
}

function photoPanel(name: string, loanId: string, photos: readonly Photo[], caption: string): HTMLElement {
  const panel = region(name, [element('h2', {}, [name])]);
  panel.classList.add('span-6');
  if (photos.length === 0) {
    panel.appendChild(element('p', { class: 'empty' }, ['No photos yet']));
    return panel;
  }
  const grid = element('div', { class: 'photo-grid' });
  for (const [index, photo] of photos.entries()) {
    const image = element('img', {
      src: `/api/loans/${loanId}/photos/${photo.id}`,
      alt: `${caption} ${index + 1}`,
    });
    const frame = element('div', { class: 'photo-frame' }, [image]);
    image.addEventListener('error', () => {
      if (frame.querySelector('.photo-missing') !== null) return;
      frame.appendChild(element('div', { class: 'photo-missing' }, ['Photo unavailable']));
    });
    grid.appendChild(frame);
  }
  panel.appendChild(grid);
  return panel;
}

export function loanScreen(loanId: string, onMissing: () => void): Screen {
  const heading = element('h1', {}, ['\u2026']);
  const detailsHost = element('div', {});
  const statusHost = element('div', {});
  const body = element('div', {});
  const node = element('div', {}, [heading, detailsHost, statusHost, body]);
  let loan: Loan | null = null;
  let statusesBuilt = false;

  /** The live regions are built once, so an announcement survives a repaint. */
  function buildStatuses(current: Loan): void {
    if (statusesBuilt) return;
    statusesBuilt = true;
    const staff = isStaff(state.user);
    const owner = state.user?.id === current.member.id;
    if (staff || owner) statusHost.appendChild(liveRegion('Renewal result'));
    if (staff) statusHost.appendChild(liveRegion('Counter result'));
    if (state.user?.role === 'founder') statusHost.appendChild(liveRegion('Settlement result'));
  }

  function paint(): void {
    if (loan === null) return;
    const current = loan;
    clear(detailsHost);
    clear(body);
    const staff = isStaff(state.user);
    const founder = state.user?.role === 'founder';
    const owner = state.user?.id === current.member.id;
    const word = loanWord(current.status);

    heading.textContent = `${current.item.name}, unit ${current.unit.label}`;
    buildStatuses(current);

    const details = element('div', { class: 'box' }, [
      element('div', {}, [statusChip(word)]),
      element('div', { class: 'mono' }, [`Borrower: ${current.member.name}`]),
      element('div', { class: 'mono' }, [`Checked out: ${localTime(current.checked_out_at)}`]),
      element('div', { class: 'mono' }, [
        `Due: ${localTime(current.due_at)}${current.renewed_at === null ? '' : ' (renewed)'}`,
      ]),
      element('div', { class: 'mono' }, [
        `Returned: ${current.returned_at === null ? 'not yet' : localTime(current.returned_at)}`,
      ]),
      element('div', { class: 'mono' }, [
        current.deposit_cents === 0 ? 'No deposit' : `Deposit ${money(current.deposit_cents)}`,
      ]),
      current.late_days === null
        ? null
        : element('div', { class: 'mono' }, [
            current.on_time === true ? 'Returned on time' : `Late days: ${current.late_days}`,
          ]),
    ]);
    detailsHost.appendChild(details);

    if ((staff || owner) && current.status === 'out' && current.renewed_at === null) {
      body.appendChild(renewalControls(current));
    }

    body.appendChild(
      element('div', { class: 'grid' }, [
        photoPanel(
          'Checkout photos',
          current.id,
          current.photos.filter((photo) => photo.stage === 'checkout'),
          'Checkout photo',
        ),
        photoPanel(
          'Return photos',
          current.id,
          current.photos.filter((photo) => photo.stage === 'return'),
          'Return photo',
        ),
      ]),
    );

    if (staff) body.appendChild(photoUpload(current));
    if (staff && (current.status === 'out' || current.status === 'overdue')) {
      body.appendChild(checkInControls(current));
    }
    if (staff && current.status === 'returned') body.appendChild(inspectionControls(current));

    if (current.inspection !== null) {
      body.appendChild(
        element('div', { class: 'box' }, [
          element('h2', {}, ['Inspection']),
          element('div', { class: 'mono' }, [
            `Condition: ${current.inspection.outcome === 'ok' ? 'OK' : 'Damaged'}`,
          ]),
          element('div', {}, [current.inspection.note === '' ? 'No note' : current.inspection.note]),
        ]),
      );
    }

    if (founder && current.status === 'inspected') body.appendChild(settleControls(current));

    if (current.settlement !== null) {
      const receipt = region('Receipt', [
        element('h2', {}, ['Receipt']),
        element(
          'ul',
          { class: 'receipt-lines' },
          receiptLines(current.settlement).map((line) => element('li', {}, [line])),
        ),
      ]);
      receipt.tabIndex = -1;
      body.appendChild(receipt);
    }
  }

  function renewalControls(current: Loan): HTMLElement {
    const field = element('input', {
      id: 'new-due-date',
      type: 'date',
      min: addDays(current.due_date, 1),
      max: addDays(current.due_date, MAX_RENEWAL_DAYS),
    });
    const button = element('button', { type: 'button' });
    button.textContent = 'Renew';
    const box = element('div', { class: 'box' }, [
      element('h2', {}, ['Renew']),
      labelledField('New due date', field, 'new-due-date-error'),
      button,
    ]);
    const renew = (): void => {
      setFieldError('new-due-date-error', 'new-due-date', null);
      if (field.value === '' || !openDay(field.value)) {
        setFieldError('new-due-date-error', 'new-due-date', FIELD_COPY.due_date_renewal);
        announce('Renewal result', 'Check the highlighted fields.');
        return;
      }
      const action = `renew:${current.id}:${field.value}`;
      const pending = markPending(button, 'Renewing\u2026');
      void request<{ loan: Loan }>(`/api/loans/${current.id}/renewal`, {
        method: 'POST',
        idempotencyKey: keyFor(action),
        body: { due_date: field.value },
      })
        .then((answer) => {
          dropKey(action);
          loan = answer.loan;
          paint();
          announce('Renewal result', `Renewed. Due ${localTime(answer.loan.due_at)}.`);
        })
        .catch((error: unknown) => {
          pending.release();
          const failure = error instanceof ApiFailure ? error : null;
          if (failure?.code === 'billing_unavailable') retainKey(action);
          else dropKey(action);
          announce('Renewal result', failure?.message ?? 'Not found.');
          if (failure?.fields['due_date'] !== undefined) {
            setFieldError('new-due-date-error', 'new-due-date', failure.fields['due_date']);
          }
        });
    };
    button.addEventListener('click', renew);
    field.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        renew();
      }
    });
    return box;
  }

  function photoUpload(current: Loan): HTMLElement {
    const field = element('input', {
      id: 'condition-photo',
      type: 'file',
      accept: 'image/jpeg,image/png,image/webp',
      capture: 'environment',
    });
    const button = element('button', { type: 'button' });
    button.textContent = 'Add photo';
    button.addEventListener('click', () => {
      setFieldError('condition-photo-error', 'condition-photo', null);
      const file = field.files?.[0];
      if (file === undefined) {
        setFieldError('condition-photo-error', 'condition-photo', FIELD_COPY.required);
        announce('Counter result', 'Check the highlighted fields.');
        return;
      }
      const form = new FormData();
      form.append('photo', file, file.name);
      const pending = markPending(button, 'Uploading photo\u2026');
      void request<{ photo: Photo }>(`/api/loans/${current.id}/photos`, { method: 'POST', form })
        .then(() => {
          announce('Counter result', 'Photo saved.');
        })
        .catch((error: unknown) => {
          announce('Counter result', error instanceof ApiFailure ? error.message : 'Not found.');
        })
        .finally(() => {
          pending.release();
          field.value = '';
          void reload();
        });
    });
    return element('div', { class: 'box' }, [
      element('h2', {}, ['Condition photos']),
      labelledField('Condition photo', field, 'condition-photo-error'),
      button,
    ]);
  }

  function checkInControls(current: Loan): HTMLElement {
    const defaultValue = localDateTimeValue(new Date());
    const field = element('input', {
      id: 'returned-at',
      type: 'datetime-local',
      value: defaultValue,
    });
    const button = element('button', { type: 'button', class: 'primary' });
    button.textContent = 'Check in';
    button.addEventListener('click', () => {
      setFieldError('returned-at-error', 'returned-at', null);
      /** The untouched default means now, to the second, not the truncated minute. */
      let instant = field.value === defaultValue ? null : instantFromLocalInput(field.value);
      if (instant === null && field.value !== defaultValue) {
        setFieldError('returned-at-error', 'returned-at', FIELD_COPY.returned_at);
        announce('Counter result', 'Check the highlighted fields.');
        return;
      }
      /** A minute-precision field cannot express a checkout second, so clamp to it. */
      if (instant !== null && instant < current.checked_out_at) {
        if (instant.slice(0, 16) === current.checked_out_at.slice(0, 16)) {
          instant = current.checked_out_at;
        }
      }
      const pending = markPending(button, 'Checking in\u2026');
      void request<{ loan: Loan }>(`/api/loans/${current.id}/return`, {
        method: 'POST',
        body: instant === null ? {} : { returned_at: instant },
      })
        .then((answer) => {
          loan = answer.loan;
          paint();
          announce(
            'Counter result',
            answer.loan.on_time === true
              ? 'Checked in on time.'
              : `Checked in late: ${answer.loan.late_days ?? 0} late days.`,
          );
        })
        .catch((error: unknown) => {
          pending.release();
          const failure = error instanceof ApiFailure ? error : null;
          announce('Counter result', failure?.message ?? 'Not found.');
          if (failure?.fields['returned_at'] !== undefined) {
            setFieldError('returned-at-error', 'returned-at', failure.fields['returned_at']);
          }
          void reload();
        });
    });
    return element('div', { class: 'box' }, [
      element('h2', {}, ['Check in']),
      labelledField('Returned at', field, 'returned-at-error'),
      button,
    ]);
  }

  function inspectionControls(current: Loan): HTMLElement {
    const ok = element('input', { type: 'radio', name: 'condition', id: 'condition-ok', value: 'ok' });
    const damaged = element('input', {
      type: 'radio',
      name: 'condition',
      id: 'condition-damaged',
      value: 'damaged',
    });
    const note = element('textarea', { id: 'inspection-note', maxlength: '500' });
    const button = element('button', { type: 'button', class: 'primary' });
    button.textContent = 'Save inspection';
    button.addEventListener('click', () => {
      setFieldError('condition-error', 'condition-group', null);
      setFieldError('inspection-note-error', 'inspection-note', null);
      const outcome = ok.checked ? 'ok' : damaged.checked ? 'damaged' : null;
      if (outcome === null) {
        setFieldError('condition-error', 'condition-group', FIELD_COPY.outcome);
        announce('Counter result', 'Check the highlighted fields.');
        return;
      }
      const pending = markPending(button, 'Saving\u2026');
      void request<{ loan: Loan }>(`/api/loans/${current.id}/inspection`, {
        method: 'POST',
        body: { outcome, note: note.value },
      })
        .then((answer) => {
          loan = answer.loan;
          paint();
          announce('Counter result', 'Inspection saved.');
        })
        .catch((error: unknown) => {
          pending.release();
          const failure = error instanceof ApiFailure ? error : null;
          announce('Counter result', failure?.message ?? 'Not found.');
          if (failure?.fields['note'] !== undefined) {
            setFieldError('inspection-note-error', 'inspection-note', failure.fields['note']);
          }
          if (failure?.fields['outcome'] !== undefined) {
            setFieldError('condition-error', 'condition-group', failure.fields['outcome']);
          }
          void reload();
        });
    });

    const group = element(
      'div',
      { id: 'condition-group', role: 'radiogroup', 'aria-label': 'Condition', class: 'radiogroup' },
      [
        element('label', { for: 'condition-ok' }, [ok, 'OK']),
        element('label', { for: 'condition-damaged' }, [damaged, 'Damaged']),
      ],
    );

    return element('div', { class: 'box' }, [
      element('h2', {}, ['Inspection']),
      group,
      element('div', { class: 'field-error', id: 'condition-error' }),
      labelledField('Inspection note', note, 'inspection-note-error'),
      button,
    ]);
  }

  function settleControls(current: Loan): HTMLElement {
    const settle = element('button', { type: 'button', class: 'primary' });
    settle.textContent = 'Settle';
    const dialog = element('dialog', { 'aria-label': 'Settle loan' });
    const damage = element('input', { id: 'damage-charge', type: 'text', value: '0.00' });
    const confirm = element('button', { type: 'button', class: 'primary' });
    confirm.textContent = 'Confirm settlement';
    const cancel = element('button', { type: 'button' });
    cancel.textContent = 'Cancel';

    dialog.appendChild(element('h2', {}, ['Settle loan']));
    dialog.appendChild(
      element('div', { class: 'mono' }, [`Deposit held ${money(current.deposit_cents)}`]),
    );
    dialog.appendChild(
      element('div', { class: 'mono' }, [`Replacement ${money(current.replacement_cents)}`]),
    );
    dialog.appendChild(labelledField('Damage charge', damage, 'damage-charge-error'));
    dialog.appendChild(element('div', { class: 'dialog-actions' }, [confirm, cancel]));

    const focusable = (): HTMLElement[] =>
      Array.from(dialog.querySelectorAll<HTMLElement>('input, button')).filter(
        (candidate) => !candidate.hasAttribute('disabled'),
      );

    const close = (): void => {
      dialog.close();
      settle.focus();
    };

    dialog.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    cancel.addEventListener('click', close);

    settle.addEventListener('click', () => {
      if (prefersReducedMotion()) dialog.classList.add('no-motion');
      dialog.showModal();
      damage.value = '0.00';
      damage.focus();
      damage.select();
    });

    confirm.addEventListener('click', () => {
      setFieldError('damage-charge-error', 'damage-charge', null);
      const cents = parseDollarsToCents(damage.value);
      if (cents === null || cents > current.replacement_cents) {
        setFieldError('damage-charge-error', 'damage-charge', FIELD_COPY.damage_range);
        announce('Settlement result', 'Check the highlighted fields.');
        return;
      }
      const action = `settle:${current.id}:${cents}`;
      const pending = markPending(confirm, 'Settling\u2026');
      void request<{ settlement: Settlement; loan: Loan }>(
        `/api/loans/${current.id}/settlement`,
        { method: 'POST', idempotencyKey: keyFor(action), body: { damage_cents: cents } },
      )
        .then((answer) => {
          dropKey(action);
          pending.release();
          dialog.close();
          loan = answer.loan;
          paint();
          announce('Settlement result', `Settled. Receipt queued for ${answer.loan.member.name}.`);
          const receipt = node.querySelector<HTMLElement>('[aria-label="Receipt"]');
          receipt?.focus();
        })
        .catch((error: unknown) => {
          pending.release();
          const failure = error instanceof ApiFailure ? error : null;
          if (failure?.code === 'billing_unavailable') retainKey(action);
          else dropKey(action);
          announce('Settlement result', failure?.message ?? 'Not found.');
          if (failure?.fields['damage_cents'] !== undefined) {
            setFieldError('damage-charge-error', 'damage-charge', failure.fields['damage_cents']);
          }
        });
    });

    return element('div', { class: 'box' }, [
      element('h2', {}, ['Settlement']),
      settle,
      dialog,
    ]);
  }

  async function reload(): Promise<void> {
    try {
      const answer = await request<{ loan: Loan }>(`/api/loans/${loanId}`);
      loan = answer.loan;
      paint();
    } catch {
      onMissing();
    }
  }

  void reload();
  return { node };
}
