import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";
import { EASE, reducedMotion } from "../seam";
import { CloseIcon } from "./Icons";

const DRAWER_MS = 320;

interface Props {
  title: string;
  /** Changes when the drawer shows another assignment, so focus moves to the new heading. */
  contentKey: string;
  onClosed: () => void;
  children: React.ReactNode;
}

/**
 * The right-hand assignment drawer: a non-modal dialog docked over the right third of the sheet (a full-width
 * sheet below 1024px). Escape or Close slide it out; the caller returns focus to the control that opened it.
 */
export function Drawer({ title, contentKey, onClosed, children }: Props) {
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const closing = useRef(false);
  const titleId = useId();

  useLayoutEffect(() => {
    if (!reducedMotion()) {
      panel.current?.animate([{ transform: "translateX(100%)" }, { transform: "translateX(0)" }], {
        duration: DRAWER_MS,
        easing: EASE,
      });
    }
  }, []);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [contentKey]);

  const close = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    if (!reducedMotion() && panel.current) {
      const out = panel.current.animate([{ transform: "translateX(0)" }, { transform: "translateX(100%)" }], {
        duration: DRAWER_MS,
        easing: EASE,
        fill: "forwards",
      });
      await out.finished.catch(() => undefined);
    }
    onClosed();
  }, [onClosed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      void close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <aside ref={panel} className="drawer" role="dialog" aria-labelledby={titleId}>
      <header className="drawer-head">
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <button type="button" className="button button-quiet" onClick={() => void close()}>
          <CloseIcon />
          Close
        </button>
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  );
}
