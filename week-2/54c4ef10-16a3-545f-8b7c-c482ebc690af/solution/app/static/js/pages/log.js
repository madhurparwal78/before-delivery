// Log: the shooting-log form with its live Exposure preview, and Recent exposures.
import { get, post } from '../api.js';
import { announce, field, h, showFieldErrors } from '../dom.js';
import { DEFAULT_APERTURE, LIMITS, RANGES } from '../domain.js';
import { entryBody, entryProblems } from '../entry_rules.js';
import { previewText } from '../exposure.js';
import { characters } from '../format.js';
import { hooks } from '../hooks.js';
import { paintProcedural } from '../prints.js';
import { saveDraft, takeDraft } from '../session.js';
import { apertureOptions, entryList } from './entry_list.js';

const RECENT = 20;

function nextCounter(entries = []) {
  const highest = entries.reduce((top, entry) => Math.max(top, entry.counter), 0);
  if (entries.length === 0) return '1';
  return highest >= RANGES.counter[1] ? '' : String(highest + 1);
}

function recentOf(entriesByRoll) {
  return [...entriesByRoll.values()].flat()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.counter - a.counter))
    .slice(0, RECENT);
}

export async function render(main) {
  const rolls = (await get('/api/rolls')).data.rolls;
  main.append(h('div', { class: 'page-head' }, h('h1', {}, 'Log'), h('a', { class: 'button', href: '/rolls/new' }, 'New roll')));
  if (!rolls.length) {
    const blank = h('canvas', { 'aria-hidden': 'true', class: 'blank-frame' });
    main.append(h('div', { class: 'empty' }, blank, h('p', {}, 'Your archive is empty. Start a roll before you shoot.')));
    paintProcedural(blank, 'blank');
  }
  const rollsById = new Map(rolls.map((roll) => [roll.id, roll]));
  const lists = await Promise.all(rolls.map((roll) => get(`/api/rolls/${roll.id}/entries`)));
  const entriesByRoll = new Map(rolls.map((roll, index) => [roll.id, lists[index].data.entries]));

  const pickRoll = h('select', {}, rolls.map((roll) => h('option', { value: roll.id }, roll.name)));
  const counter = h('input', { type: 'number', step: 1 });
  const aperture = h('select', {}, apertureOptions(DEFAULT_APERTURE));
  const shutter = h('input', { type: 'text', autocomplete: 'off' });
  const ev = h('input', { type: 'number', step: 'any' });
  const preview = h('p', { class: 'preview-line', role: 'status', 'aria-label': 'Exposure preview' });
  const note = h('textarea', {});
  const count = h('p', { class: 'count' });
  const misfire = h('input', { type: 'checkbox' });
  const submit = h('button', { type: 'submit', class: 'primary', disabled: !rolls.length }, 'Log exposure');
  const fields = {
    counter: field('Counter', counter), aperture: field('Aperture', aperture), shutter: field('Shutter', shutter),
    metered_ev: field('Metered EV', ev), note: field('Note', note),
  };
  const roll = field('Roll', pickRoll);
  const selected = () => rollsById.get(pickRoll.value);
  const refresh = () => {
    preview.textContent = previewText(selected(), aperture.value, shutter.value, ev.value);
    count.textContent = `${characters(note.value)} / ${LIMITS.note}`;
  };
  for (const input of [pickRoll, aperture, shutter, ev, note]) {
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
  }
  pickRoll.addEventListener('change', () => { counter.value = nextCounter(entriesByRoll.get(pickRoll.value)); });
  counter.value = nextCounter(entriesByRoll.get(pickRoll.value));
  refresh();

  const entryContext = {
    rolls: rollsById, showRoll: true, frameNumbers: new Map(), pageValues: () => values(), entryById: (id) => [...entriesByRoll.values()].flat().find((e) => e.id === id),
    onChange(kind, entry) {
      const entries = entriesByRoll.get(entry.roll_id);
      entriesByRoll.set(entry.roll_id, kind === 'deleted' ? entries.filter((e) => e.id !== entry.id)
        : entries.map((e) => (e.id === entry.id ? entry : e)));
      recent.paint(recentOf(entriesByRoll));
      if (entry.roll_id === pickRoll.value) counter.value = nextCounter(entriesByRoll.get(pickRoll.value));
    },
  };
  const recent = entryList('Recent exposures', recentOf(entriesByRoll), entryContext);

  const form = h('form', { class: 'form', novalidate: true }, roll.root, fields.counter.root, fields.aperture.root, fields.shutter.root,
    fields.metered_ev.root, h('p', { class: 'preview-label' }, 'Exposure preview'), preview, fields.note.root, count, h('label', { class: 'check' }, misfire, 'Misfire'),
    h('div', { class: 'actions' }, submit));
  const values = () => ({ roll: pickRoll.value, counter: counter.value, aperture: aperture.value, shutter: shutter.value,
    metered_ev: ev.value, note: note.value, misfire: misfire.checked });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (showFieldErrors(fields, entryProblems(values()))) return;
    announce('Logging…');
    const body = entryBody(values());
    const response = await post(`/api/rolls/${pickRoll.value}/entries`, body, { keep401: true });
    if (response.status === 401) {
      saveDraft({ kind: 'exposure', values: values() });
      announce('Your session ended. Sign in to keep this exposure.');
      hooks.navigate(`/signin?next=${encodeURIComponent('/log')}`);
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
    const logged = response.data;
    entriesByRoll.set(logged.roll_id, [...entriesByRoll.get(logged.roll_id), logged].sort((a, b) => a.counter - b.counter));
    recent.paint(recentOf(entriesByRoll));
    announce(`Note ${logged.counter} logged.`);
    counter.value = nextCounter(entriesByRoll.get(logged.roll_id));
    note.value = '';
    misfire.checked = false;
    refresh();
    shutter.focus();
  });

  main.append(form, h('section', { class: 'section' }, h('h2', {}, 'Recent exposures'), recent.root));

  function fill(saved) {
    if (rollsById.has(saved.roll)) pickRoll.value = saved.roll;
    counter.value = saved.counter;
    aperture.value = saved.aperture;
    shutter.value = saved.shutter;
    ev.value = saved.metered_ev;
    note.value = saved.note;
    misfire.checked = saved.misfire;
    refresh();
  }

  const exposure = takeDraft('exposure');
  if (exposure) {
    fill(exposure.values);
    announce('Your unsent exposure is back. Press Log exposure to send it.');
    submit.focus();
    return;
  }
  const kept = takeDraft('note');
  if (kept && kept.url === location.pathname + location.search) {
    if (kept.page) fill(kept.page);
    recent.restore(kept);
  }
}
