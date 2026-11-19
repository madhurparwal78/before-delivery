import { ApiFailure, api } from '../api';
import { h, replace } from '../dom';
import { notice, showAlert } from '../regions';
import { navigate, refreshSession, type ScreenCtx } from '../router';
import { actionButton, labelledInput, problemAlert } from '../ui';
import { renderNotFound } from './notFound';

function card(heading: string, ...children: HTMLElement[]): HTMLElement {
  return h(
    'section',
    { class: 'panel panel-dark auth-panel' },
    h('div', { class: 'card card-light' }, h('h1', { class: 'display', text: heading }), ...children),
  );
}

function showFailure(
  holder: HTMLElement,
  failure: ApiFailure,
  fields: Record<string, HTMLElement>,
  outageText: string,
): void {
  if (failure.status === 503) {
    showAlert(outageText);
    return;
  }
  if (failure.field !== null && fields[failure.field] !== undefined) {
    replace(holder, problemAlert(failure.message, () => fields[failure.field as string].focus()));
    return;
  }
  notice(failure.message);
}

export async function renderSignUp(): Promise<HTMLElement> {
  const name = labelledInput('Name', 'text');
  const email = labelledInput('Email', 'text');
  const password = labelledInput('Password', 'password');
  const problem = h('div', { class: 'problem-holder' });
  const action = actionButton(
    'Create account',
    async () => {
      replace(problem);
      try {
        await api('POST', '/api/auth/sign-up', {
          name: name.input.value,
          email: email.input.value,
          password: password.input.value,
        });
        notice('Check your email to confirm your account');
      } catch (error) {
        if (error instanceof ApiFailure) {
          showFailure(
            problem,
            error,
            { name: name.input, email: email.input, password: password.input },
            'Email is unavailable. Your account was not created.',
          );
        }
      }
    },
    { variant: 'primary' },
  );
  return card('Create a workspace', problem, name.wrapper, email.wrapper, password.wrapper, action.element);
}

export async function renderSignIn(): Promise<HTMLElement> {
  const email = labelledInput('Email', 'text');
  const password = labelledInput('Password', 'password');
  const problem = h('div', { class: 'problem-holder' });
  const action = actionButton(
    'Sign in',
    async () => {
      replace(problem);
      try {
        const result = await api<{ workspace_id: string | null }>('POST', '/api/auth/sign-in', {
          email: email.input.value,
          password: password.input.value,
        });
        await refreshSession();
        navigate(result.workspace_id === null ? '/' : `/w/${result.workspace_id}`);
      } catch (error) {
        if (error instanceof ApiFailure) {
          showFailure(problem, error, { email: email.input, password: password.input }, 'Email is unavailable.');
        }
      }
    },
    { variant: 'primary' },
  );
  return card('Sign in', problem, email.wrapper, password.wrapper, action.element);
}

export async function renderConfirm(ctx: ScreenCtx): Promise<HTMLElement> {
  try {
    const result = await api<{ workspace_id: string | null }>('POST', '/api/auth/confirm', {
      token: ctx.params.token,
    });
    await refreshSession();
    window.setTimeout(() => navigate(result.workspace_id === null ? '/' : `/w/${result.workspace_id}`), 0);
    return card('Confirming your email', h('p', { class: 'body-text', text: 'Taking you to your workspace.' }));
  } catch {
    return renderNotFound();
  }
}

export async function renderInvite(ctx: ScreenCtx): Promise<HTMLElement> {
  let invite: { workspace_name: string; email: string; role: string; has_account: boolean };
  try {
    invite = await api('GET', `/api/invites/${encodeURIComponent(ctx.params.token)}`);
  } catch {
    return renderNotFound();
  }
  const name = labelledInput('Name', 'text');
  const password = labelledInput('Password', 'password');
  const problem = h('div', { class: 'problem-holder' });
  const action = actionButton(
    'Join workspace',
    async () => {
      replace(problem);
      try {
        const result = await api<{ workspace_id: string }>(
          'POST',
          `/api/invites/${encodeURIComponent(ctx.params.token)}/accept`,
          { name: name.input.value, password: password.input.value },
        );
        await refreshSession();
        navigate(`/w/${result.workspace_id}`);
      } catch (error) {
        if (error instanceof ApiFailure) {
          showFailure(problem, error, { name: name.input, password: password.input }, 'Email is unavailable.');
        }
      }
    },
    { variant: 'primary' },
  );
  return card(
    `Join ${invite.workspace_name}`,
    problem,
    h('p', { class: 'body-text', text: `Invited as ${invite.role}: ${invite.email}` }),
    name.wrapper,
    password.wrapper,
    action.element,
  );
}
