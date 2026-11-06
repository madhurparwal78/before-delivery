import { get, post, RequestFailed } from '../api.ts';
import { homePath, refreshStudio, setUser, type ScreenRender, type User } from '../app.ts';
import { el, field, replace, setFieldError } from '../dom.ts';
import { failureCopy, Region, withPending } from '../feedback.ts';

interface InviteView {
  readonly studio_name: string;
  readonly email: string;
  readonly role: string;
}

export const renderJoin: ScreenRender = ({ mount, params, navigate }) => {
  const region = new Region('Join status');
  const panel = el('section', { class: 'panel narrow' });
  mount.appendChild(el('div', { class: 'centred' }, [panel]));

  const invalid = (message: string): void => {
    replace(panel, [el('h1', { class: 'heading', text: 'JOIN KILN DESK' }), region.node]);
    region.say(message);
  };

  void (async () => {
    let invite: InviteView;
    try {
      invite = await get<InviteView>(`/api/invites/${encodeURIComponent(params['token'] ?? '')}`);
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      invalid(
        failureCopy(error.failure, {
          not_found: 'This invite link is not valid.',
          invite_gone: 'This invite has expired or was already used.',
        }),
      );
      return;
    }

    const nameInput = el('input', { type: 'text', 'aria-label': 'Your name', autocomplete: 'name' });
    const handleInput = el('input', { type: 'text', 'aria-label': 'Studio handle', autocomplete: 'off' });
    const passwordInput = el('input', { type: 'password', autocomplete: 'new-password' });
    const nameField = field('Your name', nameInput, 'join-name');
    const handleField = field('Studio handle', handleInput, 'join-handle');
    const passwordField = field('Choose a password', passwordInput, 'join-password');
    const submit = el('button', {
      type: 'submit',
      class: 'btn primary',
      'aria-label': 'Join studio',
      text: `JOIN ${invite.studio_name.toUpperCase()}`,
    });
    const form = el('form', { novalidate: true, class: 'stack' }, [
      nameField.wrap,
      handleField.wrap,
      passwordField.wrap,
      submit,
      region.node,
    ]);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setFieldError(nameInput, nameField.error, '');
      setFieldError(handleInput, handleField.error, '');
      setFieldError(passwordInput, passwordField.error, '');
      void withPending(region, submit, 'Joining…', async () => {
        try {
          const answer = await post<{ user: User }>(
            `/api/invites/${encodeURIComponent(params['token'] ?? '')}/accept`,
            { name: nameInput.value, handle: handleInput.value, password: passwordInput.value },
          );
          setUser(answer.user);
          await refreshStudio();
          region.clear();
          navigate(homePath(answer.user.role), true);
        } catch (error) {
          if (!(error instanceof RequestFailed)) throw error;
          const errors = error.failure.errors ?? {};
          setFieldError(nameInput, nameField.error, errors['name'] ?? '');
          setFieldError(handleInput, handleField.error, errors['handle'] ?? '');
          setFieldError(passwordInput, passwordField.error, errors['password'] ?? '');
          region.say(
            failureCopy(error.failure, {
              not_found: 'This invite link is not valid.',
              invite_gone: 'This invite has expired or was already used.',
            }),
          );
        }
      });
    });

    replace(panel, [
      el('h1', { class: 'heading', text: `JOIN ${invite.studio_name.toUpperCase()}` }),
      el('p', { class: 'muted', text: `Invited as ${invite.email}` }),
      form,
    ]);
  })();
};
