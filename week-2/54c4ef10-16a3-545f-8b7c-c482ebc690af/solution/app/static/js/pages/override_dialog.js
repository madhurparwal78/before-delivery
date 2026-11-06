// The Override alignment dialog: offset, slip, one frame per note; Tab wraps inside it, Escape closes it.
import { h, uid } from '../dom.js';
import { RANGES } from '../domain.js';
import { signedWhole } from '../format.js';

const [LOW, HIGH] = RANGES.offset;
const OFFSETS = Array.from({ length: HIGH - LOW + 1 }, (_, i) => LOW + i);
const FOLLOW = '';
const UNMATCHED = 'unmatched';

function labelled(label, control) {
  const id = uid('ov');
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control);
}

export function openOverrideDialog(opener, state, save) {
  const { alignment, sheet, entries } = state;
  const saved = alignment.offset !== null;
  const startOffset = saved ? alignment.offset : (alignment.proposal?.proposed_offset ?? 0);
  const startSlip = saved ? alignment.slip_after : (alignment.proposal?.proposed_slip_after ?? null);
  const offset = h('select', {}, OFFSETS.map((value) => h('option', { value, selected: value === startOffset }, signedWhole(value))));
  const slip = h('select', {}, h('option', { value: '' }, 'No slip'),
    entries.map((entry) => h('option', { value: entry.counter, selected: entry.counter === startSlip }, `Note ${entry.counter}`)));
  const overrides = new Map(alignment.overrides.map((item) => [item.entry_id, item.frame_id]));
  const frameSelects = entries.map((entry) => {
    const start = overrides.has(entry.id) ? (overrides.get(entry.id) ?? UNMATCHED) : FOLLOW;
    return [entry, h('select', {}, h('option', { value: FOLLOW }, 'Follow offset'),
      sheet.frames.map((frame) => h('option', { value: frame.id, selected: start === frame.id }, `Frame ${frame.number}`)),
      h('option', { value: UNMATCHED, selected: start === UNMATCHED }, 'Unmatched'))];
  });
  const saveButton = h('button', { type: 'button', class: 'primary' }, 'Save alignment');
  const cancel = h('button', { type: 'button' }, 'Cancel');
  const heading = h('h2', { id: uid('ov-title') }, 'Override alignment');
  const dialog = h('dialog', { 'aria-labelledby': heading.id }, heading, h('div', { class: 'grid-fields' },
    labelled('Offset', offset), labelled('Slip after note', slip),
    frameSelects.map(([entry, select]) => labelled(`Frame for note ${entry.counter}`, select)),
    h('div', { class: 'actions', style: 'display:flex;gap:16px' }, saveButton, cancel)));
  const tabbable = [offset, slip, ...frameSelects.map(([, select]) => select), saveButton, cancel];

  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const edge = event.shiftKey ? tabbable[0] : tabbable.at(-1);
    if (document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? tabbable.at(-1) : tabbable[0]).focus();
    }
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    opener.focus();
  });
  cancel.addEventListener('click', () => dialog.close());
  saveButton.addEventListener('click', async () => {
    const chosen = frameSelects.filter(([, select]) => select.value !== FOLLOW)
      .map(([entry, select]) => ({ entry_id: entry.id, frame_id: select.value === UNMATCHED ? null : select.value }));
    const response = await save({ offset: Number(offset.value), slip_after: slip.value === '' ? null : Number(slip.value), overrides: chosen });
    if (response.ok) dialog.close();
    else saveButton.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  offset.focus();
}
