import { uploadCopy } from '../../shared/copy';
import { LABELS, type BoardRole, type Visibility } from '../../shared/types';
import {
  addChecklistItem,
  addMember,
  cardFocusKey,
  changeBoardVisibility,
  changeMemberRole,
  changePassword,
  createBoard,
  deleteCard,
  deleteChecklistItem,
  downloadAttachment,
  loadSettings,
  moveCard,
  renameChecklistItem,
  removeAttachment,
  removeMember,
  saveCard,
  setPrivateMembers,
  toggleChecklistItem,
  uploadAttachment,
} from '../actions';
import { el } from '../lib/dom';
import { closeCardDialog } from '../navigation';
import { signOut } from '../session';
import {
  canEdit,
  cardOf,
  isBoardAdmin,
  isWorkspaceAdmin,
  listOf,
  listOfCard,
  requestRender,
  state,
  type Dialog,
  type Menu,
} from '../store';
import { renderDrawer, statusMenuAction } from './board';

const KEY_MAP: [string, string, string][] = [
  ['Space', 'focus on a card button', 'lifts the card'],
  ['Up Arrow / Down Arrow', 'card lifted', 'one position up or down in the current list, stopping at the ends'],
  [
    'Left Arrow / Right Arrow',
    'card lifted',
    'to the previous or next list, keeping the same position number when it exists, otherwise last',
  ],
  ['Space or Enter', 'card lifted', 'drops the card where it is'],
  ['Escape', 'card lifted', 'cancels; the card returns to where it started'],
  ['Tab', 'card lifted', 'cancels, then moves focus as usual'],
  ['Enter', 'focus on a card button, not lifted', 'opens the card dialog'],
  ['?', 'focus on any control in the board area that is not a text field', 'opens the Keyboard shortcuts dialog'],
  ['Escape', 'a dialog, sheet or menu is open', 'closes it and returns focus to the control that opened it'],
];

function dialogShell(label: string, extraClass = ''): HTMLElement {
  return el('div', {
    class: `dialog ${extraClass}`.trim(),
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': label },
  });
}

function closeButton(onClose: () => void): HTMLElement {
  return el('button', {
    class: 'close',
    text: 'Close',
    focusKey: 'dlg:close',
    attrs: { type: 'button' },
    on: { click: onClose },
  });
}

export function menuOpenerKey(menu: Menu): string {
  if (menu.kind === 'account') return 'account';
  if (menu.kind === 'cardActions') return `actions:${menu.cardId}`;
  return `role:${menu.userId}`;
}

function openerFor(dialog: Dialog): string {
  switch (dialog.kind) {
    case 'newBoard':
      return 'newboard';
    case 'move':
      return `actions:${dialog.cardId}`;
    case 'settings':
      return 'settings';
    case 'shortcuts':
      return 'shortcuts';
    case 'password':
      return 'account';
    case 'boardsSheet':
      return 'boards';
    case 'deleteCard':
      return 'dlg:delete';
    case 'card':
      return cardFocusKey(dialog.cardId);
    default:
      return 'account';
  }
}

export function closeTopLayer(): void {
  if (state.menu !== null) {
    const opener = menuOpenerKey(state.menu);
    state.menu = null;
    state.pendingFocus = opener;
    requestRender();
    return;
  }
  const dialog = state.dialog;
  if (dialog === null) return;
  if (dialog.kind === 'card') {
    closeCardDialog();
    return;
  }
  state.dialog = null;
  state.pendingFocus = openerFor(dialog);
  requestRender();
}

function groupTitle(text: string): HTMLElement {
  return el('p', { class: 'group-title', text });
}

function textField(
  label: string,
  key: string,
  value: string,
  onInput: (value: string) => void,
  options: { type?: string; multiline?: boolean; error?: string | null; onEnter?: (value: string) => void } = {},
): HTMLElement {
  const wrap = el('div', { class: 'field-row' });
  wrap.append(groupTitle(label));
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || options.onEnter === undefined) return;
    event.preventDefault();
    options.onEnter((event.target as HTMLInputElement).value);
  };
  if (options.multiline === true) {
    const area = el('textarea', {
      class: 'field',
      focusKey: key,
      attrs: { 'aria-label': label },
      on: { input: (event: Event) => onInput((event.target as HTMLTextAreaElement).value) },
    });
    area.value = value;
    wrap.append(area);
  } else {
    const input = el('input', {
      class: 'field',
      focusKey: key,
      attrs: { type: options.type ?? 'text', 'aria-label': label },
      on: {
        input: (event: Event) => onInput((event.target as HTMLInputElement).value),
        keydown: onKeyDown,
      },
    });
    input.value = value;
    wrap.append(input);
  }
  if (options.error !== undefined && options.error !== null) {
    wrap.append(el('p', { class: 'field-error', text: options.error }));
  }
  return wrap;
}

