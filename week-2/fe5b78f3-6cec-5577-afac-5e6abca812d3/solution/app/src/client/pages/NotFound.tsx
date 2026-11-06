import { EmptyStub } from "../components/EmptyStub";
import { useRibbon } from "../components/Shell";
import { Link } from "../lib/router";

export function NotFound() {
  useRibbon([]);
  return (
    <section className="panel empty">
      <EmptyStub />
      <h1>Page not found</h1>
      <p>This address is not a Pakka Rail screen.</p>
      <Link href="/" className="button primary">Search trains</Link>
    </section>
  );
}
