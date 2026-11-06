import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useState } from 'preact/hooks';
import { enter } from './motion.js';

type Tone = 'neutral' | 'success';
interface Toast {
  id: number;
  text: string;
  tone: Tone;
  leaving: boolean;
}

const SHOWN_MS = 4000;
const LEAVE_MS = 200;

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

export const useToast = () => useContext(ToastContext);

let nextId = 1;

/** One polite status region, present in the first HTML; each toast rises in and leaves on its own. */
export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((text: string, tone: Tone = 'neutral') => {
    const id = nextId++;
    setToasts((list) => [...list, { id, text, tone, leaving: false }]);
    setTimeout(() => {
      setToasts((list) => list.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
      setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), LEAVE_MS);
    }, SHOWN_MS);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div class="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <p
            key={toast.id}
            ref={(el) => enter(el, 200, 8)}
            class={`toast toast-${toast.tone}${toast.leaving ? ' is-leaving' : ''}`}
          >
            {toast.tone === 'success' && <span class="toast-mark" aria-hidden="true" />}
            {toast.text}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
