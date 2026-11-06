import { call } from '../lib/api.js';
import { el, focus, setFieldError } from '../lib/dom.js';
import { liveRegion, pending, problemsSummary, textbox } from '../lib/forms.js';
import { navigate, pageHeading, type RenderContext, type Screen, type ScreenResult } from '../lib/router.js';
import { setMember } from '../lib/session.js';
import { copy } from '../lib/copy.js';
import type { Member } from '../../shared/types.js';

const FIELD_IDS: Record<string, string> = {
  email: 'account-email',
  password: 'account-password',
};

export const signInScreen: Screen = {
  pattern: '/sign-in',
  async render(ctx: RenderContext): Promise<ScreenResult> {
    const live = liveRegion('Account announcements');
    const problems = problemsSummary();
    const email = textbox({ id: FIELD_IDS.email, label: 'Email', type: 'email', autocomplete: 'username' });
    const password = textbox({
      id: FIELD_IDS.password,
      label: 'Password',
      type: 'password',
      autocomplete: 'current-password',
    });
    const submit = el('button', { type: 'submit', class: 'button', text: 'Sign in' });
    const form = el('form', { class: 'form', novalidate: true }, [
      problems.node,
      email.field,
      password.field,
      submit,
      el('a', { class: 'link', href: '/forgot-password', text: 'Forgot password?' }),
    ]);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const spinner = pending(submit, 'Signing in…');
      spinner.start();
      const result = await call<{ member: Member; home: string }>('POST', '/api/session', {
        body: { email: email.input.value, password: password.input.value },
      });
      spinner.stop();
      if (result.status === 422 && result.error?.errors) {
        problems.show(result.error.errors, FIELD_IDS, form);
        live.announce(copy.validation(Object.keys(result.error.errors).length));
        focus(form.querySelector<HTMLElement>(`#${FIELD_IDS[Object.keys(result.error.errors)[0]]}`));
        return;
      }
      if (result.status === 401) {
        setFieldError(form, FIELD_IDS.password, copy.invalidCredentials);
        live.announce(copy.invalidCredentials);
        focus(password.input);
        return;
      }
      if (!result.body) {
        live.announce('Signing in failed.');
        return;
      }
      setMember(result.body.member);
      const target = ctx.query.get('return');
      navigate(target && target.startsWith('/') ? target : result.body.home, { replace: true });
    });

    return {
      node: el('main', { class: 'page page-account' }, [
        pageHeading('Sign in', { display: false }),
        form,
        live.node,
      ]),
      chrome: 'plain',
    };
  },
};

export const forgotPasswordScreen: Screen = {
  pattern: '/forgot-password',
  async render(): Promise<ScreenResult> {
    const live = liveRegion('Account announcements');
    const problems = problemsSummary();
    const email = textbox({ id: FIELD_IDS.email, label: 'Email', type: 'email', autocomplete: 'username' });
    const submit = el('button', { type: 'submit', class: 'button', text: 'Send reset link' });
    const form = el('form', { class: 'form', novalidate: true }, [problems.node, email.field, submit]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const spinner = pending(submit, 'Sending…');
      spinner.start();
      const result = await call<{ message: string }>('POST', '/api/password-resets', {
        body: { email: email.input.value },
      });
      spinner.stop();
      live.announce(result.body?.message ?? 'That request could not be sent.');
    });
    return {
      node: el('main', { class: 'page page-account' }, [
        pageHeading('Forgot password', { display: false }),
        form,
        live.node,
      ]),
      chrome: 'plain',
    };
  },
};

function setPasswordScreen(pattern: string, heading: string, path: (token: string) => string): Screen {
  return {
    pattern,
    async render(ctx: RenderContext): Promise<ScreenResult> {
      const live = liveRegion('Account announcements');
      const problems = problemsSummary();
      const password = textbox({
        id: FIELD_IDS.password,
        label: 'New password',
        type: 'password',
        autocomplete: 'new-password',
      });
      const submit = el('button', { type: 'submit', class: 'button', text: 'Set password' });
      const form = el('form', { class: 'form', novalidate: true }, [problems.node, password.field, submit]);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const spinner = pending(submit, 'Saving…');
        spinner.start();
        const result = await call<{ member: Member; home: string }>('POST', path(ctx.params.token), {
          body: { password: password.input.value },
        });
        spinner.stop();
        if (result.status === 422 && result.error?.errors) {
          problems.show(result.error.errors, FIELD_IDS, form);
          live.announce(copy.validation(Object.keys(result.error.errors).length));
          focus(password.input);
          return;
        }
        if (result.status === 410) {
          live.announce('That link has already been used. Ask for a new one.');
          return;
        }
        if (!result.body) {
          live.announce('That password could not be set.');
          return;
        }
        setMember(result.body.member);
        navigate(result.body.home, { replace: true });
      });
      return {
        node: el('main', { class: 'page page-account' }, [
          pageHeading(heading, { display: false }),
          form,
          live.node,
        ]),
        chrome: 'plain',
      };
    },
  };
}

export const resetPasswordScreen = setPasswordScreen(
  '/reset/:token',
  'Choose a new password',
  (token) => `/api/password-resets/${token}`,
);

export const invitationScreen = setPasswordScreen(
  '/invite/:token',
  'Set your Rungboard password',
  (token) => `/api/invitations/${token}/accept`,
);
