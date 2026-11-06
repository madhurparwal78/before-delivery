// The Log screen: one exposure at a time, with the live Exposure preview.
import * as api from '../api.js';
import { APERTURES, COPY, LIMITS, fieldCopy, fill } from '../boot.js';
import { el, field, option, setFieldError } from '../dom.js';
import { discardDraft, readDraft, saveDraft } from '../drafts.js';
import { figures } from '../exposure.js';
import * as format from '../format.js';
import { activity, app, navigate } from '../main.js';
import { entryList } from '../components/entries.js';

const RECENT_LIMIT = 20;

async function recentExposures(rolls) {
  const lists = await Promise.all(
    rolls.map((roll) => api.get(`/api/rolls/${roll.id}/entries`)),
  );
  const all = [];
  lists.forEach((body, index) => {
    for (const entry of body.entries) all.push({ entry, roll: rolls[index] });
  });
  all.sort((a, b) => {
    if (a.entry.created_at === b.entry.created_at) {
      return b.entry.counter - a.entry.counter;
    }
    return a.entry.created_at < b.entry.created_at ? 1 : -1;
  });
  return all.slice(0, RECENT_LIMIT);
}

function nextCounter(entries) {
  if (entries.length === 0) return 1;
  const highest = Math.max(...entries.map((entry) => entry.counter));
  return highest >= 99 ? null : highest + 1;
}

export async function render() {
  const { rolls } = await api.get('/api/rolls');
  const draft = readDraft(app.account ? app.account.id : null);
  const entryDraft = draft && draft.kind === 'entry' ? draft : null;

  const rollControl = el('select', {}, rolls.map((roll, index) => option(roll.id, roll.name, index === 0)));
  const rollField = field('Roll', rollControl);
  const counterField = field('Counter', el('input', { type: 'number', min: 0, max: 99, step: 1 }));
  const apertureField = field(
    'Aperture',
    el('select', {}, APERTURES.map((value) => option(value, `f/${value}`, value === '8'))),
  );
  const shutterField = field('Shutter', el('input', { type: 'text', value: '1/125' }));
  const evField = field('Metered EV', el('input', { type: 'number', step: 'any' }));
  const preview = el('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Exposure preview',
    class: 'preview figures',
  });
  const noteField = field('Note', el('textarea', { rows: 3 }));
  const count = el('p', { class: 'muted count figures', text: `0 / ${LIMITS.note}` });
  noteField.wrapper.append(count);
  const misfireBox = el('input', { type: 'checkbox' });
  misfireBox.setAttribute('aria-label', 'Misfire');
  const submit = el('button', { type: 'submit', class: 'solid', text: 'Log exposure' });

  const form = el('form', { class: 'single-column log-form', novalidate: true }, [
    rollField.wrapper,
    counterField.wrapper,
    apertureField.wrapper,
    shutterField.wrapper,
    evField.wrapper,
    preview,
    noteField.wrapper,
    el('label', { class: 'checkbox' }, [misfireBox, el('span', { text: 'Misfire' })]),
    submit,
  ]);

  const recentHost = el('div', { class: 'recent' });
  const section = el('section', { class: 'log' }, [
    el('div', { class: 'archive-head' }, [
      el('h1', { text: 'Log' }),
      el('a', { href: '/rolls/new', class: 'solid', text: 'New roll' }),
    ]),
    form,
    el('h2', { text: 'Recent exposures' }),
    recentHost,
  ]);

  function currentRoll() {
    return rolls.find((roll) => roll.id === rollControl.value) || null;
  }

  function repaintPreview() {
    preview.textContent = format.previewText(figures({
      roll: currentRoll(),
      aperture: apertureField.control.value,
      shutter: shutterField.control.value,
      meteredEv: evField.control.value,
    }));
  }

  function repaintCount() {
    count.textContent = `${[...noteField.control.value.trim()].length} / ${LIMITS.note}`;
  }

  for (const entry of [rollField, apertureField, shutterField, evField]) {
    entry.control.addEventListener('input', repaintPreview);
    entry.control.addEventListener('change', repaintPreview);
  }
  noteField.control.addEventListener('input', repaintCount);

  async function syncCounter() {
    const roll = currentRoll();
    if (!roll) {
      counterField.control.value = '';
      return;
    }
    const { entries } = await api.get(`/api/rolls/${roll.id}/entries`);
    const next = nextCounter(entries);
    counterField.control.value = next === null ? '' : String(next);
  }

  rollControl.addEventListener('change', () => {
    syncCounter();
  });

  async function reloadRecent() {
    const recent = await recentExposures(rolls);
    recentHost.replaceChildren(entryList(
      'Recent exposures',
      recent.map((item) => item.entry),
      {
        roll: currentRoll(),
        alignment: null,
        reload: async () => {
          await reloadRecent();
          await syncCounter();
        },
      },
    ));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const roll = currentRoll();
    if (!roll) return;
    for (const item of [counterField, shutterField, evField, noteField]) setFieldError(item, '');
    const body = {
      counter: Number(counterField.control.value),
      aperture: apertureField.control.value,
      shutter: shutterField.control.value,
      metered_ev: Number(evField.control.value),
      note: noteField.control.value,
      misfire: misfireBox.checked,
    };
    if ([...body.note.trim()].length > LIMITS.note) {
      setFieldError(noteField, fieldCopy('note'));
      activity(fieldCopy('note'));
      noteField.control.focus();
      return;
    }
    activity(COPY.pending.entry);
    try {
      const saved = await api.call('POST', `/api/rolls/${roll.id}/entries`, body, { keepSession: true });
      discardDraft();
      activity(fill(COPY.success.entry, { counter: saved.counter }));
      noteField.control.value = '';
      repaintCount();
      misfireBox.checked = false;
      await syncCounter();
      await reloadRecent();
      shutterField.control.focus();
    } catch (failure) {
      if (failure.status === 401) {
        saveDraft({
          kind: 'entry',
          accountId: app.account ? app.account.id : null,
          rollId: roll.id,
          fields: body,
        });
        activity(COPY.draft.entry_expired);
        app.account = null;
        await navigate('/signin?next=%2Flog');
        return;
      }
      if (failure.status === 422) {
        const order = [
          ['counter', counterField],
          ['aperture', apertureField],
          ['shutter', shutterField],
          ['metered_ev', evField],
          ['note', noteField],
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
  });

  if (entryDraft) {
    if (rolls.some((roll) => roll.id === entryDraft.rollId)) rollControl.value = entryDraft.rollId;
    counterField.control.value = entryDraft.fields.counter;
    apertureField.control.value = entryDraft.fields.aperture;
    shutterField.control.value = entryDraft.fields.shutter;
    evField.control.value = entryDraft.fields.metered_ev;
    noteField.control.value = entryDraft.fields.note;
    misfireBox.checked = entryDraft.fields.misfire;
    repaintPreview();
    repaintCount();
    activity(COPY.draft.entry_restored);
    setTimeout(() => submit.focus(), 0);
  } else {
    await syncCounter();
    repaintPreview();
    repaintCount();
  }
  await reloadRecent();
  return section;
}
