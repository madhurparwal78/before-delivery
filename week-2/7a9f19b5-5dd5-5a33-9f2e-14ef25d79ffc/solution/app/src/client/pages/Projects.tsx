import { Plus } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { Project, ProjectSummary } from "../../shared/types";
import { Dialog } from "../components/Dialog";
import { RoomPlan } from "../components/Drawings";
import { request } from "../lib/api";
import { Link } from "../lib/router";
import { useSession } from "../lib/session";
import { NotFound } from "./NotFound";

const CEILING_ERROR = "Ceiling height must be between 2400 and 4000 mm.";

function NewProject({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (project: Project) => void }) {
  const id = useId();
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [ceiling, setCeiling] = useState("2700");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const height = Number(ceiling);
    if (!name.trim()) return setError("This field is required.");
    if (!Number.isInteger(height) || height < 2400 || height > 4000) return setError(CEILING_ERROR);
    setSaving(true);
    setError("");
    const reply = await request<{ project: Project }>("/api/projects", {
      method: "POST",
      body: { name: name.trim(), ...(client.trim() ? { client_name: client.trim() } : {}), ceiling_height_mm: height },
    });
    setSaving(false);
    if (reply.ok) {
      setName("");
      setClient("");
      setCeiling("2700");
      onCreated(reply.data.project);
    } else if (reply.error.errors?.ceiling_height_mm) setError(CEILING_ERROR);
  };

  return (
    <Dialog title="New project" open={open} onClose={onClose}>
      <form className="form-stack" onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor={`${id}-name`}>Project name</label>
          <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-client`}>Client</label>
          <input id={`${id}-client`} value={client} onChange={(e) => setClient(e.target.value)} />
        </div>
        <div className={`field ${error === CEILING_ERROR ? "field--error" : ""}`}>
          <label htmlFor={`${id}-ceiling`}>Ceiling height (mm)</label>
          <input
            id={`${id}-ceiling`}
            type="number"
            min={2400}
            max={4000}
            step={100}
            value={ceiling}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => setCeiling(e.target.value)}
          />
        </div>
        {error && (
          <p id={`${id}-error`} className="field__error">
            {error}
          </p>
        )}
        <button type="submit" className="button button--primary" disabled={saving}>
          {saving ? "Saving" : "Create project"}
        </button>
      </form>
    </Dialog>
  );
}

export function Projects() {
  const { user, ready, approvedTrade } = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [dialog, setDialog] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    document.title = "Projects · Lightfall";
    if (!approvedTrade) return;
    void request<{ projects: ProjectSummary[] }>("/api/projects").then((reply) => reply.ok && setProjects(reply.data.projects));
  }, [approvedTrade]);

  if (ready && !approvedTrade) return <NotFound />;
  if (!user) return <div className="page-loading" aria-busy="true" />;

  return (
    <div className="projects">
      <header className="page-head page-head--actions">
        <div>
          <p className="eyebrow">Trade</p>
          <h1>Projects</h1>
        </div>
        <button type="button" className="button button--primary" onClick={() => setDialog(true)}>
          <Plus aria-hidden="true" size={18} strokeWidth={1.5} />
          New project
        </button>
      </header>
      <p role="status" aria-label="Project updates" className="form-status">
        {status}
      </p>
      {projects && projects.length === 0 && <p className="empty-note">No projects yet. Start one with New project.</p>}
      <ul className="project-grid">
        {projects?.map((project) => (
          <li key={project.id} className="project-card">
            <div className="project-card__cover">
              {project.cover ? (
                <img src={project.cover.url} alt="" />
              ) : (
                <RoomPlan widthMm={project.room_width_mm} depthMm={project.room_depth_mm} ceilingMm={project.ceiling_height_mm} placements={[]} />
              )}
            </div>
            <h2 className="project-card__name">
              <Link href={`/projects/${project.id}`}>{project.name}</Link>
            </h2>
            <p className="project-card__client">{project.client_name ?? "No client yet"}</p>
            <p className="project-card__meta mono">
              {project.lines.length} {project.lines.length === 1 ? "line" : "lines"} · {(project.ceiling_height_mm / 1000).toFixed(1)} m
              ceiling{project.is_owner ? "" : " · shared with you"}
            </p>
          </li>
        ))}
      </ul>
      <NewProject
        open={dialog}
        onClose={() => setDialog(false)}
        onCreated={(project) => {
          setProjects((current) => [project, ...(current ?? [])]);
          setStatus("Project created.");
          setDialog(false);
        }}
      />
    </div>
  );
}
