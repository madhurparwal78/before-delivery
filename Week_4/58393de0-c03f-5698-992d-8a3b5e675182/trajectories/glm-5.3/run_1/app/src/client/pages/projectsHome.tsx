import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AppCtx } from '../main.js';
import { loadProjects, loadExports } from '../api.js';
import { openStream } from '../live.js';
import { M } from '../copy.js';
import type { Project, Export } from '../../shared/types.js';
import { ProjectCards, ExportList, EditorLaunchPills } from './dashboard.js';

export function ProjectsHome(props: { ctx: AppCtx }): VNode {
  const [projects, setProjects] = useState<Project[]>([]);
  const [exportsList, setExports] = useState<Export[]>([]);

  const reload = async () => {
    const [projRes, expRes] = await Promise.all([loadProjects(), loadExports()]);
    if (projRes.ok) setProjects(projRes.data.projects);
    if (expRes.ok) setExports(expRes.data.exports);
  };

  useEffect(() => {
    if (props.ctx.account && props.ctx.account.kind === 'student') {
      props.ctx.navigate('/class');
      return;
    }
    if (props.ctx.account && props.ctx.account.kind === 'educator') {
      props.ctx.navigate('/dashboard');
      return;
    }
    void reload();
  }, [props.ctx.account]);

  useEffect(() => {
    const handle = openStream({
      onProjectSaved: () => { void reload(); },
    });
    return () => handle.close();
  }, []);

  if (!props.ctx.account) {
    return <main><div class="auth-card"><h1>Sign in to see your projects</h1><a class="pill" href="/signin">Sign in</a></div></main>;
  }

  return (
    <main>
      <div class="wrap" style="padding-top:32px">
        <h1>My projects</h1>
        {!props.ctx.account.emailVerified && (
          <p style="background:var(--band);padding:12px 16px;border-radius:10px">{M.unverifiedReminder(props.ctx.account.email ?? '')}</p>
        )}
        <section>
          <h2>Open an editor</h2>
          <EditorLaunchPills />
        </section>
        <section>
          <ProjectCards projects={projects} zone={null} emptyPillHref="/editor/new?kind=3d" emptyPillLabel="New 3D design" />
        </section>
        <section>
          <h2>My exports</h2>
          <ExportList exports={exportsList} />
        </section>
      </div>
    </main>
  );
}
