const DRAFT_KEY = "wayline.wizard-draft";

export interface WizardDraft {
  user_id: string;
  step: number;
  source_id: string;
  destination_id: string;
  streams: Record<string, { selected: boolean; sync_mode: string }>;
  schedule_type: string;
  interval_minutes: string;
  cron_expression: string;
  time_zone: string;
  name: string;
  namespace_prefix: string;
  schema_change_policy: string;
}

/** The wizard draft lives in this browser tab only, bound to the signed-in user's id. */
export function keepDraft(draft: WizardDraft): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export function takeDraft(userId: string): WizardDraft | null {
  if (typeof window === "undefined") return null;
  const stored = window.sessionStorage.getItem(DRAFT_KEY);
  if (!stored) return null;
  window.sessionStorage.removeItem(DRAFT_KEY);
  try {
    const draft = JSON.parse(stored) as WizardDraft;
    return draft.user_id === userId ? draft : null;
  } catch {
    return null;
  }
}

export function discardDraft(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(DRAFT_KEY);
}
