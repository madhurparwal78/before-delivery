import { el } from '../dom.js';
import { navigate, signedIn } from '../main.js';
import { ApiFailure, get, write, type Me } from '../state.js';
import { showFormError } from '../widgets.js';

const STATEMENT = 'Every number in Spoorline comes from a published rule.';

function lifecycleDrawing(): HTMLElement {
  const bands = ['hot', 'warm', 'archive', 'delete'];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Lifecycle: hot, warm, archive, delete');
  svg.setAttribute('viewBox', '0 0 400 140');
  svg.setAttribute('class', 'lifecycle-drawing');
  bands.forEach((band, index) => {
    const x = 10 + index * 96;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', '20');
    rect.setAttribute('width', '86');
    rect.setAttribute('height', '72');
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#7d7f66');
    svg.append(rect);
    for (let line = 1; line < 4; line += 1) {
      const rule = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      rule.setAttribute('x1', String(x + 8));
      rule.setAttribute('x2', String(x + 78));
      rule.setAttribute('y1', String(20 + line * 18));
      rule.setAttribute('y2', String(20 + line * 18));
      rule.setAttribute('stroke', '#c9c6ad');
      svg.append(rule);
    }
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(x + 43));
    label.setAttribute('y', '112');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '14');
    label.setAttribute('fill', '#1b241c');
    label.textContent = band;
    svg.append(label);
  });
  return svg as unknown as HTMLElement;
}

function authShell(form: HTMLElement): HTMLElement {
  return el('div', { class: 'auth-layout' }, [
    form,
    el('div', { class: 'auth-aside' }, [el('p', { text: STATEMENT }), lifecycleDrawing()]),
  ]);
}

async function enterApp(): Promise<void> {
  const me = await get<Me>('/api/me');
  await signedIn(me);
  navigate('/explore', true);
}

export function renderSignIn(main: HTMLElement): void {
  const username = el('input', { type: 'text', 'aria-label': 'Username', 'data-field': 'username' });
  const password = el('input', { type: 'password', id: 'password', 'data-field': 'password' });
  const submit = el('button', { type: 'submit', 'aria-label': 'Sign in', text: 'Sign in' });
  const form = el('form', { class: 'auth-form card' }, [
    el('h1', { class: 'view-title', text: 'Sign in' }),
    el('div', { class: 'field' }, [el('label', { text: 'Username' }), username]),
    el('div', { class: 'field' }, [el('label', { for: 'password', text: 'Password' }), password]),
    submit,
    el('a', { href: '/signup', text: 'Create an account', 'aria-label': 'Create an account' }),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.setAttribute('aria-busy', 'true');
    void (async () => {
      try {
        await write('POST', '/api/signin', { username: username.value, password: password.value });
        await enterApp();
      } catch (cause) {
        if (cause instanceof ApiFailure) showFormError(form, cause, form);
      } finally {
        submit.removeAttribute('aria-busy');
      }
    })();
  });
  main.append(authShell(form));
}

export function renderSignUp(main: HTMLElement): void {
  const username = el('input', { type: 'text', 'aria-label': 'Username', 'data-field': 'username' });
  const password = el('input', { type: 'password', id: 'password-new', 'data-field': 'password' });
  const submit = el('button', { type: 'submit', 'aria-label': 'Create account', text: 'Create account' });
  const form = el('form', { class: 'auth-form card' }, [
    el('h1', { class: 'view-title', text: 'Create an account' }),
    el('div', { class: 'field' }, [el('label', { text: 'Username' }), username]),
    el('div', { class: 'field' }, [el('label', { for: 'password-new', text: 'Password' }), password]),
    submit,
    el('a', { href: '/signin', text: 'Sign in instead', 'aria-label': 'Sign in instead' }),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.setAttribute('aria-busy', 'true');
    void (async () => {
      try {
        await write('POST', '/api/signup', { username: username.value, password: password.value });
        await enterApp();
      } catch (cause) {
        if (cause instanceof ApiFailure) showFormError(form, cause, form);
      } finally {
        submit.removeAttribute('aria-busy');
      }
    })();
  });
  main.append(authShell(form));
}
