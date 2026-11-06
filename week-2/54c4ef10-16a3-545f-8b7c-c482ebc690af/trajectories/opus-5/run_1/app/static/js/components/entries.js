// Shooting-log items, with the inline edit and its own Exposure preview.
import * as api from '../api.js';
import { APERTURES, COPY, LIMITS, fieldCopy, fill } from '../boot.js';
import { el, field, option, setFieldError } from '../dom.js';
import { figures } from '../exposure.js';
import * as format from '../format.js';
import { saveDraft } from '../drafts.js';
import { activity, app, navigate } from '../main.js';

export function matchLabel(entry) {
  if (entry.match === 'unmatched') return 'Marked unmatched';
  if (entry.frame_number) return `Frame ${entry.frame_number}`;
  return 'No frame';
}

export function showsManual(entry, alignment) {
  if (entry.match === 'override') return true;
  return Boolean(
    alignment && alignment.source === 'manual' && entry.frame_id,
  );
}

function exposureInputs(entry) {
  const counterField = field('Counter', el('input', {
    type: 'number', min: 0, max: 99, step: 1, value: entry.counter,
  }));
  const apertureField = field(
    'Aperture',
    el('select', {}, APERTURES.map((value) => option(value, `f/${value}`, value === entry.aperture))),
  );
  const shutterField = field('Shutter', el('input', { type: 'text', value: entry.shutter }));
  const evField = field('Metered EV', el('input', {
    type: 'number', step: 'any', value: entry.metered_ev,
  }));
  const noteField = field('Note', el('textarea', { rows: 2, value: entry.note }));
  const misfireBox = el('input', { type: 'checkbox', checked: entry.misfire });
  misfireBox.setAttribute('aria-label', 'Misfire');
  const misfireField = el('label', { class: 'checkbox' }, [
    misfireBox, el('span', { text: 'Misfire' }),
  ]);
  return {
    counterField, apertureField, shutterField, evField, noteField, misfireBox, misfireField,
  };
}

export function inlineEdit(entry, roll, { onDone, draft = null }) {
  const inputs = exposureInputs(draft ? { ...entry, ...draft.fields } : entry);
  const preview = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': `Exposure preview for note ${entry.counter}`,
    class: 'preview figures',
  });
  const save = el('button', {
    type: 'button', class: 'solid', text: 'Save',
  });
  save.setAttribute('aria-label', `Save note ${entry.counter}`);
  const cancel = el('button', { type: 'button', class: 'ghost', text: 'Cancel' });
  cancel.setAttribute('aria-label', 'Cancel edit');

  function repaint() {
    preview.textContent = format.previewText(figures({
      roll,
      aperture: inputs.apertureField.control.value,
      shutter: inputs.shutterField.control.value,
      meteredEv: inputs.evField.control.value,
    }));
  }
  for (const entryField of [inputs.apertureField, inputs.shutterField, inputs.evField]) {
    entryField.control.addEventListener('input', repaint);
    entryField.control.addEventListener('change', repaint);
  }
  repaint();

  const wrapper = el('form', { class: 'inline-edit', novalidate: true }, [
    inputs.counterField.wrapper,
    inputs.apertureField.wrapper,
    inputs.shutterField.wrapper,
    inputs.evField.wrapper,
    preview,
    inputs.noteField.wrapper,
    inputs.misfireField,
    el('div', { class: 'row' }, [save, cancel]),
  ]);

  function currentFields() {
    return {
      counter: Number(inputs.counterField.control.value),
      aperture: inputs.apertureField.control.value,
      shutter: inputs.shutterField.control.value,
      metered_ev: Number(inputs.evField.control.value),
      note: inputs.noteField.control.value,
      misfire: inputs.misfireBox.checked,
    };
  }

  async function submit() {
    const body = currentFields();
    for (const item of [inputs.counterField, inputs.shutterField, inputs.evField, inputs.noteField]) {
      setFieldError(item, '');
    }
    if ([...body.note.trim()].length > LIMITS.note) {
      setFieldError(inputs.noteField, fieldCopy('note'));
      activity(fieldCopy('note'));
      inputs.noteField.control.focus();
      return;
    }
    activity(COPY.pending.note);
    try {
      const saved = await api.call('PATCH', `/api/entries/${entry.id}`, body, { keepSession: true });
      activity(fill(COPY.success.note_saved, { counter: saved.counter }));
      await onDone();
    } catch (failure) {
      if (failure.status === 401) {
        saveDraft({
          kind: 'note',
          accountId: app.account ? app.account.id : null,
          entryId: entry.id,
          counter: entry.counter,
          path: window.location.pathname + window.location.search,
          fields: body,
        });
        activity(COPY.draft.note_expired);
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        app.account = null;
        await navigate(`/signin?next=${next}`);
        return;
      }
      if (failure.status === 422) {
        const order = [
          ['counter', inputs.counterField],
          ['aperture', inputs.apertureField],
          ['shutter', inputs.shutterField],
          ['metered_ev', inputs.evField],
          ['note', inputs.noteField],
        ];
        let announced = false;
        for (const [key, item] of order) {
          if (failure.fields[key]) {
            setFieldError(item, failure.fields[key]);
            if (!announced) {
              activity(failure.fields[key]);
              item.control.focus();
              announced = true;
            }
          }
        }
        return;
      }
      activity(
        failure.code === 'counter_taken'
          ? fill(COPY.error.counter_taken, { counter: body.counter })
          : COPY.error[failure.code] || '',
      );
    }
  }

  save.addEventListener('click', submit);
  wrapper.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  cancel.addEventListener('click', () => onDone());
  return { wrapper, save, inputs };
}

