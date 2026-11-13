// The changed-file list of the overview: one link per file into the changes page, with its added and removed line counts. It follows
// live version messages.
import { api } from "../../api.ts";
import { useLiveResource } from "../../live.ts";
import { A } from "../../router.ts";
import { Notice, Skeleton } from "../../ui/index.ts";
import { concernsRequest, mrBase, mrPath } from "./data.ts";

interface DiffLine {
  type: "context" | "add" | "del";
}

interface DiffFile {
  path: string;
  old_path: string | null;
  status: "added" | "modified" | "deleted" | "moved";
  hunks: Array<{ lines: DiffLine[] }>;
}

function count(file: DiffFile, type: DiffLine["type"]): number {
  return file.hunks.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.type === type).length, 0);
}

export function ChangedFiles({ project, iid }: { project: string; iid: number }) {
  const diff = useLiveResource<DiffFile[]>({
    project,
    types: ["merge_request", "version"],
    deps: [project, iid],
    match: (message) => concernsRequest(iid, message.data),
    load: async (signal) => (await api.get<{ diffs: DiffFile[] }>(`${mrBase(project, iid)}/diff`, { signal })).diffs,
  });
  if (diff.error && diff.data === undefined) return <Notice>{diff.error.message}</Notice>;
  if (diff.data === undefined) return <Skeleton rows={3} height={32} />;
  if (diff.data.length === 0) return <p class="sp-muted">No changed files</p>;
  return (
    <ul class="sp-filelist">
      {diff.data.map((file) => (
        <li key={file.path} class="sp-filelist__item">
          <A href={`${mrPath(project, iid, "changes")}?file=${encodeURIComponent(file.path)}`} class="sp-filelist__link sp-mono">
            {file.path}
          </A>
          <span class="sp-filelist__meta">
            <span class="sp-filelist__status">{file.status}</span>
            <span class="sp-mono">{`+${count(file, "add")} -${count(file, "del")}`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
