import { type ReactNode, useEffect, useState } from "react";
import { type CollectionSummary, type Role, asFailure, get, post } from "../api.js";
import { Page } from "../components/Page.js";
import { Link, collectionPath, navigate } from "../router.js";

interface ProjectRow {
  id: string;
  name: string;
  role: Role;
}

const FIELD_HELP: Record<string, string> = {
  name: "Project name needs 1 to 80 characters",
  collection: "Collection names use letters, digits, _ and - (1 to 64)",
};

export function Projects(): ReactNode {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [name, setName] = useState("");
  const [collection, setCollection] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ projects: ProjectRow[] }>("/api/projects").then((answer) => setProjects(answer.projects), () => setProjects([]));
  }, []);
  const create = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const made = await post<{ project: { id: string }; collection: CollectionSummary }>("/api/projects", { name, collection });
      navigate(collectionPath(made.project.id, made.collection.id));
    } catch (error) {
      const failure = asFailure(error);
      setMessage(failure.body.error === "name_taken" ? "You already have a project with this name" : (FIELD_HELP[String(failure.body["field"])] ?? "Could not create the project"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <h1>YOUR JARS</h1>
      <ul className="rows" role="list" aria-label="Projects" aria-busy={projects === null || undefined}>
        {projects === null ? (
          <li className="skeleton-row" />
        ) : (
          projects.map((project) => (
            <li key={project.id} className="row">
              <Link to={`/p/${project.id}`} className="row-link">
                {project.name}
              </Link>
              <span className="chip">{project.role}</span>
            </li>
          ))
        )}
      </ul>
      {projects?.length === 0 ? <p className="muted">No jars yet. Put your first one together below.</p> : null}
      <h2>PUT IT IN THE JAR</h2>
      <form
        className="stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="field">
          <span className="field-label">Project name</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">First collection name</span>
          <input className="input" value={collection} onChange={(event) => setCollection(event.target.value)} />
        </label>
        <p className="status-line" role="status" aria-label="Project status">
          {message}
        </p>
        <div className="actions">
          <button type="submit" className="btn btn-lime" aria-disabled={busy || undefined}>
            Create project
          </button>
        </div>
      </form>
    </Page>
  );
}
