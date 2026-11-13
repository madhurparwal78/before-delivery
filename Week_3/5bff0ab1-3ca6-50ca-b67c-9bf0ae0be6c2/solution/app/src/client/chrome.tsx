import type { JSX } from "preact";
import { memo } from "preact/compat";
import { useState } from "preact/hooks";
import { Link, useRoute } from "./router.js";
import { session, signOut } from "./session.js";
import { stage } from "./stage.js";
import { useStore } from "./store.js";

/** One polite status region for the whole product; the status module writes into it and the markup never changes. */
export const StatusRegion = memo(function StatusRegion(): JSX.Element {
  return <div class="status" role="status" aria-live="polite" aria-label="Showroom status" />;
}, () => true);

export function Header(): JSX.Element {
  const user = useStore(session, (s) => s.user);
  const hub = useStore(stage, (s) => s.hub);
  const model = useStore(stage, (s) => s.model);
  const { path } = useRoute();
  const [open, setOpen] = useState(false);
  const here = (p: string): "page" | undefined => (path === p || (p === "/showroom" && path === "/") ? "page" : undefined);
  const close = (): void => setOpen(false);
  const testRide = path === "/" || path === "/showroom" ? `/test-ride?hub=${hub}&model=${model}` : "/test-ride";
  return (
    <>
      <div class="topbar" aria-hidden="true" />
      <header class="head">
        <Link class="wordmark" href="/">
          Malhar Motor Works
        </Link>
        <button class="menu-button" type="button" aria-expanded={open ? "true" : "false"} aria-controls="site-nav" onClick={() => setOpen(!open)}>
          Menu
        </button>
        <nav class="nav" id="site-nav" aria-label="Main" data-open={open ? "true" : "false"} onClick={close}>
          <Link href="/showroom" aria-current={here("/showroom")}>
            Showroom
          </Link>
          <Link href={testRide} aria-current={here("/test-ride")}>
            Test ride
          </Link>
          <Link href="/garage" aria-current={here("/garage")}>
            Garage
          </Link>
          {user?.role === "hub_host" ? (
            <Link href="/hub" aria-current={here("/hub")}>
              Hub console
            </Link>
          ) : null}
          {user ? (
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          ) : null}
        </nav>
      </header>
    </>
  );
}

export function NotFound(): JSX.Element {
  return (
    <main class="work">
      <h1 class="lede">We couldn't find that page.</h1>
      <div>
        <Link class="link-action" href="/showroom">
          Back to the showroom
        </Link>
      </div>
    </main>
  );
}
