import { useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "../shared/types.ts";
import { api, redirectTo } from "./api.ts";

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" focusable="false">
      <rect x="2" y="5" width="4" height="16" rx="1" fill="#d9700a" />
      <rect x="20" y="5" width="4" height="16" rx="1" fill="#d9700a" />
      <circle cx="9" cy="8" r="1.6" fill="#8a8a84" />
      <circle cx="13" cy="13" r="2.2" fill="#8a8a84" />
      <circle cx="9" cy="18" r="1.3" fill="#8a8a84" />
    </svg>
  );
}

export function WorkspaceHeader({ user, onSignOut }: { user: User | null; onSignOut?: () => void }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
        setPhoneMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const links = (
    <>
      <a href="#features">Features</a>
      <a href="#open-format">Open format</a>
      <a href="#limits">Limits</a>
      {user === null ? (
        <a href="/signin">Sign in</a>
      ) : (
        <>
          <a href="/notebooks">Your notebooks</a>
          <button
            className="button--plain"
            onClick={() => {
              void api.signout().then(() => {
                if (onSignOut !== undefined) onSignOut();
                else redirectTo("/");
              });
            }}
          >
            Sign out
          </button>
        </>
      )}
    </>
  );

  return (
    <header className="workspace-header" role="banner">
      <div className="workspace-header__inner" ref={containerRef}>
        <a className="brand-mark" href="/" aria-label="Brackenpad home">
          <BrandMark />
          <span className="brand-wordmark">Brackenpad</span>
        </a>
        <nav className="header-links" aria-label="Workspace">
          {links}
        </nav>
      </div>
    </header>
  );
}

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean };

export function HeaderMenu({ label, items, caret = false, id }: { label: string; items: MenuItem[]; caret?: boolean; id: string }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    setActiveIndex(0);
    buttonRef.current?.focus();
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        className="menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
        {caret ? <span className="caret" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div role="menu" className="menu" data-open="true" style={{ maxHeight: 400, position: "absolute", left: 0, top: "100%" }}>
          {items.map((item, index) => (
            <button
              key={item.label}
              role="menuitem"
              className="menu__item"
              disabled={item.disabled}
              data-active={index === activeIndex}
              onClick={() => {
                item.onSelect();
                close();
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex(Math.min(index + 1, items.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex(Math.max(index - 1, 0));
                }
              }}
              ref={(node) => {
                if (index === activeIndex) node?.focus();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {open ? (
        <button
          style={{ position: "fixed", inset: 0, zIndex: -1, background: "transparent", border: "none" }}
          aria-label="Close menu"
          onClick={close}
          tabIndex={-1}
        />
      ) : null}
    </div>
  );
}

export function Dialog({
  labelledBy,
  onClose,
  children,
  sheet = false,
  drawer = false,
  restoreFocusTo,
}: {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
  sheet?: boolean;
  drawer?: boolean;
  restoreFocusTo?: HTMLElement | null;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = restoreFocusTo ?? (document.activeElement as HTMLElement | null);
    const node = dialogRef.current;
    if (node !== null) {
      const focusable = node.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
      (focusable[0] ?? node).focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (onClose !== undefined) onClose();
        previousFocus?.focus();
        return;
      }
      if (event.key === "Tab") {
        const focusable = node?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
        if (focusable === undefined || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (restoreFocusTo !== undefined && restoreFocusTo !== null) restoreFocusTo.focus();
      else previousFocus?.focus();
    };
  }, [onClose, restoreFocusTo]);

  return (
    <div
      className={`dialog-backdrop${sheet ? " sheet-backdrop" : ""}${drawer ? " drawer-backdrop" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && onClose !== undefined) {
          onClose();
        }
      }}
    >
      <div
        className={`dialog${sheet ? " sheet" : ""}${drawer ? " drawer" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        ref={dialogRef}
      >
        {children}
      </div>
    </div>
  );
}
