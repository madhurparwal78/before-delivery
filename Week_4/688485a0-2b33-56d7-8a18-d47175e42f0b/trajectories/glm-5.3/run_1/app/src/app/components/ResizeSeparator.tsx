import { ReactNode, useEffect, useRef } from "react";

/**
 * The pane separators (DP-91): resizable by pointer and by arrow keys in
 * steps of 5 percent, reporting their value, clamped between 20 and 80.
 */

export function ResizeSeparator(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  orientation?: "horizontal" | "vertical";
}): ReactNode {
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: PointerEvent): void => {
      if (!dragging.current || containerRef.current === null) return;
      const rect = containerRef.current.parentElement?.getBoundingClientRect();
      if (rect === undefined) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      props.onChange(clamp(pct));
    };
    const up = (): void => {
      dragging.current = false;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [props]);
  return (
    <div
      ref={containerRef}
      role="separator"
      aria-label={props.label}
      aria-valuenow={Math.round(props.value)}
      aria-valuemin={20}
      aria-valuemax={80}
      tabIndex={0}
      className="resize-sep"
      onPointerDown={() => {
        dragging.current = true;
      }}
      onKeyDown={e => {
        const add = (d: number): void => props.onChange(clamp(props.value + d));
        switch (e.key) {
          case "ArrowDown": case "ArrowRight": e.preventDefault(); add(5); break;
          case "ArrowUp": case "ArrowLeft": e.preventDefault(); add(-5); break;
          case "Home": e.preventDefault(); props.onChange(20); break;
          case "End": e.preventDefault(); props.onChange(80); break;
        }
      }}
    />
  );
}

function clamp(v: number): number {
  return Math.max(20, Math.min(80, Math.round(v)));
}
