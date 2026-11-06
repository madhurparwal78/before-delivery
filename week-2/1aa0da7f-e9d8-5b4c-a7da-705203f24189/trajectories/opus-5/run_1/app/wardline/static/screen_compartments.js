/** The compartments screen and the compartment docket shared by three routes. */

import { get, patch, post } from './api.js';
import { clear, el, heldMarker, takeFocus } from './dom.js';
import { closeAllDialogs, openDialog } from './dialog.js';
import {
  COPY,
  errorCode,
  decisionCopy,
  hourMinute,
  lapseText,
  moveFocusAfterRemoval,
  privileged,
  setStatus,
  syncRows,
  table,
} from './ui.js';
import { go, loadCompartments, notFoundPage, state } from './app.js';

const SCOPE_WORDS = { full: 'Full', derivatives: 'Derivatives only' };

export default {
  async mount(context) {
    const { docket, inspector, status } = context;
    const figure = el('span', { dataset: { figure: 'true' }, text: '0' });
    const totals = el('div', { role: 'region', 'aria-label': 'Totals', class: 'mono' });
    const searchBox = el('input', {
      type: 'search',
      id: 'search-exhibits',
      'aria-label': 'Search exhibits',
    });
    const results = el('ul', { 'aria-label': 'Search results' });
    const list = el('ul', { 'aria-label': 'Compartments' });
    docket.append(
      figure,
      el('span', { dataset: { figureLabel: 'true' }, text: 'Exhibits in your grants' }),
      totals,
      el('label', { for: 'search-exhibits', text: 'Search exhibits' }),
      searchBox,
      results,
      el('h2', { text: 'Compartments' }),
      list
    );
    inspector.append(el('p', { text: COPY.noRecord }));

    if (state.user.role === 'case_lead') {
      docket.append(buildCreate(status), buildBreakGlass(status));
    }

    let timer = null;
    searchBox.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(runSearch, 250);
    });

    async function runSearch() {
      const term = searchBox.value;
      if (term.trim() === '') {
        clear(results);
        return;
      }
      const reply = await get('/api/search?q=' + encodeURIComponent(term));
      if (reply.status !== 200) return;
      clear(results);
      for (const hit of reply.body.results) {
        results.append(
          el('li', {}, [
            el('a', {
              class: 'rowlink',
              href: `/exhibits/${hit.exhibit_id}`,
              'data-route': 'true',
              text: hit.exhibit_id,
            }),
            ' ',
            el('span', { text: hit.name }),
            ' ',
            el('span', { class: 'mono', text: hit.state }),
          ])
        );
      }
    }

    async function refresh() {
      const dashboard = await get('/api/dashboard', { background: true });
      if (dashboard.status === 200) {
        figure.textContent = String(dashboard.body.exhibits);
        clear(totals);
        totals.append(
          el('p', { class: 'mono', text: `Compartments ${dashboard.body.compartments}` }),
          el('p', { class: 'mono', text: `Exhibits ${dashboard.body.exhibits}` }),
          el('p', { class: 'mono', text: `Quarantined ${dashboard.body.quarantined}` }),
          el('p', { class: 'mono', text: `Held ${dashboard.body.held}` }),
          el('p', {
            class: 'mono',
            text: `Releases in review ${dashboard.body.releases_in_review}`,
          }),
          el('p', { class: 'mono', text: `Release bytes ${dashboard.body.release_bytes}` })
        );
      }
      const reply = await get('/api/compartments', { background: true });
      if (reply.status === 200) {
        state.compartments = reply.body.compartments;
        syncRows(list, reply.body.compartments, {
          key: (item) => item.id,
          signature: (item) =>
            `${item.name}|${item.exhibit_count}|${item.quarantine_count}|${item.release_bytes}`,
          build: (item) =>
            el('li', {}, [
              el('a', {
                class: 'rowlink',
                href: `/compartments/${item.id}`,
                'data-route': 'true',
                text: item.id,
              }),
              ' ',
              el('span', { text: item.name }),
              ' ',
              el('span', {
                class: 'mono',
                text: `${item.exhibit_count} exhibits, ${item.quarantine_count} in quarantine`,
              }),
            ]),
        });
      }
    }

    await refresh();
    return { refresh };
  },
};

