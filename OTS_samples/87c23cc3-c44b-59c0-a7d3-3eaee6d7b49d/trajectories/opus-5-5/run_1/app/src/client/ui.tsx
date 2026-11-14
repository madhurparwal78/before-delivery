import type { ComponentChildren, JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el instanceof HTMLInputElement && el.type === "radio" && !el.checked) {
      const group = root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${el.name}"]`);
      if (Array.from(group).some((r) => r.checked)) return false;
    }
    return el.getClientRects().length > 0;
  });
}

/** Keeps Tab and Shift+Tab inside a container. Returns true when it handled the key. */
export function trapTab(event: KeyboardEvent, root: HTMLElement): boolean {
  if (event.key !== "Tab") return false;
  const items = focusables(root);
  if (items.length === 0) {
    event.preventDefault();
    return true;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    list.addEventListener("change", update);
    update();
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export const PHONE_QUERY = "(max-width: 767.98px)";

interface DialogProps {
  label: string;
  heading?: string;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  children: ComponentChildren;
  className?: string;
}

const openDialogs: HTMLElement[] = [];

/** A modal dialog: focus moves to its first field, Tab stays inside, Escape closes and focus returns to the opener. */
export function Dialog({ label, heading, role = "dialog", onClose, children, className }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useLayoutEffect(() => {
    const node = ref.current!;
    openDialogs.push(node);
    const field = node.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]):not([type="radio"]):not([type="file"]), textarea, select, input[type="radio"]:checked',
    );
    (field ?? focusables(node)[0] ?? node).focus();
    // Keys are handled at the document so a dialog keeps working after its focused control disables itself.
    const onKey = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== node) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      } else if (event.key === "Tab") {
        trapTab(event, node);
        event.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      openDialogs.splice(openDialogs.indexOf(node), 1);
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <div class="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
      <div class={`dialog ${className ?? ""}`} role={role} aria-modal="true" aria-label={label} ref={ref} tabIndex={-1}>
        <h2 class="dialog-title">{heading ?? label}</h2>
        {children}
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  description?: string;
  href?: string;
  checked?: boolean;
  onSelect?: () => void;
}

interface MenuProps {
  label: string;
  items: MenuItem[];
  radio?: boolean;
  onClose: (refocus: boolean) => void;
  className?: string;
}

/** A menu: Up and Down move, Enter or Space chooses, Escape closes, Tab stays inside. */
export function Menu({ label, items, radio = false, onClose, className }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current!;
    const entries = Array.from(node.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    const checked = entries.findIndex((e) => e.getAttribute("aria-checked") === "true");
    entries[Math.max(0, checked)]?.focus();
    const outside = (event: PointerEvent) => {
      if (!node.contains(event.target as Node) && !(node.parentElement?.contains(event.target as Node) ?? false)) onClose(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const move = (delta: number) => {
    const entries = Array.from(ref.current!.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    const index = entries.indexOf(document.activeElement as HTMLElement);
    entries[(index + delta + entries.length) % entries.length]?.focus();
  };
  const choose = (item: MenuItem, event: Event) => {
    if (item.href) return;
    event.preventDefault();
    item.onSelect?.();
    onClose(true);
  };
  const onKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === " " || event.key === "Enter") {
      const target = event.target as HTMLElement;
      if (target.tagName === "A") {
        if (event.key === " ") {
          event.preventDefault();
          target.click();
        }
        return;
      }
      event.preventDefault();
      target.click();
    }
  };
  return (
    <div class={`menu ${className ?? ""}`} role="menu" aria-label={label} ref={ref} onKeyDown={onKeyDown}>
      {items.map((item) =>
        item.href ? (
          <a role="menuitem" href={item.href} tabIndex={-1} class="menu-item" key={item.label}>
            <span class="menu-item-label">{item.label}</span>
            {item.description && <span class="menu-item-description">{item.description}</span>}
          </a>
        ) : (
          <button
            type="button"
            role={radio ? "menuitemradio" : "menuitem"}
            aria-checked={radio ? (item.checked ? "true" : "false") : undefined}
            tabIndex={-1}
            class="menu-item"
            key={item.label}
            onClick={(e) => choose(item, e as unknown as Event)}
          >
            <span class="menu-item-label">{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

export function Status({ label, text, className }: { label: string; text: string; className?: string }) {
  return (
    <div role="status" aria-label={label} class={className ?? "visually-hidden"}>
      {text}
    </div>
  );
}

/** Field errors from a 422 reply: an alert above the form linking to each field. */
export function FieldErrors({ fields, ids }: { fields: Record<string, string> | null; ids: Record<string, string> }) {
  if (!fields || Object.keys(fields).length === 0) return null;
  return (
    <div role="alert" class="form-errors">
      <p class="form-errors-title">Check these fields:</p>
      <ul>
        {Object.entries(fields).map(([field, message]) => (
          <li key={field}>
            <a
              href={`#${ids[field] ?? field}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(ids[field] ?? field)?.focus();
              }}
            >
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
