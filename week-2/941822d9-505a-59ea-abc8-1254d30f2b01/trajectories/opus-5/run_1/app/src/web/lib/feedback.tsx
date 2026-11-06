import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ApiFailure, NetworkFailure, NETWORK_MESSAGE } from './api.js';

export interface Feedback {
  readonly status: string;
  readonly alert: string;
  announce: (message: string) => void;
  warn: (message: string) => void;
  clear: () => void;
  /** Turns a thrown failure into the alert copy, leaving field errors to the caller. */
  report: (error: unknown, copy: (code: string, payload: Record<string, unknown>) => string | null) => void;
}

const FeedbackContext = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const [status, setStatus] = useState('');
  const [alert, setAlert] = useState('');

  const announce = useCallback((message: string) => {
    setAlert('');
    setStatus(message);
  }, []);
  const warn = useCallback((message: string) => {
    setStatus('');
    setAlert(message);
  }, []);
  const clear = useCallback(() => {
    setStatus('');
    setAlert('');
  }, []);

  const report = useCallback(
    (error: unknown, copy: (code: string, payload: Record<string, unknown>) => string | null) => {
      if (error instanceof NetworkFailure) {
        setStatus('');
        setAlert(NETWORK_MESSAGE);
        return;
      }
      if (error instanceof ApiFailure) {
        const message = error.code === null ? null : copy(error.code, error.payload);
        setStatus('');
        setAlert(message ?? '');
        return;
      }
      setStatus('');
      setAlert(NETWORK_MESSAGE);
    },
    [],
  );

  const value = useMemo<Feedback>(
    () => ({ status, alert, announce, warn, clear, report }),
    [status, alert, announce, warn, clear, report],
  );
  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

export function useFeedback(): Feedback {
  const value = useContext(FeedbackContext);
  if (value === null) throw new Error('Feedback is provided by the app shell');
  return value;
}

export function FeedbackRegions(): ReactNode {
  const { status, alert } = useFeedback();
  return (
    <>
      <div role="status" aria-label="Activity status" aria-live="polite" className="status-line">
        {status}
      </div>
      {alert === '' ? null : (
        <div role="alert" className="alert">
          {alert}
        </div>
      )}
    </>
  );
}
