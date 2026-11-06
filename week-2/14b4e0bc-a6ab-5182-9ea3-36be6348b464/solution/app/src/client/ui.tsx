import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { motion, reduced } from "./app-state.ts";
import { useStore, type Tag } from "./lib.ts";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => !e.closest("[inert]") && e.getClientRects().length > 0);
}

export function focusEl(el: Element | null | undefined): boolean {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  el.focus({ preventScroll: true });
  keepClearOfTopBar(el);
  return document.activeElement === el;
}

/** A focused control's whole box sits below the sticky top bar. */
function keepClearOfTopBar(el: Element): void {
  const bar = document.querySelector(".topbar");
  if (!bar || el.closest(".overlay")) return;
  const top = bar.getBoundingClientRect().bottom;
  const box = el.getBoundingClientRect();
  if (box.top < top) window.scrollBy({ top: box.top - top - 8, behavior: "instant" });
  else if (box.bottom > innerHeight) window.scrollBy({ top: Math.min(box.bottom - innerHeight + 8, box.top - top - 8), behavior: "instant" });
}

document.addEventListener("focusin", (event) => {
  if (event.target instanceof Element && event.target !== document.body) keepClearOfTopBar(event.target);
});

type Phase = "entering" | "open" | "leaving" | "closed";

const openOverlays = new Set<number>();
let overlayIds = 0;

function syncBackground(): void {
  const shell = document.getElementById("shell");
  const any = openOverlays.size > 0;
  if (shell) shell.inert = any;
  document.documentElement.classList.toggle("locked", any);
}

interface OverlayProps {
  open: boolean;
  /** dialog (centred), sheet (Filters) or rail (Lineage). */
  kind: "dialog" | "sheet" | "rail";
  label: string;
  onEscape(): void;
  /** Where focus lands when the overlay opens (or reopens during its exit). */
  initialFocus(root: HTMLElement): HTMLElement | null;
  attrs?: Record<string, string>;
  rootRef?: (el: HTMLElement | null) => void;
  children: ComponentChildren;
}

/**
 * Dialogs, the Filters sheet and the Lineage rail: above every layer, page behind inert and still,
 * Tab wrapping inside, `data-transition` entering → open → leaving, at once under reduced motion.
 */
export function Overlay(props: OverlayProps) {
  const motionValue = useStore(motion);
  const [phase, setPhase] = useState<Phase>("closed");
  const id = useRef(++overlayIds);
  const root = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const opening = useRef(false);

  useLayoutEffect(() => {
    window.clearTimeout(timer.current);
    if (props.open) {
      if (phase === "open" || phase === "entering") return;
      opening.current = true;
      if (reduced()) setPhase("open");
      else {
        setPhase("entering");
        timer.current = window.setTimeout(() => setPhase("open"), 250);
      }
    } else if (phase === "open" || phase === "entering") {
      if (reduced()) setPhase("closed");
      else {
        setPhase("leaving");
        timer.current = window.setTimeout(() => setPhase("closed"), 200);
      }
    }
  }, [props.open]);

  useLayoutEffect(() => {
    if (motionValue === "reduced") {
      window.clearTimeout(timer.current);
      if (phase === "entering") setPhase("open");
      if (phase === "leaving") setPhase("closed");
    }
  }, [motionValue, phase]);

  useLayoutEffect(() => {
    if (phase === "entering" || phase === "open") openOverlays.add(id.current);
    else openOverlays.delete(id.current);
    syncBackground();
    if (opening.current && root.current && (phase === "entering" || phase === "open")) {
      opening.current = false;
      focusEl(props.initialFocus(root.current));
    }
  }, [phase]);

  useLayoutEffect(() => () => {
    window.clearTimeout(timer.current);
    openOverlays.delete(id.current);
    syncBackground();
  }, []);

  if (phase === "closed") return null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onEscape();
      return;
    }
    if (event.key !== "Tab" || !root.current) return;
    const items = focusables(root.current);
    if (!items.length) return event.preventDefault();
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !root.current.contains(active))) {
      event.preventDefault();
      focusEl(last);
    } else if (!event.shiftKey && (active === last || !root.current.contains(active))) {
      event.preventDefault();
      focusEl(first);
    }
  };

  const common: Record<string, unknown> = {
    ref: (el: HTMLElement | null) => {
      root.current = el;
      props.rootRef?.(el);
    },
    "data-transition": phase,
    "aria-label": props.label,
    onKeyDown,
    inert: phase === "leaving",
    class: `panel panel-${props.kind}`,
    ...props.attrs,
  };

  const panel =
    props.kind === "rail" ? (
      <aside {...(common as JSX.HTMLAttributes<HTMLElement>)}>{props.children}</aside>
    ) : (
      <div role="dialog" aria-modal="true" {...(common as JSX.HTMLAttributes<HTMLDivElement>)}>{props.children}</div>
    );
  return createPortal(
    <div class={`overlay overlay-${props.kind}`} data-phase={phase}>
      <div class="backdrop" />
      {panel}
    </div>,
    document.getElementById("overlays")!,
  );
}

export function Glyph({ tag }: { tag: Tag }) {
  return (
    <span class={`glyph glyph-${tag === "PII" ? "pii" : "conf"}`} data-tag-glyph={tag} aria-hidden="true">
      {tag === "PII" ? "P" : "C"}
    </span>
  );
}

/** Tags in display order with their glyphs, so no tag relies on colour alone (DP-24). */
export function Glyphs({ tags }: { tags: readonly string[] }) {
  return (
    <span class="glyphs">
      {(["PII", "Confidential"] as Tag[]).filter((t) => tags.includes(t)).map((t) => <Glyph key={t} tag={t} />)}
    </span>
  );
}

/**
 * A dotted id with a break opportunity after each ".", so ids wrap at segment boundaries first.
 * Browsers read <wbr> as a space in accessible names, so the named element carries the id as its label.
 */
export function IdText({ id }: { id: string }) {
  const parts = id.split(".");
  return <>{parts.map((p, i) => (i < parts.length - 1 ? <span key={i}>{p}.<wbr /></span> : p))}</>;
}

/** Lucide icons (ISC): sliders-horizontal, git-branch, x, zoom-in, zoom-out, rotate-ccw, log-out, download. */
const ICONS = {
  sliders: "M10 5H3M12 19H3M14 3v4M16 17v4M21 12h-9M21 19h-5M21 5h-7M8 10v4M8 12H3",
  lineage: "M6 3v12M15 6a3 3 0 1 0 6 0 3 3 0 1 0-6 0M3 18a3 3 0 1 0 6 0 3 3 0 1 0-6 0M18 9a9 9 0 0 1-9 9",
  x: "M18 6 6 18M6 6l12 12",
  zoomIn: "M3 11a8 8 0 1 0 16 0 8 8 0 1 0-16 0M21 21l-4.35-4.35M11 8v6M8 11h6",
  zoomOut: "M3 11a8 8 0 1 0 16 0 8 8 0 1 0-16 0M21 21l-4.35-4.35M8 11h6",
  reset: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5",
  logout: "M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
  download: "M12 15V3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5",
};

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}
