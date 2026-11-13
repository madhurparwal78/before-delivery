// File diff blocks on the ground: a bordered surface strip per file (it lightens on hover) over its hunks, wide lines scroll
// inside the block.
import type { DiffLine, FileStatus } from "./types.ts";

interface BlockHunk {
  header: string;
  lines: readonly DiffLine[];
}

interface DiffBlockProps {
  path: string;
  status: FileStatus | null;
  oldPath: string | null;
  hunks: readonly BlockHunk[];
}

const SIGN: Record<DiffLine["type"], string> = { context: " ", add: "+", del: "-" };
const WORD: Record<DiffLine["type"], string> = { context: "unchanged", add: "added", del: "removed" };

export function DiffBlock({ path, status, oldPath, hunks }: DiffBlockProps) {
  const lineCount = hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  return (
    <section class="sp-filediff" aria-label={`Changes in ${path}`}>
      <header class="sp-filebar">
        <span class="sp-filebar__path">{oldPath !== null ? `${oldPath} → ${path}` : path}</span>
        {status ? <span class="sp-filebar__meta">{status}</span> : null}
      </header>
      <div class="sp-filediff__scroll" tabIndex={0} role="region" aria-label={`Lines of ${path}`}>
        {lineCount === 0 ? (
          <p class="sp-filediff__none">No line changes.</p>
        ) : (
          <table class="sp-filediff__table">
            <tbody>
              {hunks.map((hunk, index) => [
                <tr key={`h${index}`} class="sp-filediff__hunk">
                  <td colSpan={4}>{hunk.header}</td>
                </tr>,
                ...hunk.lines.map((line, at) => (
                  <tr key={`h${index}-${at}`} class={`sp-filediff__row sp-filediff__row--${line.type}`}>
                    <td class="sp-filediff__num">{line.old ?? ""}</td>
                    <td class="sp-filediff__num">{line.new ?? ""}</td>
                    <td class="sp-filediff__sign">
                      <span aria-hidden="true">{SIGN[line.type]}</span>
                      <span class="sp-visually-hidden">{WORD[line.type]}</span>
                    </td>
                    <td class="sp-filediff__text">{line.text}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export function DiffFiles({
  diffs,
}: {
  diffs: readonly { path: string; oldPath: string | null; status: FileStatus; hunks: readonly BlockHunk[] }[];
}) {
  return (
    <div class="sp-filediff-list">
      {diffs.map((diff) => (
        <DiffBlock
          key={`${diff.oldPath ?? ""}>${diff.path}`}
          path={diff.path}
          oldPath={diff.oldPath}
          status={diff.status}
          hunks={diff.hunks}
        />
      ))}
    </div>
  );
}
