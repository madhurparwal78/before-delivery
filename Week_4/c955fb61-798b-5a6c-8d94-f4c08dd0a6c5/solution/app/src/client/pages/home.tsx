import { useEffect, useRef, useState } from "react";
import { formatLong } from "../../shared/calendar";
import type { Person, ProjectSummary, WorkspaceMembership } from "../../shared/types";
import { ApiFailure, call } from "../api";
import { Dialog } from "../components/dialog";
import { navigate } from "../router";

export function Home({ onSignedOut }: { me: Person; onSignedOut: () => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [creating, setCreating] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    void call<{ projects: ProjectSummary[] }>("GET", "/api/projects").then((result) => setProjects(result.body.projects));
    void call<{ workspaces: WorkspaceMembership[] }>("GET", "/api/me").then((result) => setWorkspaces(result.body.workspaces));
  }, []);

  const signOut = async () => {
    await call("DELETE", "/api/session");
    onSignedOut();
    navigate("/signin", true);
  };

  return (
    <main className="home">
      <header className="home-head">
        <h1>Projects</h1>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <ul aria-label="Projects" className="project-list">
        {(projects ?? []).map((project) => (
          <li key={project.id}>
            <a href={`/projects/${project.id}`} onClick={(event) => { event.preventDefault(); navigate(`/projects/${project.id}`); }}>
              {project.name}
            </a>
            <span className="project-meta">
              {project.workspace.name}
              {project.finish ? `, finishes ${formatLong(project.finish)}` : ", no finish date yet"}
            </span>
          </li>
        ))}
      </ul>
      {projects !== null && projects.length === 0 ? <p className="quiet">No projects yet.</p> : null}
      <button type="button" ref={opener} className="new-project" onClick={() => setCreating(true)}>
        New project
      </button>
      {creating ? <NewProject workspaces={workspaces.filter((entry) => entry.role !== "viewer")} returnTo={() => opener.current} onClose={() => setCreating(false)} /> : null}
    </main>
  );
}

function NewProject({ workspaces, returnTo, onClose }: { workspaces: WorkspaceMembership[]; returnTo: () => HTMLElement | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [workspace, setWorkspace] = useState(workspaces[workspaces.length - 1]?.id ?? "");
  const [alertText, setAlertText] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setAlertText("");
    try {
      const made = await call<{ project: { id: string } }>("POST", "/api/projects", { name, workspace });
      navigate(`/projects/${made.body.project.id}`);
    } catch (failure) {
      const field = failure instanceof ApiFailure ? failure.body.field : null;
      setAlertText(field === "name" ? "Project name must be 1 to 80 characters." : "Your change could not be saved. Try again.");
      setBusy(false);
    }
  };

  return (
    <Dialog label="New project" className="narrow" onClose={onClose} returnTo={returnTo}>
      <h2>New project</h2>
      <div className="fields">
        <label>
          <span>Project name</span>
          <input type="text" value={name} data-autofocus="" onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          <span>Workspace</span>
          <select value={workspace} onChange={(event) => setWorkspace(event.target.value)}>
            {workspaces.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div role="alert" className="dialog-alert">
        {alertText}
      </div>
      <div className="dialog-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void create()}>
          Create project
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
