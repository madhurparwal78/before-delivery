// A compartment's docket. Its own route, and the left pane of the exhibit and release screens.

import {
  api, CONNECTION_LOST, ConnectionLost, clearFieldError, digestLine, field, figure, h, heldMarker, refusalCopy, registerUnsaved, ruledTable, session,
  setFieldError, setFigure, syncRows,
} from '../core.js';
import { openDialog, stepUp } from '../dialogs.js';
import { actionStatus, docketPanes, navigate, noRecordCopy, watchCompartment } from '../shell.js';

const LIST_REFRESH_MS = 4000;
const SCOPES = [['Full', 'full'], ['Derivatives only', 'derivatives']];
const RECIPIENTS = [['Outside counsel', 'counsel'], ['Requester', 'requester']];

const options = (pairs) => pairs.map(([label, value]) => h('option', { value }, label));
const lapseText = (expiresAt) => (expiresAt ? `Lapses ${expiresAt.slice(0, 10)} ${expiresAt.slice(11, 16)} UTC` : 'Does not lapse');
const displayWord = (state) => state[0].toUpperCase() + state.slice(1);

function recordLink(path, id) {
  return h('a', { href: path, class: 'row-link mono', 'aria-current': location.pathname === path ? 'page' : null }, id);
}

function totalsStatus() {
  const quarantined = h('span', { class: 'mono', 'data-quarantine-count': true });
  const bytes = h('span', { class: 'mono', 'data-release-bytes': true });
  const element = h('div', { role: 'status', 'aria-label': 'Compartment totals', class: 'totals-line' },
    quarantined, ' in quarantine. ', bytes, ' bytes in releases.');
  const update = (data) => {
    for (const [node, value] of [[quarantined, data.quarantine_count], [bytes, data.release_bytes]]) {
      if (node.textContent !== String(value)) node.textContent = String(value);
    }
  };
  return { element, update };
}

function exhibitsTable() {
  const { table, body, row } = ruledTable('Exhibits', ['Exhibit', 'State', 'Name', 'Digest']);
  const update = (exhibits) => syncRows(body, exhibits, {
    key: (exhibit) => exhibit.id,
    signature: (exhibit) => JSON.stringify([exhibit.name, exhibit.state, exhibit.sha256, exhibit.holds.length]),
    render: (exhibit) => row(
      recordLink(`/exhibits/${exhibit.id}`, exhibit.id),
      h('span', { class: 'row-state' }, exhibit.holds.length ? heldMarker() : h('span', { class: 'state-word' }, exhibit.state)),
      { wide: exhibit.name },
      { wide: digestLine(exhibit.sha256) },
    ),
  });
  return { table, update };
}

function releasesTable() {
  const { table, body, row } = ruledTable('Releases', ['Release', 'State', 'Name', 'Bytes']);
  const update = (releases) => syncRows(body, releases, {
    key: (release) => release.id,
    signature: (release) => JSON.stringify([release.name, release.state, release.total_bytes]),
    render: (release) => row(
      recordLink(`/releases/${release.id}`, release.id),
      h('span', { class: 'state-word' }, displayWord(release.state)),
      { wide: release.name },
      { wide: h('span', { class: 'mono' }, `${release.total_bytes} bytes`) },
    ),
  });
  return { table, update };
}

// Places a refused form's field errors below their controls; everything without a control goes to Action status.
function showFieldErrors(errors, controls) {
  const copies = Object.values(errors);
  actionStatus(copies.join(' '), 'refusal');
  const placed = Object.entries(errors).filter(([name]) => controls[name]).map(([name, copy]) => {
    setFieldError(controls[name], copy);
    return controls[name];
  });
  placed[0]?.focus();
}

