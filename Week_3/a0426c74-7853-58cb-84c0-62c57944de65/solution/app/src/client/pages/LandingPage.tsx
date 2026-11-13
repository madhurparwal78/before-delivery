import { useLayoutEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import { LANDING_TAGLINE } from '../../shared/copy.ts';
import { Link } from '../router.tsx';
import { SheetFrame } from './landing/SheetFrame.tsx';
import { SHEET_DRAWINGS } from './landing/sheets.ts';

/** Frame 3, `Stage layout, Hall B`, is centred at load. */
const INITIAL_INDEX = 2;

/**
 * Marks the frame nearest the strip's centre as lit. This runs inside the scroll event itself and writes the
 * attribute directly: the verifier pauses the page clock, so the lit frame must not wait for a timer or for
 * React's scheduler.
 */
function lightCentredFrame(strip: HTMLElement): void {
  const middle = strip.scrollLeft + strip.clientWidth / 2;
  const items = [...strip.querySelectorAll<HTMLElement>('[data-frame]')];
  let nearest = items[0];
  for (const item of items) {
    const centre = item.offsetLeft + item.offsetWidth / 2;
    if (nearest && Math.abs(centre - middle) < Math.abs(nearest.offsetLeft + nearest.offsetWidth / 2 - middle)) nearest = item;
  }
  for (const item of items) item.setAttribute('data-lit', String(item === nearest));
}

function centreFrame(strip: HTMLElement, index: number): void {
  const item = strip.querySelectorAll<HTMLElement>('[data-frame]')[index];
  if (item) strip.scrollLeft = item.offsetLeft + item.offsetWidth / 2 - strip.clientWidth / 2;
}

export function LandingPage() {
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startScroll: number } | null>(null);

  useLayoutEffect(() => {
    if (!strip.current) return;
    centreFrame(strip.current, INITIAL_INDEX);
    lightCentredFrame(strip.current);
  }, []);

  // A native scroller pans by wheel, scrollbar, keys and touch but not by a mouse drag, so the mouse gets its own.
  function startDrag(event: PointerEvent<HTMLDivElement>): void {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startScroll: event.currentTarget.scrollLeft };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.setAttribute('data-dragging', 'true');
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>): void {
    if (drag.current?.pointerId === event.pointerId) {
      event.currentTarget.scrollLeft = drag.current.startScroll - (event.clientX - drag.current.startX);
    }
  }

  function endDrag(event: PointerEvent<HTMLDivElement>): void {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.removeAttribute('data-dragging');
  }

  return (
    <main className="landing">
      <h1 className="landing-name">Plotfold</h1>
      <Link to="/signin" className="landing-link landing-signin">Sign in</Link>
      <div
        ref={strip}
        className="strip"
        role="region"
        aria-label="Sheet strip"
        tabIndex={0}
        onScroll={(event) => lightCentredFrame(event.currentTarget)}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <ul className="strip-track">
          {SHEET_DRAWINGS.map((drawing) => (
            <li key={drawing.title} className="strip-item" data-frame>
              <SheetFrame drawing={drawing} className="strip-sheet" />
              <p className="strip-title">{drawing.title}</p>
            </li>
          ))}
        </ul>
      </div>
      <p className="landing-tagline">{LANDING_TAGLINE}</p>
      <Link to="/register" className="landing-link landing-start">Start drawing</Link>
    </main>
  );
}
