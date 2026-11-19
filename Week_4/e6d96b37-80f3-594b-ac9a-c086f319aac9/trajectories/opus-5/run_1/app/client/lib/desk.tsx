import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiCallError, api, type ApiFailure } from './api.ts';
import { F } from '../../shared/feedback.ts';
import type { DeskState, SessionInfo } from '../../shared/types.ts';

/**
 * The live desk: the server's state, the announcements, and the single way a
 * confirmed action is sent. Every derived value comes from the server, never
 * from the browser's own clock.
 */

/** What an inline note offers alongside its copy. */
export type NoteAction = 'reload' | 'retry' | 'retry-sync' | 'sign-in' | 'retry-catalog' | null;

export interface DeskFeedback {
  /** Polite, atomic copy for G07. */
  status: string;
  /** Immediate copy for G08, held until the next action. */
  error: string;
  /** The inline note's action control, if any. */
  action: NoteAction;
  /** Field errors keyed by field or slot name. */
  fields: Record<string, string>;
  /** Seconds left of a register rate-limit countdown. */
  countdown: number | null;
}

const EMPTY_FEEDBACK: DeskFeedback = {
  status: '',
  error: '',
  action: null,
  fields: {},
  countdown: null,
};

/** A confirmed command the browser may have to resume after signing in. */
export interface PendingCommand {
  label: string;
  send: () => Promise<void>;
}

export interface DeskContextValue {
  ns: string;
  session: SessionInfo | null;
  state: DeskState | null;
  feedback: DeskFeedback;
  offline: boolean;
  /** Server time, refreshed from the server and never from the device clock. */
  serverNow: Date | null;
  announce: (status: string) => void;
  fail: (error: string, action?: NoteAction, fields?: Record<string, string>) => void;
  clearFeedback: () => void;
  /** Sends one confirmed command, announcing pending then its result. */
  run: (options: {
    label: string;
    pending?: string;
    success: string;
    send: () => Promise<void>;
  }) => Promise<boolean>;
  /** True while a confirmed command is in flight, so its control is disabled. */
  busy: boolean;
  pending: PendingCommand | null;
  resume: () => void;
  refresh: () => void;
}

const DeskContext = createContext<DeskContextValue | null>(null);

export function useDesk(): DeskContextValue {
  const found = useContext(DeskContext);
  if (!found) throw new Error('desk context is missing');
  return found;
}

/** Maps a failure onto the published copy and its inline action. */
function describe(failure: ApiFailure): { error: string; action: NoteAction; fields: Record<string, string> } {
  if (failure.offline) return { error: F.OFFLINE, action: null, fields: {} };
  const fields = failure.fields ?? {};
  switch (failure.status) {
    case 400:
    case 405:
    case 415:
      return { error: F.BAD_BODY, action: null, fields };
    case 401:
      return { error: F.SESSION, action: 'sign-in', fields };
    case 403:
      return {
        error: failure.code === 'step_up_required' ? F.MFA_REQUIRED : F.FORBIDDEN,
        action: null,
        fields,
      };
    case 404:
      return { error: F.HIDDEN, action: null, fields };
    case 409:
      return {
        error: failure.message,
        action: failure.message === F.CONFLICT ? 'reload' : null,
        fields,
      };
    case 413:
      return { error: F.TOO_LARGE, action: null, fields };
    case 422:
      return { error: F.INVALID, action: null, fields };
    case 429:
      return { error: F.CATALOG_RATE, action: null, fields };
    case 502:
      return {
        error: failure.code === 'catalog_missing' ? F.CATALOG_MISSING : F.CATALOG_BAD,
        action: 'retry-catalog',
        fields,
      };
    case 503:
      return failure.code === 'catalog_unavailable'
        ? { error: F.CATALOG_WAIT, action: 'retry-catalog', fields }
        : { error: F.SERVICE, action: 'retry', fields };
    default:
      return { error: F.SERVICE, action: 'retry', fields };
  }
}

