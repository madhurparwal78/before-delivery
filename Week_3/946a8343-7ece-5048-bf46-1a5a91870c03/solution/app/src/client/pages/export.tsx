// `/projects/<id>/-/export`: `button "Export project"` starts an export and focuses `progressbar "Project export"`. The bar follows
// the live `export` messages; `link "Download export"` appears only once the status is finished.
import "../styles/project.css";
import { api, useAction } from "../api.ts";
import { navigate, useRoute } from "../router.ts";
import { useRole } from "../role.ts";
import { Button, LinkButton } from "../ui/button.tsx";
import { Notice } from "../ui/feedback.tsx";
import { Page } from "../ui/page.tsx";
import { ProgressPanel, useTransfer } from "./project/transfer.tsx";
import { asNumber, isRecord } from "../util.ts";

function ExportBody({ id }: { id: string }) {
  const { atLeast } = useRole();
  const { state, focusToken, begin } = useTransfer("export", id);
  const start = useAction(async () => {
    const started: unknown = await api.post(`/api/projects/${id}/exports`);
    const exportId = isRecord(started) ? asNumber(started.id) : null;
    if (exportId === null) return;
    navigate(`/projects/${id}/-/export`);
    begin(exportId);
  });
  const owner = atLeast("owner");
  const failed = state !== null && state.status === "failed";
  const finished = state !== null && state.status === "finished" && state.download !== null;
  return (
    <div class="sp-transfer">
      <p class="sp-lede sp-muted">Export the repository, issues, requests, wiki and settings of this project as one spurpack file.</p>
      {!owner ? <Notice tone="info">Only owners can export a project.</Notice> : null}
      {state !== null ? <ProgressPanel label="Project export" state={state} focusToken={focusToken} /> : null}
      {failed ? (
        <Notice>
          <span class="sp-transfer__failure">{state.error ?? "Export failed."}</span>
          <Button variant="secondary" class="sp-transfer__retry" pending={start.pending} onClick={() => void start.run()}>
            Retry export
          </Button>
        </Notice>
      ) : null}
      <div class="sp-transfer__actions">
        {owner && !failed ? (
          <Button pending={start.pending || (state !== null && state.status === "running")} onClick={() => void start.run()}>
            Export project
          </Button>
        ) : null}
        {finished && state.download !== null ? (
          <LinkButton variant="secondary" href={state.download} download>
            Download export
          </LinkButton>
        ) : null}
      </div>
    </div>
  );
}

export default function ExportPage() {
  const { id = "" } = useRoute().params;
  return (
    <Page title="Export project" live project={id} pageKeys={["project", "export"]} class="sp-transfer-page">
      <ExportBody id={id} />
    </Page>
  );
}
