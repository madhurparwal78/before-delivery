import { useCallback, useEffect, useRef, useState } from "react";
import { SITE_NAME, type Route } from "../shared/routes";
import { focusClear } from "./focus";
import { ModalDialog } from "./dialog";
import { prefersReducedMotion } from "./motion";
import { Link } from "./router";

const MAIN_LINKS = [
  { name: "Work", href: "/work" },
  { name: "Services", href: "/services" },
  { name: "Studio", href: "/studio" },
  { name: "Pricing", href: "/pricing" },
  { name: "Contact", href: "/contact" },
];

const FOOTER_LINKS = [...MAIN_LINKS.slice(0, 4), { name: "Questions", href: "/faq" }, ...MAIN_LINKS.slice(4)];

const SOCIAL_LINKS = [
  { name: "Instagram", href: "https://instagram.example/vellumorbit" },
  { name: "Behance", href: "https://behance.example/vellumorbit" },
  { name: "LinkedIn", href: "https://linkedin.example/company/vellumorbit" },
];

/** The header link of the section the route belongs to. */
function currentLink(route: Route): string | null {
  switch (route.name) {
    case "work":
    case "case-study":
      return "/work";
    case "services":
      return "/services";
    case "studio":
      return "/studio";
    case "pricing":
      return "/pricing";
    case "contact":
      return "/contact";
    default:
      return null;
  }
}

export function SkipLink() {
  return (
    <a
      className="skip-link"
      href="#main"
      onClick={(event) => {
        event.preventDefault();
        focusClear(document.querySelector<HTMLElement>("h1"));
      }}
    >
      Skip to content
    </a>
  );
}

const SLIDE_MS = 200;
/** The panel starts this far above its place, so its controls are reachable at every frame of the slide. */
const SLIDE_PX = 24;

function Menu({ route }: { route: Route }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  const finish = useCallback(() => {
    closing.current = false;
    setOpen(false);
    button.current?.focus({ preventScroll: true });
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (prefersReducedMotion() || !panel.current) return finish();
    panel.current.animate([{ transform: "translateY(0)" }, { transform: `translateY(-${SLIDE_PX}px)` }], { duration: SLIDE_MS, easing: "ease-in" }).finished.then(finish, finish);
  }, [finish]);

  useEffect(() => {
    if (open && !prefersReducedMotion()) panel.current?.animate([{ transform: `translateY(-${SLIDE_PX}px)` }, { transform: "translateY(0)" }], { duration: SLIDE_MS, easing: "ease-out" });
  }, [open]);

  const initialFocus = useCallback((dialog: HTMLDialogElement) => dialog.querySelector<HTMLElement>("nav a"), []);
  const current = currentLink(route);

  return (
    <>
      <button ref={button} type="button" className="menu-button" aria-expanded={open} onClick={() => setOpen(true)}>
        Menu
      </button>
      {open && (
        <ModalDialog label="Menu" className="menu-dialog" onClose={close} initialFocus={initialFocus}>
          <div className="menu-panel" ref={panel}>
            <div className="menu-bar">
              <span className="menu-title" aria-hidden="true">{SITE_NAME}</span>
              <button type="button" className="button button--quiet" onClick={close}>Close menu</button>
            </div>
            <nav aria-label="Menu sections">
              <ul className="menu-links">
                {MAIN_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} aria-current={current === link.href ? "page" : undefined} onClick={() => { closing.current = false; setOpen(false); }}>
                      {link.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </ModalDialog>
      )}
    </>
  );
}

export function SiteHeader({ route }: { route: Route }) {
  const current = currentLink(route);
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label={`${SITE_NAME} home`}>{SITE_NAME}</Link>
      <nav className="main-nav" aria-label="Main">
        <ul>
          {MAIN_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} aria-current={current === link.href ? "page" : undefined}>{link.name}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <Menu route={route} />
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <p className="footer-notice">{SITE_NAME} is a fictional studio. Every client, person, price and contact detail on this site is illustrative.</p>
        <nav aria-label="Footer">
          <ul>
            {FOOTER_LINKS.map((link) => (
              <li key={link.href}><Link href={link.href}>{link.name}</Link></li>
            ))}
          </ul>
        </nav>
        <div className="footer-contact">
          <h2>Illustrative contact</h2>
          <ul>
            <li><a href="mailto:hello@vellumorbit.example">hello@vellumorbit.example</a></li>
            <li><a href="tel:+914845550142">+91 484 555 0142</a></li>
            <li><span>Kochi, Kerala</span></li>
          </ul>
        </div>
        <nav aria-label="Social (illustrative)">
          <ul>
            {SOCIAL_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} target="_blank" rel="noopener noreferrer">
                  {link.name}<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="footer-legal">© 2026 {SITE_NAME}</p>
    </footer>
  );
}
