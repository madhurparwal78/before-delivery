import type { ChangeKind, Me } from '../domain/types.js';

export interface ChangeEvent {
  athlete_id: string;
  what: ChangeKind;
  workout_id?: string;
}

export interface Screen {
  element: HTMLElement;
  onChange?(event: ChangeEvent): void;
  stop?(): void;
}

export interface AppState {
  me: Me | null;
  chartAnimationMs: number;
  notices: HTMLElement | null;
  screen: Screen | null;
}

export const app: AppState = {
  me: null,
  chartAnimationMs: 450,
  notices: null,
  screen: null,
};

export type Navigate = (path: string, options?: { replace?: boolean }) => void;

let navigator: Navigate = () => undefined;

export function setNavigator(next: Navigate): void {
  navigator = next;
}

export function navigate(path: string, options?: { replace?: boolean }): void {
  navigator(path, options);
}

export function notice(text: string): void {
  const region = app.notices;
  if (!region) return;
  region.textContent = text;
}
