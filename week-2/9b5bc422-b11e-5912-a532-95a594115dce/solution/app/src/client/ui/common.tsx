import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AnchorHTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { navigate } from "../store/router.ts";
import { useModal } from "./hooks.ts";

export function Link({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={follow} {...rest}>{children}</a>;
}

export const overlayRoot = (): HTMLElement => document.getElementById("overlays") as HTMLElement;

export function Dialog({ name, onClose, children, wide = false }: { name: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
  return createPortal(
    <div className="scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={name} tabIndex={-1} className={wide ? "dialog dialog-wide" : "dialog"}>
        <h2 className="dialog-title">{name}</h2>
        {children}
      </div>
    </div>,
    overlayRoot(),
  );
}

type MenuItem = { label: string; choose: () => void };

const MENU_WIDTH = 200;
const EDGE = 8;

/** A paper menu opened from a button; arrows wrap, Enter chooses, Escape closes. */
export function Menu({ label, opener, items, onClose }: { label: string; opener: HTMLElement; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const anchor = opener.getBoundingClientRect();
    const height = ref.current?.offsetHeight ?? 0;
    const below = anchor.bottom + EDGE + height < window.innerHeight;
    setPosition({
      left: Math.min(Math.max(EDGE, anchor.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - EDGE),
      top: below ? anchor.bottom + 4 : Math.max(EDGE, anchor.top - height - 4),
    });
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [opener]);
  useEffect(() => {
    const outside = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [onClose]);
  const finish = (choose?: () => void): void => {
    onClose();
    opener.focus();
    choose?.();
  };
  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const entries = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const here = entries.indexOf(document.activeElement as HTMLElement);
    const go = (index: number): void => entries[(index + entries.length) % entries.length]?.focus();
    if (event.key === "ArrowDown") go(here + 1);
    else if (event.key === "ArrowUp") go(here - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(entries.length - 1);
    else if (event.key === "Escape" || event.key === "Tab") finish();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return createPortal(
    <div ref={ref} role="menu" aria-label={label} className="menu" style={{ ...position, width: MENU_WIDTH }} onKeyDown={move}>
      {items.map((item) => (
        <button key={item.label} type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={() => finish(item.choose)}>
          {item.label}
        </button>
      ))}
    </div>,
    overlayRoot(),
  );
}

export function PaperStack() {
  return (
    <svg className="paper-stack" viewBox="0 0 120 96" aria-hidden="true">
      <path d="M26 22h62l10 10v52H26z" transform="rotate(-6 60 50)" className="paper-stack-back" />
      <path d="M22 14h66l12 12v58H22z" transform="rotate(3 60 50)" className="paper-stack-mid" />
      <path d="M20 12h66l14 14v58H20z" className="paper-stack-front" />
      <path d="M86 12v14h14" className="paper-stack-line" />
      <path d="M32 40h56M32 52h56M32 64h34" className="paper-stack-line" />
    </svg>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="empty"><PaperStack /><p>{text}</p></div>;
}

export function NotFound({ heading }: { heading: string }) {
  return (
    <div className="screen screen-narrow">
      <section className="paper not-found">
        <PaperStack />
        <h1>{heading}</h1>
        <Link href="/" className="button">Back to documents</Link>
      </section>
    </div>
  );
}
