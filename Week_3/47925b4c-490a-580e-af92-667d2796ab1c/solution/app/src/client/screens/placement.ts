import { ApiProblem, call, newKey } from '../api.js';
import { append, button, combobox, el, field, showFieldError, spinbutton, textbox } from '../dom.js';
import { type Opener, openDialog } from '../dialog.js';
import { clearBand, showBand } from '../shell.js';
import { cellPosition } from './wallview.js';

export interface Placement {
  readonly id: string;
  readonly status: 'Bodied' | 'On hold' | 'Needs a body';
  readonly bodySerial: string | null;
  readonly holdId: string | null;
  readonly model: string;
  readonly lensSerial: string;
  readonly aimAcross: string;
  readonly aimDown: string;
  readonly bodyAcross: string;
  readonly bodyDown: string;
  readonly standoff: string;
  readonly ratio: string;
  readonly shiftAcrossPercent: string;
  readonly shiftDownPercent: string;
  readonly circuitId: string;
}

export interface Picker {
  readonly models: readonly { model: string; free: number }[];
  readonly bodies: readonly { serial: string; model: string; location: string; free: boolean }[];
  readonly lenses: readonly { serial: string; model: string; location: string; free: boolean }[];
  readonly holds: readonly { id: string; model: string; serial: string | null; status: string }[];
}

interface PlacementDialog {
  readonly layoutId: string;
  readonly columns: number;
  readonly rows: number;
  readonly circuits: readonly { id: string; name: string }[];
  readonly picker: Picker;
  readonly placement: Placement | null;
  readonly cell: string | null;
  readonly opener: Opener;
  readonly etag: () => string | null;
  readonly saved: () => Promise<void>;
}

const STEP_METRES = 0.5;
const ERROR_FIELDS = ['/lensSerial', '/aimAcross', '/aimDown', '/standoff', '/ratio', '/shiftAcrossPercent', '/shiftDownPercent'];

/** The aim defaults to the cell's centre rounded up to the next half-metre step. */
function aimDefault(index: number): number {
  return Math.ceil(index - 0.5) * STEP_METRES;
}

function bodyOptions(picker: Picker, placement: Placement | null): { value: string; label: string }[] {
  const options = picker.bodies.map((body) => ({ value: `body:${body.serial}`, label: `${body.serial} ${body.model}` }));
  for (const hold of picker.holds) {
    if (hold.serial !== null) options.push({ value: `hold:${hold.id}`, label: `${hold.serial} ${hold.model} on hold` });
  }
  for (const model of picker.models) options.push({ value: `model:${model.model}`, label: `Needs a body ${model.model}` });
  if (placement?.bodySerial != null && !options.some((option) => option.value === `body:${placement.bodySerial}`)) {
    options.unshift({ value: `body:${placement.bodySerial}`, label: `${placement.bodySerial} ${placement.model}` });
  }
  return options;
}

export function placementName(placement: Placement, picker: Picker): string | null {
  if (placement.bodySerial !== null) return placement.bodySerial;
  return picker.holds.find((hold) => hold.id === placement.holdId)?.serial ?? null;
}

