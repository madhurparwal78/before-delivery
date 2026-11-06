import type { Aspect, CreditKind, ModelId, Role, WorkspacePlanId } from '../shared/catalog.js';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Me {
  user: User;
  workspace: { id: string; name: string; plan: WorkspacePlanId };
  balance: number;
}

export interface Invitation {
  workspace_name: string;
  email: string;
}

/** Which part of the app an address belongs to; the server decides sessions and status by it. */
export type Area = 'public' | 'account' | 'invite' | 'studio' | 'missing';

/** What the server hands the page with its first HTML. */
export interface PageData {
  me?: Me;
  invitation?: Invitation | null;
}

export interface Project {
  id: string;
  name: string;
  generation_count: number;
  created_at: string;
  latest_generation_at: string | null;
}

export type GenerationStatus = 'queued' | 'rendering' | 'ready' | 'cancelled';

export interface Generation {
  id: string;
  project_id: string;
  model: ModelId;
  prompt: string;
  duration: number | null;
  image_count: number | null;
  aspect: Aspect;
  cost: number;
  status: GenerationStatus;
  started_by: string;
  created_at: string;
  finished_at: string | null;
}

export interface CreditEntry {
  id: number;
  kind: CreditKind;
  amount: number;
  balance_after: number;
  user_name: string;
  generation_id: string | null;
  created_at: string;
}

export interface Team {
  members: { id: string; name: string; email: string; role: Role; joined_at: string }[];
  invitations: { id: string; email: string; created_at: string }[];
  seats_used: number;
  seat_limit: number;
}
