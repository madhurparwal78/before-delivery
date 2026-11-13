// `log "Job log"`: the job's lines, `section_start <name>` / `section_end <name>` folded into toggle headers.
import type { Ref } from "preact";
import { useState } from "preact/hooks";
import { Icon } from "../../ui/index.ts";

export interface LogLine {
  n: number;
  stream: string;
  text: string;
}

/** `<n> <stream> <text>`; null for anything else. */
export function parseLogLine(raw: string): LogLine | null {
  const first = raw.indexOf(" ");
  const second = raw.indexOf(" ", first + 1);
  if (first < 1 || second < 0) return null;
  const n = Number(raw.slice(0, first));
  return Number.isInteger(n) ? { n, stream: raw.slice(first + 1, second), text: raw.slice(second + 1) } : null;
}

/** New lines over old ones by line number, so a refetch after a reconnect never doubles a line. */
export function mergeLines(current: readonly LogLine[], incoming: readonly LogLine[]): LogLine[] {
  const byNumber = new Map(current.map((line) => [line.n, line] as const));
  for (const line of incoming) byNumber.set(line.n, line);
  return [...byNumber.values()].sort((a, b) => a.n - b.n);
}

type Entry = { kind: "section"; line: LogLine; name: string } | { kind: "line"; line: LogLine };

function visibleEntries(lines: readonly LogLine[], folded: ReadonlySet<string>): Entry[] {
  const entries: Entry[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const start = line.stream === "sys" ? /^section_start (.+)$/.exec(line.text) : null;
    const end = line.stream === "sys" ? /^section_end (.+)$/.exec(line.text) : null;
    if (start?.[1] !== undefined) {
      open = start[1];
      entries.push({ kind: "section", line, name: start[1] });
    } else if (end) {
      open = null;
    } else if (open === null || !folded.has(open)) {
      entries.push({ kind: "line", line });
    }
  }
  return entries;
}

export function JobLog({ lines, logRef, loading }: { lines: readonly LogLine[]; logRef: Ref<HTMLDivElement>; loading: boolean }) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (name: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  return (
    <div ref={logRef} role="log" aria-label="Job log" aria-live="off" tabIndex={0} class="sp-log sp-mono" aria-busy={loading ? "true" : undefined}>
      {visibleEntries(lines, folded).map((entry) =>
        entry.kind === "section" ? (
          <div key={entry.line.n} class="sp-log__line sp-log__line--section">
            <span class="sp-log__n">{entry.line.n}</span>
            <button type="button" class="sp-log__toggle" aria-label={`Toggle section ${entry.name}`} aria-expanded={folded.has(entry.name) ? "false" : "true"} onClick={() => toggle(entry.name)}>
              <Icon name={folded.has(entry.name) ? "chevron-right" : "chevron-down"} size={16} />
              <span>{entry.name}</span>
            </button>
          </div>
        ) : (
          <div key={entry.line.n} class="sp-log__line" data-stream={entry.line.stream}>
            <span class="sp-log__n">{entry.line.n}</span>
            <span class="sp-log__stream">{entry.line.stream}</span>
            <span class="sp-log__text">{entry.line.text}</span>
          </div>
        ),
      )}
    </div>
  );
}
