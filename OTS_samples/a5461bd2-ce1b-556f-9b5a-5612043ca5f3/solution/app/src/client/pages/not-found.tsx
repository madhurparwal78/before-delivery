import { NOT_FOUND_COPY, type NotFoundKind } from "../../shared/routes";
import { Link } from "../router";

export function NotFoundPage({ kind }: { kind: NotFoundKind }) {
  const copy = NOT_FOUND_COPY[kind];
  return (
    <section className="page page--narrow">
      <h1 tabIndex={-1}>{copy.heading}</h1>
      <p><Link className="button button--primary" href={copy.href}>{copy.link}</Link></p>
    </section>
  );
}
