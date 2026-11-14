import { useEffect, useState } from "preact/hooks";
import type { Role } from "../../shared/access.js";
import { formatBusinessTime } from "../../shared/time.js";
import { TEMPLATES } from "../../shared/templates.js";
import { api } from "../api.js";
import { copy } from "../copy.js";
import { pageConfig } from "../config.js";
import { Footer, Shell } from "../shell.js";
import { Dialog, FieldErrors, Status } from "../ui.js";

interface Summary {
  id: string;
  name: string;
  role: Role;
  revision: number;
  entityCount: number;
  updatedAt: string;
}

const ROLE_BADGE: Record<Role, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

function ProjectCard({ project, onRename }: { project: Summary; onRename?: (p: Summary) => void }) {
  return (
    <li class="card project-card">
      <div class="project-card-head">
        <a class="project-link" href={`/projects/${project.id}`}>
          {project.name}
        </a>
        <span class="role-badge">{ROLE_BADGE[project.role]}</span>
      </div>
      <p class="muted project-meta">
        <span>{project.entityCount === 1 ? "1 entity" : `${project.entityCount} entities`}</span>
        <span>{formatBusinessTime(project.updatedAt, pageConfig.timeZone)}</span>
      </p>
      {onRename && (
        <button
          type="button"
          class="button button-secondary button-small"
          aria-label={`Rename ${project.name}`}
          onClick={() => onRename(project)}
        >
          Rename
        </button>
      )}
    </li>
  );
}

export function DashboardPage() {
  const [owned, setOwned] = useState<Summary[] | null>(null);
  const [shared, setShared] = useState<Summary[]>([]);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Summary | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    void api<{ owned: Summary[]; shared: Summary[] }>("GET", "/api/projects").then((r) => {
      if (r.ok) {
        setOwned(r.data.owned);
        setShared(r.data.shared);
      } else if (r.status === 401) location.assign("/signin");
    });
  }, []);

  return (
    <Shell>
      <section class="dashboard-section" aria-labelledby="your-projects">
        <div class="section-head">
          <h1 id="your-projects">Your projects</h1>
          <button type="button" class="button button-primary" onClick={() => setCreating(true)}>
            New project
          </button>
        </div>
        {owned && owned.length === 0 && (
          <div class="centered-state empty-state">
            <span class="badge-round" aria-hidden="true">
              +
            </span>
            <h2>No projects yet</h2>
            <p class="muted">Start a schema from scratch or from a starter template.</p>
            <p class="muted">Projects people share with you show up here too.</p>
            <button type="button" class="button-plus" onClick={() => setCreating(true)}>
              Create your first project
            </button>
          </div>
        )}
        {owned && owned.length > 0 && (
          <ul class="project-grid" aria-label="Projects">
            {owned.map((p) => (
              <ProjectCard key={p.id} project={p} onRename={setRenaming} />
            ))}
          </ul>
        )}
      </section>
      <section class="dashboard-section" aria-labelledby="shared-with-you">
        <h2 id="shared-with-you">Shared with you</h2>
        {shared.length === 0 ? (
          <p class="muted">Nothing shared with you yet.</p>
        ) : (
          <ul class="project-grid" aria-label="Shared projects">
            {shared.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </ul>
        )}
      </section>
      <Status label="Studio announcements" text={announcement} />
      {creating && (
        <NewProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(project) => {
            setCreating(false);
            setOwned([project, ...(owned ?? [])]);
            setAnnouncement(copy.projectCreated(project.name));
          }}
        />
      )}
      {renaming && (
        <RenameProjectDialog
          project={renaming}
          onClose={() => setRenaming(null)}
          onRenamed={(name, updatedAt) => {
            setOwned((owned ?? []).map((p) => (p.id === renaming.id ? { ...p, name, updatedAt } : p)));
            setRenaming(null);
            setAnnouncement(copy.projectRenamed(name));
          }}
        />
      )}
      <Footer />
    </Shell>
  );
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Summary) => void }) {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const submit = async (event: Event) => {
    event.preventDefault();
    const result = await api<Summary & { layout: { entities: Record<string, unknown> } }>(
      "POST",
      "/api/projects",
      template ? { name, templateId: template } : { name },
    );
    if (result.ok) onCreated({ ...result.data, entityCount: Object.keys(result.data.layout.entities).length });
    else setFields(result.error?.fields ?? null);
  };
  return (
    <Dialog label="New project" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <FieldErrors fields={fields} ids={{ name: "new-project-name", templateId: "new-project-template" }} />
        <div class="field">
          <label class="field-control">
            <span class="field-label">Project name</span>
            <input
              id="new-project-name"
              type="text"
              value={name}
              aria-describedby={fields?.name ? "new-project-name-error" : undefined}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
          {fields?.name && (
            <span class="field-error" id="new-project-name-error">
              {fields.name}
            </span>
          )}
        </div>
        <div class="field">
          <label class="field-control">
            <span class="field-label">Start from</span>
            <select id="new-project-template" value={template} onChange={(e) => setTemplate(e.currentTarget.value)}>
              <option value="">Empty</option>
              {TEMPLATES.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div class="button-row">
          <button type="submit" class="button button-primary">
            Create project
          </button>
          <button type="button" class="button button-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RenameProjectDialog({
  project,
  onClose,
  onRenamed,
}: {
  project: Summary;
  onClose: () => void;
  onRenamed: (name: string, updatedAt: string) => void;
}) {
  const [name, setName] = useState(project.name);
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const submit = async (event: Event) => {
    event.preventDefault();
    const result = await api<{ name: string; updatedAt: string }>("PATCH", `/api/projects/${project.id}`, { name });
    if (result.ok) onRenamed(result.data.name, result.data.updatedAt);
    else setFields(result.error?.fields ?? null);
  };
  return (
    <Dialog label="Rename project" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <FieldErrors fields={fields} ids={{ name: "rename-project-name" }} />
        <div class="field">
          <label class="field-control">
            <span class="field-label">Project name</span>
            <input
              id="rename-project-name"
              type="text"
              value={name}
              aria-describedby={fields?.name ? "rename-project-name-error" : undefined}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
          {fields?.name && (
            <span class="field-error" id="rename-project-name-error">
              {fields.name}
            </span>
          )}
        </div>
        <div class="button-row">
          <button type="submit" class="button button-primary">
            Save name
          </button>
          <button type="button" class="button button-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
