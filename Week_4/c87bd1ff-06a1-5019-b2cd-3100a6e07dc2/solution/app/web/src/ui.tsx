// Shared building blocks: header, banner, dialog, the Hammer Numeral and the time-left line.
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { boot, euros, isRunning, Lot, reducedMotion, secondsLeft, timeLeft } from "./lib";
import { live, SocketState } from "./live";

/** useTick re-renders its component once a second. */
export function useTick(): number {
  const [n, set] = useState(0);
  useLayoutEffect(() => {
    const timer = window.setInterval(() => set((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return n;
}

export function useSocketState(): SocketState {
  const [state, set] = useState<SocketState>(live.state);
  useLayoutEffect(() => {
    set(live.state);
    return live.onState(() => set(live.state));
  }, []);
  return state;
}

export function Header() {
  const here = window.location.pathname + window.location.search;
  return (
    <header class="site-header">
      <a class="wordmark" href="/">
        Gavelhouse
      </a>
      {boot.me ? (
        <form method="post" action="/auth/logout">
          <button type="submit" class="plain-btn">
            Sign out
          </button>
        </form>
      ) : (
        <a class="plain-btn" href={`/auth/login?next=${encodeURIComponent(here)}`}>
          Sign in
        </a>
      )}
    </header>
  );
}

export function ConnectionBanner() {
  const state = useSocketState();
  if (state !== "down") return null;
  return (
    <div role="alert" class="banner">
      <span>Live connection lost — reconnecting</span>{" "}
      <a
        href="#retry"
        class="gold-link"
        onClick={(e) => {
          e.preventDefault();
          live.retryNow();
        }}
      >
        Retry now
      </a>
    </div>
  );
}

export function Shell({ children }: { children: ComponentChildren }) {
  return (
    <>
      <Header />
      <ConnectionBanner />
      <div class="page">{children}</div>
    </>
  );
}

export function EmptyState({ line, children }: { line: string; children: ComponentChildren }) {
  return (
    <div class="empty">
      <p class="display">{line}</p>
      <p>{children}</p>
    </div>
  );
}

interface ModalProps {
  open: boolean;
  label: string;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
  children: ComponentChildren;
}

const FOCUSABLE = "button:not([aria-disabled='true']):not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]";

/** Modal is a native dialog that keeps Tab inside it, closes on Escape and gives focus back. */
export function Modal({ open, label, onClose, returnFocus, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={() => {
        onClose();
        (returnFocus?.() ?? opener.current)?.focus();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
    >
      {children}
    </dialog>
  );
}

/** Numeral draws the price one character at a time; only changed digits move, right to left. */
export function Numeral({ value }: { value: number }) {
  const text = euros(value);
  const root = useRef<HTMLSpanElement>(null);
  const before = useRef<{ text: string; value: number } | null>(null);
  const running = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const last = before.current;
    before.current = { text, value };
    if (!last || last.text === text || !root.current) return;
    for (const a of running.current) a.cancel();
    running.current = [];
    const cells = root.current.querySelectorAll<HTMLElement>(".strip");
    cells.forEach((s) => {
      delete s.dataset.old;
      delete s.dataset.dir;
    });
    if (reducedMotion()) return;
    const rising = value > last.value;
    const now = [...text];
    const old = [...last.text];
    let rank = 0;
    for (let k = 0; k < now.length; k++) {
      const i = now.length - 1 - k;
      const digit = now[i] ?? "";
      if (!/\d/.test(digit)) continue;
      const was = old[old.length - 1 - k] ?? "";
      if (was === digit) continue;
      const strip = root.current.querySelector<HTMLElement>(`.strip[data-i="${i}"]`);
      if (!strip) continue;
      strip.dataset.old = /\d/.test(was) ? was : " ";
      strip.dataset.dir = rising ? "up" : "down";
      const frames = rising
        ? [{ transform: "translateY(0)" }, { transform: "translateY(-50%)" }]
        : [{ transform: "translateY(-50%)" }, { transform: "translateY(0)" }];
      const animation = strip.animate(frames, { duration: 560, delay: 25 * rank, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });
      const done = () => {
        delete strip.dataset.old;
        delete strip.dataset.dir;
      };
      animation.onfinish = done;
      animation.oncancel = done;
      running.current.push(animation);
      rank++;
    }
  }, [text]);
  return (
    <span class="numeral" ref={root}>
      {[...text].map((ch, i) =>
        /\d/.test(ch) ? (
          <span class="cell digit" key={i}>
            <span class="strip" data-i={i}>
              {ch}
            </span>
          </span>
        ) : (
          <span class={ch === "," ? "cell comma" : "cell euro"} key={i}>
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

/** TimeLeft counts down from the server's remaining seconds and counts up when an extension arrives. */
export function TimeLeft({ lot }: { lot: Lot }) {
  useTick();
  const [tween, setTween] = useState<number | null>(null);
  const shown = useRef(secondsLeft(lot));
  const arrived = useRef(lot.at);
  const frame = useRef(0);
  useLayoutEffect(() => {
    if (lot.at === arrived.current) return;
    arrived.current = lot.at;
    const from = shown.current;
    const to = secondsLeft(lot);
    if (!isRunning(lot) || to <= from + 1 || reducedMotion()) return;
    window.cancelAnimationFrame(frame.current);
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / 330);
      setTween(Math.round(from + (to - from) * (1 - (1 - t) * (1 - t))));
      if (t < 1) frame.current = window.requestAnimationFrame(step);
      else setTween(null);
    };
    frame.current = window.requestAnimationFrame(step);
  }, [lot.at]);
  useLayoutEffect(() => () => window.cancelAnimationFrame(frame.current), []);
  const left = tween ?? secondsLeft(lot);
  shown.current = left;
  let text: string;
  if (lot.status === "closed_sold") text = `Sold for ${euros(lot.price)}`;
  else if (lot.status === "closed_unsold") text = "Closed unsold";
  else if (left <= 0) text = "Closing…";
  else text = `Closes in ${timeLeft(left)}`;
  return (
    <p class="time-left" role="timer" aria-label="Time left">
      {text}
    </p>
  );
}

/** captionFor is the one-line tile caption for a catalogue lot. */
export function captionFor(lot: Lot): string {
  const n = lot.lot_number;
  if (lot.status === "closed_sold") return `Lot ${n} · Sold ${euros(lot.price)}`;
  if (lot.status === "closed_unsold") return `Lot ${n} · Unsold`;
  const left = secondsLeft(lot);
  const price = lot.price ?? lot.opening_bid;
  return `Lot ${n} · ${euros(price)} · ${left <= 0 ? "Closing…" : `Closes in ${timeLeft(left)}`}`;
}