function editableMembers(): { userId: string; displayName: string }[] {
  return state.boardMembers
    .filter((person) => person.role !== 'observer' && person.userId !== undefined)
    .map((person) => ({ userId: person.userId as string, displayName: person.displayName }));
}

function cardDialog(dialog: Extract<Dialog, { kind: 'card' }>): HTMLElement {
  const card = cardOf(dialog.cardId);
  if (card === null) return dialogShell('');
  const node = dialogShell(card.title, 'card-dialog');
  const editable = canEdit();
  const draftOf = (field: string, fallback: string): string =>
    field in dialog.drafts ? (dialog.drafts[field] as string) : fallback;

  node.append(el('h2', { class: 'dialog-title', text: card.title }));

  if (editable) {
    node.append(
      textField(
        'Title',
        'dlg:title',
        draftOf('title', card.title),
        (value) => {
          dialog.drafts['title'] = value;
        },
        { error: dialog.fieldErrors['title'] ?? null },
      ),
    );
    node.append(
      textField(
        'Notes',
        'dlg:notes',
        draftOf('notes', card.notes ?? ''),
        (value) => {
          dialog.drafts['notes'] = value;
        },
        { multiline: true, error: dialog.fieldErrors['notes'] ?? null },
      ),
    );
    node.append(
      textField(
        'Due date',
        'dlg:dueDate',
        draftOf('dueDate', card.dueDate ?? ''),
        (value) => {
          dialog.drafts['dueDate'] = value;
        },
        { type: 'date', error: dialog.fieldErrors['dueDate'] ?? null },
      ),
    );
    node.append(groupTitle('Owner'));
    const owner = el('select', {
      class: 'field',
      focusKey: 'dlg:owner',
      attrs: { 'aria-label': 'Owner' },
      on: {
        change: (event: Event) => {
          dialog.drafts['ownerUserId'] = (event.target as HTMLSelectElement).value;
        },
      },
    });
    owner.append(el('option', { text: 'Nobody', attrs: { value: '' } }));
    for (const member of editableMembers()) {
      owner.append(el('option', { text: member.displayName, attrs: { value: member.userId } }));
    }
    owner.value = draftOf('ownerUserId', card.owner?.userId ?? '');
    node.append(owner);
  } else {
    if (card.dueDate !== null) node.append(el('p', { class: 'read-only', text: card.dueDate }));
    if (card.owner !== null) node.append(el('p', { class: 'read-only', text: card.owner.displayName }));
  }

  if (!editable) {
    node.append(el('p', { class: 'read-only', text: card.labels.join(', ') }));
  }
  const labels = el('div', { class: 'labels', attrs: { role: 'group', 'aria-label': 'Labels' } });
  const chosen = new Set(dialog.labelDraft ?? card.labels);
  for (const label of LABELS) {
    const id = `label-${label}`;
    labels.append(
      el('label', { attrs: { for: id } }, [
        el('input', {
          focusKey: `dlg:label:${label}`,
          attrs: {
            type: 'checkbox',
            id,
            ...(chosen.has(label) ? { checked: 'checked' } : {}),
          },
          on: {
            change: (event: Event) => {
              const next = new Set(dialog.labelDraft ?? card.labels);
              if ((event.target as HTMLInputElement).checked) next.add(label);
              else next.delete(label);
              dialog.labelDraft = LABELS.filter((entry) => next.has(entry));
              requestRender();
            },
          },
        }),
        document.createTextNode(label),
      ]),
    );
  }
  if (editable) {
    labels.prepend(groupTitle('Labels'));
    node.append(labels);
  }

  const checklist = el('div', { class: 'checklist', attrs: { role: 'group', 'aria-label': 'Checklist' } });
  checklist.append(groupTitle('Checklist'));
  for (const item of card.checklist) {
    const id = `item-${item.id}`;
    const row = el('div', { class: 'checklist-row' }, [
      el('label', { attrs: { for: id } }, [
        el('input', {
          focusKey: `dlg:item:${item.id}`,
          attrs: {
            type: 'checkbox',
            id,
            'aria-label': item.text,
            ...(item.done ? { checked: 'checked' } : {}),
            ...(editable ? {} : { disabled: 'disabled' }),
          },
          on: {
            change: (event: Event) =>
              void toggleChecklistItem(card.id, item.id, (event.target as HTMLInputElement).checked),
          },
        }),
        document.createTextNode(item.text),
      ]),
    ]);
    if (editable) {
      const rename = el('input', {
        class: 'field rename',
        focusKey: `dlg:rename:${item.id}`,
        attrs: { type: 'text', 'aria-label': `Rename ${item.text}` },
        on: {
          keydown: (event: KeyboardEvent) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void renameChecklistItem(card.id, item.id, (event.target as HTMLInputElement).value);
          },
          blur: (event: Event) => {
            const value = (event.target as HTMLInputElement).value;
            if (value !== '' && value !== item.text) void renameChecklistItem(card.id, item.id, value);
          },
        },
      });
      rename.value = item.text;
      row.append(rename);
      row.append(
        el('button', {
          class: 'subtle',
          text: `Delete ${item.text}`,
          focusKey: `dlg:deleteitem:${item.id}`,
          attrs: { type: 'button' },
          on: { click: () => void deleteChecklistItem(card.id, item.id) },
        }),
      );
    }
    checklist.append(row);
  }
  if (editable) {
    checklist.append(
      textField(
        'New checklist item',
        'dlg:newItem',
        dialog.drafts['newItem'] ?? '',
        (value) => {
          dialog.drafts['newItem'] = value;
        },
        {
          error: dialog.fieldErrors['newItem'] ?? null,
          onEnter: (value) => void addChecklistItem(card.id, value),
        },
      ),
    );
    checklist.append(
      el('button', {
        class: 'subtle',
        text: 'Add item',
        focusKey: 'dlg:addItem',
        attrs: { type: 'button' },
        on: { click: () => void addChecklistItem(card.id, dialog.drafts['newItem'] ?? '') },
      }),
    );
  }
  node.append(checklist);

  if (editable) {
    const privacy = el('div', { class: 'privacy', attrs: { role: 'group', 'aria-label': 'Who can see this card' } });
    privacy.append(groupTitle('Who can see this card'));
    const privateIds = new Set((card.privateMembers ?? []).map((member) => member.userId));
    privacy.append(
      el('label', { attrs: { for: 'privacy-everyone' } }, [
        el('input', {
          focusKey: 'dlg:privacy:everyone',
          attrs: {
            type: 'checkbox',
            id: 'privacy-everyone',
            'aria-label': 'Everyone on this board',
            ...(privateIds.size === 0 ? { checked: 'checked' } : {}),
          },
          on: { change: () => void setPrivateMembers(card.id, []) },
        }),
        document.createTextNode('Everyone on this board'),
      ]),
    );
    for (const member of editableMembers()) {
      privacy.append(
        el('label', { attrs: { for: `privacy-${member.userId}` } }, [
          el('input', {
            focusKey: `dlg:privacy:${member.userId}`,
            attrs: {
              type: 'checkbox',
              id: `privacy-${member.userId}`,
              'aria-label': member.displayName,
              ...(privateIds.has(member.userId) ? { checked: 'checked' } : {}),
            },
            on: {
              change: (event: Event) => {
                const next = new Set(privateIds);
                if ((event.target as HTMLInputElement).checked) {
                  next.add(member.userId);
                  const me = state.me?.userId;
                  if (me !== undefined) next.add(me);
                } else {
                  next.delete(member.userId);
                }
                void setPrivateMembers(card.id, [...next]);
              },
            },
          }),
          document.createTextNode(member.displayName),
        ]),
      );
    }
    node.append(privacy);

    const attachments = el('div', { class: 'attachments' });
    attachments.append(groupTitle('Attachments'));
    const picker = el('input', {
      class: 'visually-hidden',
      attrs: { type: 'file', tabindex: '-1', 'aria-hidden': 'true' },
      on: {
        change: (event: Event) => {
          const file = (event.target as HTMLInputElement).files?.[0];
          if (file !== undefined) void uploadAttachment(card.id, file);
        },
      },
    });
    attachments.append(picker);
    attachments.append(
      el('button', {
        class: 'subtle',
        text: 'Attach a file',
        focusKey: 'dlg:attach',
        attrs: { type: 'button' },
        on: { click: () => picker.click() },
      }),
    );
    const list = el('ul', { class: 'attachment-list', attrs: { 'aria-label': 'Attachments' } });
    for (const attachment of card.attachments ?? []) {
      list.append(
        el('li', {}, [
          el('a', {
            text: attachment.filename,
            focusKey: `dlg:att:${attachment.id}`,
            attrs: { href: `/api/attachments/${attachment.id}` },
            on: {
              click: (event: MouseEvent) => {
                event.preventDefault();
                void downloadAttachment(attachment.id, attachment.filename);
              },
            },
          }),
          el('button', {
            class: 'subtle',
            text: `Remove ${attachment.filename}`,
            focusKey: `dlg:rmatt:${attachment.id}`,
            attrs: { type: 'button' },
            on: { click: () => void removeAttachment(card.id, attachment.id, attachment.filename) },
          }),
        ]),
      );
    }
    for (const pending of dialog.uploads) {
      list.append(
        el('li', { class: 'uploading' }, [
          el('span', { text: uploadCopy.pending(pending.filename) }),
          el('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }),
        ]),
      );
    }
    attachments.append(list);
    node.append(attachments);
  }

  const footer = el('div', { class: 'dialog-footer' });
  if (editable) {
    footer.append(
      el('button', {
        class: 'primary',
        text: dialog.pending ? 'Saving…' : 'Save changes',
        focusKey: 'dlg:save',
        attrs: { type: 'button' },
        on: { click: () => void saveCard() },
      }),
    );
  }
  footer.append(closeButton(() => closeCardDialog()));
  if (isBoardAdmin()) {
    footer.append(
      el('button', {
        class: 'danger',
        text: 'Delete card',
        focusKey: 'dlg:delete',
        attrs: { type: 'button' },
        on: {
          click: () => {
            state.dialog = { kind: 'deleteCard', cardId: card.id, pending: false };
            state.pendingFocus = 'dlg:confirmDelete';
            requestRender();
          },
        },
      }),
    );
  }
  node.append(footer);
  return node;
}

