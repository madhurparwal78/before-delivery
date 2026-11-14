import { showCredentials } from '../owner/credentials.ts';

export async function render(): Promise<void> {
  showCredentials({
    heading: 'Create account',
    endpoint: '/api/account',
    fields: [
      { name: 'name', label: 'Name', autocomplete: 'name' },
      { name: 'email', label: 'Email', type: 'email', autocomplete: 'email' },
      { name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password' },
    ],
    other: { text: 'Sign in', path: '/signin' },
  });
}
