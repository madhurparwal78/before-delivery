/* The public mod log table and the moderator tools page. */
import { api, announce, copy, el, Live, type Me, ApiFailure } from '../lib.js';
import { actionLabel, type Community, type ModLogEntry } from '../ui.js';
import { targetText } from './community.js';
import { formatTime } from './community.js';

export async function renderModLogPage(frame: HTMLElement, me: Me | null, path: string): Promise<void> {
  const name = path.split('/')[2] ?? '';
  const feedCol = el('main', { class: 'feed' });
  frame.append(feedCol);

  let community: Community;
  try {
    community = await api<Community>(`/api/communities/${name}`);
  } catch {
    feedCol.append(el('p', { class: 'empty' }, 'This community does not exist.'));
    return;
  }
  const isModerator = me !== null && community.viewer.isModerator;
  const showModNames = community.showModNames;

  const loadMoreWrap = el('div', {});
  const tableWrap = el('div', { class: 'table-wrap' });
  feedCol.append(
    el('header', { class: 'post-head' }, el('h1', {}, `Moderation log — c/${community.name}`)),
    tableWrap,
    loadMoreWrap,
  );

  const entries: ModLogEntry[] = [];

  async function loadPage(cursor: string | null): Promise<void> {
    const page = await api<{ items: ModLogEntry[]; nextCursor: string | null }>(`/api/communities/${community.name}/modlog${cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`}`);
    entries.push(...page.items);
    renderTable();
    loadMoreWrap.replaceChildren();
    if (page.nextCursor !== null) {
      const more = el('button', { class: 'btn', type: 'button' }, 'Load more entries');
      more.addEventListener('click', () => { void loadPage(page.nextCursor); });
      loadMoreWrap.append(more);
    }
  }

  function renderTable(): void {
    const table = el('table', { class: 'log-table', 'aria-label': 'Moderation log' });
    const headRow = el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'Action'), el('th', {}, 'Target'), el('th', {}, 'Reason'));
    if (showModNames || isModerator) headRow.append(el('th', {}, 'Moderator'));
    if (isModerator) headRow.append(el('th', {}, 'Private note'));
    table.append(el('thead', {}, headRow));
    const body = el('tbody', {});
    for (const entry of entries) {
      const row = el('tr', { id: `modlog-${entry.id}` },
        el('td', { class: 'time' }, formatTime(entry.at)),
        el('td', {}, actionLabel(entry.action)),
        el('td', {}, targetText(entry)),
        el('td', {}, entry.publicReason ?? ''),
      );
      if (showModNames || isModerator) row.append(el('td', {}, entry.moderator !== null ? `u/${entry.moderator.username}` : ''));
      if (isModerator) row.append(el('td', {}, entry.privateNote ?? ''));
      body.append(row);
    }
    table.append(body);
    tableWrap.replaceChildren(table);
  }

  await loadPage(null);
}

/* --- Moderator tools --- */

export async function renderModToolsPage(frame: HTMLElement, me: Me | null, path: string, live: Live): Promise<void> {
  const name = path.split('/')[2] ?? '';
  const feedCol = el('main', { class: 'feed' });
  frame.append(feedCol);

  if (me === null) {
    feedCol.append(el('p', { class: 'empty' }, el('a', { href: '/login' }, 'Sign in'), ' to use moderator tools.'));
    return;
  }
  let community: Community;
  try {
    community = await api<Community>(`/api/communities/${name}`);
  } catch {
    feedCol.append(el('p', { class: 'empty' }, 'This community does not exist.'));
    return;
  }
  if (!community.viewer.isModerator) {
    feedCol.append(el('p', { class: 'empty' }, 'These tools are for the moderators of this community.'));
    return;
  }
  // The two-factor gate: a moderator endpoint answers TOTP_REQUIRED until
  // two-factor is on, which routes to setup.
  try {
    await api(`/api/communities/${community.name}/moderators`);
  } catch (e) {
    if (e instanceof ApiFailure && e.code === 'TOTP_REQUIRED') {
      window.location.href = `/settings/2fa?next=${encodeURIComponent(path)}`;
      return;
    }
  }

  const tabsWrap = el('div', {});
  const panel = el('section', { class: 'panel' });
  feedCol.append(
    el('header', { class: 'post-head' }, el('h1', {}, `Moderator tools — c/${community.name}`)),
    tabsWrap,
    panel,
  );

  let active: 'moderators' | 'approved' | 'rules' | 'settings' = 'moderators';
  const renderTabs = (): void => {
    const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Moderator tools' });
    const names: [typeof active, string][] = [['moderators', 'Moderators'], ['approved', 'Approved posters'], ['rules', 'Rules'], ['settings', 'Settings']];
    for (const [value, label] of names) {
      const b = el('button', { class: 'tab', role: 'tab', type: 'button', 'aria-selected': active === value ? 'true' : 'false' }, label);
      b.addEventListener('click', () => { active = value; renderTabs(); renderPanel(); });
      b.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const idx = names.findIndex(([v]) => v === active);
        const nextIdx = e.key === 'ArrowRight' ? (idx + 1) % names.length : (idx + names.length - 1) % names.length;
        active = (names[nextIdx] as [typeof active, string])[0];
        renderTabs();
        renderPanel();
      });
      tabs.append(b);
    }
    tabsWrap.replaceChildren(tabs);
  };

  const renderPanel = (): void => {
    if (active === 'moderators') renderModerators();
    else if (active === 'approved') renderApproved();
    else if (active === 'rules') renderRules();
    else renderSettings();
  };

  async function renderModerators(): Promise<void> {
    panel.replaceChildren(el('p', {}, 'Loading...'));
    try {
      const mods = await api<{ items: { username: string; isOwner: boolean }[] }>(`/api/communities/${community.name}/moderators`);
      panel.replaceChildren(el('h2', {}, 'Moderators'));
      for (const m of mods.items) {
        const row = el('p', {}, `u/${m.username}${m.isOwner ? ' (owner)' : ''}`);
        if (community.viewer.isOwner && !m.isOwner) {
          const remove = el('button', { class: 'btn', type: 'button', 'aria-label': `Remove ${m.username} as moderator` }, 'Remove');
          remove.addEventListener('click', () => {
            void (async () => {
              try {
                await api(`/api/communities/${community.name}/moderators/${m.username}`, { method: 'DELETE' });
                announce('Moderator removed');
                renderModerators();
              } catch { /* conflict */ }
            })();
          });
          row.append(' ', remove);
        }
        panel.append(row);
      }
      if (community.viewer.isOwner) {
        const input = el('input', { class: 'input', type: 'text', 'aria-label': 'Username', placeholder: 'Username' });
        const add = el('button', { class: 'btn primary', type: 'button' }, 'Add moderator');
        add.addEventListener('click', () => {
          void (async () => {
            try {
              await api(`/api/communities/${community.name}/moderators`, { method: 'POST', body: JSON.stringify({ username: input.value.trim() }) });
              input.value = '';
              renderModerators();
            } catch (e) {
              if (e instanceof ApiFailure) announce(e.message, true);
            }
          })();
        });
        panel.append(el('div', { class: 'card-meta' }, input, add));
      }
    } catch (e) {
      panel.replaceChildren(el('p', {}, 'Could not load moderators.'));
      if (e instanceof ApiFailure && e.code === 'TOTP_REQUIRED') {
        window.location.href = `/settings/2fa?next=${encodeURIComponent(path)}`;
      }
    }
  }

  async function renderApproved(): Promise<void> {
    panel.replaceChildren(el('p', {}, 'Loading...'));
    try {
      const approved = await api<{ items: { username: string }[] }>(`/api/communities/${community.name}/approved`);
      panel.replaceChildren(el('h2', {}, 'Approved posters'));
      for (const a of approved.items) {
        const remove = el('button', { class: 'btn', type: 'button', 'aria-label': `Remove approval for ${a.username}` }, 'Remove');
        remove.addEventListener('click', () => {
          void (async () => {
            await api(`/api/communities/${community.name}/approved/${a.username}`, { method: 'DELETE' });
            renderApproved();
          })();
        });
        panel.append(el('p', {}, `u/${a.username}`, ' ', remove));
      }
      const input = el('input', { class: 'input', type: 'text', 'aria-label': 'Username', placeholder: 'Username' });
      const approve = el('button', { class: 'btn primary', type: 'button' }, 'Approve');
      approve.addEventListener('click', () => {
        void (async () => {
          try {
            await api(`/api/communities/${community.name}/approved/${input.value.trim()}`, { method: 'PUT' });
            input.value = '';
            renderApproved();
          } catch (e) {
            if (e instanceof ApiFailure) announce(e.message, true);
          }
        })();
      });
      panel.append(el('div', { class: 'card-meta' }, input, approve));
    } catch {
      panel.replaceChildren(el('p', {}, 'Could not load approved posters.'));
    }
  }

  async function renderRules(): Promise<void> {
    panel.replaceChildren(el('h2', {}, 'Rules'));
    const rows: { title: HTMLInputElement; description: HTMLInputElement }[] = [];
    const list = el('div', {});
    const addRow = (title = '', description = ''): void => {
      const t = el('input', { class: 'input', type: 'text', value: title, 'aria-label': 'Rule title' });
      const d = el('input', { class: 'input', type: 'text', value: description, 'aria-label': 'Rule description' });
      rows.push({ title: t, description: d });
      list.append(el('div', { class: 'field' }, t, d));
    };
    for (const r of community.rules) addRow(r.title, r.description);
    if (rows.length === 0) addRow();
    const add = el('button', { class: 'btn', type: 'button' }, 'Add rule');
    add.addEventListener('click', () => addRow());
    const save = el('button', { class: 'btn primary', type: 'button' }, 'Save rules');
    save.addEventListener('click', () => {
      void (async () => {
        const rules = rows.map((r) => ({ title: r.title.value.trim(), description: r.description.value })).filter((r) => r.title !== '');
        try {
          await api(`/api/communities/${community.name}/rules`, { method: 'PUT', body: JSON.stringify({ rules }) });
          announce('Rules updated');
          community = await api<Community>(`/api/communities/${community.name}`);
          renderRules();
        } catch (e) {
          if (e instanceof ApiFailure) announce(e.message, true);
        }
      })();
    });
    panel.append(list, el('div', { class: 'dialog-actions' }, add, save));
  }

  async function renderSettings(): Promise<void> {
    panel.replaceChildren(el('h2', {}, 'Settings'));
    const box = el('input', { type: 'checkbox', id: 'show-mod-names' });
    box.checked = community.showModNames;
    const save = el('button', { class: 'btn primary', type: 'button' }, 'Save settings');
    save.addEventListener('click', () => {
      void (async () => {
        await api(`/api/communities/${community.name}`, { method: 'PATCH', body: JSON.stringify({ showModNames: box.checked }) });
        community = await api<Community>(`/api/communities/${community.name}`);
        announce('Settings updated');
      })();
    });
    panel.append(
      el('label', { class: 'checkbox-row', for: 'show-mod-names' }, box, 'Show moderator names in the public log'),
      el('div', { class: 'dialog-actions' }, save),
    );
  }

  renderTabs();
  await renderPanel();

  // Live: a revoked moderator role removes the tools within 3 seconds.
  live.subscribe([], (event) => {
    if (event.event !== 'account') return;
    const data = event.data as { kind: string };
    if (data.kind === 'moderator-removed') {
      announce(copy.moderatorRemoved);
      window.setTimeout(() => window.location.reload(), 3000);
    }
  });
}
