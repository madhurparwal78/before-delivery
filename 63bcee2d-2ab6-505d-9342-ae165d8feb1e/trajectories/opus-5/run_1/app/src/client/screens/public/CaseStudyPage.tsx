import { SECTOR_LABELS, type Sector } from '../../../shared/domain.js';
import { PublicShell } from '../../components/PublicShell.jsx';
import { PrimaryLink } from '../../components/Buttons.jsx';
import { LineReveal } from '../../components/LineReveal.jsx';
import { useResource } from '../../lib/workspace.jsx';
import { NotFound } from '../NotFound.jsx';

interface CaseStudy {
  slug: string;
  title: string;
  sector: Sector;
  location: string;
  summary: string;
  body: string;
  coverUrl: string;
}

export function CaseStudyPage({ slug }: { slug: string }): JSX.Element {
  const { data, error } = useResource<{ caseStudy: CaseStudy }>(
    `/api/public/case-studies/${encodeURIComponent(slug)}`,
    [slug],
  );

  if (error) {
    return (
      <PublicShell title="Page not found · Marrow Hall Interiors">
        <section className="section" data-tone="light">
          <div className="section-inner">
            <NotFound />
          </div>
        </section>
      </PublicShell>
    );
  }

  const study = data?.caseStudy;

  return (
    <PublicShell
      title={study ? `${study.title} · Marrow Hall Interiors` : 'Marrow Hall Interiors'}
    >
      <section className="section" data-tone="light">
        <div className="section-inner">
          <h1>
            <LineReveal lines={study ? study.title.split(', ') : []} />
          </h1>
          {study ? (
            <>
              <p className="meta">{`${SECTOR_LABELS[study.sector]} · ${study.location}`}</p>
              <div className="case-hero">
                <img src={study.coverUrl} alt="" />
              </div>
              <p>{study.summary}</p>
            </>
          ) : null}
        </div>
      </section>

      {study ? (
        <section className="section" data-tone="dark">
          <div className="section-inner prose">
            <h2>The delivery</h2>
            {study.body.split('\n\n').map((paragraph) => (
              <p key={paragraph.slice(0, 48)}>{paragraph}</p>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section" data-tone="light">
        <div className="section-inner">
          <h2>Start a project</h2>
          <p>Tell us what you are opening and where.</p>
          <p>
            <PrimaryLink to="/start" label="Start a project" />
          </p>
        </div>
      </section>
    </PublicShell>
  );
}
