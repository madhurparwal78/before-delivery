import { isWriter, type Colour, type Role } from '../shared/types.ts';
import type { Row } from './db.ts';

/** Uppercased first letters of the first and last words of a display name; one letter for a one-word name. */
export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) return '';
  const letter = (word: string): string => (Array.from(word)[0] ?? '').toUpperCase();
  return words.length === 1 ? letter(first) : letter(first) + letter(last);
}

const FOLLOWING: Record<Colour, Colour> = { sage: 'clay', clay: 'plum', plum: 'ochre', ochre: 'slate', slate: 'rose', rose: 'sage' };

/** The colour that follows the most recently added person's, wrapping round. */
export const nextColour = (last: Colour): Colour => FOLLOWING[last];

/** A person as the workspace and the boards describe them; every payload about a person is shaped from this. */
export interface PersonRecord {
  userId: string;
  displayName: string;
  initials: string;
  colour: Colour;
  role: Role;
  email: string;
  phone: string | null;
}

export function personFrom(row: Row): PersonRecord {
  return {
    userId: row['id'] as string,
    displayName: row['display_name'] as string,
    initials: row['initials'] as string,
    colour: row['colour'] as Colour,
    role: row['role'] as Role,
    email: row['email'] as string,
    phone: (row['phone'] as string | null) ?? null,
  };
}

/** What a reader may learn about a person: the name only, the name and contact role, or the whole record. */
export type Reveal = 'basic' | 'writer' | 'admin';

export const revealFor = (role: Role): Reveal => (role === 'admin' ? 'admin' : isWriter(role) ? 'writer' : 'basic');

export function shapePerson(person: PersonRecord, reveal: Reveal) {
  const base = { displayName: person.displayName, initials: person.initials, colour: person.colour };
  if (reveal === 'basic') return base;
  const writer = { ...base, userId: person.userId, role: person.role, phone: person.phone };
  return reveal === 'admin' ? { ...writer, email: person.email } : writer;
}
