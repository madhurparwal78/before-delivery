import { notices, PUBLISH_STATE_TEXT } from '../../shared/notices.js';
import { richTextToPlain } from '../../shared/richtext.js';
import type { Field, FieldKind, Token } from '../../shared/types.js';
import { button, el, focusables, patchChildren, setAttr, setText, trapTab } from '../dom.js';
import { RequestFailed, api, uploadImage } from '../net.js';
import {
  deleteEntry,
  deleteToken,
  moveEntry,
  putEntry,
  renameToken,
  setFields,
  setToken,
  selectNode,
} from './actions.js';
import { canvasElement, frameElement } from './canvas.js';
import { postComment, replyToThread, setThreadStatus } from './comments.js';
import { openPublishDialog } from './dialogs.js';
import { publishNow, unpublish } from './publishing.js';
import {
  activeDoc,
  canEdit,
  currentPage,
  nodeById,
  orderedEntries,
  render,
  sayWithToast,
  state,
  syncUrl,
  type ImageRecord,
  type PanelName,
  type Thread,
  type VersionSummary,
} from './store.js';
import { openPreview, versionLine } from './versions.js';

let sheet: HTMLElement | undefined;
const sections = new Map<PanelName, HTMLElement>();

let tokenTableBody: HTMLElement;
let newTokenName: HTMLInputElement;
let newTokenKind: HTMLSelectElement;
let fieldNameInput: HTMLInputElement;
let fieldKindSelect: HTMLSelectElement;
let fieldList: HTMLElement;
let entryTableBody: HTMLElement;
let entryEditor: HTMLElement;
let entryEditorFields: HTMLElement;
let editingEntryId: string | undefined;
let imageList: HTMLElement;
let imageInput: HTMLInputElement;
let versionList: HTMLElement;
let commentBox: HTMLTextAreaElement;
let threadList: HTMLElement;
let resolvedHeading: HTMLElement;
let resolvedList: HTMLElement;
let publishState: HTMLElement;
let publishLink: HTMLAnchorElement;
let publishButton: HTMLButtonElement;
let unpublishButton: HTMLButtonElement;
let retryButton: HTMLButtonElement;

function section(name: PanelName, label: string, children: (Node | string)[]): HTMLElement {
  const element = el(
    'section',
    { role: 'region', 'aria-label': label, id: `panel-${name}`, class: 'sheet-panel' },
    [el('h2', {}, [label]), ...children],
  );
  sections.set(name, element);
  return element;
}

export function openPanel(name: PanelName): void {
  state.panel = state.panel === name ? 'none' : name;
  syncUrl();
  render();
  if (state.panel !== 'none') {
    const element = sections.get(state.panel);
    if (element) focusables(element)[0]?.focus();
  }
}

export function closePanel(): void {
  state.panel = 'none';
  syncUrl();
  render();
}

