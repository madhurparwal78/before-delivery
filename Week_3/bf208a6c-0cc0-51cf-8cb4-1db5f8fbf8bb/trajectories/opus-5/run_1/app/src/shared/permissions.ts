import type { Role } from './types';

const RANK: Record<Role, number> = { viewer: 1, contributor: 2, moderator: 3, owner: 4 };

const atLeast = (role: Role | null, floor: Role): boolean => role !== null && RANK[role] >= RANK[floor];

export const permissions = {
  react: (role: Role | null): boolean => atLeast(role, 'viewer'),
  addPost: (role: Role | null): boolean => atLeast(role, 'contributor'),
  comment: (role: Role | null): boolean => atLeast(role, 'contributor'),
  editPost: (role: Role | null, isAuthor: boolean): boolean => (isAuthor && role !== null) || role === 'owner',
  movePost: (role: Role | null, isAuthor: boolean): boolean => (isAuthor && role !== null) || atLeast(role, 'moderator'),
  deletePost: (role: Role | null, isAuthor: boolean): boolean => (isAuthor && role !== null) || atLeast(role, 'moderator'),
  moderate: (role: Role | null): boolean => atLeast(role, 'moderator'),
  export: (role: Role | null): boolean => atLeast(role, 'moderator'),
  manageBoard: (role: Role | null): boolean => role === 'owner',
  holdsPosts: (role: Role | null): boolean => role === 'contributor',
};