function deleteCardDialog(dialog: Extract<Dialog, { kind: 'deleteCard' }>): HTMLElement {
  const node = el('div', {
    class: 'dialog alert',
    attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Delete this card?' },
  });
  node.append(el('h2', { text: 'Delete this card?' }));
  node.append(
    el('button', {
      class: 'danger',
      text: dialog.pending ? 'Deleting…' : 'Delete',
      focusKey: 'dlg:confirmDelete',
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (state.dialog?.kind === 'deleteCard') state.dialog.pending = true;
          void deleteCard(dialog.cardId);
        },
      },
    }),
  );
  node.append(
    el('button', {
      text: 'Keep card',
      focusKey: 'dlg:keepCard',
      attrs: { type: 'button' },
      on: {
        click: () => {
          state.dialog = null;
          state.pendingFocus = cardFocusKey(dialog.cardId);
          requestRender();
        },
      },
    }),
  );
  return node;
}

function visibilityRadios(
  label: string,
  current: Visibility,
  name: string,
  onChoose: (value: Visibility) => void,
): HTMLElement {
  const group = el('div', { class: 'radios', attrs: { role: 'radiogroup', 'aria-label': label } });
  group.append(groupTitle(label));
  const options: [Visibility, string][] = [
    ['workspace', 'Everyone in this workspace'],
    ['private', 'Only board members'],
  ];
  for (const [value, text] of options) {
    const id = `${name}-${value}`;
    group.append(
      el('label', { attrs: { for: id } }, [
        el('input', {
          focusKey: `dlg:${name}:${value}`,
          attrs: {
            type: 'radio',
            name,
            id,
            value,
            'aria-label': text,
            ...(current === value ? { checked: 'checked' } : {}),
          },
          on: { change: () => onChoose(value) },
        }),
        document.createTextNode(text),
      ]),
    );
  }
  return group;
}