export function sheetElement(): HTMLElement {
  if (sheet) return sheet;

  tokenTableBody = el('tbody');
  newTokenName = el('input', { type: 'text', 'aria-label': 'New token name' });
  newTokenKind = el('select', { 'aria-label': 'New token kind' }, [
    el('option', { value: 'color' }, ['Color']),
    el('option', { value: 'size' }, ['Size']),
  ]);
  const addToken = button('Add token', { class: 'primary' });
  addToken.addEventListener('click', () => {
    const name = newTokenName.value.trim();
    if (name === '') return;
    if (newTokenKind.value === 'size') setToken(name, 'size', 16, 'px');
    else setToken(name, 'color', 'black');
    newTokenName.value = '';
  });
  const tokens = section('tokens', 'Tokens', [
    el('table', { 'aria-label': 'Tokens' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Name']),
          el('th', {}, ['Value']),
          el('th', {}, ['Unit']),
          el('th', {}, ['Delete']),
        ]),
      ]),
      tokenTableBody,
    ]),
    el('div', { class: 'row' }, [newTokenName, newTokenKind, addToken]),
  ]);

  fieldNameInput = el('input', { type: 'text', 'aria-label': 'Field name' });
  fieldKindSelect = el('select', { 'aria-label': 'Field kind' }, [
    el('option', { value: 'text' }, ['Text']),
    el('option', { value: 'rich_text' }, ['Rich text']),
    el('option', { value: 'image' }, ['Image']),
  ]);
  const addField = button('Add field', { class: 'primary' });
  addField.addEventListener('click', () => {
    const name = fieldNameInput.value.trim();
    if (name === '') return;
    setFields([
      ...activeDoc().collection.fields,
      { name, kind: fieldKindSelect.value as FieldKind },
    ]);
    fieldNameInput.value = '';
  });
  fieldList = el('ul', { class: 'field-list' });
  entryTableBody = el('tbody');
  const addEntry = button('Add entry', { class: 'primary' });
  addEntry.addEventListener('click', () => {
    void putEntry(undefined, {});
  });
  entryEditorFields = el('div', { class: 'entry-fields' });
  const saveEntry = button('Save entry', { class: 'primary' });
  saveEntry.addEventListener('click', () => {
    const values: Record<string, string> = {};
    for (const input of entryEditorFields.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >('[data-field]')) {
      values[input.dataset['field']!] = input.value;
    }
    void putEntry(editingEntryId, values).then(() => {
      editingEntryId = undefined;
      render();
    });
  });
  entryEditor = el('div', { class: 'entry-editor', hidden: true }, [entryEditorFields, saveEntry]);
  const collection = section('collection', 'Collection', [
    el('div', { class: 'row' }, [fieldNameInput, fieldKindSelect, addField]),
    fieldList,
    el('table', { 'aria-label': 'Entries' }, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Entry']), el('th', {}, ['Actions'])])]),
      entryTableBody,
    ]),
    addEntry,
    entryEditor,
  ]);

  imageInput = el('input', { type: 'file', id: 'image-file', accept: 'image/*' });
  imageInput.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    if (file) void upload(file);
  });
  imageList = el('ul', { 'aria-label': 'Images', class: 'image-list' });
  const images = section('images', 'Images', [
    el('div', { class: 'row' }, [el('label', { for: 'image-file' }, ['Image file']), imageInput]),
    imageList,
  ]);

  versionList = el('ul', { 'aria-label': 'Versions', class: 'version-list' });
  const history = section('history', 'History', [versionList]);

  commentBox = el('textarea', { 'aria-label': 'Comment', rows: '3' });
  const post = button('Post comment', { class: 'primary' });
  post.addEventListener('click', () => {
    void postComment(commentBox.value).then((thread) => {
      if (!thread) return;
      commentBox.value = '';
      render();
      document
        .querySelector<HTMLElement>(`[data-thread="${thread.id}"] [data-reply-button]`)
        ?.focus();
    });
  });
  threadList = el('div', { class: 'threads' });
  resolvedHeading = el('h3', {}, ['Resolved (0)']);
  resolvedList = el('div', { class: 'threads resolved' });
  const comments = section('comments', 'Comments', [
    commentBox,
    post,
    threadList,
    resolvedHeading,
    resolvedList,
  ]);

  publishState = el('p', { id: 'publish-state', tabindex: '-1', class: 'mono' }, ['Not published']);
  publishLink = el('a', { href: '#', class: 'mono' }, ['']);
  publishButton = button('Publish', { class: 'primary' });
  publishButton.addEventListener('click', () => openPublishDialog());
  unpublishButton = button('Unpublish', { class: 'ghost' });
  unpublishButton.addEventListener('click', () => {
    void unpublish();
  });
  retryButton = button('Try publishing again', { class: 'primary' });
  retryButton.addEventListener('click', () => {
    void publishNow();
  });
  const publish = section('publish', 'Publish', [
    publishState,
    publishLink,
    publishButton,
    unpublishButton,
    retryButton,
  ]);

  sheet = el('div', { id: 'sheet' }, [tokens, collection, images, history, comments, publish]);
  sheet.addEventListener('keydown', (event) => {
    if (state.panel === 'none') return;
    const element = sections.get(state.panel);
    if (element) trapTab(element, event);
  });
  return sheet;
}

async function upload(file: File): Promise<void> {
  state.busy.upload = true;
  imageInput.disabled = true;
  imageInput.setAttribute('aria-busy', 'true');
  render();
  sayWithToast(notices.uploadProgress(file.name));
  try {
    await uploadImage(state.workspaceId, file);
    sayWithToast(notices.uploadSuccess(file.name));
    state.storageDown = false;
    await loadImages();
  } catch (error) {
    if (error instanceof RequestFailed) {
      const code = error.failure.code;
      if (code === 'unsupported_image') sayWithToast(notices.uploadWrongType);
      else if (code === 'image_too_large') sayWithToast(notices.uploadTooBig);
      else if (code === 'storage_unavailable') {
        state.storageDown = true;
        sayWithToast(notices.uploadOutage(file.name));
      } else sayWithToast(error.failure.message);
    }
  } finally {
    state.busy.upload = false;
    imageInput.disabled = false;
    imageInput.removeAttribute('aria-busy');
    imageInput.value = '';
    render();
  }
}

