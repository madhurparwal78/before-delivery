import type { ComponentChildren, JSX } from "preact";
import { createContext } from "preact";
import { useContext, useLayoutEffect, useRef } from "preact/hooks";
import { chairSvg } from "../../shared/dots.ts";
import { takeArrival } from "./router.tsx";

export interface DeskSession {
  deskId: string;
  name: string;
  email: string;
  /** Today's Turin date from the server: all a screen ever counts from. */
  today: string;
}

export const SessionContext = createContext<DeskSession | null>(null);

export function useSession(): DeskSession {
  return useContext(SessionContext) as DeskSession;
}

interface HeadingProps {
  text: string;
  /** The page title's text when it differs from the heading; ` — Semenza Desk` follows. */
  title?: string;
  /** False until the list the arrival restores into has loaded. */
  ready?: boolean;
  children?: ComponentChildren;
}

/**
 * A screen's level-one heading, its page title and its arrival: focus lands here after a link, and
 * after Back or a reload the reader's scroll position and the link just left come back once `ready`.
 */
export function Heading({ text, title, ready = true, children }: HeadingProps): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  document.title = `${title ?? text} — Semenza Desk`;
  useLayoutEffect(() => {
    if (!ready) return;
    const arrival = takeArrival();
    if (arrival.kind === "push") heading.current?.focus();
    if (arrival.kind === "pop" || arrival.kind === "load") {
      window.scrollTo({ top: arrival.scroll, behavior: "instant" });
      const back = arrival.returnTo ? document.querySelector<HTMLElement>(`[data-return="${CSS.escape(arrival.returnTo)}"]`) : null;
      if (back) back.focus({ preventScroll: true });
      else if (arrival.kind === "pop") heading.current?.focus({ preventScroll: true });
    }
  }, [ready]);
  return (
    <div class="screen-head">
      <h1 ref={heading} tabIndex={-1}>
        {text}
      </h1>
      {children}
    </div>
  );
}

/** The way back from any of a piece's six sub-screens. */
export function BackToPiece({ id }: { id: string }): JSX.Element {
  return (
    <a class="link-row back-link" href={`/pieces/${id}`} data-print="no">
      Back to the piece
    </a>
  );
}

/** The screen's main action: in the head from 768, a bar fixed to the bottom at 375. */
export function MainAction({ children, name = "Main action" }: { children: ComponentChildren; name?: string }): JSX.Element {
  return (
    <div class="main-action" role="toolbar" aria-label={name}>
      {children}
    </div>
  );
}

/** The one mint tile: the screen's main figure or claim. */
export function MintTile({ label, figure, size = "t-small", part, note }: { label: string; figure: string; size?: string; part?: string; note?: string | null }): JSX.Element {
  return (
    <section class={`tile tile--mint ${size}`} aria-label={label}>
      <span class="mint-label">{label}</span>
      <span class="mint-figure" data-part={part}>
        {figure}
      </span>
      {note ? <span class="mint-note">{note}</span> : null}
    </section>
  );
}

/** A tile saying a list is empty: the published sentence beside a small muted chair. */
export function Empty({ text }: { text: string }): JSX.Element {
  return (
    <div class="empty">
      <span class="empty-chair" dangerouslySetInnerHTML={{ __html: chairSvg("empty", { tone: "muted" }) }} />
      <p>{text}</p>
    </div>
  );
}

/** A loading tile the size of what it replaces. */
export function Loading({ size = "t-full", height = 240 }: { size?: string; height?: number }): JSX.Element {
  return (
    <div class={`tile tile--loading ${size}`} style={{ minHeight: `${height}px` }}>
      Loading…
    </div>
  );
}
