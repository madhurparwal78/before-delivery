import { COPY } from "./copy";
import { Link } from "./router";
import { Banner, CoasterMark } from "./ui";

export function NotFound() {
  return (
    <>
      <Banner />
      <main className="page">
        <section className="mat not-found-card">
          <CoasterMark size={56} />
          <h1>{COPY.notFound}</h1>
          <Link to="/" className="back-link">
            Back to the league table
          </Link>
        </section>
      </main>
    </>
  );
}