function buildCreate(status) {
  const button = el('button', {
    type: 'button',
    text: 'New compartment',
    on: { click: open },
  });
  function open() {
    const name = el('input', { type: 'text', 'aria-label': 'Compartment name' });
    const handle = openDialog({
      label: 'New compartment',
      opener: button,
      build: (node) => {
        node.append(
          el('label', { text: 'Compartment name' }),
          name,
          el('button', {
            type: 'button',
            text: 'Create compartment',
            on: {
              click: async () => {
                const reply = await post('/api/compartments', { name: name.value });
                if (reply.status !== 201) {
                  setStatus(status, COPY.noLonger, true);
                  return;
                }
                handle.close();
                await loadCompartments();
                go(`/compartments/${reply.body.id}`);
              },
            },
          })
        );
      },
    });
    handle.unsavedWork = () => name.value.trim() !== '';
    setTimeout(() => name.focus(), 0);
  }
  return el('div', {}, [button]);
}

function buildBreakGlass(status) {
  const reference = el('input', {
    type: 'text',
    id: 'bg-reference',
    'aria-label': 'Compartment reference',
  });
  const reason = el('textarea', {
    id: 'bg-reason',
    rows: 3,
    'aria-label': 'Break-glass reason',
  });
  const error = el('p', { class: 'field-error', hidden: true });
  const button = el('button', {
    type: 'button',
    text: 'Open break-glass',
    on: { click: open },
  });

  async function open() {
    error.hidden = true;
    setStatus(status, 'Opening break-glass.');
    const reply = await privileged({
      opener: button,
      needsReason: false,
      run: (proof) =>
        post(
          `/api/compartments/${encodeURIComponent(reference.value.trim())}/break-glass`,
          { reason: reason.value },
          { proof }
        ),
    });
    if (!reply) {
      setStatus(status, '');
      return;
    }
    if (reply.status === 201) {
      setStatus(
        status,
        decisionCopy(
          `Break-glass open until ${hourMinute(reply.body.ends_at)}.`,
          'Owner notice queued.',
          reply
        )
      );
      await loadCompartments();
      return;
    }
    if (reply.status === 422 && reply.body.errors && reply.body.errors.reason) {
      error.textContent = reply.body.errors.reason;
      error.hidden = false;
      reason.setAttribute('aria-invalid', 'true');
      setStatus(status, reply.body.errors.reason, true);
      reason.focus();
      return;
    }
    const code = errorCode(reply);
    setStatus(status, code === 'not_found' ? COPY.notFound : COPY.noLonger, true);
  }

  return el('div', {}, [
    el('h2', { text: 'Break-glass' }),
    el('label', { for: 'bg-reference', text: 'Compartment reference' }),
    reference,
    el('label', { for: 'bg-reason', text: 'Break-glass reason' }),
    reason,
    error,
    button,
  ]);
}

