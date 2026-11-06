import { fieldErrors, notices } from '../../shared/notices.js';
import type { Role } from '../../shared/types.js';
import { button, el, focusables, patchChildren, setText, trapTab } from '../dom.js';
import { RequestFailed, api } from '../net.js';
import { createComponent, deleteNode, insertNode } from './actions.js';
import { publishNow } from './publishing.js';
import { nodeById, render, sayWithToast, state, type Member } from './store.js';
import { restoreVersion, saveVersion } from './versions.js';

let openDialogEl: HTMLElement | undefined;
let opener: HTMLElement | undefined;

export function dialogOpen(): boolean {
  return openDialogEl !== undefined;
}

export function closeDialog(restoreFocus = true): void {
  if (!openDialogEl) return;
  openDialogEl.remove();
  openDialogEl = undefined;
  if (restoreFocus) opener?.focus();
  opener = undefined;
}

function openDialog(name: string, body: (close: (restore?: boolean) => void) => HTMLElement[]): HTMLElement {
  closeDialog(false);
  opener = document.activeElement as HTMLElement | null ?? undefined;
  const close = (restore = true): void => closeDialog(restore);
  const dialog = el(
    'div',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': name, class: 'dialog' },
    [el('h2', {}, [name]), ...body(close)],
  );
  const shade = el('div', { class: 'dialog-shade' }, [dialog]);
  document.body.append(shade);
  openDialogEl = shade;
  dialog.addEventListener('keydown', (event) => {
    trapTab(dialog, event);
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  });
  focusables(dialog)[0]?.focus();
  return dialog;
}

export function openDeleteDialog(nodeId: string): void {
  const node = nodeById(nodeId);
  if (!node) return;
  openDialog(`Delete ${node.name}?`, (close) => {
    const remove = button('Delete', { class: 'primary' });
    remove.addEventListener('click', () => {
      close(false);
      deleteNode(nodeId);
    });
    const cancel = button('Cancel', { class: 'ghost' });
    cancel.addEventListener('click', () => close());
    return [el('p', {}, [`${node.name} and everything inside it will go.`]), remove, cancel];
  });
}

export function openCreateComponentDialog(): void {
  const nodeId = state.selectedId;
  if (nodeId === null) return;
  const node = nodeById(nodeId);
  if (!node) return;
  openDialog('Create shared component', (close) => {
    const input = el('input', { type: 'text', 'aria-label': 'Component name' });
    input.value = node.name;
    const create = button('Create', { class: 'primary' });
    create.addEventListener('click', () => {
      const name = input.value.trim();
      if (name === '') return;
      close();
      void createComponent(nodeId, name);
    });
    const cancel = button('Cancel', { class: 'ghost' });
    cancel.addEventListener('click', () => close());
    return [input, create, cancel];
  });
}

export function openSaveVersionDialog(): void {
  openDialog('Save version', (close) => {
    const input = el('input', { type: 'text', 'aria-label': 'Version name' });
    const save = button('Save', { class: 'primary' });
    save.addEventListener('click', () => {
      const name = input.value.trim();
      close();
      void saveVersion(name === '' ? undefined : name);
    });
    const cancel = button('Cancel', { class: 'ghost' });
    cancel.addEventListener('click', () => close());
    return [input, save, cancel];
  });
}

export function openRestoreDialog(versionId: string): void {
  openDialog('Restore version', (close) => {
    const restore = button('Restore', { class: 'primary' });
    restore.addEventListener('click', () => {
      close();
      void restoreVersion(versionId);
    });
    const cancel = button('Cancel', { class: 'ghost' });
    cancel.addEventListener('click', () => close());
    return [el('p', {}, ['The page goes back to this version. You can undo it.']), restore, cancel];
  });
}

export function openPublishDialog(): void {
  openDialog('Publish page', (close) => {
    const publish = button('Publish now', { class: 'primary' });
    publish.addEventListener('click', () => {
      close(false);
      void publishNow();
    });
    const cancel = button('Cancel', { class: 'ghost' });
    cancel.addEventListener('click', () => close());
    return [el('p', {}, ['The live page is replaced with a new snapshot.']), publish, cancel];
  });
}

