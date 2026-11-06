// The regulator's monthly files, partner keys, members and the directory
// listing.
import { h, inputText, selectEl } from './dom.js';
import { api } from './api.js';
import { openDialog, type PanelHandle } from './panels.js';
import { problemsRegion, fieldErrorsClear } from './feedback.js';
import { staffView, h1 } from './staff-frame.js';
import { getSession, registerDialogOpener } from './state.js';
import { fieldWrap, handleAuth } from './screens-cases.js';
import { triggerDownload } from './screens-review.js';
import { formatStamp, formatMonthLabel } from './format.js';

// ---------- Regulator's monthly files ----------

export async function renderFiles(root: HTMLElement, slug: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk, ws } = view;
  const res = await api<{ months: { month: string; cases: number }[] }>('GET', `/api/w/${slug}/files`);
  if (res.status === 401) { handleAuth(res.error?.code ?? '', desk, 'none', {}); return; }
  const months = res.body?.months ?? [];
  const latestEnded = months.length > 1 ? months[months.length - 2].month : months[0]?.month ?? ws.today.slice(0, 7);

  const state = h('p', { class: 'hint state-text' }, 'Choose a month and download its file.');
  let selected = latestEnded;

  const monthSelect = selectEl({ id: 'month', 'aria-label': 'Month', class: 'select' },
    months.map((m) => h('option', { value: m.month }, `${formatMonthLabel(m.month)} (${m.cases} cases)`)));
  monthSelect.value = selected;
  monthSelect.addEventListener('change', () => {
    selected = monthSelect.value;
    state.textContent = 'Choose a month and download its file.';
  });

  async function download(): Promise<void> {
    desk.announce('Preparing file…');
    const response = await fetch(`/api/w/${slug}/files/regulator?month=${selected}`);
    if (response.ok) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const filename = `${slug}-regulator-${selected}.csv`;
      triggerDownload(filename, bytes, 'text/csv');
      desk.announce(`File downloaded: ${filename}.`);
    } else {
      const body = await response.json() as { error: { message: string; fields: Record<string, string> } };
      if (response.status === 401) { handleAuth(body.error.message.includes('access') ? 'access_removed' : 'session_ended', desk, 'none', {}); return; }
      desk.announce(body.error.message, 'error');
      if (Object.keys(body.error.fields).length > 0) state.textContent = Object.values(body.error.fields).join(' ');
    }
  }

  const monthRail = h('div', { class: 'month-rail' }, h('h2', {}, 'Months'), monthSelect);
  const downloadButton = h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Download file', onclick: () => void download() }, 'Download file');
  const panel = h('div', { class: 'download-panel' }, h('h2', {}, 'Download'), downloadButton, state);

  view.work.append(h('div', { class: 'screen-head' }, h1("Regulator's monthly files")), h('div', { class: 'files-layout' }, monthRail, panel));

  const chooseButton = h('button', { type: 'button', class: 'btn choose-month', 'aria-label': 'Choose month', onclick: (e: Event) => {
    let sheetPanel!: PanelHandle;
    sheetPanel = openDialog({
      name: 'Choose month', kind: 'sheet', opener: e.currentTarget as HTMLElement, onClose: () => {},
      build: (dialog) => {
        const monthSelect2 = selectEl({ id: 'month', 'aria-label': 'Month', class: 'select' },
          months.map((m) => h('option', { value: m.month }, `${formatMonthLabel(m.month)} (${m.cases} cases)`)));
        monthSelect2.value = selected;
        dialog.append(h('h2', {}, 'Choose month'), fieldWrap(monthSelect2, 'Month'),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Done', onclick: () => {
              selected = monthSelect2.value;
              monthSelect.value = selected;
              state.textContent = 'Choose a month and download its file.';
              sheetPanel.close();
            } }, 'Done')));
      },
    });
  } }, 'Choose month');
  view.work.append(h('div', { class: 'narrow-only' }, chooseButton));
}

// ---------- Partner keys ----------

interface KeyRow { id: string; label: string; startsWith: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

export async function renderPartnerKeys(root: HTMLElement, slug: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk, ws } = view;
  const tableWrap = h('div', { class: 'table-wrap' });

  const createKeyButton = h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Create key', onclick: (e: Event) => openCreateKey(e.currentTarget as HTMLElement) }, 'Create key');
  view.work.append(h('div', { class: 'screen-head' }, h1('Partner keys'),
    h('div', { class: 'head-actions' }, createKeyButton)),
    tableWrap);

