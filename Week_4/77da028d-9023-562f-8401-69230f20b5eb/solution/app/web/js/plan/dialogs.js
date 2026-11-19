// The two dialogs of the Plan screen: Add target to plan and Sky conditions.
import { h, uid } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { createDialog } from '../core/dialog.js';
import { createErrorSummary, clearInvalid } from '../core/forms.js';
import { hhmm } from '../core/format.js';

function busy(button, working) {
  button.disabled = working;
  button.setAttribute('aria-busy', String(working));
}

// createAddTargetDialog({getPlan, onAdded}) -> {open(opener)}; onAdded(targetName) after the server accepted it.
export function createAddTargetDialog({ getPlan, onAdded }) {
  const dialog = createDialog({ name: 'Add target to plan' });
  const summary = createErrorSummary();
  const listbox = h('ul', { role: 'listbox', 'aria-label': 'Active projects', tabindex: '0', class: 'option-list' });
  const emptyNote = h('p', { class: 'muted', hidden: true }, 'Every active project is already in this plan.');
  const field = h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Active projects'), listbox, emptyNote);
  const add = h('button', { type: 'button', class: 'btn' }, 'Add to plan');
  const cancel = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => dialog.close() }, 'Cancel');
  dialog.body.append(summary.element, field);
  dialog.actions.append(cancel, add);
  let choices = [];
  let selected = null;

  function select(index) {
    selected = index;
    [...listbox.children].forEach((option, position) => option.setAttribute('aria-selected', String(position === index)));
    if (index === null) listbox.removeAttribute('aria-activedescendant');
    else listbox.setAttribute('aria-activedescendant', listbox.children[index].id);
  }

  function fillOptions(projects) {
    const planned = new Set(getPlan().targets.map((target) => target.project_id));
    choices = projects.filter((project) => project.state === 'active' && !planned.has(project.id));
    listbox.replaceChildren(...choices.map((project, index) => h('li', {
      role: 'option', id: uid('project'), 'aria-selected': 'false', onclick: () => select(index),
    }, `${project.target_name} (${project.name})`)));
    select(null);
    emptyNote.hidden = choices.length > 0;
  }

  listbox.addEventListener('keydown', (event) => {
    if (choices.length === 0 || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    select(selected === null ? 0 : (selected + step + choices.length) % choices.length);
  });

  add.addEventListener('click', async () => {
    summary.clear();
    clearInvalid(dialog.body);
    if (selected === null) {
      summary.showFields({ project: 'Choose a project to add.' }, () => listbox);
      return;
    }
    const project = choices[selected];
    busy(add, true);
    try {
      await api('POST', `/api/plans/${getPlan().date}/targets`, { body: { project_id: project.id } });
      dialog.close();
      onAdded(project.target_name);
    } catch (error) {
      summary.showMessage(error.message);
    } finally {
      busy(add, false);
    }
  });

  return {
    async open(opener) {
      summary.clear();
      clearInvalid(dialog.body);
      listbox.replaceChildren();
      emptyNote.hidden = true;
      select(null);
      dialog.open(opener);
      try {
        fillOptions((await api('GET', '/api/projects')).projects);
      } catch (error) {
        summary.showMessage(error.message);
      }
    },
  };
}

function hourLabels(hours) {
  return hours.map((hour) => {
    const wall = hhmm(hour);
    const repeats = hours.filter((other) => hhmm(other) === wall).length > 1;
    return repeats ? `${wall} (${hour.slice(-6)})` : wall;
  });
}

const CONDITION_FIELDS = [
  ['cloud_pct', 'Cloud', 'Cloud cover, 0 to 100'],
  ['transparency', 'Transparency', 'Transparency, 1 to 5'],
  ['seeing', 'Seeing', 'Seeing, 1 to 5'],
];
const SERVER_FIELD = /^hours\[(\d+)\]\.(\w+)$/;
const ROW_INCOMPLETE = 'Enter cloud, transparency and seeing for this hour, or leave all three empty.';

