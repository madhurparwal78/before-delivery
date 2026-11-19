import { Check } from "lucide-react";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/** A transient confirmation for actions the brief gives no status copy (it never carries a pinned string). */

const TOAST_MS = 4000;
const ToastContext = createContext<(text: string) => void>(() => undefined);

export const useToast = (): ((text: string) => void) => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const counter = useRef(0);
  const show = useCallback((text: string) => setMessage({ text, id: ++counter.current }), []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [message]);
  return (
    <ToastContext value={show}>
      {children}
      <div className="toast-region" role="status" aria-label="Notice">
        {message ? (
          <p className="toast" key={message.id}>
            <Check size={18} aria-hidden="true" />
            {message.text}
          </p>
        ) : null}
      </div>
    </ToastContext>
  );
}
