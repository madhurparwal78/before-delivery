import { useEffect, useState } from "react";
import { api, Refusal, UNEXPECTED } from "../api";
import { Dialog } from "../dialog";
import { AppHeader } from "../header";
import { BatonDrawing, Icon } from "../icons";
import { navigate } from "../router";
import type { ProjectSummary, User } from "../types";

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"one_to_one" | "group">("one_to_one");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const trimmed = title.trim();
    if (trimmed.length < 1 || trimmed.length > 80) return setError("Use 1 to 80 characters for the title.");
    setBusy(true);
    setError("");
    try {
      const result = await api<{ project: { id: string } }>("/api/projects", { method: "POST", body: { title: trimmed, kind } });
      navigate(`/projects/${result.project.id}`);
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof Refusal && failure.code === "validation" ? "Use 1 to 80 characters for the title." : UNEXPECTED);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="New project">
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="field">
          <span>Project title</span>
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <fieldset className="choice-group">
          <legend>Kind</legend>
          <label className="choice">
            <input type="radio" name="kind" checked={kind === "one_to_one"} onChange={() => setKind("one_to_one")} />
            <span>
              One-to-one <small>one learner seat</small>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="kind" checked={kind === "group"} onChange={() => setKind("group")} />
            <span>
              Group <small>up to six learners</small>
            </span>
          </label>
        </fieldset>
        {error && <p className="field-error">{error}</p>}
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            Create project
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ProjectsPage({ user }: { user: User }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<{ projects: ProjectSummary[] }>("/api/projects")
      .then((r) => setProjects(r.projects))
      .catch(() => setFailed(true));
  }, []);

  return (
    <div className="page">
      <AppHeader user={user} />
      <main className="projects" aria-labelledby="projects-title">
        <div className="projects-head">
          <h1 id="projects-title" className="projects-title">
            Projects
          </h1>
          {user.kind === "mentor" && (
            <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" />
              New project
            </button>
          )}
        </div>
        {failed && <p className="field-error">{UNEXPECTED}</p>}
        {projects === null && !failed && (
          <div className="skeleton-list" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
        {projects !== null && projects.length === 0 && (
          <div className="empty">
            <BatonDrawing />
            <p className="empty-title">No projects yet</p>
          </div>
        )}
        {projects !== null && projects.length > 0 && (
          <ul aria-label="Projects" className="project-list">
            {projects.map((p) => (
              <li key={p.id} className="project-row">
                <a
                  href={`/projects/${p.id}`}
                  className="project-link"
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(`/projects/${p.id}`);
                  }}
                >
                  {p.title}
                </a>
                <span className="project-kind">{p.kind === "group" ? "Group" : "One-to-one"}</span>
                <span className="project-count">
                  <span className="num">{p.student_count}</span> {p.student_count === 1 ? "learner" : "learners"}
                </span>
                <span className="project-role">{p.role === "mentor" ? "Mentor" : "Student"}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
      {user.kind === "mentor" && <NewProjectDialog open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}
