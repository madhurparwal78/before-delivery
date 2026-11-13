import {
  ANNOUNCE_COPY,
  BOARD_COPY,
  LIMITS,
  MEMBERS_COPY,
  POST_FORM_COPY,
  ROLE_LABELS,
  SETTINGS_COPY,
  withThousands,
} from '../../shared/copy';
import type { LinkAccess, PostDto, Privacy, Role } from '../../shared/types';
import { postTitleError } from '../../shared/validate';
import { RequestFailed, api } from '../api';
import { openDialog } from '../dialog';
import { el, field, messageLine, on } from '../dom';
import type { BoardView } from './view';

const counterLine = (used: number, limit: number): string => `${used}/${limit === LIMITS.postBody ? withThousands(limit) : limit}`;

export const addPostDialog = (view: BoardView, opener: HTMLElement, presetSectionId: string | null): void => {
  openDialog({
    name: 'Add post',
    opener,
    content: (handle) => {
      const section = el('select', { 'aria-label': 'Section' });
      for (const option of view.board.sections) {
        section.append(
          el('option', { value: option.id, text: option.title, selected: option.id === presetSectionId }),
        );
      }
      const title = el('input', { type: 'text', 'aria-label': 'Title' });
      const text = el('textarea', { 'aria-label': 'Text', rows: '4' });
      const titleCounter = el('p', { class: 'muted', text: counterLine(0, LIMITS.postTitle) });
      const textCounter = el('p', { class: 'muted', text: counterLine(0, LIMITS.postBody) });
      const titleMessage = messageLine();
      const textMessage = messageLine();
      const fileMessage = messageLine();
      const alert = el('p', { role: 'alert' });
      const fileInput = el('input', {
        type: 'file',
        class: 'hidden-file',
        tabindex: '-1',
        'aria-hidden': 'true',
        accept: 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain',
      });
      const attach = el('button', { type: 'button', text: 'Attach a file' });
      const fileName = el('p', { class: 'muted' });
      const post = el('button', { type: 'button', text: 'Post' });

      on(attach, 'click', () => fileInput.click());
      on(fileInput, 'change', () => {
        fileName.textContent = fileInput.files?.[0]?.name ?? '';
      });
      on(title, 'input', () => {
        titleCounter.textContent = counterLine(Array.from(title.value).length, LIMITS.postTitle);
      });
      on(text, 'input', () => {
        textCounter.textContent = counterLine(Array.from(text.value).length, LIMITS.postBody);
      });

      const submit = async (): Promise<void> => {
        titleMessage.textContent = '';
        textMessage.textContent = '';
        fileMessage.textContent = '';
        alert.textContent = '';
        const titleProblem = postTitleError(title.value);
        if (titleProblem !== null) {
          titleMessage.textContent = titleProblem;
          alert.textContent = titleProblem;
          return;
        }
        const form = new FormData();
        form.set('section_id', section.value);
        form.set('title', title.value);
        form.set('body', text.value);
        const chosen = fileInput.files?.[0];
        if (chosen !== undefined) {
          form.set('file', chosen);
          view.announce(ANNOUNCE_COPY.uploading(chosen.name));
        }
        post.textContent = POST_FORM_COPY.pending;
        try {
          const created = await api.form<PostDto>(`/api/boards/${view.board.id}/posts`, form);
          handle.close();
          await view.refresh();
          view.announce(
            created.state === 'awaiting_approval' ? ANNOUNCE_COPY.held(created.title) : ANNOUNCE_COPY.posted(created.title),
          );
          view.frameFor(created.id)?.focus();
        } catch (error) {
          post.textContent = 'Post';
          if (!(error instanceof RequestFailed)) throw error;
          const name = chosen?.name ?? 'file';
          if (error.code === 'file_too_large' || error.code === 'body_too_large') {
            fileMessage.textContent = POST_FORM_COPY.fileTooLarge(name, view.uploadMaxBytes);
            alert.textContent = fileMessage.textContent;
          } else if (error.code === 'unsupported_type') {
            fileMessage.textContent = POST_FORM_COPY.unsupportedType(name);
            alert.textContent = fileMessage.textContent;
          } else if (error.code === 'storage_unavailable') {
            alert.textContent = POST_FORM_COPY.storageDown;
          } else {
            titleMessage.textContent = error.fieldError('title') ?? '';
            textMessage.textContent = error.fieldError('body') ?? '';
            alert.textContent = error.fieldError('title') ?? error.fieldError('body') ?? '';
          }
        }
      };

      on(post, 'click', () => void submit());
      const keyHandler = (event: KeyboardEvent): void => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void submit();
        }
      };
      for (const node of [title, text, section]) on(node, 'keydown', keyHandler);
      on(post, 'keydown', keyHandler);

      return [
        el('h2', { text: 'Add post' }),
        field('Section', section),
        field('Title', title, titleMessage),
        titleCounter,
        field('Text', text, textMessage),
        textCounter,
        attach,
        fileInput,
        fileName,
        fileMessage,
        post,
        alert,
      ];
    },
    focus: (root) => root.querySelector<HTMLElement>('input[type="text"]'),
  });
};

