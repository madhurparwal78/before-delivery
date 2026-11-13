// Dialogs: card, move, settings, new board, shortcuts, password, delete confirm, boards sheet.
import { api, isApiError } from './api.js';
import { copy, KEY_MAP } from './copy.js';
import type { ViewContext } from './views.js';
import type { ApiErrorBody, Card, Role } from '../shared/protocol.js';
import { buttonEl, el } from './dom.js';

const LABELS = ['Medication', 'Appointment', 'Bills', 'Visit', 'Paperwork'] as const;

export function renderShortcutsDialog(ctx: ViewContext): HTMLElement {
  const table = el('table', { class: 'permission-table' });
  const head = el('thead', {}, el('tr', {},
    el('th', { text: 'Key' }), el('th', { text: 'When' }), el('th', { text: 'Effect' })));
  const body = el('tbody');
  for (const row of KEY_MAP) {
    body.append(el('tr', {}, el('td', { text: row.key }), el('td', { text: row.when }), el('td', { text: row.effect })));
  }
  table.append(head, body);
  const close = buttonEl({ class: 'secondary-button', text: copy.close, 'data-autofocus': 'true' });
  close.addEventListener('click', ctx.closeDialog);
  const dialog = el('div', { class: 'dialog-backdrop', 'data-dialog': 'shortcuts' },
    el('div', { class: 'dialog-panel', role: 'dialog', 'aria-label': copy.keyboardShortcutsTitle },
      el('h2', { class: 'dialog-title', text: copy.keyboardShortcutsTitle }),
      table,
      el('div', { class: 'dialog-actions' }, close)));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) ctx.closeDialog();
  });
  return dialog;
}

export function renderNewBoardDialog(ctx: ViewContext): HTMLElement {
  const name = el('input', { class: 'text-input', 'aria-label': copy.boardNameLabel, 'data-autofocus': 'true' }) as HTMLInputElement;
  const errorArea = el('div');
  const workspaceRadio = el('input', { type: 'radio', name: 'new-board-visibility', id: 'nb-workspace', value: 'workspace' }) as HTMLInputElement;
  const privateRadio = el('input', { type: 'radio', name: 'new-board-visibility', id: 'nb-private', value: 'private' }) as HTMLInputElement;
  privateRadio.checked = true;
  const radios = el('div', { role: 'radiogroup', 'aria-label': copy.visibilityGroup },
    el('label', { class: 'checklist-row' }, workspaceRadio, copy.visibilityEveryone),
    el('label', { class: 'checklist-row' }, privateRadio, copy.visibilityMembers));
  const create = buttonEl({ class: 'primary-button', text: copy.createBoard });
  const cancel = buttonEl({ class: 'secondary-button', text: copy.cancelButton });
  cancel.addEventListener('click', ctx.closeDialog);
  create.addEventListener('click', () => {
    void (async () => {
      create.textContent = copy.creatingBoard;
      create.disabled = true;
      const visibility = privateRadio.checked ? 'private' : 'workspace';
      const reply = await api.createBoard(ctx.store.activeWorkspaceId ?? '', name.value, visibility);
      create.disabled = false;
      create.textContent = copy.createBoard;
      if (isApiError(reply.body)) {
        const fields = (reply.body as ApiErrorBody).fields ?? {};
        errorArea.textContent = '';
        const message = fields['name'] ?? copy.boardNameRequired;
        errorArea.append(el('div', { class: 'field-error', text: message }));
        return;
      }
      const board = (reply.body as { board: { id: string } }).board;
      ctx.setDialogState(null);
      await ctx.refreshBoards();
      ctx.navigate(`/boards/${board.id}`);
      setTimeout(() => {
        const addList = document.querySelector('[data-add-list]') as HTMLElement | null;
        addList?.focus();
      }, 60);
    })();
  });
  const dialog = el('div', { class: 'dialog-backdrop', 'data-dialog': 'new-board' },
    el('div', { class: 'dialog-panel', role: 'dialog', 'aria-label': copy.newBoardButton },
      el('h2', { class: 'dialog-title', text: copy.newBoardButton }),
      el('div', { class: 'dialog-row' }, el('label', { text: copy.boardNameLabel }), name, errorArea),
      radios,
      el('div', { class: 'dialog-actions' }, cancel, create)));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) ctx.closeDialog();
  });
  return dialog;
}

