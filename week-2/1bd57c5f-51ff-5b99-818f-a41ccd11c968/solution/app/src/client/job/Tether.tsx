import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { DRAW_MS, EASE } from "../motion";

// The room tether: a thin blueprint line from the selected row's trailing edge to its pin.
// It draws itself once, then follows scrolling and resizing without animation, disappears
// while the row or the pin is out of view, and returns when both are back.

const SVG = "http://www.w3.org/2000/svg";

export interface TetherHandle {
  /** Draws the line for item `number`; resolves when the pen reaches the pin. */
  draw(number: number, row: HTMLElement, pin: HTMLElement, pane: HTMLElement): Promise<void>;
  clear(): void;
}

interface Target {
  number: number;
  row: HTMLElement;
  pin: HTMLElement;
  pane: HTMLElement;
}

function inside(x: number, y: number, box: DOMRect): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

/** The band of the viewport where list rows show: below the job header, above the Activity strip. */
function listBand(row: HTMLElement): { top: number; bottom: number } {
  const list = (row.closest(".list-pane") ?? document.documentElement).getBoundingClientRect();
  const head = document.querySelector(".job-head")?.getBoundingClientRect().bottom ?? 0;
  const activity = document.querySelector<HTMLElement>(".activity");
  const strip = activity && getComputedStyle(activity).visibility !== "hidden" ? activity.getBoundingClientRect().top : window.innerHeight;
  return { top: Math.max(list.top, head), bottom: Math.min(list.bottom, strip, window.innerHeight) };
}

/** The two ends in viewport coordinates, or null while either end is out of view. */
function ends({ row, pin, pane }: Target): [number, number, number, number] | null {
  if (!row.isConnected || !pin.isConnected) return null;
  // The summary line is the title's first line: the line starts level with what the row names.
  const line = row.querySelector(".row-title")?.getClientRects()[0] ?? row.getBoundingClientRect();
  const list = listBand(row);
  const paneBox = pane.getBoundingClientRect();
  const pinBox = pin.getBoundingClientRect();
  const x1 = Math.min(row.getBoundingClientRect().right, paneBox.left);
  const y1 = line.top + line.height / 2;
  const x2 = pinBox.left + pinBox.width / 2;
  const y2 = pinBox.top + pinBox.height / 2;
  if (y1 < list.top || y1 > list.bottom || !inside(x2, y2, paneBox)) return null;
  return [x1, y1, x2, y2];
}

export const Tether = forwardRef<TetherHandle>(function Tether(_props, ref) {
  const layer = useRef<SVGSVGElement>(null);
  const target = useRef<Target | null>(null);

  const remove = () => layer.current?.querySelector("line")?.remove();

  /** Places the line at its ends, creating it if needed, or removes it while out of view. */
  const place = (): SVGLineElement | null => {
    const current = target.current;
    const points = current ? ends(current) : null;
    if (!current || !points || !layer.current) {
      remove();
      return null;
    }
    let line = layer.current.querySelector("line");
    if (!line) {
      line = document.createElementNS(SVG, "line");
      line.setAttribute("data-tether", String(current.number));
      layer.current.append(line);
    }
    const [x1, y1, x2, y2] = points;
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    return line;
  };

  useImperativeHandle(ref, () => ({
    async draw(number, row, pin, pane) {
      remove();
      target.current = { number, row, pin, pane };
      const line = place();
      if (!line) return;
      const length = line.getTotalLength();
      line.style.strokeDasharray = `${length}`;
      const animation = line.animate([{ strokeDashoffset: `${length}` }, { strokeDashoffset: "0" }], { duration: DRAW_MS, easing: EASE });
      try {
        await animation.finished;
      } catch {
        // Cleared mid-draw.
      }
      line.style.strokeDasharray = "";
    },
    clear() {
      target.current = null;
      remove();
    },
  }));

  useEffect(() => {
    const follow = () => {
      if (target.current) place();
    };
    document.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    const observer = new MutationObserver(follow);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"] });
    return () => {
      document.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      observer.disconnect();
    };
  }, []);

  return <svg ref={layer} className="tether-layer" aria-hidden="true" focusable="false" />;
});