export const editPostDialog = (view: BoardView, post: PostDto, opener: HTMLElement): void => {
  openDialog({
    name: 'Edit post',
    opener,
    content: (handle) => {
      const title = el('input', { type: 'text', 'aria-label': 'Title', value: post.title });
      const text = el('textarea', { 'aria-label': 'Text', rows: '4' });
      text.value = post.body;
      const titleCounter = el('p', { class: 'muted', text: counterLine(Array.from(post.title).length, LIMITS.postTitle) });
      const textCounter = el('p', { class: 'muted', text: counterLine(Array.from(post.body).length, LIMITS.postBody) });
      const titleMessage = messageLine();
      const textMessage = messageLine();
      const alert = el('p', { role: 'alert' });
      const save = el('button', { type: 'button', text: 'Save post' });

      on(title, 'input', () => {
        titleCounter.textContent = counterLine(Array.from(title.value).length, LIMITS.postTitle);
      });
      on(text, 'input', () => {
        textCounter.textContent = counterLine(Array.from(text.value).length, LIMITS.postBody);
      });

      const submit = async (): Promise<void> => {
        titleMessage.textContent = '';
        textMessage.textContent = '';
        alert.textContent = '';
        try {
          await api.patch(`/api/posts/${post.id}`, { title: title.value, body: text.value, version: post.version });
          handle.close();
          await view.refresh();
        } catch (error) {
          if (!(error instanceof RequestFailed)) throw error;
          if (error.status === 409) {
            alert.textContent = POST_FORM_COPY.staleEdit;
            return;
          }
          titleMessage.textContent = error.fieldError('title') ?? '';
          textMessage.textContent = error.fieldError('body') ?? '';
          alert.textContent = error.fieldError('title') ?? error.fieldError('body') ?? '';
        }
      };

      on(save, 'click', () => void submit());
      const keyHandler = (event: KeyboardEvent): void => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void submit();
        }
      };
      for (const node of [title, text]) on(node, 'keydown', keyHandler);

      return [
        el('h2', { text: 'Edit post' }),
        field('Title', title, titleMessage),
        titleCounter,
        field('Text', text, textMessage),
        textCounter,
        save,
        alert,
      ];
    },
    focus: (root) => root.querySelector<HTMLElement>('input[type="text"]'),
  });
};

const deleteBoardDialog = (view: BoardView, opener: HTMLElement): void => {
  openDialog({
    name: 'Delete this board?',
    opener,
    alert: true,
    content: (handle) => {
      const confirm = el('button', { type: 'button', text: 'Delete for good' });
      const keep = el('button', { type: 'button', text: 'Keep board' });
      on(confirm, 'click', () => {
        view.leaveAfter('/', () => api.del(`/api/boards/${view.board.id}`));
      });
      on(keep, 'click', () => handle.close());
      return [
        el('h2', { text: 'Delete this board?' }),
        el('p', { text: BOARD_COPY.deleteConfirm(view.board.title) }),
        el('div', { class: 'dialog-actions' }, [confirm, keep]),
      ];
    },
  });
};

