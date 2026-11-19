import type { BoardSummary, MembersResponse, Pin } from '../shared/types.js';
import { queryWords } from '../shared/text.js';
import { copy } from '../shared/copy.js';
import {
  ApiFailure,
  announce,
  api,
  busy,
  clear,
  closeUndoToast,
  el,
  failureMessage,
  navigate,
  registerUndoToast,
  showAlert,
  state,
  toast,
} from './core.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogHandle {
  panel: HTMLElement;
  body: HTMLElement;
  close(): void;
}

interface DialogSpec {
  label: string;
  role?: 'dialog' | 'alertdialog';
  opener: HTMLElement | null;
  className?: string;
  onClose?(): void;
}

export function openDialog(spec: DialogSpec): DialogHandle {
  const overlay = el('div', { class: 'overlay' });
  const sheet = window.innerWidth < 600;
  const panel = el('div', {
    class: `panel ${sheet ? 'sheet' : ''} ${spec.className ?? ''}`,
    role: spec.role ?? 'dialog',
    'aria-modal': 'true',
    'aria-label': spec.label,
  });
  const body = el('div', { class: 'panel-body' });
  panel.append(body);
  overlay.append(panel);
  document.body.append(overlay);
  document.body.classList.add('modal-open');

  const handle: DialogHandle = {
    panel,
    body,
    close: () => {
      overlay.remove();
      if (!document.querySelector('.overlay')) document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKey, true);
      spec.onClose?.();
      spec.opener?.focus();
    },
  };

  const onKey = (event: KeyboardEvent): void => {
    if (!overlay.isConnected) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      handle.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => node.offsetParent !== null || node === document.activeElement,
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  document.addEventListener('keydown', onKey, true);
  return handle;
}

export function fieldError(input: HTMLElement, message: string): void {
  const holder = input.closest('.field') ?? input.parentElement;
  holder?.querySelector('.field-error')?.remove();
  const note = el('p', { class: 'field-error', text: message });
  holder?.append(note);
  input.setAttribute('aria-invalid', 'true');
  showAlert(message);
}

export function clearFieldErrors(root: HTMLElement): void {
  for (const note of root.querySelectorAll('.field-error')) note.remove();
  for (const input of root.querySelectorAll('[aria-invalid]')) input.removeAttribute('aria-invalid');
}

