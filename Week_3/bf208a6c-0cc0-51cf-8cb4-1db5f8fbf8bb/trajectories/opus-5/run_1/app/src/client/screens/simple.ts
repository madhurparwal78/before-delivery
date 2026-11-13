import { ACCESS_COPY } from '../../shared/copy';
import type { UserDto } from '../../shared/types';
import { RequestFailed, api } from '../api';
import { el, field, on } from '../dom';

export const renderNotFound = (root: HTMLElement): void => {
  root.append(
    el('div', { class: 'column' }, [
      el('h1', { text: ACCESS_COPY.notFoundHeading }),
      el('p', { text: ACCESS_COPY.notFoundText }),
      el('p', {}, [el('a', { href: '/', text: 'Pinsheet' })]),
    ]),
  );
};

export const renderPasswordScreen = (root: HTMLElement, target: { boardId: string | null; token: string | null }): void => {
  const password = el('input', { type: 'password', 'aria-label': 'Board password' });
  const open = el('button', { type: 'button', text: 'Open board' });
  const alert = el('p', { role: 'alert' });

  const unlock = async (): Promise<void> => {
    alert.textContent = '';
    const path =
      target.token === null ? `/api/boards/${target.boardId}/unlock` : `/api/links/${target.token}/unlock`;
    try {
      await api.post(path, { password: password.value });
      window.location.reload();
    } catch (error) {
      if (error instanceof RequestFailed) alert.textContent = ACCESS_COPY.badPassword;
    }
  };

  on(open, 'click', () => void unlock());
  on(password, 'keydown', (event) => {
    if (event.key === 'Enter') void unlock();
  });

  root.append(
    el('div', { class: 'column' }, [
      el('h1', { text: ACCESS_COPY.passwordHeading }),
      field('Board password', password),
      open,
      alert,
    ]),
  );
  password.focus();
};

interface InviteData {
  board_title: string;
  inviter_name: string;
  role: string;
  expired: boolean;
}

export const renderInvite = async (root: HTMLElement, token: string, user: UserDto | null): Promise<void> => {
  const invite = await api.get<InviteData>(`/api/invites/${token}`);
  if (invite.expired) {
    root.append(el('div', { class: 'column' }, [el('h1', { text: ACCESS_COPY.inviteExpired })]));
    return;
  }
  const column = el('div', { class: 'column' }, [
    el('h1', { text: invite.board_title }),
    el('p', { text: `${invite.inviter_name} invited you as a ${invite.role}.` }),
  ]);
  const alert = el('p', { role: 'alert' });
  if (user === null) {
    column.append(
      el('a', { href: `/signin?next=/invite/${token}`, text: 'Sign in' }),
      el('a', { href: `/signup?next=/invite/${token}`, text: 'Create account' }),
    );
  } else {
    const join = el('button', { type: 'button', text: 'Join board' });
    on(join, 'click', () => {
      void api
        .post<{ board_id: string }>(`/api/invites/${token}/accept`)
        .then((result) => window.location.assign(`/b/${result.board_id}`))
        .catch((error: unknown) => {
          if (error instanceof RequestFailed) alert.textContent = ACCESS_COPY.inviteExpired;
        });
    });
    column.append(join, alert);
  }
  root.append(column);
};
