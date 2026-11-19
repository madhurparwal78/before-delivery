import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { replaceSearch } from "./router.tsx";

const KEY_STEP = 1;
const SHIFT_STEP = 10;

interface Picture {
  src: string;
  alt: string;
  caption: string;
}

interface SliderProps {
  name: string;
  before: Picture;
  after: Picture;
  /** The spoken value for a share. */
  valueText: (share: number) => string;
}

function clamp(share: number): number {
  return Math.min(100, Math.max(0, Math.round(share)));
}

/** The share in the address, `?before=<share>`, with the middle as the default. */
function shareFromAddress(): number {
  const text = new URLSearchParams(window.location.search).get("before");
  return text !== null && /^\d+$/.test(text) ? clamp(Number(text)) : 50;
}

/**
 * The before and after slider. The before picture is on the reading start, so Left moves the handle left
 * in both directions: in Arabic that shows more of it. A keyboard step glides; a drag follows the pointer.
 */
export function Slider({ name, before, after, valueText }: SliderProps): JSX.Element {
  const [share, setShare] = useState(shareFromAddress);
  const [glide, setGlide] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const rtl = document.documentElement.dir === "rtl";

  const move = (next: number, gliding: boolean): void => {
    const value = clamp(next);
    setGlide(gliding);
    setShare(value);
    replaceSearch(`?before=${value}`);
  };

  const onKey = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? SHIFT_STEP : KEY_STEP;
    const rightward = rtl ? -step : step;
    const delta = { ArrowLeft: -rightward, ArrowRight: rightward, ArrowUp: step, ArrowDown: -step }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    move(share + delta, true);
  };

  const follow = (event: PointerEvent): void => {
    const box = (frame.current as HTMLDivElement).getBoundingClientRect();
    const fromLeft = ((event.clientX - box.left) / box.width) * 100;
    move(rtl ? 100 - fromLeft : fromLeft, false);
  };

  const position = rtl ? 100 - share : share;
  const hidden = 100 - share;
  return (
    <figure class="ba">
      <div
        ref={frame}
        class="ba-frame"
        data-glide={glide ? "true" : undefined}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          handle.current?.focus({ preventScroll: true });
          follow(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) follow(event);
        }}
      >
        <div class="ba-pictures">
          <img class="ba-picture" src={after.src} alt={after.alt} draggable={false} />
          <img
            class="ba-picture ba-picture--before"
            src={before.src}
            alt={before.alt}
            draggable={false}
            style={{ clipPath: rtl ? `inset(0 0 0 ${hidden}%)` : `inset(0 ${hidden}% 0 0)` }}
          />
        </div>
        <div class="ba-line" style={{ left: `${position}%` }} />
        <div
          ref={handle}
          class="ba-handle"
          role="slider"
          tabIndex={0}
          aria-label={name}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={share}
          aria-valuetext={valueText(share)}
          style={{ left: `${position}%` }}
          onKeyDown={onKey}
        />
      </div>
      <figcaption class="ba-captions">
        <span>{before.caption}</span>
        <span>{after.caption}</span>
      </figcaption>
    </figure>
  );
}
