import type { Profile } from '../shared/types.js';

export interface AppContext {
  profile: () => Profile;
  setProfile: (profile: Profile) => void;
  navigate: (path: string, options?: { replace?: boolean; openImport?: boolean }) => void;
  signedOut: () => void;
  offline: () => boolean;
  setOffline: (offline: boolean) => void;
  onReconnect: (listener: () => void) => void;
}

export const OFFLINE_COPY =
  "You're offline. Changes stay on this device and sync when you reconnect.";
