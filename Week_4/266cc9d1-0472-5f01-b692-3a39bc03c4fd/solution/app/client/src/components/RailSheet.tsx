// The findings rail: a paper sheet on the right on tablet and desktop; on phones a bottom sheet
// that starts collapsed, where everything but the summary line and the toggle is hidden and inert.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { focusables, trapTab } from "../focus";
import { playExit } from "../motion";

interface RailSheetProps {
  phone: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  summary: ReactNode;
  children: ReactNode;
}

export function RailSheet({ phone, expanded, onExpandedChange, summary, children }: RailSheetProps) {
  const rail = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const open = !phone || expanded;

  useEffect(() => {
    if (phone && expanded && body.current !== null) (focusables(body.current)[0] ?? toggle.current)?.focus();
  }, [phone, expanded]);

  // Expanded on a phone, the sheet rises at most to 60% of the viewport and never over the readout.
  useLayoutEffect(() => {
    const element = rail.current;
    if (element === null || !phone || !expanded) return;
    const fit = () => {
      const readout = document.querySelector(".readout-float")?.getBoundingClientRect();
      const bottom = element.getBoundingClientRect().bottom;
      const room = readout === undefined ? Infinity : bottom - readout.bottom - 8;
      element.style.maxHeight = `${Math.min(window.innerHeight * 0.6, room)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      element.style.maxHeight = "";
    };
  }, [phone, expanded]);

  const collapse = () => {
    const element = rail.current;
    if (element === null) return;
    const focusInside = element.contains(document.activeElement);
    void playExit(element).then(() => {
      onExpandedChange(false);
      if (focusInside) toggle.current?.focus();
    });
  };

  return (
    <aside
      ref={rail}
      aria-label="Findings rail"
      className={`rail${phone && expanded ? " expanded" : ""}`}
      onKeyDown={(event) => {
        if (!phone || !expanded || rail.current === null) return;
        if (event.key === "Escape") {
          event.preventDefault();
          collapse();
          return;
        }
        trapTab(rail.current, event.nativeEvent);
      }}
    >
      {phone && (
        <div className="rail-summary">
          {summary}
          <button
            ref={toggle}
            type="button"
            className="button"
            aria-expanded={expanded}
            onClick={() => (expanded ? collapse() : onExpandedChange(true))}
          >
            {expanded ? "Hide findings" : "Show findings"}
          </button>
        </div>
      )}
      <div ref={body} className="rail-scroll" hidden={!open} inert={!open}>
        {children}
      </div>
    </aside>
  );
}