function newBoardDialog(dialog: Extract<Dialog, { kind: 'newBoard' }>): HTMLElement {
  const node = dialogShell('New board');
  node.append(el('h2', { text: 'New board' }));
  node.append(
    textField(
      'Board name',
      'dlg:boardName',
      dialog.name,
      (value) => {
        dialog.name = value;
      },
      { error: dialog.error },
    ),
  );
  node.append(
    visibilityRadios('Who can see this board', dialog.visibility, 'newBoardVisibility', (value) => {
      dialog.visibility = value;
      requestRender();
    }),
  );
  node.append(
    el('button', {
      class: 'primary',
      text: dialog.pending ? 'Creating…' : 'Create board',
      focusKey: 'dlg:createBoard',
      attrs: { type: 'button' },
      on: { click: () => void createBoard(dialog.name, dialog.visibility) },
    }),
  );
  node.append(
    el('button', {
      text: 'Cancel',
      focusKey: 'dlg:cancel',
      attrs: { type: 'button' },
      on: { click: () => closeTopLayer() },
    }),
  );
  return node;
}

function moveDialog(dialog: Extract<Dialog, { kind: 'move' }>): HTMLElement {
  const node = dialogShell('Move card');
  const card = cardOf(dialog.cardId);
  node.append(el('h2', { text: 'Move card' }));
  const listSelect = el('select', {
    class: 'field',
    focusKey: 'dlg:moveList',
    attrs: { 'aria-label': 'List' },
    on: {
      change: (event: Event) => {
        const value = (event.target as HTMLSelectElement).value;
        dialog.listId = value;
        const target = listOf(value);
        const sameList = card !== null && card.listId === value;
        dialog.position = (target?.cards.length ?? 0) + (sameList ? 0 : 1);
        requestRender();
      },
    },
  });
  for (const list of state.board?.lists ?? []) {
    listSelect.append(el('option', { text: list.name, attrs: { value: list.id } }));
  }
  listSelect.value = dialog.listId;
  node.append(listSelect);

  const target = listOf(dialog.listId);
  const sameList = card !== null && card.listId === dialog.listId;
  const highest = Math.max((target?.cards.length ?? 0) + (sameList ? 0 : 1), 1);
  const positionSelect = el('select', {
    class: 'field',
    focusKey: 'dlg:movePosition',
    attrs: { 'aria-label': 'Position' },
    on: {
      change: (event: Event) => {
        dialog.position = Number((event.target as HTMLSelectElement).value);
      },
    },
  });
  for (let index = 1; index <= highest; index += 1) {
    positionSelect.append(el('option', { text: String(index), attrs: { value: String(index) } }));
  }
  positionSelect.value = String(Math.min(dialog.position, highest));
  node.append(positionSelect);
  node.append(
    el('button', {
      class: 'primary',
      text: 'Move',
      focusKey: 'dlg:moveConfirm',
      attrs: { type: 'button' },
      on: {
        click: () => {
          const { cardId, listId, position } = dialog;
          state.dialog = null;
          requestRender();
          void moveCard(cardId, listId, position, { focusCard: true });
        },
      },
    }),
  );
  node.append(
    el('button', {
      text: 'Cancel',
      focusKey: 'dlg:cancel',
      attrs: { type: 'button' },
      on: { click: () => closeTopLayer() },
    }),
  );
  return node;
}

