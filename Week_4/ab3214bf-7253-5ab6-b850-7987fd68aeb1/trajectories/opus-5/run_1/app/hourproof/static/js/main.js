// Boot: the motion contract, the session-end dialog, then the first screen.

import { raw, setSignInHandler } from './api.js';
import { Dialog, field } from './dialog.js';
import { el, problems } from './dom.js';
import { startMotionWatch } from './motion.js';
import { render } from './router.js';

const EMAIL_KEY = 'hourproof-email';

export function rememberEmail(email) {
  window.sessionStorage.setItem(EMAIL_KEY, email);
}

function rememberedEmail() {
  return window.sessionStorage.getItem(EMAIL_KEY) || '';
}

let pending = null;

function signInAgain() {
  if (pending) return pending;
  pending = new Promise((resolve) => {
    const dialog = new Dialog({ name: 'Sign in again' });
    dialog.node.dataset.formRoot = 'true';
    const password = field({ label: 'Password', name: 'password' });
    dialog.bodyNode.append(
      el('p', { text: 'Your session ended. Sign in to finish.' }),
      password.wrap
    );
    const submit = el('button', { type: 'button', text: 'Sign in' });
    const cancel = el('button', { type: 'button', text: 'Cancel' });
    const finish = (value) => {
      pending = null;
      dialog.close();
      resolve(value);
    };
    submit.addEventListener('click', async () => {
      const answer = await raw('POST', '/api/auth/sign-in', {
        email: rememberedEmail(),
        password: password.input.value,
      });
      if (answer.status === 200) {
        finish(true);
        return;
      }
      problems(dialog.problemsRegion, {
        message: "That email and password don't match — try again.",
      });
    });
    cancel.addEventListener('click', () => finish(false));
    dialog.onClose = () => {
      if (pending) {
        pending = null;
        resolve(false);
      }
    };
    dialog.buttonsNode.append(submit, cancel);
  });
  return pending;
}

startMotionWatch();
setSignInHandler(signInAgain);
render();