  async function load(): Promise<void> {
    const res = await api<{ keys: KeyRow[] }>('GET', `/api/w/${slug}/partner-keys`);
    if (res.ok && res.body !== null) {
      const keys = res.body.keys;
      const headers = ['Label', 'Key starts', 'Created', 'Last used', 'Status'];
      tableWrap.replaceChildren(h('table', { 'aria-label': 'Partner keys', class: 'table' },
        h('thead', {}, h('tr', {}, headers.map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, keys.map((k) => h('tr', {},
          h('td', {}, k.label),
          h('td', { class: 'mono' }, k.startsWith),
          h('td', { class: 'mono' }, formatStamp(k.createdAt, ws.timeZone, ws.city)),
          h('td', { class: 'mono' }, k.lastUsedAt !== null ? formatStamp(k.lastUsedAt, ws.timeZone, ws.city) : 'Never'),
          h('td', {}, k.revokedAt !== null ? 'Revoked' : 'Active'),
          h('td', {}, k.revokedAt === null
            ? h('button', { type: 'button', class: 'btn', 'aria-label': 'Revoke', onclick: (e: Event) => openRevokeKey(k, e.currentTarget as HTMLElement) }, 'Revoke')
            : ''))))));
      desk.repaint();
    } else if (res.status === 401) {
      handleAuth(res.error?.code ?? '', desk, 'none', {});
    }
  }

  function openCreateKey(opener: HTMLElement, initial: Record<string, string> = {}): void {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Create key', kind: 'dialog', opener, onClose: () => {},
      build: (dialog) => {
        const label = inputText({ id: 'label', 'aria-label': 'Label', class: 'input', value: initial.label ?? '' });
        dialog.append(h('h2', {}, 'Create key'), problemsRegion(), fieldWrap(label, 'Label'),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Create', onclick: async () => {
              desk.announce('Creating…');
              fieldErrorsClear(dialog);
              const res = await api<{ key: KeyRow; secret: string }>('POST', `/api/w/${slug}/partner-keys`, { label: label.value });
              if (res.ok && res.body !== null) {
                desk.announce('Key created. Copy it now: it won\'t be shown again.');
                panel.close();
                openNewKeyDialog(res.body.secret, res.body.key.startsWith, opener);
              } else if (res.error !== null) {
                if (res.status === 401) { handleAuth(res.error.code, desk, 'create-key', { label: label.value }); return; }
                desk.announce(res.error.message, 'error');
                if (Object.keys(res.error.fields).length > 0) desk.inlineErrors(dialog, res.error.fields);
              }
            } }, 'Create'),
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel')));
      },
    });
  }

  function openNewKeyDialog(secret: string, startsWith: string, opener: HTMLElement): void {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'New partner key', kind: 'dialog', opener, onClose: () => {},
      build: (dialog) => {
        const copyButton = h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Copy key', onclick: async () => {
          await navigator.clipboard.writeText(secret).catch(() => {});
          copyButton.textContent = 'Copied';
        } }, 'Copy key');
        dialog.append(h('h2', {}, 'New partner key'),
          h('p', { class: 'mono secret' }, secret),
          h('p', { class: 'hint' }, `Key starts ${startsWith}. Copy it now: it won't be shown again.`),
          h('div', { class: 'dialog-actions' }, copyButton,
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Done', onclick: () => { panel.close(); void load(); } }, 'Done')));
      },
    });
  }

  function openRevokeKey(key: KeyRow, opener: HTMLElement): void {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Revoke key', kind: 'dialog', opener, onClose: () => {},
      build: (dialog) => {
        dialog.append(h('h2', {}, 'Revoke key'),
          h('p', {}, `Revoke ${key.label} (${key.startsWith})? It will stop working at once.`),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel'),
            h('button', { type: 'button', class: 'btn btn-danger', 'aria-label': 'Revoke key', onclick: async () => {
              desk.announce('Revoking…');
              const res = await api('DELETE', `/api/w/${slug}/partner-keys/${key.id}`);
              if (res.ok) {
                desk.announce('Key revoked.');
                panel.close();
                await load();
              } else if (res.error !== null) {
                desk.announce(res.error.message, 'error');
              }
            } }, 'Revoke key')));
      },
    });
  }

  registerDialogOpener('create-key', (values) => {
    openCreateKey(createKeyButton, values);
  });

  await load();
}

// ---------- Members ----------