export const boardSettingsDialog = (view: BoardView, opener: HTMLElement): void => {
  openDialog({
    name: 'Board settings',
    opener,
    content: (handle) => {
      const privacyGroup = el('fieldset', { role: 'radiogroup', 'aria-label': 'Privacy' });
      const privacyInputs = new Map<Privacy, HTMLInputElement>();
      for (const [value, label] of [
        ['private', 'Private'],
        ['password', 'Password'],
        ['public', 'Public'],
      ] as Array<[Privacy, string]>) {
        const input = el('input', {
          type: 'radio',
          name: 'privacy',
          value,
          'aria-label': label,
          checked: view.board.privacy === value,
        });
        privacyInputs.set(value, input);
        privacyGroup.append(el('label', { class: 'radio-option' }, [input, label]));
      }

      const password = el('input', { type: 'password', 'aria-label': 'Board password' });
      const passwordMessage = el('p', { class: 'field-message', text: SETTINGS_COPY.boardPassword });

      const linkGroup = el('fieldset', { role: 'radiogroup', 'aria-label': 'Link access' });
      const linkInputs = new Map<LinkAccess, HTMLInputElement>();
      for (const [value, label] of [
        ['off', 'Off'],
        ['view', 'Can view'],
        ['contribute', 'Can contribute'],
      ] as Array<[LinkAccess, string]>) {
        const input = el('input', {
          type: 'radio',
          name: 'link-access',
          value,
          'aria-label': label,
          checked: view.board.link_access === value,
        });
        linkInputs.set(value, input);
        linkGroup.append(el('label', { class: 'radio-option' }, [input, label]));
      }

      const shareLine = el('p', { class: 'muted' });
      const showLinks = (): void => {
        const parts: string[] = [];
        if (view.board.share_path !== null) parts.push(`${window.location.origin}${view.board.share_path}`);
        if (view.board.embed_path !== null) parts.push(`${window.location.origin}${view.board.embed_path}`);
        shareLine.textContent = parts.join(' ');
      };
      showLinks();

      const rotate = el('button', { type: 'button', text: 'Rotate link' });
      on(rotate, 'click', () => {
        void api.post(`/api/boards/${view.board.id}/rotate-link`).then(async () => {
          await view.refresh();
          showLinks();
        });
      });

      const approval = el('input', { type: 'checkbox', 'aria-label': 'Require approval', checked: view.board.approval });
      const save = el('button', { type: 'button', text: 'Save settings' });
      const remove = el('button', { type: 'button', text: 'Delete board' });
      const alert = el('p', { role: 'alert' });

      on(save, 'click', () => {
        const privacy = [...privacyInputs.entries()].find(([, input]) => input.checked)?.[0] ?? view.board.privacy;
        const linkAccess = [...linkInputs.entries()].find(([, input]) => input.checked)?.[0] ?? view.board.link_access;
        const payload: Record<string, unknown> = {
          privacy,
          link_access: linkAccess,
          approval: approval.checked,
        };
        if (password.value !== '') payload.password = password.value;
        void api
          .patch(`/api/boards/${view.board.id}`, payload)
          .then(async () => {
            handle.close();
            await view.refresh();
          })
          .catch((error: unknown) => {
            if (!(error instanceof RequestFailed)) throw error;
            const problem = error.fieldError('password') ?? error.fieldError('title');
            passwordMessage.textContent = error.fieldError('password') ?? SETTINGS_COPY.boardPassword;
            alert.textContent = problem ?? '';
          });
      });
      on(remove, 'click', () => deleteBoardDialog(view, remove));

      return [
        el('h2', { text: 'Board settings' }),
        privacyGroup,
        field('Board password', password, passwordMessage),
        linkGroup,
        shareLine,
        rotate,
        el('label', { class: 'radio-option' }, [approval, 'Require approval']),
        el('div', { class: 'dialog-actions' }, [save, remove]),
        alert,
      ];
    },
  });
};

