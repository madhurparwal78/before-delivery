// A modal dialog: focus moves to its first control, Tab wraps inside, Escape closes without saving,
// and focus returns to the control that opened it. Entry and exit are CSS animations (--dur-entry).
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { focusables, trapTab } from "../focus";
import { playExit } from "../motion";

interface DialogProps {
  title: string;
  opener: HTMLElement | null;
  onClosed: () => void;
  children: (close: () => void) => ReactNode;
}

export function Dialog({ title, opener, onClosed, children }: DialogProps) {
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const titleId = useId();

  /** Focus returns to the opener at once; the leaving dialog is inert while its exit plays. */
  const close = () => {
    const root = backdrop.current;
    if (closing.current || root === null) return;
    closing.current = true;
    root.inert = true;
    if (opener?.isConnected === true) opener.focus();
    void playExit(root).then(onClosed);
  };

  useEffect(() => {
    const root = panel.current;
    if (root === null) return;
    (focusables(root)[0] ?? root).focus();
  }, []);

  return createPortal(
    <div className="backdrop" ref={backdrop}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panel}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (panel.current !== null) trapTab(panel.current, event.nativeEvent);
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {children(close)}
      </div>
    </div>,
    document.body,
  );
}
