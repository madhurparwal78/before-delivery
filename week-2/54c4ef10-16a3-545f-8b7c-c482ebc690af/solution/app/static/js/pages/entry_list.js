// A list of shooting-log entries with inline edit and delete; used for the Shooting log and Recent exposures.
import { del, patch } from '../api.js';
import { announce, field, h, showFieldErrors, uid } from '../dom.js';
import { APERTURES, DEFAULT_APERTURE, LIMITS } from '../domain.js';
import { entryBody, entryProblems } from '../entry_rules.js';
import { previewText } from '../exposure.js';
import { characters, signed } from '../format.js';
import { hooks } from '../hooks.js';
import { saveDraft } from '../session.js';

export function apertureOptions(selected = DEFAULT_APERTURE) {
  return APERTURES.map((value) => h('option', { value, selected: value === selected }, `f/${value}`));
}

/** Overrides and manual alignments show the Manual badge on a matched note. */
export function isManual(entry, manualAlignment) {
  return Boolean(entry.frame_id) && (entry.match === 'override' || Boolean(manualAlignment));
}

function matchLabel(entry, frameNumbers) {
  if (entry.match === 'unmatched') return 'Marked unmatched';
  return entry.frame_id ? `Frame ${frameNumbers.get(entry.frame_id)}` : 'No frame';
}

/**
 * Build the list. `context.rolls` maps roll id to roll (for the preview), `context.frameNumbers` maps frame id to number,
 * `context.manual` says whether the roll's alignment is manual, `onChange(kind, entry)` tells the page to refresh.
 */
export function entryList(label, entries, context) {
  const list = h('ul', { role: 'list', 'aria-label': label, class: 'rows' });

  function view(entry) {
    const roll = context.rolls.get(entry.roll_id);
    const manual = isManual(entry, context.manual?.get(entry.roll_id));
    const edit = h('button', { type: 'button', 'aria-label': `Edit note ${entry.counter}`, onclick: () => startEdit(item, entry) }, 'Edit');
    const remove = h('button', { type: 'button', 'aria-label': `Delete note ${entry.counter}`, onclick: () => remove_(entry) }, 'Delete');
    const item = h('li', { class: 'log-item', 'data-entry': entry.id },
      h('div', { class: 'facts' },
        h('strong', {}, `Note ${entry.counter}`), h('span', {}, `f/${entry.aperture}`), h('span', {}, entry.shutter),
        h('span', {}, `EV ${entry.metered_ev}`), h('span', {}, `${signed(entry.relative_stops)} stops`),
        context.showRoll ? h('span', { class: 'muted' }, roll?.name) : null,
        h('span', { class: 'muted' }, matchLabel(entry, context.frameNumbers ?? new Map())),
        entry.misfire ? h('span', { class: 'badge' }, 'Misfire') : null, manual ? h('span', { class: 'badge' }, 'Manual') : null),
      entry.note ? h('p', {}, entry.note) : null,
      h('div', { class: 'actions' }, edit, remove));
    return item;
  }

  async function remove_(entry) {
    announce('Saving note…');
    const response = await del(`/api/entries/${entry.id}`);
    if (!response.ok) return;
    announce(`Note ${entry.counter} deleted.`);
    context.onChange('deleted', entry);
  }

  function startEdit(item, entry, kept) {
    const roll = context.rolls.get(entry.roll_id);
    const values = kept ?? { counter: String(entry.counter), aperture: entry.aperture, shutter: entry.shutter,
      metered_ev: String(entry.metered_ev), note: entry.note, misfire: entry.misfire };
    const id = uid('edit');
    const counter = h('input', { type: 'number', step: 1, value: values.counter });
    const aperture = h('select', {}, apertureOptions(values.aperture));
    const shutter = h('input', { type: 'text', value: values.shutter, autocomplete: 'off' });
    const ev = h('input', { type: 'number', step: 'any', value: values.metered_ev });
    const note = h('textarea', {});
    note.value = values.note;
    const misfire = h('input', { type: 'checkbox', checked: values.misfire });
    const preview = h('p', { class: 'preview-line', role: 'status', 'aria-label': `Exposure preview for note ${entry.counter}` });
    const count = h('p', { class: 'count' });
    const fields = {
      counter: field('Counter', counter), aperture: field('Aperture', aperture), shutter: field('Shutter', shutter),
      metered_ev: field('Metered EV', ev), note: field('Note', note),
    };
    const read = () => ({ counter: counter.value, aperture: aperture.value, shutter: shutter.value, metered_ev: ev.value,
      note: note.value, misfire: misfire.checked });
    const refresh = () => {
      preview.textContent = previewText(roll, aperture.value, shutter.value, ev.value);
      count.textContent = `${characters(note.value)} / ${LIMITS.note}`;
    };
    for (const input of [counter, aperture, shutter, ev, note, misfire]) {
      input.addEventListener('input', refresh);
      input.addEventListener('change', refresh);
    }
    refresh();
    const save = h('button', { type: 'submit', class: 'primary', 'aria-label': `Save note ${entry.counter}` }, 'Save');
    const cancel = h('button', { type: 'button', 'aria-label': 'Cancel edit', onclick: () => item.replaceWith(view(entry)) }, 'Cancel');
    const form = h('form', { class: 'inline-edit', novalidate: true, id },
      fields.counter.root, fields.aperture.root, fields.shutter.root, fields.metered_ev.root, preview, fields.note.root, count,
      h('label', { class: 'check' }, misfire, 'Misfire'), h('div', { class: 'actions' }, save, cancel));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const problems = entryProblems(read());
      if (showFieldErrors(fields, problems)) return;
      announce('Saving note…');
      const body = entryBody(read());
      const response = await patch(`/api/entries/${entry.id}`, body, { keep401: true });
      if (response.status === 401) {
        saveDraft({ kind: 'note', url: location.pathname + location.search, entryId: entry.id, values: read(),
          page: context.pageValues?.() });
        announce('Your session ended. Sign in to keep this note.');
        hooks.navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      if (response.status === 422) {
        showFieldErrors(fields, response.data.fields);
        return;
      }
      if (response.status === 409) {
        announce(`Counter ${body.counter} is already logged on this roll.`);
        return;
      }
      if (!response.ok) return;
      announce(`Note ${response.data.counter} saved.`);
      context.onChange('saved', response.data);
    });
    item.replaceChildren(h('div', { class: 'facts' }, h('strong', {}, `Note ${entry.counter}`)), form);
    return save;
  }

  function paint(next) {
    list.replaceChildren(...next.map(view));
  }
  paint(entries);

  return {
    root: list,
    paint,
    /** Reopen the inline edit with kept values; focuses its Save button. */
    restore(draft) {
      const item = list.querySelector(`[data-entry="${draft.entryId}"]`);
      const known = context.entryById(draft.entryId);
      if (!item || !known) return false;
      const save = startEdit(item, known, draft.values);
      announce(`Your unsent note is back. Press Save note ${known.counter} to send it.`);
      save.focus();
      return true;
    },
  };
}

