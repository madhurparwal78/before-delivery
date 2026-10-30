import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiCallError, type ApiFailure } from './api';

export interface PerformOptions<T> {
  pending: string;
  success?: (result: T) => string | null;
  errors?: (failure: ApiFailure) => string | null;
  run: () => Promise<T>;
}

export interface BackgroundOptions<T> {
  errors?: (failure: ApiFailure) => string | null;
  run: () => Promise<T>;
}

interface FeedbackValue {
  activity: string;
  problem: string;
  busy: boolean;
  fieldErrors: Record<string, string>;
  perform: <T>(options: PerformOptions<T>) => Promise<T | null>;
  background: <T>(options: BackgroundOptions<T>) => Promise<T | null>;
  reportProblem: (copy: string) => void;
}

const FeedbackContext = createContext<FeedbackValue | null>(null);

export function fallbackCopy(failure: ApiFailure): string {
  if (failure.status === 403) return "You can't do that with this account.";
  if (failure.status === 404) return "That record isn't available.";
  if (failure.code === 'idempotency_conflict') {
    return 'This request was already sent with different details. Reload and try again.';
  }
  if (failure.status === 409 || failure.status === 410 || failure.status === 412) {
    return "That can't be done in this record's current state. Reload to see the latest.";
  }
  if (failure.status === 413) return 'That request is too large.';
  if (failure.status === 415) return "That kind of content isn't accepted.";
  if (failure.code === 'validation_failed') return 'Check the highlighted fields.';
  if (failure.code === 'billing_unavailable') {
    return 'Billing is unreachable. Nothing was changed; try again in a moment.';
  }
  if (failure.code === 'storage_unavailable') {
    return 'Document storage is unreachable. Nothing was changed; try again in a moment.';
  }
  if (failure.code === 'mail_unavailable') {
    return 'Email is unreachable. Nothing was changed; try again in a moment.';
  }
  return 'Something went wrong. Try again in a moment.';
}

function detailFields(failure: ApiFailure): Record<string, string> {
  if (failure.code !== 'validation_failed') return {};
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(failure.details)) {
    if (typeof value === 'string') fields[key] = value;
  }
  return fields;
}

export function FeedbackProvider({
  children,
  onSessionEnded,
}: {
  children: ReactNode;
  onSessionEnded: () => void;
}): JSX.Element {
  const [activity, setActivity] = useState('');
  const [problem, setProblem] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const sessionEnded = useRef(onSessionEnded);
  sessionEnded.current = onSessionEnded;

  const handleFailure = useCallback(
    (failure: ApiFailure, specific: string | null): void => {
      if (failure.status === 401) {
        sessionEnded.current();
        setProblem('Your session ended. Sign in again.');
        return;
      }
      setFieldErrors(detailFields(failure));
      setProblem(specific ?? fallbackCopy(failure));
    },
    [],
  );

  const perform = useCallback(
    async <T,>(options: PerformOptions<T>): Promise<T | null> => {
      setFieldErrors({});
      setActivity(options.pending);
      setPendingCount((count) => count + 1);
      try {
        const result = await options.run();
        setProblem('');
        setActivity(options.success ? (options.success(result) ?? '') : '');
        return result;
      } catch (error) {
        setActivity('');
        const failure =
          error instanceof ApiCallError
            ? error.failure
            : { status: 0, code: 'network', message: 'No response.', details: {} };
        handleFailure(failure, options.errors ? options.errors(failure) : null);
        return null;
      } finally {
        setPendingCount((count) => count - 1);
      }
    },
    [handleFailure],
  );

  const background = useCallback(
    async <T,>(options: BackgroundOptions<T>): Promise<T | null> => {
      try {
        const result = await options.run();
        return result;
      } catch (error) {
        const failure =
          error instanceof ApiCallError
            ? error.failure
            : { status: 0, code: 'network', message: 'No response.', details: {} };
        handleFailure(failure, options.errors ? options.errors(failure) : null);
        return null;
      }
    },
    [handleFailure],
  );

  const value = useMemo<FeedbackValue>(
    () => ({
      activity,
      problem,
      busy: pendingCount > 0,
      fieldErrors,
      perform,
      background,
      reportProblem: setProblem,
    }),
    [activity, problem, pendingCount, fieldErrors, perform, background],
  );

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

export function useFeedback(): FeedbackValue {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error('Feedback used outside its provider');
  return value;
}

export function LiveRegions({ reducedMotion }: { reducedMotion: boolean }): JSX.Element {
  const { activity, problem, busy } = useFeedback();
  return (
    <div className="live-regions">
      {reducedMotion ? (
        <div className="working-text">{busy ? 'Working…' : ''}</div>
      ) : (
        <div className={`pending-sweep${busy ? ' on' : ''}`} />
      )}
      <div role="status" aria-label="Activity" aria-live="polite" className="activity">
        {activity}
      </div>
      <div role="alert" aria-label="Problem" className="problem">
        {problem ? <span className="conflict-marker" aria-hidden="true" /> : null}
        {problem}
      </div>
    </div>
  );
}