export async function loadImages(): Promise<void> {
  const result = await api.get<{ images: ImageRecord[] }>(
    `/api/workspaces/${state.workspaceId}/images`,
  );
  state.images = result.images;
  render();
}

function renderTokens(): void {
  patchChildren<Token>(
    tokenTableBody,
    activeDoc().tokens,
    (token) => token.name,
    () => {
      const row = el('tr', {}, [el('td'), el('td'), el('td'), el('td')]);
      return row;
    },
    (row, token) => {
      const cells = [...row.children] as HTMLElement[];
      const nameInput =
        cells[0]!.querySelector('input') ?? el('input', { type: 'text', class: 'mono' });
      if (!nameInput.isConnected) {
        cells[0]!.append(nameInput);
        nameInput.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const before = nameInput.dataset['token']!;
          const after = nameInput.value.trim();
          if (after !== '' && after !== before) renameToken(before, after);
        });
      }
      nameInput.dataset['token'] = token.name;
      setAttr(nameInput, 'aria-label', `${token.name} name`);
      if (document.activeElement !== nameInput) nameInput.value = token.name;

      const valueInput =
        cells[1]!.querySelector('input') ?? el('input', { type: 'text', class: 'mono' });
      if (!valueInput.isConnected) {
        cells[1]!.append(valueInput);
        valueInput.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commitTokenValue(valueInput);
        });
        valueInput.addEventListener('blur', () => commitTokenValue(valueInput));
      }
      valueInput.dataset['token'] = token.name;
      setAttr(valueInput, 'aria-label', `${token.name} value`);
      if (document.activeElement !== valueInput) valueInput.value = String(token.value);

      cells[2]!.replaceChildren();
      if (token.kind === 'size') {
        const unit = el('select', { 'aria-label': `${token.name} unit`, class: 'mono' }, [
          el('option', { value: 'px' }, ['px']),
          el('option', { value: 'rem' }, ['rem']),
        ]);
        unit.value = token.unit ?? 'px';
        unit.addEventListener('change', () => {
          const current = activeDoc().tokens.find((item) => item.name === token.name);
          if (!current || current.kind !== 'size') return;
          const number = Number(current.value);
          const converted =
            unit.value === 'rem'
              ? Math.round((number / 16) * 10000) / 10000
              : Math.round(number * 16 * 10000) / 10000;
          setToken(token.name, 'size', converted, unit.value as 'px' | 'rem');
        });
        cells[2]!.append(unit);
      }

      cells[3]!.replaceChildren();
      const remove = button('Delete', { 'aria-label': `Delete ${token.name}`, class: 'ghost' });
      remove.addEventListener('click', () => deleteToken(token.name));
      cells[3]!.append(remove);
      row.hidden = !canEdit() && false;
    },
  );
}

function commitTokenValue(input: HTMLInputElement): void {
  const name = input.dataset['token']!;
  const token = activeDoc().tokens.find((item) => item.name === name);
  if (!token) return;
  if (token.kind === 'size') {
    const number = Number(input.value);
    if (!Number.isFinite(number)) return;
    if (number === Number(token.value)) return;
    setToken(name, 'size', number, token.unit ?? 'px');
    return;
  }
  const value = input.value.trim();
  if (value === '' || value === token.value) return;
  setToken(name, 'color', value);
}

function renderFields(): void {
  const fields = activeDoc().collection.fields;
  patchChildren<Field>(
    fieldList,
    fields,
    (field) => field.name,
    () => el('li'),
    (row, field) => {
      const remove = button('Remove', {
        'aria-label': `Remove field ${field.name}`,
        class: 'ghost',
      });
      remove.addEventListener('click', () => {
        setFields(fields.filter((item) => item.name !== field.name));
      });
      row.replaceChildren(
        el('span', {}, [field.name]),
        el('span', { class: 'mono' }, [field.kind]),
        remove,
      );
    },
  );
}

