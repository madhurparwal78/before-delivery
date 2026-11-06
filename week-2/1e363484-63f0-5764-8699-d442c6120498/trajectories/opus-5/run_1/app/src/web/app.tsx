import { useEffect, useState } from 'react';
import { ApiFailure, api, type Person, type ProjectListEntry } from './api';
import { Nav } from './components/Nav';
import { matchPath, navigate, useLocation } from './router';
import { AccessPage } from './screens/AccessPage';
import { AuditPage } from './screens/AuditPage';
import { FigurePage } from './screens/FigurePage';
import { Projects } from './screens/Projects';
import { RegulatorAudit, RegulatorFigure } from './screens/Regulator';
import { SignIn } from './screens/SignIn';
import { Workspace } from './screens/Workspace';

type SessionState = { kind: 'loading' } | { kind: 'signed-in'; person: Person } | { kind: 'anonymous' };

export function App(): React.ReactElement {
  const location = useLocation();
  const [session, setSession] = useState<SessionState>({ kind: 'loading' });
  const [projects, setProjects] = useState<ProjectListEntry[]>([]);

  const publicFigure = matchPath('/r/:token', location.path);
  const publicAudit = matchPath('/r/:token/audit', location.path);
  const isPublic = publicFigure !== null || publicAudit !== null;

  useEffect(() => {
    if (isPublic) return;
    void api
      .me()
      .then((result) => setSession({ kind: 'signed-in', person: result.person }))
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 401) {
          setSession({ kind: 'anonymous' });
        }
      });
  }, [isPublic]);

  useEffect(() => {
    if (session.kind !== 'signed-in') return;
    void api
      .projects()
      .then((result) => setProjects(result.projects))
      .catch(() => setProjects([]));
  }, [session, location.path]);

  useEffect(() => {
    if (isPublic) return;
    if (session.kind === 'anonymous' && location.path !== '/signin') {
      navigate('/signin', { replace: true });
    }
    if (
      session.kind === 'signed-in' &&
      (location.path === '/' || location.path === '/signin')
    ) {
      navigate('/projects', { replace: true });
    }
  }, [session.kind, location.path, isPublic]);

  if (publicAudit !== null) return <RegulatorAudit token={publicAudit.token!} />;
  if (publicFigure !== null) return <RegulatorFigure token={publicFigure.token!} />;

  if (session.kind === 'loading') {
    return (
      <div className="app-shell">
        <p>Loading Fluxseal.</p>
      </div>
    );
  }

  if (session.kind === 'anonymous') {
    return (
      <SignIn
        onSignedIn={(person) => {
          setSession({ kind: 'signed-in', person });
          navigate('/projects');
        }}
      />
    );
  }

  const person = session.person;
  const signOut = (): void => {
    void api.signOut().then(() => {
      setSession({ kind: 'anonymous' });
      navigate('/signin');
    });
  };

  const audit = matchPath('/projects/:slug/figures/:figureId/audit', location.path);
  const figure = matchPath('/projects/:slug/figures/:figureId', location.path);
  const workspace = matchPath('/projects/:slug', location.path);

  const body = ((): React.ReactElement => {
    if (location.path === '/signin' || location.path === '/' || location.path === '/projects') {
      return <Projects />;
    }
    if (location.path === '/admin/access') return <AccessPage />;
    if (audit !== null) return <AuditPage figureId={audit.figureId!} />;
    if (figure !== null) {
      const role = projects.find((entry) => entry.slug === figure.slug)?.role;
      return (
        <FigurePage
          slug={figure.slug!}
          figureId={figure.figureId!}
          canSeal={role === 'sealer'}
        />
      );
    }
    if (workspace !== null) return <Workspace key={workspace.slug} slug={workspace.slug!} />;
    return <Projects />;
  })();

  return (
    <>
      <div className="app-shell" style={{ paddingBottom: 0 }}>
        <Nav person={person} onSignOut={signOut} />
      </div>
      {body}
    </>
  );
}
