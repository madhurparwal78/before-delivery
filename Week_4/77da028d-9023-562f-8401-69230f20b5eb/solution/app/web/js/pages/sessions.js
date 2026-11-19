import { h, replace } from '../core/dom.js';
import { api } from '../core/api.js';
import { announce, liveRegion } from '../core/live.js';
import { field } from '../core/forms.js';
import { duration, stateWord } from '../core/format.js';
import { mountShell } from '../shell.js';
import { formDialog } from './form-dialog.js';
import { openSessionEditor } from './session-editor.js';
import { skyDisc } from './sky-disc.js';
import { isTextEntry } from './values.js';

const WIDE = window.matchMedia('(min-width: 768px)');

export async function mount() {
  const { main } = mountShell({ page: 'sessions' });
  const logHome = h('div', { class: 'live-home' });
  const log = liveRegion('Session log');
  logHome.append(log);
  const showTrashed = h('input', { type: 'checkbox', id: 'show-trashed', onchange: () => refresh() });
  const listHost = h('div', { class: 'session-list' });
  let sessions = [];

  function openButton(session) {
    return h('button', {
      type: 'button', class: 'btn btn--ghost', 'data-session': session.id,
      'aria-label': `Open session ${session.observing_date} ${session.project_name}`,
      onclick: (event) => openEditor(session.id, event.currentTarget),
    }, session.observing_date);
  }

  function table() {
    return h('div', { class: 'sheet', tabindex: '0' },
      h('table', { 'aria-label': 'Sessions' },
        h('thead', {}, h('tr', {}, ['Observing date', 'Project', 'State', 'Integration', 'Frames'].map((label) => h('th', {}, label)))),
        h('tbody', {}, sessions.map((session) => h('tr', {},
          h('td', {}, openButton(session)),
          h('td', {}, session.project_name),
          h('td', {}, h('span', { class: 'chip' }, stateWord(session.state))),
          h('td', { class: 'num' }, duration(session.integration_seconds)),
          h('td', { class: 'num' }, String(session.frame_count)))))));
  }

  function cards() {
    return h('ul', { class: 'session-cards', role: 'list', 'aria-label': 'Sessions' },
      sessions.map((session) => h('li', { class: 'card session-card' },
        openButton(session),
        h('p', {}, session.project_name),
        h('p', {}, h('span', { class: 'chip' }, stateWord(session.state))),
        h('p', { class: 'num muted' }, `${duration(session.integration_seconds)} integrated, ${session.frame_count} frames`))));
  }

  function paint() {
    replace(listHost,
      WIDE.matches ? table() : cards(),
      sessions.length ? null : h('div', { class: 'empty' }, skyDisc({ size: 160 }), h('p', {}, 'No sessions yet. Start one from an active project.')));
  }

  async function refresh(focusId = null) {
    ({ sessions } = await api('GET', `/api/sessions${showTrashed.checked ? '?include_trashed=true' : ''}`));
    paint();
    if (focusId) listHost.querySelector(`[data-session="${CSS.escape(focusId)}"]`)?.focus();
  }

  function openEditor(sessionId, opener) {
    openSessionEditor({ sessionId, opener, log, logHome, onChange: () => refresh(), onClosed: (id) => refresh(id) })
      .catch((error) => announce(log, error.message));
  }

  async function openNewSession(opener) {
    const [{ projects }, tonight] = await Promise.all([api('GET', '/api/projects'), api('GET', '/api/tonight')]);
    const project = h('select', { 'data-field': 'project_id' },
      projects.filter((entry) => entry.state === 'active').map((entry) => h('option', { value: entry.id }, entry.name)));
    const date = h('input', { type: 'text', value: tonight.date, 'data-field': 'observing_date', autocomplete: 'off' });
    const view = formDialog({
      name: 'New session',
      submitLabel: 'Create session',
      onSubmit: async () => {
        const created = await api('POST', '/api/sessions', { body: { project_id: project.value, observing_date: date.value.trim(), notes: '' } });
        view.dialog.close();
        announce(log, `Session created for ${created.observing_date}.`);
        await refresh(created.id);
      },
    });
    view.fieldsHost.append(
      field({ label: 'Project', input: project, hint: project.options.length ? null : 'No active projects. Activate a project first.' }),
      field({ label: 'Observing date', input: date, hint: 'YYYY-MM-DD' }));
    view.dialog.open(opener);
  }

  const newSession = h('button', { type: 'button', class: 'btn btn--primary', onclick: () => openNewSession(newSession).catch((error) => announce(log, error.message)) }, 'New session');

  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'n' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTextEntry(event.target) || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    newSession.click();
  });
  WIDE.addEventListener('change', paint);

  main.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'Sessions'), newSession),
    h('label', { class: 'check', for: 'show-trashed' }, showTrashed, 'Show trashed'),
    logHome,
    listHost);
  await refresh();
}
