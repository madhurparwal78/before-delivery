import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ProductImage } from "../../shared/api";
import { EASE, MOTION, reducedNow, useMotionMs } from "../lib/motion";
import { Dialog } from "./Dialog";

const SWIPE_MIN_PX = 40;

/** Thumbnail tabs, arrow keys, swipe and a zoom dialog. Publishes data-state and data-motion-ms. */
export function Gallery({ images }: { images: ProductImage[] }) {
  const [index, setIndex] = useState(0);
  const [sliding, setSliding] = useState(false);
  const [zoom, setZoom] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const zoomButton = useRef<HTMLButtonElement>(null);
  const motionMs = useMotionMs(MOTION.gallery);
  const count = images.length;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = (next: number, focus = false) => {
    if (next === index || count === 0) return;
    const from = index;
    setIndex(next);
    if (focus) tabs.current[next]?.focus();
    if (reducedNow()) return;
    setSliding(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSliding(false), MOTION.gallery);
    strip.current?.animate([{ transform: `translateX(${-from * 100}%)` }, { transform: `translateX(${-next * 100}%)` }], {
      duration: MOTION.gallery,
      easing: EASE,
    });
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: (index + 1) % count,
      ArrowLeft: (index - 1 + count) % count,
      Home: 0,
      End: count - 1,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    show(next, true);
  };

  const onRegionKey = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.key === "z" || event.key === "Z") && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      setZoom(true);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    touch.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
      show(dx < 0 ? Math.min(index + 1, count - 1) : Math.max(index - 1, 0));
    }
  };

  const alt = (i: number) => `${images[i]?.alt ?? ""}, view ${i + 1} of ${count}`;
  const current = images[index];

  return (
    <section
      aria-label="Gallery"
      className="gallery"
      data-motion-ms={motionMs}
      data-state={sliding ? "sliding" : "idle"}
      onKeyDown={onRegionKey}
    >
      <div className="gallery-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (touch.current = null)}>
        <div ref={strip} className="gallery-strip" style={{ transform: `translateX(${-index * 100}%)` }}>
          {images.map((image, i) => (
            <img key={image.id} src={image.url} alt={alt(i)} width="600" height="600" draggable={false} />
          ))}
        </div>
        <button ref={zoomButton} type="button" className="btn gallery-zoom" onClick={() => setZoom(true)}>
          Zoom image
        </button>
      </div>
      <div role="tablist" aria-label="Gallery views" className="gallery-tabs">
        {images.map((image, i) => (
          <button
            key={image.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-label={`View ${i + 1}`}
            aria-selected={i === index}
            tabIndex={i === index ? 0 : -1}
            className="gallery-tab"
            onClick={() => show(i)}
            onKeyDown={onTabKey}
          >
            <img src={image.url} alt="" width="56" height="56" draggable={false} />
          </button>
        ))}
      </div>
      <Dialog title="Zoomed image" kind="modal" open={zoom} onClose={() => setZoom(false)}>
        {current && <img className="zoomed" src={current.url} alt={alt(index)} />}
        <button type="button" className="btn btn-primary" onClick={() => setZoom(false)}>
          Close zoom
        </button>
      </Dialog>
    </section>
  );
}
