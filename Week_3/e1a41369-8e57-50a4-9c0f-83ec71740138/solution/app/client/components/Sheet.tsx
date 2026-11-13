import { X } from "lucide-react";
import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { reducedMotion } from "../format";

const FOCUSABLE = "button, input, select, textarea, a[href], [tabindex]";
const SLIDE_OUT_MS = 280;
const EASE = "cubic-bezier(.2,.8,.2,1)";

/** Open sheets and dialogs, newest last: only the newest one traps Tab and answers Escape. */
const stack: HTMLElement[] = [];

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.hasAttribute("disabled") && element.tabIndex >= 0 && element.getAttribute("type") !== "hidden" && element.getClientRects().length > 0,
  );
}

function trapKeys(event: KeyboardEvent): void {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (event.key === "Escape") {
    event.preventDefault();
    top.dispatchEvent(new CustomEvent("dismiss"));
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusables(top);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (!top.contains(active) || (event.shiftKey && active === first)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

document.addEventListener("keydown", trapKeys);

const CloseContext = createContext<() => void>(() => undefined);
export const useSheetClose = (): (() => void) => useContext(CloseContext);

interface SheetProps {
  title: string;
  onClose: () => void;
  /** Centred dialogs ("Level up", "You fainted") do not slide and have no closing X. */
  centered?: boolean;
  /** The party dialog keeps the rail's aubergine field. */
  ink?: boolean;
  children: ReactNode;
}

/** A dialog that slides in from the right edge (or opens centred), keeps Tab inside and closes on Escape. */
export function Sheet({ title, onClose, centered = false, ink = false, children }: SheetProps) {
  const root = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const mounted = useRef(true);
  const headingId = useId();

  const close = (): void => {
    const element = root.current;
    if (!element || closing.current) return;
    closing.current = true;
    if (centered || reducedMotion()) {
      onClose();
      return;
    }
    element.setAttribute("aria-hidden", "true");
    element.inert = true;
    scrim.current!.classList.add("scrim-closing");
    const slide = element.animate([{ transform: "translateX(0)" }, { transform: "translateX(100%)" }], { duration: SLIDE_OUT_MS, easing: EASE, fill: "forwards" });
    void slide.finished.then(() => mounted.current && onClose());
  };
  const dismiss = useRef(close);
  dismiss.current = close;

  useEffect(() => {
    const element = root.current!;
    stack.push(element);
    const onDismiss = (): void => dismiss.current();
    element.addEventListener("dismiss", onDismiss);
    focusables(element)[0]?.focus();
    return () => {
      mounted.current = false;
      element.removeEventListener("dismiss", onDismiss);
      stack.splice(stack.indexOf(element), 1);
    };
  }, []);

  return createPortal(
    <div ref={scrim} className={centered ? "scrim scrim-centered" : "scrim"} onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div ref={root} className={`sheet${centered ? " sheet-centered" : ""}${ink ? " sheet-ink" : ""}`} role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <CloseContext.Provider value={close}>
          <h2 id={headingId} className="sheet-title">{title}</h2>
          {children}
          {!centered && (
            <button type="button" className="sheet-close" aria-label="Close" onClick={close}>
              <X aria-hidden="true" size={22} />
            </button>
          )}
        </CloseContext.Provider>
      </div>
    </div>,
    document.body,
  );
}
