import { render as showForms } from '../screens/forms.ts';
import { requestedPath } from './next-path.ts';

// The session now exists. A person who came for a page is sent there; everyone else lands on their forms,
// drawn in place of the account screen so no second page load can collide with the one that is under way.

export async function arrive(): Promise<void> {
  const requested = requestedPath();
  if (requested !== null) return location.assign(requested);
  history.replaceState(null, '', '/forms');
  await showForms();
  document.querySelector<HTMLElement>('h1')?.focus();
}
