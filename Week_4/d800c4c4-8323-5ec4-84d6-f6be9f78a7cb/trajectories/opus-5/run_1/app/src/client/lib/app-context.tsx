import { createContext, useContext } from 'react';
import type { BoardRead, CalendarRead, Membership, StatusRead, User } from '../../shared/types';
import type { ScreenDraft } from './draft';

export interface Viewer {
  readonly user: User;
  readonly membership: Membership | null;
}

export interface NavigateOptions {
  readonly replace?: boolean;
  /** Carried into the screen being opened, for the join's two messages. */
  readonly announce?: string;
  readonly joinLanding?: boolean;
}

export interface AppState {
  readonly path: string;
  readonly search: string;
  readonly viewer: Viewer | null;
  readonly status: StatusRead;
  readonly board: BoardRead | null;
  readonly calendar: CalendarRead | null;
  readonly announcement: string;
  readonly sessionEnded: boolean;
  readonly reducedMotion: boolean;
  readonly joinLanding: boolean;
  readonly restoredDraft: ScreenDraft | null;
  readonly announce: (text: string) => void;
  readonly noteSessionEnded: (text: string, draft: Omit<ScreenDraft, 'path' | 'email'>) => void;
  readonly navigate: (path: string, options?: NavigateOptions) => void;
  readonly offerDraft: (draft: ScreenDraft | null) => void;
  readonly consumeDraft: () => void;
  readonly reloadViewer: () => Promise<void>;
  readonly reloadBoard: () => Promise<void>;
  /** A Desk with a pending-photo loan selected reads the service status every second. */
  readonly setStatusPollFast: (fast: boolean) => void;
}

const AppContext = createContext<AppState | null>(null);

export const AppProvider = AppContext.Provider;

export function useApp(): AppState {
  const state = useContext(AppContext);
  if (!state) throw new Error('The app state is only available inside the app');
  return state;
}
