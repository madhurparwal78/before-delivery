import type { Role } from '../shared/terms';

export interface Viewer {
  id: string;
  workspaceId: string;
  role: Role;
}

export interface UserProjectionInput {
  id: string;
  name: string;
  handle: string;
  email: string;
  role: Role;
  status: string;
}

/**
 * The single email projection rule (DP-66): the `email` key is present only
 * when the viewer is an operations manager or the person themself.
 */
export function projectUser(user: UserProjectionInput, viewer: Viewer | null): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: user.id,
    name: user.name,
    handle: user.handle,
    role: user.role,
    status: user.status,
  };
  if (viewer && (viewer.id === user.id || viewer.role === 'ops_manager')) {
    out.email = user.email;
  }
  return out;
}
