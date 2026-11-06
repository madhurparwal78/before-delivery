import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { EASE, PublicLink, reducedMotion } from "./shell";

// The featured rail: dragged by mouse or finger, it glides on release and settles a card's left edge on
// the rail's start within 0.64 s; a fast release carries it at least one card past the nearest. A drag over
// 6 px never opens a card. Previous and Next step one card; Tab brings each card into view.

export interface FeaturedCard {
  slug: string;
  title: string;
  sector: string;
  location: string;
  coverUrl: string;
}

const SECTOR_LABEL: Record<string, string> = { retail: "Retail", workplace: "Workplace", food_beverage: "Food & beverage" };
const DRAG_SLOP = 6;
const FLICK = 0.5; // px per ms
const SAMPLE_WINDOW = 100; // ms

interface Drag {
  pointer: number;
  startX: number;
  startY: number;
  startOffset: number;
  moved: boolean;
  samples: { t: number; x: number }[];
}

export function Rail({ cards }: { cards: FeaturedCard[] }) {
  const headingId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const index = useRef(0);
  const offset = useRef(0);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [shown, setShown] = useState(0);

  const pitch = (): number => {
    const items = track.current?.children;
    if (!items || !items.length) return 0;
    return items.length > 1 ? (items[1] as HTMLElement).offsetLeft - (items[0] as HTMLElement).offsetLeft : (items[0] as HTMLElement).offsetWidth;
  };

  const place = (x: number): void => {
    offset.current = x;
    if (track.current) track.current.style.transform = `translate3d(${x}px, 0, 0)`;
  };

  /** Settles card `target` at the rail's start, gliding over `duration` ms unless motion is reduced. */
  const settle = (target: number, duration: number): void => {
    const element = track.current;
    if (!element) return;
    const to = Math.max(0, Math.min(cards.length - 1, target));
    const from = offset.current;
    index.current = to;
    setShown(to);
    place(-to * pitch());
    if (!reducedMotion() && from !== offset.current) {
      element.animate([{ transform: `translate3d(${from}px, 0, 0)` }, { transform: `translate3d(${offset.current}px, 0, 0)` }],
        { duration, easing: EASE });
    }
  };

  /** Stops a running glide where it is, so a new drag starts from what is on screen. */
  const halt = (): void => {
    const element = track.current;
    if (!element) return;
    const running = element.getAnimations();
    if (!running.length) return;
    const at = new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;
    running.forEach((animation) => animation.cancel());
    place(at);
  };

  useEffect(() => {
    const onResize = (): void => place(-index.current * pitch());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // Clicks that end a drag never open the card under the pointer.
    const onClick = (event: MouseEvent): void => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    // Focus moving to a card off to the side scrolls the clipped viewport; the rail moves the track instead.
    const onScroll = (): void => {
      element.scrollLeft = 0;
    };
    element.addEventListener("click", onClick, true);
    element.addEventListener("scroll", onScroll);
    return () => {
      element.removeEventListener("click", onClick, true);
      element.removeEventListener("scroll", onScroll);
    };
  }, []);

  const down = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    suppressClick.current = false;
    halt();
    drag.current = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, startOffset: offset.current, moved: false,
      samples: [{ t: performance.now(), x: event.clientX }] };
  };

  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (!active.moved) {
      if (Math.abs(dx) <= DRAG_SLOP || Math.abs(dx) < Math.abs(dy)) {
        if (event.pointerType === "mouse") place(active.startOffset + dx);
        return;
      }
      active.moved = true;
      viewport.current?.setPointerCapture(event.pointerId);
    }
    const now = performance.now();
    active.samples.push({ t: now, x: event.clientX });
    active.samples = active.samples.filter((sample) => now - sample.t <= SAMPLE_WINDOW);
    place(active.startOffset + dx);
  };

  const up = (event: PointerEvent<HTMLDivElement>): void => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    drag.current = null;
    const step = pitch();
    if (!step) return;
    const nearest = Math.round(-offset.current / step);
    if (!active.moved) {
      settle(nearest, 420);
      return;
    }
    suppressClick.current = true;
    const now = performance.now();
    const samples = [...active.samples, { t: now, x: event.clientX }].filter((sample) => now - sample.t <= SAMPLE_WINDOW);
    const first = samples[0];
    const last = samples[samples.length - 1];
    const elapsed = last.t - first.t;
    const velocity = elapsed > 0 ? (last.x - first.x) / elapsed : 0;
    const target = reducedMotion() || Math.abs(velocity) <= FLICK ? nearest : nearest + (velocity < 0 ? 1 : -1);
    settle(target, 640);
  };

  const cancel = (event: PointerEvent<HTMLDivElement>): void => {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    drag.current = null;
    const step = pitch();
    if (step) settle(Math.round(-offset.current / step), 420);
  };

  const count = String(cards.length).padStart(2, "0");
  return (
    <section className="rail" aria-labelledby={headingId}>
      <div className="rail-head">
        <h2 id={headingId}>Featured work</h2>
        <p className="rail-count" aria-hidden="true">{String(shown + 1).padStart(2, "0")} / {count}</p>
      </div>
      <div ref={viewport} className="rail-viewport" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
        onDragStart={(event) => event.preventDefault()}>
        <div ref={track} className="rail-track">
          {cards.map((card, position) => (
            <article key={card.slug} className="rail-card" onFocus={(event) => {
              if ((event.target as HTMLElement).matches(":focus-visible")) settle(position, 420);
            }}>
              <PublicLink href={`/work/${card.slug}`} className="card-link" draggable={false}>
                <img src={card.coverUrl} alt="" width={1600} height={1000} draggable={false} />
                <span className="card-title">{card.title}</span>
              </PublicLink>
              <p className="card-meta"><span>{SECTOR_LABEL[card.sector] ?? card.sector}</span><span>{card.location}</span></p>
            </article>
          ))}
        </div>
      </div>
      <div className="rail-controls">
        <button type="button" className="rail-button" onClick={() => settle(index.current - 1, 420)}>Previous</button>
        <button type="button" className="rail-button" onClick={() => settle(index.current + 1, 420)}>Next</button>
      </div>
    </section>
  );
}
