import { api } from './api.js';

export interface PageConfig {
  toast_seconds: number;
  search_debounce_ms: number;
}

export interface Rating {
  average: number | null;
  count: number;
}

export interface Member {
  id: string;
  display_name: string;
  roles: string[];
  id_state: 'none' | 'pending' | 'verified' | 'rejected';
  photo_url: string | null;
  rating: Rating;
  email?: string;
  wallet_cents?: number;
}

let config: PageConfig = { toast_seconds: 5, search_debounce_ms: 300 };
let me: Member | null = null;

export function readPageConfig(): void {
  const node = document.getElementById('page-config');
  if (node?.textContent) config = JSON.parse(node.textContent) as PageConfig;
}

export function pageConfig(): PageConfig {
  return config;
}

export function currentMember(): Member | null {
  return me;
}

export function setMember(member: Member | null): void {
  me = member;
}

export async function loadMember(): Promise<Member | null> {
  const result = await api<Member>('GET', '/api/me');
  me = result.ok ? result.data : null;
  return me;
}

export function isFounder(member: Member | null): boolean {
  return member !== null && member.roles.includes('founder');
}

let serverNowIso = new Date().toISOString();

/** Deadlines and "today" always come from the server, never from the device clock. */
export function setServerNow(iso: string | null | undefined): void {
  if (iso) serverNowIso = iso;
}

export function serverNow(): string {
  return serverNowIso;
}

export function serverToday(): string {
  return serverNowIso.slice(0, 10);
}
