import { AgentScope, Role } from '../../shared/api';

export type Permission =
  | 'scene.read'
  | 'workspace.read'
  | 'scene.create'
  | 'scene.edit'
  | 'presence.write'
  | 'comment.write'
  | 'version.manage'
  | 'version.approve'
  | 'member.invite'
  | 'member.manage'
  | 'workspace.admin'
  | 'billing.manage';

export interface MemberCaller {
  kind: 'member';
  workspaceId: string;
  memberId: string;
  name: string;
  role: Role;
}

export interface AgentCaller {
  kind: 'agent';
  workspaceId: string;
  tokenId: string;
  name: string;
  scope: AgentScope;
}

export type Caller = MemberCaller | AgentCaller;

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [
    'scene.read',
    'workspace.read',
    'scene.create',
    'scene.edit',
    'presence.write',
    'comment.write',
    'version.manage',
    'version.approve',
    'member.invite',
    'member.manage',
    'workspace.admin',
    'billing.manage',
  ],
  admin: [
    'scene.read',
    'workspace.read',
    'presence.write',
    'comment.write',
    'version.approve',
    'member.invite',
    'member.manage',
  ],
  billing_manager: [
    'scene.read',
    'workspace.read',
    'presence.write',
    'comment.write',
    'version.approve',
    'member.invite',
    'billing.manage',
  ],
  editor: [
    'scene.read',
    'workspace.read',
    'scene.create',
    'scene.edit',
    'presence.write',
    'comment.write',
    'version.manage',
    'version.approve',
  ],
  viewer: ['scene.read', 'workspace.read', 'presence.write', 'comment.write', 'version.approve'],
};

const SCOPE_PERMISSIONS: Record<AgentScope, readonly Permission[]> = {
  read: ['scene.read'],
  edit: ['scene.read', 'scene.edit', 'presence.write'],
};

export function can(caller: Caller, permission: Permission): boolean {
  if (caller.kind === 'member') return ROLE_PERMISSIONS[caller.role].includes(permission);
  return SCOPE_PERMISSIONS[caller.scope].includes(permission);
}

export function authorOf(caller: Caller): { kind: 'member' | 'agent'; id: string; name: string } {
  return caller.kind === 'member'
    ? { kind: 'member', id: caller.memberId, name: caller.name }
    : { kind: 'agent', id: caller.tokenId, name: caller.name };
}