function roleText(role: BoardRole): string {
  if (role === 'admin') return 'Admin';
  return role === 'member' ? 'Member' : 'Observer';
}

function settingsDialog(dialog: Extract<Dialog, { kind: 'settings' }>): HTMLElement {
  const node = dialogShell('Board settings');
  node.append(el('h2', { text: 'Board settings' }));
  if (dialog.error !== null) {
    node.append(el('p', { class: 'field-error', text: dialog.error, attrs: { role: 'alert' } }));
  }
  node.append(
    visibilityRadios(
      'Who can see this board',
      state.board?.board.visibility ?? 'private',
      'boardVisibility',
      (value) => void changeBoardVisibility(value),
    ),
  );

  node.append(groupTitle('Board members'));
  const table = el('table', { class: 'members', attrs: { 'aria-label': 'Board members' } });
  table.append(
    el('thead', {}, [el('tr', {}, [el('th', { text: 'Person' }), el('th', { text: 'Role' })])]),
  );
  const body = el('tbody');
  for (const member of state.settings?.members ?? []) {
    const userId = member.userId ?? '';
    body.append(
      el('tr', {}, [
        el('td', { text: member.displayName }),
        el('td', {}, [
          el('button', {
            class: 'role-button',
            text: roleText(member.role ?? 'observer'),
            focusKey: `role:${userId}`,
            attrs: {
              type: 'button',
              'aria-label': `Role for ${member.displayName}`,
              'aria-haspopup': 'menu',
              'aria-expanded': state.menu?.kind === 'role' && state.menu.userId === userId ? 'true' : 'false',
            },
            on: {
              click: () => {
                state.menu = { kind: 'role', userId };
                state.pendingFocus = 'menu:first';
                requestRender();
              },
            },
          }),
        ]),
      ]),
    );
  }
  table.append(body);
  node.append(table);

  const picker = el('select', {
    class: 'field',
    focusKey: 'dlg:addPerson',
    attrs: { 'aria-label': 'Add a person' },
    on: {
      change: (event: Event) => {
        dialog.addUserId = (event.target as HTMLSelectElement).value;
      },
    },
  });
  picker.append(el('option', { text: 'Choose a person', attrs: { value: '' } }));
  for (const person of state.settings?.candidates ?? []) {
    picker.append(el('option', { text: person.displayName, attrs: { value: person.userId } }));
  }
  picker.value = dialog.addUserId;
  node.append(picker);
  node.append(
    el('button', {
      text: 'Add to board',
      focusKey: 'dlg:addToBoard',
      attrs: { type: 'button' },
      on: { click: () => void addMember(dialog.addUserId) },
    }),
  );
  node.append(closeButton(() => closeTopLayer()));
  return node;
}

