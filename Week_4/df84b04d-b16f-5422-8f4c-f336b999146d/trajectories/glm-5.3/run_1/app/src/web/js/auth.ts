import { api, el, announce, problem, PLACEHOLDER_COPY } from './api.js';

export function renderSignup(root: HTMLElement): void {
  root.innerHTML = '';
  document.title = 'Sign up — Twigline';
  root.appendChild(topBarSignedOut());
  root.appendChild(stepOne(root));
}

function topBarSignedOut(): HTMLElement {
  return el('header', { class: 'topbar' },
    el('a', { class: 'brand', href: '/' }, 'Twigline'),
    el('nav', {},
      el('a', { href: '/signin' }, 'Sign in'),
      el('a', { href: '/signup', class: 'pill' }, 'Start your outline'),
    ),
  );
}

function stepOne(root: HTMLElement): HTMLElement {
  const nameInput = el('input', { type: 'text', id: 'signup-name', autocomplete: 'name' });
  const emailInput = el('input', { type: 'email', id: 'signup-email', autocomplete: 'email' });
  const passwordInput = el('input', { type: 'password', id: 'signup-password', autocomplete: 'new-password' });
  const nameError = el('div', { class: 'error', id: 'name-error' });
  const emailError = el('div', { class: 'error', id: 'email-error' });
  const passwordError = el('div', { class: 'error', id: 'password-error' });
  const submit = el('button', { type: 'submit', class: 'pill', id: 'send-code' }, 'Send code');

  const form = el('form', { class: 'auth-card', novalidate: true },
    el('h1', {}, 'Create your outline'),
    field('Name', nameInput, nameError),
    field('Email', emailInput, emailError),
    field('Password', passwordInput, passwordError),
    submit,
    el('p', { class: 'alt' }, 'Already have an account? ', el('a', { href: '/signin' }, 'Sign in')),
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    nameError.textContent = '';
    emailError.textContent = '';
    passwordError.textContent = '';
    submit.textContent = 'Sending';
    submit.setAttribute('aria-busy', 'true');
    submit.setAttribute('disabled', '');
    const result = await api<{ status: string; errors?: Record<string, string> }>('/api/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: nameInput.value,
        email: emailInput.value,
        password: passwordInput.value,
      }),
    });
    submit.removeAttribute('disabled');
    submit.removeAttribute('aria-busy');
    submit.textContent = 'Send code';
    if (result.status === 422 && result.body.errors) {
      const errors = result.body.errors;
      if (errors.name) nameError.textContent = errors.name;
      if (errors.email) emailError.textContent = errors.email;
      if (errors.password) passwordError.textContent = errors.password;
      if (errors.name) nameInput.setAttribute('aria-invalid', 'true');
      if (errors.email) emailInput.setAttribute('aria-invalid', 'true');
      if (errors.password) passwordInput.setAttribute('aria-invalid', 'true');
      return;
    }
    if (result.status === 503) {
      problem('We couldn’t send your code right now. Try again in a minute.');
      return;
    }
    if (result.status === 202) {
      const email = emailInput.value.trim().toLowerCase();
      announce(`We sent a 6-digit code to ${email}.`);
      renderStepTwo(root, email);
    }
  });

  return el('main', { class: 'auth-band band' }, form);
}

function field(label: string, input: HTMLInputElement, error: HTMLElement): HTMLElement {
  input.required = true;
  const id = input.id;
  const labelEl = el('label', { for: id }, label);
  input.setAttribute('aria-describedby', error.id);
  return el('div', { class: 'field' }, labelEl, input, error);
}

function renderStepTwo(root: HTMLElement, email: string): void {
  root.innerHTML = '';
  root.appendChild(topBarSignedOut());
  const codeInput = el('input', { type: 'text', id: 'code', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '6', autocomplete: 'one-time-code' });
  const codeError = el('div', { class: 'error', id: 'code-error' });
  const confirm = el('button', { type: 'submit', class: 'pill' }, 'Confirm');
  const resend = el('button', { type: 'button', id: 'resend-code' }, 'Send a new code');
  const form = el('form', { class: 'auth-card', novalidate: true },
    el('h1', {}, 'Enter your code'),
    el('p', { class: 'alt', style: 'text-align:left;margin:0 0 16px' }, `We sent a 6-digit code to ${email}.`),
    field('Confirmation code', codeInput, codeError),
    confirm,
    resend,
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    codeError.textContent = '';
    confirm.textContent = 'Confirming';
    confirm.setAttribute('disabled', '');
    const result = await api<{ user?: { id: string } }>('/api/signup/confirm', {
      method: 'POST',
      body: JSON.stringify({ email, code: codeInput.value.trim() }),
    });
    confirm.removeAttribute('disabled');
    confirm.textContent = 'Confirm';
    if (result.status === 200) {
      window.location.href = '/';
      return;
    }
    if (result.status === 422 && result.body.errors?.code) {
      codeError.textContent = result.body.errors.code;
      codeInput.setAttribute('aria-invalid', 'true');
    }
  });
  resend.addEventListener('click', async () => {
    resend.setAttribute('disabled', '');
    await api('/api/signup', {
      method: 'POST',
      body: JSON.stringify({ name: '', email, password: '' }),
    });
    resend.removeAttribute('disabled');
  });
  root.appendChild(el('main', { class: 'auth-band band' }, form));
  codeInput.focus();
}

