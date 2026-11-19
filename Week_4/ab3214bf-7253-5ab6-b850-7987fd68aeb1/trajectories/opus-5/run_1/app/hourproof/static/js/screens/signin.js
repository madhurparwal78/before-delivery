// Sign in, then land on the role's published route.

import { raw } from '../api.js';
import { el, problems } from '../dom.js';
import { field } from '../dialog.js';
import { rememberEmail } from '../main.js';
import { navigate } from '../router.js';

export function mount({ container }) {
  const email = field({ label: 'Email', name: 'email' });
  const password = field({ label: 'Password', name: 'password' });
  const alertRegion = el('div', {
    role: 'alert',
    'aria-live': 'assertive',
    'aria-label': 'Problems to fix',
    className: 'problems',
  });
  const submit = el('button', { type: 'button', text: 'Sign in' });
  const form = el(
    'div',
    { className: 'panel centred stack', dataset: { formRoot: 'true' } },
    [
      el('h1', { text: 'SIGN IN.' }),
      alertRegion,
      email.wrap,
      password.wrap,
      submit,
    ]
  );
  const send = async () => {
    const answer = await raw('POST', '/api/auth/sign-in', {
      email: email.input.value,
      password: password.input.value,
    });
    if (answer.status === 200) {
      rememberEmail(email.input.value);
      navigate(answer.data.landing_url);
      return;
    }
    problems(alertRegion, {
      message: "That email and password don't match — try again.",
    });
  };
  submit.addEventListener('click', send);
  [email.input, password.input].forEach((input) =>
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') send();
    })
  );
  container.append(form);
  return {};
}
