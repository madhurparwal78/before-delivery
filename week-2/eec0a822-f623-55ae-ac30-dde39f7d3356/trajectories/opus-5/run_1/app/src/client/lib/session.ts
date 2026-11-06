import { api } from './api.js';
import type { Role } from '../../shared/roles.js';

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly workspaceSlug: string;
  readonly workspaceName: string;
}

interface SessionBody {
  readonly member: Member;
  readonly homePath: string;
}

let cached: Member | null = null;

export async function currentMember(): Promise<Member | null> {
  if (cached !== null) return cached;
  const result = await api.get<SessionBody>('/api/session');
  if (!result.ok) return null;
  cached = result.data.member;
  return cached;
}

export function forgetMember(): void {
  cached = null;
}

const RESTORE_KEY = 'tidewright:restore';

type Snapshot = { readonly path: string; readonly values: string[] };

export function snapshotForm(): void {
  const host = document.getElementById('app');
  if (host === null) return;
  const values = [...host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input, select, textarea',
  )].map((control) => (control.type === 'file' ? '' : control.value));
  const snapshot: Snapshot = {
    path: `${window.location.pathname}${window.location.search}`,
    values,
  };
  window.sessionStorage.setItem(RESTORE_KEY, JSON.stringify(snapshot));
}

export function restoreForm(): void {
  const raw = window.sessionStorage.getItem(RESTORE_KEY);
  if (raw === null) return;
  const snapshot = JSON.parse(raw) as Snapshot;
  if (snapshot.path !== `${window.location.pathname}${window.location.search}`) return;
  window.sessionStorage.removeItem(RESTORE_KEY);
  const host = document.getElementById('app');
  if (host === null) return;
  const controls = [...host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input, select, textarea',
  )];
  for (const [index, control] of controls.entries()) {
    const value = snapshot.values[index];
    if (value !== undefined && control.type !== 'file') control.value = value;
  }
}