export function renderChangePasswordDialog(ctx: ViewContext): HTMLElement {
  const current = el('input', { type: 'password', class: 'text-input', 'aria-label': copy.currentPassword, 'data-autofocus': 'true' }) as HTMLInputElement;
  const next = el('input', { type: 'password', class: 'text-input', 'aria-label': copy.newPassword }) as HTMLInputElement;
  const errorArea = el('div');
  const statusArea = el('div', { role: 'status' });
  const submit = buttonEl({ class: 'primary-button', text: copy.changePasswordButton });
  const close = buttonEl({ class: 'secondary-button', text: copy.close });
  close.addEventListener('click', ctx.closeDialog);
  submit.addEventListener('click', () => {
    void (async () => {
      submit.textContent = copy.changingPassword;
      submit.disabled = true;
      const reply = await api.changePassword(current.value, next.value);
      submit.disabled = false;
      submit.textContent = copy.changePasswordButton;
      if (reply.status === 422) {
        const fields = (reply.body as ApiErrorBody).fields ?? {};
        errorArea.textContent = '';
        if (fields['currentPassword']) {
          errorArea.append(el('div', { class: 'field-error', text: copy.wrongCurrentPassword }));
        }
        if (fields['newPassword']) {
          errorArea.append(el('div', { class: 'field-error', text: copy.passwordLength }));
        }
        return;
      }
      statusArea.textContent = copy.passwordChanged;
    })();
  });
  const dialog = el('div', { class: 'dialog-backdrop', 'data-dialog': 'change-password' },
    el('div', { class: 'dialog-panel', role: 'dialog', 'aria-label': copy.passwordTitle },
      el('h2', { class: 'dialog-title', text: copy.passwordTitle }),
      el('div', { class: 'dialog-row' }, el('label', { text: copy.currentPassword }), current),
      el('div', { class: 'dialog-row' }, el('label', { text: copy.newPassword }), next),
      errorArea,
      statusArea,
      el('div', { class: 'dialog-actions' }, close, submit)));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) ctx.closeDialog();
  });
  return dialog;
}

export function renderBoardsSheetDialog(ctx: ViewContext): HTMLElement {
  const list = el('ul');
  for (const board of ctx.store.boards) {
    const link = el('a', { class: 'drawer-link', href: `/boards/${board.id}`, text: board.name });
    const count = el('span', { class: 'drawer-count', text: board.openCards === 1 ? '1 open' : `${board.openCards} open` });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      ctx.closeDialog();
      ctx.navigate(`/boards/${board.id}`);
    });
    list.append(el('li', { class: 'drawer-link-row' }, link, count));
  }
  const nav = el('nav', { 'aria-label': copy.boardsButton }, list);
  const isWorkspaceAdmin = ctx.store.workspaces.some((w) => w.id === ctx.store.activeWorkspaceId && w.role === 'admin');
  const newBoard = buttonEl({ class: 'secondary-button', text: copy.newBoardButton, 'data-autofocus': 'true' });
  newBoard.addEventListener('click', () => ctx.openDialog('new-board'));
  const panel = el('div', { class: 'dialog-panel fullscreen', role: 'dialog', 'aria-label': copy.boardsSheet },
    el('h2', { class: 'dialog-title', text: copy.boardsSheet }), nav,
    isWorkspaceAdmin ? newBoard : el('div'));
  const dialog = el('div', { class: 'dialog-backdrop', 'data-dialog': 'boards-sheet' }, panel);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) ctx.closeDialog();
  });
  return dialog;
}

/** The Move dialog keeps its chosen list and position across re-renders. */
const moveDialogState = new Map<string, { listId: string; position: number }>();

