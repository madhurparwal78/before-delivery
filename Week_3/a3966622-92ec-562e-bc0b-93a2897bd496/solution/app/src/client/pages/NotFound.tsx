// The one not-found page, for a missing record and for one of another agency alike.
import { useSession } from "../session";
import { Shell } from "../ui/Chrome";
import { navigate } from "../router";

export function NotFound() {
  const { user } = useSession();
  return (
    <Shell>
      <article className="record empty-record">
        <h1>We can't find that record</h1>
        <p className="muted">The address may be mistyped, or the record is not one you can open.</p>
        <p>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
            {user ? "Back to your screen" : "Sign in"}
          </a>
        </p>
      </article>
    </Shell>
  );
}
