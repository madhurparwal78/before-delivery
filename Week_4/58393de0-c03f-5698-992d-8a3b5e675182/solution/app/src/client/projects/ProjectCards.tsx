import { Blocks, Box, CircuitBoard } from "lucide-react";
import { copy } from "../../shared/copy";
import { formatInZone } from "../../shared/rules";
import type { Project, ProjectKind } from "../../shared/types";
import { Link } from "../lib/router";
import { SnapshotStill } from "../render";
import { useSnapshot } from "./useSnapshot";
import "./projects.css";

const KINDS = {
  "3d": { label: "3D design", Icon: Box },
  circuit: { label: "Circuit", Icon: CircuitBoard },
  blocks: { label: "Block program", Icon: Blocks },
} satisfies Record<ProjectKind, { label: string; Icon: typeof Box }>;

function ProjectCard({ project, zone }: { project: Project; zone: string | undefined }) {
  const { ref, snapshot } = useSnapshot(project.id, project.revision);
  const { label, Icon } = KINDS[project.kind];
  return (
    <li className={`card project-card project-card--${project.kind}`}>
      <div className="project-still" ref={ref} aria-hidden="true">
        {snapshot ? <SnapshotStill snapshot={snapshot} /> : <Icon className="project-still-wait" size={40} strokeWidth={1.25} />}
      </div>
      <div className="project-meta">
        <span className="project-kind"><Icon size={16} aria-hidden="true" />{label}</span>
        <Link className="stretch-link project-name" to={`/editor/${project.id}`}>{project.name}</Link>
        <span className="hint">{copy.savedAt(formatInZone(project.savedAt, zone))}</span>
      </div>
    </li>
  );
}

/** The `My projects` card grid. `zone` is the classroom's zone for a Student; omitted, times follow the browser's own zone setting. */
export function ProjectCards({ projects, zone }: { projects: Project[]; zone?: string }) {
  return (
    <ul className="card-grid card-grid--3" aria-label="My projects">
      {projects.map((project) => <ProjectCard key={project.id} project={project} zone={zone} />)}
    </ul>
  );
}
