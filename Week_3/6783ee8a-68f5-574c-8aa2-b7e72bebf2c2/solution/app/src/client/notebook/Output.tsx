import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Cell, Output, TableData } from "../../shared/api";
import { TABLE_MIME } from "../../shared/api";
import { isOverCap, removedNotice, streamLines, streamText, tableOf } from "../../shared/outputs";
import { ApiFailure, get } from "../api";
import { renderMarkdown } from "../markdown";
import type { MarkdownContext } from "../markdown";

interface OutputLimits {
  lineCap: number;
  byteCap: number;
  pageRows: number;
}

const asText = (value: unknown): string => (Array.isArray(value) ? value.join("") : String(value ?? ""));

function Stream({ output, cap }: { output: Extract<Output, { output_type: "stream" }>; cap: number }): ReactNode {
  const [all, setAll] = useState(false);
  const lines = streamLines(streamText(output.text));
  const hidden = all ? 0 : Math.max(0, lines.length - cap);
  return (
    <div className={`out stream ${output.name}`}>
      <pre>{(hidden ? lines.slice(0, cap) : lines).join("\n")}</pre>
      {hidden > 0 && (
        <button type="button" className="btn small" onClick={() => setAll(true)}>
          {`Show ${hidden} more lines`}
        </button>
      )}
    </div>
  );
}

interface TableProps {
  cell: Cell;
  index: number;
  table: TableData;
  notebookId: string;
  pageRows: number;
  onReplaced: () => void;
}

/** A table output, a page at a time. The first page is the stored output; later pages come from the server for this output's version. */
function TablePages({ cell, index, table, notebookId, pageRows, onReplaced }: TableProps): ReactNode {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ offset: number; rows: unknown[][] } | null>(null);
  const total = table.rows.length;

  useEffect(() => {
    setPage(null);
    if (offset > 0) {
      setOffset(0);
      onReplaced();
    }
    // A new outputs version replaces the output: paging starts again at the first page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell.outputs_version]);

  const go = async (next: number): Promise<void> => {
    if (next === 0) {
      setOffset(0);
      setPage(null);
      return;
    }
    try {
      const path = `/api/notebooks/${notebookId}/cells/${cell.id}/outputs/${index}/rows?version=${cell.outputs_version}&offset=${next}&limit=${pageRows}`;
      const fetched = await get<{ rows: unknown[][] }>(path);
      setPage({ offset: next, rows: fetched.rows });
      setOffset(next);
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.status !== 409) return;
      setOffset(0);
      setPage(null);
      onReplaced();
    }
  };

  const rows = offset === 0 || page?.offset !== offset ? table.rows.slice(offset, offset + pageRows) : page.rows;
  return (
    <div className="out table">
      <div className="table-scroll">
        <table aria-label="Table output">
          <thead>
            <tr>{table.columns.map((column, i) => <th key={i} scope="col">{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={offset + r}>{row.map((value, c) => <td key={c}>{typeof value === "object" ? JSON.stringify(value) : String(value)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-pager">
        <button type="button" className="btn small" disabled={offset === 0} onClick={() => void go(Math.max(0, offset - pageRows))}>Previous page</button>
        <span className="range tabular">{`Rows ${total === 0 ? 0 : offset + 1}–${Math.min(offset + rows.length, total)} of ${total}`}</span>
        <button type="button" className="btn small" disabled={offset + pageRows >= total} onClick={() => void go(offset + pageRows)}>Next page</button>
      </div>
    </div>
  );
}

function Rich({ data, context }: { data: Record<string, unknown>; context: MarkdownContext }): ReactNode {
  if (data["text/html"] !== undefined) return <div className="out rich" dangerouslySetInnerHTML={{ __html: renderMarkdown(asText(data["text/html"]), context) }} />;
  if (data["text/markdown"] !== undefined) return <div className="out rich md" dangerouslySetInnerHTML={{ __html: renderMarkdown(asText(data["text/markdown"]), context) }} />;
  if (data["image/svg+xml"] !== undefined) {
    return <img className="out image" alt="SVG output" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(asText(data["image/svg+xml"]))}`} />;
  }
  for (const type of ["image/png", "image/jpeg", "image/gif"]) {
    if (data[type] !== undefined) return <img className="out image" alt="Image output" src={`data:${type};base64,${asText(data[type]).replace(/\s/g, "")}`} />;
  }
  return <div className="out result"><pre>{asText(data["text/plain"] ?? JSON.stringify(data))}</pre></div>;
}

interface Props {
  cell: Cell;
  limits: OutputLimits;
  notebookId: string;
  onReplaced: () => void;
}

/** One cell's outputs with the caps applied: a line cap on streams, a byte cap on any output, paged tables. */
export function Outputs({ cell, limits, notebookId, onReplaced }: Props): ReactNode {
  const context = { notebookId, cellId: cell.id };
  return (
    <>
      {cell.outputs.map((output, index) => {
        const key = `${cell.outputs_version}-${index}`;
        if (isOverCap(output, limits.byteCap)) return <div key={key} className="out removed"><pre>{removedNotice(limits.byteCap)}</pre></div>;
        if (output.output_type === "stream") return <Stream key={key} output={output} cap={limits.lineCap} />;
        if (output.output_type === "error") {
          return (
            <div key={key} className="out error">
              <span className="err-label">Error</span> <strong className="err-name">{output.ename}</strong>
              <span>{`: ${output.evalue}`}</span> <span className="err-line muted">{output.traceback[output.traceback.length - 1]}</span>
            </div>
          );
        }
        const table = tableOf(output);
        if (table && TABLE_MIME in output.data) {
          return <TablePages key={`table-${index}`} cell={cell} index={index} table={table} notebookId={notebookId} pageRows={limits.pageRows} onReplaced={onReplaced} />;
        }
        return <Rich key={key} data={output.data} context={context} />;
      })}
    </>
  );
}
