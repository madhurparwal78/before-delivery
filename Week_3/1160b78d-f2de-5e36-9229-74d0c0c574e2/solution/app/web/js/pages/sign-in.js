import { html, useState } from '../lib/html.js';
import { api, fieldErrors } from '../lib/api.js';
import { Button, Problems, FieldError } from '../lib/ui.js';

// The sign-in screen opens no socket.
export const socket = false;

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState(null);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.target);
    const res = await api.post('/api/session', { email: form.get('email'), password: form.get('password') }, { keepOn401: true });
    if (res.ok) {
      location.assign('/oncall');
      return;
    }
    setErrors(res.status === 401 ? { password: 'That email and password do not match.' } : fieldErrors(res) ?? { password: 'Sign-in is not available right now.' });
    setBusy(false);
  };
  return html`<form class="signin" onSubmit=${submit} noValidate>
    <${Problems} errors=${errors} />
    <div class="field">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" required />
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <${FieldError} errors=${errors} name="password" />
    </div>
    <div class="toolbar">
      <${Button} type="submit" busy=${busy}>Sign in</${Button}>
      <a class="linkbutton" href="/status">Status page</a>
    </div>
  </form>`;
}
