// Merge request changes: the diff with keyboard review, threads in place, versions to compare and touch gestures, inside the shared
// frame. The address keeps file, line, view, from and to.
import "../styles/mr-diff.css";
import { useRoute } from "../router.ts";
import { useMergeRequestPage } from "./mr/data.ts";
import { useCompare } from "./mr/diff-data.ts";
import { FilesNav } from "./mr/diff-files.tsx";
import { DiffScreen } from "./mr/diff-view.tsx";
import { MrFrame } from "./mr/frame.tsx";

export default function MergeRequestChangesPage() {
  const { params } = useRoute();
  const project = params.id ?? "";
  const iid = Number(params.iid);
  const page = useMergeRequestPage(project, iid);
  const compare = useCompare(page);
  const files = compare.diff.data?.diffs ?? [];
  return (
    <MrFrame project={project} iid={iid} tab="changes" page={page} filesNav={<FilesNav project={project} iid={iid} files={files} />}>
      <DiffScreen key={`${compare.from}:${compare.to}`} page={page} compare={compare} />
    </MrFrame>
  );
}
