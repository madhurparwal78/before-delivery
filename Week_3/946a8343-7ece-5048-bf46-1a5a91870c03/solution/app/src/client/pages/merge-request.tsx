// Merge request overview: description, closing issues and the activity, inside the shared frame (header, files, panel).
import { useRoute } from "../router.ts";
import { Activity } from "./mr/activity.tsx";
import { closingText, useMergeRequestPage, useMrCaps } from "./mr/data.ts";
import { ChangedFiles } from "./mr/files.tsx";
import { MrFrame } from "./mr/frame.tsx";

export default function MergeRequestPage() {
  const { params } = useRoute();
  const project = params.id ?? "";
  const iid = Number(params.iid);
  const page = useMergeRequestPage(project, iid, { notes: false });
  const caps = useMrCaps(page.mr, page.settings);
  const { mr } = page;
  return (
    <MrFrame project={project} iid={iid} tab="overview" page={page} filesNav={<ChangedFiles project={project} iid={iid} />}>
      {mr ? (
        <>
          <section class="sp-mr__block" aria-labelledby="mr-description-title">
            <h2 id="mr-description-title" class="sp-mr__h2">
              Description
            </h2>
            {mr.description.trim() === "" ? <p class="sp-muted">No description.</p> : <p class="sp-mr__description">{mr.description}</p>}
            <p class="sp-small sp-muted">
              {`Opened by ${mr.author}`}
              {mr.assignees.length > 0 ? `. Assigned to ${mr.assignees.join(", ")}` : ""}
              {mr.reviewers.length > 0 ? `. Reviewers ${mr.reviewers.join(", ")}` : ""}
              {"."}
            </p>
          </section>
          {mr.state === "opened" ? (
            <section class="sp-mr__block" aria-label="Closing issues">
              <p>{closingText(mr.closes)}</p>
            </section>
          ) : null}
          <Activity page={page} caps={caps} />
        </>
      ) : null}
    </MrFrame>
  );
}
