import { useEffect, useState } from 'react';
import { ApiFailure, SessionUser, apiGet } from './api';
import { NotFoundScreen, PlainShell, Skeleton } from './components/Shell';
import { ConfirmScreen, SigninScreen, SignupScreen } from './screens/Account';
import {
  IndexesScreen,
  PipelineScreen,
  RulesScreen,
  SavedQueriesScreen,
  SchemaScreen,
} from './screens/Collection';
import { DocumentsScreen } from './screens/Documents';
import { LandingScreen } from './screens/Landing';
import { InvitesScreen, MembersScreen, ProjectHomeScreen, ProjectsScreen } from './screens/Projects';
import { Route, navigate, useRoute } from './router';

const PUBLIC_ROUTES = new Set<Route['name']>(['landing', 'signup', 'confirm', 'signin']);

export function App(): JSX.Element {
  const { route, path, search } = useRoute();
  const [session, setSession] = useState<{ loading: boolean; user: SessionUser | null }>({
    loading: true,
    user: null,
  });

  useEffect(() => {
    void apiGet<{ user: SessionUser }>('/api/me')
      .then((answer) => setSession({ loading: false, user: answer.user }))
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure) setSession({ loading: false, user: null });
        else setSession({ loading: false, user: null });
      });
  }, []);

  useEffect(() => {
    if (session.loading || session.user || PUBLIC_ROUTES.has(route.name)) return;
    navigate(`/signin?next=${encodeURIComponent(path)}`, true);
  }, [session, route.name, path]);

  if (session.loading) {
    return (
      <PlainShell user={null}>
        <div aria-busy="true">
          <Skeleton lines={3} />
        </div>
      </PlainShell>
    );
  }

  const user = session.user;
  const onSignedIn = (signedIn: SessionUser): void => setSession({ loading: false, user: signedIn });

  switch (route.name) {
    case 'landing':
      return <LandingScreen user={user} />;
    case 'signup':
      return <SignupScreen user={user} />;
    case 'confirm':
      return <ConfirmScreen user={user} onSignedIn={onSignedIn} />;
    case 'signin':
      return <SigninScreen user={user} search={search} onSignedIn={onSignedIn} />;
    default:
      break;
  }

  if (!user) {
    return (
      <PlainShell user={null}>
        <div aria-busy="true">
          <Skeleton lines={3} />
        </div>
      </PlainShell>
    );
  }

  switch (route.name) {
    case 'projects':
      return <ProjectsScreen user={user} />;
    case 'invites':
      return <InvitesScreen user={user} />;
    case 'project':
      return <ProjectHomeScreen user={user} pid={route.pid} />;
    case 'members':
      return <MembersScreen user={user} pid={route.pid} />;
    case 'documents':
      return (
        <DocumentsScreen user={user} pid={route.pid} cid={route.cid} did={route.did} />
      );
    case 'queries':
      return <SavedQueriesScreen user={user} pid={route.pid} cid={route.cid} />;
    case 'pipeline':
      return <PipelineScreen user={user} pid={route.pid} cid={route.cid} />;
    case 'indexes':
      return <IndexesScreen user={user} pid={route.pid} cid={route.cid} />;
    case 'schema':
      return <SchemaScreen user={user} pid={route.pid} cid={route.cid} />;
    case 'rules':
      return <RulesScreen user={user} pid={route.pid} cid={route.cid} />;
    default:
      return <NotFoundScreen user={user} />;
  }
}
