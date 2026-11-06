import type { HourBank, SessionInfo } from './shell.js';

export type Screen = {
  element: HTMLElement;
  destroy?: () => void;
  onResize?: () => void;
};

export type ScreenContext = {
  session: SessionInfo | null;
  path: string;
  query: URLSearchParams;
  navigate: (href: string, options?: { replace?: boolean }) => void;
  /** Fills a missing parameter in, replacing the history entry without reloading. */
  fillAddress: (href: string) => void;
  announce: (message: string) => void;
  showAlert: (message: string) => void;
  clearAlert: () => void;
  setHourBank: (bank: HourBank | null) => void;
  refreshBanner: () => Promise<void>;
  onSignedIn: (session: SessionInfo) => void;
};

export const roleRefusalCopy = 'That screen is not available for your role.';
