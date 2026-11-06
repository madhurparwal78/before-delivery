// Right-hand sheets: Tokens, Collection, Images, History, Publish, Comments, Share.
import { BP_LABEL, BREAKPOINTS, type DocumentNode, type Breakpoint } from '../shared/domain.js';
import { el } from './canvas.js';
import { publishStateText, notices } from './announce.js';
import type { EditorState, Thread, VersionSummaryClient, ImageSummary } from './state.js';

export type PanelKind = 'tokens' | 'collection' | 'images' | 'history' | 'publish' | 'comments' | 'share' | null;

export function openSheet(kind: PanelKind, state: EditorState, sheet: HTMLElement): void {
  sheet.innerHTML = '';
  sheet.hidden = false;
  const region = el('div', { role: 'region', 'aria-label': kind, id: `panel-${kind}` });
  switch (kind) {
    case 'tokens': renderTokens(region, state); break;
    case 'collection': renderCollection(region, state); break;
    case 'images': renderImages(region, state); break;
    case 'history': renderHistory(region, state); break;
    case 'publish': renderPublish(region, state); break;
    case 'comments': renderComments(region, state); break;
    case 'share': renderShare(region, state); break;
    default: return;
  }
  sheet.appendChild(region);
  (sheet.querySelector<HTMLElement>('button, input, [tabindex]') ?? region).focus();
}

function renderTokens(region: HTMLElement, state: EditorState): void {
  const doc = state.shownDocument()!;
  region.setAttribute('aria-label', 'Tokens');
  const table = el('table', { 'aria-label': 'Tokens' });
  const tbody = el('tbody');
  for (const token of doc.tokens) {
    const tr = el('tr');
    const nameCell = el('td');
    const nameInput = el('input', { type: 'text', 'aria-label': `${token.name} name`, value: token.name }) as HTMLInputElement;
    nameCell.appendChild(nameInput);
    const valueCell = el('td');
    const valueInput = el('input', { type: 'text', 'aria-label': `${token.name} value`, value: String(token.value) }) as HTMLInputElement;
    valueCell.appendChild(valueInput);
    const unitCell = el('td');
    let unitSel: HTMLSelectElement | null = null;
    if (token.kind === 'size') {
      unitSel = el('select', { 'aria-label': `${token.name} unit` }) as HTMLSelectElement;
      for (const u of ['px', 'rem']) {
        const o = el('option', { value: u }, u) as HTMLOptionElement;
        if (token.unit === u) o.selected = true;
        unitSel.appendChild(o);
      }
      unitCell.appendChild(unitSel);
    }
    const delCell = el('td');
    const del = el('button', { 'aria-label': `Delete ${token.name}` }, 'Delete');
    delCell.appendChild(del);
    tr.append(nameCell, valueCell, unitCell, delCell);
    tbody.appendChild(tr);

    valueInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const ev = new CustomEvent('plinth:set-token', { detail: { name: token.name, value: valueInput.value } });
        document.dispatchEvent(ev);
      }
      e.stopPropagation();
    });
    nameInput.addEventListener('change', () => {
      const ev = new CustomEvent('plinth:rename-token', { detail: { name: token.name, newName: nameInput.value } });
      document.dispatchEvent(ev);
    });
    unitSel?.addEventListener('change', () => {
      const ev = new CustomEvent('plinth:set-token-unit', { detail: { name: token.name, unit: unitSel!.value } });
      document.dispatchEvent(ev);
    });
    del.addEventListener('click', () => {
      const ev = new CustomEvent('plinth:delete-token', { detail: { name: token.name } });
      document.dispatchEvent(ev);
    });
  }
  table.appendChild(tbody);
  region.appendChild(table);

  const newRow = el('div', { class: 'new-row' });
  const newName = el('input', { type: 'text', 'aria-label': 'New token name' }) as HTMLInputElement;
  const newKind = el('select', { 'aria-label': 'New token kind' }) as HTMLSelectElement;
  for (const k of ['Color', 'Size']) {
    const o = el('option', { value: k.toLowerCase() }, k) as HTMLOptionElement;
    newKind.appendChild(o);
  }
  const add = el('button', {}, 'Add token');
  add.addEventListener('click', () => {
    const ev = new CustomEvent('plinth:add-token', { detail: { name: newName.value, kind: newKind.value } });
    document.dispatchEvent(ev);
  });
  newRow.append(newName, newKind, add);
  region.appendChild(newRow);
}