function shortcutsDialog(): HTMLElement {
  const node = dialogShell('Keyboard shortcuts');
  node.append(el('h2', { text: 'Keyboard shortcuts' }));
  const table = el('table', { class: 'shortcuts-table' });
  table.append(
    el('thead', {}, [
      el('tr', {}, [el('th', { text: 'Key' }), el('th', { text: 'When' }), el('th', { text: 'Effect' })]),
    ]),
  );
  const body = el('tbody');
  for (const [key, when, effect] of KEY_MAP) {
    body.append(el('tr', {}, [el('td', { text: key }), el('td', { text: when }), el('td', { text: effect })]));
  }
  table.append(body);
  node.append(table);
  node.append(closeButton(() => closeTopLayer()));
  return node;
}

function passwordDialog(dialog: Extract<Dialog, { kind: 'password' }>): HTMLElement {
  const node = dialogShell('Change password');
  node.append(el('h2', { text: 'Change password' }));
  node.append(
    textField(
      'Current password',
      'dlg:currentPassword',
      dialog.currentPassword,
      (value) => {
        dialog.currentPassword = value;
      },
      { type: 'password', error: dialog.errors['currentPassword'] ?? null },
    ),
  );
  node.append(
    textField(
      'New password',
      'dlg:newPassword',
      dialog.newPassword,
      (value) => {
        dialog.newPassword = value;
      },
      { type: 'password', error: dialog.errors['newPassword'] ?? null },
    ),
  );
  node.append(
    el('div', { class: 'dialog-status', attrs: { role: 'status', 'aria-live': 'polite' } }, [
      dialog.message === null ? null : el('p', { text: dialog.message }),
    ]),
  );
  node.append(
    el('button', {
      class: 'primary',
      text: dialog.pending ? 'Changing…' : 'Change password',
      focusKey: 'dlg:changePassword',
      attrs: { type: 'button' },
      on: { click: () => void changePassword(dialog.currentPassword, dialog.newPassword) },
    }),
  );
  node.append(closeButton(() => closeTopLayer()));
  return node;
}

function boardsSheet(): HTMLElement {
  const node = dialogShell('Boards', 'sheet');
  node.append(renderDrawer());
  node.append(closeButton(() => closeTopLayer()));
  return node;
}

function menuItem(
  label: string,
  key: string,
  onChoose: () => void,
  options: { role?: string; checked?: boolean } = {},
): HTMLElement {
  return el('button', {
    class: 'menu-item',
    text: label,
    focusKey: key,
    attrs: {
      type: 'button',
      role: options.role ?? 'menuitem',
      ...(options.checked === undefined ? {} : { 'aria-checked': options.checked ? 'true' : 'false' }),
    },
    on: { click: onChoose },
  });
}