// Access list, its dialogs and the grant actions. `state.version` follows the server; an open dialog keeps its own.
function accessSection(pane, compartmentId, directory, refresh, canAdminister) {
  const state = { version: 0, dialog: null };
  const nameOf = (userId) => directory.find((person) => person.id === userId)?.name ?? userId;
  const { table, body, row } = ruledTable('Access list', ['Person', 'Scope', 'State', 'Lapse', 'Actions']);
  const focusPane = () => pane.focus();

  function grantDialog(opener, grant) {
    let version = state.version;
    const person = grant ? null : h('select', {}, options(directory.map((entry) => [entry.name, entry.id])));
    const scope = h('select', {}, options(SCOPES));
    const lapse = h('input', { type: 'text', class: 'mono', autocomplete: 'off', spellcheck: 'false', value: grant?.expires_at ?? '' });
    if (grant) scope.value = grant.scope;
    const save = h('button', { type: 'submit', class: 'btn' }, 'Save grant');
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
    const form = h('form', { class: 'stack', novalidate: true },
      person ? field('Person', person) : null, field('Scope', scope), field('Lapses at', lapse),
      h('div', { class: 'button-row' }, save, cancel));
    const dialog = openDialog({
      name: grant ? 'Edit grant' : 'Issue grant',
      content: form,
      opener,
      fallback: focusPane,
      onClosed: () => {
        state.dialog = null;
      },
    });
    state.dialog = dialog;
    cancel.addEventListener('click', () => dialog.close());
    (person ?? scope).focus();
    const controls = { user_id: person, scope, expires_at: lapse };

    const onAnswer = (answer) => {
      if (answer.ok) {
        dialog.close();
        actionStatus('Grant saved.', 'done');
        refresh();
      } else if (answer.errors) {
        showFieldErrors(answer.errors, controls);
      } else {
        if (answer.error === 'stale_access_list') version = answer.data.access_version;
        actionStatus(refusalCopy(answer), 'refusal');
        save.focus();
      }
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      for (const control of Object.values(controls)) if (control) clearFieldError(control);
      const sent = { scope: scope.value, expires_at: lapse.value === '' ? null : lapse.value, access_version: version };
      stepUp({
        opener: save,
        fallback: focusPane,
        run: (proof) => {
          actionStatus('Saving grant.');
          return grant
            ? api('PATCH', `/api/grants/${grant.id}`, { body: sent, proof })
            : api('POST', `/api/compartments/${compartmentId}/grants`, { body: { user_id: person.value, ...sent }, proof });
        },
        onAnswer,
        onFailure: () => actionStatus(CONNECTION_LOST),
      });
    });
  }

  function grantAction(opener, { pending, done, path }) {
    stepUp({
      opener,
      fallback: focusPane,
      run: (proof) => {
        actionStatus(pending);
        return api('POST', path, { body: {}, proof });
      },
      onAnswer: (answer) => {
        if (answer.ok) actionStatus(done, 'done');
        else actionStatus(refusalCopy(answer), 'refusal');
        refresh();
      },
      onFailure: () => actionStatus(CONNECTION_LOST),
    });
  }

  function renderGrant(grant) {
    const name = nameOf(grant.user_id);
    const button = (verb, rest, onclick) => h('button', { type: 'button', class: 'btn', onclick }, verb, h('span', { class: 'visually-hidden' }, `${rest} for ${name}`));
    const actionable = canAdminister && grant.kind === 'grant' && grant.state === 'active';
    return row(
      { wide: name },
      SCOPES.find(([, value]) => value === grant.scope)[0] + (grant.kind === 'break_glass' ? ' (break-glass)' : ''),
      h('span', { class: 'state-word' }, grant.state),
      { wide: h('span', { class: 'mono' }, lapseText(grant.expires_at)) },
      {
        wide: actionable ? h('div', { class: 'button-row' },
          button('Edit', ' grant', (event) => grantDialog(event.currentTarget, grant)),
          button('Revoke', ' grant', (event) => grantAction(event.currentTarget, { pending: 'Revoking.', done: 'Grant revoked.', path: `/api/grants/${grant.id}/revoke` })),
          button('End sessions', '', (event) => grantAction(event.currentTarget, { pending: 'Ending sessions.', done: 'Sessions ended.', path: `/api/users/${grant.user_id}/sessions/revoke` }))) : null,
      },
    );
  }

  const issue = h('button', { type: 'button', class: 'btn', onclick: (event) => grantDialog(event.currentTarget, null) }, 'Issue grant');
  const element = h('section', { class: 'sheet-section stack' },
    h('div', { class: 'sheet-head' }, h('h3', {}, 'Access list'), canAdminister ? issue : null), table);

  const update = (data) => {
    state.version = data.access_version;
    const focusInside = body.contains(document.activeElement);
    syncRows(body, data.access, {
      key: (grant) => grant.id,
      signature: (grant) => JSON.stringify(grant),
      render: renderGrant,
    });
    if (focusInside && document.activeElement === document.body) focusPane();
  };
  return { element, update, hasOpenDialog: () => state.dialog !== null, closeDialog: () => state.dialog?.close() };
}

function newReleaseButton(pane, compartmentId) {
  const opener = h('button', { type: 'button', class: 'btn' }, 'New release');
  opener.addEventListener('click', () => {
    const name = h('input', { type: 'text', autocomplete: 'off' });
    const matter = h('input', { type: 'text', class: 'mono', autocomplete: 'off' });
    const recipient = h('select', {}, options(RECIPIENTS));
    const create = h('button', { type: 'submit', class: 'btn' }, 'Create release');
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
    const form = h('form', { class: 'stack', novalidate: true },
      field('Release name', name), field('Matter reference', matter), field('Recipient', recipient),
      h('div', { class: 'button-row' }, create, cancel));
    const dialog = openDialog({ name: 'New release', content: form, opener, fallback: () => pane.focus() });
    cancel.addEventListener('click', () => dialog.close());
    name.focus();
    const controls = { name, matter_ref: matter, recipient_kind: recipient };
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (create.disabled) return;
      create.disabled = true;
      for (const control of Object.values(controls)) clearFieldError(control);
      try {
        const answer = await api('POST', `/api/compartments/${compartmentId}/releases`, {
          body: { name: name.value, matter_ref: matter.value, recipient_kind: recipient.value },
        });
        if (answer.ok) {
          dialog.close({ returnFocus: false });
          navigate(`/releases/${answer.data.id}`);
        } else if (answer.errors) {
          showFieldErrors(answer.errors, controls);
        } else if (answer.status !== 401) {
          actionStatus(refusalCopy(answer), 'refusal');
        }
      } catch (error) {
        if (!(error instanceof ConnectionLost)) throw error;
        actionStatus(CONNECTION_LOST);
      } finally {
        create.disabled = false;
      }
    });
  });
  return opener;
}

