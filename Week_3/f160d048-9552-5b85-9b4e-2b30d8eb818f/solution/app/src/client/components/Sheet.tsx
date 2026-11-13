import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";
import { EASE, motionMs } from "../motion";
import { useDialog } from "./dialog";

type SheetState = "closed" | "opening" | "open" | "closing";

type Props = { title: string; open: boolean; onClose: () => void; opener: RefObject<HTMLElement | null>; children: ReactNode };

const SWIPE_PX = 80;

/** A bottom sheet that rises quickly and settles softly, and sinks back the same way. */
export function Sheet({ title, open, onClose, opener, children }: Props) {
  const [state, setState] = useState<SheetState>("closed");
  const panel = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ y: number } | undefined>(undefined);
  const ms = motionMs(280);
  useDialog(open && state !== "closed", onClose, panel, opener);

  useEffect(() => {
    const opening = open;
    if (opening && (state === "closed" || state === "closing")) {
      setState(ms === 0 ? "open" : "opening");
    } else if (!opening && (state === "open" || state === "opening")) {
      setState(ms === 0 ? "closed" : "closing");
    }
  }, [open, state, ms]);

  useEffect(() => {
    if (ms === 0 || (state !== "opening" && state !== "closing")) return;
    const element = panel.current;
    const rising = state === "opening";
    const animation = element?.animate(
      [{ transform: rising ? "translateY(100%)" : "translateY(0)" }, { transform: rising ? "translateY(0)" : "translateY(100%)" }],
      { duration: ms, easing: EASE, fill: "both" },
    );
    const timer = window.setTimeout(() => {
      animation?.finish();
      setState(rising ? "open" : "closed");
    }, ms);
    return () => {
      window.clearTimeout(timer);
      animation?.cancel();
    };
  }, [state, ms]);

  function down(event: PointerEvent<HTMLDivElement>) {
    swipe.current = { y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function up(event: PointerEvent<HTMLDivElement>) {
    const from = swipe.current;
    swipe.current = undefined;
    if (from && event.clientY - from.y >= SWIPE_PX) onClose();
  }

  if (state === "closed") return null;
  return (
    <>
      <div className="scrim" aria-hidden="true" onClick={onClose} />
      <div ref={panel} className="sheet" role="dialog" aria-modal="true" aria-label={title} data-motion="filter-sheet" data-motion-ms={ms} data-state={state}>
        <div className="sheet-grip" onPointerDown={down} onPointerUp={up} onPointerCancel={() => (swipe.current = undefined)} />
        {children}
      </div>
    </>
  );
}