export function entryItem(entry, { roll, alignment, reload, restore = null }) {
  const item = el('li', { class: 'entry', dataset: { counter: String(entry.counter) } });
  const body = el('div', { class: 'entry-body figures' }, [
    el('span', { class: 'entry-counter', text: `Note ${entry.counter}` }),
    el('span', { text: `f/${entry.aperture}` }),
    el('span', { text: entry.shutter }),
    el('span', { text: `EV ${entry.metered_ev}` }),
    el('span', { text: `${format.stops(entry.relative_stops)} stops` }),
    el('span', { class: 'note-text', text: entry.note }),
    el('span', { class: 'match', text: matchLabel(entry) }),
    entry.misfire ? el('span', { class: 'badge', text: 'Misfire' }) : null,
    showsManual(entry, alignment) ? el('span', { class: 'badge', text: 'Manual' }) : null,
  ]);
  const editButton = el('button', { type: 'button', class: 'ghost', text: 'Edit' });
  editButton.setAttribute('aria-label', `Edit note ${entry.counter}`);
  const deleteButton = el('button', { type: 'button', class: 'ghost', text: 'Delete' });
  deleteButton.setAttribute('aria-label', `Delete note ${entry.counter}`);
  const actions = el('div', { class: 'entry-actions' }, [editButton, deleteButton]);
  item.append(body, actions);

  function openEdit(draft = null) {
    const edit = inlineEdit(entry, roll, {
      draft,
      onDone: async () => {
        await reload();
      },
    });
    body.hidden = true;
    actions.hidden = true;
    item.append(edit.wrapper);
    if (draft) {
      activity(fill(COPY.draft.note_restored, { counter: entry.counter }));
      edit.save.focus();
    } else {
      edit.inputs.counterField.control.focus();
    }
  }

  editButton.addEventListener('click', () => openEdit());
  deleteButton.addEventListener('click', async () => {
    activity(COPY.pending.note);
    try {
      await api.remove(`/api/entries/${entry.id}`);
      activity(fill(COPY.success.note_deleted, { counter: entry.counter }));
      await reload();
    } catch (failure) {
      activity(COPY.error[failure.code] || '');
    }
  });

  if (restore && restore.entryId === entry.id) openEdit(restore);
  return item;
}

export function entryList(label, entries, options) {
  return el(
    'ul',
    { class: 'entries', role: 'list', 'aria-label': label },
    entries.map((entry) => entryItem(entry, options)),
  );
}
