import { useRouteLoaderData } from "react-router";
import { Icon } from "./icons.jsx";
import { ROLE_LABELS, initials } from "./words.js";

/**
 * Every screen's chrome: the fixed top bar with the brand mark, the breadcrumb and the signed-in person, the main
 * region, the quiet footer line and the two live regions with the toast that mirrors them.
 */
export function Page({ title, crumb, deskHref = "/requests", polite = "", children, layout = "" }) {
  const root = useRouteLoaderData("root");
  const caller = root?.caller;
  return (
    <>
      <title>{`${title} · Rostara`}</title>
      <header className="topbar">
        <span className="brand">Rostara</span>
        {crumb && (
          <nav className="crumbs" aria-label="Breadcrumb">
            <ol>
              <li>
                <a href={deskHref}>Desk</a>
              </li>
              <li aria-current="page">
                <Icon name="chevron-right" size={16} />
                <span>{crumb}</span>
              </li>
            </ol>
          </nav>
        )}
        {caller && (
          <div className="who">
            <span className="who-id">
              <span className="disc" aria-hidden="true">{initials(caller.name)}</span>
              <span className="who-lines">
                <span className="sr-only">{caller.name}</span>
                <span className="who-role">{ROLE_LABELS[caller.role]}</span>
              </span>
            </span>
            <button type="button" className="btn ghost-dark" data-signout>
              <Icon name="exit" />
              Sign out
            </button>
          </div>
        )}
      </header>
      <main id="main" className={layout}>
        {children}
      </main>
      <footer className="foot">
        Rostara attendance desk. Policy version <span data-footer-version>{root?.version}</span>.
      </footer>
      <div className="sr-only" role="status" data-polite>
        {polite}
      </div>
      <div className="sr-only" role="alert" data-assertive />
      <div className="toast" data-toast hidden>
        <Icon name="bell" />
        <p data-toast-text />
        <button type="button" className="icon-btn" aria-label="Dismiss" data-toast-dismiss>
          <Icon name="cross" />
        </button>
      </div>
    </>
  );
}

/** The shared month's own chrome: a banner holding only the brand mark, and its read-only footer line. */
export function SharedPage({ title, children }) {
  return (
    <>
      <title>{`${title} · Rostara`}</title>
      <header className="topbar">
        <span className="brand">Rostara</span>
      </header>
      <main id="main" className="shared">
        {children}
      </main>
      <footer className="foot">Rostara attendance desk. Shared read-only.</footer>
    </>
  );
}