export function renderMoveCardDialog(ctx: ViewContext, card: Card): HTMLElement {
  const previous = moveDialogState.get(card.id) ?? {
    listId: card.listId,
    position: card.position ?? 1,
  };
  const listSelect = el('select', { class: 'text-input', 'aria-label': copy.listField, 'data-autofocus': 'true' }) as HTMLSelectElement;
  const positionSelect = el('select', { class: 'text-input', 'aria-label': copy.positionField }) as HTMLSelectElement;
  for (const list of ctx.store.board.lists) {
    const option = el('option', { value: list.id, text: list.name }) as HTMLOptionElement;
    if (list.id === previous.listId) option.selected = true;
    listSelect.append(option);
  }
  const fillPositions = (listId: string, chosen?: number): void => {
    positionSelect.textContent = '';
    const list = ctx.store.board.lists.find((l) => l.id === listId);
    const count = list?.count ?? 1;
    const isSame = listId === card.listId;
    const max = isSame ? count : count + 1;
    const preferred = chosen ?? (isSame ? (card.position ?? 1) : count + 1);
    for (let position = 1; position <= max; position += 1) {
      const option = el('option', { value: String(position), text: String(position) }) as HTMLOptionElement;
      if (position === preferred) option.selected = true;
      positionSelect.append(option);
    }
    moveDialogState.set(card.id, { listId, position: positionSelect.value ? Number.parseInt(positionSelect.value, 10) : 1 });
  };
  fillPositions(previous.listId, previous.position);
  listSelect.addEventListener('change', () => {
    // Choosing a list resets Position to the end of that list.
    fillPositions(listSelect.value);
  });
  positionSelect.addEventListener('change', () => {
    moveDialogState.set(card.id, {
      listId: listSelect.value,
      position: Number.parseInt(positionSelect.value, 10) || 1,
    });
  });
  listSelect.addEventListener('change', () => fillPositions(listSelect.value));
  const move = buttonEl({ class: 'primary-button', text: copy.moveButton });
  const cancel = buttonEl({ class: 'secondary-button', text: copy.cancelButton });
  cancel.addEventListener('click', ctx.closeDialog);
  move.addEventListener('click', () => {
    void (async () => {
      const position = Number.parseInt(positionSelect.value, 10);
      const reply = await api.moveCard(card.id, listSelect.value, position, card.version);
      ctx.setDialogState(null);
      moveDialogState.delete(card.id);
      if (reply.status === 200) ctx.noteOwnMove(card.id);
      if (reply.status === 409 && (reply.body as ApiErrorBody).error === 'stale') {
        const body = reply.body as ApiErrorBody & { card: Card; changedBy: { displayName: string }; change: 'moved' | 'edited' };
        ctx.store.replaceCard(body.card);
        const list = ctx.store.board.lists.find((l) => l.id === body.card.listId);
        const sentence = body.change === 'moved'
          ? copy.staleMoved(body.changedBy.displayName, body.card.title, list?.name ?? '', body.card.position ?? 1, list?.count ?? 1)
          : copy.staleEdited(body.changedBy.displayName, body.card.title, list?.name ?? '', body.card.position ?? 1, list?.count ?? 1);
        ctx.announce(sentence);
        ctx.store.addNotice(sentence);
      } else if (reply.status === 404) {
        ctx.store.removeCard(card.id);
        const sentence = copy.noLongerShared(card.title);
        ctx.announce(sentence);
        ctx.store.addNotice(sentence);
      } else if (!isApiError(reply.body)) {
        const payload = reply.body as { card: Card; counts: { listId: string; count: number }[]; openCards: number };
        ctx.store.applyServerCounts(payload.counts);
        ctx.store.applyOpenCards(ctx.store.board.boardId ?? '', payload.openCards);
        ctx.store.replaceCard(payload.card);
        const list = ctx.store.board.lists.find((l) => l.id === payload.card.listId);
        ctx.announce(copy.movedTo(payload.card.title, list?.name ?? '', payload.card.position ?? 1, list?.count ?? 1));
        void ctx.refreshBoards();
      }
      ctx.navigate(location.pathname, true);
    })();
  });
  const dialog = el('div', { class: 'dialog-backdrop', 'data-dialog': 'move' },
    el('div', { class: 'dialog-panel', role: 'dialog', 'aria-label': copy.moveCardTitle },
      el('h2', { class: 'dialog-title', text: copy.moveCardTitle }),
      el('div', { class: 'dialog-row' }, el('label', { text: copy.listField }), listSelect),
      el('div', { class: 'dialog-row' }, el('label', { text: copy.positionField }), positionSelect),
      el('div', { class: 'dialog-actions' }, cancel, move)));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) ctx.closeDialog();
  });
  return dialog;
}

