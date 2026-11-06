import { useEffect, useState } from "react";
import { get } from "../api";
import { PageHeading, titleLines } from "./heading";
import { NotFoundPage } from "./notfound";
import { RollLink } from "./shell";

// A published case study: the hero cover, the line-revealed title, its summary and body.

export interface CaseStudyView {
  title: string;
  sector: string;
  location: string;
  summary: string;
  body: string;
  coverUrl: string;
}

export const SECTOR_LABEL: Record<string, string> = { retail: "Retail", workplace: "Workplace", food_beverage: "Food & beverage" };

/** The case study as the public sees it; also the preview page's body. */
export function CaseStudyArticle({ study, pageTitle }: { study: CaseStudyView; pageTitle: string }) {
  return (
    <>
      <section className="section section-plaster study-hero" data-tone="light">
        <div className="grid">
          <p className="sheet-caption"><span>Case study</span><span>{SECTOR_LABEL[study.sector] ?? study.sector}</span><span>{study.location}</span></p>
          <PageHeading reveal title={pageTitle} lines={titleLines(study.title)} />
          <figure className="study-cover">
            <img src={study.coverUrl} alt={`Drawn elevation of the ${study.title} interior`} width={1600} height={1000} />
          </figure>
        </div>
      </section>
      <section className="section section-plaster study-body" data-tone="light">
        <div className="grid">
          <p className="study-summary">{study.summary}</p>
          <div className="study-text">
            {study.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </div>
        </div>
      </section>
    </>
  );
}

export function CaseStudyPage({ slug }: { slug: string }) {
  const [state, setState] = useState<{ study: CaseStudyView } | "missing" | null>(null);

  useEffect(() => {
    void get<{ caseStudy: CaseStudyView }>(`/api/public/case-studies/${encodeURIComponent(slug)}`).then((result) => {
      setState(result.ok ? { study: result.data.caseStudy } : "missing");
    });
  }, [slug]);

  if (state === "missing") return <NotFoundPage />;
  if (!state) return <section className="section section-plaster loading-section" data-tone="light" aria-busy="true" />;
  return (
    <>
      <CaseStudyArticle study={state.study} pageTitle={`${state.study.title} · Marrow Hall Interiors`} />
      <section className="section section-dark cta" data-tone="dark">
        <div className="grid">
          <h2 className="section-heading">A rollout like this one?</h2>
          <RollLink href="/start?step=1" label="Start a project" />
        </div>
      </section>
    </>
  );
}
