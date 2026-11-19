import { Link, signInHref, useLocation } from "../router";
import { useSession } from "../session";

export function NotFound() {
  return (
    <div className="page narrow-page">
      <p className="empty-sentence">Nothing plays at this address.</p>
      <Link to="/gallery" className="button button-accent">
        Open the gallery
      </Link>
    </div>
  );
}

/** Shown in place of a screen the signed-in person's roles do not open, or to a signed-out visitor. */
export function Gate({ role }: { role: string }) {
  const { me } = useSession();
  const location = useLocation();
  if (!me) {
    return (
      <div className="page narrow-page">
        <p className="empty-sentence">Sign in to open this page.</p>
        <a className="button button-accent" href={signInHref(location.path + (location.search.toString() ? `?${location.search}` : ""))}>
          Sign in with Keycloak
        </a>
      </div>
    );
  }
  return (
    <div className="page narrow-page">
      <div className="banner">This page is for {role} accounts. You are signed in as {me.display_name}.</div>
    </div>
  );
}
