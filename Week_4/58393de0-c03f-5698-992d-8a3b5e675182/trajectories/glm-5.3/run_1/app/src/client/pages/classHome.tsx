import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AppCtx } from '../main.js';
import { loadClassView, loadProjects, loadExports } from '../api.js';
import { openStream } from '../live.js';
import { formatCountdown } from '../status.js';
import type { Project, Export, StudentClassroomView } from '../../shared/types.js';
import { ProjectCards, ExportList, EditorLaunchPills } from './dashboard.js';

export function ClassHome(props: { ctx: AppCtx }): VNode {
  const [view, setView] = useState<StudentClassroomView | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [exportsList, setExports] = useState<Export[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);

  const reload = async () => {
    const [classRes, projRes, expRes] = await Promise.all([loadClassView(), loadProjects(), loadExports()]);
    if (classRes.ok) {
      setView(classRes.data);
      setCountdown(classRes.data.secondsToHandIn);
    }
    if (projRes.ok) setProjects(projRes.data.projects);
    if (expRes.ok) setExports(expRes.data.exports);
  };

  useEffect(() => {
    if (props.ctx.account && props.ctx.account.kind !== 'student') {
      props.ctx.navigate(props.ctx.account.kind === 'educator' ? '/dashboard' : '/projects');
      return;
    }
    void reload();
  }, [props.ctx.account]);

  // Live countdown + classroom state events.
  useEffect(() => {
    if (!view) return;
    const handle = openStream({
      onClassroomState: (ev: { classroomId: string; state: string; serverNow: string; secondsToHandIn: number }) => {
        if (ev.classroomId !== view.id) return;
        setCountdown(ev.secondsToHandIn);
        setView((v) => v ? { ...v, state: ev.state as StudentClassroomView['state'], secondsToHandIn: ev.secondsToHandIn } : v);
      },
      onAccessEnded: () => {
        window.location.href = '/join';
      },
      onProjectSaved: () => { void reload(); },
    });
    return () => handle.close();
  }, [view?.id]);

  if (!view) {
    return <main><div class="wrap" style="padding-top:32px"><p>Sign in to see your class.</p><a class="pill" href="/join">Join a class</a></div></main>;
  }

  return (
    <main>
      <div class="wrap" style="padding-top:32px">
        <h1>{view.name}</h1>
        <p><strong>{view.state === 'open' ? 'Open for joining' : view.state === 'in_session' ? 'In session' : view.state === 'handed_in' ? 'Handed in' : 'Draft'}</strong></p>
        {countdown !== null && (
          <p class="countdown num" style="font-size:1.3rem">{formatCountdown(countdown)}</p>
        )}
        <section style="margin-top:24px">
          <h2>Open an editor</h2>
          <EditorLaunchPills />
        </section>
        <section>
          <h2>My projects</h2>
          <ProjectCards projects={projects} zone={view.timeZone} emptyPillHref="/editor/new?kind=3d" emptyPillLabel="New 3D design" />
        </section>
        <section>
          <h2>My exports</h2>
          <ExportList exports={exportsList} />
        </section>
      </div>
    </main>
  );
}