function renderEntries(): void {
  const entries = orderedEntries();
  const fields = activeDoc().collection.fields;
  patchChildren(
    entryTableBody,
    entries,
    (entry) => entry.id,
    () => el('tr', {}, [el('td'), el('td')]),
    (row, entry) => {
      const position = entry.order + 1;
      const cells = [...row.children] as HTMLElement[];
      const summary = fields
        .map((field) => richTextToPlain(entry.values[field.name] ?? ''))
        .join(' ')
        .slice(0, 60);
      setText(cells[0]!, summary === '' ? `Entry ${position}` : summary);
      const up = button('Up', { 'aria-label': `Move entry ${position} up`, class: 'ghost' });
      up.addEventListener('click', () => moveEntry(entry.id, Math.max(0, entry.order - 1)));
      const down = button('Down', { 'aria-label': `Move entry ${position} down`, class: 'ghost' });
      down.addEventListener('click', () =>
        moveEntry(entry.id, Math.min(entries.length - 1, entry.order + 1)),
      );
      const edit = button('Edit', { 'aria-label': `Edit entry ${position}`, class: 'ghost' });
      edit.addEventListener('click', () => {
        editingEntryId = entry.id;
        render();
        focusables(entryEditor)[0]?.focus();
      });
      const remove = button('Delete', {
        'aria-label': `Delete entry ${position}`,
        class: 'ghost',
      });
      remove.addEventListener('click', () => deleteEntry(entry.id));
      cells[1]!.replaceChildren(up, down, edit, remove);
    },
  );
  const entry = entries.find((item) => item.id === editingEntryId);
  entryEditor.hidden = entry === undefined;
  if (entry === undefined) return;
  entryEditorFields.replaceChildren(
    ...fields.map((field) => {
      if (field.kind === 'image') {
        const select = el('select', { 'aria-label': field.name });
        select.dataset['field'] = field.name;
        select.append(el('option', { value: '' }, ['No image']));
        for (const image of state.images) {
          select.append(el('option', { value: image.id }, [image.fileName]));
        }
        select.value = entry.values[field.name] ?? '';
        return el('div', { class: 'row' }, [el('label', {}, [field.name]), select]);
      }
      const input = el('textarea', { 'aria-label': field.name, rows: '2' });
      input.dataset['field'] = field.name;
      input.value = entry.values[field.name] ?? '';
      return el('div', { class: 'row' }, [input]);
    }),
  );
}

function renderImages(): void {
  patchChildren<ImageRecord>(
    imageList,
    state.images,
    (image) => image.id,
    () => el('li'),
    (row, image) => {
      setText(row, image.fileName);
    },
  );
}

function renderVersions(): void {
  patchChildren<VersionSummary>(
    versionList,
    state.versions,
    (version) => version.id,
    () => el('li'),
    (row, version) => {
      const link =
        row.querySelector('a') ??
        el('a', { href: '#' });
      if (!link.isConnected) {
        row.append(link);
        link.addEventListener('click', (event) => {
          event.preventDefault();
          void openPreview(link.dataset['version']!);
        });
      }
      link.dataset['version'] = version.id;
      link.href = `/w/${state.workspaceId}/edit?page=${state.pageId}&version=${version.id}`;
      setText(link, versionLine(version));
    },
  );
}

function threadArticle(thread: Thread): HTMLElement {
  const article = el('article', {
    'aria-label': `Comment by ${thread.author.name} on ${thread.nodeName}`,
  });
  article.dataset['thread'] = thread.id;
  return article;
}

function updateThread(article: HTMLElement, thread: Thread): void {
  setAttr(article, 'aria-label', `Comment by ${thread.author.name} on ${thread.nodeName}`);
  const reply = button('Reply', { class: 'ghost' });
  reply.dataset['replyButton'] = 'true';
  const replyBox = el('textarea', { 'aria-label': `Reply to ${thread.author.name}`, rows: '2', hidden: true });
  const sendReply = button('Send reply', { class: 'ghost', hidden: true });
  reply.addEventListener('click', () => {
    replyBox.hidden = false;
    sendReply.hidden = false;
    replyBox.focus();
  });
  sendReply.addEventListener('click', () => {
    void replyToThread(thread.id, replyBox.value).then(() => {
      replyBox.value = '';
    });
  });
  const toggle =
    thread.status === 'open'
      ? button('Resolve', { class: 'ghost' })
      : button('Reopen', { class: 'ghost' });
  toggle.addEventListener('click', () => {
    void setThreadStatus(thread.id, thread.status === 'open');
  });
  article.replaceChildren(
    el('p', { class: 'comment-author' }, [thread.author.name]),
    el('p', { class: 'comment-body' }, [thread.body]),
    ...thread.replies.map((item) =>
      el('p', { class: 'comment-reply' }, [`${item.author.name}: ${item.body}`]),
    ),
    reply,
    toggle,
    replyBox,
    sendReply,
  );
}

