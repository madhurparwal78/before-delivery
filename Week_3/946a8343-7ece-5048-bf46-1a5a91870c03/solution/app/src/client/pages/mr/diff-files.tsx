// The changed-file list for the `navigation "Files"` pane, the drawer and the sheet's Files tab.
// Choosing a file replaces the address (no history entry) and the diff moves to that file.
import { setQuery, useQuery, A } from "../../router.ts";
import { Icon } from "../../ui/icons.tsx";
import { mrPath } from "./data.ts";
import type { DiffFile } from "./diff-types.ts";

const STATUS_MARK = { added: "A", modified: "M", deleted: "D", moved: "R" } as const;

export function FilesNav({ project, iid, files }: { project: string; iid: number; files: readonly DiffFile[] }) {
  const query = useQuery();
  const current = query.get("file");
  if (files.length === 0) return <p class="sp-muted sp-small">No changed files.</p>;
  return (
    <ul class="sp-diff-files">
      {files.map((file) => {
        const next = new URLSearchParams(query);
        next.set("file", file.path);
        next.delete("line");
        return (
          <li key={file.path}>
            <A
              href={`${mrPath(project, iid, "changes")}?${next.toString()}`}
              aria-current={current === file.path ? "true" : undefined}
              class="sp-diff-files__link"
              onClick={(event) => {
                event.preventDefault();
                setQuery({ file: file.path, line: null }, { replace: true });
              }}
            >
              <Icon name="file" size={16} />
              <span class="sp-mono sp-diff-files__path">{file.path}</span>
              <span class="sp-diff-files__mark sp-mono" aria-hidden="true">
                {STATUS_MARK[file.status]}
              </span>
              <span class="sp-visually-hidden">{`, ${file.status}`}</span>
            </A>
          </li>
        );
      })}
    </ul>
  );
}
