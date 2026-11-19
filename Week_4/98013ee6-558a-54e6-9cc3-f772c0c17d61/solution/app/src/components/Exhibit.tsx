import { X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { navigate, takePendingCarry, type Rect } from "../lib/router";
import { usePin } from "../lib/hooks";
import { isTopDialog, popDialog, pushDialog, trapTab } from "../ui/focus";
import { NotFound } from "../pages/NotFound";
import { PinContent } from "./PinContent";

const CARRY_MS = 520;
const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";
const reducedMotion = (): boolean => document.documentElement.dataset["motion"] === "reduced";

const toRect = (rect: DOMRect): Rect => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });

/** The transform that makes an element laid out at `at` appear at `from`. */
function carryTransform(from: Rect, at: Rect): string {
  const sx = from.width / at.width;
  const sy = from.height / at.height;
  return `translate(${from.x - at.x}px, ${from.y - at.y}px) scale(${sx}, ${sy})`;
}

interface Props {
  pinId: number;
  cardId: number | null;
  closing: boolean;
  onExited: () => void;
}

/** The lit exhibit view over the dimmed grid. Opening carries the print out of its grid slot; closing carries it back. */
export function Exhibit({ pinId, cardId, closing, onExited }: Props) {
  const titleId = useId();
  const { pin, setPin, missing } = usePin(pinId);
  const [carry] = useState<Rect | null>(() => takePendingCarry());
  const layer = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const token = useRef(Symbol("exhibit"));
  const entered = useRef(false);
  const exited = useRef(false);

  useLayoutEffect(() => {
    const own = token.current;
    pushDialog(own);
    return () => popDialog(own);
  }, []);

  const ready = pin !== null || missing;
  useLayoutEffect(() => {
    if (!ready || entered.current) return;
    entered.current = true;
    const root = panel.current;
    if (!root) return;
    (root.querySelector<HTMLElement>("[data-autofocus]") ?? root).focus({ preventScroll: true });
    if (reducedMotion()) {
      layer.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "linear" });
      return;
    }
    const img = image.current;
    if (carry && img) {
      img.animate([{ transformOrigin: "0 0", transform: carryTransform(carry, toRect(img.getBoundingClientRect())) }, { transformOrigin: "0 0", transform: "none" }], {
        duration: CARRY_MS,
        easing: EASE,
      });
      text.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: 200, easing: "ease-out", fill: "backwards" });
      backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: EASE });
    } else {
      layer.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" });
    }
  }, [ready, carry]);

  useEffect(() => {
    if (!closing || exited.current) return;
    exited.current = true;
    const finish = (): void => onExited();
    const card = cardId === null ? null : document.querySelector<HTMLElement>(`[data-pin-id="${cardId}"]`);
    if (card) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) card.scrollIntoView({ block: "nearest" });
      card.focus({ preventScroll: true });
    }
    const img = image.current;
    const slot = card?.querySelector("img");
    if (reducedMotion()) {
      layer.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "linear", fill: "forwards" }).finished.then(finish, finish);
      return;
    }
    if (img && slot) {
      const animation = img.animate(
        [{ transformOrigin: "0 0", transform: "none" }, { transformOrigin: "0 0", transform: carryTransform(toRect(slot.getBoundingClientRect()), toRect(img.getBoundingClientRect())) }],
        { duration: CARRY_MS, easing: EASE, fill: "forwards" },
      );
      text.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: "ease-in", fill: "forwards" });
      backdrop.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CARRY_MS, easing: EASE, fill: "forwards" });
      animation.finished.then(finish, finish);
      return;
    }
    layer.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).finished.then(finish, finish);
  }, [closing, cardId, onExited]);

  const requestClose = (): void => {
    if (!closing) history.back();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!isTopDialog(token.current) || event.defaultPrevented || closing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (panel.current) trapTab(event, panel.current);
  };

  return (
    <div ref={layer} className={`exhibit-layer${closing ? " exhibit-layer--closing" : ""}`}>
      <div ref={backdrop} className="exhibit-backdrop" />
      <div
        ref={panel}
        className="exhibit"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          if (event.target === event.currentTarget) requestClose();
        }}
      >
        <button type="button" className="icon-button exhibit-close" aria-label="Close" data-autofocus onClick={requestClose}>
          <X aria-hidden="true" size={24} />
        </button>
        {pin ? (
          <PinContent pin={pin} titleId={titleId} variant="exhibit" imageRef={image} textRef={text} onChange={setPin} onGone={() => navigate("/", { replace: true })} />
        ) : missing ? (
          <NotFound heading="Pin not found" titleId={titleId} />
        ) : null}
      </div>
    </div>
  );
}
