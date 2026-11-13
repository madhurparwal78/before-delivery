// `/`: Your projects. Not a live page. `list "Projects"` of GET /api/me/projects ({projects:[{id,path,name,visibility,description?}]}),
// each row a link to /projects/<id>. After signing in, focus lands on the level 1 heading.
import { useRef } from "preact/hooks";
import { api, useResource } from "../api.ts";
import { A, useFocusOnArrival } from "../router.ts";
import { Main } from "../shell/main.tsx";
import { Chip } from "../ui/chip.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Notice, Skeleton } from "../ui/feedback.tsx";
import { useTitle } from "../ui/page.tsx";
import { asNumber, asString, isRecord } from "../util.ts";

interface ProjectRow {
  id: number;
  path: string;
  name: string;
  visibility: string;
  description: string | null;
}

async function loadProjects(signal: AbortSignal): Promise<ProjectRow[]> {
  const body: unknown = await api.get("/api/me/projects", { signal });
  const list = isRecord(body) && Array.isArray(body.projects) ? body.projects : [];
  const rows: ProjectRow[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const id = asNumber(item.id);
    if (id === null) continue;
    const path = asString(item.path) ?? String(id);
    rows.push({ id, path, name: asString(item.name) ?? path, visibility: asString(item.visibility) ?? "private", description: asString(item.description) });
  }
  return rows;
}

export default function DashboardPage() {
  useTitle("Your projects");
  const heading = useRef<HTMLHeadingElement>(null);
  useFocusOnArrival(heading);
  const projects = useResource(loadProjects, []);
  return (
    <Main>
      <div class="sp-container sp-dashboard">
        <h1 ref={heading} tabIndex={-1} class="sp-page-title">
          Your projects
        </h1>
        {projects.error ? <Notice>{projects.error.message}</Notice> : null}
        {projects.loading && !projects.data ? <Skeleton rows={4} height={72} /> : null}
        {projects.data && projects.data.length === 0 ? <EmptyState eyebrow="PROJECTS" headline="No projects yet" /> : null}
        {projects.data && projects.data.length > 0 ? (
          <ul class="sp-project-list" aria-label="Projects">
            {projects.data.map((project) => (
              <li key={project.id} class="sp-project-list__item">
                <A href={`/projects/${project.id}`} class="sp-project-list__link">
                  <span class="sp-project-list__name">{project.name}</span>
                  <span class="sp-project-list__path">{project.path}</span>
                  {project.description ? <span class="sp-project-list__description">{project.description}</span> : null}
                  <Chip class="sp-project-list__visibility">{project.visibility}</Chip>
                </A>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Main>
  );
}
