import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { User } from "../../shared/types";
import { NewProjectDialog } from "../components/dialogs";

interface ProjectSummary {
  id: string;
  title: string;
  kind: string;
  role: string;
  student_count: number;
}

export function ProjectsPage({
  user,
  navigate,
  accountSlot,
}: {
  user: User;
  navigate: (to: string) => void;
  accountSlot: React.ReactNode;
}): React.ReactElement {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data } = await api<{ projects: ProjectSummary[] }>("GET", "/api/projects");
      setProjects(data?.projects ?? []);
    })();
  }, []);

  return (
    <div className="projects-page">
      <header className="app-header">
        <span className="app-title">Relay Bench</span>
        {accountSlot}
      </header>
      <main className="projects-main">
        <div className="projects-head">
          <h2 className="projects-heading">Projects</h2>
          {user.kind === "mentor" ? (
            <button onClick={() => setDialogOpen(true)}>New project</button>
          ) : null}
        </div>
        {projects === null ? null : projects.length === 0 ? (
          <p className="empty serif">No projects yet</p>
        ) : (
          <ul aria-label="Projects" className="project-list">
            {projects.map((p) => (
              <li key={p.id}>
                <a
                  href={`/projects/${p.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/projects/${p.id}`);
                  }}
                >
                  {p.title}
                </a>
                <span className="project-kind">
                  {p.kind === "one_to_one" ? "One-to-one" : "Group"}
                </span>
                <span className="project-count mono">{p.student_count}</span>
                <span className="project-role">{p.role === "mentor" ? "Mentor" : "Student"}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
      {dialogOpen ? (
        <NewProjectDialog
          onClose={() => setDialogOpen(false)}
          onCreated={(id) => {
            setDialogOpen(false);
            navigate(`/projects/${id}`);
          }}
        />
      ) : null}
    </div>
  );
}
