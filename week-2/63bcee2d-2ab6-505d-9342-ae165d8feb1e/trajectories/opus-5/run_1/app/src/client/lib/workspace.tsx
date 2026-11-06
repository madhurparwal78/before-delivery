/** The signed-in member, the data refresh clock and the shared failure handling. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Currency, Role } from '../../shared/domain.js';
import { ApiError, request } from './api.js';
import { useAnnouncer } from './announce.jsx';
import {
  discardAllDrafts,
  markPendingRestore,
  saveDraft,
  takePendingRestore,
  type DraftValues,
  type PendingRestore,
} from './drafts.js';
import { refusal } from './copy.js';
import { useRouter } from './router.jsx';

export interface SignedInMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  organisation: string;
  approvalLimits: Record<Currency, number | null> | null;
}

interface WorkspaceValue {
  member: SignedInMember | null;
  loading: boolean;
  accessRemoved: boolean;
  refreshToken: number;
  refresh: () => void;
  setMember: (member: SignedInMember | null) => void;
  signOut: () => Promise<void>;
  pendingRestore: PendingRestore | null;
  clearPendingRestore: () => void;
  /** Reports a failure in the published copy, handling ended and removed access. */
  handleFailure: (error: unknown, options?: FailureOptions) => void;
}

export interface FailureOptions {
  /** The form whose typed input should survive an ended session. */
  draft?: { formKey: string; values: DraftValues };
  /** Copy for refusals this screen words itself. */
  describe?: (error: ApiError) => string | null;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }): JSX.Element {
  const [member, setMember] = useState<SignedInMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessRemoved, setAccessRemoved] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const { problem } = useAnnouncer();
  const { navigate, pathname, search } = useRouter();

  useEffect(() => {
    let cancelled = false;
    request<{ member: SignedInMember }>('/api/session')
      .then((result) => {
        if (cancelled) return;
        setMember(result.member);
        setPendingRestore(takePendingRestore(result.member.id));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  useEffect(() => {
    const onFocus = (): void => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const signOut = useCallback(async () => {
    await request('/api/session', { method: 'DELETE' }).catch(() => undefined);
    setMember(null);
    navigate('/sign-in');
  }, [navigate]);

  const handleFailure = useCallback(
    (error: unknown, options: FailureOptions = {}) => {
      if (!(error instanceof ApiError)) {
        problem(refusal.networkFailure);
        return;
      }
      if (error.failure.network) {
        problem(refusal.networkFailure);
        return;
      }
      if (error.code === 'session_ended') {
        const current = member;
        if (current && options.draft) {
          saveDraft(current.id, options.draft.formKey, options.draft.values);
          markPendingRestore(current.id, {
            formKey: options.draft.formKey,
            path: `${pathname}${search}`,
          });
        }
        setMember(null);
        problem(refusal.sessionEnded);
        navigate(`/sign-in?next=${encodeURIComponent(`${pathname}${search}`)}`);
        return;
      }
      if (error.code === 'access_removed') {
        if (member) discardAllDrafts(member.id);
        setAccessRemoved(true);
        problem(refusal.accessRemoved);
        return;
      }
      const described = options.describe?.(error);
      if (described) {
        problem(described);
        return;
      }
      problem(defaultFailureCopy(error));
    },
    [member, navigate, pathname, problem, search],
  );

  const value = useMemo<WorkspaceValue>(
    () => ({
      member,
      loading,
      accessRemoved,
      refreshToken,
      refresh,
      setMember,
      signOut,
      pendingRestore,
      clearPendingRestore: () => setPendingRestore(null),
      handleFailure,
    }),
    [
      member,
      loading,
      accessRemoved,
      refreshToken,
      refresh,
      signOut,
      pendingRestore,
      handleFailure,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function defaultFailureCopy(error: ApiError): string {
  switch (error.code) {
    case 'not_found':
      return refusal.notFound;
    case 'forbidden':
      return refusal.forbidden;
    case 'storage_unavailable':
      return refusal.storageOutageDownload;
    case 'validation':
      return Object.values(error.errors)[0] ?? refusal.forbidden;
    default:
      return refusal.forbidden;
  }
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('The workspace is only available inside WorkspaceProvider');
  return value;
}

/** Loads a resource on mount and whenever the refresh clock ticks. */
export function useResource<T>(
  path: string | null,
  deps: readonly unknown[] = [],
): { data: T | null; error: ApiError | null; reload: () => void } {
  const { refreshToken, handleFailure } = useWorkspace();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [localToken, setLocalToken] = useState(0);

  useEffect(() => {
    if (path === null) {
      setData(null);
      return;
    }
    let cancelled = false;
    request<T>(path)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (!(caught instanceof ApiError)) return;
        setError(caught);
        // An ended session or removed access has to reach the whole screen,
        // not just the panel that happened to be loading.
        if (caught.code === 'session_ended' || caught.code === 'access_removed') {
          handleFailure(caught);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, refreshToken, localToken, ...deps]);

  return { data, error, reload: () => setLocalToken((token) => token + 1) };
}