function accountMenu(): HTMLElement {
  const node = el('div', {
    class: 'menu',
    attrs: { role: 'menu', 'aria-label': 'Account', 'data-anchor': 'account' },
  });
  node.append(
    menuItem('Change password', 'menu:first', () => {
      state.menu = null;
      state.dialog = {
        kind: 'password',
        currentPassword: '',
        newPassword: '',
        message: null,
        errors: {},
        pending: false,
      };
      state.pendingFocus = 'dlg:currentPassword';
      requestRender();
    }),
  );
  if (isWorkspaceAdmin()) {
    node.append(
      menuItem('Permission log', 'menu:log', () => {
        state.menu = null;
        void openPermissionLogPage();
      }),
    );
  }
  node.append(
    menuItem('Sign out', 'menu:signout', () => {
      state.menu = null;
      void signOut();
    }),
  );
  return node;
}

async function openPermissionLogPage(): Promise<void> {
  const workspace = state.workspace;
  if (workspace === null) return;
  const { push } = await import('../router');
  const { openPermissionLog } = await import('./log');
  push(`/workspaces/${workspace.id}/permission-log`);
  await openPermissionLog();
}

function cardActionsMenu(cardId: string): HTMLElement | null {
  const card = cardOf(cardId);
  if (card === null) return null;
  const node = el('div', {
    class: 'menu',
    attrs: { role: 'menu', 'aria-label': `Actions for ${card.title}`, 'data-anchor': `actions:${card.id}` },
  });
  node.append(
    menuItem('Move to…', 'menu:first', () => {
      const list = listOfCard(card.id);
      state.menu = null;
      state.dialog = { kind: 'move', cardId: card.id, listId: list?.id ?? '', position: card.position ?? 1 };
      state.pendingFocus = 'dlg:moveList';
      requestRender();
    }),
  );
  node.append(
    card.status === 'done'
      ? menuItem('Reopen', 'menu:status', () => statusMenuAction(card.id, 'open'))
      : menuItem('Mark done', 'menu:status', () => statusMenuAction(card.id, 'done')),
  );
  node.append(menuItem('Archive', 'menu:archive', () => statusMenuAction(card.id, 'archived')));
  return node;
}

function roleMenu(userId: string): HTMLElement | null {
  const member = state.settings?.members.find((person) => person.userId === userId);
  if (member === undefined) return null;
  const node = el('div', {
    class: 'menu',
    attrs: { role: 'menu', 'aria-label': `Role for ${member.displayName}`, 'data-anchor': `role:${userId}` },
  });
  const roles: [BoardRole, string][] = [
    ['admin', 'Admin'],
    ['member', 'Member'],
    ['observer', 'Observer'],
  ];
  roles.forEach(([role, label], index) => {
    node.append(
      menuItem(label, index === 0 ? 'menu:first' : `menu:${role}`, () => void changeMemberRole(userId, role), {
        role: 'menuitemradio',
        checked: member.role === role,
      }),
    );
  });
  node.append(menuItem('Remove from board', 'menu:remove', () => void removeMember(userId)));
  return node;
}

function renderMenu(): HTMLElement | null {
  const menu = state.menu;
  if (menu === null) return null;
  if (menu.kind === 'account') return accountMenu();
  if (menu.kind === 'cardActions') return cardActionsMenu(menu.cardId);
  return roleMenu(menu.userId);
}

export function renderOverlay(): DocumentFragment | null {
  const dialog = state.dialog;
  const menu = renderMenu();
  if (dialog === null && menu === null) return null;
  const fragment = document.createDocumentFragment();
  if (dialog !== null) {
    const layer = el('div', { class: 'overlay' });
    if (dialog.kind === 'card') layer.append(cardDialog(dialog));
    if (dialog.kind === 'newBoard') layer.append(newBoardDialog(dialog));
    if (dialog.kind === 'move') layer.append(moveDialog(dialog));
    if (dialog.kind === 'settings') layer.append(settingsDialog(dialog));
    if (dialog.kind === 'shortcuts') layer.append(shortcutsDialog());
    if (dialog.kind === 'password') layer.append(passwordDialog(dialog));
    if (dialog.kind === 'boardsSheet') layer.append(boardsSheet());
    if (dialog.kind === 'deleteCard') layer.append(deleteCardDialog(dialog));
    fragment.append(layer);
  }
  if (menu !== null) fragment.append(menu);
  return fragment;
}

export async function reloadSettingsIfOpen(): Promise<void> {
  if (state.dialog?.kind === 'settings') await loadSettings();
}