export function renderBoardSettingsDialog(ctx: ViewContext): HTMLElement {
  const boardId = ctx.store.board.boardId ?? '';
  const radios = el('div', { role: 'radiogroup', 'aria-label': copy.visibilityGroup },
    el('label', { class: 'checklist-row' },
      Object.assign(el('input', { type: 'radio', name: 'board-visibility', value: 'workspace' }) as HTMLInputElement,
        { checked: ctx.store.board.visibility === 'workspace' }),
      copy.visibilityEveryone),
    el('label', { class: 'checklist-row' },
      Object.assign(el('input', { type: 'radio', name: 'board-visibility', value: 'private' }) as HTMLInputElement,
        { checked: ctx.store.board.visibility === 'private' }),
      copy.visibilityMembers));
  const alertArea = el('div', { role: 'alert' });
  const close = buttonEl({ class: 'secondary-button', text: copy.close, 'data-autofocus': 'true' });
  close.addEventListener('click', ctx.closeDialog);
  const body = el('tbody');
  const table = el('table', { class: 'settings-table', role: 'table', 'aria-label': copy.membersTable },
    el('thead', {}, el('tr', {}, el('th', { text: 'Name' }), el('th', { text: 'Role' }))),
    body);
  radios.addEventListener('change', () => {
    const chosen = (radios.querySelector('input:checked') as HTMLInputElement).value;
    void api.patchBoard(boardId, { visibility: chosen }).then(() => {
      ctx.store.board.visibility = chosen as 'workspace' | 'private';
      void ctx.refreshBoard();
    });
  });
  const dialog = el('div', { class: 'dialog-backdrop', 'data-dialog': 'settings' },
    el('div', { class: 'dialog-panel', role: 'dialog', 'aria-label': copy.boardSettingsTitle },
      el('h2', { class: 'dialog-title', text: copy.boardSettingsTitle }),
      radios,
      table,
      alertArea,
      el('div', { class: 'dialog-actions' }, close)));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) ctx.closeDialog();
  });
  void (async () => {
    const membersReply = await api.boardMembers(boardId);
    const candidatesReply = await api.boardCandidates(boardId);
    if (isApiError(membersReply.body) || isApiError(candidatesReply.body)) return;
    const members = (membersReply.body as { members: { userId?: string; displayName: string; role?: Role }[] }).members;
    const people = (candidatesReply.body as { people: { userId: string; displayName: string }[] }).people;
    for (const member of members) {
      const roleButton = buttonEl({ class: 'secondary-button', 'aria-haspopup': 'menu', text: member.role ?? 'member', 'aria-label': `Role for ${member.displayName}` });
      roleButton.addEventListener('click', () => {
        ctx.openMenu(roleButton, [
          { label: 'Admin', action: () => void changeRole(member, 'admin'), checked: member.role === 'admin', radio: true },
          { label: 'Member', action: () => void changeRole(member, 'member'), checked: member.role === 'member', radio: true },
          { label: 'Observer', action: () => void changeRole(member, 'observer'), checked: member.role === 'observer', radio: true },
          { label: 'Remove from board', action: () => void removeMember(member) },
        ]);
      });
      body.append(el('tr', {}, el('td', { text: member.displayName }), el('td', {}, roleButton)));
    }
    const candidateSelect = el('select', { class: 'text-input', 'aria-label': copy.addPerson }) as HTMLSelectElement;
    for (const person of people) {
      candidateSelect.append(el('option', { value: person.userId, text: person.displayName }));
    }
    const addButton = buttonEl({ class: 'secondary-button', text: copy.addToBoard });
    addButton.addEventListener('click', () => {
      void (async () => {
        if (!candidateSelect.value) return;
        addButton.disabled = true;
        const reply = await api.addBoardMember(boardId, candidateSelect.value, 'member');
        addButton.disabled = false;
        if (reply.status === 409) {
          alertArea.textContent = '';
          alertArea.append(el('div', { text: copy.boardNeedsAdmin }));
          return;
        }
        ctx.openDialog('board-settings');
      })();
    });
    body.append(el('tr', {}, el('td', { text: copy.addPerson }), el('td', {}, candidateSelect, addButton)));
  })();

  async function changeRole(member: { userId?: string; displayName: string }, role: Role): Promise<void> {
    if (!member.userId) return;
    const reply = await api.changeBoardMemberRole(boardId, member.userId, role);
    if (reply.status === 409) {
      alertArea.textContent = '';
      alertArea.append(el('div', { text: copy.boardNeedsAdmin }));
      return;
    }
    ctx.openDialog('board-settings');
  }

  async function removeMember(member: { userId?: string }): Promise<void> {
    if (!member.userId) return;
    const reply = await api.removeBoardMember(boardId, member.userId);
    if (reply.status === 409) {
      alertArea.textContent = '';
      alertArea.append(el('div', { text: copy.boardNeedsAdmin }));
      return;
    }
    ctx.openDialog('board-settings');
  }
  return dialog;
}

