// Spec drawers: spring open (one slight overshoot) in about a third of a second, close in about a quarter.
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { usePresence } from "../lib/presence";

function springOpen(element: HTMLElement): Keyframe[] {
  const height = element.scrollHeight;
  return [
    { height: "0px", opacity: 0 },
    { height: `${Math.round(height * 1.04)}px`, opacity: 1, offset: 0.7 },
    { height: `${height}px`, opacity: 1 },
  ];
}

function foldClosed(element: HTMLElement): Keyframe[] {
  return [
    { height: `${element.offsetHeight}px`, opacity: 1 },
    { height: "0px", opacity: 0 },
  ];
}

export function Drawer({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const { ref, mounted, closing } = usePresence<HTMLDivElement>(open, {
    enter: springOpen,
    exit: foldClosed,
    enterTiming: { duration: 340, easing: "cubic-bezier(.3,.7,.4,1)" },
    exitTiming: { duration: 240, easing: "ease-in" },
  });
  return (
    <div className="drawer">
      <h3 className="drawer__heading">
        <button
          type="button"
          className="drawer__toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{title}</span>
          <ChevronDown aria-hidden="true" size={18} strokeWidth={1.5} className="drawer__chevron" />
        </button>
      </h3>
      {mounted && (
        <div id={id} ref={ref} className="drawer__panel" inert={closing} aria-hidden={closing || undefined}>
          <div className="drawer__inner">{children}</div>
        </div>
      )}
    </div>
  );
}
