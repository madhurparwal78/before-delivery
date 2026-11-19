import { announce, setAlert, withPending } from '../announce.js';
import { api } from '../api.js';
import { copy } from '../copy.js';
import { clear, h } from '../dom.js';
import { navigate, type RouteContext } from '../router.js';
import { mainRegion, renderBanner } from '../shell.js';
import { setMember, type Member } from '../state.js';

export function renderSignIn(ctx: RouteContext): void {
  const main = mainRegion();
  clear(main);
  const next = ctx.query.get('next') ?? '/';

  const email = h('input', { type: 'email', 'aria-label': 'Email', class: 'field' });
  const code = h('input', { type: 'text', 'aria-label': 'Code', class: 'field' });
  const displayName = h('input', {
    type: 'text',
    'aria-label': 'Display name',
    class: 'field',
  });
  const codeSlot = h('div', { class: 'alert-slot' });
  const signInSlot = h('div', { class: 'alert-slot' });

  const sendCode = h('button', { type: 'button', class: 'secondary', text: 'Send code' });
  sendCode.addEventListener('click', () => {
    void (async () => {
      const result = await withPending(sendCode, () =>
        api<{ sent: boolean }>('POST', '/api/auth/code', { body: { email: email.value } }),
      );
      if (!result) return;
      if (!result.ok) {
        setAlert(codeSlot, result.failure.message);
        return;
      }
      setAlert(codeSlot, null);
      announce(copy.codeSent(email.value));
    })();
  });

  const signIn = h('button', { type: 'button', class: 'secondary', text: 'Sign in' });
  signIn.addEventListener('click', () => {
    void (async () => {
      const result = await withPending(signIn, () =>
        api<Member>('POST', '/api/auth/verify', {
          body: {
            email: email.value,
            code: code.value,
            display_name: displayName.value || undefined,
          },
        }),
      );
      if (!result) return;
      if (!result.ok) {
        setAlert(signInSlot, result.failure.message);
        return;
      }
      setAlert(signInSlot, null);
      setMember(result.data);
      renderBanner();
      navigate(next);
    })();
  });

  main.append(
    h('h1', { text: 'Sign in' }),
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Email' }), email, sendCode, codeSlot),
    h('div', { class: 'field-box' }, h('span', { class: 'label', text: 'Code' }), code),
    h(
      'div',
      { class: 'field-box' },
      h('span', { class: 'label', text: 'Display name' }),
      displayName,
      h('p', { class: 'muted', text: 'Only needed the first time you sign in.' }),
    ),
    h('div', { class: 'field-box' }, signIn, signInSlot),
  );
}