function renderCollection(region: HTMLElement, state: EditorState): void {
  const doc = state.shownDocument()!;
  region.setAttribute('aria-label', 'Collection');
  const fieldsRow = el('div', { class: 'new-row' });
  const fieldName = el('input', { type: 'text', 'aria-label': 'Field name' }) as HTMLInputElement;
  const fieldKind = el('select', { 'aria-label': 'Field kind' }) as HTMLSelectElement;
  for (const k of ['Text', 'Rich text', 'Image']) {
    const o = el('option', { value: k === 'Rich text' ? 'rich_text' : k.toLowerCase() }, k) as HTMLOptionElement;
    fieldKind.appendChild(o);
  }
  const addField = el('button', {}, 'Add field');
  fieldsRow.append(fieldName, fieldKind, addField);
  region.appendChild(fieldsRow);
  addField.addEventListener('click', () => {
    const ev = new CustomEvent('plinth:add-field', { detail: { name: fieldName.value, kind: fieldKind.value } });
    document.dispatchEvent(ev);
  });

  const fieldList = el('ul', { class: 'field-list' });
  doc.collection.fields.forEach((f) => {
    fieldList.appendChild(el('li', {}, `${f.name} (${f.kind})`));
  });
  region.appendChild(fieldList);

  const table = el('table', { 'aria-label': 'Entries' });
  const tbody = el('tbody');
  const entries = [...doc.collection.entries].sort((a, b) => a.order - b.order);
  entries.forEach((entry, i) => {
    const tr = el('tr', { 'data-entry-id': entry.id });
    const label = el('td', {}, doc.collection.fields.map((f) => entry.values[f.name] ?? '').filter(Boolean).join(' · ') || `Entry ${i + 1}`);
    const actions = el('td');
    const up = el('button', { 'aria-label': `Move entry ${i + 1} up` }, '↑');
    const down = el('button', { 'aria-label': `Move entry ${i + 1} down` }, '↓');
    const edit = el('button', { 'aria-label': `Edit entry ${i + 1}` }, 'Edit entry');
    const del = el('button', { 'aria-label': `Delete entry ${i + 1}` }, 'Delete entry');
    actions.append(up, down, edit, del);
    tr.append(label, actions);
    tbody.appendChild(tr);
    up.addEventListener('click', () => {
      const ev = new CustomEvent('plinth:move-entry', { detail: { entryId: entry.id, index: Math.max(0, i - 1) } });
      document.dispatchEvent(ev);
    });
    down.addEventListener('click', () => {
      const ev = new CustomEvent('plinth:move-entry', { detail: { entryId: entry.id, index: Math.min(entries.length - 1, i + 1) } });
      document.dispatchEvent(ev);
    });
    del.addEventListener('click', () => {
      const ev = new CustomEvent('plinth:delete-entry', { detail: { entryId: entry.id } });
      document.dispatchEvent(ev);
    });
    edit.addEventListener('click', () => {
      const ev = new CustomEvent('plinth:edit-entry', { detail: { entryId: entry.id } });
      document.dispatchEvent(ev);
    });
  });
  table.appendChild(tbody);
  region.appendChild(table);

  const addEntry = el('button', {}, 'Add entry');
  addEntry.addEventListener('click', () => {
    const ev = new CustomEvent('plinth:add-entry', { detail: {} });
    document.dispatchEvent(ev);
  });
  region.appendChild(addEntry);
}

export function renderEntryEditor(region: HTMLElement, state: EditorState, entryId: string | null): void {
  region.innerHTML = '';
  const doc = state.shownDocument()!;
  const entry = entryId ? doc.collection.entries.find((e) => e.id === entryId) : null;
  const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
  for (const field of doc.collection.fields) {
    const label = el('label', { class: 'style-row' });
    label.appendChild(el('span', { class: 'prop-name' }, field.name));
    let input: HTMLInputElement | HTMLTextAreaElement;
    if (field.kind === 'rich_text') {
      input = el('textarea', { 'aria-label': field.name });
      (input as HTMLTextAreaElement).rows = 4;
    } else if (field.kind === 'image') {
      const select = el('select', { 'aria-label': field.name }) as unknown as HTMLInputElement;
      const none = el('option', { value: '' }, '(none)') as HTMLOptionElement;
      select.appendChild(none);
      for (const img of state.images) {
        const o = el('option', { value: img.id }, img.fileName) as HTMLOptionElement;
        select.appendChild(o);
      }
      input = select;
    } else {
      input = el('input', { type: 'text', 'aria-label': field.name }) as HTMLInputElement;
    }
    const value = entry?.values[field.name] ?? '';
    if (input instanceof HTMLSelectElement) input.value = value;
    else input.value = value;
    inputs[field.name] = input;
    const wrap = el('span', { class: 'style-controls' });
    wrap.appendChild(input);
    label.appendChild(wrap);
    region.appendChild(label);
  }
  const save = el('button', { class: 'primary' }, 'Save entry');
  save.addEventListener('click', () => {
    const values: Record<string, string> = {};
    for (const [name, input] of Object.entries(inputs)) values[name] = input.value;
    const ev = new CustomEvent('plinth:save-entry', { detail: { entryId, values } });
    document.dispatchEvent(ev);
  });
  region.appendChild(save);
}

