import { useEffect, useRef, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { CartDrawer } from "./CartDrawer";
import { Header } from "./Header";

/** Focus the new page's level 1 heading (checkout routes: the step heading) once it exists; never on first load. */
function useFocusOnNavigation(): void {
  const { pathname } = useLocation();
  const first = useRef(true);
  const previous = useRef(pathname);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    if (previous.current === pathname) return undefined;
    previous.current = pathname;
    const selector = pathname.startsWith("/checkout/") ? "main h2" : "main h1";
    const main = document.getElementById("main") as HTMLElement;
    const focus = (): boolean => {
      const target = main.querySelector<HTMLElement>(selector);
      if (!target) return false;
      target.tabIndex = -1;
      target.focus();
      return true;
    };
    if (focus()) return undefined;
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);
}

/** Pressing "/" outside a text field focuses the search box, whichever control has focus. */
function useSearchShortcut(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["TEXTAREA", "SELECT"].includes(target.tagName) || (target.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes((target as HTMLInputElement).type)))) return;
      event.preventDefault();
      document.getElementById("site-search")?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

export function Layout(): ReactNode {
  useFocusOnNavigation();
  useSearchShortcut();
  const auth = useAuth();
  // Who is visiting decides the header's rows: draw nothing until that is known, so nothing moves when it is.
  if (auth.status === "loading") return <div className="app" aria-busy="true" />;
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <main id="main">
        <Outlet />
      </main>
      <CartDrawer />
    </div>
  );
}
