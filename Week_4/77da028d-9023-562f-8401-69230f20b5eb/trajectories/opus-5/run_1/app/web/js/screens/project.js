import { api } from '../api.js';
import { announce, clear, el, spinbutton, textbox } from '../dom.js';
import { close, openDialog } from '../dialog.js';
import { duration, siteStamp } from '../format.js';

const FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII'];
const TRANSITIONS = [
  ['Activate', 'active', ['draft']],
  ['Pause', 'paused', ['active']],
  ['Resume', 'active', ['paused']],
  ['Mark complete', 'complete', ['active']],
  ['Archive', 'archived', ['draft', 'complete']],
];

export async function renderProject(main, context, projectId) {
  const heading = el('h1', {});
  const stateRow = el('div', { class: 'dialog-actions' });
  const owedTable = el('table', { 'aria-label': 'Hours owed' });
  const totalRegion = el('section', { 'aria-label': 'Total integration' });
  const updates = el('div', { role: 'status', 'aria-label': 'Project updates' });
  const addFilter = el('select', { 'aria-label': 'Add filter' });
  const shareButton = el('button', { type: 'button', text: 'Share' });
  const ledgerButton = el('button', { type: 'button', text: 'Show ledger' });
  let project = null;

  main.append(
    el('div', { class: 'stack' }, [
      heading,
      context.card,
      stateRow,
      el('div', { class: 'two-up' }, [
        el('div', { class: 'table-sheet' }, [owedTable, addFilter]),
        totalRegion,
      ]),
      el('div', { class: 'dialog-actions' }, [shareButton, ledgerButton]),
      updates,
    ]),
  );

  function paintStates() {
    clear(stateRow);
    for (const [label, to, from] of TRANSITIONS) {
      if (!from.includes(project.state)) continue;
      stateRow.append(
        el('button', {
          type: 'button',
          text: label,
          onclick: async () => {
            try {
              project = await api('POST', `/api/projects/${projectId}/transition`, { to });
              paint();
              announce(updates, `Project is now ${project.state}.`);
            } catch (error) {
              announce(updates, error.message);
            }
          },
        }),
      );
    }
  }

  function paintOwed() {
    clear(owedTable);
    owedTable.append(
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Filter' }),
          el('th', { text: 'Planned' }),
          el('th', { text: 'Logged' }),
          el('th', { text: 'Owed' }),
        ]),
      ]),
    );
    const body = el('tbody', {});
    for (const entry of project.filters) {
      const planned = spinbutton(`Planned minutes ${entry.filter}`, {
        min: '0',
        max: '60000',
        step: '1',
        value: String(Math.round(entry.planned_seconds / 60)),
      });
      planned.addEventListener('change', async () => {
        try {
          project = await api(
            'PUT',
            `/api/projects/${projectId}/allotments/${entry.filter}`,
            { planned_seconds: Number(planned.value) * 60 },
          );
          const updated = project.filters.find((item) => item.filter === entry.filter);
          paint();
          announce(
            updates,
            `Planned ${entry.filter} set to ${duration(
              updated.planned_seconds,
            )}. Owed now ${duration(updated.owed_seconds)}.`,
          );
        } catch (error) {
          announce(updates, error.message);
        }
      });
      body.append(
        el('tr', {}, [
          el('td', { text: entry.filter }),
          el('td', {}, [planned]),
          el('td', { class: 'num', text: duration(entry.logged_seconds) }),
          el('td', { class: 'num', text: duration(entry.owed_seconds) }),
        ]),
      );
    }
    owedTable.append(body);

    clear(addFilter);
    const used = new Set(project.filters.map((entry) => entry.filter));
    addFilter.append(el('option', { value: '', text: 'Add filter' }));
    for (const filter of FILTERS) {
      if (used.has(filter)) continue;
      addFilter.append(el('option', { value: filter, text: filter }));
    }
  }

  addFilter.addEventListener('change', async () => {
    if (!addFilter.value) return;
    const filter = addFilter.value;
    try {
      project = await api('PUT', `/api/projects/${projectId}/allotments/${filter}`, {
        planned_seconds: 3600,
      });
      const updated = project.filters.find((item) => item.filter === filter);
      paint();
      announce(
        updates,
        `Planned ${filter} set to ${duration(
          updated.planned_seconds,
        )}. Owed now ${duration(updated.owed_seconds)}.`,
      );
    } catch (error) {
      announce(updates, error.message);
    }
  });

  function paint() {
    heading.textContent = project.name;
    paintStates();
    paintOwed();
    clear(totalRegion).append(
      el('p', {
        class: 'num',
        text: `${duration(project.total_integration_seconds)} total`,
      }),
      el('p', { class: 'muted', text: `${project.session_count} sessions` }),
    );
  }

  ledgerButton.addEventListener('click', async () => {
    const { entries } = await api('GET', `/api/projects/${projectId}/ledger`);
    const table = el('table', { 'aria-label': 'Ledger' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Movement' }),
          el('th', { text: 'Kind' }),
          el('th', { text: 'Filter' }),
          el('th', { text: 'Account' }),
          el('th', { text: 'Seconds' }),
          el('th', { text: 'Time' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        entries.map((entry) =>
          el('tr', {}, [
            el('td', { text: entry.movement_id }),
            el('td', { text: entry.movement_kind }),
            el('td', { text: entry.filter }),
            el('td', { text: entry.account }),
            el('td', { class: 'num', text: String(entry.seconds) }),
            el('td', { class: 'num', text: entry.created_at }),
          ]),
        ),
      ),
    ]);
    const sheet = openDialog({
      name: 'Ledger',
      sheet: true,
      body: [
        el('h2', { text: 'Ledger' }),
        el('div', { class: 'table-sheet' }, [table]),
        el('div', { class: 'dialog-actions' }, [
          el('button', { type: 'button', text: 'Close', onclick: () => close(sheet) }),
        ]),
      ],
    });
  });

  shareButton.addEventListener('click', async () => {
    const site = await api('GET', '/api/site');
    const linkBox = textbox('Share link', { id: 'share-link', readonly: true });
    const expiresBox = textbox('Link expires', {
      id: 'share-expires',
      placeholder: 'YYYY-MM-DD HH:MM',
    });
    const result = el('p', { class: 'field-error' });

    function show(link) {
      linkBox.value = link ? `${location.origin}${link.url}` : '';
      if (link && link.expires_at) {
        expiresBox.value = siteStamp(link.expires_at, site.time_zone);
      }
    }

    try {
      show(await api('GET', `/api/projects/${projectId}/share`));
    } catch (_) {
      show(null);
    }

    function expiresPayload() {
      const raw = expiresBox.value.trim();
      if (!raw) return null;
      return new Date(`${raw.replace(' ', 'T')}:00`).toISOString();
    }

    async function act(kind, announcement) {
      try {
        if (kind === 'revoke') {
          await api('DELETE', `/api/projects/${projectId}/share`);
          show(null);
        } else {
          show(
            await api('POST', `/api/projects/${projectId}/share`, {
              expires_at: expiresPayload(),
            }),
          );
        }
        result.textContent = '';
        announce(updates, announcement);
      } catch (error) {
        result.textContent = error.message;
        announce(updates, error.message);
      }
    }

    const dialog = openDialog({
      name: 'Share project',
      body: [
        el('h2', { text: 'Share project' }),
        el('div', { class: 'form-grid' }, [
          el('div', { class: 'field' }, [
            el('label', { for: 'share-link', text: 'Share link' }),
            linkBox,
          ]),
          el('div', { class: 'field' }, [
            el('label', { for: 'share-expires', text: 'Link expires' }),
            expiresBox,
          ]),
        ]),
        result,
        el('div', { class: 'dialog-actions' }, [
          el('button', {
            type: 'button',
            class: 'pill',
            text: 'Create link',
            onclick: () => act('create', 'Share link ready.'),
          }),
          el('button', {
            type: 'button',
            text: 'Copy link',
            onclick: () => {
              linkBox.select();
              if (navigator.clipboard) navigator.clipboard.writeText(linkBox.value);
            },
          }),
          el('button', {
            type: 'button',
            text: 'Regenerate link',
            onclick: () =>
              act('create', 'New share link ready. The old link no longer works.'),
          }),
          el('button', {
            type: 'button',
            text: 'Revoke link',
            onclick: () => act('revoke', 'Share link revoked.'),
          }),
          el('button', { type: 'button', text: 'Close', onclick: () => close(dialog) }),
        ]),
      ],
    });
  });

  project = await api('GET', `/api/projects/${projectId}`);
  paint();
}
