import { useEffect } from 'react';
import type { ProjectSection } from '../shared/domain.js';
import { AnnouncerProvider, useAnnouncer } from './lib/announce.jsx';
import { success } from './lib/copy.js';
import { RouterProvider, useRouter } from './lib/router.jsx';
import { WorkspaceProvider, useWorkspace } from './lib/workspace.jsx';
import { OfficeShell, PlainShell } from './components/OfficeShell.jsx';
import { PublicShell } from './components/PublicShell.jsx';
import { SignIn } from './screens/SignIn.jsx';
import { Join } from './screens/Join.jsx';
import { TenderSignIn } from './screens/TenderSignIn.jsx';
import { Rollouts } from './screens/Rollouts.jsx';
import { Members } from './screens/Members.jsx';
import { Enquiries } from './screens/Enquiries.jsx';
import { CaseStudiesOffice } from './screens/CaseStudiesOffice.jsx';
import { ProjectPage } from './screens/ProjectPage.jsx';
import { TenderPage } from './screens/TenderPage.jsx';
import { LevellingPage } from './screens/LevellingPage.jsx';
import { Preview } from './screens/Preview.jsx';
import { NotFound } from './screens/NotFound.jsx';
import { Home } from './screens/public/Home.jsx';
import { Work } from './screens/public/Work.jsx';
import { CaseStudyPage } from './screens/public/CaseStudyPage.jsx';
import { Start } from './screens/public/Start.jsx';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TOKEN = '[A-Za-z0-9_-]{8,128}';

const PROJECT_ROUTE = new RegExp(
  `^/office/projects/(${UUID})/(stages|drawings|tenders|variations|certificates|shop-drawings|site-walk|finishes)$`,
);
const TENDER_ROUTE = new RegExp(`^/office/tenders/(${UUID})$`);
const LEVELLING_ROUTE = new RegExp(`^/office/tenders/(${UUID})/levelling$`);
const INVITE_ROUTE = new RegExp(`^/invite/(${TOKEN})$`);
const TENDER_SIGN_IN_ROUTE = new RegExp(`^/tender-sign-in/(${TOKEN})$`);
const PREVIEW_ROUTE = new RegExp(`^/preview/(${TOKEN})$`);
const CASE_STUDY_ROUTE = /^\/work\/([a-z0-9-]{3,80})$/;

function Routes(): JSX.Element {
  const { pathname, query, navigate } = useRouter();
  const { member, loading, clearPendingRestore } = useWorkspace();
  const { say } = useAnnouncer();
  const restoreForm = query.get('restore');

  useEffect(() => {
    if (restoreForm) {
      say(success.draftRestored);
      clearPendingRestore();
    }
  }, [restoreForm, say, clearPendingRestore]);

  useEffect(() => {
    if (!loading && !member && pathname.startsWith('/office')) {
      navigate(`/sign-in?next=${encodeURIComponent(pathname)}`, { replace: true });
    }
  }, [loading, member, pathname, navigate]);

  if (pathname === '/') return <Home />;
  if (pathname === '/work') return <Work />;
  if (pathname === '/start') return <Start />;
  const caseStudy = CASE_STUDY_ROUTE.exec(pathname);
  if (caseStudy) return <CaseStudyPage slug={caseStudy[1] as string} />;

  if (pathname === '/sign-in') {
    return (
      <PlainShell>
        <SignIn />
      </PlainShell>
    );
  }

  const invite = INVITE_ROUTE.exec(pathname);
  if (invite) {
    return (
      <PlainShell>
        <Join token={invite[1] as string} />
      </PlainShell>
    );
  }

  const tenderLink = TENDER_SIGN_IN_ROUTE.exec(pathname);
  if (tenderLink) {
    return (
      <PlainShell>
        <TenderSignIn token={tenderLink[1] as string} />
      </PlainShell>
    );
  }

  const preview = PREVIEW_ROUTE.exec(pathname);
  if (preview) return <Preview token={preview[1] as string} />;

  if (pathname.startsWith('/office')) {
    if (loading || !member) {
      return (
        <OfficeShell>
          <section className="panel">
            <h1>Plumbline</h1>
          </section>
        </OfficeShell>
      );
    }
    const content = ((): JSX.Element => {
      if (pathname === '/office') return <Rollouts />;
      if (pathname === '/office/members') return <Members restoreForm={restoreForm} />;
      if (pathname === '/office/case-studies') {
        return member.role === 'director' ? (
          <CaseStudiesOffice restoreForm={restoreForm} />
        ) : (
          <NotFound />
        );
      }
      if (pathname === '/office/enquiries') {
        return member.role === 'director' ? <Enquiries /> : <NotFound />;
      }
      const project = PROJECT_ROUTE.exec(pathname);
      if (project) {
        return (
          <ProjectPage
            projectId={project[1] as string}
            section={project[2] as ProjectSection}
            restoreForm={restoreForm}
          />
        );
      }
      const levelling = LEVELLING_ROUTE.exec(pathname);
      if (levelling) return <LevellingPage tenderId={levelling[1] as string} />;
      const tender = TENDER_ROUTE.exec(pathname);
      if (tender) {
        return <TenderPage tenderId={tender[1] as string} restoreForm={restoreForm} />;
      }
      return <NotFound />;
    })();
    return <OfficeShell>{content}</OfficeShell>;
  }

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

export function App(): JSX.Element {
  return (
    <RouterProvider>
      <AnnouncerProvider>
        <WorkspaceProvider>
          <Routes />
        </WorkspaceProvider>
      </AnnouncerProvider>
    </RouterProvider>
  );
}