export function renderCardDialog(ctx: ViewContext, card: Card): HTMLElement {
  const isObserver = ctx.store.board.role === 'observer';
  const panel = el('div', { class: 'dialog-panel', role: 'dialog', 'aria-label': card.title });
  panel.append(el('h2', { class: 'dialog-title', text: card.title }));
  if (isObserver) {
    panel.append(el('div', { class: 'dialog-row' }, el('p', { text: card.title })));
    const meta = el('div', { class: 'card-meta' });
    for (const label of card.labels) meta.append(el('span', { class: 'label-pill', text: label }));
    if (card.dueState === 'due_today') meta.append(el('span', { class: 'due-label', text: copy.dueToday }));
    if (card.dueState === 'overdue') meta.append(el('span', { class: 'due-label overdue', text: copy.overdue }));
    if (card.owner) {
      meta.append(el('span', { class: `chip ${card.owner.colour}`, role: 'img', 'aria-label': copy.ownerChip(card.owner.displayName), text: card.owner.initials }));
    }
    panel.append(meta);
    const checklist = el('div', { role: 'group', 'aria-label': copy.checklistGroup });
    for (const item of card.checklist) {
      const checkbox = el('input', { type: 'checkbox', id: item.id, disabled: 'disabled' }) as HTMLInputElement;
      checkbox.checked = item.done;
      checklist.append(el('label', { class: 'checklist-row' }, checkbox, item.text));
    }
    panel.append(checklist);
    const close = buttonEl({ class: 'secondary-button', text: copy.close, 'data-autofocus': 'true' });
    close.addEventListener('click', () => ctx.closeCardDialog(card));
    panel.append(el('div', { class: 'dialog-actions' }, close));
    const dialog = el('div', { class: 'dialog-backdrop', 'data-dialog': 'card' }, panel);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) ctx.closeCardDialog(card);
    });
    return dialog;
  }
  // Fields the person has edited but not saved keep their draft across re-reads (DP-48).
  const draft = ctx.store.draftFor(card.id);
  const titleInput = el('input', { class: 'text-input', 'aria-label': copy.titleField, value: draft?.['title'] ?? card.title, 'data-autofocus': 'true' }) as HTMLInputElement;
  const notesInput = el('textarea', { class: 'text-input', 'aria-label': copy.notesField, rows: '4' }) as HTMLTextAreaElement;
  notesInput.value = draft?.['notes'] ?? (card.notes ?? '');
  const dueInput = el('input', { class: 'text-input', type: 'date', 'aria-label': copy.dueDateField, value: draft?.['dueDate'] ?? (card.dueDate ?? '') }) as HTMLInputElement;
  for (const [input, field] of [[titleInput, 'title'], [notesInput, 'notes'], [dueInput, 'dueDate']] as const) {
    input.addEventListener('input', () => {
      ctx.store.saveDraftField(card.id, field, input.value);
    });
  }
  const ownerSelect = el('select', { class: 'text-input', 'aria-label': copy.ownerField }) as HTMLSelectElement;
  const labelsGroup = el('div', { role: 'group', 'aria-label': copy.labelsGroup });
  const checklist = el('div', { role: 'group', 'aria-label': copy.checklistGroup });
  const newItem = el('input', { class: 'text-input', 'aria-label': copy.newChecklistItem }) as HTMLInputElement;
  const addItem = buttonEl({ class: 'secondary-button', text: copy.addItem });
  const privacyGroup = el('div', { role: 'group', 'aria-label': copy.privacyGroup });
  const attachments = el('div', { role: 'list', 'aria-label': copy.attachmentsList });
  const errorArea = el('div');
  const save = buttonEl({ class: 'primary-button', text: copy.saveChanges });
  const close = buttonEl({ class: 'secondary-button', text: copy.close });
  const deleteButton = buttonEl({ class: 'secondary-button', text: copy.deleteCard });

  void (async () => {
    const membersReply = await api.boardMembers(ctx.store.board.boardId ?? '');
    if (isApiError(membersReply.body)) return;
    const memberList = (membersReply.body as { members: { userId?: string; displayName: string; role?: Role }[] }).members;
    ownerSelect.append(el('option', { value: '', text: 'No owner' }));
    for (const member of memberList) {
      if (member.role === 'observer' || !member.userId) continue;
      const option = el('option', { value: member.userId, text: member.displayName }) as HTMLOptionElement;
      if (card.owner?.userId === member.userId) option.selected = true;
      ownerSelect.append(option);
    }
    const everyone = el('input', { type: 'checkbox', id: `${card.id}-everyone` }) as HTMLInputElement;
    everyone.checked = !(card.isPrivate ?? false);
    everyone.addEventListener('change', () => {
      const current = new Set((card.privateMembers ?? []).map((pm) => pm.userId));
      const userIds = everyone.checked ? [] : [...(current.size > 0 ? current : new Set([ctx.store.session?.userId ?? '']))];
      void api.setPrivateMembers(card.id, userIds).then(() => {
        void ctx.refreshBoard();
      });
    });
    privacyGroup.append(el('label', { class: 'checklist-row' }, everyone, copy.privacyEveryone));
    for (const member of memberList) {
      if (member.role === 'observer' || !member.userId) continue;
      const checkbox = el('input', { type: 'checkbox', id: `${card.id}-${member.userId}` }) as HTMLInputElement;
      checkbox.checked = (card.privateMembers ?? []).some((pm) => pm.userId === member.userId);
      checkbox.addEventListener('change', () => {
        const current = new Set((card.privateMembers ?? []).map((pm) => pm.userId));
        if (checkbox.checked) current.add(member.userId!);
        else current.delete(member.userId!);
        void api.setPrivateMembers(card.id, [...current]).then(() => {
          void ctx.refreshBoard();
        });
      });
      privacyGroup.append(el('label', { class: 'checklist-row' }, checkbox, member.displayName));
    }
  })();

  for (const label of LABELS) {
    const checkbox = el('input', { type: 'checkbox', id: `${card.id}-label-${label}` }) as HTMLInputElement;
    checkbox.checked = card.labels.includes(label);
    labelsGroup.append(el('label', { class: 'checklist-row' }, checkbox, label));
  }

  for (const item of card.checklist) {
    const checkbox = el('input', { type: 'checkbox', id: item.id }) as HTMLInputElement;
    checkbox.checked = item.done;
    checkbox.addEventListener('change', () => {
      void (async () => {
        checkbox.disabled = true;
        const reply = await api.updateChecklistItem(item.id, { done: checkbox.checked });
        checkbox.disabled = false;
        if (reply.status === 404) {
          ctx.store.removeCard(card.id);
          ctx.setDialogState(null);
          const sentence = copy.noLongerShared(card.title);
          ctx.announce(sentence);
          ctx.store.addNotice(sentence);
          ctx.navigate(location.pathname, true);
          return;
        }
        if (reply.status === 403) {
          ctx.store.addNotice(copy.lockedEdit);
          ctx.setDialogState(null);
          ctx.navigate(location.pathname, true);
          return;
        }
        if (!isApiError(reply.body)) {
          ctx.announce(checkbox.checked ? copy.checkedOff(item.text) : copy.unchecked(item.text));
          await ctx.refreshBoard();
          const fresh = ctx.store.findCard(card.id)?.card;
          if (fresh) ctx.openDialog('card', fresh);
        }
      })();
    });
    const remove = buttonEl({ class: 'secondary-button', 'aria-label': `Delete ${item.text}`, text: 'Delete' });
    remove.addEventListener('click', () => {
      void (async () => {
        const reply = await api.deleteChecklistItem(item.id);
        if (reply.status === 404) {
          ctx.store.removeCard(card.id);
          ctx.setDialogState(null);
          const sentence = copy.noLongerShared(card.title);
          ctx.announce(sentence);
          ctx.store.addNotice(sentence);
          ctx.navigate(location.pathname, true);
          return;
        }
        await ctx.refreshBoard();
        const fresh = ctx.store.findCard(card.id)?.card;
        if (fresh) ctx.openDialog('card', fresh);
      })();
    });
    checklist.append(el('div', { class: 'checklist-row' }, checkbox, el('span', { text: item.text }), remove));
  }
  addItem.addEventListener('click', () => {
    void addChecklistItem(ctx, card, newItem.value);
  });
  newItem.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void addChecklistItem(ctx, card, newItem.value);
    }
  });

  for (const attachment of card.attachments ?? []) {
    const link = el('a', { href: `/api/attachments/${attachment.id}`, text: attachment.filename });
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void (async () => {
        const response = await fetch(`/api/attachments/${attachment.id}`, { credentials: 'same-origin' });
        if (response.status === 503) {
          ctx.store.addNotice(copy.downloadFailed(attachment.filename));
          return;
        }
        const bytes = await response.blob();
        const url = URL.createObjectURL(bytes);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = attachment.filename;
        anchor.click();
        URL.revokeObjectURL(url);
      })();
    });
    const remove = buttonEl({ class: 'secondary-button', 'aria-label': copy.removeAttachment(attachment.filename), text: 'Remove' });
    remove.addEventListener('click', () => {
      void (async () => {
        remove.textContent = copy.deleting;
        const reply = await api.deleteAttachment(attachment.id);
        if (reply.status === 503) {
          remove.textContent = 'Remove';
          ctx.store.addNotice(copy.deleteFailed);
          return;
        }
        if (reply.status === 404) {
          ctx.store.removeCard(card.id);
          ctx.setDialogState(null);
          const sentence = copy.noLongerShared(card.title);
          ctx.announce(sentence);
          ctx.store.addNotice(sentence);
          ctx.navigate(location.pathname, true);
          return;
        }
        await ctx.refreshBoard();
        const fresh = ctx.store.findCard(card.id)?.card;
        if (fresh) ctx.openDialog('card', fresh);
      })();
    });
    attachments.append(el('div', { class: 'attachment-row' }, link, remove));
  }
  const attach = buttonEl({ class: 'secondary-button', text: copy.attachFile });
  const fileInput = el('input', { type: 'file', class: 'visually-hidden' }) as HTMLInputElement;
  attach.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void uploadAttachment(ctx, card, file, attachments);
  });

  save.addEventListener('click', () => {
    void (async () => {
      const fresh = await api.getCard(card.id);
      if (isApiError(fresh.body)) {
        ctx.store.removeCard(card.id);
        ctx.setDialogState(null);
        const sentence = copy.noLongerShared(card.title);
        ctx.announce(sentence);
        ctx.store.addNotice(sentence);
        ctx.navigate(location.pathname, true);
        return;
      }
      const current = (fresh.body as { card: Card }).card;
      save.textContent = copy.saving;
      save.disabled = true;
      const fields: Record<string, unknown> = {
        title: titleInput.value,
        notes: notesInput.value,
        dueDate: dueInput.value === '' ? null : dueInput.value,
        labels: [...labelsGroup.querySelectorAll('input:checked')].map(
          (node) => (node as HTMLInputElement).id.split('-label-')[1]!),
        ownerUserId: ownerSelect.value === '' ? null : ownerSelect.value,
      };
      const reply = await api.saveCard(card.id, current.version, fields);
      save.disabled = false;
      save.textContent = copy.saveChanges;
      if (reply.status === 409 && (reply.body as ApiErrorBody).error === 'stale') {
        const body = reply.body as ApiErrorBody & { card: Card; changedBy: { displayName: string }; change: 'moved' | 'edited' };
        ctx.store.replaceCard(body.card);
        const list = ctx.store.board.lists.find((l) => l.id === body.card.listId);
        const sentence = body.change === 'moved'
          ? copy.staleMoved(body.changedBy.displayName, body.card.title, list?.name ?? '', body.card.position ?? 1, list?.count ?? 1)
          : copy.staleEdited(body.changedBy.displayName, body.card.title, list?.name ?? '', body.card.position ?? 1, list?.count ?? 1);
        ctx.announce(sentence);
        ctx.store.addNotice(sentence);
        ctx.openDialog('card', body.card);
        return;
      }
      if (reply.status === 403) {
        ctx.store.addNotice(copy.lockedEdit);
        ctx.setDialogState(null);
        ctx.navigate(location.pathname, true);
        return;
      }
      if (reply.status === 404) {
        ctx.store.removeCard(card.id);
        ctx.setDialogState(null);
        const sentence = copy.noLongerShared(card.title);
        ctx.announce(sentence);
        ctx.store.addNotice(sentence);
        ctx.navigate(location.pathname, true);
        return;
      }
      if (isApiError(reply.body)) {
        const body = reply.body as ApiErrorBody;
        errorArea.textContent = '';
        for (const [field, message] of Object.entries(body.fields ?? {})) {
          if (field === 'title') {
            errorArea.append(el('div', { class: 'field-error', text: message }));
          } else {
            errorArea.append(el('div', { class: 'field-error', text: message }));
          }
        }
        return;
      }
      const saved = (reply.body as { card: Card }).card;
      ctx.store.clearDraft(card.id);
      ctx.announce(copy.savedCard(saved.title));
      await ctx.refreshBoard();
      const freshCard = ctx.store.findCard(card.id)?.card;
      if (freshCard) ctx.openDialog('card', freshCard);
    })();
  });
  close.addEventListener('click', () => ctx.closeCardDialog(card));
  deleteButton.addEventListener('click', () => {
    ctx.openDialog('delete-card-confirm', card);
  });

  panel.append(
    el('div', { class: 'dialog-row' }, el('label', { text: copy.titleField }), titleInput),
    el('div', { class: 'dialog-row' }, el('label', { text: copy.notesField }), notesInput),
    el('div', { class: 'dialog-row' }, el('label', { text: copy.dueDateField }), dueInput),
    el('div', { class: 'dialog-row' }, el('label', { text: copy.ownerField }), ownerSelect),
    labelsGroup,
    checklist,
    el('div', { class: 'dialog-row' }, newItem, addItem),
    privacyGroup,
    attachments,
    fileInput,
    attach,
    errorArea,
    el('div', { class: 'dialog-actions' }, deleteButton, close, save),
  );
  const dialog = el('div', { class: 'dialog-backdrop', 'data-dialog': 'card' }, panel);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) ctx.closeCardDialog(card);
  });
  return dialog;
}

