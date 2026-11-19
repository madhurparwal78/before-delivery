import type { PersonDto } from '../shared/types.js';
import { get } from './api.js';
import { heldKey } from './session.js';

let cached: PersonDto | null = null;
let pending: Promise<PersonDto | null> | null = null;

/** The person the held key belongs to, or null when the browser holds no key. */
export function viewer(): Promise<PersonDto | null> {
  if (heldKey() === null) return Promise.resolve(null);
  if (cached !== null) return Promise.resolve(cached);
  pending ??= get<PersonDto>('/api/me')
    .then((person) => {
      cached = person;
      return person;
    })
    .catch(() => null);
  return pending;
}

export function forgetViewer(): void {
  cached = null;
  pending = null;
}