function renderComments(): void {
  const threads = state.threads.filter((thread) => thread.pageId === state.pageId);
  const open = threads.filter((thread) => thread.status === 'open');
  const resolved = threads.filter((thread) => thread.status === 'resolved');
  patchChildren(threadList, open, (thread) => thread.id, threadArticle, updateThread);
  patchChildren(resolvedList, resolved, (thread) => thread.id, threadArticle, updateThread);
  setText(resolvedHeading, `Resolved (${resolved.length})`);
  const comments = sections.get('comments')!;
  if (state.layout === 'phone') {
    setAttr(comments, 'role', 'dialog');
    setAttr(comments, 'aria-modal', 'true');
  } else {
    setAttr(comments, 'role', 'region');
    comments.removeAttribute('aria-modal');
  }
  commentBox.disabled = state.selectedId === null;
  renderPins();
}

function pinsLayer(): HTMLElement {
  const existing = document.getElementById('pins');
  if (existing) return existing;
  const made = el('div', { id: 'pins' });
  canvasElement().append(made);
  return made;
}

function renderPins(): void {
  const layer = pinsLayer();
  const threads = state.threads.filter(
    (thread) =>
      thread.pageId === state.pageId &&
      thread.status === 'open' &&
      nodeById(thread.nodeId) !== undefined,
  );
  const canvasRect = canvasElement().getBoundingClientRect();
  patchChildren(
    layer,
    threads,
    (thread) => thread.id,
    (thread) => {
      const pin = button('1', {
        id: `pin-${thread.id}`,
        'aria-label': `Comment by ${thread.author.name} on ${thread.nodeName}`,
        class: 'pin',
      });
      pin.addEventListener('click', () => {
        selectNode(thread.nodeId);
        openPanel('comments');
      });
      return pin;
    },
    (pin, thread) => {
      setAttr(pin, 'aria-label', `Comment by ${thread.author.name} on ${thread.nodeName}`);
      const node = frameElement(state.bp).querySelector<HTMLElement>(
        `[data-node-id="${thread.nodeId}"]`,
      );
      if (!node) {
        pin.hidden = true;
        return;
      }
      pin.hidden = false;
      const rect = node.getBoundingClientRect();
      pin.style.left = `${rect.right - canvasRect.left + canvasElement().scrollLeft - 14}px`;
      pin.style.top = `${rect.top - canvasRect.top + canvasElement().scrollTop - 14}px`;
    },
  );
}

function renderPublish(): void {
  const page = currentPage();
  setText(publishState, PUBLISH_STATE_TEXT[state.publish.state]);
  const url = state.publish.url ?? '';
  publishLink.hidden = url === '';
  publishLink.href = url === '' ? '#' : url;
  setText(publishLink, url);
  const readOnlyPublish = state.layout === 'phone';
  publishButton.hidden = !canEdit() || readOnlyPublish;
  publishButton.disabled = state.busy.publish;
  if (state.busy.publish) publishButton.setAttribute('aria-busy', 'true');
  else publishButton.removeAttribute('aria-busy');
  unpublishButton.hidden =
    readOnlyPublish ||
    state.role !== 'owner' ||
    (state.publish.state !== 'live' && state.publish.state !== 'live_changed');
  retryButton.hidden = !state.publishFailed || !canEdit() || readOnlyPublish;
  retryButton.disabled = state.busy.publish;
  if (state.busy.publish) retryButton.setAttribute('aria-busy', 'true');
  else retryButton.removeAttribute('aria-busy');
  void page;
}

export function renderSheet(): void {
  sheetElement();
  renderTokens();
  renderFields();
  renderEntries();
  renderImages();
  renderVersions();
  renderComments();
  renderPublish();
  for (const [name, element] of sections) {
    const visible = state.panel === name;
    element.hidden = !visible;
    if (visible) element.removeAttribute('inert');
    else element.setAttribute('inert', '');
  }
  sheet!.hidden = state.panel === 'none';
  sheet!.classList.toggle('phone', state.layout === 'phone');
}
