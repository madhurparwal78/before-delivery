import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ApiFailure, fetchMe, send, type Me } from "./api";
import { Link, navigate } from "./router";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute("hidden") && el.offsetParent !== null);
}

/** True while a modal dialog is open; editor shortcuts are suspended then. */
function dialogOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

interface DialogProps {
  title: string;
  role?: "dialog" | "alertdialog";
  /** Called on Escape; omit to make the dialog ignore Escape (the conflict dialog). */
  onEscape?: () => void;
  initialFocus?: string;
  className?: string;
  children: ReactNode;
}

/** A modal dialog: Tab and Shift+Tab stay inside, Escape closes, focus returns to what was focused before it opened. */
export function Dialog({ title, role = "dialog", onEscape, initialFocus, className = "", children }: DialogProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = `dialog-title-${title.replace(/\W+/g, "-")}`;
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = ref.current as HTMLDivElement;
    const first = (initialFocus ? root.querySelector<HTMLElement>(initialFocus) : null) ?? focusables(root)[0] ?? root;
    first.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, [initialFocus]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (escape.current) {
        event.preventDefault();
        escape.current();
      }
    } else if (event.key === "Tab") {
      const items = focusables(ref.current as HTMLElement);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const edge = event.shiftKey ? items[0] : items[items.length - 1];
      if (active === edge || !(ref.current as HTMLElement).contains(active)) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    }
  };
  return createPortal(
    <div className="scrim">
      <div ref={ref} className={`dialog dock ${className}`} role={role} aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="dock-head">
          <h2 id={titleId} className="dock-title">
            {title}
          </h2>
        </div>
        <div className="dock-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

interface MenuProps {
  anchor: RefObject<HTMLElement>;
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** A menu anchored to a chip and rendered through a portal so a scrolling toolbar cannot clip it. */
export function Menu({ anchor, label, onClose, children }: MenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const rect = (anchor.current as HTMLElement).getBoundingClientRect();
    setPosition({ left: Math.max(4, Math.min(rect.left, window.innerWidth - 240)), top: rect.bottom + 4 });
  }, [anchor]);
  useEffect(() => {
    if (!position) return;
    const items = (ref.current as HTMLElement).querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])');
    const checked = [...items].find((i) => i.getAttribute("aria-checked") === "true");
    (checked ?? items[0])?.focus();
    const outside = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (!(ref.current as HTMLElement).contains(target) && !anchor.current?.contains(target)) onClose();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [position, anchor, onClose]);
  const close = useCallback(() => {
    onClose();
    anchor.current?.focus();
  }, [onClose, anchor]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = [...(ref.current as HTMLElement).querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Tab") {
      onClose();
    }
  };
  return createPortal(
    <div ref={ref} className="menu" role="menu" aria-label={label} style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }} onKeyDown={onKeyDown}>
      {children}
    </div>,
    document.body,
  );
}

export type GlyphName = "eye" | "eye-off" | "lock" | "unlock" | "maximise" | "close" | "caret" | "ramp" | "pendulum" | "launcher" | "crate" | "model" | "plus" | "chevron" | "folder" | "image";

const PATHS: Record<GlyphName, ReactNode> = {
  eye: (
    <>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z" />
      <path d="M2.5 13.5 13.5 2.5" />
    </>
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  unlock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 4.6-1.4" />
    </>
  ),
  maximise: <rect x="3" y="3" width="10" height="10" rx="1" />,
  close: <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" />,
  caret: <path d="M4 6.5 8 10.5 12 6.5" />,
  ramp: <path d="M2 13 14 13 14 4Z" />,
  pendulum: (
    <>
      <path d="M8 2V8.5" />
      <circle cx="8" cy="11" r="2.5" />
    </>
  ),
  launcher: (
    <>
      <path d="M3 12 10 5" />
      <path d="M2.5 14h5" />
      <circle cx="13" cy="3.5" r="1.3" />
    </>
  ),
  crate: <rect x="3" y="3" width="10" height="10" />,
  model: <path d="M8 2 13.5 5v6L8 14 2.5 11V5L8 2Zm0 6 5.5-3M8 8 2.5 5M8 8v6" />,
  plus: <path d="M8 3v10M3 8h10" />,
  chevron: <path d="M6 3.5 10.5 8 6 12.5" />,
  folder: <path d="M2 4.5h4l1.5 1.5H14v6.5H2Z" />,
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="m3 11 3-3 2.5 2.5L11 8l2 3" />
    </>
  ),
};

