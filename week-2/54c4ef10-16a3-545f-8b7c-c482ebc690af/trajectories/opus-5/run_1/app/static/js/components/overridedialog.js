// The Override alignment dialog: keyboard-only usable, with its own focus trap.
import * as api from '../api.js';
import { COPY, fill } from '../boot.js';
import { el, field, option } from '../dom.js';
import { activity } from '../main.js';

export function openOverrideDialog({ roll, entries, frames, alignment, opener, onSaved }) {
  const proposal = alignment.proposal || {};
  const savedOffset = alignment.offset !== null && alignment.offset !== undefined
    ? alignment.offset
    : (proposal.proposed_offset !== null && proposal.proposed_offset !== undefined
      ? proposal.proposed_offset
      : 0);
  const savedSlip = alignment.offset !== null && alignment.offset !== undefined
    ? alignment.slip_after
    : (proposal.proposed_slip_after !== undefined ? proposal.proposed_slip_after : null);

  const offsetControl = el('select', {}, [-2, -1, 0, 1, 2].map(
    (value) => option(String(value), value > 0 ? `+${value}` : String(value).replace('-', '\u2212'), value === savedOffset),
  ));
  const offsetField = field('Offset', offsetControl);
  const slipControl = el('select', {}, [
    option('', 'No slip', savedSlip === null || savedSlip === undefined),
    ...entries.map((entry) => option(
      String(entry.counter),
      `Note ${entry.counter}`,
      savedSlip === entry.counter,
    )),
  ]);
  const slipField = field('Slip after note', slipControl);

  const overrides = new Map(
    (alignment.overrides || []).map((item) => [item.entry_id, item.frame_id]),
  );
  const perNote = entries.map((entry) => {
    const saved = overrides.has(entry.id) ? overrides.get(entry.id) : undefined;
    const control = el('select', {}, [
      option('', 'Follow offset', saved === undefined),
      ...frames.map((frame) => option(
        frame.id,
        `Frame ${frame.number}`,
        saved === frame.id,
      )),
      option('unmatched', 'Unmatched', saved === null),
    ]);
    return { entry, ...field(`Frame for note ${entry.counter}`, control) };
  });

  const save = el('button', { type: 'button', class: 'solid', text: 'Save alignment' });
  const cancel = el('button', { type: 'button', class: 'ghost', text: 'Cancel' });
  const dialog = el('div', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Override alignment',
    class: 'dialog surface',
  }, [
    el('h2', { text: 'Override alignment' }),
    offsetField.wrapper,
    slipField.wrapper,
    ...perNote.map((item) => item.wrapper),
    el('div', { class: 'row' }, [save, cancel]),
  ]);
  const backdrop = el('div', { class: 'backdrop' }, [dialog]);

  function close() {
    backdrop.remove();
    if (opener) opener.focus();
  }

  const order = [offsetControl, slipControl, ...perNote.map((item) => item.control), save, cancel];

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const index = order.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const step = event.shiftKey ? -1 : 1;
    const next = (index + step + order.length) % order.length;
    order[next].focus();
  });

  cancel.addEventListener('click', close);
  save.addEventListener('click', async () => {
    const body = {
      version: alignment.version,
      offset: Number(offsetControl.value),
      slip_after: slipControl.value === '' ? null : Number(slipControl.value),
      overrides: perNote
        .filter((item) => item.control.value !== '')
        .map((item) => ({
          entry_id: item.entry.id,
          frame_id: item.control.value === 'unmatched' ? null : item.control.value,
        })),
    };
    activity(COPY.pending.alignment);
    try {
      const saved = await api.put(`/api/rolls/${roll.id}/alignment`, body);
      activity(fill(COPY.success.alignment, {
        aligned: saved.counters.aligned,
        unmatched: saved.counters.unmatched_notes,
      }));
      close();
      await onSaved();
    } catch (failure) {
      if (failure.status === 412) {
        activity(COPY.error.stale_alignment);
        save.focus();
        return;
      }
      activity(COPY.error[failure.code] || Object.values(failure.fields)[0] || '');
    }
  });

  document.getElementById('app').append(backdrop);
  offsetControl.focus();
  return { close };
}