// createConditionsDialog({getPlan, announce, onSaved}) -> {open(opener)}
// announce(text) writes to Plan updates; onSaved() asks the page for the plan at the handle's minute.
export function createConditionsDialog({ getPlan, announce, onSaved }) {
  const dialog = createDialog({ name: 'Sky conditions', wide: true });
  const summary = createErrorSummary();
  const grid = h('div', { class: 'conditions-grid' });
  const save = h('button', { type: 'button', class: 'btn' }, 'Save conditions');
  const cancel = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => dialog.close() }, 'Cancel');
  dialog.body.append(summary.element, h('p', { class: 'muted' }, 'Enter cloud cover, transparency and seeing for each hour of the night. Leave an hour empty to skip it.'), grid);
  dialog.actions.append(cancel, save);
  let rows = [];

  function buildRows() {
    const plan = getPlan();
    const labels = hourLabels(plan.hours);
    const stored = new Map(plan.conditions.hours.map((entry) => [Date.parse(entry.hour_start), entry]));
    grid.replaceChildren(h('span', { class: 'conditions-head' }, 'Hour'),
      ...CONDITION_FIELDS.map(([, , heading]) => h('span', { class: 'conditions-head' }, heading)));
    rows = plan.hours.map((hour, index) => {
      const entry = stored.get(Date.parse(hour));
      const inputs = CONDITION_FIELDS.map(([key, name]) => h('input', {
        type: 'number', inputmode: 'numeric', step: '1', 'aria-label': `${name} ${labels[index]}`,
        value: entry ? String(entry[key]) : '',
      }));
      grid.append(h('span', { class: 'conditions-hour' }, labels[index]), ...inputs);
      return { hour, inputs };
    });
  }

  function collect() {
    const entries = [];
    const incomplete = {};
    rows.forEach((row, index) => {
      const values = row.inputs.map((input) => input.value.trim());
      if (values.every((value) => value === '')) return;
      if (values.some((value) => value === '')) {
        incomplete[`row-${index}`] = { message: ROW_INCOMPLETE, input: row.inputs[values.findIndex((value) => value === '')] };
        return;
      }
      entries.push({
        row,
        body: { hour_start: row.hour, cloud_pct: Number(values[0]), transparency: Number(values[1]), seeing: Number(values[2]) },
      });
    });
    return { entries, incomplete };
  }

  function showServerErrors(error, entries) {
    const found = {};
    const inputs = {};
    for (const [key, message] of Object.entries(error.fields || {})) {
      const match = SERVER_FIELD.exec(key);
      const row = match ? entries[Number(match[1])]?.row : null;
      const input = row ? row.inputs[CONDITION_FIELDS.findIndex(([field]) => field === match[2])] : null;
      found[key] = message;
      inputs[key] = input;
    }
    if (Object.keys(found).length === 0) summary.showMessage(error.message);
    else summary.showFields(found, (key) => inputs[key]);
  }

  save.addEventListener('click', async () => {
    summary.clear();
    clearInvalid(dialog.body);
    const { entries, incomplete } = collect();
    if (Object.keys(incomplete).length > 0) {
      summary.showFields(Object.fromEntries(Object.entries(incomplete).map(([key, value]) => [key, value.message])), (key) => incomplete[key].input);
      return;
    }
    busy(save, true);
    announce('Saving conditions...');
    try {
      const saved = await api('PUT', `/api/plans/${getPlan().date}/conditions`, { body: { hours: entries.map((entry) => entry.body) } });
      dialog.close();
      announce(`Conditions saved for ${saved.conditions.hours.length} hours.`);
      onSaved();
    } catch (error) {
      announce(error.message);
      if (error instanceof ApiError && error.status === 422) showServerErrors(error, entries);
      else summary.showMessage(error.message);
    } finally {
      busy(save, false);
    }
  });

  return {
    open(opener) {
      summary.clear();
      buildRows();
      dialog.open(opener);
    },
  };
}