export function Glyph({ name, size = 14 }: { name: GlyphName; size?: number }): JSX.Element {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}

export function useMe(quiet = false): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let live = true;
    fetchMe(quiet).then(
      (value) => live && setMe(value),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [quiet]);
  return me;
}

/** The account and workspace pill with its menu (workspace switcher, New workspace, Sign out). */
export function AccountPill({ me, workspaceId, roving = false }: { me: Me; workspaceId: string | null; roving?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const current = me.workspaces.find((w) => w.id === workspaceId);
  const close = useCallback(() => setOpen(false), []);
  const signOut = async (): Promise<void> => {
    close();
    await send("POST", "/api/auth/sign-out").catch(() => undefined);
    navigate("/");
  };
  return (
    <>
      <button ref={anchor} type="button" data-tool={roving ? "" : undefined} className="chip account" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {/* The brief names this control `button "Account"`. The name comes from content, not aria-label, and the
            name and workspace it shows are left out of it, so no aria-label contradicts the visible text (WCAG 2.5.3). */}
        <span className="sr-only">Account</span>
        <span className="avatar" aria-hidden="true">
          {me.user.displayName.slice(0, 1).toUpperCase()}
        </span>
        <b aria-hidden="true">{me.user.displayName}</b>
        {current ? <span className="muted" aria-hidden="true">{current.name}</span> : null}
        <Glyph name="caret" size={12} />
      </button>
      {open ? (
        <Menu anchor={anchor} label="Account" onClose={close}>
          {me.workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitemradio"
              aria-checked={w.id === workspaceId}
              className="menu-item"
              onClick={() => {
                close();
                navigate(`/w/${w.id}`);
              }}
            >
              {w.name}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              close();
              navigate("/workspaces/new");
            }}
          >
            New workspace
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => void signOut()}>
            Sign out
          </button>
        </Menu>
      ) : null}
    </>
  );
}

/** The slim top bar of the working screens (project list, settings, activity, sign-in and so on). */
function WorkToolbar({ me, workspaceId }: { me: Me | null; workspaceId: string | null }): JSX.Element {
  return (
    <header className="toolbar work-toolbar">
      <Link href={workspaceId ? `/w/${workspaceId}` : "/"} className="chip tool-link">
        Projects
      </Link>
      <span className="spacer" />
      {me ? <AccountPill me={me} workspaceId={workspaceId} /> : null}
      <span className="wordmark">Rampwright</span>
    </header>
  );
}

export function Screen({ me, workspaceId, children }: { me: Me | null; workspaceId: string | null; children: ReactNode }): JSX.Element {
  return (
    <div className="screen">
      <WorkToolbar me={me} workspaceId={workspaceId} />
      <main className="screen-main">{children}</main>
    </div>
  );
}

/** A dock-styled panel on the plain ground. */
export function DockPanel({ title, actions, children, label }: { title: string; actions?: ReactNode; children: ReactNode; label?: string }): JSX.Element {
  return (
    <section className="dock page-dock" aria-label={label ?? title}>
      <div className="dock-head">
        <h1 className="dock-title">{title}</h1>
        <div className="dock-actions">{actions}</div>
      </div>
      <div className="dock-body">{children}</div>
    </section>
  );
}

export const Muted = ({ children }: { children: ReactNode }): JSX.Element => <p className="empty-line">{children}</p>;

function errorFields(error: unknown): Record<string, string> {
  return error instanceof ApiFailure ? error.fields : {};
}

export function formatLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
