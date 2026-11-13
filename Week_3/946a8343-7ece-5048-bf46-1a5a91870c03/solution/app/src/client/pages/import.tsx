// `/projects/<id>/-/import`: progress of an import into this project (`progressbar "Project import"`, live through `import`
// messages). Choosing a file to import happens on the group page.
import "../styles/project.css";
import { api, useResource } from "../api.ts";
import { useRole } from "../role.ts";
import { A, useRoute } from "../router.ts";
import { Notice } from "../ui/feedback.tsx";
import { Page } from "../ui/page.tsx";
import { ProgressPanel, useTransfer } from "./project/transfer.tsx";
import type { ProjectInfo } from "./project/types.ts";

function ImportBody({ id }: { id: string }) {
  const { atLeast } = useRole();
  const { state, focusToken } = useTransfer("import", id);
  const project = useResource((signal) => api.get<ProjectInfo>(`/api/projects/${id}`, { signal }), [id]);
  const owner = atLeast("owner");
  return (
    <div class="sp-transfer">
      <p class="sp-lede sp-muted">
        Import a spurpack file as a new project in {project.data ? project.data.group.path : "this project's group"}. The file name becomes the project's path.
      </p>
      {state !== null ? <ProgressPanel label="Project import" state={state} focusToken={focusToken} /> : null}
      {state !== null && state.status === "failed" ? <Notice>{state.error ?? "Import failed."}</Notice> : null}
      {!owner ? <Notice tone="info">Only owners can import a project.</Notice> : null}
      {owner && project.data ? (
        <p class="sp-import-link">
          <A href={`/groups/${project.data.group.path}`}>Choose a spurpack file on the group page</A>
        </p>
      ) : null}
      {project.error ? <Notice>{project.error.message}</Notice> : null}
    </div>
  );
}

export default function ImportPage() {
  const { id = "" } = useRoute().params;
  return (
    <Page title="Import project" live project={id} pageKeys={["project", "import"]} class="sp-transfer-page">
      <ImportBody id={id} />
    </Page>
  );
}
