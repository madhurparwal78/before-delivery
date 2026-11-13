import { useEffect, useState, type ReactNode } from 'react';
import type { Role, SessionUser } from '../shared/types.js';
import { api, RequestFailed } from './api.js';
import { AppFrame, HOME_BY_ROLE } from './components/AppFrame.jsx';
import { useNavigation } from './router.jsx';
import { SignIn } from './screens/SignIn.jsx';
import { WeekBoard } from './screens/WeekBoard.jsx';
import { Credentials } from './screens/Credentials.jsx';
import { InterpreterWorkspace } from './screens/InterpreterWorkspace.jsx';
import { Profile } from './screens/Profile.jsx';
import { Requests } from './screens/Requests.jsx';
import { NewRequest } from './screens/NewRequest.jsx';
import { RequestDetail } from './screens/RequestDetail.jsx';
import { Billing } from './screens/Billing.jsx';
import { Invoices } from './screens/Invoices.jsx';
import { NotFound } from './screens/NotFound.jsx';

type Session = { state: 'loading' } | { state: 'signed-out' } | { state: 'signed-in'; user: SessionUser };

const ROLE_PATHS: Record<Role, RegExp[]> = {
  coordinator: [/^\/board$/, /^\/credentials$/, /^\/jobs\/[^/]+$/],
  interpreter: [/^\/open-seats$/, /^\/assignments$/, /^\/profile$/, /^\/jobs\/[^/]+$/],
  client_scheduler: [
    /^\/requests$/,
    /^\/requests\/new$/,
    /^\/requests\/[^/]+$/,
    /^\/requests\/[^/]+\/edit$/,
    /^\/invoices$/,
  ],
  billing_admin: [/^\/billing$/, /^\/invoices$/],
};

export function App(): ReactNode {
  const { pathname, navigate } = useNavigation();
  const [session, setSession] = useState<Session>({ state: 'loading' });

  useEffect(() => {
    void api
      .me()
      .then((result) => setSession({ state: 'signed-in', user: result.user }))
      .catch((failure: unknown) => {
        if (failure instanceof RequestFailed) setSession({ state: 'signed-out' });
      });
  }, []);

  useEffect(() => {
    if (session.state === 'signed-out' && pathname !== '/signin') navigate('/signin', { replace: true });
    if (session.state === 'signed-in' && (pathname === '/' || pathname === '/signin')) {
      navigate(HOME_BY_ROLE[session.user.role], { replace: true });
    }
  }, [session, pathname, navigate]);

  if (session.state === 'loading') return <main className="page" />;

  if (session.state === 'signed-out') {
    return (
      <SignIn
        onSignedIn={(user) => {
          setSession({ state: 'signed-in', user });
          navigate(HOME_BY_ROLE[user.role], { replace: true });
        }}
      />
    );
  }

  const { user } = session;
  return (
    <AppFrame user={user} onSignedOut={() => setSession({ state: 'signed-out' })}>
      <Screen user={user} pathname={pathname} />
    </AppFrame>
  );
}

function Screen({ user, pathname }: { user: SessionUser; pathname: string }): ReactNode {
  if (!ROLE_PATHS[user.role].some((pattern) => pattern.test(pathname))) return <NotFound />;

  const draftMatch = /^\/requests\/([^/]+)\/edit$/.exec(pathname);
  const requestMatch = /^\/requests\/([^/]+)$/.exec(pathname);
  const jobMatch = /^\/jobs\/([^/]+)$/.exec(pathname);

  switch (user.role) {
    case 'coordinator':
      if (pathname === '/credentials') return <Credentials />;
      return <WeekBoard user={user} pathJobId={jobMatch === null ? null : (jobMatch[1] as string)} />;
    case 'interpreter':
      if (pathname === '/profile') return <Profile />;
      return <InterpreterWorkspace user={user} />;
    case 'client_scheduler':
      if (pathname === '/requests') return <Requests />;
      if (pathname === '/requests/new') return <NewRequest draftId={null} />;
      if (pathname === '/invoices') return <Invoices />;
      if (draftMatch !== null) return <NewRequest draftId={draftMatch[1] as string} />;
      if (requestMatch !== null) return <RequestDetail requestId={requestMatch[1] as string} />;
      return <NotFound />;
    case 'billing_admin':
      if (pathname === '/invoices') return <Invoices />;
      return <Billing />;
  }
}
