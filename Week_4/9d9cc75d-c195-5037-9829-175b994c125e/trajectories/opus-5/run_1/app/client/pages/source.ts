import { type ApiErrorBody, fieldErrors, get, send, sendCsv } from '../api.js';
import { clear, el } from '../dom.js';
import { onEvent } from '../events.js';
import { extractStateText, nextRefreshText, type ExtractStateLike } from '../format.js';
import { distinctValues } from '../csv.js';
import { focusFirst, openDialog } from '../ui/dialog.js';
import { buildUploadPanel, takeUploadMessage } from './upload.js';
import type { SourceDoc, SourceField } from '../../shared/types.js';

export async function sourcePage(host: HTMLElement, params: Record<string, string>): Promise<void> {
  document.body.dataset.field = 'ground';
  const sourceId = params.id;
  let doc: SourceDoc | null = null;

  const announcements = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Announcements', class: 'status' });
  const uploadState = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Upload state', class: 'status' });
  const joinNotice = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Join notice', class: 'status' });
  const extractState = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Extract state', class: 'status' });
  const nextRefresh = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Next refresh', class: 'status' });
  const tablesHost = el('div', { class: 'tables' });
  const fieldsHost = el('div', { class: 'fields' });
  const entitlementsHost = el('div', { class: 'entitlements' });
  const scheduleHost = el('div', { class: 'schedule' });
  const title = el('h1', { text: 'Source' });

  const handoff = takeUploadMessage();
  if (handoff !== null) uploadState.textContent = handoff;

  const addTableButton = el('button', { type: 'button', class: 'pill-button', text: 'Add table' });
  const relateButton = el('button', { type: 'button', class: 'pill-button', text: 'Relate tables' });

  host.append(
    el('div', { class: 'page source-page' }, [
      title,
      announcements,
      uploadState,
      el('div', { class: 'source-grid' }, [
        el('section', { class: 'card' }, [
          el('h2', { text: 'Tables' }),
          tablesHost,
          el('div', { class: 'row' }, [addTableButton, relateButton]),
          joinNotice,
          el('h2', { text: 'Fields' }),
          fieldsHost,
        ]),
        el('section', { class: 'card' }, [
          el('h2', { text: 'Extract' }),
          extractState,
          nextRefresh,
          scheduleHost,
          el('h2', { text: 'Entitlements' }),
          entitlementsHost,
        ]),
      ]),
    ]),
  );

  const reload = async (): Promise<void> => {
    const res = await get<SourceDoc & ApiErrorBody>(`/api/sources/${sourceId}`);
    if (res.status !== 200) {
      clear(host);
      host.append(
        el('h1', { class: 'empty-headline', text: res.status === 403 ? 'You do not have access to this.' : 'Not found.' }),
      );
      return;
    }
    doc = res.data;
    title.textContent = doc.name;
    joinNotice.textContent = doc.notices[0] ?? '';
    drawTables();
    drawFields();
    drawEntitlements();
    drawSchedule();
    await refreshExtract();
  };

  const refreshExtract = async (): Promise<void> => {
    const res = await get<ExtractStateLike & { rows: number }>(`/api/sources/${sourceId}/extract`);
    if (res.status !== 200) return;
    extractState.textContent = extractStateText(res.data);
    nextRefresh.textContent = nextRefreshText(res.data);
  };

  onEvent('extract', (event) => {
    if (event.source !== sourceId) return;
    extractState.textContent = extractStateText(event);
    nextRefresh.textContent = nextRefreshText(event);
  });

  function drawTables(): void {
    if (doc === null) return;
    clear(tablesHost);
    const list = el('ul', { class: 'plain-list' });
    for (const table of doc.tables) {
      list.append(
        el('li', {}, [
          el('span', { text: `${table.name}: ${table.rows} rows` }),
          el('a', { href: `/api/sources/${sourceId}/tables/${encodeURIComponent(table.name)}/file`, download: '', text: `Download ${table.name}` }),
        ]),
      );
    }
    tablesHost.append(list);
    if (doc.relation !== null) {
      tablesHost.append(
        el('p', {
          class: 'muted',
          text: `Related ${doc.relation.left_table}.${doc.relation.left_key} to ${doc.relation.right_table}.${doc.relation.right_key}`,
        }),
      );
    }
  }

  function fieldRow(field: SourceField): HTMLElement {
    const rename = el('button', { type: 'button', class: 'pill-button small', text: `Rename ${field.name}` });
    rename.addEventListener('click', () => {
      const input = el('input', { type: 'text', id: 'rename-field', class: 'input', value: field.name });
      const error = el('p', { class: 'field-error' });
      const save = el('button', { type: 'button', class: 'pill-button primary', text: 'Save name' });
      const dialog = openDialog({ name: 'Rename field', opener: rename });
      dialog.body.append(el('label', { for: 'rename-field', text: 'Name' }), input, error, save);
      save.addEventListener('click', () => {
        void (async () => {
          const res = await send<SourceField & ApiErrorBody>('PATCH', `/api/sources/${sourceId}/fields/${field.id}`, {
            name: input.value,
          });
          if (res.status === 200) {
            announcements.textContent = `Renamed ${field.name} to ${input.value}.`;
            dialog.close();
            await reload();
            return;
          }
          error.textContent = fieldErrors(res.data).name ?? 'Name is required.';
        })();
      });
      focusFirst(dialog);
    });

    const toggle = el('button', {
      type: 'button',
      class: 'pill-button small',
      text: field.hidden ? `Show ${field.name}` : `Hide ${field.name}`,
    });
    toggle.addEventListener('click', () => {
      void (async () => {
        const res = await send('PATCH', `/api/sources/${sourceId}/fields/${field.id}`, { hidden: !field.hidden });
        if (res.status === 200) {
          announcements.textContent = field.hidden ? `${field.name} shown.` : `${field.name} hidden.`;
          await reload();
        }
      })();
    });

    const kind = el('button', { type: 'button', class: 'pill-button small', text: `Change kind of ${field.name}` });
    kind.addEventListener('click', () => {
      void (async () => {
        await send('PATCH', `/api/sources/${sourceId}/fields/${field.id}`, {
          kind: field.kind === 'dimension' ? 'measure' : 'dimension',
        });
        await reload();
      })();
    });

    const bins = el('button', { type: 'button', class: 'pill-button small', text: `Create bins for ${field.name}` });
    bins.addEventListener('click', () => {
      const size = el('input', { type: 'number', id: 'bin-size', class: 'input', value: '3', min: '1', step: '1' });
      const error = el('p', { class: 'field-error' });
      const save = el('button', { type: 'button', class: 'pill-button primary', text: 'Save bins' });
      const dialog = openDialog({ name: 'Bins', opener: bins });
      dialog.body.append(el('label', { for: 'bin-size', text: 'Bin size' }), size, error, save);
      save.addEventListener('click', () => {
        void (async () => {
          const res = await send<SourceField & ApiErrorBody>('POST', `/api/sources/${sourceId}/bins`, {
            field: field.name,
            size: Number(size.value),
          });
          if (res.status === 201) {
            announcements.textContent = `Created ${res.data.name}.`;
            dialog.close();
            await reload();
            return;
          }
          error.textContent = fieldErrors(res.data).size ?? fieldErrors(res.data).name ?? 'Name is required.';
        })();
      });
      focusFirst(dialog);
    });

    const group = el('button', { type: 'button', class: 'pill-button small', text: `Create group for ${field.name}` });
    group.addEventListener('click', () => {
      const nameInput = el('input', { type: 'text', id: 'group-name', class: 'input', value: 'Group' });
      const error = el('p', { class: 'field-error' });
      const membersHost = el('div', { class: 'member-list' });
      const save = el('button', { type: 'button', class: 'pill-button primary', text: 'Save group' });
      const dialog = openDialog({ name: 'Group', opener: group });
      dialog.body.append(el('label', { for: 'group-name', text: 'Group name' }), nameInput, membersHost, error, save);
      const boxes: HTMLInputElement[] = [];
      void (async () => {
        const res = await get<string>(`/api/sources/${sourceId}/tables/${encodeURIComponent(field.table)}/file`);
        const text = typeof res.data === 'string' ? res.data : '';
        for (const member of distinctValues(text, field.name)) {
          const box = el('input', { type: 'checkbox', id: `member-${member}` });
          boxes.push(box);
          box.dataset.member = member;
          membersHost.append(el('div', { class: 'row' }, [box, el('label', { for: `member-${member}`, text: member })]));
        }
      })();
      save.addEventListener('click', () => {
        void (async () => {
          const members = boxes.filter((box) => box.checked).map((box) => box.dataset.member ?? '');
          const res = await send<SourceField & ApiErrorBody>('POST', `/api/sources/${sourceId}/groups`, {
            field: field.name,
            groups: [{ name: nameInput.value, members }],
          });
          if (res.status === 201) {
            announcements.textContent = `Created ${res.data.name}.`;
            dialog.close();
            await reload();
            return;
          }
          error.textContent = fieldErrors(res.data).name ?? 'Name is required.';
        })();
      });
      focusFirst(dialog);
    });

    return el('tr', {}, [
      el('td', { text: field.name }),
      el('td', { text: field.table }),
      el('td', { text: field.type }),
      el('td', { text: field.kind }),
      el('td', { text: field.hidden ? 'hidden' : '' }),
      el('td', { class: 'field-actions' }, [rename, toggle, kind, field.type === 'number' ? bins : null, group]),
    ]);
  }

  function drawFields(): void {
    if (doc === null) return;
    clear(fieldsHost);
    const table = el('table', { class: 'data-table', 'aria-label': 'Fields' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Field' }),
          el('th', { scope: 'col', text: 'Table' }),
          el('th', { scope: 'col', text: 'Type' }),
          el('th', { scope: 'col', text: 'Kind' }),
          el('th', { scope: 'col', text: 'State' }),
          el('th', { scope: 'col', text: 'Actions' }),
        ]),
      ]),
      el('tbody', {}, doc.fields.map(fieldRow)),
    ]);
    fieldsHost.append(table);
  }

  function drawEntitlements(): void {
    if (doc === null) return;
    clear(entitlementsHost);
    const securityField = el('select', { id: 'security-field', class: 'input' }, [
      el('option', { value: '', text: 'None' }),
      ...doc.fields.filter((f) => f.kind === 'dimension').map((f) => el('option', { value: f.name, text: f.name })),
    ]);
    if (doc.entitlements.field !== null) securityField.value = doc.entitlements.field;
    const username = el('input', { type: 'text', id: 'entitled-username', class: 'input' });
    const values = el('input', { type: 'text', id: 'entitled-values', class: 'input' });
    const add = el('button', { type: 'button', class: 'pill-button primary', text: 'Add entitlement' });

    const body = el('tbody');
    const users = doc.entitlements.users;
    for (const [user, allowed] of Object.entries(users)) {
      const remove = el('button', { type: 'button', class: 'pill-button small', text: `Remove entitlement for ${user}` });
      remove.addEventListener('click', () => {
        void (async () => {
          const next = { ...users };
          delete next[user];
          await send('PUT', `/api/sources/${sourceId}/entitlements`, { field: securityField.value || null, users: next });
          announcements.textContent = 'Entitlements saved.';
          await reload();
        })();
      });
      body.append(
        el('tr', {}, [
          el('td', { text: user }),
          el('td', { text: (allowed as unknown[]).map((v) => String(v)).join(', ') }),
          el('td', {}, [remove]),
        ]),
      );
    }

    add.addEventListener('click', () => {
      void (async () => {
        const next: Record<string, unknown[]> = { ...users };
        next[username.value.toLowerCase()] = values.value
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v !== '');
        const res = await send('PUT', `/api/sources/${sourceId}/entitlements`, {
          field: securityField.value === '' ? null : securityField.value,
          users: next,
        });
        if (res.status === 200) {
          announcements.textContent = 'Entitlements saved.';
          await reload();
        }
      })();
    });
    securityField.addEventListener('change', () => {
      void (async () => {
        await send('PUT', `/api/sources/${sourceId}/entitlements`, {
          field: securityField.value === '' ? null : securityField.value,
          users,
        });
        announcements.textContent = 'Entitlements saved.';
      })();
    });

    entitlementsHost.append(
      el('table', { class: 'data-table', 'aria-label': 'Entitlements' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'User' }),
            el('th', { scope: 'col', text: 'Values' }),
            el('th', { scope: 'col', text: 'Actions' }),
          ]),
        ]),
        body,
      ]),
      el('div', { class: 'row' }, [
        el('label', { for: 'security-field', text: 'Security field' }),
        securityField,
        el('label', { for: 'entitled-username', text: 'Entitled username' }),
        username,
        el('label', { for: 'entitled-values', text: 'Values' }),
        values,
        add,
      ]),
    );
  }

  function drawSchedule(): void {
    if (doc === null) return;
    clear(scheduleHost);
    const every = el('input', { type: 'number', id: 'every-minutes', class: 'input', min: '1', max: '10080', step: '1', value: String(doc.schedule?.every_minutes ?? 60) });
    const kind = el('select', { id: 'refresh-kind', class: 'input' }, [
      el('option', { value: 'full', text: 'Full' }),
      el('option', { value: 'incremental', text: 'Incremental' }),
    ]);
    if (doc.schedule !== null) kind.value = doc.schedule.kind;
    const keySelect = el('select', { id: 'refresh-key', class: 'input' }, [
      el('option', { value: '', text: 'None' }),
      ...doc.fields
        .filter((f) => f.type === 'number' || f.type === 'date')
        .map((f) => el('option', { value: f.name, text: f.name })),
    ]);
    if (doc.schedule?.key != null) keySelect.value = doc.schedule.key;
    const error = el('p', { class: 'field-error' });
    const save = el('button', { type: 'button', class: 'pill-button primary', text: 'Save schedule' });
    const refreshNow = el('button', { type: 'button', class: 'pill-button', text: 'Refresh now' });

    save.addEventListener('click', () => {
      void (async () => {
        error.textContent = '';
        const res = await send<ApiErrorBody>('PUT', `/api/sources/${sourceId}/schedule`, {
          every_minutes: Number(every.value),
          kind: kind.value,
          key: keySelect.value === '' ? null : keySelect.value,
        });
        if (res.status === 200) {
          announcements.textContent = 'Schedule saved.';
          await refreshExtract();
          return;
        }
        const errors = fieldErrors(res.data);
        error.textContent = errors.every_minutes ?? errors.key ?? 'You do not have access to this.';
      })();
    });
    refreshNow.addEventListener('click', () => {
      void (async () => {
        const res = await send<ExtractStateLike>('POST', `/api/sources/${sourceId}/refresh`);
        if (res.status === 200) {
          announcements.textContent = res.data.state === 'refresh_failed' ? 'Refresh failed.' : 'Refresh finished.';
          extractState.textContent = extractStateText(res.data);
          nextRefresh.textContent = nextRefreshText(res.data);
        }
      })();
    });

    scheduleHost.append(
      el('div', { class: 'row' }, [
        el('label', { for: 'every-minutes', text: 'Every minutes' }),
        every,
        el('label', { for: 'refresh-kind', text: 'Refresh kind' }),
        kind,
        el('label', { for: 'refresh-key', text: 'Key' }),
        keySelect,
        save,
        refreshNow,
      ]),
      error,
    );
  }

  addTableButton.addEventListener('click', () => {
    const tableName = el('input', { type: 'text', id: 'add-table-name', class: 'input', value: 'stockists' });
    const dialog = openDialog({ name: 'Add table', opener: addTableButton });
    const panel = buildUploadPanel({
      projectId: () => doc?.project ?? '',
      tableName: () => tableName.value,
      upload: (bytes) =>
        sendCsv<ApiErrorBody & { id?: string; tables?: { name: string; rows: number }[] }>(
          'POST',
          `/api/sources/${sourceId}/tables?table=${encodeURIComponent(tableName.value)}`,
          bytes,
        ),
      onUploaded: () => {
        void reload();
      },
    });
    dialog.body.append(el('label', { for: 'add-table-name', text: 'Table name' }), tableName, panel.root);
    focusFirst(dialog);
  });

  relateButton.addEventListener('click', () => {
    if (doc === null) return;
    const left = doc.tables[0];
    const right = doc.tables[1];
    const leftKey = el('select', { id: 'left-key', class: 'input' },
      (left?.columns ?? []).map((c) => el('option', { value: c.name, text: c.name })),
    );
    const rightKey = el('select', { id: 'right-key', class: 'input' },
      (right?.columns ?? []).map((c) => el('option', { value: c.name, text: c.name })),
    );
    const error = el('p', { class: 'field-error' });
    const save = el('button', { type: 'button', class: 'pill-button primary', text: 'Save relation' });
    const dialog = openDialog({ name: 'Relate tables', opener: relateButton });
    dialog.body.append(
      el('label', { for: 'left-key', text: 'Left key' }),
      leftKey,
      el('label', { for: 'right-key', text: 'Right key' }),
      rightKey,
      error,
      save,
    );
    save.addEventListener('click', () => {
      void (async () => {
        const res = await send<{ notices: string[] } & ApiErrorBody>('PUT', `/api/sources/${sourceId}/relation`, {
          left_table: left?.name ?? '',
          left_key: leftKey.value,
          right_table: right?.name ?? '',
          right_key: rightKey.value,
        });
        if (res.status === 200) {
          announcements.textContent = `Related ${left?.name ?? ''} to ${right?.name ?? ''}.`;
          dialog.close();
          await reload();
          return;
        }
        error.textContent = fieldErrors(res.data).right_key ?? 'Keys must have the same type.';
      })();
    });
    focusFirst(dialog);
  });

  await reload();
}
