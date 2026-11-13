import type { Role } from "../../shared/reference";

export function isUnlocked(user: { role: Role; unlocked: boolean } | null): boolean {
  return user !== null && (user.role !== "member" || user.unlocked);
}
