import type { Role } from '../../shared/types.ts';

export type Capability =
  | 'upload'
  | 'editOwnDraft'
  | 'send'
  | 'void'
  | 'useTemplate'
  | 'changeRole'
  | 'saveTemplate'
  | 'shareTemplate'
  | 'remind';

export interface Actor {
  userId: string;
  role: Role;
}

/** The one place that decides whether an actor may do something. */
export const allows = (actor: Actor, capability: Capability, ownerId: string | null): boolean => {
  if (actor.role === 'viewer') return false;
  const owns = ownerId === null || ownerId === actor.userId;
  switch (capability) {
    case 'changeRole':
    case 'saveTemplate':
    case 'shareTemplate':
      return actor.role === 'owner';
    case 'void':
      return actor.role === 'owner' || owns;
    case 'upload':
    case 'useTemplate':
      return true;
    case 'editOwnDraft':
    case 'send':
    case 'remind':
      return actor.role === 'owner' || owns;
  }
};
