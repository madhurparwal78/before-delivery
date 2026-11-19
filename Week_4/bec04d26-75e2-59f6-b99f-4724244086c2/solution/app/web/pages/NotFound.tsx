import { NOT_FOUND_HEADING, NOT_FOUND_TEXT } from "../copy";
import { Link } from "../router";
import { useApp } from "../store";
import { homeFor } from "../session";

export function NotFound() {
  const me = useApp((s) => s.me);
  return (
    <main className="auth">
      <p className="wordmark brand">Duefield</p>
      <div className="panel">
        <div className="tile tone-sage empty-tile" aria-hidden="true" />
        <h1>{NOT_FOUND_HEADING}</h1>
        <p>{NOT_FOUND_TEXT}</p>
        <p><Link href={me ? homeFor(me) : "/sign-in"}>{me ? "Back to your home screen" : "Sign in"}</Link></p>
      </div>
    </main>
  );
}