export function labelledField(
  label: string,
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): HTMLElement {
  const id = `f${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  return el('div', { class: 'field' }, el('label', { for: id, text: label }), input);
}

interface ListboxOption {
  id: number;
  name: string;
  label?: string;
}

interface ListboxHandle {
  element: HTMLElement;
  render(options: ListboxOption[]): void;
  focusFirst(): void;
  activeId(): number | null;
}

export function buildListbox(
  label: string,
  onChoose: (id: number) => void,
): ListboxHandle {
  const list = el('div', { class: 'listbox', role: 'listbox', 'aria-label': label });
  let items: HTMLElement[] = [];

  const focusItem = (index: number): void => {
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    for (const [position, item] of items.entries()) {
      item.setAttribute('aria-selected', position === clamped ? 'true' : 'false');
    }
    items[clamped].focus();
  };

  list.addEventListener('keydown', (event) => {
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(index - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const current = items[index];
      if (current) onChoose(Number(current.dataset.optionId));
    }
  });

  return {
    element: list,
    render(options: ListboxOption[]): void {
      clear(list);
      items = options.map((option) => {
        const item = el('div', {
          class: 'option',
          role: 'option',
          tabindex: '-1',
          'aria-selected': 'false',
          text: option.label ?? option.name,
        });
        item.dataset.optionId = String(option.id);
        item.addEventListener('click', () => onChoose(option.id));
        list.append(item);
        return item;
      });
    },
    focusFirst(): void {
      focusItem(0);
    },
    activeId(): number | null {
      const current = items.find((item) => item.getAttribute('aria-selected') === 'true');
      return current ? Number(current.dataset.optionId) : null;
    },
  };
}

function matchesFilter(name: string, needle: string): boolean {
  if (needle.length === 0) return true;
  return queryWords(name).some((word) => word.startsWith(needle.toLowerCase()));
}

export async function openSaveDialog(pin: Pin, opener: HTMLElement | null): Promise<void> {
  let boards = (await api.get<{ boards: BoardSummary[] }>('/api/boards/mine')).boards;
  const dialog = openDialog({ label: 'Save to board', opener });
  const search = el('input', {
    type: 'search',
    role: 'searchbox',
    'aria-label': 'Find a board',
    placeholder: 'Find a board',
    class: 'search-input',
  });
  const listbox = buildListbox('Boards', (boardId) => {
    void save(boardId);
  });
  const createButton = el('button', { type: 'button', class: 'secondary', text: 'Create board' });

  const paint = (): void => {
    listbox.render(
      boards
        .filter((board) => matchesFilter(board.name, search.value.trim()))
        .map((board) => ({ id: board.id, name: board.name })),
    );
  };

  const save = async (boardId: number): Promise<void> => {
    const board = boards.find((item) => item.id === boardId);
    if (!board) return;
    const label = el('p', { class: 'pending', text: 'Saving' });
    dialog.body.append(label);
    try {
      await api.post(`/api/pins/${pin.id}/saves`, { board: boardId, section: null });
      announce(`Saved to ${board.name}`);
      toast(`Saved to ${board.name}`);
      dialog.close();
    } catch (error) {
      label.remove();
      if (error instanceof ApiFailure && error.code === 'already_on_board') {
        const target = error.body.board as { name: string } | undefined;
        showAlert(`This pin is already on ${target?.name ?? board.name}.`);
      } else {
        showAlert(failureMessage(error));
      }
    }
  };

  search.addEventListener('input', paint);
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      listbox.focusFirst();
    }
  });
  createButton.addEventListener('click', () => {
    openCreateBoardDialog(createButton, async (created) => {
      boards = (await api.get<{ boards: BoardSummary[] }>('/api/boards/mine')).boards;
      paint();
      const option = listbox.element.querySelector<HTMLElement>(
        `[data-option-id="${created.id}"]`,
      );
      option?.focus();
      option?.setAttribute('aria-selected', 'true');
    });
  });

  dialog.body.append(search, listbox.element, createButton);
  paint();
  search.focus();
}

export function openCreateBoardDialog(
  opener: HTMLElement | null,
  onCreated: (board: BoardSummary) => void | Promise<void>,
): void {
  const dialog = openDialog({ label: 'Create board', opener });
  const name = el('input', { type: 'text', 'aria-label': 'Name' });
  const group = el('div', { role: 'radiogroup', 'aria-label': 'Visibility', class: 'radios' });
  const radios = (['Public', 'Secret'] as const).map((option, index) => {
    const radio = el('div', {
      role: 'radio',
      tabindex: index === 0 ? '0' : '-1',
      'aria-checked': index === 0 ? 'true' : 'false',
      text: option,
      class: 'radio',
    });
    radio.addEventListener('click', () => {
      for (const other of radios) other.setAttribute('aria-checked', 'false');
      radio.setAttribute('aria-checked', 'true');
    });
    radio.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        radio.click();
      }
    });
    group.append(radio);
    return radio;
  });
  const create = el('button', { type: 'button', class: 'primary', text: 'Create' });
  create.addEventListener('click', () => {
    clearFieldErrors(dialog.body);
    const visibility = radios[1].getAttribute('aria-checked') === 'true' ? 'secret' : 'public';
    void busy(create, 'Creating', async () => {
      try {
        const board = await api.post<{ id: number; name: string }>('/api/boards', {
          name: name.value,
          visibility,
        });
        dialog.close();
        await onCreated({
          id: board.id,
          name: board.name,
          visibility,
          pin_count: 0,
        });
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'board_name_taken') {
          fieldError(name, `You already have a board called ${name.value.trim()}.`);
        } else if (error instanceof ApiFailure && error.field === 'name') {
          fieldError(name, `Board names are 1 to ${state.config.limits.board_name_max} characters.`);
        } else {
          showAlert(failureMessage(error));
        }
      }
    });
  });
  dialog.body.append(labelledField('Name', name), group, create);
  name.focus();
}

export function openAddSectionDialog(boardId: number, opener: HTMLElement | null): void {
  const dialog = openDialog({ label: 'Add section', opener });
  const name = el('input', { type: 'text', 'aria-label': 'Name' });
  const create = el('button', { type: 'button', class: 'primary', text: 'Create' });
  create.addEventListener('click', () => {
    clearFieldErrors(dialog.body);
    void busy(create, 'Creating', async () => {
      try {
        await api.post(`/api/boards/${boardId}/sections`, { name: name.value });
        dialog.close();
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'section_name_taken') {
          fieldError(name, `This board already has a section called ${name.value.trim()}.`);
        } else if (error instanceof ApiFailure && error.field === 'name') {
          fieldError(
            name,
            `Section names are 1 to ${state.config.limits.board_name_max} characters.`,
          );
        } else {
          showAlert(failureMessage(error));
        }
      }
    });
  });
  dialog.body.append(labelledField('Name', name), create);
  name.focus();
}

export interface EditBoardInput {
  id: number;
  name: string;
  visibility: 'public' | 'secret';
  cover: number | null;
  pins: { id: number; title: string }[];
  chosenCover: number | null;
}

export function openEditBoardDialog(board: EditBoardInput, opener: HTMLElement | null): void {
  const dialog = openDialog({ label: 'Edit board', opener });
  const name = el('input', { type: 'text', 'aria-label': 'Name', value: board.name });
  const group = el('div', { role: 'radiogroup', 'aria-label': 'Visibility', class: 'radios' });
  const radios = (['Public', 'Secret'] as const).map((option) => {
    const checked =
      (option === 'Secret' && board.visibility === 'secret') ||
      (option === 'Public' && board.visibility === 'public');
    const radio = el('div', {
      role: 'radio',
      tabindex: '0',
      'aria-checked': checked ? 'true' : 'false',
      text: option,
      class: 'radio',
    });
    radio.addEventListener('click', () => {
      for (const other of radios) other.setAttribute('aria-checked', 'false');
      radio.setAttribute('aria-checked', 'true');
    });
    radio.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        radio.click();
      }
    });
    group.append(radio);
    return radio;
  });
  const cover = el('select', { 'aria-label': 'Cover' });
  cover.append(el('option', { value: '', text: 'Automatic' }));
  for (const pin of board.pins) {
    cover.append(el('option', { value: String(pin.id), text: pin.title }));
  }
  cover.value = board.chosenCover === null ? '' : String(board.chosenCover);

  const save = el('button', { type: 'button', class: 'secondary', text: 'Save changes' });
  save.addEventListener('click', () => {
    clearFieldErrors(dialog.body);
    const visibility = radios[1].getAttribute('aria-checked') === 'true' ? 'secret' : 'public';
    void busy(save, 'Saving', async () => {
      try {
        await api.patch(`/api/boards/${board.id}`, {
          name: name.value,
          visibility,
          cover: cover.value === '' ? null : Number(cover.value),
        });
        dialog.close();
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'board_name_taken') {
          fieldError(name, `You already have a board called ${name.value.trim()}.`);
        } else if (error instanceof ApiFailure && error.field === 'name') {
          fieldError(name, `Board names are 1 to ${state.config.limits.board_name_max} characters.`);
        } else {
          showAlert(failureMessage(error));
        }
      }
    });
  });

  const remove = el('button', { type: 'button', class: 'danger', text: 'Delete board' });
  remove.addEventListener('click', () => {
    const confirmDialog = openDialog({
      label: `Delete ${board.name}?`,
      role: 'alertdialog',
      opener: remove,
    });
    const confirm = el('button', { type: 'button', class: 'danger', text: 'Delete board' });
    const cancel = el('button', { type: 'button', class: 'secondary', text: 'Cancel' });
    cancel.addEventListener('click', () => confirmDialog.close());
    confirm.addEventListener('click', () => {
      void busy(confirm, 'Deleting', async () => {
        try {
          await api.del(`/api/boards/${board.id}`);
          confirmDialog.close();
          dialog.close();
          announce('Board deleted');
          navigate('/boards');
        } catch (error) {
          showAlert(failureMessage(error));
        }
      });
    });
    confirmDialog.body.append(
      el('p', { text: `Delete ${board.name}?` }),
      el('div', { class: 'row' }, confirm, cancel),
    );
    confirm.focus();
  });

  dialog.body.append(
    labelledField('Name', name),
    group,
    labelledField('Cover', cover),
    el('div', { class: 'row' }, save, remove),
  );
  name.focus();
}

export function openInviteDialog(
  board: { id: number; name: string },
  opener: HTMLElement | null,
): void {
  const dialog = openDialog({ label: 'Invite collaborators', opener });
  const email = el('input', { type: 'email', 'aria-label': 'Email' });
  const group = el('div', { role: 'radiogroup', 'aria-label': 'Role', class: 'radios' });
  const radios = (['Editor', 'Viewer'] as const).map((option, index) => {
    const radio = el('div', {
      role: 'radio',
      tabindex: '0',
      'aria-checked': index === 0 ? 'true' : 'false',
      text: option,
      class: 'radio',
    });
    radio.addEventListener('click', () => {
      for (const other of radios) other.setAttribute('aria-checked', 'false');
      radio.setAttribute('aria-checked', 'true');
    });
    radio.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        radio.click();
      }
    });
    group.append(radio);
    return radio;
  });
  const send = el('button', { type: 'button', class: 'primary', text: 'Send invite' });
  send.addEventListener('click', () => {
    clearFieldErrors(dialog.body);
    const role = radios[1].getAttribute('aria-checked') === 'true' ? 'viewer' : 'editor';
    void busy(send, 'Sending', async () => {
      const address = email.value.trim();
      try {
        await api.post(`/api/boards/${board.id}/invites`, { email: address, role });
        announce(`Invite sent to ${address}`);
        toast(`Invite sent to ${address}`);
        dialog.close();
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'already_member') {
          fieldError(email, `${address} is already on this board.`);
        } else if (error instanceof ApiFailure && error.field === 'email') {
          fieldError(email, 'Enter a valid email address.');
        } else {
          showAlert(failureMessage(error));
        }
      }
    });
  });
  dialog.body.append(labelledField('Email', email), group, send);
  email.focus();
}

export async function openCollaboratorsDialog(
  board: { id: number; name: string; role: string | null; ownerId: number },
  opener: HTMLElement | null,
): Promise<void> {
  const dialog = openDialog({ label: 'Collaborators', opener });
  const rows = el('div', { class: 'rows' });
  dialog.body.append(rows);

  const paint = async (): Promise<void> => {
    const members = await api.get<MembersResponse>(`/api/boards/${board.id}/members`);
    clear(rows);
    rows.append(el('p', { class: 'row-line', text: `${members.owner.name} · Owner` }));
    for (const member of members.members) {
      const row = el('div', { class: 'row-line' }, el('span', { text: member.user.name }));
      if (board.role === 'owner') {
        const select = el('select', { 'aria-label': `Role for ${member.user.name}` });
        select.append(el('option', { value: 'editor', text: 'Editor' }));
        select.append(el('option', { value: 'viewer', text: 'Viewer' }));
        select.value = member.role;
        select.addEventListener('change', () => {
          void (async () => {
            try {
              await api.patch(`/api/boards/${board.id}/members/${member.user.id}`, {
                role: select.value,
              });
              announce(
                `${member.user.name} is now ${select.value === 'editor' ? 'an editor' : 'a viewer'}`,
              );
              await paint();
            } catch (error) {
              showAlert(failureMessage(error));
            }
          })();
        });
        const remove = el('button', {
          type: 'button',
          class: 'secondary',
          text: `Remove ${member.user.name}`,
        });
        remove.addEventListener('click', () => {
          void (async () => {
            try {
              await api.del(`/api/boards/${board.id}/members/${member.user.id}`);
              announce(`${member.user.name} was removed`);
              await paint();
            } catch (error) {
              showAlert(failureMessage(error));
            }
          })();
        });
        row.append(select, remove);
      } else {
        row.append(el('span', { text: member.role === 'editor' ? 'Editor' : 'Viewer' }));
      }
      rows.append(row);
    }
    for (const invite of members.invites) {
      const withdraw = el('button', {
        type: 'button',
        class: 'secondary',
        text: `Withdraw invite to ${invite.email}`,
      });
      withdraw.addEventListener('click', () => {
        void (async () => {
          try {
            await api.del(`/api/invites/${invite.id}`);
            await paint();
          } catch (error) {
            showAlert(failureMessage(error));
          }
        })();
      });
      rows.append(el('div', { class: 'row-line' }, el('span', { text: invite.email }), withdraw));
    }
    if (board.role === 'editor' || board.role === 'viewer') {
      const leave = el('button', { type: 'button', class: 'secondary', text: 'Leave board' });
      leave.addEventListener('click', () => {
        void busy(leave, 'Leaving', async () => {
          try {
            await api.del(`/api/boards/${board.id}/members/${state.user?.id ?? 0}`);
            dialog.close();
            announce(`You left ${board.name}`);
            navigate('/');
          } catch (error) {
            showAlert(failureMessage(error));
          }
        });
      });
      rows.append(leave);
    }
  };

  await paint();
}

export interface BulkTarget {
  kind: 'move' | 'copy';
  pins: number[];
  excludeBoardId: number;
  onDone(): void;
}

export async function openBulkDialog(target: BulkTarget, opener: HTMLElement | null): Promise<void> {
  const boards = (await api.get<{ boards: BoardSummary[] }>('/api/boards/mine')).boards.filter(
    (board) => board.id !== target.excludeBoardId,
  );
  const label =
    target.kind === 'move' ? copy.moveDialog(target.pins.length) : copy.copyDialog(target.pins.length);
  const dialog = openDialog({ label, opener });
  const listbox = buildListbox('Boards', () => undefined);
  listbox.render(boards.map((board) => ({ id: board.id, name: board.name })));
  const action = el('button', {
    type: 'button',
    class: 'primary',
    text: target.kind === 'move' ? 'Move here' : 'Copy here',
  });
  action.addEventListener('click', () => {
    const boardId = listbox.activeId();
    if (boardId === null) return;
    const board = boards.find((item) => item.id === boardId);
    void busy(action, target.kind === 'move' ? 'Moving' : 'Copying', async () => {
      try {
        const operation = await api.post<{ id: number; deadline: string }>('/api/operations', {
          kind: target.kind,
          pins: target.pins,
          board: boardId,
          section: null,
        });
        dialog.close();
        showBulkToast(
          target.kind,
          target.pins.length,
          board?.name ?? '',
          operation.id,
          operation.deadline,
        );
        target.onDone();
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'already_on_board') {
          const existing = error.body.board as { name: string } | undefined;
          showAlert(`This pin is already on ${existing?.name ?? board?.name ?? ''}.`);
        } else {
          showAlert(failureMessage(error));
        }
      }
    });
  });
  dialog.body.append(listbox.element, action);
  listbox.focusFirst();
}

export function showBulkToast(
  kind: 'move' | 'copy' | 'delete',
  count: number,
  boardName: string,
  operationId: number,
  deadline: string,
): void {
  const text =
    kind === 'move'
      ? copy.movedBulk(count, boardName)
      : kind === 'copy'
        ? copy.copiedBulk(count, boardName)
        : copy.deletedBulk(count);
  const handle = toast(text, {
    undo: {
      deadline,
      run: async () => {
        const button = handle.element.querySelector<HTMLButtonElement>('button.undo');
        if (!button) return;
        await busy(button, 'Undoing', async () => {
          try {
            await api.post(`/api/operations/${operationId}/undo`);
            closeUndoToast(operationId);
            announce('Undone');
            toast('Undone');
          } catch (error) {
            if (error instanceof ApiFailure && error.code === 'undo_expired') {
              showAlert('Too late to undo.');
            } else if (error instanceof ApiFailure && error.code === 'undo_conflict') {
              showAlert("This can't be undone because some pins have changed.");
            } else {
              showAlert(failureMessage(error));
            }
          }
        });
      },
    },
  });
  announce(text);
  registerUndoToast(operationId, handle);
}
