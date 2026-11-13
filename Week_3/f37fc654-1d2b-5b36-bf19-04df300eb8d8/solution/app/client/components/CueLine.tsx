// The cue-line: a line laid out whole, then typed in place letter by letter (0.4 s + 0.04 s × i), each
// letter arriving violet and blurred, turning cyan, then settling white, with the guide cursor easing
// after the newest letter. Under reduced motion the line is whole and white at once.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { clock, useReducedMotion } from "../lib/motion";

const START = 0.4;
const STEP = 0.04;
const SETTLE = 0.6;

type LetterState = "hidden" | "violet" | "cyan" | "white";

function letterAt(age: number): LetterState {
  if (age < 0) return "hidden";
  if (age < 0.2) return "violet";
  if (age < 0.4) return "cyan";
  return "white";
}

function letterStyle(age: number): CSSProperties {
  if (age < 0) return { opacity: 0 };
  if (age >= SETTLE) return {};
  const blur = Math.max(0, 5 * (1 - age / 0.4));
  const color = age < 0.2 ? "#ffb8ec" : age < 0.4 ? "#a8e6ff" : `color-mix(in srgb, #a8e6ff ${Math.round((1 - (age - 0.4) / 0.2) * 100)}%, #ffffff)`;
  return {
    color: age < 0.1 ? "#c9a2f0" : color,
    filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
    textShadow: age >= 0.2 && age < SETTLE ? "0 0 12px rgba(168, 230, 255, 0.85)" : undefined,
  };
}

function GuideCursor() {
  return (
    <span className="guide-cursor" aria-hidden="true">
      <svg viewBox="0 0 24 28" width="24" height="28" className="guide-arrow">
        <path d="M2 2 L21 13 L12.5 15 L8.5 25 Z" fill="#2271e3" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span className="guide-tag-anchor"><span className="guide-tag">SPINDRIFT</span></span>
    </span>
  );
}

interface Props {
  text: string;
  as?: "h1" | "h2" | "p";
  className?: string;
  cursor?: boolean;
  onSettled?: () => void;
}

export function CueLine({ text, as = "h1", className, cursor = false, onSettled }: Props) {
  const reduced = useReducedMotion();
  const letters = Array.from(text);
  const end = START + STEP * (letters.length - 1) + SETTLE;
  const [elapsed, setElapsed] = useState(reduced ? Number.POSITIVE_INFINITY : 0);
  const started = useRef(clock());
  const settled = useRef(false);
  const box = useRef<HTMLElement>(null);
  const pointer = useRef<HTMLSpanElement>(null);
  const position = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (reduced) {
      setElapsed(Number.POSITIVE_INFINITY);
      return undefined;
    }
    let raf = 0;
    const tick = (): void => {
      const t = clock() - started.current;
      setElapsed(t);
      if (t < end + 0.6) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, end]);

  useEffect(() => {
    if (!settled.current && elapsed >= end) {
      settled.current = true;
      onSettled?.();
    }
  }, [elapsed, end, onSettled]);

  const typed = elapsed < START ? 0 : Math.min(letters.length, Math.floor((elapsed - START) / STEP + 1e-6) + 1);

  useLayoutEffect(() => {
    const el = box.current;
    const arrow = pointer.current;
    if (!el || !arrow) return;
    const spans = el.querySelectorAll<HTMLElement>("[data-letter]");
    const newest = spans[Math.max(0, (typed || 1) - 1)];
    const last = spans[spans.length - 1];
    const anchor = typed >= letters.length || elapsed >= end ? last : newest;
    if (!anchor) return;
    const target = { x: anchor.offsetLeft + anchor.offsetWidth + 4, y: anchor.offsetTop + anchor.offsetHeight * 0.18 };
    const done = typed >= letters.length;
    const current = position.current ?? { x: anchor.offsetLeft, y: target.y };
    const follow = reduced ? 1 : 0.22;
    const next = done && elapsed >= end - 0.1 ? target : { x: current.x + (target.x - current.x) * follow, y: current.y + (target.y - current.y) * follow };
    position.current = next;
    arrow.style.transform = `translate(${next.x.toFixed(1)}px, ${next.y.toFixed(1)}px)`;
    arrow.style.opacity = typed > 0 || reduced ? "1" : "0";
  });

  const Tag = as;
  return (
    <Tag ref={box as RefObject<HTMLHeadingElement & HTMLParagraphElement>} className={`cue-line ${className ?? ""}`} aria-label={text} data-typed={typed}>
      {letters.map((letter, i) => {
        // Shown exactly when counted in data-typed: at a schedule boundary float error can leave age a hair below 0.
        const age = i < typed ? Math.max(0, elapsed - (START + STEP * i)) : -1;
        return (
          <span key={i} aria-hidden="true" data-letter={letterAt(age)} style={letterStyle(age)}>
            {letter}
          </span>
        );
      })}
      {cursor && <span ref={pointer} className="guide-anchor" aria-hidden="true"><GuideCursor /></span>}
    </Tag>
  );
}
