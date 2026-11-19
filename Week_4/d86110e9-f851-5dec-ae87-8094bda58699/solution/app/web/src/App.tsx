import { useEffect, useState, type ReactElement } from 'react';
import { api, ApiFailure, w } from './api';
import { Layout } from './layout';
import { Landing } from './pages/Landing';
import { NotFound } from './pages/NotFound';
import { SignUp, SignIn, Confirm, Invite } from './pages/Auth';
import { Home } from './pages/Home';
import { Editor } from './pages/Editor';
import { Runs } from './pages/Runs';
import { RunDetail } from './pages/RunDetail';
import { Tables, TableDetail } from './pages/Tables';
import { Members } from './pages/Members';
import { PublicForm } from './pages/PublicForm';
import { matchPath, navigate, usePath } from './router';
import { settings } from './settings';
import { useShell } from './shell';
import { Skeleton } from './ui';
import type { WorkspaceInfo } from './types';

/** Loads the workspace named in the address; any workspace the member cannot see is the not-found page. */
function WorkspaceGate({ id, children }: { id: string; children: (workspace: WorkspaceInfo) => ReactElement }) {
  const { me, workspace, setWorkspace, epoch } = useShell();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (me === null) navigate('/sign-in', { replace: true });
  }, [me]);

  useEffect(() => {
    if (!me) return undefined;
    let current = true;
    setMissing(false);
    api.get<WorkspaceInfo>(w(id)).then(
      (found) => current && setWorkspace(found),
      (error: unknown) => {
        if (current && error instanceof ApiFailure && error.status === 404) setMissing(true);
        else if (current) throw error;
      },
    );
    return () => {
      current = false;
    };
  }, [id, me, epoch, setWorkspace]);

  if (missing) return <NotFound />;
  if (!me || workspace?.id !== id) return <Skeleton rows={4} />;
  return children(workspace);
}

function routeFor(path: string): ReactElement {
  if (path === '/') return <Landing />;
  if (path === '/sign-up') return <SignUp />;
  if (path === '/sign-in') return <SignIn />;
  const confirm = matchPath('/confirm/:token', path);
  if (confirm) return <Confirm token={confirm.token as string} />;
  const invite = matchPath('/invite/:token', path);
  if (invite) return <Invite token={invite.token as string} />;
  if (matchPath('/forms/:slug/:path', path)) return settings.form ? <PublicForm form={settings.form} slug={matchPath('/forms/:slug/:path', path)?.slug as string} path={matchPath('/forms/:slug/:path', path)?.path as string} /> : <NotFound />;
  const space = matchPath('/w/:ws', path) ?? matchPath('/w/:ws/:area', path) ?? matchPath('/w/:ws/:area/:item', path);
  if (space) {
    const ws = space.ws as string;
    const gate = (page: (workspace: WorkspaceInfo) => ReactElement) => <WorkspaceGate id={ws}>{page}</WorkspaceGate>;
    if (matchPath('/w/:ws', path)) return gate((workspace) => <Home workspace={workspace} />);
    if (matchPath('/w/:ws/members', path)) return gate((workspace) => <Members workspace={workspace} />);
    if (matchPath('/w/:ws/runs', path)) return gate((workspace) => <Runs workspace={workspace} />);
    if (matchPath('/w/:ws/tables', path)) return gate((workspace) => <Tables workspace={workspace} />);
    const automation = matchPath('/w/:ws/automations/:aid', path);
    if (automation) return gate((workspace) => <Editor key={automation.aid} workspace={workspace} automationId={automation.aid as string} />);
    const run = matchPath('/w/:ws/runs/:rid', path);
    if (run) return gate((workspace) => <RunDetail key={run.rid} workspace={workspace} runId={run.rid as string} />);
    const table = matchPath('/w/:ws/tables/:tid', path);
    if (table) return gate((workspace) => <TableDetail key={table.tid} workspace={workspace} tableId={table.tid as string} />);
  }
  return <NotFound />;
}

export function App() {
  const path = usePath();
  const { me, setWorkspace } = useShell();

  useEffect(() => {
    if (!path.startsWith('/w/')) setWorkspace(null);
  }, [path, setWorkspace]);

  if (me === undefined && path.startsWith('/w/')) return <Layout><Skeleton rows={4} /></Layout>;
  return <Layout landing={path === '/'}>{routeFor(path)}</Layout>;
}
