import type { Account, ClientConfig } from '../shared/types.js';

interface Runtime {
  account: Account | null;
  pendingJoin: { classroomName: string } | null;
  config: ClientConfig;
}

const state: Runtime = {
  account: null,
  pendingJoin: null,
  config: { autosaveMs: 1500, blocksStepMs: 400, simTickMs: 100, toastMs: 4000, glancetFadeMs: 150 },
};

export const timers = (): ClientConfig => state.config;

export const setTimers = (config: ClientConfig): void => {
  state.config = config;
};

export const account = (): Account | null => state.account;

export const setAccount = (next: Account | null): void => {
  state.account = next;
};

export const pendingJoin = (): { classroomName: string } | null => state.pendingJoin;

export const setPendingJoin = (next: { classroomName: string } | null): void => {
  state.pendingJoin = next;
};

export const homeRoute = (): string => {
  const current = state.account;
  if (!current) return '/signin';
  if (current.kind === 'educator') return '/dashboard';
  if (current.kind === 'personal') return '/projects';
  return '/class';
};