export function openPlaceImageDialog(): void {
  openDialog('Place image', (close) => {
    const picker = el('select', { 'aria-label': 'Image' });
    for (const image of state.images) {
      const option = el('option', { value: image.id }, [image.fileName]);
      picker.append(option);
    }
    const alt = el('input', { type: 'text', 'aria-label': 'Alt text', id: 'place-alt' });
    const error = el('p', { class: 'field-error', id: 'place-alt-error' });
    const place = button('Place', { class: 'primary' });
    place.addEventListener('click', () => {
      if (alt.value.trim() === '') {
        setText(error, fieldErrors.altEmpty);
        alt.setAttribute('aria-describedby', 'place-alt-error');
        alt.setAttribute('aria-invalid', 'true');
        alt.focus();
        return;
      }
      close(false);
      void insertNode('image', {
        imageId: picker.value,
        alt: alt.value.trim(),
        focalX: 50,
        focalY: 50,
      });
    });
    const cancel = button('Cancel', { class: 'ghost' });
    cancel.addEventListener('click', () => close());
    return [picker, alt, error, place, cancel];
  });
}

async function loadMembers(): Promise<void> {
  const result = await api.get<{ members: Member[] }>(
    `/api/workspaces/${state.workspaceId}/members`,
  );
  state.members = result.members;
  render();
}

export function openShareDialog(): void {
  const dialog = openDialog(`Share ${state.workspaceName}`, (close) => {
    const email = el('input', { type: 'text', 'aria-label': 'Email' });
    const role = el('select', { 'aria-label': 'Role' }, [
      el('option', { value: 'editor' }, ['Editor']),
      el('option', { value: 'viewer' }, ['Viewer']),
    ]);
    const error = el('p', { class: 'field-error' });
    const invite = button('Send invite', { class: 'primary' });
    const list = el('ul', { 'aria-label': 'Members', class: 'member-list' });
    invite.addEventListener('click', () => {
      void api
        .post(`/api/workspaces/${state.workspaceId}/invites`, {
          email: email.value.trim(),
          role: role.value,
        })
        .then(async () => {
          sayWithToast(notices.inviteSent(email.value.trim().toLowerCase()));
          setText(error, '');
          email.value = '';
          await loadMembers();
          renderMembers(list);
        })
        .catch((failure: unknown) => {
          if (!(failure instanceof RequestFailed)) throw failure;
          const text =
            failure.failure.code === 'mail_unavailable'
              ? notices.inviteFailed
              : failure.failure.code === 'invalid'
                ? (failure.failure.fields['email'] ?? failure.failure.message)
                : failure.failure.message;
          setText(error, text);
          sayWithToast(text);
        });
    });
    const cancel = button('Close', { class: 'ghost' });
    cancel.addEventListener('click', () => close());
    void loadMembers().then(() => renderMembers(list));
    return [email, role, invite, error, list, cancel];
  });
  void dialog;
}

function renderMembers(list: HTMLElement): void {
  patchChildren<Member>(
    list,
    state.members,
    (member) => member.userId ?? member.inviteId ?? member.email,
    () => el('li', { class: 'member-row' }),
    (element, member) => {
      const roleSelect = el('select', { 'aria-label': `Role for ${member.email}` }, [
        el('option', { value: 'editor' }, ['Editor']),
        el('option', { value: 'viewer' }, ['Viewer']),
      ]);
      roleSelect.value = member.role === 'viewer' ? 'viewer' : 'editor';
      roleSelect.disabled = member.role === 'owner';
      roleSelect.addEventListener('change', () => {
        if (member.userId === undefined) return;
        void api
          .patch(`/api/workspaces/${state.workspaceId}/members/${member.userId}`, {
            role: roleSelect.value as Role,
          })
          .then(() => loadMembers())
          .then(() => renderMembers(list));
      });
      const action =
        member.status === 'invited'
          ? button('Revoke', { 'aria-label': `Revoke ${member.email}`, class: 'ghost' })
          : button('Remove', { 'aria-label': `Remove ${member.email}`, class: 'ghost' });
      action.addEventListener('click', () => {
        const path =
          member.status === 'invited'
            ? `/api/invites/${member.inviteId}`
            : `/api/workspaces/${state.workspaceId}/members/${member.userId}`;
        void api
          .del(path)
          .then(() => loadMembers())
          .then(() => renderMembers(list));
      });
      element.replaceChildren(
        el('span', { class: 'member-email' }, [member.email]),
        el('span', { class: 'member-status' }, [
          member.status === 'invited' ? 'Invited' : 'Active',
        ]),
        roleSelect,
        action,
      );
      if (member.role === 'owner') action.hidden = true;
    },
  );
}
