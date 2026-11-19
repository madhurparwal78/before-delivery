export type ProjectRole = 'owner' | 'editor' | 'reviewer' | 'viewer';
export type InviteRole = 'editor' | 'reviewer' | 'viewer';

export const projectRoles: ProjectRole[] = ['owner', 'editor', 'reviewer', 'viewer'];
export const inviteRoles: InviteRole[] = ['editor', 'reviewer', 'viewer'];

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && (projectRoles as string[]).includes(value);
}

export function isInviteRole(value: unknown): value is InviteRole {
  return typeof value === 'string' && (inviteRoles as string[]).includes(value);
}

/** Every capability in the brief's role table. */
export type Capability =
  | 'read'
  | 'write_files'
  | 'review'
  | 'resolve'
  | 'export'
  | 'administer';

const capabilities: Record<Capability, ProjectRole[]> = {
  read: ['owner', 'editor', 'reviewer', 'viewer'],
  write_files: ['owner', 'editor'],
  review: ['owner', 'editor', 'reviewer'],
  resolve: ['owner', 'editor'],
  export: ['owner', 'editor'],
  administer: ['owner'],
};

export function roleAllows(role: ProjectRole, capability: Capability): boolean {
  return capabilities[capability].includes(role);
}
