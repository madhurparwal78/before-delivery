import { api, type ApiError } from './api';
import { h } from './ui';
import { navigate } from './router';

export type Me = {
  user: { id: string; email: string; displayName: string };
  workspaces: Array<{ id: string; name: string; role: 'owner' | 'editor' | 'viewer' }>;
  lastWorkspaceId: string | null;
};

export async function loadMe(): Promise<Me | null> {
  const result = await api('GET', '/api/me');
  if (!result.ok) return null;
  return result.body as Me;
}

export function errorSummary(errors: Array<{ key: string; message: string }>, onJump: (key: string) => void): HTMLElement | null {
  if (errors.length === 0) return null;
  const alert = h('div', { role: 'alert', class: 'form-alert' });
  alert.append(h('h2', {}, 'There is a problem'));
  const list = h('ul', {});
  for (const err of errors) {
    list.append(h('li', {}, h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); onJump(err.key); } }, err.message)));
  }
  alert.append(list);
  return alert;
}

export function fieldErrorsFromApi(err: ApiError): Array<{ key: string; message: string }> {
  const out: Array<{ key: string; message: string }> = [];
  for (const [key, message] of Object.entries(err.fields ?? {})) {
    out.push({ key, message });
  }
  if (out.length === 0 && err.code === 'bad_credentials') {
    out.push({ key: 'email', message: 'Email or password is incorrect.' });
  }
  return out;
}

export function signOut(): Promise<void> {
  return api('POST', '/api/auth/sign-out', {}).then(() => {
    navigate('/sign-in');
  });
}