function renderHistory(region: HTMLElement, state: EditorState): void {
  region.setAttribute('aria-label', 'History');
  const list = el('ul', { role: 'list', 'aria-label': 'Versions' });
  for (const v of state.versions) {
    const li = el('li');
    const a = el('a', { href: '#', 'data-version-id': v.id }, versionLine(v));
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const ev = new CustomEvent('plinth:preview-version', { detail: { versionId: v.id } });
      document.dispatchEvent(ev);
    });
    li.appendChild(a);
    list.appendChild(li);
  }
  region.appendChild(list);
}

export function versionLine(v: VersionSummaryClient): string {
  const d = new Date(v.createdAt);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  const line = `${v.name} · ${v.author.name} · ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  return line;
}

function renderPublish(region: HTMLElement, state: EditorState): void {
  region.setAttribute('aria-label', 'Publish');
  const page = state.page();
  const stateText = el('p', { id: 'publish-state', tabindex: '-1' }, publishStateText[state.publish.state] ?? state.publish.state);
  region.appendChild(stateText);
  if (state.publish.url) {
    const url = state.publish.url.replace(/^https?:\/\/[^/]+/, '');
    const link = el('a', { href: url, 'data-live-address': 'true' }, state.publish.url);
    region.appendChild(el('p', {}, ''));
    region.appendChild(link);
  }
  const actions = el('div', { class: 'new-row' });
  const publishBtn = el('button', { id: 'btn-publish-now', class: 'primary' }, 'Publish');
  actions.appendChild(publishBtn);
  if (state.publish.state === 'live' || state.publish.state === 'live_changed') {
    if (state.isOwner) {
      const unpublish = el('button', { id: 'btn-unpublish' }, 'Unpublish');
      unpublish.addEventListener('click', () => {
        const ev = new CustomEvent('plinth:unpublish');
        document.dispatchEvent(ev);
      });
      actions.appendChild(unpublish);
    }
  }
  if (state.publishFailed) {
    const retry = el('button', { id: 'btn-retry-publish' }, 'Try publishing again');
    retry.addEventListener('click', () => {
      const ev = new CustomEvent('plinth:publish');
      document.dispatchEvent(ev);
    });
    actions.appendChild(retry);
  }
  publishBtn.addEventListener('click', () => {
    const ev = new CustomEvent('plinth:publish');
    document.dispatchEvent(ev);
  });
  region.appendChild(actions);
  void page;
}

function renderComments(region: HTMLElement, state: EditorState): void {
  region.setAttribute('aria-label', 'Comments');
  const composer = el('div', { class: 'composer' });
  const input = el('textarea', { 'aria-label': 'Comment', rows: '2' }) as HTMLTextAreaElement;
  const post = el('button', { class: 'primary' }, 'Post comment');
  composer.append(input, post);
  post.addEventListener('click', () => {
    const ev = new CustomEvent('plinth:post-comment', { detail: { body: input.value } });
    document.dispatchEvent(ev);
    input.value = '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      post.click();
    }
    e.stopPropagation();
  });
  region.appendChild(composer);

  const open = state.threads.filter((t) => t.status === 'open' && t.pageId === state.pageId);
  const resolved = state.threads.filter((t) => t.status === 'resolved' && t.pageId === state.pageId);
  for (const thread of open) region.appendChild(threadArticle(thread, state));
  if (resolved.length > 0) {
    region.appendChild(el('h3', {}, `Resolved (${resolved.length})`));
    for (const thread of resolved) region.appendChild(threadArticle(thread, state));
  }
}

export function threadArticle(thread: Thread, state: EditorState): HTMLElement {
  const article = el('article', { 'data-thread-id': thread.id, 'aria-label': `Comment by ${thread.author.name} on ${thread.nodeName}` });
  const head = el('p', {}, `${thread.author.name} on ${thread.nodeName}`);
  article.appendChild(head);
  const body = el('p', {}, thread.body);
  article.appendChild(body);
  for (const reply of thread.replies) {
    article.appendChild(el('p', { class: 'muted' }, `${reply.author.name}: ${reply.body}`));
  }
  const replyInput = el('input', { type: 'text', 'aria-label': 'Reply', class: 'reply-input' }) as HTMLInputElement;
  const actions = el('div', { class: 'new-row' });
  const replyBtn = el('button', { 'aria-label': `Reply to ${thread.author.name}` }, 'Reply');
  const resolveBtn = el('button', {}, thread.status === 'open' ? 'Resolve' : 'Reopen');
  actions.append(replyInput, replyBtn, resolveBtn);
  replyBtn.addEventListener('click', () => {
    if (replyInput.value.trim()) {
      const ev = new CustomEvent('plinth:reply-comment', { detail: { commentId: thread.id, body: replyInput.value } });
      document.dispatchEvent(ev);
      replyInput.value = '';
    }
  });
  resolveBtn.addEventListener('click', () => {
    const ev = new CustomEvent('plinth:resolve-comment', { detail: { commentId: thread.id, resolve: thread.status === 'open' } });
    document.dispatchEvent(ev);
  });
  article.appendChild(actions);
  void state;
  return article;
}

function renderShare(region: HTMLElement, state: EditorState): void {
  region.setAttribute('aria-label', `Share ${state.workspaceName}`);
  const email = el('input', { type: 'text', 'aria-label': 'Email' }) as HTMLInputElement;
  const role = el('select', { 'aria-label': 'Role' }) as HTMLSelectElement;
  for (const rl of ['Editor', 'Viewer']) {
    const o = el('option', { value: rl.toLowerCase() }, rl) as HTMLOptionElement;
    role.appendChild(o);
  }
  const send = el('button', { class: 'primary' }, 'Send invite');
  const row = el('div', { class: 'new-row' });
  row.append(email, role, send);
  region.appendChild(row);
  send.addEventListener('click', () => {
    const ev = new CustomEvent('plinth:send-invite', { detail: { email: email.value, role: role.value } });
    document.dispatchEvent(ev);
    email.value = '';
  });
  const list = el('ul', { role: 'list', 'aria-label': 'Members' });
  region.appendChild(list);
  renderMembersList(list);
}

export function renderMembersList(list: HTMLElement): void {
  list.innerHTML = '';
  const evLoad = async () => {
    const res = await fetch(`/api/workspaces/${stateRef!.workspaceId}/members`);
    const data = await res.json() as { members: { userId?: string; inviteId?: string; email: string; name?: string; role: string; status: string }[] };
    for (const m of data.members) {
      const li = el('li', { 'data-member-email': m.email, class: 'member-row' });
      li.appendChild(el('span', { class: 'member-email' }, m.email));
      li.appendChild(el('span', { class: 'muted' }, m.status === 'invited' ? 'Invited' : 'Active'));
      const roleSel = el('select', { 'aria-label': `Role for ${m.email}` }) as HTMLSelectElement;
      for (const rl of ['Owner', 'Editor', 'Viewer']) {
        const o = el('option', { value: rl.toLowerCase() }, rl) as HTMLOptionElement;
        if (m.role === rl.toLowerCase()) o.selected = true;
        roleSel.appendChild(o);
      }
      if (m.role === 'owner') roleSel.disabled = true;
      roleSel.addEventListener('change', () => {
        const ev = new CustomEvent('plinth:change-role', { detail: { userId: m.userId, role: roleSel.value } });
        document.dispatchEvent(ev);
      });
      li.appendChild(roleSel);
      const actionBtn = m.status === 'invited'
        ? el('button', { 'aria-label': `Revoke ${m.email}` }, 'Revoke')
        : el('button', { 'aria-label': `Remove ${m.email}` }, 'Remove');
      actionBtn.addEventListener('click', () => {
        const ev = new CustomEvent(m.status === 'invited' ? 'plinth:revoke-invite' : 'plinth:remove-member', {
          detail: { inviteId: m.inviteId, userId: m.userId, email: m.email },
        });
        document.dispatchEvent(ev);
      });
      li.appendChild(actionBtn);
      list.appendChild(li);
    }
  };
  void evLoad();
}

interface StateRef { workspaceId: string }
let stateRef: StateRef | null = null;
export function setPanelState(s: StateRef): void { stateRef = s; }

function renderImages(region: HTMLElement, state: EditorState): void {
  region.setAttribute('aria-label', 'Images');
  const file = el('input', { type: 'file', 'aria-label': 'Image file' }) as HTMLInputElement;
  file.accept = 'image/png,image/jpeg,image/webp';
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) {
      const ev = new CustomEvent('plinth:upload-image', { detail: { file: f } });
      document.dispatchEvent(ev);
      file.value = '';
    }
  });
  region.appendChild(file);
  const list = el('ul', { role: 'list', 'aria-label': 'Images' });
  for (const img of state.images) {
    list.appendChild(el('li', { 'data-image-id': img.id }, img.fileName));
  }
  region.appendChild(list);
}
