// The four named live regions (brief: Public screens → Every screen). They live outside the app shell, so the
// inert shell behind an open dialog never silences them, and they never take a pointer from a control.

import { CircleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

interface Message {
  text: string;
  seq: number;
}

interface Feedback {
  update(text: string): void;
  problem(text: string): void;
  clearProblem(): void;
  readout(text: string): void;
}

const FeedbackContext = createContext<Feedback | null>(null);

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error("useFeedback outside FeedbackProvider");
  return feedback;
}

const FOLD_MS = 6000;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [update, setUpdate] = useState<Message>({ text: "", seq: 0 });
  const [problem, setProblem] = useState<Message>({ text: "", seq: 0 });
  const [readout, setReadout] = useState<Message>({ text: "", seq: 0 });
  const [updateFolded, setUpdateFolded] = useState(false);

  // Each message is committed at once, so two messages in quick succession are both written and announced in order.
  const feedback = useMemo<Feedback>(
    () => ({
      update: (text) =>
        flushSync(() => {
          setUpdate((last) => ({ text, seq: last.seq + 1 }));
          setUpdateFolded(false);
        }),
      problem: (text) => flushSync(() => setProblem((last) => ({ text, seq: last.seq + 1 }))),
      clearProblem: () => flushSync(() => setProblem((last) => (last.text ? { text: "", seq: last.seq + 1 } : last))),
      readout: (text) => flushSync(() => setReadout((last) => ({ text, seq: last.seq + 1 }))),
    }),
    [],
  );

  useEffect(() => {
    if (!update.text) return;
    const timer = setTimeout(() => setUpdateFolded(true), FOLD_MS);
    return () => clearTimeout(timer);
  }, [update]);

  const dismiss = useCallback(() => feedback.clearProblem(), [feedback]);

  return (
    <FeedbackContext.Provider value={feedback}>
      {children}
      <div className="toasts">
        <div className={`toast toast-problem${problem.text ? "" : " is-empty"}`}>
          <CircleAlert className="toast-icon" aria-hidden="true" size={20} strokeWidth={1.75} />
          <div role="alert" aria-label="Desk problems" className="toast-text">
            {problem.text ? <span key={problem.seq}>{problem.text}</span> : null}
          </div>
          {problem.text ? (
            <button type="button" className="toast-close" onClick={dismiss} aria-label="Dismiss problem">
              <X aria-hidden="true" size={18} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        <div className={`toast toast-update${update.text && !updateFolded ? "" : " is-empty"}`}>
          <div role="status" aria-label="Desk updates" className="toast-text">
            {update.text ? <span key={update.seq}>{update.text}</span> : null}
          </div>
        </div>
      </div>
      <div role="status" aria-label="Strength readout" className="sr-only">
        {readout.text ? <span key={readout.seq}>{readout.text}</span> : null}
      </div>
    </FeedbackContext.Provider>
  );
}
