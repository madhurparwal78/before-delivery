import { useState } from 'react';
import { SECTOR_LABELS, type CaseStudyState, type Sector } from '../../shared/domain.js';
import { ApiError, request } from '../lib/api.js';
import { useAnnouncer } from '../lib/announce.jsx';
import { pending, refusal, success } from '../lib/copy.js';
import { Link, setPageTitle } from '../lib/router.jsx';
import { useResource, useWorkspace } from '../lib/workspace.jsx';
import { ActionButton } from '../components/Buttons.jsx';
import { PublicShell } from '../components/PublicShell.jsx';
import { NotFound } from './NotFound.jsx';

interface PreviewPayload {
  caseStudy: {
    id: string;
    title: string;
    slug: string;
    sector: Sector;
    location: string;
    summary: string;
    body: string;
    state: CaseStudyState;
    coverUrl: string;
  };
  canApprove: boolean;
}

/** The preview is read-only: approval always needs a signed-in approver. */
export function Preview({ token }: { token: string }): JSX.Element {
  const { startPending, say, problem } = useAnnouncer();
  const { refresh, handleFailure } = useWorkspace();
  const { data, error, reload } = useResource<PreviewPayload>(
    `/api/preview/${encodeURIComponent(token)}`,
    [token],
  );
  const [busy, setBusy] = useState(false);

  setPageTitle('Case study preview · Marrow Hall Interiors');

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

  const approve = async (): Promise<void> => {
    if (!study) return;
    setBusy(true);
    startPending(pending.approveCaseStudy);
    try {
      await request(`/api/case-studies/${study.id}/approve`, { body: {} });
      refresh();
      reload();
      say(success.caseStudyApproved);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'illegal_transition') {
        problem(refusal.otherIllegal(study.state.replace('_', ' ')));
      } else {
        handleFailure(caught);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicShell
      title={study ? `${study.title} · Marrow Hall Interiors` : 'Marrow Hall Interiors'}
    >
      <section className="section" data-tone="light">
        <div className="section-inner">
          <h1>{study?.title ?? 'Case study preview'}</h1>
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
          <h2>Approval</h2>
          {data?.canApprove ? (
            <ActionButton
              className="primary"
              busy={busy}
              pendingLabel={pending.approveCaseStudy}
              onPress={() => void approve()}
            >
              Approve for publishing
            </ActionButton>
          ) : (
            <p>
              <Link to={`/sign-in?next=${encodeURIComponent(`/preview/${token}`)}`}>
                Sign in to approve
              </Link>
            </p>
          )}
        </div>
      </section>
    </PublicShell>
  );
}