export function DeskProvider({ ns, children }: { ns: string; children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [state, setState] = useState<DeskState | null>(null);
  const [feedback, setFeedback] = useState<DeskFeedback>(EMPTY_FEEDBACK);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [serverNow, setServerNow] = useState<Date | null>(null);
  const lastSequence = useRef(0);

  const refresh = useCallback(() => {
    void api
      .state(ns)
      .then((next) => {
        setState(next);
        lastSequence.current = next.version;
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError && error.failure.status === 401) {
          setFeedback((was) => ({ ...was, error: F.SESSION, action: 'sign-in' }));
        }
      });
  }, [ns]);

  useEffect(() => {
    void api.session().then(setSession).catch(() => undefined);
    refresh();
  }, [ns, refresh]);

  // N09 and the derived counts refresh from the server at least once a minute.
  useEffect(() => {
    const read = (): void => {
      void api
        .now(ns)
        .then((reply) => setServerNow(new Date(reply.now)))
        .catch(() => undefined);
    };
    read();
    const timer = window.setInterval(() => {
      read();
      refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [ns, refresh]);

  // Open screens redraw in place on every pushed desk event.
  useEffect(() => {
    let source: EventSource | null = null;
    let stopped = false;
    const connect = (): void => {
      if (stopped) return;
      source = new EventSource(`/api/desks/${ns}/stream?after=${lastSequence.current}`);
      source.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as { sequence: number; type: string };
          lastSequence.current = Math.max(lastSequence.current, event.sequence);
          if (event.type === 'access.ended') {
            setFeedback({ ...EMPTY_FEEDBACK, error: F.REVOKED });
            setState(null);
            return;
          }
          refresh();
        } catch {
          // A message that cannot be read is simply skipped.
        }
      };
      source.onerror = () => {
        source?.close();
        if (!stopped) window.setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      stopped = true;
      source?.close();
    };
  }, [ns, refresh]);

  useEffect(() => {
    const goOnline = (): void => setOffline(false);
    const goOffline = (): void => {
      setOffline(true);
      setFeedback((was) => ({ ...was, status: F.OFFLINE }));
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const announce = useCallback((status: string) => {
    setFeedback({ ...EMPTY_FEEDBACK, status });
  }, []);

  const fail = useCallback(
    (error: string, action: NoteAction = null, fields: Record<string, string> = {}) => {
      setFeedback({ ...EMPTY_FEEDBACK, error, action, fields });
    },
    [],
  );

  const clearFeedback = useCallback(() => setFeedback(EMPTY_FEEDBACK), []);

  const run = useCallback<DeskContextValue['run']>(
    async ({ label, pending: pendingCopy, success, send }) => {
      // Pending copy shows from the moment the request is sent until its reply.
      setBusy(true);
      setFeedback({ ...EMPTY_FEEDBACK, status: pendingCopy ?? F.PENDING });
      try {
        await send();
        // A result is announced only once the persisted state is known.
        setFeedback({ ...EMPTY_FEEDBACK, status: success });
        setPending(null);
        refresh();
        return true;
      } catch (error) {
        if (!(error instanceof ApiCallError)) throw error;
        const described = describe(error.failure);
        setFeedback({
          ...EMPTY_FEEDBACK,
          ...described,
          countdown: error.failure.retryAfterSeconds ?? null,
        });
        // A session that ended mid-action resumes exactly once after signing in.
        setPending(
          described.action === 'sign-in' || described.action === 'retry'
            ? { label, send: async () => void (await send()) }
            : null,
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const resume = useCallback(() => {
    const command = pending;
    if (!command) return;
    setPending(null);
    setFeedback({ ...EMPTY_FEEDBACK, status: F.RESUMED });
    void command
      .send()
      .then(() => {
        setFeedback({ ...EMPTY_FEEDBACK, status: F.RESUMED });
        refresh();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) {
          const described = describe(error.failure);
          setFeedback({ ...EMPTY_FEEDBACK, ...described });
        }
      });
  }, [pending, refresh]);

  const value = useMemo<DeskContextValue>(
    () => ({
      ns,
      session,
      state,
      feedback,
      offline,
      serverNow,
      announce,
      fail,
      clearFeedback,
      run,
      busy,
      pending,
      resume,
      refresh,
    }),
    [
      ns,
      session,
      state,
      feedback,
      offline,
      serverNow,
      announce,
      fail,
      clearFeedback,
      run,
      busy,
      pending,
      resume,
      refresh,
    ],
  );

  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

export { describe as describeFailure };
