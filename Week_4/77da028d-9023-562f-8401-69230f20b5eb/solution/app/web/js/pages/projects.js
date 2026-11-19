import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { announce, liveRegion } from '../core/live.js';
import { field } from '../core/forms.js';
import { duration, stateWord } from '../core/format.js';
import { mountShell } from '../shell.js';
import { formDialog } from './form-dialog.js';
import { skyDisc } from './sky-disc.js';
import { parseNumber } from './values.js';

function projectCard(project) {
  return h('article', { class: 'card project-card', 'aria-label': project.name },
    h('h2', {}, h('a', { href: `/projects/${project.id}` }, project.name)),
    h('p', { class: 'muted' }, project.target_name),
    h('p', {}, h('span', { class: 'chip' }, stateWord(project.state))),
    h('p', { class: 'project-total' }, `${duration(project.total_integration_seconds)} total`),
    h('ul', { class: 'owed-list' }, project.filters.map((row) => h('li', {},
      h('span', { class: 'owed-filter' }, row.filter),
      h('span', { class: 'num' }, `Owed ${duration(row.owed_seconds)}`)))));
}

function newProjectDialog({ opener, onCreated }) {
  const inputs = {
    name: h('input', { type: 'text', 'data-field': 'name', maxlength: '80' }),
    target_name: h('input', { type: 'text', 'data-field': 'target_name', maxlength: '80' }),
    ra_deg: h('input', { type: 'text', inputmode: 'decimal', 'data-field': 'ra_deg' }),
    dec_deg: h('input', { type: 'text', inputmode: 'decimal', 'data-field': 'dec_deg' }),
  };
  const view = formDialog({
    name: 'New project',
    submitLabel: 'Create project',
    onSubmit: async () => {
      const created = await api('POST', '/api/projects', { body: {
        name: inputs.name.value.trim(),
        target_name: inputs.target_name.value.trim(),
        ra_deg: parseNumber(inputs.ra_deg.value),
        dec_deg: parseNumber(inputs.dec_deg.value),
      } });
      view.dialog.close();
      onCreated(created);
    },
  });
  view.fieldsHost.append(
    field({ label: 'Project name', input: inputs.name }),
    field({ label: 'Target name', input: inputs.target_name }),
    field({ label: 'Right ascension (degrees)', input: inputs.ra_deg, hint: '0 up to 360' }),
    field({ label: 'Declination (degrees)', input: inputs.dec_deg, hint: '-90 to 90' }));
  view.dialog.open(opener);
}

export async function mount() {
  const { main } = mountShell({ page: 'projects' });
  const updates = liveRegion('Project updates');
  const grid = h('div', { class: 'project-grid' });
  const newProject = h('button', { type: 'button', class: 'btn btn--primary', onclick: () => newProjectDialog({ opener: newProject, onCreated: created }) }, 'New project');

  async function load() {
    const { projects } = await api('GET', '/api/projects');
    grid.replaceChildren(...projects.map(projectCard));
    if (!projects.length) grid.replaceChildren(h('div', { class: 'empty' }, skyDisc({ size: 160 }), h('p', {}, 'No projects yet. Create one to start planning.')));
  }

  async function created(project) {
    announce(updates, `${project.name} created.`);
    await load();
  }

  main.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'Projects'), newProject),
    updates,
    grid);
  await load();
}
