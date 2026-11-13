import { apiSend, apiUpload } from '../api.js';
import { COPY, COUNTER_STATUS, unknownSerialError } from '../copy.js';
import { openDialog } from '../dialog.js';
import { clear, el, svgIcon } from '../dom.js';
import type { Booking, PhotoPhase, PhotoStatus } from '../../shared/types.js';

export const PHOTO_LABELS: Record<PhotoStatus, string> = {
  pending: 'Pending',
  stored: 'Stored',
  failed: 'Failed',
};

export interface UnitDraft {
  serial: string;
  powersOn: boolean;
  accessoriesPresent: boolean;
  cosmeticOk: boolean;
  notes: string;
  photoStored: boolean;
  done: boolean;
}

/** What the checkout and check-in panels need from the counter around them. */
export interface PanelContext {
  booking: Booking;
  detail: HTMLElement;
  drafts: Map<string, UnitDraft>;
  announce: (message: string) => void;
  reportFailure: (error: unknown, target?: HTMLElement) => void;
  reload: () => Promise<void>;
  finishCheckout: () => void;
}

/** One condition photo: pending while it uploads, then storage's own answer. */
function photoField(
  context: PanelContext,
  serial: string,
  phase: PhotoPhase,
  onStored: () => void,
): HTMLElement {
  const statusText = el('span', { class: 'photo-status' }, ['—']);
  const uploading = el('span', { class: 'photo-uploading' });
  const input = el('input', { type: 'file', accept: 'image/jpeg,image/png' });

  const showStatus = (label: string): void => {
    statusText.textContent = label;
    const cell = context.detail.querySelector(`[data-photo="${phase}:${serial}"]`);
    if (cell !== null) cell.textContent = label;
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    showStatus(PHOTO_LABELS.pending);
    uploading.textContent = COPY.photoUploading;
    void (async () => {
      const form = new FormData();
      form.append('phase', phase);
      form.append('serial', serial);
      form.append('file', file);
      try {
        await apiUpload<{ status: PhotoStatus }>(
          `/api/bookings/${context.booking.ref}/photos`,
          form,
        );
        showStatus(PHOTO_LABELS.stored);
        uploading.textContent = '';
        onStored();
      } catch (failure) {
        showStatus(PHOTO_LABELS.failed);
        uploading.textContent = '';
        context.reportFailure(failure);
      }
    })();
  });

  return el('div', { class: 'photo-field' }, [
    el('label', { class: 'field' }, [
      el('span', { class: 'field-label' }, ['Condition photo']),
      input,
    ]),
    statusText,
    uploading,
  ]);
}

function scanField(
  context: PanelContext,
  onSerial: (serial: string) => void,
): { field: HTMLInputElement; error: HTMLElement; label: HTMLElement } {
  const error = el('p', { class: 'field-error' });
  const field = el('input', { type: 'text', class: 'text-field', autocomplete: 'off' });
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const serial = field.value.trim();
    if (!context.booking.units.some((unit) => unit.serial === serial)) {
      error.textContent = unknownSerialError(serial);
      context.announce(unknownSerialError(serial));
      field.focus();
      return;
    }
    error.textContent = '';
    field.value = '';
    onSerial(serial);
  });
  const label = el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, ['Scan serial']),
    field,
  ]);
  return { field, error, label };
}

