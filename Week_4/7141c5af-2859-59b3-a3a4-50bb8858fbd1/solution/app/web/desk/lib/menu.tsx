import type { JSX } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { glyph } from "../../shared/dots.ts";

const EDGE_PX = 8;
const GAP_PX = 4;

interface MenuEntry {
  label: string;
  /** Called with the trigger, which already has focus back. */
  onSelect: (trigger: HTMLElement) => void;
}

function bottomLimit(): number {
  const bar = document.querySelector<HTMLElement>(".main-action");
  const fixed = bar !== null && getComputedStyle(bar).position === "fixed";
  return (fixed ? bar.getBoundingClientRect().top : innerHeight) - EDGE_PX;
}

/** Placed in the viewport itself, so no frame, table end or bottom bar ever cuts an item (SR13). */
function place(menu: HTMLElement, trigger: HTMLElement): void {
  const box = trigger.getBoundingClientRect();
  const left = Math.max(EDGE_PX, Math.min(box.right - menu.offsetWidth, innerWidth - menu.offsetWidth - EDGE_PX));
  const below = box.bottom + GAP_PX;
  const top = below + menu.offsetHeight <= bottomLimit() ? below : Math.max(EDGE_PX, box.top - menu.offsetHeight - GAP_PX);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

interface ActionMenuProps {
  /** The trigger's accessible name; `visible` is what it prints and sits inside that name. */
  name: string;
  visible: string;
  items: readonly MenuEntry[];
}

export function ActionMenu({ name, visible, items }: ActionMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    place(menu.current, trigger.current);
    menu.current.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const reposition = (): void => {
      if (menu.current && trigger.current) place(menu.current, trigger.current);
    };
    const outside = (event: PointerEvent): void => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    addEventListener("scroll", reposition, true);
    addEventListener("resize", reposition);
    document.addEventListener("pointerdown", outside);
    return () => {
      removeEventListener("scroll", reposition, true);
      removeEventListener("resize", reposition);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  const close = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onKey = (event: KeyboardEvent): void => {
    const entries = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const step = (by: number): void => entries[(at + by + entries.length) % entries.length]?.focus();
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      entries[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      entries.at(-1)?.focus();
    } else if (event.key === "Tab") {
      event.preventDefault();
      close();
    }
  };

  return (
    <>
      <button ref={trigger} type="button" class="button" aria-label={name} aria-haspopup="menu" aria-expanded={open ? "true" : "false"} onClick={() => setOpen((was) => !was)}>
        {visible}
        <span dangerouslySetInnerHTML={{ __html: glyph("down", 16) }} />
      </button>
      {open
        ? createPortal(
            <div ref={menu} class="action-menu" role="menu" aria-label={name} onKeyDown={onKey}>
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  class="action-menu-item"
                  role="menuitem"
                  onClick={() => {
                    close();
                    item.onSelect(trigger.current as HTMLElement);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.getElementById("overlays") as HTMLElement,
          )
        : null}
    </>
  );
}
