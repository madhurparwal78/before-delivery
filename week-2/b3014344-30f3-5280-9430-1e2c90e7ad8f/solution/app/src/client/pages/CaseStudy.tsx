import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { api, RequestError } from "../lib/api";
import { prefersReducedMotion } from "../lib/motion";
import { navigate, useLocation } from "../lib/router";
import { COPY } from "../../shared/copy";
import type { Entry } from "../../shared/domain";
import { lift, playLift, returning } from "./lift";
import { NotFound } from "./Missing";

function backToWork(slug: string, fromHome: boolean): void {
  returning.slug = slug;
  if (fromHome) history.back();
  else navigate("/");
}

export function CaseStudy({ slug }: { slug: string }) {
  const location = useLocation();
  const fromHome = Boolean((location.state as { fromHome?: boolean } | null)?.fromHome);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  // Whether this page opened with the lift is decided once, when it mounts.
  const [from] = useState(() => (lift.slug === slug && lift.rect !== null && !prefersReducedMotion() ? lift.rect : null));
  const [lifted, setLifted] = useState(from === null);

  useEffect(() => {
    if (!from) return;
    lift.slug = null;
    lift.rect = null;
    return playLift(from, "open", () => setLifted(true));
  }, [from]);

  useEffect(() => {
    returning.slug = slug;
    api<Entry>(`/api/case-studies/${encodeURIComponent(slug)}`)
      .then(setEntry)
      .catch((error) => (error instanceof RequestError && error.status === 404 ? setMissing(true) : setFailed(true)));
  }, [slug]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="dialog"]')) backToWork(slug, fromHome);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slug, fromHome]);

  if (missing) return <NotFound />;
  const shown = lifted && (entry !== null || failed);
  return (
    <article className={`case-study${shown ? " case-study--shown" : ""}`} aria-busy={!shown}>
      <a
        href="/"
        className="back-link"
        onClick={(event) => {
          event.preventDefault();
          backToWork(slug, fromHome);
        }}
      >
        <ArrowLeft aria-hidden="true" size={18} />
        Back to work
      </a>
      {failed ? (
        <p className="notice notice--seam">{COPY.cmsOutage}</p>
      ) : entry ? (
        <>
          <p className="eyebrow">
            {entry.client} · <span className="mono">{entry.year}</span>
          </p>
          <h1 className="case-study__title">{entry.title}</h1>
          <p className="lede">{entry.summary}</p>
          <div className="prose">
            {entry.body.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </>
      ) : null}
    </article>
  );
}
