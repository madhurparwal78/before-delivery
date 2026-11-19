import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import { copy } from './copy.js';
import { Invitation } from './Invitation.js';
import { useLayout } from './layout.js';
import { replace, useLocation } from './navigation.js';
import { ProjectView } from './ProjectView.js';
import { Projects } from './Projects.js';
import { SharedDraft } from './SharedDraft.js';
import { SignIn } from './SignIn.js';
import { User, Workspace } from './types.js';

type Session =
  | { state: 'unknown' }
  | { state: 'signed-out' }
  | { state: 'signed-in'; user: User; workspace: Workspace | null };

function App(): JSX.Element | null {
  const location = useLocation();
  const mode = useLayout();
  const [session, setSession] = useState<Session>({ state: 'unknown' });
  const [accessNotice, setAccessNotice] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const answer = await api<{ user: User; workspace: Workspace | null }>('/api/me');
      setSession({ state: 'signed-in', user: answer.user, workspace: answer.workspace });
    } catch {
      setSession({ state: 'signed-out' });
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const adopt = useCallback(
    (user: User) => {
      setSession({ state: 'signed-in', user, workspace: null });
      void loadMe();
    },
    [loadMe],
  );

  const path = location.pathname;
  const shared = /^\/s\/([^/]+)$/.exec(path);
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  const project = /^\/p\/([^/]+)$/.exec(path);

  useEffect(() => {
    if (session.state !== 'signed-out') return;
    if (shared !== null || invite !== null || path === '/signin') return;
    if (project !== null) {
      replace(`/signin?next=${encodeURIComponent(path + location.search)}`);
      return;
    }
    replace('/signin');
  }, [session.state, path, location.search]);

  useEffect(() => {
    if (session.state === 'signed-in' && path === '/signin') replace('/');
  }, [session.state, path]);

  useEffect(() => {
    if (path !== '/') setAccessNotice(null);
  }, [path]);

  if (shared !== null) {
    return <SharedDraft token={shared[1]} search={location.search} mode={mode} />;
  }
  if (invite !== null) {
    return (
      <Invitation
        token={invite[1]}
        onSignedIn={adopt}
      />
    );
  }
  if (session.state === 'unknown') return null;
  if (session.state === 'signed-out') {
    if (path === '/signin') {
      return (
        <SignIn search={location.search} onSignedIn={adopt} />
      );
    }
    return null;
  }

  if (project !== null) {
    return (
      <ProjectView
        key={project[1]}
        projectId={project[1]}
        search={location.search}
        user={session.user}
        mode={mode}
        onAccessLost={(title) => {
          setAccessNotice(title === null ? copy.accessUnknown : copy.accessLost(title));
          replace('/');
        }}
      />
    );
  }

  return (
    <Projects
      user={session.user}
      workspace={session.workspace}
      accessNotice={accessNotice}
      onUser={(user) => setSession({ state: 'signed-in', user, workspace: session.workspace })}
      onSignedOut={() => setSession({ state: 'signed-out' })}
    />
  );
}

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(<App />);
}
