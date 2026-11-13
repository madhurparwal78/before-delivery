// The drawn chrome: frame, vertex dots, crosshair and dimension leader. All of it is hidden from assistive
// technology and never catches a click.
import { useLayoutEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { significant } from "../shared/numbers";

export function Frame({ amber = false, dot, running = false }: { amber?: boolean; dot?: number; running?: boolean }) {
  const corners = dot === undefined ? null : ["tl", "tr", "bl", "br"];
  return (
    <span className={amber ? "frame frame-amber" : "frame"} data-ui="frame" aria-hidden="true">
      {running ? (
        <svg className="frame-dash" width="100%" height="100%" preserveAspectRatio="none">
          <rect x="0.5" y="0.5" width="calc(100% - 1px)" height="calc(100% - 1px)" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="8 8" />
        </svg>
      ) : null}
      {corners?.map((corner) => (
        <span key={corner} className={`vertex-dot dot-${corner}`} data-ui="vertex-dot" style={{ width: dot, height: dot }} />
      ))}
    </span>
  );
}

export function Crosshair() {
  return (
    <span className="crosshair" data-ui="crosshair" aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

/** A page heading with its dimension leader: the figure is the heading's rendered width in inches, to two significant figures. */
export function PageHeading({ children, as: Tag = "h1", className }: { children: ReactNode; as?: ElementType; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    void document.fonts.ready.then(measure);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="heading-row">
      <Tag ref={ref} className={className}>
        {children}
      </Tag>
      <DimensionLeader inches={width / 96} />
    </div>
  );
}

function DimensionLeader({ inches }: { inches: number }) {
  return (
    <span className="leader" data-ui="dimension-leader" aria-hidden="true">
      <svg width="64" height="20" viewBox="0 0 64 20" fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M0.5 2v16M63.5 2v16" />
        <path d="M1 10h62" />
        <path d="m1 10 5-3v6zM63 10l-5-3v6z" fill="currentColor" />
      </svg>
      <span className="leader-text">
        <span data-ui="leader-figure">{significant(inches, 2)}</span>
        <span data-ui="leader-unit">″</span>
      </span>
    </span>
  );
}
