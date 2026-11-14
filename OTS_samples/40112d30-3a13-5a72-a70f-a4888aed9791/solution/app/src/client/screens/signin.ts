import { showCredentials } from '../owner/credentials.ts';

export async function render(): Promise<void> {
  showCredentials({
    heading: 'Sign in',
    endpoint: '/api/session',
    fields: [
      { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
      { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' },
    ],
    other: { text: 'Create account', path: '/signup' },
  });
}
