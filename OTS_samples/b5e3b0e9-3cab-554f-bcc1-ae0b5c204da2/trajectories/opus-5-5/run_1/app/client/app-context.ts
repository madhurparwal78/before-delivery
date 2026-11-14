import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Me } from './api.js';

export interface AppContextValue {
  me: Me | null;
  setMe(me: Me | null): void;
  reloadMe(): Promise<Me | null>;
  navigate(to: string, replace?: boolean): void;
  reducedMotion: boolean;
}

export const AppContext = createContext<AppContextValue>(null as unknown as AppContextValue);

export const useApp = () => useContext(AppContext);
