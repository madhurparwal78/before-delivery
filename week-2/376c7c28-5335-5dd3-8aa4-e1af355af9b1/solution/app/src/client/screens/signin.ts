import { post, RequestFailed } from '../api.ts';
import { homePath, refreshStudio, setUser, type ScreenRender, type User } from '../app.ts';
import { el, field, setFieldError } from '../dom.ts';
import { failureCopy, Region, withPending } from '../feedback.ts';

export const renderSignIn: ScreenRender = ({ mount, navigate }) => {
  const studioInput = el('input', { type: 'text', 'aria-label': 'Studio', autocomplete: 'off' });
  const emailInput = el('input', { type: 'email', 'aria-label': 'Email', autocomplete: 'username' });
  const passwordInput = el('input', { type: 'password', autocomplete: 'current-password' });
  const studioField = field('Studio', studioInput, 'signin-studio');
  const emailField = field('Email', emailInput, 'signin-email');
  const passwordField = field('Password', passwordInput, 'signin-password');
  const region = new Region('Sign-in status');
  const submit = el('button', { type: 'submit', class: 'btn primary', text: 'SIGN IN' });

  const form = el('form', { novalidate: true, class: 'stack' }, [
    studioField.wrap,
    emailField.wrap,
    passwordField.wrap,
    submit,
    region.node,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const entry of [studioField, emailField, passwordField]) {
      setFieldError(entry.wrap.querySelector('input') as HTMLElement, entry.error, '');
    }
    void withPending(region, submit, 'Signing in…', async () => {
      try {
        const answer = await post<{ user: User }>('/api/session', {
          studio: studioInput.value,
          email: emailInput.value,
          password: passwordInput.value,
        });
        setUser(answer.user);
        await refreshStudio();
        region.clear();
        navigate(homePath(answer.user.role), true);
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        region.say(
          failureCopy(error.failure, {
            invalid_credentials: 'Studio, email or password is wrong.',
            account_inactive: 'This account is not active. Ask the studio owner.',
          }),
        );
      }
    });
  });

  // replace, not append: the session-ended state may show this form again on the same mount
  mount.replaceChildren(
    el('div', { class: 'centred' }, [
      el('section', { class: 'panel narrow' }, [
        el('h1', { class: 'heading', text: 'SIGN IN' }),
        form,
      ]),
    ]),
  );
};
