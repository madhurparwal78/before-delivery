import { useEffect, useRef, useState } from 'react';
import type { Cell, NotebookOutput, PublishedLimits, TableRowsPage } from '../../shared/types.js';
import {
  isOverByteCap,
  overCapNotice,
  plainText,
  rowRangeText,
  streamLines,
  streamText,
  tableData,
  TABLE_MIME,
} from '../../shared/outputs.js';
import { ApiFailure, apiGet } from '../api.js';
import { HtmlOutput, MarkdownOutput } from './MarkdownView.js';

interface OutputProps {
  notebookId: string;
  cell: Cell;
  index: number;
  output: NotebookOutput;
  limits: PublishedLimits;
  onAnnounce: (message: string) => void;
}

function StreamOutput({ output, limits }: { output: NotebookOutput; limits: PublishedLimits }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const lines = streamLines(streamText(output));
  const hidden = lines.length - limits.output_line_cap;
  const shown = expanded || hidden <= 0 ? lines : lines.slice(0, limits.output_line_cap);
  return (
    <div className={`output-stream ${output.name === 'stderr' ? 'output-stderr' : ''}`}>
      <pre>{shown.join('\n')}</pre>
      {hidden > 0 && !expanded ? (
        <button type="button" className="button-plain" onClick={() => setExpanded(true)}>
          {`Show ${hidden} more lines`}
        </button>
      ) : null}
    </div>
  );
}

function ErrorOutput({ output }: { output: NotebookOutput }): JSX.Element {
  const traceback = Array.isArray(output.traceback) ? (output.traceback as string[]) : [];
  const lineEntry = traceback.find((entry) => /^line \d+$/.test(entry));
  return (
    <div className="output-error">
      <span className="error-label">Error</span>
      <span className="error-name">{String(output.ename)}</span>
      <span className="error-message">{String(output.evalue)}</span>
      {lineEntry ? <span className="error-line">{lineEntry}</span> : null}
    </div>
  );
}

function TableOutput({
  notebookId,
  cell,
  index,
  output,
  limits,
  onAnnounce,
}: OutputProps): JSX.Element {
  const stored = tableData(output);
  const [page, setPage] = useState<TableRowsPage | null>(null);
  const [offset, setOffset] = useState(0);
  const pagedAt = useRef(0);
  pagedAt.current = offset;

  /**
   * A re-run replaces the output. Whoever was paging it goes back to the first
   * page and hears about it, after the run result this change came with.
   */
  const version = cell.outputs_version;
  const shownVersion = useRef(version);
  useEffect(() => {
    if (shownVersion.current === version) return;
    shownVersion.current = version;
    const wasPaging = pagedAt.current > 0;
    setOffset(0);
    if (!wasPaging) return;
    const timer = window.setTimeout(
      () => onAnnounce('This output was replaced; showing rows from the start.'),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [version, onAnnounce]);

  useEffect(() => {
    void (async () => {
      try {
        const answer = await apiGet<TableRowsPage>(
          `/api/notebooks/${encodeURIComponent(notebookId)}/cells/${encodeURIComponent(cell.id)}/outputs/${index}/rows?version=${cell.outputs_version}&offset=${offset}&limit=${limits.table_page_rows}`,
        );
        setPage(answer);
      } catch (error) {
        if (error instanceof ApiFailure && error.code === 'output_replaced') {
          onAnnounce('This output was replaced; showing rows from the start.');
          setOffset(0);
          return;
        }
        throw error;
      }
    })();
  }, [notebookId, cell.id, cell.outputs_version, index, offset, limits.table_page_rows, onAnnounce]);

  const columns = page ? page.columns : (stored?.columns ?? []);
  const rows = page ? page.rows : [];
  const total = page ? page.total : (stored?.rows.length ?? 0);
  const pageOffset = page ? page.offset : offset;

  return (
    <div className="output-table">
      <table aria-label="Table output">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={pageOffset + rowIndex}>
              {row.map((value, valueIndex) => (
                <td key={valueIndex}>{value === null || value === undefined ? '' : String(value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-paging">
        <button
          type="button"
          className="button-plain"
          disabled={pageOffset === 0}
          onClick={() => setOffset(Math.max(0, pageOffset - limits.table_page_rows))}
        >
          Previous page
        </button>
        <span className="table-range">{rowRangeText(pageOffset, rows.length, total)}</span>
        <button
          type="button"
          className="button-plain"
          disabled={pageOffset + rows.length >= total}
          onClick={() => setOffset(pageOffset + limits.table_page_rows)}
        >
          Next page
        </button>
      </div>
    </div>
  );
}

function DataOutput(props: OutputProps): JSX.Element {
  const { output } = props;
  const data = (output.data ?? {}) as Record<string, unknown>;
  if (data[TABLE_MIME] !== undefined && tableData(output) !== null) return <TableOutput {...props} />;
  if (typeof data['text/markdown'] === 'string') {
    return <MarkdownOutput source={data['text/markdown']} />;
  }
  if (typeof data['text/html'] === 'string') return <HtmlOutput html={data['text/html']} />;
  if (typeof data['image/svg+xml'] === 'string') {
    return (
      <img
        className="output-image"
        alt=""
        src={`data:image/svg+xml;utf8,${encodeURIComponent(data['image/svg+xml'])}`}
      />
    );
  }
  return <pre className="output-plain">{plainText(output)}</pre>;
}

/** One stored output, with the published caps and paging applied. */
export function OutputView(props: OutputProps): JSX.Element {
  const { output, limits } = props;
  if (isOverByteCap(output, limits.output_byte_cap)) {
    return <p className="output-plain">{overCapNotice(limits.output_byte_cap)}</p>;
  }
  if (output.output_type === 'stream') return <StreamOutput output={output} limits={limits} />;
  if (output.output_type === 'error') return <ErrorOutput output={output} />;
  return <DataOutput {...props} />;
}