// Fills `panes.docket`, watches the grant and keeps every table live. `withFigure` is only for the docket's own
// route, because the exhibit and release screens hold the screen's one figure in their inspector. The other options
// pass through to `watchCompartment`.
export async function renderDocket(screen, panes, compartmentId, { withFigure = false, onData, ...watchers } = {}) {
  const pane = panes.docket;
  pane.replaceChildren(h('div', { class: 'skeleton' }, h('div'), h('div'), h('div')));
  const path = `/api/compartments/${compartmentId}`;
  const compartmentAnswer = await api('GET', path, { signal: screen.signal });
  if (screen.stopped) return;
  if (compartmentAnswer.status === 404) {
    screen.notFound();
    return;
  }
  if (!compartmentAnswer.ok) return;
  const data = compartmentAnswer.data;

  const loadLists = async (requestOptions = {}) => {
    const [exhibits, releases] = await Promise.all([
      api('GET', `${path}/exhibits`, { signal: screen.signal, ...requestOptions }),
      api('GET', `${path}/releases`, { signal: screen.signal, ...requestOptions }),
    ]);
    return exhibits.ok && releases.ok ? { exhibits: exhibits.data.exhibits, releases: releases.data.releases } : null;
  };
  const [lists, directory] = await Promise.all([
    loadLists(),
    data.access ? api('GET', '/api/directory', { signal: screen.signal }) : null,
  ]);
  if (screen.stopped || !lists) return;

  const count = withFigure ? figure('Exhibits', data.exhibit_count) : null;
  const totals = totalsStatus();
  const exhibits = exhibitsTable();
  const releases = releasesTable();

  const applyLists = (next) => {
    exhibits.update(next.exhibits);
    releases.update(next.releases);
  };
  let access = null;
  const applyCompartment = (next) => {
    if (count) setFigure(count, next.exhibit_count);
    totals.update(next);
    if (!access) return;
    if (next.access) access.update(next);
    else {
      access.closeDialog();
      access.element.remove();
      access = null;
    }
  };
  const refreshCompartment = async () => {
    const answer = await api('GET', path, { background: true, signal: screen.signal });
    if (answer.ok && !screen.stopped) applyCompartment(answer.data);
  };
  const refreshLists = async () => {
    const next = await loadLists({ background: true });
    if (next && !screen.stopped) applyLists(next);
  };
  const refreshAll = () => Promise.all([refreshCompartment(), refreshLists()]).catch((error) => {
    if (!(error instanceof ConnectionLost) && error.name !== 'AbortError') throw error;
  });

  if (data.access) {
    const heldThroughBreakGlass = session.breakGlass.some((entry) => entry.compartment_id === compartmentId);
    access = accessSection(pane, compartmentId, directory?.ok ? directory.data.people : [], refreshAll, !heldThroughBreakGlass);
    const stopTracking = registerUnsaved(() => Boolean(access?.hasOpenDialog()));
    screen.onCleanup(stopTracking);
  }

  const assembles = ['case_lead', 'investigator'].includes(session.me.role);
  pane.replaceChildren(...[
    h('header', { class: 'sheet-title' },
      h('h2', {}, data.name),
      h('p', { class: 'mono' }, data.id),
      data.caller_scope === 'derivatives' ? h('p', { class: 'state-word' }, SCOPES[1][0]) : null),
    count,
    totals.element,
    h('section', { class: 'sheet-section stack' }, h('h3', {}, 'Exhibits'), exhibits.table, h('p', { class: 'table-none' }, 'No exhibits yet.')),
    access?.element,
    h('section', { class: 'sheet-section stack' },
      h('div', { class: 'sheet-head' }, h('h3', {}, 'Releases'), assembles ? newReleaseButton(pane, compartmentId) : null),
      releases.table,
      h('p', { class: 'table-none' }, 'No releases yet.')),
  ].filter(Boolean));
  applyCompartment(data);
  applyLists(lists);

  watchCompartment(screen, compartmentId, panes, {
    ...watchers,
    onData: (next) => {
      applyCompartment(next);
      onData?.(next);
    },
  });
  screen.seedScope(data.caller_scope);
  screen.every(LIST_REFRESH_MS, refreshLists, { now: false });
}

export async function mount(screen) {
  const panes = docketPanes(screen, 'docket');
  noRecordCopy(panes.inspector);
  await renderDocket(screen, panes, screen.params[0], { withFigure: true });
}
