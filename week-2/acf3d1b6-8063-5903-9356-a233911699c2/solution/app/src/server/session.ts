import type { Request } from 'express';
import type { Role, WorkspacePlanId } from '../shared/catalog.js';

/** The signed-in person, loaded from the stored user behind the bearer token. Never from the request body. */
export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  workspace: { id: string; name: string; plan: WorkspacePlanId };
  tokenHash: string;
}

export type SignedInRequest = Request & { member: Member };

export const SESSION_COOKIE = 'kinora_session';
