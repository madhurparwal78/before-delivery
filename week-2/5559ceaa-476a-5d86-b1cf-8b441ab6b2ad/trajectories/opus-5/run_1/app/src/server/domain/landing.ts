/**
 * The one place the sign-in landing path is decided, at the moment a token is
 * verified.
 */
export function landingPath(input: {
  invitedProjectId: string | null;
  memberProjectIds: readonly string[];
}): string {
  if (input.invitedProjectId !== null) {
    return input.memberProjectIds.includes(input.invitedProjectId)
      ? `/projects/${input.invitedProjectId}`
      : '/';
  }
  const only = input.memberProjectIds.length === 1 ? input.memberProjectIds[0] : undefined;
  return only === undefined ? '/' : `/projects/${only}`;
}
