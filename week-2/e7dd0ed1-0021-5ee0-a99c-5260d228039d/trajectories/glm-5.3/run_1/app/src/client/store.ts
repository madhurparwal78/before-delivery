// The single client store. Views render from it; actions mutate it and re-render.
import type { Me, Region, PlanRow, Bucket, ListItem, ReplicaState, VersionInfo, AccessKey, WebhookEndpoint, Delivery, ShareLink, Member, Invite, UsageView, UsageRow, AuditEntry, EncryptionView, SessionRow, OpsRegion, OpsWorkspace } from '../shared/types.js';

export interface Store {
  me: Me | null;
  regions: Region[];
  plans: PlanRow[];
  // console object view
  buckets: Bucket[];
  items: ListItem[];
  commonPrefixes: string[];
  nextCursor: string | null;
  truncated: boolean;
  resultsStatus: string;
  inspectorKey: string | null;
  inspector: { object: Record<string, unknown> | null; replicas: ReplicaState | null; versions: VersionInfo[] };
  replicaAnnouncements: string;
  versionsStatus: string;
  bucketStatus: string;
  uploadStatus: string;
  uploadProgress: number;
  deleteStatus: string;
  deleteResults: Array<{ key: string; outcome: string }>;
  undoAvailable: boolean;
  lifecycleStatus: string;
  shareStatus: string;
  // dialogs
  dialog: string | null;
  dialogData: Record<string, unknown>;
  // statuses for other pages
  inviteStatus: string;
  teamStatus: string;
  keyStatus: string;
  webhookStatus: string;
  encryptionStatus: string;
  auditStatus: string;
  twoStepStatus: string;
  sessionsStatus: string;
  passwordStatus: string;
  operatorStatus: string;
  alertMessage: string;
  // page data
  keys: AccessKey[];
  endpoints: WebhookEndpoint[];
  deliveries: Delivery[];
  links: ShareLink[];
  members: Member[];
  invites: Invite[];
  usage: UsageView | null;
  usageRows: UsageRow[];
  auditEntries: AuditEntry[];
  auditNextCursor: string | null;
  encryption: EncryptionView | null;
  sessions: SessionRow[];
  opsRegions: OpsRegion[];
  opsWorkspaces: OpsWorkspace[];
  opsBilling: { state: string; queued_rows: number; posted_rows: number; last_attempt_at: string | null; last_error: string | null } | null;
  // sign-in
  signInStep: 'password' | 'code' | 'recovery';
  signInPending: boolean;
  twoStepSetup: { secret: string; otpauth_uri: string } | null;
  recoveryCodes: string[];
  inviteData: Record<string, unknown> | null;
  // pending sensitive action awaiting step-up
  pendingAction: null | { kind: string; run: () => Promise<void> };
  stepUpAlert: string;
  navOpen: boolean;
}

export const store: Store = {
  me: null, regions: [], plans: [],
  buckets: [], items: [], commonPrefixes: [], nextCursor: null, truncated: false,
  resultsStatus: '', inspectorKey: null,
  inspector: { object: null, replicas: null, versions: [] },
  replicaAnnouncements: '', versionsStatus: '', bucketStatus: '', uploadStatus: '', uploadProgress: 0,
  deleteStatus: '', deleteResults: [], undoAvailable: false, lifecycleStatus: '', shareStatus: '',
  dialog: null, dialogData: {},
  inviteStatus: '', teamStatus: '', keyStatus: '', webhookStatus: '', encryptionStatus: '', auditStatus: '',
  twoStepStatus: '', sessionsStatus: '', passwordStatus: '', operatorStatus: '', alertMessage: '',
  keys: [], endpoints: [], deliveries: [], links: [], members: [], invites: [], usage: null, usageRows: [],
  auditEntries: [], auditNextCursor: null, encryption: null, sessions: [],
  opsRegions: [], opsWorkspaces: [], opsBilling: null,
  signInStep: 'password', signInPending: false, twoStepSetup: null, recoveryCodes: [], inviteData: null,
  pendingAction: null, stepUpAlert: '', navOpen: false,
};

/** Focus and caret restoration across re-renders. */
export function captureFocus(): { id: string; selStart: number; selEnd: number } | null {
  const el = document.activeElement as HTMLInputElement | null;
  if (!el || !el.id) return null;
  return { id: el.id, selStart: el.selectionStart ?? 0, selEnd: el.selectionEnd ?? 0 };
}

export function restoreFocus(saved: { id: string; selStart: number; selEnd: number } | null): void {
  if (!saved) return;
  const el = document.getElementById(saved.id) as HTMLInputElement | null;
  if (!el) return;
  el.focus();
  try { el.setSelectionRange(saved.selStart, saved.selEnd); } catch { /* not a text input */ }
}
