import { useState } from "preact/hooks";
import { api, get } from "../api";
import { useResource } from "../hooks";
import { navigate } from "../router";
import { orderTasks } from "../project-data";
import { openModal, toast } from "../store";
import type { Me, ProjectInfo, Task } from "../types";
import { Dialog, FieldError, Pill, useBusy } from "../ui";
import { EmptyState } from "./NotFound";
import { useMount } from "../hooks";

interface Mine { projects: Array<{ id: string; name: string; progress: number; teamId: string }>; tasks: Array<Task & { projectName: string }> }

const GROUPS: Array<[Task["dueStatus"], string]> = [["overdue", "Overdue"], ["today", "Due today"], ["later", "Later"], ["none", "No due date"]];

async function loadMine(me: Me): Promise<Mine | undefined> {
  const projects: Mine["projects"] = [];
  const tasks: Mine["tasks"] = [];
  for (const team of me.teams) {
    const list = await get<{ projects: Array<{ id: string; name: string; progress: number }> }>(`/api/teams/${team.id}/projects`);
    if (!list.ok) return undefined;
    for (const p of list.data.projects) {
      projects.push({ ...p, teamId: team.id });
      const info = await get<ProjectInfo>(`/api/projects/${p.id}`);
      let seen = 0;
      for (let page = 1; page < 100; page += 1) {
        const batch = await get<{ tasks: Task[]; total: number }>(`/api/projects/${p.id}/tasks?page=${page}`);
        if (!batch.ok) return undefined;
        seen += batch.data.tasks.length;
        const ordered = info.ok ? orderTasks(batch.data.tasks, info.data.sections) : batch.data.tasks;
        tasks.push(...ordered.filter((t) => t.assigneeId === me.id && !t.completed).map((t) => ({ ...t, projectName: p.name })));
        if (!batch.data.tasks.length || seen >= batch.data.total) break;
      }
    }
  }
  return { projects, tasks };
}

function NewProject({ me, close }: { me: Me; close: () => void }) {
  const coordinated = me.teams.filter((t) => t.role === "coordinator");
  const [name, setName] = useState("");
  const [sections, setSections] = useState("To do, Doing, Done");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, run] = useBusy();
  const create = (event: Event) => {
    event.preventDefault();
    void run(async () => {
      const team = coordinated[0] ?? me.teams[0];
      const result = await api<{ id: string }>("POST", `/api/teams/${team?.id}/projects`, { name, sections: sections.split(",").map((s) => s.trim()).filter(Boolean) });
      setErrors(result.errors);
      if (result.ok) {
        close();
        navigate(`/projects/${result.data.id}`);
      } else if (!Object.keys(result.errors).length) toast("Couldn't save. Nothing changed.");
    });
  };
  return (
    <Dialog label="New project" onClose={close}>
      <form onSubmit={create} noValidate>
        <h2>New project</h2>
        <div class="field">
          <label for="project-name">Project name</label>
          <input id="project-name" data-autofocus value={name} aria-invalid={errors.name ? "true" : undefined}
            aria-describedby={errors.name ? "project-name-error" : undefined} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <FieldError id="project-name-error" text={errors.name} />
        </div>
        <div class="field">
          <label for="project-sections">Sections</label>
          <input id="project-sections" value={sections} aria-invalid={errors.sections ? "true" : undefined}
            aria-describedby="project-sections-hint" onInput={(e) => setSections((e.target as HTMLInputElement).value)} />
          <p id="project-sections-hint" class="muted">Comma separated</p>
          <FieldError id="project-sections-error" text={errors.sections} />
        </div>
        <div class="dialog-actions">
          <Pill type="submit" busy={busy} onClick={create}>Create project</Pill>
          <Pill kind="outline" onClick={close}>Cancel</Pill>
        </div>
      </form>
    </Dialog>
  );
}

export function MyWork({ me }: { me: Me }) {
  const mine = useResource<Mine>(() => loadMine(me), [me.id], (e) => ["tasks", "structure"].includes(e.t));
  const [slow, setSlow] = useState(false);
  useMount(() => {
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  if (!mine.data) {
    return (
      <div class="page">
        <h1>My work</h1>
        <div class="loading-block"><p class="empty-title">Loading</p>{slow && <Pill onClick={mine.reload}>Reload</Pill>}</div>
      </div>
    );
  }
  const { projects, tasks } = mine.data;
  return (
    <div class="page my-work">
      <h1>My work</h1>
      <div class="split">
        <section aria-labelledby="open-tasks">
          <h2 id="open-tasks" class="sr-only">Open tasks</h2>
          {tasks.length === 0 ? (
            <EmptyState title="Nothing is assigned to you yet." action="See projects" onAction={() => document.getElementById("projects-title")?.scrollIntoView()} />
          ) : (
            GROUPS.map(([status, label]) => {
              const rows = tasks.filter((t) => t.dueStatus === status);
              return rows.length ? (
                <div class="task-group" key={status}>
                  <h3>{label}</h3>
                  <ul class="plain-list">
                    {rows.map((t) => (
                      <li key={t.id} class="work-row">
                        <a href={`/projects/${t.projectId}?task=${t.id}`}>{t.name}</a>
                        <span class="muted">{t.projectName}</span>
                        <span class={`status-chip chip-${status}`}>{label}</span>
                        {t.due && <span class="muted num">{t.due}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null;
            })
          )}
        </section>
        <section aria-labelledby="projects-title">
          <div class="section-head">
            <h2 id="projects-title">Projects</h2>
            <Pill onClick={() => openModal((close) => <NewProject me={me} close={close} />)}>New project</Pill>
          </div>
          <ul class="plain-list project-list" aria-label="Projects">
            {projects.map((p) => (
              <li key={p.id}>
                <a href={`/projects/${p.id}`} class="project-link"><span>{p.name}</span><span class="muted num">{`${Math.floor(p.progress + 0.5)}% complete`}</span></a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
