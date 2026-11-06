/** The trade buyer's own projects and the ones they collaborate on. */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api.js";
import { PROJECTS } from "../../shared/copy.js";
import { LIMITS } from "../../shared/domain.js";
import type { ProjectSummary } from "../../shared/types.js";
import { useAnnouncer, useRouter, useSession } from "../state/app.js";
import { AppLink } from "../components/Shell.js";
import { Dialog } from "../components/Dialog.js";

export function ProjectsPage() {
  const { user } = useSession();
  const { navigate } = useRouter();
  const { message, announce } = useAnnouncer();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refused, setRefused] = useState(false);

  const load = useCallback(async () => {
    try {
      const { projects: loaded } = await api.projects();
      setProjects(loaded);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setRefused(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (refused || !user) {
    return (
      <div className="wrap section">
        <h1>Projects</h1>
        <p className="muted">Projects are for approved trade accounts.</p>
        <AppLink to="/catalogue" className="button">
          Browse the catalogue
        </AppLink>
      </div>
    );
  }

  return (
    <div className="wrap section">
      <div className="spread" style={{ marginBottom: 16 }}>
        <h1>Projects</h1>
        <button type="button" className="button button-primary" onClick={() => setDialogOpen(true)}>
          New project
        </button>
      </div>

      <p role="status" aria-label="Project updates" className="small muted">
        {message}
      </p>

      {projects && projects.length === 0 && <p className="muted">No projects yet.</p>}

      <div className="card-grid">
        {(projects ?? []).map((project) => (
          <article className="card" key={project.id} aria-label={project.name}>
            {project.cover ? (
              <img className="card-figure" src={project.cover.url} alt="Project cover" />
            ) : (
              <div className="card-figure" aria-hidden="true" />
            )}
            <div className="card-body">
              <AppLink to={`/projects/${project.id}`} className="card-title">
                {project.name}
              </AppLink>
              {project.client_name && <span className="small muted">{project.client_name}</span>}
              <span className="small numeric muted">
                {`${project.lines.length} ${project.lines.length === 1 ? "line" : "lines"}`}
              </span>
              {!project.is_owner && <span className="small muted">Collaborating</span>}
            </div>
          </article>
        ))}
      </div>

      {dialogOpen && (
        <NewProjectDialog
          onClose={() => setDialogOpen(false)}
          onCreated={(id) => {
            announce(PROJECTS.projectCreated);
            setDialogOpen(false);
            navigate(`/projects/${id}`);
          }}
          onInvalid={() => announce(PROJECTS.ceilingOutOfRange)}
        />
      )}
    </div>
  );
}

function NewProjectDialog({
  onClose,
  onCreated,
  onInvalid,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  onInvalid: () => void;
}) {
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [ceiling, setCeiling] = useState<number>(LIMITS.ceilingHeightMm.default);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const { project } = await api.createProject({
        name: name.trim(),
        ...(client.trim() === "" ? {} : { client_name: client.trim() }),
        ceiling_height_mm: ceiling,
      });
      onCreated(project.id);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      onInvalid();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="New project" onClose={onClose}>
      <div className="stack">
        <div className="field">
          <label htmlFor="np-name">Project name</label>
          <input id="np-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="np-client">Client</label>
          <input id="np-client" type="text" value={client} onChange={(event) => setClient(event.target.value)} />
        </div>
        <div className="field" style={{ maxWidth: 200 }}>
          <label htmlFor="np-ceiling">Ceiling height (mm)</label>
          <input
            id="np-ceiling"
            type="number"
            min={LIMITS.ceilingHeightMm.min}
            max={LIMITS.ceilingHeightMm.max}
            step={100}
            value={ceiling}
            onChange={(event) => setCeiling(Number(event.target.value))}
          />
        </div>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void submit()}>
          {busy ? PROJECTS.saving : "Create project"}
        </button>
      </div>
    </Dialog>
  );
}
