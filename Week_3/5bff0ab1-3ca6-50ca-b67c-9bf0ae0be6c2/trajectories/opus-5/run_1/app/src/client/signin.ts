import { FIELD_TEXT } from '../shared/strings.js';
import type { User } from '../shared/types.js';
import {
  ApiError,
  apiPost,
  dialogByLabel,
  identityChanged,
  openDialog,
  setUser,
  user,
} from './core.js';

let open = false;
let handleOpen: { close(): void } | null = null;

identityChanged.on((next) => {
  if (next && handleOpen) handleOpen.close();
});

/** `Sign in` opens over any other dialog and leaves it in place underneath. */
export function openSignIn(): void {
  if (open) {
    const existing = dialogByLabel('Sign in');
    existing?.querySelector<HTMLElement>('input')?.focus();
    return;
  }
  if (user()) return;
  open = true;
  let creating = false;
  handleOpen = openDialog({
    label: 'Sign in',
    onClose: () => {
      open = false;
      handleOpen = null;
    },
    build: (panel, handle) => {
      const heading = document.createElement('h2');
      heading.textContent = 'Sign in';
      const error = document.createElement('p');
      error.className = 'field-note';
      const fields = document.createElement('div');
      fields.className = 'fields';
      const name = labelled('Full name', 'text');
      const mobile = labelled('Mobile number', 'text');
      const password = labelled('Password', 'password');
      const actions = document.createElement('div');
      actions.className = 'dialog-actions';
      const submit = document.createElement('button');
      submit.type = 'button';
      submit.className = 'primary';
      const toggle = document.createElement('button');
      toggle.type = 'button';

      const paint = (): void => {
        name.wrap.hidden = !creating;
        submit.textContent = creating ? 'Create account' : 'Sign in';
        toggle.textContent = creating ? 'Have an account? Sign in' : 'New here? Create an account';
      };

      toggle.addEventListener('click', () => {
        creating = !creating;
        error.textContent = '';
        paint();
        (creating ? name.input : mobile.input).focus();
      });

      submit.addEventListener('click', () => {
        void (async () => {
          error.textContent = '';
          const mobileValue = mobile.input.value.trim();
          const passwordValue = password.input.value;
          try {
            if (creating) {
              const nameValue = name.input.value.trim();
              if (nameValue.length === 0) {
                error.textContent = FIELD_TEXT.fullName;
                return;
              }
              if (!/^[6-9]\d{9}$/.test(mobileValue)) {
                error.textContent = FIELD_TEXT.mobile;
                return;
              }
              if (passwordValue.length < 8) {
                error.textContent = FIELD_TEXT.password;
                return;
              }
              const reply = await apiPost<{ user: User }>('/api/auth/register', {
                name: nameValue,
                mobile: mobileValue,
                password: passwordValue,
              });
              setUser(reply.data.user, false);
            } else {
              const reply = await apiPost<{ user: User }>('/api/auth/signin', {
                mobile: mobileValue,
                password: passwordValue,
              });
              setUser(reply.data.user, false);
            }
            handle.close();
          } catch (failure) {
            if (failure instanceof ApiError) {
              if (failure.failure.code === 'mobile_taken') error.textContent = FIELD_TEXT.mobileTaken;
              else if (failure.failure.code === 'bad_credentials') error.textContent = FIELD_TEXT.signIn;
              else error.textContent = FIELD_TEXT.signIn;
              return;
            }
            throw failure;
          }
        })();
      });

      fields.append(name.wrap, mobile.wrap, password.wrap);
      actions.append(submit, toggle);
      panel.append(heading, fields, error, actions);
      paint();
      mobile.input.focus();
    },
  });
}

function labelled(
  text: string,
  type: string,
): { wrap: HTMLLabelElement; input: HTMLInputElement } {
  const wrap = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = text;
  const input = document.createElement('input');
  input.type = type;
  input.setAttribute('aria-label', text);
  wrap.append(span, input);
  return { wrap, input };
}
