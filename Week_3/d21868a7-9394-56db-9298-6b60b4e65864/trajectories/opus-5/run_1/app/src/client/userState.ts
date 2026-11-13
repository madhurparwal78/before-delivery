import type { User } from './types.ts';

/** The signed-in person, held apart so any module can read or clear it. */

let currentUser: User | null = null;

export function setUser(user: User | null): void {
  currentUser = user;
}

export function getUser(): User | null {
  return currentUser;
}

export function requireUser(): User {
  return currentUser as User;
}
