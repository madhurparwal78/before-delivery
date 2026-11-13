// Role vocabulary used by the ladder.

export type Auth = 'public' | 'staff' | 'desk' | 'owner' | 'books';

export function roleAllows(auth: Auth, role: string | undefined): boolean {
  switch (auth) {
    case 'public': return true;
    case 'staff': return role === 'owner' || role === 'assistant' || role === 'bookkeeper';
    case 'desk': return role === 'owner' || role === 'assistant';
    case 'owner': return role === 'owner';
    case 'books': return role === 'owner' || role === 'bookkeeper';
  }
}