export function checkoutPanel(context: PanelContext): HTMLElement {
  const region = el('section', { 'aria-label': 'Checkout', class: 'counter-panel' });
  const groups = el('div', { class: 'unit-groups' });
  const review = el('button', { type: 'button', class: 'button button-primary' }, [
    'Review checkout',
  ]);

  const draftFor = (serial: string): UnitDraft => {
    const existing = context.drafts.get(serial);
    if (existing !== undefined) return existing;
    const draft: UnitDraft = {
      serial,
      powersOn: false,
      accessoriesPresent: false,
      cosmeticOk: false,
      notes: '',
      photoStored: false,
      done: false,
    };
    context.drafts.set(serial, draft);
    return draft;
  };

  const scan = scanField(context, (serial) => {
    renderGroups(serial);
    groups.querySelector<HTMLElement>('.unit-group input')?.focus();
  });

  const openUnitGroup = (draft: UnitDraft): HTMLElement => {
    const group = el('div', { role: 'group', 'aria-label': draft.serial, class: 'unit-group' });
    const error = el('p', { class: 'field-error' });
    const checks: [keyof UnitDraft, string][] = [
      ['powersOn', 'Powers on'],
      ['accessoriesPresent', 'Accessories present'],
      ['cosmeticOk', 'Cosmetic condition as listed'],
    ];
    for (const [field, label] of checks) {
      const box = el('input', { type: 'checkbox' });
      box.addEventListener('change', () => {
        Object.assign(draft, { [field]: box.checked });
      });
      group.append(el('label', { class: 'check-field' }, [box, el('span', {}, [label])]));
    }
    const notes = el('textarea', { class: 'text-field', rows: '2' });
    notes.addEventListener('input', () => {
      draft.notes = notes.value;
    });
    const done = el('button', { type: 'button', class: 'button' }, ['Done with unit']);
    done.addEventListener('click', () => {
      if (!draft.powersOn || !draft.accessoriesPresent || !draft.cosmeticOk || !draft.photoStored) {
        error.textContent = COPY.unitNotReady;
        context.announce(COPY.unitNotReady);
        return;
      }
      draft.done = true;
      renderGroups(null);
      scan.field.focus();
    });
    group.append(
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label' }, ['Condition notes']),
        notes,
      ]),
      photoField(context, draft.serial, 'checkout', () => {
        draft.photoStored = true;
      }),
      error,
      done,
    );
    return group;
  };

  function renderGroups(openSerial: string | null): void {
    clear(groups);
    for (const unit of context.booking.units) {
      const draft = context.drafts.get(unit.serial);
      if (draft?.done === true) {
        groups.append(
          el('p', { class: 'unit-done' }, [
            svgIcon('check', 20),
            el('span', {}, [`${unit.serial} · done`]),
          ]),
        );
        continue;
      }
      if (unit.serial !== openSerial) continue;
      groups.append(openUnitGroup(draftFor(unit.serial)));
    }
    review.disabled = !context.booking.units.every(
      (unit) => context.drafts.get(unit.serial)?.done === true,
    );
  }

  review.addEventListener('click', () => {
    openDialog('Confirm checkout', (close) => {
      const confirm = el('button', { type: 'button', class: 'button button-primary' }, [
        'Check out kit',
      ]);
      const back = el('button', { type: 'button', class: 'button' }, ['Back']);
      const error = el('p', { class: 'field-error' });
      back.addEventListener('click', close);
      confirm.addEventListener('click', () => {
        void (async () => {
          try {
            await apiSend<Booking>('POST', `/api/bookings/${context.booking.ref}/checkout`, {
              units: context.booking.units.map((unit) => ({
                serial: unit.serial,
                checklist: { powersOn: true, accessoriesPresent: true, cosmeticOk: true },
                notes: context.drafts.get(unit.serial)?.notes ?? '',
              })),
            });
            const ref = context.booking.ref;
            close();
            context.finishCheckout();
            await context.reload();
            context.announce(COUNTER_STATUS.checkedOut(ref));
            context.detail.querySelector<HTMLElement>('.detail-heading')?.focus();
          } catch (failure) {
            context.reportFailure(failure, error);
          }
        })();
      });
      return [
        el('h2', { class: 'dialog-heading' }, ['Confirm checkout']),
        el('p', {}, [`Check out ${context.booking.units.length} units on ${context.booking.ref}?`]),
        error,
        el('div', { class: 'dialog-actions' }, [confirm, back]),
      ];
    });
  });

  region.append(
    el('h3', { class: 'panel-heading' }, ['Checkout']),
    scan.error,
    scan.label,
    groups,
    review,
  );
  renderGroups(null);
  requestAnimationFrame(() => scan.field.focus());
  return region;
}

export function checkinPanel(context: PanelContext): HTMLElement {
  const region = el('section', { 'aria-label': 'Check-in', class: 'counter-panel' });
  const groups = el('div', { class: 'unit-groups' });

  const openUnitGroup = (serial: string): HTMLElement => {
    const group = el('div', { role: 'group', 'aria-label': serial, class: 'unit-group' });
    const error = el('p', { class: 'field-error' });
    let photoStored = false;
    const groupName = `condition-${serial}`;
    const okRadio = el('input', { type: 'radio', name: groupName, checked: true });
    const damagedRadio = el('input', { type: 'radio', name: groupName });
    const charge = el('input', {
      type: 'text',
      class: 'text-field',
      inputmode: 'decimal',
      disabled: true,
      value: '0',
    });
    const syncCharge = (): void => {
      charge.disabled = !damagedRadio.checked;
    };
    okRadio.addEventListener('change', syncCharge);
    damagedRadio.addEventListener('change', syncCharge);

    const notes = el('textarea', { class: 'text-field', rows: '2' });
    const submit = el('button', { type: 'button', class: 'button' }, ['Check in unit']);
    submit.addEventListener('click', () => {
      if (!photoStored) {
        error.textContent = COPY.unitNotReady;
        context.announce(COPY.unitNotReady);
        return;
      }
      void (async () => {
        const dollars = Number(charge.value);
        try {
          await apiSend<Booking>('POST', `/api/bookings/${context.booking.ref}/checkin`, {
            serial,
            condition: damagedRadio.checked ? 'damaged' : 'ok',
            damageChargeCents: damagedRadio.checked
              ? Math.round((Number.isFinite(dollars) ? dollars : 0) * 100)
              : 0,
            notes: notes.value,
          });
          await context.reload();
          context.announce(COUNTER_STATUS.unitCheckedIn(serial));
        } catch (failure) {
          context.reportFailure(failure, error);
        }
      })();
    });

    group.append(
      el('label', { class: 'check-field' }, [okRadio, el('span', {}, ['OK'])]),
      el('label', { class: 'check-field' }, [damagedRadio, el('span', {}, ['Damaged'])]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label' }, ['Damage charge']),
        charge,
      ]),
      el('label', { class: 'field' }, [
        el('span', { class: 'field-label' }, ['Condition notes']),
        notes,
      ]),
      photoField(context, serial, 'checkin', () => {
        photoStored = true;
      }),
      error,
      submit,
    );
    return group;
  };

  const scan = scanField(context, (serial) => {
    clear(groups);
    groups.append(openUnitGroup(serial));
    groups.querySelector<HTMLElement>('.unit-group input')?.focus();
  });

  region.append(
    el('h3', { class: 'panel-heading' }, ['Check-in']),
    scan.error,
    scan.label,
    groups,
  );
  requestAnimationFrame(() => scan.field.focus());
  return region;
}
