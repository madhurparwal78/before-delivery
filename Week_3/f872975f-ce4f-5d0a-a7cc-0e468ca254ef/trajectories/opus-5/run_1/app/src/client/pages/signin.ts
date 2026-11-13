import { postJson } from '../api';
import { el, labelled } from '../dom';
import { navigate } from '../router';
import { Page, renderTopBar } from '../shell';
import { store } from '../store';
import { SessionUser } from '../types';

/** A return path is honoured only when it is a path on this origin with exactly one leading slash. */
export function safeNextPath(next: string | null): string {
  if (next === null || next === '') return '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

export function signInPage(search: URLSearchParams): Page {
  const email = el('input', { attrs: { type: 'email', name: 'email', autocomplete: 'username' } });
  const password = el('input', { attrs: { type: 'password', name: 'password', autocomplete: 'current-password' } });
  const alert = el('p', { class: 'alert', attrs: { role: 'alert' } });
  const submit = el('button', { class: 'primary', text: 'Sign in', attrs: { type: 'submit' } });
  const next = safeNextPath(search.get('next'));

  const form = el(
    'form',
    {
      class: 'sign-in-form',
      on: {
        submit: (event) => {
          event.preventDefault();
          void attempt();
        }
      }
    },
    [labelled('Email', email), labelled('Password', password), submit, alert]
  );

  async function attempt(): Promise<void> {
    submit.disabled = true;
    submit.textContent = 'Signing in';
    alert.textContent = '';
    const result = await postJson<{ user: SessionUser }>('/api/session', {
      email: email.value,
      password: password.value
    });
    submit.disabled = false;
    submit.textContent = 'Sign in';
    if (!result.ok || result.data === null) {
      alert.textContent = "That email and password don't match.";
      return;
    }
    store.user = result.data.user;
    renderTopBar();
    navigate(next);
  }

  const element = el('section', { class: 'page sign-in' }, [el('h1', { class: 'page-title', text: 'Sign in' }), form]);
  return { element, banners: [] };
}
