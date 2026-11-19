import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { duration, stateWord } from '../core/format.js';

const GONE = 'This shared project link is no longer available.';

function summaryRow(row) {
  return h('tr', {},
    h('td', {}, row.filter),
    h('td', { class: 'num' }, duration(row.planned_seconds)),
    h('td', { class: 'num' }, duration(row.logged_seconds)),
    h('td', { class: 'num' }, duration(row.owed_seconds)));
}

export async function mount({ params }) {
  document.body.classList.add('page-shared');
  const app = document.getElementById('app');
  let project;
  try {
    project = await api('GET', `/api/shared/${encodeURIComponent(params.token)}`);
  } catch (error) {
    document.title = 'Darkframe';
    app.replaceChildren(h('main', { id: 'main', class: 'shared' }, h('p', { class: 'shared-gone' }, error.status === 404 ? GONE : error.message)));
    return;
  }
  document.title = `${project.project_name} - Darkframe`;
  app.replaceChildren(h('main', { id: 'main', class: 'shared' },
    h('h1', {}, project.project_name),
    h('p', { class: 'muted' }, `${project.target_name} `, h('span', { class: 'chip' }, stateWord(project.state))),
    h('div', { class: 'sheet', tabindex: '0' },
      h('table', { 'aria-label': 'Integration summary' },
        h('thead', {}, h('tr', {}, ['Filter', 'Planned', 'Logged', 'Owed'].map((label) => h('th', {}, label)))),
        h('tbody', {}, project.filters.map(summaryRow)))),
    h('section', { class: 'card shared-totals' },
      h('p', { class: 'total-figure num' }, `${duration(project.total_integration_seconds)} total`),
      h('p', { class: 'muted' }, `${project.session_count} ${project.session_count === 1 ? 'session' : 'sessions'}`),
      h('p', { class: 'muted' }, `Imaged from near ${project.site.latitude.toFixed(1)}, ${project.site.longitude.toFixed(1)}`))));
}
