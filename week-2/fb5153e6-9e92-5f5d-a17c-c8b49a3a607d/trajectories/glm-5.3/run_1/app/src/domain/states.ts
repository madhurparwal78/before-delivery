import type { Locale } from '../locales.js';
import { t } from '../locales.js';

export type ModelState = 'draft' | 'in_review' | 'published' | 'withdrawn';
export type Role = 'author' | 'editor' | 'contributor' | 'staff';

export const STATES: ModelState[] = ['draft', 'in_review', 'published', 'withdrawn'];

export const stateLabel = (state: ModelState, locale: Locale): string => {
  const key = state === 'in_review' ? 'state.in_review' : `state.${state}`;
  return t(locale, key);
};

/** The single source of legal state moves, with the roles allowed to make each. */
const LEGAL_MOVES: { from: ModelState; to: ModelState; roles: Role[] }[] = [
  { from: 'draft', to: 'in_review', roles: ['author', 'editor', 'contributor'] },
  { from: 'in_review', to: 'draft', roles: ['author', 'editor'] },
  { from: 'in_review', to: 'published', roles: ['author', 'editor'] },
  { from: 'published', to: 'withdrawn', roles: ['author', 'editor'] },
  { from: 'withdrawn', to: 'in_review', roles: ['author', 'editor'] },
];

export function canMove(from: ModelState, to: ModelState, role: Role, ownsModel: boolean): boolean {
  const move = LEGAL_MOVES.find(m => m.from === from && m.to === to);
  if (move === undefined) return false;
  if (role === 'contributor') return ownsModel;
  return move.roles.includes(role);
}

export const legalTargets = (from: ModelState, role: Role, ownsModel: boolean): ModelState[] =>
  STATES.filter(to => canMove(from, to, role, ownsModel));