export function openPlacementDialog(options: PlacementDialog): void {
  const { placement, picker } = options;
  const position = options.cell === null ? null : cellPosition(options.cell, options.columns, options.rows);
  const aimAcrossDefault = aimDefault(position?.column ?? 1);
  const aimDownDefault = aimDefault(position?.row ?? 1);
  const title = placement === null ? 'Place a body' : `Aim ${placementName(placement, picker) ?? placement.model}`;

  const selected =
    placement === null
      ? undefined
      : placement.bodySerial !== null
        ? `body:${placement.bodySerial}`
        : placement.holdId !== null
          ? `hold:${placement.holdId}`
          : `model:${placement.model}`;
  const body = combobox('Body', bodyOptions(picker, placement), selected);
  const lens = combobox(
    'Lens',
    picker.lenses.map((entry) => ({ value: entry.serial, label: `${entry.serial} ${entry.model}` })),
    placement?.lensSerial,
  );
  const aimAcross = spinbutton('Aim across', Number(placement?.aimAcross ?? aimAcrossDefault), STEP_METRES);
  const aimDown = spinbutton('Aim down', Number(placement?.aimDown ?? aimDownDefault), STEP_METRES);
  const bodyAcross = spinbutton('Body across', Number(placement?.bodyAcross ?? aimAcrossDefault), STEP_METRES);
  const bodyDown = spinbutton('Body down', Number(placement?.bodyDown ?? aimDownDefault), STEP_METRES);
  const standoff = textbox('Standoff', placement?.standoff ?? '18');
  const standoffUnit = combobox('Standoff unit', [
    { value: 'm', label: 'm' },
    { value: 'ft', label: 'ft' },
  ]);
  const ratio = textbox('Zoom ratio', placement?.ratio ?? '1,3');
  const shiftAcross = textbox('Shift across', placement?.shiftAcrossPercent ?? '0');
  const shiftDown = textbox('Shift down', placement?.shiftDownPercent ?? '0');
  const circuit = combobox(
    'Circuit',
    options.circuits.map((entry) => ({ value: entry.id, label: entry.name })),
    placement?.circuitId,
  );

  const dialog = el('dialog', { 'aria-label': title, class: 'placement' });

  const request = (): Record<string, unknown> => {
    const chosen = body.value;
    const input: Record<string, unknown> = {
      lensSerial: lens.value,
      aimAcross: { text: aimAcross.value, unit: 'm' },
      aimDown: { text: aimDown.value, unit: 'm' },
      bodyAcross: { text: bodyAcross.value, unit: 'm' },
      bodyDown: { text: bodyDown.value, unit: 'm' },
      standoff: { text: standoff.value, unit: standoffUnit.value },
      ratio: ratio.value,
      shiftAcrossPercent: shiftAcross.value,
      shiftDownPercent: shiftDown.value,
      circuitId: circuit.value,
    };
    if (chosen.startsWith('body:')) input['bodySerial'] = chosen.slice('body:'.length);
    else if (chosen.startsWith('hold:')) input['holdId'] = chosen.slice('hold:'.length);
    else input['model'] = chosen.slice('model:'.length);
    return input;
  };

  const save = async (): Promise<void> => {
    for (const pointer of ERROR_FIELDS) showFieldError(`placement${pointer}`, null);
    clearBand();
    try {
      if (placement === null) {
        await call(`/api/layouts/${options.layoutId}/placements`, {
          method: 'POST',
          key: newKey(),
          ifMatch: options.etag() ?? undefined,
          body: request(),
        });
      } else {
        await call(`/api/layouts/${options.layoutId}/placements/${placement.id}`, {
          method: 'PATCH',
          ifMatch: options.etag() ?? undefined,
          body: request(),
        });
      }
    } catch (error) {
      if (!(error instanceof ApiProblem)) throw error;
      if (error.body.errors === undefined) {
        // A refused state is told in the page's band, so the dialog gets out of the way of it.
        handle.close();
        showBand(error.body.detail);
        await options.saved();
        return;
      }
      for (const [pointer, copy] of Object.entries(error.body.errors)) {
        showFieldError(`placement${pointer.replace(/\/text$/, '')}`, copy);
      }
      return;
    }
    handle.close();
    await options.saved();
  };

  append(dialog, [
    el('h2', { text: title }),
    el('form', { onsubmit: (event: Event) => event.preventDefault() }, [
      el('label', {}, ['Body', body]),
      field('Lens', lens, 'placement/lensSerial'),
      field('Aim across', aimAcross, 'placement/aimAcross'),
      field('Aim down', aimDown, 'placement/aimDown'),
      el('label', {}, ['Body across', bodyAcross]),
      el('label', {}, ['Body down', bodyDown]),
      field('Standoff', standoff, 'placement/standoff'),
      el('label', {}, ['Standoff unit', standoffUnit]),
      field('Zoom ratio', ratio, 'placement/ratio'),
      field('Shift across', shiftAcross, 'placement/shiftAcrossPercent'),
      field('Shift down', shiftDown, 'placement/shiftDownPercent'),
      el('label', {}, ['Circuit', circuit]),
      el('div', { class: 'row-actions' }, [
        button('Save placement', () => void save()),
        button('Cancel', () => handle.close()),
      ]),
    ]),
  ]);
  document.body.appendChild(dialog);
  const handle = openDialog(dialog, options.opener, () => {
    dialog.close();
    dialog.remove();
  });
}
