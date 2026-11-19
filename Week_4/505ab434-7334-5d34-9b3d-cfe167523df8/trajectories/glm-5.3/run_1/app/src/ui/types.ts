export interface Principal {
  id: string;
  displayName: string;
  role: string;
  organisationId: string | null;
}

export interface Me {
  principal: Principal;
  today: string;
  now: string;
  timeZone: string;
  weightAnnounceDelayMs: number;
  organisation: {
    id: string;
    name: string;
    territory: string;
    engagement: { startsOn: string | null; endsOn: string | null; territories: string[] };
  } | null;
}

export interface Card {
  assetId: string;
  variantId: string | null;
  cardName: string;
  classLabel: string;
  licenceName: string;
  badge: string;
  reason: string | null;
  successorName: string | null;
  canRequest: boolean;
  requestReason: string | null;
  openRequestId: string | null;
  derivatives: { id: string; fileName: string; format: string; width: number; height: number }[];
  grant: { id: string; status: string; statusLabel: string; notBefore: string | null; notAfter: string; conditions: { kind: string; text: string }[] } | null;
}

export interface ProofRecord {
  id: string;
  fileName: string;
  status: string;
  statusLabel: string;
  reason: string | null;
  uploadedAt: string;
}

export interface RequestDetail {
  id: string;
  state: string;
  stateLabel: string;
  holder: { id: string; displayName: string };
  requester: { id: string; displayName: string; organisationName: string };
  cardName: string;
  assetId: string;
  variantId: string | null;
  applicationClass: string;
  applicationLabel: string;
  territories: string[];
  campaignStartsOn: string;
  campaignEndsOn: string;
  citedRules: { identifier: string; status: string }[];
  note: string;
  submittedAt: string | null;
  deadline: string | null;
  escalation: string | null;
  stages: { n: number; kind: string; label: string; assigneeName: string | null; decision: string | null; decisionLabel: string | null; decidedByName: string | null; decidedAt: string | null; comment: string | null }[];
  conditions: { id: string; kind: string; text: string }[];
  grant: { id: string; status: string; statusLabel: string; notBefore: string | null; notAfter: string; cap: string | null; conditions: { kind: string; text: string }[]; revokedReason: string | null } | null;
  proofs: { id: string; fileName: string; status: string; statusLabel: string; reason: string | null; uploadedAt: string }[];
  stageReason?: string;
  grantPreview?: { notBefore: string | null; notAfter: string; cap: string; zeroLength: boolean };
}

export interface QueueRow {
  requestId: string;
  stage: number;
  stageLabel: string;
  cardName: string;
  applicationLabel: string;
  requesterName: string;
  organisationName: string;
  deadline: string;
  escalation: string | null;
}

export interface GrantDetail {
  id: string;
  status: string;
  statusLabel: string;
  holder: { type: string; id: string; displayName: string };
  cardName: string;
  requestId: string | null;
  notBefore: string | null;
  notAfter: string;
  cap: string | null;
  conditions: { kind: string; text: string }[];
  revokedReason: string | null;
}

export interface AssetAdmin {
  id: string;
  name: string;
  class: string;
  classLabel?: string;
  state: string;
  successorId: string | null;
  derivatives: { id: string; variant: string | null; fileName: string; format: string; width: number; height: number; byteSize: number }[];
}

export interface VersionSummary {
  id: string;
  number: number;
  state: string;
  stateWord: string;
  revision: number;
  publishedAt: string | null;
}

export interface VersionDetail {
  id: string;
  chapterSlug: string;
  number: number;
  state: string;
  stateWord: string;
  revision: number;
  intro: string;
  statements: { identifier: string; text: string }[];
  assetIds: string[];
  assets: { id: string; name: string; state: string }[];
  withdrawn: { identifier: string; replacedBy: string }[];
  publishedAt: string | null;
}

export interface AuditRecord {
  sequence: number;
  time: string;
  occurredAt: string;
  actor: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  outcome: string;
}

export const CLASS_LABELS: Record<string, string> = {
  mark: 'Mark',
  spot_icon: 'Spot icon',
  pictogram: 'Pictogram',
  ui_icon: 'UI icon',
  illustration: 'Illustration',
  photograph: 'Photograph',
};

export const APPLICATION_LABELS: Record<string, string> = {
  internal_comms: 'Internal comms',
  social: 'Social',
  press_article: 'Press article',
  event: 'Event',
  film: 'Film',
  packaging: 'Packaging',
  co_brand: 'Co-brand',
  merchandise: 'Merchandise',
  partnership: 'Partnership',
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? undefined : { 'content-type': 'application/json' },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.message ?? 'Something went wrong.') as Error & { code?: string; status?: number };
    err.code = data?.error;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | number | null | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (value === true) node.setAttribute(name, '');
    else if (value !== false) node.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function setStatus(message: string): void {
  const slot = document.getElementById('page-status');
  if (slot) slot.textContent = message;
}

export function setAlert(message: string, slot: HTMLElement | null): void {
  if (!slot) return;
  slot.replaceChildren();
  const alert = el('div', { class: 'alert', role: 'alert' }, message);
  slot.append(alert);
}

export function clearAlert(slot: HTMLElement | null): void {
  if (slot) slot.replaceChildren();
}

export function busyButton(button: HTMLButtonElement, label: string): () => void {
  const original = button.textContent ?? '';
  const disabled = button.disabled;
  button.textContent = label;
  button.disabled = true;
  return () => {
    button.textContent = original;
    button.disabled = disabled;
  };
}

export async function loadMe(): Promise<Me | null> {
  try {
    return await api<Me>('/api/me');
  } catch {
    return null;
  }
}

export function formatDay(date: string | null | undefined, today: string): string {
  if (!date) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return `${get('day')} ${months[Number(get('month')) - 1]} ${get('year')} ${get('hour')}:${get('minute')}`;
}
