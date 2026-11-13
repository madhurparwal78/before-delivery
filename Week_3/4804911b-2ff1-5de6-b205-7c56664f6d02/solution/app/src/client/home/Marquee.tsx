import { useEffect, useRef, useState } from "preact/hooks";
import { formatDate, rupees } from "../../shared/copy";
import type { Catalogue, NoticeDetail } from "../../shared/types";
import { Icon } from "../lib/icons";

const BAR_HEIGHT = 44;
const PAD = 8;
const SPEED = 48; // px per second: crosses 1280 px in about 27 seconds

interface Entry {
  key: string;
  text: string;
}

/** Every row of every in-effect notice, under the SKU's current name. */
export function marqueeEntries(catalogue: Catalogue | null, notices: Array<{ number: string; state: string; currentVersion: NoticeDetail["versions"][number] }>): Entry[] {
  const names = new Map<string, string>();
  catalogue?.drinks.forEach((d) => d.skus.forEach((s) => names.set(s.code, s.name)));
  const out: Entry[] = [];
  for (const n of notices) {
    if (n.state !== "in_effect") continue;
    const v = n.currentVersion;
    for (const row of v.rows) {
      out.push({ key: `${n.number}-${row.skuCode}`, text: `${names.get(row.skuCode) ?? row.name} Rs ${rupees(row.oldMrpPaise)} to Rs ${rupees(row.revisedMrpPaise)} from ${formatDate(v.effectiveDate)}` });
    }
  }
  return out;
}

let placeNow = (): void => undefined;
/** Re-places the bar and the scroll padding at once, when a layer changed or the page just moved. */
export const placeBar = (): void => placeNow();

export function Marquee({ entries, reduced }: { entries: Entry[]; reduced: boolean }) {
  const [paused, setPaused] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const bar = useRef<HTMLDivElement>(null);

  // the bar sits on the hero's seam, then slides down and stays attached to the bottom edge as the reels pass
  useEffect(() => {
    const place = () => {
      const el = bar.current;
      const root = document.documentElement.style;
      const slip = document.querySelector<HTMLElement>(".slip")?.offsetHeight ?? 0;
      if (!el || reduced) {
        root.setProperty("--bar-top", `${innerHeight - BAR_HEIGHT}px`);
        root.scrollPaddingBottom = `${slip + PAD}px`;
        return;
      }
      const top = Math.min(innerHeight - el.offsetHeight, innerHeight * 0.82 + scrollY);
      el.style.top = `${top}px`;
      root.setProperty("--bar-top", `${top}px`);
      root.scrollPaddingBottom = `${el.offsetHeight + slip + PAD}px`;
    };
    placeNow = place;
    place();
    addEventListener("scroll", place, { passive: true });
    addEventListener("resize", place);
    return () => {
      removeEventListener("scroll", place);
      removeEventListener("resize", place);
      document.documentElement.style.scrollPaddingBottom = "";
    };
  }, [reduced]);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(now - last, 100);
      last = now;
      const el = track.current;
      if (!el || pausedRef.current) return;
      const half = el.scrollWidth / 2;
      if (half <= 0) return;
      offset.current = (offset.current + (SPEED * dt) / 1000) % half;
      el.style.transform = `translate3d(${-offset.current}px,0,0)`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, entries.length]);

  const items = entries.map((e) => (
    <span class="marquee-item" key={e.key}>
      {e.text}
    </span>
  ));
  return (
    <div ref={bar} class={`marquee-bar${reduced ? " marquee-static" : ""}`}>
      {!reduced && (
        <button type="button" class="marquee-toggle" aria-label={paused ? "Play price changes" : "Pause price changes"} onClick={() => setPaused((p) => !p)}>
          <Icon name={paused ? "play" : "pause"} />
        </button>
      )}
      <div role="marquee" aria-label="Price changes" class="marquee">
        {reduced ? (
          <ul class="marquee-list">{entries.map((e) => <li key={e.key}>{e.text}</li>)}</ul>
        ) : (
          <div class="marquee-track" ref={track}>
            {items}
            <span aria-hidden="true" class="marquee-dup">
              {entries.map((e) => <span class="marquee-item" key={`d-${e.key}`}>{e.text}</span>)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
