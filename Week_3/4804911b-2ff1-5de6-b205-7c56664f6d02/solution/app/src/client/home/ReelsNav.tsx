import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../lib/icons";
import { useWide } from "../lib/hooks";

const REELS = [
  { name: "Now Showing", id: "now-showing" },
  { name: "The Pack", id: "the-pack" },
  { name: "The Lineup", id: "the-lineup" },
  { name: "Price Notices", id: "price-notices" },
  { name: "End Credits", id: "end-credits" },
] as const;

function jumpTo(id: string): void {
  const el = document.getElementById(id);
  if (el) window.scrollTo(0, Math.round(el.getBoundingClientRect().top + scrollY));
}

export function ReelsNav() {
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const wasWide = useRef(wide);
  const focusHere = useRef(false);

  // the control holding focus may be hidden or gone by the time the width change lands, so remember where focus last was
  useEffect(() => {
    const note = (e: FocusEvent) => {
      const el = e.target as Node;
      focusHere.current = el === button.current || !!panel.current?.contains(el);
    };
    document.addEventListener("focusin", note);
    return () => document.removeEventListener("focusin", note);
  }, []);

  useEffect(() => {
    if (wasWide.current === wide) return;
    wasWide.current = wide;
    setOpen(false);
    if (focusHere.current) requestAnimationFrame(() => (wide ? document.getElementById("nav-the-pack") : button.current)?.focus());
  }, [wide]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
      if (e.key !== "Tab") return;
      const ring = [button.current, ...Array.from(panel.current?.querySelectorAll<HTMLElement>("a") ?? [])].filter((x): x is HTMLElement => !!x);
      const at = ring.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      const next = e.shiftKey ? (at <= 0 ? ring.length - 1 : at - 1) : at < 0 || at === ring.length - 1 ? 0 : at + 1;
      ring[next]?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  const choose = (e: MouseEvent, id: string) => {
    e.preventDefault();
    jumpTo(id);
    if (!wide) {
      setOpen(false);
      button.current?.focus();
    }
  };

  return (
    <>
      {!wide && (
        <button ref={button} type="button" class="reels-button" aria-expanded={open ? "true" : "false"} aria-controls="reels-panel" onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "x" : "list"} />
          <span>Reels</span>
        </button>
      )}
      {!wide && open && <div class="reels-backdrop" onClick={() => { setOpen(false); button.current?.focus(); }} />}
      <nav ref={panel} id="reels-panel" class={`reels${wide ? " reels-wide" : ""}`} aria-label="Reels" hidden={!wide && !open}>
        {REELS.map((r) => (
          <a key={r.id} id={`nav-${r.id}`} href={`#${r.id}`} onClick={(e) => choose(e, r.id)}>
            {r.name}
          </a>
        ))}
      </nav>
    </>
  );
}
