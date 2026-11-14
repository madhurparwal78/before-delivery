import { useEffect, useState } from "preact/hooks";
import type { Role } from "../../shared/access.js";
import type { Layout } from "../../shared/layout.js";
import { api } from "../api.js";
import { Shell, loadMe } from "../shell.js";
import { Workspace } from "../workspace/workspace.js";
import { NotFoundPage, SignInCard } from "./simple.js";

interface ProjectJson {
  id: string;
  name: string;
  role: Role;
  revision: number;
  text: string;
  layout: Layout;
}

export function ProjectPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectJson | null | "missing">(null);
  useEffect(() => {
    void api<ProjectJson>("GET", `/api/projects/${encodeURIComponent(projectId)}`).then((r) => setProject(r.ok ? r.data : "missing"));
  }, []);
  if (project === "missing") return <NotFoundPage />;
  return (
    <Shell wide>
      {project && (
        <Workspace
          kind="project"
          projectId={project.id}
          shareToken={null}
          name={project.name}
          role={project.role}
          revision={project.revision}
          text={project.text}
          layout={project.layout}
        />
      )}
    </Shell>
  );
}

type Shared = { access: "edit"; projectName: string } | (ProjectJson & { via: "link" });

export function SharedPage({ token }: { token: string }) {
  const [shared, setShared] = useState<Shared | null | "missing">(null);
  const [signedOut, setSignedOut] = useState(false);
  const join = async () => {
    const result = await api<{ projectId: string }>("POST", `/api/shared/${encodeURIComponent(token)}/join`);
    if (result.ok) location.assign(`/projects/${result.data.projectId}`);
    else setShared("missing");
  };
  useEffect(() => {
    void api<Shared>("GET", `/api/shared/${encodeURIComponent(token)}`).then(async (r) => {
      if (!r.ok) {
        setShared("missing");
        return;
      }
      setShared(r.data);
      if ("access" in r.data) {
        if (await loadMe()) await join();
        else setSignedOut(true);
      }
    });
  }, []);
  if (shared === "missing") return <NotFoundPage />;
  if (!shared) return <Shell>{null}</Shell>;
  if ("access" in shared) {
    return (
      <Shell>
        <div class="signin-wrap">
          {signedOut && <SignInCard heading={`Sign in to edit ${shared.projectName}`} onSignedIn={() => void join()} />}
        </div>
      </Shell>
    );
  }
  return (
    <Shell wide>
      <Workspace
        kind="shared"
        projectId={null}
        shareToken={token}
        name={shared.name}
        role="viewer"
        revision={shared.revision}
        text={shared.text}
        layout={shared.layout}
      />
    </Shell>
  );
}
