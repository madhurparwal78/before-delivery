import { useEffect, useState, type ReactNode } from 'react';
import { ApiFailure, request } from './lib/api.js';
import { FeedbackProvider, FeedbackRegions } from './lib/feedback.js';
import { matchPath, navigate, usePath } from './lib/router.js';
import { TopBar } from './components/TopBar.js';
import { Authoring } from './screens/Authoring.js';
import { CohortDetail } from './screens/CohortDetail.js';
import { Completion } from './screens/Completion.js';
import { CoursePage } from './screens/CoursePage.js';
import { Courses } from './screens/Courses.js';
import { Evaluation } from './screens/Evaluation.js';
import { Learning } from './screens/Learning.js';
import { ModulePlayer } from './screens/ModulePlayer.js';
import { Planner } from './screens/Planner.js';
import { SignIn } from './screens/SignIn.js';
import { Sponsor } from './screens/Sponsor.js';
import { Transcript } from './screens/Transcript.js';
import { Verify } from './screens/Verify.js';
import type { User } from './lib/types.js';

type Session = { readonly kind: 'loading' } | { readonly kind: 'signed_in'; readonly user: User } | { readonly kind: 'anonymous' };

function screenFor(path: string, user: User): ReactNode {
  if (path === '/courses' || path === '/') return <Courses />;
  const course = matchPath('/courses/:id', path);
  if (course !== null && course['id'] !== undefined) {
    return <CoursePage courseId={course['id']} user={user} />;
  }
  if (path === '/learning') return <Learning user={user} />;
  const evaluation = matchPath('/learn/:enrolmentId/evaluation', path);
  if (evaluation !== null && evaluation['enrolmentId'] !== undefined) {
    return <Evaluation enrolmentId={evaluation['enrolmentId']} />;
  }
  const seal = matchPath('/learn/:enrolmentId/seal', path);
  if (seal !== null && seal['enrolmentId'] !== undefined) {
    return <Completion enrolmentId={seal['enrolmentId']} />;
  }
  const module = matchPath('/learn/:enrolmentId/:moduleId', path);
  if (module !== null && module['enrolmentId'] !== undefined && module['moduleId'] !== undefined) {
    return <ModulePlayer enrolmentId={module['enrolmentId']} moduleId={module['moduleId']} />;
  }
  if (path === '/transcript') return <Transcript />;
  if (path === '/sponsor') return <Sponsor />;
  if (path === '/planner') return <Planner />;
  const cohort = matchPath('/planner/cohorts/:id', path);
  if (cohort !== null && cohort['id'] !== undefined) return <CohortDetail cohortId={cohort['id']} />;
  if (path === '/author') return <Authoring user={user} />;
  return (
    <>
      <h1>Page not found</h1>
      <p>That screen does not exist in Credwell.</p>
    </>
  );
}

function Shell(): ReactNode {
  const path = usePath();
  const [session, setSession] = useState<Session>({ kind: 'loading' });
  const verify = matchPath('/verify/:token', path);

  useEffect(() => {
    if (verify !== null) return;
    void request<{ user: User }>('/api/me').then(
      (result) => setSession({ kind: 'signed_in', user: result.user }),
      (error: unknown) => {
        setSession({ kind: 'anonymous' });
        if (error instanceof ApiFailure && error.status === 401 && path !== '/signin') navigate('/signin', true);
      },
    );
    // The session is read once on load; sign-in and sign-out update it directly.
  }, []);

  if (verify !== null && verify['token'] !== undefined) {
    return (
      <>
        <div data-inert-when-dialog>
          <Verify token={verify['token']} />
        </div>
        <div className="page">
          <FeedbackRegions />
        </div>
      </>
    );
  }

  if (session.kind === 'loading') {
    return (
      <main className="page">
        <p className="hint">Loading Credwell…</p>
      </main>
    );
  }

  if (session.kind === 'anonymous' || path === '/signin') {
    return (
      <div data-inert-when-dialog>
        <SignIn onSignedIn={(user) => setSession({ kind: 'signed_in', user })} />
      </div>
    );
  }

  return (
    <>
      <div data-inert-when-dialog>
        <TopBar user={session.user} onSignedOut={() => setSession({ kind: 'anonymous' })} />
      </div>
      {/* The feedback regions stay live while a dialog is open, so their copy is announced. */}
      <div className="page">
        <FeedbackRegions />
      </div>
      <div data-inert-when-dialog>
        <main className="page">{screenFor(path, session.user)}</main>
      </div>
    </>
  );
}

export function App(): ReactNode {
  return (
    <FeedbackProvider>
      <Shell />
    </FeedbackProvider>
  );
}
