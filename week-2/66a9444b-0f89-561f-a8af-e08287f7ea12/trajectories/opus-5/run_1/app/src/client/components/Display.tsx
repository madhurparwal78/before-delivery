import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useReducedMotion } from '../lib/motion.js';

/** Display words span between 70% and 90% of the viewport width at every viewport. */
const TARGET_SHARE = 0.8;
const MIN_SIZE = 20;
const MAX_SIZE = 460;

/** The width axis travels from condensed to wide while the words keep their measure. */
const HEAD_STRETCH = [88, 148] as const;
const HERO_STRETCH = 112;

/**
 * Measures how wide one line of a display word is per pixel of type size, off to the side so no
 * container can wrap or clip it.
 */
function widthPerPixel(text: string, stretch: number, className: string): number {
  const probe = document.createElement('span');
  probe.className = className;
  probe.textContent = text;
  probe.style.cssText =
    'position:fixed;left:-9999px;top:0;white-space:nowrap;visibility:hidden;font-size:100px';
  probe.style.fontStretch = `${stretch}%`;
  document.body.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width / 100;
}

/** The layout viewport, which mobile emulation reports apart from window.innerWidth. */
function viewportWidth(): number {
  return document.documentElement.clientWidth;
}

function fitSize(text: string, stretch: number, className: string): number {
  const perPixel = widthPerPixel(text, stretch, className);
  if (perPixel <= 0) return MIN_SIZE;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, (viewportWidth() * TARGET_SHARE) / perPixel));
}

function useFittedSizes(
  text: string,
  stretches: readonly number[],
  className: string,
): number[] | null {
  const [sizes, setSizes] = useState<number[] | null>(null);
  const key = stretches.join(',');

  useEffect(() => {
    const fit = (): void => {
      setSizes(stretches.map((stretch) => fitSize(text, stretch, className)));
    };
    fit();
    window.addEventListener('resize', fit);
    void document.fonts.ready.then(fit);
    // the layout viewport can settle after the first paint, so the fit follows it
    const observer = new ResizeObserver(fit);
    observer.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', fit);
      observer.disconnect();
    };
    // the stretch values are compared through their joined key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, key, className]);

  return sizes;
}

/** The hero title sets each word on its own line, so every word reads at display size. */
export function HeroTitle(props: { children: string }): JSX.Element {
  const words = props.children.split(' ');
  const longest = words.reduce((best, word) => (word.length > best.length ? word : best), '');
  const sizes = useFittedSizes(longest, [HERO_STRETCH], 'display hero-title');
  const size = sizes?.[0];

  return (
    <h1
      className="display hero-title"
      style={
        size === undefined
          ? undefined
          : { fontSize: `${size.toFixed(1)}px`, fontStretch: `${HERO_STRETCH}%` }
      }
    >
      {words.map((word) => (
        <span key={word}>{word}</span>
      ))}
    </h1>
  );
}

/**
 * As a section head travels from the bottom of the viewport to its upper third its words widen
 * from condensed to wide, tied to scroll and reversible; with reduced motion they sit wide.
 */
export function SectionHead(props: { children: string }): JSX.Element {
  const ref = useRef<HTMLHeadingElement | null>(null);
  const reduced = useReducedMotion();
  const sizes = useFittedSizes(props.children, HEAD_STRETCH, 'display section-head');
  const [progress, setProgress] = useState(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      setProgress(1);
      return;
    }
    const element = ref.current;
    if (element === null) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const bounds = element.getBoundingClientRect();
      const from = window.innerHeight;
      const to = window.innerHeight / 3;
      setProgress(Math.max(0, Math.min(1, (from - bounds.top) / Math.max(1, from - to))));
    };
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    measure();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [reduced]);

  const eased = reduced ? 1 : progress;
  const stretch = HEAD_STRETCH[0] + eased * (HEAD_STRETCH[1] - HEAD_STRETCH[0]);
  const condensed = sizes?.[0];
  const wide = sizes?.[1];
  const size =
    condensed === undefined || wide === undefined ? undefined : condensed + eased * (wide - condensed);

  return (
    <h2
      className="display section-head"
      ref={ref}
      data-head-progress={progress.toFixed(2)}
      style={
        size === undefined
          ? { fontStretch: `${stretch.toFixed(0)}%` }
          : { fontSize: `${size.toFixed(1)}px`, fontStretch: `${stretch.toFixed(0)}%` }
      }
    >
      {props.children}
    </h2>
  );
}
