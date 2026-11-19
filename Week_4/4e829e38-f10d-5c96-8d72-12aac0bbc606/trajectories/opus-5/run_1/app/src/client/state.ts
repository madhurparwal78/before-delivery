import { api, type Me } from './api.js';

export interface Settings {
  moveMs: number;
  progressMs: number;
  toastMs: number;
  holdTimeoutMs: number;
  uploadLabel: string;
}

export const settings: Settings = {
  moveMs: 320,
  progressMs: 400,
  toastMs: 4000,
  holdTimeoutMs: 30000,
  uploadLabel: '1 MB',
};

export const state: { me: Me; unread: number } = {
  me: { id: null, name: null, email: null, verified: false, teams: [] },
  unread: 0,
};

export async function loadSession(): Promise<void> {
  const [config, me] = await Promise.all([
    api.get<Omit<Settings, 'uploadLabel'>>('/api/config'),
    api.get<Me>('/api/me'),
  ]);
  Object.assign(settings, config, {
    uploadLabel: document.body.dataset.uploadCap ?? settings.uploadLabel,
  });
  state.me = me;
}

export function signedIn(): boolean {
  return state.me.id !== null;
}

export function currentTeam(): { id: string; name: string; role: string } | null {
  return state.me.teams.length > 0 ? state.me.teams[0] : null;
}

export function isCoordinator(): boolean {
  const team = currentTeam();
  return team !== null && team.role === 'coordinator';
}

export function viewport(): 375 | 768 | 1280 {
  const width = window.innerWidth;
  if (width < 768) return 375;
  if (width < 1280) return 768;
  return 1280;
}
