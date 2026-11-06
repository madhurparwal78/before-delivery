import { useEffect } from "react";
import { NOT_FOUND } from "../office/copy";
import { PageHeading } from "./heading";
import { PublicLink, useNotices } from "./shell";

// The not-found page for unknown, withdrawn, draft or unpublished addresses (served with HTTP 404).

export function NotFoundPage() {
  const notices = useNotices();
  const { alert: raiseProblem } = notices;
  // Raised after the commit, as a notice belonging to this address.
  useEffect(() => queueMicrotask(() => raiseProblem(NOT_FOUND)), [raiseProblem]);
  return (
    <section className="section section-plaster not-found" data-tone="light">
      <div className="grid">
        <p className="sheet-caption"><span>Error</span><span>404</span></p>
        <PageHeading title="Page not found · Marrow Hall Interiors" lines={["Page not found"]} />
        <p className="hero-lede">{NOT_FOUND}</p>
        <p className="not-found-links"><PublicLink href="/" className="text-link">Home</PublicLink><PublicLink href="/work" className="text-link">Work</PublicLink></p>
      </div>
    </section>
  );
}
