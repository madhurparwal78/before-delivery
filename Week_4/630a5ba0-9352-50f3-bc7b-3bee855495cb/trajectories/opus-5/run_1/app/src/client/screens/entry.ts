import { api, RequestFailed } from '../api.js';
import {
  announce,
  announceAfterRender,
  fieldError,
  loadMe,
  navigate,
  registerJoinScreen,
  registerScreen,
} from '../app.js';
import { el } from '../dom.js';
import { pending, textField, timeZoneField } from '../forms.js';
import { trialEndCopy } from '../copy.js';

function shellForm(title: string, nodes: (HTMLElement | null)[]): HTMLElement {
  return el('div', { class: 'centred-form' }, [
    el('span', { class: 'product-name', text: 'Tidemark Daybook' }),
    el('form', { 'aria-label': title, novalidate: true }, [el('h2', { text: title }), ...nodes.filter(Boolean)]),
  ]);
}

function formOf(node: HTMLElement): HTMLFormElement {
  return node.querySelector('form') as HTMLFormElement;
}

registerScreen('/signin', (root) => {
  const email = textField('Email', { type: 'email', autocomplete: 'email' });
  const password = textField('Password', { type: 'password', autocomplete: 'current-password' });
  const submit = el('button', { type: 'submit', class: 'button button--primary' }, ['Sign in']);
  const trialLink = el('a', { href: '/trial' }, ['Start a free trial']);
  trialLink.addEventListener('click', (event) => {
    event.preventDefault();
    navigate('/trial');
  });

  const wrapper = shellForm('Sign in', [
    email.wrapper,
    password.wrapper,
    submit,
    el('p', {}, [trialLink]),
  ]);
  const form = formOf(wrapper);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    pending(submit, 'Signing in…', 'Sign in');
    announce('Signing in…');
    void api
      .signIn(email.input.value, password.input.value)
      .then(async () => {
        await loadMe();
        navigate('/');
      })
      .catch((error: unknown) => {
        pending(submit, null, 'Sign in');
        const message =
          error instanceof RequestFailed && error.status === 401
            ? "That email and password don't match."
            : "That email and password don't match.";
        password.showError(message);
        announce(message);
      });
  });
  root.append(wrapper);
});

registerScreen('/trial', (root) => {
  const workspaceName = textField('Workspace name');
  const ownerName = textField('Your name');
  const email = textField('Email', { type: 'email', autocomplete: 'email' });
  const password = textField('Password', { type: 'password', autocomplete: 'new-password' });
  const zone = timeZoneField();
  const submit = el('button', { type: 'submit', class: 'button button--primary' }, ['Start free trial']);

  const wrapper = shellForm('Start your trial', [
    workspaceName.wrapper,
    ownerName.wrapper,
    email.wrapper,
    password.wrapper,
    zone.wrapper,
    submit,
  ]);
  const form = formOf(wrapper);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const field of [workspaceName, ownerName, email, password]) field.showError(null);
    pending(submit, 'Creating workspace…', 'Start free trial');
    announce('Creating workspace…');
    void api
      .startTrial({
        workspaceName: workspaceName.input.value,
        ownerName: ownerName.input.value,
        email: email.input.value,
        password: password.input.value,
        timeZone: zone.select.value,
      })
      .then(async (result) => {
        const ends = trialEndCopy(result.workspace.trialEndsAt, result.member.timeZone);
        announceAfterRender(
          result.billing === 'queued'
            ? 'Workspace created. Billing is unreachable, so your seat will be registered when it\u2019s back.'
            : `Workspace created. Your trial ends on ${ends}.`,
        );
        await loadMe();
        navigate('/');
      })
      .catch((error: unknown) => {
        pending(submit, null, 'Start free trial');
        if (error instanceof RequestFailed && error.code === 'email_taken') {
          email.showError('That email already has a Daybook.');
          announce('That email already has a Daybook.');
          return;
        }
        workspaceName.showError(fieldError(error, 'workspaceName'));
        ownerName.showError(fieldError(error, 'ownerName'));
        email.showError(fieldError(error, 'email'));
        password.showError(fieldError(error, 'password'));
        zone.showError(fieldError(error, 'timeZone'));
        announce(error instanceof RequestFailed ? error.message : 'Check the highlighted fields.');
      });
  });
  root.append(wrapper);
});

registerJoinScreen(async (root, token) => {
  let details: { workspaceName: string; email: string };
  try {
    details = await api.invitation(token);
  } catch (error: unknown) {
    const message =
      error instanceof RequestFailed && error.status === 410
        ? 'This invite has already been used.'
        : 'That invite was not found.';
    root.append(
      el('div', { class: 'centred-form' }, [
        el('span', { class: 'product-name', text: 'Tidemark Daybook' }),
        el('h2', { text: 'Invite' }),
        el('p', { text: message }),
      ]),
    );
    announce(message);
    return;
  }

  const name = textField('Your name');
  const password = textField('Password', { type: 'password', autocomplete: 'new-password' });
  const zone = timeZoneField();
  const submit = el('button', { type: 'submit', class: 'button button--primary' }, ['Join workspace']);

  const wrapper = shellForm(`Join ${details.workspaceName}`, [
    el('p', { text: `Invited as ${details.email}.` }),
    name.wrapper,
    password.wrapper,
    zone.wrapper,
    submit,
  ]);
  const form = formOf(wrapper);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    pending(submit, 'Joining…', 'Join workspace');
    announce('Joining…');
    void api
      .acceptInvitation(token, {
        name: name.input.value,
        password: password.input.value,
        timeZone: zone.select.value,
      })
      .then(async () => {
        await loadMe();
        navigate('/');
      })
      .catch((error: unknown) => {
        pending(submit, null, 'Join workspace');
        if (error instanceof RequestFailed && error.status === 410) {
          announce('This invite has already been used.');
          return;
        }
        name.showError(fieldError(error, 'name'));
        password.showError(fieldError(error, 'password'));
        zone.showError(fieldError(error, 'timeZone'));
        announce(error instanceof RequestFailed ? error.message : 'Check the highlighted fields.');
      });
  });
  root.append(wrapper);
});