export async function renderMembers(root: HTMLElement, slug: string): Promise<void> {
  const view = await staffView(root, slug);
  if (view === null) return;
  const { desk, ws } = view;
  const tableWrap = h('div', { class: 'table-wrap' });

  const addMemberButton = h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Add member', onclick: (e: Event) => openAddMember(e.currentTarget as HTMLElement) }, 'Add member');
  view.work.append(h('div', { class: 'screen-head' }, h1('Members'),
    h('div', { class: 'head-actions' }, addMemberButton)),
    tableWrap);

  async function load(): Promise<void> {
    const res = await api<{ members: { id: string; name: string; email: string; role: string; createdAt: string }[] }>('GET', `/api/w/${slug}/members`);
    if (res.ok && res.body !== null) {
      const rows = res.body.members;
      const headers = ['Name', 'Email', 'Role', 'Created'];
      tableWrap.replaceChildren(h('table', { 'aria-label': 'Members', class: 'table' },
        h('thead', {}, h('tr', {}, headers.map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, rows.map((m) => h('tr', {},
          h('td', {}, m.name),
          h('td', {}, m.email),
          h('td', {}, m.role),
          h('td', { class: 'mono' }, formatStamp(m.createdAt, ws.timeZone, ws.city)),
          h('td', {}, m.id !== getSession()?.member.id
            ? h('button', { type: 'button', class: 'btn btn-small', 'aria-label': `Remove ${m.name}`, onclick: async () => {
              desk.announce('Removing…');
              const res = await api('DELETE', `/api/w/${slug}/members/${m.id}`);
              if (res.status === 204) {
                desk.announce('Member removed.');
                await load();
              } else if (res.error !== null) {
                desk.announce(res.error.message, 'error');
              }
            } }, 'Remove') : ''))))));
      desk.repaint();
    } else if (res.status === 401) {
      handleAuth(res.error?.code ?? '', desk, 'none', {});
    }
  }

  function openAddMember(opener: HTMLElement, initial: Record<string, string> = {}): void {
    let panel!: PanelHandle;
    panel = openDialog({
      name: 'Add member', kind: 'dialog', opener, onClose: () => {},
      build: (dialog) => {
        const name = inputText({ id: 'name', 'aria-label': 'Name', class: 'input', value: initial.name ?? '' });
        const email = inputText({ id: 'email', 'aria-label': 'Email', class: 'input', value: initial.email ?? '' });
        const role = selectEl({ id: 'role', 'aria-label': 'Role', class: 'select' }, [
          h('option', { value: 'compliance_analyst' }, 'Compliance analyst'),
          h('option', { value: 'compliance_officer' }, 'Compliance officer'),
          h('option', { value: 'operations_lead' }, 'Operations lead'),
          h('option', { value: 'finance_lead' }, 'Finance lead'),
          h('option', { value: 'support_agent' }, 'Support agent'),
        ]);
        const password = inputText({ id: 'password', 'aria-label': 'Starting password', class: 'input', value: initial.password ?? '' });
        dialog.append(h('h2', {}, 'Add member'), problemsRegion(),
          fieldWrap(name, 'Name'), fieldWrap(email, 'Email'), fieldWrap(role, 'Role'), fieldWrap(password, 'Starting password'),
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Add member', onclick: async () => {
              desk.announce('Saving…');
              fieldErrorsClear(dialog);
              const res = await api('POST', `/api/w/${slug}/members`, {
                name: name.value, email: email.value, role: role.value, password: password.value,
              });
              if (res.ok) {
                desk.announce('Member added.');
                panel.close();
                await load();
              } else if (res.error !== null) {
                if (res.status === 401) { handleAuth(res.error.code, desk, 'add-member', { name: name.value, email: email.value }); return; }
                desk.announce(res.error.message, 'error');
                if (Object.keys(res.error.fields).length > 0) desk.inlineErrors(dialog, res.error.fields);
              }
            } }, 'Add member'),
            h('button', { type: 'button', class: 'btn', 'aria-label': 'Cancel', onclick: () => panel.close() }, 'Cancel')));
      },
    });
  }

  registerDialogOpener('add-member', (values) => {
    openAddMember(addMemberButton, values);
  });

  await load();
}

// ---------- Directory listing ----------

export async function renderListing(root: HTMLElement, slug: string): Promise<void> {
  const staff = await staffView(root, slug);
  if (staff === null) return;
  const view = staff;
  const { desk } = view;
  const state = h('p', { class: 'hint' }, '');
  view.work.append(h('div', { class: 'screen-head' }, h1('Directory listing')));
  async function load(): Promise<void> {
    const res = await api<{ listing: { slug: string; listed: boolean } }>('GET', `/api/w/${slug}/listing`);
    if (res.ok && res.body !== null) {
      const listed = res.body.listing.listed;
      state.textContent = listed ? 'Listed in the public directory.' : 'Not listed.';
      const button = h('button', { type: 'button', class: 'btn', 'aria-label': listed ? 'Withdraw listing' : 'List again', onclick: async () => {
        desk.announce('Saving…');
        const res = await api('PUT', `/api/w/${slug}/listing`, { listed: !listed });
        if (res.ok) {
          desk.announce(listed ? 'Listing withdrawn.' : 'Listed again.');
          await load();
        } else if (res.error !== null) {
          desk.announce(res.error.message, 'error');
        }
      } }, listed ? 'Withdraw listing' : 'List again');
      view.work.replaceChildren(h('div', { class: 'screen-head' }, h1('Directory listing')), state, button);
      desk.repaint();
    } else if (res.status === 401) {
      handleAuth(res.error?.code ?? '', desk, 'none', {});
    }
  }
  await load();
}
