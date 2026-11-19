import { announce, el, on } from '../lib/dom.js';
import { ApiFailure, call } from '../lib/api.js';
import { COPY } from '../lib/copy.js';
import { makeLife } from '../lib/life.js';
import { focusByName, focusIdOf } from '../lib/focus.js';
import { dropTabState, loadTabState, readSavedScreen, saveTabState } from '../lib/state.js';
import type { Me } from '../lib/state.js';
import { afterSignIn, type Screen } from '../router.js';

type Saved = { email: string; focusId: string | null; alert: string };

const TAB_KEY = 'sign-in';

export function signInScreen(): Screen {
  const life = makeLife();
  const next = new URL(location.href).searchParams.get('next');
  const saved = loadTabState<Saved>(TAB_KEY);
  const ended = readSavedScreen();

  const alertBox = el('p', {
    class: 'sign-in-alert',
    role: 'alert',
    tabindex: '-1',
  });

  const timer = el('p', {
    class: 'sign-in-timer',
    role: 'timer',
    'aria-label': 'Sign-in locked',
    hidden: true,
  });

  const email = el('input', {
    type: 'email',
    id: 'sign-in-email',
    class: 'text-box',
    'aria-label': 'Email',
    autocomplete: 'username',
    'data-focus-id': 'email',
  });
  const password = el('input', {
    type: 'password',
    id: 'sign-in-password',
    class: 'text-box',
    'aria-label': 'Password',
    autocomplete: 'current-password',
    'data-focus-id': 'password',
  });
  const submit = el(
    'button',
    { type: 'submit', class: 'block-button sign-in-submit', 'data-focus-id': 'submit' },
    'Sign in',
  );

  let locked = false;
  let countdown: number | null = null;

  const stopTimer = (): void => {
    if (countdown !== null) window.clearInterval(countdown);
    countdown = null;
    timer.hidden = true;
    timer.removeAttribute('data-seconds-left');
    timer.textContent = '';
    locked = false;
    submit.setAttribute('aria-disabled', 'false');
  };

  const runTimer = (seconds: number): void => {
    locked = true;
    submit.setAttribute('aria-disabled', 'true');
    let left = seconds;
    const show = (): void => {
      timer.hidden = false;
      timer.dataset['secondsLeft'] = String(left);
      timer.textContent = `${left} s`;
      if (left <= 0) stopTimer();
      left -= 1;
    };
    show();
    countdown = window.setInterval(show, 1000);
    life.after(seconds * 1000 + 1500, () => undefined);
  };

  const remember = (): void => {
    saveTabState<Saved>(TAB_KEY, {
      email: email.value,
      focusId: focusIdOf(document.activeElement) ?? null,
      alert: alertBox.textContent ?? '',
    } as Saved);
  };

  const showAlert = (message: string): void => {
    announce(alertBox, message);
    remember();
  };

  const form = el('form', { class: 'sign-in-form', novalidate: true }, [
    alertBox,
    timer,
    el('label', { class: 'field', for: 'sign-in-email' }, [el('span', {}, 'Email'), email]),
    el('label', { class: 'field', for: 'sign-in-password' }, [el('span', {}, 'Password'), password]),
    submit,
  ]);

  let working = false;
  const attempt = async (): Promise<void> => {
    if (locked || working) return;
    working = true;
    showAlert(COPY.signInPending);
    try {
      const answer = await call<{ user: { id: string } }>('POST', '/api/session', {
        body: { email: email.value, password: password.value },
        ignoreSessionEnd: true,
      });
      const me = await call<Me>('GET', '/api/me', { ignoreSessionEnd: true });
      void answer;
      dropTabState(TAB_KEY);
      stopTimer();
      await afterSignIn(me, next);
    } catch (error) {
      working = false;
      password.value = '';
      if (error instanceof ApiFailure && error.code === 'too_many_attempts') {
        const retryAfter = Number(error.payload['retry_after'] ?? 0);
        showAlert(`Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes.`);
        runTimer(retryAfter);
        alertBox.focus();
        return;
      }
      showAlert(COPY.signInWrong);
      email.focus();
      return;
    }
    working = false;
  };

  on(form, 'submit', (event) => {
    event.preventDefault();
    void attempt();
  });
  for (const field of [email, password]) {
    on(field, 'keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault();
        void attempt();
      }
    });
    on(field, 'input', remember);
  }
  life.listen(form, 'focusin', remember);

  const node = el('section', { class: 'sign-in-screen' }, [
    el('h1', { class: 'screen-title' }, 'Sign in'),
    form,
  ]);

  return {
    node,
    destroy: () => {
      if (countdown !== null) window.clearInterval(countdown);
      life.kill();
    },
    afterMount: () => {
      if (saved) {
        email.value = saved.email;
        if (saved.alert) alertBox.textContent = saved.alert;
      }
      if (ended?.sessionEnded) announce(alertBox, COPY.sessionEnded);
      submit.setAttribute('aria-disabled', 'false');
      if (!saved || !focusByName(node, saved.focusId)) email.focus();
      remember();
    },
  };
}
