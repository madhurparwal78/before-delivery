// Motion: reduced-motion detection, the state-change sequences with their visual toast, counting numerals, live row
// choreography and the delayed skeleton (brief: Motion and effects). Every timing here is the published one, nothing
// waits on an animation before acting, and reduced motion gives the end state at once with identical copy.
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export const SETTLE = "cubic-bezier(.2,.8,.2,1)";
export const SPRING = "cubic-bezier(.34,1.56,.64,1)";
export const QUARTER_MS = 240;
export const GLIDE_MS = 440;
const TOAST_MS = 4000;

const REDUCED = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED).matches);
  useEffect(() => {
    const list = window.matchMedia(REDUCED);
    const update = (): void => setReduced(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return reduced;
}

export const prefersReducedMotion = (): boolean => window.matchMedia(REDUCED).matches;

// ---- State-change sequences and the visual toast ----

type SequenceName = "slot-won" | "payment-captured" | "invoice-reconciled" | "visit-closed" | "dunning-cleared";

/** How long each published sequence plays (brief: Motion, State-change sequences). */
const SEQUENCE_MS: Record<SequenceName, number> = {
  "slot-won": 360,
  "payment-captured": 440,
  "invoice-reconciled": 440,
  "visit-closed": 440,
  "dunning-cleared": 480,
};

interface Toast {
  id: number;
  text: string;
}

/**
 * `copy` null plays the sequence without its own toast or announcement (several rows landing at once share one).
 * `background` marks a change no user action caused, which joins rather than replaces the last action's message.
 */
type Play = (name: SequenceName, target: HTMLElement | null, copy: string | null, background?: boolean) => void;

const SequenceContext = createContext<Play>(() => undefined);
export const useSequence = (): Play => useContext(SequenceContext);

/**
 * Marks the element with `data-anim` for exactly as long as its sequence plays (not at all under reduced motion)
 * and shows the visual toast. The toast's text is hidden from assistive technology: Notices, announced by the
 * caller, stays the only live region.
 */
export function SequenceProvider({ notify, children }: { notify: (text: string, background: boolean) => void; children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const serial = useRef(0);
  const play = useCallback<Play>(
    (name, target, copy, background = false) => {
      if (copy !== null) {
        notify(copy, background);
        serial.current += 1;
        setToast({ id: serial.current, text: copy });
      }
      if (!target || prefersReducedMotion()) return;
      target.setAttribute("data-anim", name);
      window.setTimeout(() => {
        if (target.getAttribute("data-anim") === name) target.removeAttribute("data-anim");
      }, SEQUENCE_MS[name]);
    },
    [notify],
  );
  return (
    <SequenceContext.Provider value={play}>
      {children}
      {toast ? <ToastCard key={toast.id} text={toast.text} onGone={() => setToast(null)} /> : null}
    </SequenceContext.Provider>
  );
}

/** Shows for 4000 ms, paused while the pointer rests on it or focus is on its button; gone means unmounted. */
function ToastCard({ text, onGone }: { text: string; onGone: () => void }) {
  const [paused, setPaused] = useState({ hover: false, focus: false });
  const left = useRef(TOAST_MS);
  const gone = useRef(onGone);
  gone.current = onGone;
  useEffect(() => {
    if (paused.hover || paused.focus) return;
    const started = performance.now();
    const timer = window.setTimeout(() => gone.current(), left.current);
    return () => {
      window.clearTimeout(timer);
      left.current -= performance.now() - started;
    };
  }, [paused.hover, paused.focus]);
  return (
    <div
      className="toast"
      onPointerEnter={() => setPaused((p) => ({ ...p, hover: true }))}
      onPointerLeave={() => setPaused((p) => ({ ...p, hover: false }))}
    >
      <svg className="toast-mark" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
        <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="toast-text" aria-hidden="true">
        {text}
      </p>
      <button
        type="button"
        className="toast-dismiss"
        aria-label="Dismiss notice"
        onFocus={() => setPaused((p) => ({ ...p, focus: true }))}
        onBlur={() => setPaused((p) => ({ ...p, focus: false }))}
        onClick={() => gone.current()}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

// ---- Counting numerals ----

/** Runs one tween on requestAnimationFrame, which the page clock drives; returns a cancel function. */
export function tween(from: number[], to: number[], ms: number, frame: (values: number[]) => void, done: () => void): () => void {
  let start: number | null = null;
  const easeOut = (t: number): number => 1 - (1 - t) ** 4;
  let handle = requestAnimationFrame(function step(now) {
    start ??= now;
    const t = Math.min(1, (now - start) / ms);
    const k = easeOut(t);
    frame(from.map((value, index) => value + ((to[index] ?? value) - value) * k));
    if (t < 1) handle = requestAnimationFrame(step);
    else done();
  });
  return () => cancelAnimationFrame(handle);
}

/**
 * A number that counts from its old value to its new one over 440 ms and lands exactly. The element's text is the
 * final value from the start; the in-between value is drawn by a generated overlay that is not part of the text.
 */
export function Count({ value, format, className }: { value: number; format: (value: number) => string; className?: string }) {
  const reduced = useReducedMotion();
  const last = useRef<number | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    const from = last.current;
    last.current = value;
    if (reduced || from === null || from === value) {
      setShown(null);
      return;
    }
    return tween([from], [value], GLIDE_MS, ([v]) => setShown(Math.round(v ?? value)), () => setShown(null));
  }, [value, reduced]);
  return (
    <span className={["n", "num", className].filter(Boolean).join(" ")} data-show={shown === null ? undefined : format(shown)}>
      {format(value)}
    </span>
  );
}

// ---- Live rows: enter, leave and glide in place ----

export interface LiveRow<T> {
  key: string;
  row: T;
  /** Index among the rows shown at first load (the staggered entrance), or null. */
  enterIndex: number | null;
  phase: "steady" | "new" | "leaving";
}

const LEAVE_MS = QUARTER_MS + 120;

/**
 * Keeps a table's rows in place as they change: the first six rows at first load rise in with a 40 ms stagger, a
 * new row fades in, a removed row fades over 240 ms and its space collapses over 120 ms, and a row that changes
 * position glides there (FLIP) over 240 ms.
 */
export function useLiveRows<T>(rows: readonly T[] | null, keyOf: (row: T) => string): { list: LiveRow<T>[]; ref: (key: string) => (el: HTMLElement | null) => void } {
  const [leaving, setLeaving] = useState<Map<string, { row: T; index: number }>>(new Map());
  const seen = useRef<Set<string> | null>(null);
  const firstKeys = useRef<string[]>([]);
  const previous = useRef<{ keys: string[]; rows: Map<string, T> }>({ keys: [], rows: new Map() });
  const elements = useRef(new Map<string, HTMLElement>());
  const tops = useRef(new Map<string, number>());

  if (rows && seen.current === null) {
    firstKeys.current = rows.map(keyOf).slice(0, 6);
    seen.current = new Set(rows.map(keyOf));
  }

  useEffect(() => {
    if (!rows) return;
    const keys = rows.map(keyOf);
    const gone = previous.current.keys.filter((key) => !keys.includes(key));
    if (gone.length && !prefersReducedMotion()) {
      setLeaving((current) => {
        const next = new Map(current);
        for (const key of gone) {
          const row = previous.current.rows.get(key);
          if (row !== undefined) next.set(key, { row, index: previous.current.keys.indexOf(key) });
        }
        return next;
      });
      window.setTimeout(() => {
        setLeaving((current) => {
          const next = new Map(current);
          for (const key of gone) next.delete(key);
          return next;
        });
      }, LEAVE_MS);
    }
    for (const key of keys) seen.current?.add(key);
    previous.current = { keys, rows: new Map(rows.map((row) => [keyOf(row), row])) };
  }, [rows, keyOf]);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    for (const [key, element] of elements.current) {
      const top = element.offsetTop;
      const before = tops.current.get(key);
      if (before !== undefined && Math.abs(before - top) > 1 && element.getAnimations().length === 0) {
        element.animate([{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }], { duration: QUARTER_MS, easing: SETTLE });
      }
      tops.current.set(key, top);
    }
  });

  const list: LiveRow<T>[] = (rows ?? []).map((row) => {
    const key = keyOf(row);
    const index = firstKeys.current.indexOf(key);
    const fresh = seen.current !== null && !seen.current.has(key) && previous.current.keys.length > 0;
    return { key, row, enterIndex: index >= 0 ? index : null, phase: fresh ? "new" : "steady" };
  });
  for (const [key, { row, index }] of leaving) {
    if (!list.some((entry) => entry.key === key)) list.splice(Math.min(index, list.length), 0, { key, row, enterIndex: null, phase: "leaving" });
  }
  const ref = useCallback(
    (key: string) => (element: HTMLElement | null) => {
      if (element) {
        if (!elements.current.has(key)) riseIn(element);
        elements.current.set(key, element);
      } else {
        elements.current.delete(key);
        tops.current.delete(key);
      }
    },
    [],
  );
  return { list, ref };
}

/** Row attributes for the entrance, a new row's fade and a leaving row's fade and collapse. */
export function rowMotion(entry: LiveRow<unknown>): { className?: string; "data-enter"?: string; "aria-hidden"?: true } {
  if (entry.phase === "leaving") return { className: "row-leaving", "aria-hidden": true };
  if (entry.phase === "new") return { className: "row-new" };
  if (entry.enterIndex !== null) return { "data-enter": String(entry.enterIndex) };
  return {};
}

/**
 * The page-change entrance of one of the first six rows: it rises 8 px and fades in over 240 ms, settling, 40 ms
 * after the row before it. Started through the Web Animations API the moment the row mounts.
 */
function riseIn(element: HTMLElement): void {
  const index = element.dataset.enter;
  if (index === undefined || prefersReducedMotion()) return;
  element.animate(
    [
      { opacity: 0, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: QUARTER_MS, delay: Number(index) * 40, easing: SETTLE, fill: "backwards" },
  );
}

// ---- Skeleton ----

/** True once a load has lasted more than 120 ms, so a quick load never flashes a skeleton. */
export function useSlowLoad(loading: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 120);
    return () => window.clearTimeout(timer);
  }, [loading]);
  return slow;
}
