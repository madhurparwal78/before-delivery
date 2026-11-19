import { Twig } from "../lib/icons";
import { Link } from "../lib/router";

export function NotFoundPage() {
  return (
    <div className="column">
      <section className="window window-note">
        <div className="note-body">
          <Twig />
          <h1>We couldn't find that bullet</h1>
          <p>It may have been deleted, or it isn't shared with you.</p>
          <Link to="/" className="pill pill-sky">Back to Home</Link>
        </div>
      </section>
    </div>
  );
}
