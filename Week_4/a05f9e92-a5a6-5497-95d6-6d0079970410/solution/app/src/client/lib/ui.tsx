import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject } from "react";
import { ApiFailure } from "./api.js";
import { navigate } from "./router.js";

/** Shrinks a pinned name just enough that its longest word fits inside the padding, never below a readable size. */
function useFitSubject(ref: { current: HTMLElement | null }, text: string): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const fit = (): void => {
      element.style.fontSize = "";
      const style = getComputedStyle(element);
      const room = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;";
      probe.style.font = style.font;
      probe.style.textTransform = style.textTransform;
      probe.style.letterSpacing = style.letterSpacing;
      element.appendChild(probe);
      let widest = 0;
      for (const word of text.split(/\s+/)) {
        probe.textContent = word;
        widest = Math.max(widest, probe.getBoundingClientRect().width);
      }
      probe.remove();
      if (widest > room) element.style.fontSize = `${Math.max(20, Math.floor(parseFloat(style.fontSize) * (room / widest)))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    // The measure is only right in the real face: fit again whenever a face finishes loading.
    document.fonts.addEventListener("loadingdone", fit);
    return () => {
      window.removeEventListener("resize", fit);
      document.fonts.removeEventListener("loadingdone", fit);
    };
  }, [ref, text]);
}

/** One pinned subject over the orange field with a hard edge into the white working sections. */
export function Page({
  subject,
  children,
  wide = false,
  compact = false,
  headingRef,
}: {
  subject: string;
  children: ReactNode;
  wide?: boolean;
  compact?: boolean;
  /** Lets the screen move focus to its heading; the heading then accepts programmatic focus. */
  headingRef?: RefObject<HTMLHeadingElement>;
}): JSX.Element {
  const own = useRef<HTMLHeadingElement>(null);
  const heading = headingRef ?? own;
  useFitSubject(heading, subject);
  return (
    <main className={`page ${wide ? "page-wide" : ""}`}>
      <h1 ref={heading} tabIndex={headingRef ? -1 : undefined} className={`subject ${compact ? "subject-compact" : ""}`}>
        {subject}
      </h1>
      {children}
    </main>
  );
}

export function Rest({ children, narrow = false, label, className = "" }: { children: ReactNode; narrow?: boolean; label?: string; className?: string }): JSX.Element {
  return (
    <section className={`rest ${narrow ? "rest-narrow" : ""} ${className}`} aria-label={label}>
      {children}
    </section>
  );
}

export function Button({ variant = "solid", busy, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "solid" | "outline"; busy?: boolean }): JSX.Element {
  return <button type="button" {...rest} aria-busy={busy || undefined} className={`btn btn-${variant} ${rest.className ?? ""}`} />;
}

/** Status shown as a word inside a solid or outlined ink block, never as colour alone. */
export function StatusBlock({ children, outlined = false }: { children: ReactNode; outlined?: boolean }): JSX.Element {
  return <span className={`status-block ${outlined ? "status-outlined" : ""}`}>{children}</span>;
}

/** An empty, loading or error state: one pinned line in the display face plus one solid button. */
export function StateScreen({ line, button, onClick }: { line: string; button: string; onClick: () => void }): JSX.Element {
  return (
    <main className="page state-screen">
      <p className="state-line">{line}</p>
      <div className="state-action">
        <Button onClick={onClick}>{button}</Button>
      </div>
    </main>
  );
}

export type Loaded<T> = { status: "loading" } | { status: "error"; error: unknown } | { status: "ready"; data: T };

/** Loads data when the dependencies change; `reload` fetches again without showing the loading state. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { state: Loaded<T>; reload: () => void; setData: (data: T) => void } {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const generation = useRef(0);
  const loader = useRef(load);
  loader.current = load;
  const run = useCallback((silent: boolean) => {
    const mine = ++generation.current;
    if (!silent) setState({ status: "loading" });
    loader.current().then(
      (data) => mine === generation.current && setState({ status: "ready", data }),
      (error: unknown) => {
        if (mine !== generation.current) return;
        if (silent && state.status === "ready") return;
        setState({ status: "error", error });
      },
    );
  }, []);
  useEffect(() => {
    run(false);
    return () => {
      generation.current++;
    };
  }, deps);
  const reload = useCallback(() => run(true), [run]);
  const setData = useCallback((data: T) => setState({ status: "ready", data }), []);
  return { state, reload, setData };
}

/** The pinned loading or error line for a screen whose data is not ready yet; null once it is. */
export function loadingScreen<T>(state: Loaded<T>, subject: string, retry: () => void): JSX.Element | null {
  if (state.status === "ready") return null;
  if (state.status === "error") {
    if (state.error instanceof ApiFailure && state.error.status === 404) return <StateScreen line="That page isn't on the switchyard." button="Back to your desk" onClick={() => navigate("/desk")} />;
    return <StateScreen line="Switchyard could not load this. Try again." button="Try again" onClick={retry} />;
  }
  return <StateScreen line={`Loading ${subject}...`} button="Cancel" onClick={() => history.back()} />;
}

export function useViewport(): "phone" | "tablet" | "desktop" {
  const read = (): "phone" | "tablet" | "desktop" => (window.matchMedia("(min-width: 1024px)").matches ? "desktop" : window.matchMedia("(min-width: 768px)").matches ? "tablet" : "phone");
  const [size, setSize] = useState(read);
  useEffect(() => {
    const queries = [window.matchMedia("(min-width: 1024px)"), window.matchMedia("(min-width: 768px)")];
    const update = (): void => setSize(read());
    queries.forEach((q) => q.addEventListener("change", update));
    return () => queries.forEach((q) => q.removeEventListener("change", update));
  }, []);
  return size;
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Runs a Web Animation unless the person prefers reduced motion, which creates no animation at all. */
export function animate(element: Element | null, keyframes: Keyframe[] | PropertyIndexedKeyframes, duration: 180 | 420): Animation | null {
  if (!element || reducedMotion()) return null;
  return element.animate(keyframes, { duration, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)", fill: "none" });
}

export function Field({ label, children, error, id }: { label: string; children: ReactNode; error?: string; id?: string }): JSX.Element {
  return (
    <div className="field" data-field={id}>
      <label>
        <span className="field-label">{label}</span>
        {children}
      </label>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