export function renderSignin(root: HTMLElement, nextPath: string | null): void {
  root.innerHTML = '';
  document.title = 'Sign in — Twigline';
  root.appendChild(topBarSignedOut());
  const emailInput = el('input', { type: 'email', id: 'signin-email', autocomplete: 'email', name: 'Email', value: nextPath?.startsWith('email=') ? nextPath.slice(6) : '' });
  const emailLabel = el('label', { for: 'signin-email' }, 'Email');
  const passwordInput = el('input', { type: 'password', id: 'signin-password', autocomplete: 'current-password', name: 'Password' });
  const passwordLabel = el('label', { for: 'signin-password' }, 'Password');
  const submit = el('button', { type: 'submit', class: 'pill', id: 'signin-button' }, 'Sign in');
  const form = el('form', { class: 'auth-card', novalidate: true },
    el('h1', {}, 'Sign in'),
    el('div', { class: 'field' }, emailLabel, emailInput),
    el('div', { class: 'field' }, passwordLabel, passwordInput),
    submit,
    el('p', { class: 'alt' }, 'New here? ', el('a', { href: '/signup' }, 'Create an account')),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.setAttribute('disabled', '');
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = 'Signing in';
    const result = await api<{ user?: { id: string } }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ email: emailInput.value, password: passwordInput.value }),
    });
    submit.removeAttribute('disabled');
    submit.removeAttribute('aria-busy');
    submit.textContent = 'Sign in';
    if (result.status === 200) {
      window.location.href = nextPath && nextPath.startsWith('/') ? nextPath : '/';
      return;
    }
    problem('Email or password is wrong.');
  });
  root.appendChild(el('main', { class: 'auth-band band' }, form));
}

export function renderInvite(root: HTMLElement, token: string): void {
  root.innerHTML = '';
  document.title = 'Invitation — Twigline';
  root.appendChild(topBarSignedOut());
  const card = el('div', { class: 'auth-card' });
  root.appendChild(el('main', { class: 'auth-band band' }, card));

  void (async () => {
    const me = await api<{ user: { email: string } | null }>('/api/me');
    const invite = await api<{ email: string; bulletText: string; inviter: { name: string }; status: string }>(`/api/invitations/${token}`);
    if (invite.status === 404) {
      renderNotFound(root);
      return;
    }
    const data = invite.body;
    if (data.status === 'lapsed') {
      card.appendChild(el('h1', {}, 'This invitation has expired'));
      card.appendChild(el('p', { class: 'alt', style: 'text-align:left' }, 'This invitation has expired. Ask the owner to send a new one.'));
      return;
    }
    if (!me.body.user) {
      card.appendChild(el('h1', {}, 'You were invited to a branch'));
      card.appendChild(el('p', { class: 'alt', style: 'text-align:left' }, `Sign in or create an account with ${data.email} to open this branch.`));
      card.appendChild(el('div', { class: 'pills', style: 'flex-direction:column' },
        el('a', { class: 'pill', href: `/signin?next=/invite/${token}&email=${encodeURIComponent(data.email)}` }, 'Sign in'),
        el('a', { class: 'pill pill-outline', href: `/signup?next=/invite/${token}&email=${encodeURIComponent(data.email)}` }, 'Create an account'),
      ));
      return;
    }
    if (me.body.user.email !== data.email) {
      card.appendChild(el('h1', {}, 'Wrong account'));
      card.appendChild(el('p', { class: 'alt', style: 'text-align:left' }, 'This invitation was sent to a different email address.'));
      return;
    }
    const accept = el('button', { class: 'pill' }, 'Accept invitation');
    card.appendChild(el('h1', {}, `${data.inviter.name} shared a branch`));
    card.appendChild(el('p', { class: 'alt', style: 'text-align:left' }, `You can now edit ${data.bulletText}.`));
    card.appendChild(accept);
    accept.addEventListener('click', async () => {
      accept.setAttribute('disabled', '');
      const result = await api<{ bulletId: string }>(`/api/invitations/${token}/accept`, { method: 'POST', body: '{}' });
      if (result.status === 200) {
        announce(`You can now edit ${data.bulletText}.`);
        window.location.href = `/b/${result.body.bulletId}`;
      } else if (result.body.error === 'invitation_lapsed') {
        problem('This invitation has expired. Ask the owner to send a new one.');
      } else if (result.body.error === 'wrong_account') {
        problem('This invitation was sent to a different email address.');
      }
    });
  })();
}

export function renderNotFound(root: HTMLElement): void {
  root.innerHTML = '';
  document.title = 'Not found — Twigline';
  root.appendChild(el('header', { class: 'topbar' },
    el('a', { class: 'brand', href: '/' }, 'Twigline'),
    el('nav', null, el('a', { href: '/', class: 'pill' }, 'Home')),
  ));
  const window = el('div', { class: 'window' },
    el('div', { class: 'window-toolbar' }, el('div', { class: 'dot-trio' }, el('span'), el('span'), el('span'))),
    el('div', { class: 'window-body' },
      el('div', { class: 'not-found' },
        el('h2', null, 'We couldn’t find that bullet'),
        el('p', null, 'It may have been deleted, or it isn’t shared with you.'),
        el('a', { class: 'pill', href: '/' }, 'Back to Home'),
      ),
    ),
  );
  root.appendChild(el('main', { class: 'outline-shell' }, window));
}

export { PLACEHOLDER_COPY };