interface MemberRow {
  user_id: string;
  display_name: string;
  email: string;
  role: Role;
}

export const membersDialog = (view: BoardView, opener: HTMLElement): void => {
  let unsubscribe = (): void => undefined;
  openDialog({
    name: 'Members',
    opener,
    onClose: () => unsubscribe(),
    content: () => {
      const list = el('div', {});
      const email = el('input', { type: 'email', 'aria-label': 'Invite by email' });
      const inviteRole = el('select', { 'aria-label': 'Invite role' });
      for (const [value, label] of Object.entries(ROLE_LABELS)) {
        inviteRole.append(el('option', { value, text: label, selected: value === 'contributor' }));
      }
      const sendInvite = el('button', { type: 'button', text: 'Send invite' });
      const status = el('p', { role: 'status', 'aria-label': 'Invite status' });
      const alert = el('p', { role: 'alert' });
      const emailMessage = messageLine();

      let rowSignature = '';
      const refreshRows = async (): Promise<void> => {
        const result = await api.get<{ members: MemberRow[] }>(`/api/boards/${view.board.id}/members`);
        const signature = JSON.stringify(result.members);
        if (signature === rowSignature) return;
        rowSignature = signature;
        list.replaceChildren(
          ...result.members.map((member) => {
            const row = el('div', { class: 'member-row' }, [
              el('span', { class: 'name', text: member.display_name }),
              el('span', { class: 'muted', text: member.email }),
            ]);
            if (member.role === 'owner') {
              row.append(el('span', { text: 'Owner' }));
              return row;
            }
            const roleSelect = el('select', { 'aria-label': `Role for ${member.display_name}` });
            for (const [value, label] of Object.entries(ROLE_LABELS)) {
              roleSelect.append(el('option', { value, text: label, selected: value === member.role }));
            }
            on(roleSelect, 'change', () => {
              void api
                .patch(`/api/boards/${view.board.id}/members/${member.user_id}`, { role: roleSelect.value })
                .then(() => refreshRows());
            });
            const removeMember = el('button', {
              type: 'button',
              'aria-label': `Remove ${member.display_name}`,
              text: 'Remove',
            });
            on(removeMember, 'click', () => {
              void api.del(`/api/boards/${view.board.id}/members/${member.user_id}`).then(async () => {
                await refreshRows();
                const next = list.querySelector<HTMLElement>('select');
                if (next !== null) next.focus();
                else email.focus();
              });
            });
            row.append(roleSelect, removeMember);
            return row;
          }),
        );
      };

      const invite = async (): Promise<void> => {
        emailMessage.textContent = '';
        alert.textContent = '';
        status.textContent = '';
        try {
          await api.post(`/api/boards/${view.board.id}/invites`, { email: email.value, role: inviteRole.value });
          status.textContent = MEMBERS_COPY.inviteSent(email.value.trim().toLowerCase());
          email.value = '';
        } catch (error) {
          if (!(error instanceof RequestFailed)) throw error;
          if (error.code === 'mail_unavailable') alert.textContent = MEMBERS_COPY.mailDown;
          else emailMessage.textContent = error.fieldError('email') ?? MEMBERS_COPY.emailRequired;
        }
      };

      on(sendInvite, 'click', () => void invite());
      on(email, 'keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void invite();
        }
      });
      void refreshRows();
      unsubscribe = view.onUpdate(() => void refreshRows());

      return [
        el('h2', { text: 'Members' }),
        list,
        field('Invite by email', email, emailMessage),
        field('Invite role', inviteRole),
        sendInvite,
        status,
        alert,
      ];
    },
  });
};
