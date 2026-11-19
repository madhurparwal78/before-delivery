import { useCallback, useState } from 'react';
import { ApiError } from '../api';

/** One pending request at a time with its refusal text; `run` answers `{ value }` on success and `null` on refusal. */
export function useAction(): {
  pending: boolean;
  error: string | null;
  clearError: () => void;
  run: <T>(task: () => Promise<T>) => Promise<{ value: T } | null>;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<{ value: T } | null> => {
    setPending(true);
    setError(null);
    try {
      return { value: await task() };
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
      return null;
    } finally {
      setPending(false);
    }
  }, []);
  const clearError = useCallback(() => setError(null), []);
  return { pending, error, clearError, run };
}
