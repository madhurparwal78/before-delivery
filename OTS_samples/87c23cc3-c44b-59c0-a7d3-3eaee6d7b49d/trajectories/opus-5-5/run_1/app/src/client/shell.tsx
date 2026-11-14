import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "./api.js";
import { pageConfig } from "./config.js";
import { copy } from "./copy.js";
import { Dialog, Menu, PHONE_QUERY, useMedia, type MenuItem } from "./ui.js";

export interface Me {
  id: string;
  email: string;
  displayName: string;
}

let mePromise: Promise<Me | null> | null = null;
export function loadMe(): Promise<Me | null> {
  mePromise ??= pageConfig.signedIn ? api<{ user: Me }>("GET", "/api/me").then((r) => (r.ok ? r.data.user : null)) : Promise.resolve(null);
  return mePromise;
}

export function useMe(): { me: Me | null; loaded: boolean } {
  const [state, setState] = useState<{ me: Me | null; loaded: boolean }>({ me: null, loaded: false });
  useEffect(() => {
    void loadMe().then((me) => setState({ me, loaded: true }));
  }, []);
  return state;
}

function StatusStrip() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    const refresh = async () => {
      const result = await api<{ storage: "up" | "down"; mail: "up" | "down" }>("GET", "/api/status");
      if (result.ok) setMessage(copy.strip(result.data.storage === "up", result.data.mail === "up"));
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div class="status-strip" role="status" aria-label="Studio status">
      <span class="live-pill">Live</span>
      <span class="status-message">{message}</span>
    </div>
  );
}

const PRODUCT_ITEMS: MenuItem[] = [
  { label: "Text language", description: "Write entities, columns and links in Mortise.", href: "/#language" },
  { label: "Drawing links", description: "Drag between columns and get one line of text.", href: "/#links" },
  { label: "Import DDL", description: "Bring PostgreSQL or MySQL tables in with a report.", href: "/#import" },
  { label: "Sharing and versions", description: "Hand out links, take them back, keep numbered versions.", href: "/#sharing" },
];

const LEARN_ITEMS: MenuItem[] = [
  { label: "Keyboard guide", description: "Every shortcut in the editor and diagram.", href: "/#keyboard" },
  { label: "Sample editor", description: "Try the working editor on the landing page.", href: "/#sample" },
];

function NavMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <div class="nav-menu">
      <button
        type="button"
        class="nav-item"
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        ref={button}
        onClick={() => setOpen(!open)}
      >
        {label}
        <span class={`caret ${open ? "caret-open" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <Menu
          label={label}
          items={items}
          className="nav-dropdown"
          onClose={(refocus) => {
            setOpen(false);
            if (refocus) button.current?.focus();
          }}
        />
      )}
    </div>
  );
}

async function signOut(): Promise<void> {
  await api("DELETE", "/api/auth/session");
  location.assign("/");
}

function Nav() {
  const { me, loaded } = useMe();
  const phone = useMedia(PHONE_QUERY);
  const [sheet, setSheet] = useState(false);
  const end =
    loaded && me ? (
      <a class="nav-end" href="/projects">
        Your projects
      </a>
    ) : (
      <a class="nav-end" href="/signin">
        Sign in
      </a>
    );
  return (
    <nav class="nav" aria-label="Main">
      <a class="brand" href="/" aria-label="Joinery home">
        <span class="brand-tile" aria-hidden="true">
          J
        </span>
        <span class="brand-word">Joinery</span>
      </a>
      {phone ? (
        <button type="button" class="nav-item menu-button" onClick={() => setSheet(true)}>
          Menu
        </button>
      ) : (
        <>
          <div class="nav-menus">
            <NavMenu label="Product" items={PRODUCT_ITEMS} />
            <NavMenu label="Learn" items={LEARN_ITEMS} />
          </div>
          <div class="nav-ends">
            {loaded && me && (
              <button type="button" class="nav-item" onClick={() => void signOut()}>
                Sign out
              </button>
            )}
            {end}
          </div>
        </>
      )}
      {phone && sheet && (
        <Dialog label="Menu" onClose={() => setSheet(false)} className="sheet-full">
          <div class="sheet-group">
            <p class="sheet-heading">Product</p>
            {PRODUCT_ITEMS.map((item) => (
              <a class="sheet-link" href={item.href} key={item.label} onClick={() => setSheet(false)}>
                <span>{item.label}</span>
                <span class="menu-item-description">{item.description}</span>
              </a>
            ))}
          </div>
          <div class="sheet-group">
            <p class="sheet-heading">Learn</p>
            {LEARN_ITEMS.map((item) => (
              <a class="sheet-link" href={item.href} key={item.label} onClick={() => setSheet(false)}>
                <span>{item.label}</span>
                <span class="menu-item-description">{item.description}</span>
              </a>
            ))}
          </div>
          <div class="sheet-group">
            {end}
            {loaded && me && (
              <button type="button" class="button button-secondary" onClick={() => void signOut()}>
                Sign out
              </button>
            )}
            <button type="button" class="button button-secondary" onClick={() => setSheet(false)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
    </nav>
  );
}

export function Shell({ children, wide = false }: { children: ComponentChildren; wide?: boolean }) {
  return (
    <>
      <a class="skip-link" href="#main">
        Skip to content
      </a>
      <header class="top">
        <StatusStrip />
        <Nav />
      </header>
      <main id="main" tabIndex={-1} class={wide ? "main-wide" : "main"}>
        {children}
      </main>
    </>
  );
}

export function Footer() {
  return (
    <footer class="footer">
      <p>Joinery is made by Pinewick Labs. Every name in the samples is invented.</p>
    </footer>
  );
}
