import type { Role } from "../../shared/reference";

export type Viewer = {
  id: string;
  role: Role;
  displayName: string;
  email: string;
  companyId: string | null;
  companySlug: string | null;
  unlocked: boolean;
};

export const isTeam = (viewer: Viewer): boolean => viewer.role === "employer_admin" || viewer.role === "recruiter";
export const isModerator = (viewer: Viewer): boolean => viewer.role === "moderator" || viewer.role === "founder";
