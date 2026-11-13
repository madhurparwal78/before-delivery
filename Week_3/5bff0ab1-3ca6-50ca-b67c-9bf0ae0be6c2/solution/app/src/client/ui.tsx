import type { ComponentChildren, JSX } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import { DIALOG_MS, EASING, STEP_MS } from "../shared/motion.js";

/** Enter and leave animations run through the Web Animations API so every timing carries the one published easing. They only fade, so a control never moves under a pointer that is already on its way to it. */
function play(el: Element, keyframes: Keyframe[], reverse = false): Animation {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frames = reduced ? keyframes.map((k) => ({ opacity: k.opacity })) : keyframes;
  return el.animate(reverse ? [...frames].reverse() : frames, { duration: reduced ? STEP_MS.dissolve : DIALOG_MS, easing: EASING, fill: "both" });
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert]") && !el.closest("[hidden]") && el.getClientRects().length > 0);
}

// --- layers: dialogs and sheets that stack, trap Tab and give focus back

const stack: HTMLElement[] = [];

function syncInert(): void {
  const page = document.getElementById("page");
  if (page) page.toggleAttribute("inert", stack.length > 0);
  stack.forEach((el, i) => el.toggleAttribute("inert", i < stack.length - 1));
}

type LayerProps = {
  open: boolean;
  label: string;
  onClose: () => void;
  sheet?: boolean;
  children: ComponentChildren;
  /** Where focus lands on opening; defaults to the first control inside. */
  initial?: string;
};

/** A modal layer: it traps Tab, closes on Escape, enters and leaves over the sheet duration and returns focus. */
export function Layer(props: LayerProps): JSX.Element | null {
  const target = typeof document === "undefined" ? null : document.getElementById("layers");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return target && mounted ? createPortal(<LayerBody {...props} />, target) : null;
}

function LayerBody({ open, label, onClose, sheet, children, initial }: LayerProps): JSX.Element | null {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
    } else if (mounted) {
      setLeaving(true);
    }
  }, [open]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!open || !el) return;
    opener.current = (document.activeElement as HTMLElement | null) ?? null;
    stack.push(el);
    syncInert();
    const first = (initial ? el.querySelector<HTMLElement>(initial) : null) ?? focusables(el)[0] ?? (el.querySelector<HTMLElement>(".dialog") as HTMLElement);
    first.focus();
    return () => {
      const at = stack.indexOf(el);
      if (at >= 0) stack.splice(at, 1);
      syncInert();
      const back = opener.current;
      if (back && back.isConnected) back.focus();
    };
  }, [open, mounted]);

  useEffect(() => {
    const el = root.current;
    if (!el || !open) return;
    play(el, [{ opacity: 0 }, { opacity: 1 }]);
  }, [open, mounted]);

  useEffect(() => {
    const el = root.current;
    if (!leaving || !el) return;
    const out = play(el, [{ opacity: 0 }, { opacity: 1 }], true);
    const done = (): void => setMounted(false);
    out.finished.then(done, done);
    const guard = setTimeout(done, 900);
    return () => clearTimeout(guard);
  }, [leaving]);

  if (!mounted) return null;

  const onKey = (event: KeyboardEvent): void => {
    const el = root.current;
    if (!el || stack[stack.length - 1] !== el) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Tab") {
      const items = focusables(el);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !el.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <div
      ref={root}
      class={`layer${sheet ? " sheet" : ""}${leaving ? " leaving" : ""}`}
      onKeyDown={onKey}
    >
      <div class="dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

// --- radio group, select

export function Choice<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: readonly { id: T; name: string }[]; onChange: (v: T) => void; disabled?: boolean }): JSX.Element {
  const group = useRef(`g${label.replace(/\W/g, "")}`);
  return (
    <div class="choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.id}>
          <input type="radio" name={group.current} value={o.id} checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} />
          <span>{o.name}</span>
        </label>
      ))}
    </div>
  );
}

export function Pick<T extends string>({ label, value, options, onChange, visible }: { label: string; value: T; options: readonly { id: T; name: string }[]; onChange: (v: T) => void; visible?: boolean }): JSX.Element {
  return (
    <label class={visible ? "field-label" : ""}>
      {visible ? <span>{label}</span> : null}
      <span class="select">
        <select aria-label={visible ? undefined : label} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as T)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

// --- a grid of cells with one tab stop

type Cell = { key: string; label: string; disabled?: boolean; selected?: boolean; className?: string };

function useColumns(): number {
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = (): void => setCols(query.matches ? 2 : 4);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return cols;
}

export function CellGrid({ label, cells, onChoose, className }: { label: string; cells: Cell[]; onChoose: (key: string) => void; className?: string }): JSX.Element {
  const cols = useColumns();
  const refs = useRef(new Map<string, HTMLElement>());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const keys = cells.map((c) => c.key);
  const roving = focusKey && keys.includes(focusKey) ? focusKey : (cells.find((c) => c.selected)?.key ?? keys[0] ?? null);

  const move = (to: number): void => {
    const key = keys[Math.max(0, Math.min(keys.length - 1, to))];
    if (key === undefined) return;
    setFocusKey(key);
    refs.current.get(key)?.focus();
  };

  const onKey = (event: KeyboardEvent, index: number, cell: Cell): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? cols : event.key === "ArrowUp" ? -cols : 0;
    if (step !== 0) {
      event.preventDefault();
      move(index + step);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!cell.disabled) onChoose(cell.key);
    }
  };

  const rows: Cell[][] = [];
  for (let i = 0; i < cells.length; i += cols) rows.push(cells.slice(i, i + cols));

  return (
    <div class={`grid ${className ?? ""}`} role="grid" aria-label={label}>
      {rows.map((row, r) => (
        <div role="row" key={r}>
          {row.map((cell, c) => {
            const index = r * cols + c;
            return (
              <div
                key={cell.key}
                role="gridcell"
                class={`cell ${className ?? ""}${r % 2 === 1 ? " band-odd" : ""}`}
                tabIndex={roving === cell.key ? 0 : -1}
                aria-selected={cell.selected ? "true" : undefined}
                aria-disabled={cell.disabled ? "true" : undefined}
                ref={(el: HTMLDivElement | null) => {
                  if (el) refs.current.set(cell.key, el);
                  else refs.current.delete(cell.key);
                }}
                onFocus={() => setFocusKey(cell.key)}
                onClick={() => {
                  setFocusKey(cell.key);
                  if (!cell.disabled) onChoose(cell.key);
                }}
                onKeyDown={(e) => onKey(e, index, cell)}
              >
                {cell.label}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