async function addChecklistItem(ctx: ViewContext, card: Card, text: string): Promise<void> {
  if (!text.trim()) {
    ctx.announce(copy.checklistItemRequired);
    return;
  }
  const reply = await api.addChecklistItem(card.id, text);
  if (reply.status === 404) {
    ctx.store.removeCard(card.id);
    ctx.setDialogState(null);
    const sentence = copy.noLongerShared(card.title);
    ctx.announce(sentence);
    ctx.store.addNotice(sentence);
    ctx.navigate(location.pathname, true);
    return;
  }
  if (reply.status === 403) {
    ctx.store.addNotice(copy.lockedEdit);
    ctx.setDialogState(null);
    ctx.navigate(location.pathname, true);
    return;
  }
  if (!isApiError(reply.body)) {
    ctx.announce(copy.addedChecklistItem(text));
    await ctx.refreshBoard();
    const fresh = ctx.store.findCard(card.id)?.card;
    if (fresh) ctx.openDialog('card', fresh);
  }
}

async function uploadAttachment(ctx: ViewContext, card: Card, file: File, holder: HTMLElement): Promise<void> {
  const row = el('div', { class: 'attachment-row' },
    el('span', { text: copy.uploading(file.name) }),
    el('div', { class: 'progress-strip' }, el('span')));
  holder.append(row);
  const reply = await api.uploadAttachment(card.id, file);
  row.remove();
  if (reply.status === 413) {
    ctx.announce(copy.tooLarge(file.name));
    return;
  }
  if (reply.status === 415) {
    ctx.announce(copy.notPdfJpegPng(file.name));
    return;
  }
  if (reply.status === 422) {
    ctx.announce(copy.badName(file.name));
    return;
  }
  if (reply.status === 503 || reply.status === 0) {
    const sentence = copy.uploadFailed(file.name);
    ctx.store.addNotice(sentence);
    ctx.announce(sentence);
    return;
  }
  if (reply.status === 404) {
    ctx.store.removeCard(card.id);
    ctx.setDialogState(null);
    const sentence = copy.noLongerShared(card.title);
    ctx.announce(sentence);
    ctx.store.addNotice(sentence);
    ctx.navigate(location.pathname, true);
    return;
  }
  if (!isApiError(reply.body)) {
    ctx.announce(copy.attachedFile(file.name));
    await ctx.refreshBoard();
    const fresh = ctx.store.findCard(card.id)?.card;
    if (fresh) ctx.openDialog('card', fresh);
  }
}
