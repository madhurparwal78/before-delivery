import { api, showFieldError, toast } from './app.js';

const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFieldError('login-error', '');
    showFieldError('login-id-error', '');
    showFieldError('login-pw-error', '');
    const identifier = document.getElementById('login-id').value.trim();
    const password = document.getElementById('login-pw').value;
    if (!identifier) { showFieldError('login-id-error', 'Your username is needed.'); return; }
    if (password.length < 8) { showFieldError('login-pw-error', 'A password is at least 8 characters.'); return; }
    const button = document.getElementById('login-submit');
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email: identifier, password } });
      window.localStorage.setItem('gh_token', data.token);
      const next = document.getElementById('next-url').value;
      window.location.href = next && next.startsWith('/') ? next : '/hall';
    } catch (error) {
      showFieldError('login-error', error.message);
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });
}

const joinForm = document.getElementById('join-form');
if (joinForm) {
  joinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    ['join-error', 'join-username-error', 'join-email-error', 'join-password-error']
      .forEach((id) => showFieldError(id, ''));
    const username = document.getElementById('join-username').value.trim();
    const email = document.getElementById('join-email').value.trim();
    const password = document.getElementById('join-password').value;
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      showFieldError('join-username-error', 'A username is 3 to 20 characters of letters, digits and the underscore only.');
      return;
    }
    if (password.length < 8) { showFieldError('join-password-error', 'A password is at least 8 characters.'); return; }
    try {
      await api('/api/auth/register', { method: 'POST', body: { username, email, password } });
      await api('/api/auth/login', { method: 'POST', body: { email: username, password } });
      window.location.href = '/hall';
    } catch (error) {
      if (error.status === 409) showFieldError('join-username-error', error.message);
      else showFieldError('join-error', error.message);
      toast(error.message, 'bad');
    }
  });
}