/** The compartment docket, rendered into any pane. */
export function mountDocket(node, compartmentId, context, options = {}) {
  const status = context.status;
  clear(node);
  const owns = options.figure !== false;
  const figure = el('span', {
    class: owns ? null : 'mono',
    dataset: owns ? { figure: 'true' } : {},
    text: '0',
  });
  const label = el('span', {
    class: owns ? null : 'mono',
    dataset: owns ? { figureLabel: 'true' } : {},
    text: 'Exhibits',
  });
  const heading = el('h1', { text: compartmentId });
  const totals = el('p', {
    role: 'status',
    'aria-label': 'Compartment totals',
    'aria-live': 'polite',
  });
  const breakGlassTime = el('p', {
    role: 'status',
    'aria-label': 'Break-glass time',
    class: 'mono',
    hidden: true,
  });
  const exhibits = table('Exhibits', ['Exhibit', 'Name', 'State', 'Marks']);
  const releases = table('Releases', ['Release', 'Name', 'State', 'Bytes']);
  const access = table('Access list', ['Person', 'Scope', 'State', 'Lapse', 'Actions']);
  const accessWrap = el('div', { hidden: true }, [access.node]);
  const controls = el('div');
  const ownsEndedAlert = options.endedAlert !== false;
  const ended = el('div', {
    role: 'alert',
    'aria-label': 'Access ended',
    hidden: true,
    text: COPY.accessEnded,
  });
  const content = el('div', {}, [
    figure,
    label,
    heading,
    totals,
    breakGlassTime,
    controls,
    exhibits.node,
    releases.node,
    accessWrap,
  ]);
  node.append(content);
  if (ownsEndedAlert) node.append(ended);

  let compartment = null;
  let people = [];
  let dead = false;
  let firstLoad = true;

  async function loadPeople() {
    if (state.user.role !== 'case_lead' || people.length) return;
    const reply = await get('/api/directory', { background: true });
    if (reply.status === 200) people = reply.body.people;
  }

  function finish() {
    dead = true;
    clear(content);
    content.hidden = true;
    closeAllDialogs();
    if (ownsEndedAlert) {
      ended.hidden = false;
      takeFocus(ended);
    }
    if (options.onAccessEnded) options.onAccessEnded();
  }

  async function refresh(background = true) {
    if (dead) return null;
    const reply = await get(`/api/compartments/${encodeURIComponent(compartmentId)}`, {
      background,
    });
    if (reply.status === 404) {
      if (firstLoad) {
        notFoundPage(node);
        dead = true;
        return null;
      }
      finish();
      return null;
    }
    if (reply.status !== 200) return null;
    firstLoad = false;
    compartment = reply.body;
    figure.textContent = String(compartment.exhibit_count);
    heading.textContent = compartment.name;
    clear(totals);
    totals.append(
      el('span', {
        class: 'mono',
        dataset: { quarantineCount: String(compartment.quarantine_count) },
        text: String(compartment.quarantine_count),
      }),
      ' in quarantine. ',
      el('span', {
        class: 'mono',
        dataset: { releaseBytes: String(compartment.release_bytes) },
        text: String(compartment.release_bytes),
      }),
      ' bytes in releases.'
    );
    const breaking = state.breakGlass.find((item) => item.compartment_id === compartment.id);
    breakGlassTime.hidden = !breaking;
    if (breaking) {
      breakGlassTime.textContent = `Break-glass ends at ${hourMinute(breaking.ends_at)}.`;
    }
    await loadPeople();
    renderControls();
    await refreshExhibits(background);
    await refreshReleases(background);
    renderAccess();
    if (options.onCompartment) options.onCompartment(compartment);
    return compartment;
  }

  function renderControls() {
    clear(controls);
    const isLead = state.user.role === 'case_lead' && compartment.caller_scope === 'full';
    if (isLead) {
      const issue = el('button', {
        type: 'button',
        text: 'Issue grant',
        on: { click: () => grantDialog(issue, null) },
      });
      controls.append(issue);
    }
    if (['case_lead', 'investigator'].includes(state.user.role)) {
      const release = el('button', {
        type: 'button',
        text: 'New release',
        on: { click: () => releaseDialog(release) },
      });
      controls.append(release);
    }
  }

  async function refreshExhibits(background) {
    const reply = await get(
      `/api/compartments/${encodeURIComponent(compartmentId)}/exhibits`,
      { background }
    );
    if (reply.status !== 200) return;
    syncRows(exhibits.body, reply.body.exhibits, {
      key: (item) => item.id,
      signature: (item) =>
        `${item.state}|${item.marks_version}|${item.holds.length}|${item.seal_check}`,
      build: (item) =>
        el('tr', {}, [
          el('td', { class: 'mono' }, [
            el('a', {
              class: 'rowlink',
              href: `/exhibits/${item.id}`,
              'data-route': 'true',
              text: item.id,
            }),
          ]),
          el('td', { text: item.name }),
          el('td', { class: 'mono' }, [
            el('span', { text: item.state }),
            item.state === 'held' ? ' ' : null,
            item.state === 'held' ? heldMarker() : null,
          ]),
          el('td', { class: 'mono', text: String(item.marks_version) }),
        ]),
    });
  }

  async function refreshReleases(background) {
    const reply = await get(
      `/api/compartments/${encodeURIComponent(compartmentId)}/releases`,
      { background }
    );
    if (reply.status !== 200) return;
    syncRows(releases.body, reply.body.releases, {
      key: (item) => item.id,
      signature: (item) => `${item.state}|${item.total_bytes}|${item.items.length}`,
      build: (item) =>
        el('tr', {}, [
          el('td', { class: 'mono' }, [
            el('a', {
              class: 'rowlink',
              href: `/releases/${item.id}`,
              'data-route': 'true',
              text: item.id,
            }),
          ]),
          el('td', { text: item.name }),
          el('td', { class: 'mono', text: item.state }),
          el('td', { class: 'mono', text: String(item.total_bytes) }),
        ]),
    });
  }

  function renderAccess() {
    const shown = Array.isArray(compartment.access);
    accessWrap.hidden = !shown;
    if (!shown) return;
    syncRows(access.body, compartment.access, {
      key: (grant) => grant.id,
      signature: (grant) => `${grant.scope}|${grant.state}|${grant.expires_at}|${grant.kind}`,
      build: (grant) => buildGrantRow(grant),
      onVanished: (row, body) =>
        moveFocusAfterRemoval(row, body, 'button'),
    });
  }

  function personName(id) {
    const found = people.find((person) => person.id === id);
    return found ? found.name : id;
  }

  function buildGrantRow(grant) {
    const name = personName(grant.user_id);
    const actions = el('td');
    if (grant.state === 'active' && grant.kind === 'grant') {
      const edit = el('button', {
        type: 'button',
        text: `Edit grant for ${name}`,
        on: { click: () => grantDialog(edit, grant) },
      });
      const revoke = el('button', {
        type: 'button',
        text: `Revoke grant for ${name}`,
        on: { click: () => revokeGrant(revoke, grant) },
      });
      const sessions = el('button', {
        type: 'button',
        text: `End sessions for ${name}`,
        on: { click: () => endSessions(sessions, grant) },
      });
      actions.append(edit, revoke, sessions);
    }
    return el('tr', {}, [
      el('td', { class: 'mono' }, [
        el('span', { text: name }),
        ' ',
        el('span', { class: 'mono', text: grant.user_id }),
      ]),
      el('td', { class: 'mono', text: SCOPE_WORDS[grant.scope] || grant.scope }),
      el('td', { class: 'mono', text: grant.state }),
      el('td', { class: 'mono', text: lapseText(grant.expires_at) }),
      actions,
    ]);
  }

  function grantDialog(opener, grant) {
    let version = compartment.access_version;
    const person = el('select', { 'aria-label': 'Person' });
    for (const item of people) {
      person.append(el('option', { value: item.id, text: item.name }));
    }
    const scope = el('select', { 'aria-label': 'Scope' }, [
      el('option', { value: 'full', text: 'Full' }),
      el('option', { value: 'derivatives', text: 'Derivatives only' }),
    ]);
    if (grant) scope.value = grant.scope;
    const lapses = el('input', {
      type: 'text',
      'aria-label': 'Lapses at',
      value: grant && grant.expires_at ? grant.expires_at : '',
      autocomplete: 'off',
    });
    const lapseError = el('p', { class: 'field-error', hidden: true });
    const save = el('button', {
      type: 'button',
      text: 'Save grant',
      on: { click: submit },
    });
    const handle = openDialog({
      label: grant ? 'Edit grant' : 'Issue grant',
      opener,
      build: (node2) => {
        if (!grant) {
          node2.append(el('label', { text: 'Person' }), person);
        }
        node2.append(
          el('label', { text: 'Scope' }),
          scope,
          el('label', { text: 'Lapses at' }),
          lapses,
          lapseError,
          save
        );
      },
    });
    handle.unsavedWork = () => true;
    setTimeout(() => (grant ? scope : person).focus(), 0);

    async function submit() {
      lapseError.hidden = true;
      setStatus(status, 'Saving grant.');
      const body = {
        scope: scope.value,
        expires_at: lapses.value.trim() === '' ? null : lapses.value.trim(),
        access_version: version,
      };
      if (!grant) body.user_id = person.value;
      const reply = await privileged({
        opener: save,
        needsReason: false,
        run: (proof) =>
          grant
            ? patch(`/api/grants/${grant.id}`, body, { proof })
            : post(
                `/api/compartments/${encodeURIComponent(compartmentId)}/grants`,
                body,
                { proof }
              ),
      });
      if (!reply) {
        setStatus(status, '');
        return;
      }
      if (reply.status === 200 || reply.status === 201) {
        handle.close(true);
        setStatus(status, 'Grant saved.');
        await refresh(false);
        return;
      }
      const code = errorCode(reply);
      if (code === 'stale_access_list') {
        version = reply.body.access_version;
        setStatus(status, COPY.staleAccess, true);
        save.focus();
        return;
      }
      if (code === 'last_case_lead') {
        setStatus(status, COPY.lastLead, true);
        save.focus();
        return;
      }
      if (reply.status === 422 && reply.body.errors) {
        const copy = reply.body.errors.expires_at;
        if (copy) {
          lapseError.textContent = copy;
          lapseError.hidden = false;
          lapses.setAttribute('aria-invalid', 'true');
          setStatus(status, copy, true);
          lapses.focus();
          return;
        }
        setStatus(status, Object.values(reply.body.errors)[0], true);
        return;
      }
      setStatus(status, COPY.noLonger, true);
    }
  }

  async function revokeGrant(opener, grant) {
    setStatus(status, 'Revoking.');
    const reply = await privileged({
      opener,
      needsReason: false,
      run: (proof) => post(`/api/grants/${grant.id}/revoke`, {}, { proof }),
    });
    if (!reply) {
      setStatus(status, '');
      return;
    }
    if (reply.status === 200) {
      setStatus(status, 'Grant revoked.');
      await refresh(false);
      return;
    }
    const code = errorCode(reply);
    setStatus(
      status,
      code === 'last_case_lead'
        ? COPY.lastLead
        : code === 'stale_access_list'
        ? COPY.staleAccess
        : COPY.noLonger,
      true
    );
  }

  async function endSessions(opener, grant) {
    setStatus(status, 'Ending sessions.');
    const reply = await privileged({
      opener,
      needsReason: false,
      run: (proof) => post(`/api/users/${grant.user_id}/sessions/revoke`, {}, { proof }),
    });
    if (!reply) {
      setStatus(status, '');
      return;
    }
    setStatus(
      status,
      reply.status === 200 ? 'Sessions ended.' : COPY.noLonger,
      reply.status !== 200
    );
  }

  function releaseDialog(opener) {
    const name = el('input', { type: 'text', 'aria-label': 'Release name' });
    const matter = el('input', { type: 'text', 'aria-label': 'Matter reference' });
    const matterError = el('p', { class: 'field-error', hidden: true });
    const recipient = el('select', { 'aria-label': 'Recipient' }, [
      el('option', { value: 'counsel', text: 'Outside counsel' }),
      el('option', { value: 'requester', text: 'Requester' }),
    ]);
    const handle = openDialog({
      label: 'New release',
      opener,
      build: (node2) => {
        node2.append(
          el('label', { text: 'Release name' }),
          name,
          el('label', { text: 'Matter reference' }),
          matter,
          matterError,
          el('label', { text: 'Recipient' }),
          recipient,
          el('button', {
            type: 'button',
            text: 'Create release',
            on: { click: submit },
          })
        );
      },
    });
    handle.unsavedWork = () => name.value.trim() !== '' || matter.value.trim() !== '';
    setTimeout(() => name.focus(), 0);

    async function submit() {
      matterError.hidden = true;
      const reply = await post(
        `/api/compartments/${encodeURIComponent(compartmentId)}/releases`,
        {
          name: name.value,
          matter_ref: matter.value,
          recipient_kind: recipient.value,
        }
      );
      if (reply.status === 201) {
        handle.close(true);
        go(`/releases/${reply.body.id}`);
        return;
      }
      if (reply.status === 422 && reply.body.errors) {
        if (reply.body.errors.matter_ref) {
          matterError.textContent = reply.body.errors.matter_ref;
          matterError.hidden = false;
          matter.focus();
        }
        setStatus(status, Object.values(reply.body.errors)[0], true);
        return;
      }
      setStatus(status, COPY.noLonger, true);
    }
  }

  return { refresh, compartment: () => compartment, isDead: () => dead };
}

export const compartment = {
  async mount(context) {
    const id = context.params[0];
    const docket = mountDocket(context.docket, id, context);
    context.inspector.append(el('p', { text: COPY.noRecord }));
    await docket.refresh(false);
    return { refresh: () => docket.refresh(true) };
  },
};
