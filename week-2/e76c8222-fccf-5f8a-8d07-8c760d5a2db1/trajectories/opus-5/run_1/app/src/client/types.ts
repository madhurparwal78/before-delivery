export * from '../shared/types';

import { GateResult, UserSummary } from '../shared/types';

export interface DryRun {
  seat_id: string;
  interpreter_id: string;
  gates: GateResult[];
  all_pass: boolean;
}

export interface PreferencesPayload {
  preferred: string[];
  blocked: string[];
  interpreters: UserSummary[];
}
