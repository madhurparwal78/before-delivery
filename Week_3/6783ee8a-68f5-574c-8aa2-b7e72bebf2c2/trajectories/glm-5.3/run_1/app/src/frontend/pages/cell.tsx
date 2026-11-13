import { useState } from "react";
import type { Cell, Checkpoint, CompareResult, LimitsConfig, Notebook, Output, Share } from "../../shared/types.ts";
import { api } from "../api.ts";
import { renderMarkdown } from "../markdown.ts";
import { Dialog } from "../ui.tsx";

export type TocEntry = { level: number; text: string; number: string; anchor: string; cellId: string };

function execLabel(cell: Cell): string {
  if (cell.run_state === "queued" || cell.run_state === "running") return "[*]";
  if (cell.execution_count === null) return "[ ]";
  return `[${cell.execution_count}]`;
}

function thousands(n: number): string {
  return n.toLocaleString("en-US");
}

function outputByteSize(output: Output): number {
  return new TextEncoder().encode(JSON.stringify(output)).length;
}

/** Output rendering in one place: streams with the line cap, tables with paging, errors, displays. */
function OutputView({ output, cell, config, notebookId, page, onPage, onOutputReplaced, resolveAttachment }: {
  output: Output;
  cell: Cell;
  config: LimitsConfig | null;
  notebookId: string;
  page: { index: number; offset: number } | undefined;
  onPage: (entry: { index: number; offset: number }) => void;
  onOutputReplaced: (message: string) => void;
  resolveAttachment: (name: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [table, setTable] = useState<{ columns: string[]; rows: unknown[][]; offset: number; total: number } | null>(null);
  const byteCap = config?.output_byte_cap ?? 1_000_000;
  const lineCap = config?.output_line_cap ?? 200;
  const pageRows = config?.table_page_rows ?? 25;

  if (outputByteSize(output) > byteCap) {
    return (
      <div className="output__error" style={{ fontStyle: "italic" }}>
        Output removed: larger than {thousands(byteCap)} bytes
      </div>
    );
  }

  if (output.output_type === "stream") {
    const allLines = output.text.split("\n");
    const trailingNewline = output.text.endsWith("\n");
    const lines = trailingNewline ? allLines.slice(0, -1) : allLines;
    if (!expanded && lines.length > lineCap) {
      return (
        <div>
          <pre className="output__stream">{lines.slice(0, lineCap).join("\n")}</pre>
          <button className="button--plain" onClick={() => setExpanded(true)}>
            Show {lines.length - lineCap} more lines
          </button>
        </div>
      );
    }
    return <pre className="output__stream">{output.text}</pre>;
  }

  if (output.output_type === "error") {
    const lineMatch = output.traceback.find((line) => line.startsWith("line ")) ?? "";
    const lineNumber = lineMatch === "" ? "" : `line ${lineMatch.slice("line ".length)}`;
    return (
      <div className="output__error">
        <span className="error-label">Error</span>
        <span className="error-name">{output.ename}</span>
        <span> {output.evalue}</span>
        {lineNumber !== "" ? <span> line {output.traceback[1]?.slice("line ".length)}</span> : null}
      </div>
    );
  }

  if (output.output_type === "execute_result") {
    const text = (output.data as Record<string, string>)["text/plain"];
    return <pre className="output__stream">{text}</pre>;
  }

  const data = output.data as Record<string, unknown>;
  const tablePayload = data["application/vnd.brackenpad.table+json"];
  if (tablePayload !== undefined) {
    const index = cell.outputs.indexOf(output);
    return (
      <TableOutput
        notebookId={notebookId}
        cell={cell}
        index={index}
        pageRows={pageRows}
        version={cell.outputs_version}
        initialOffset={page?.offset ?? 0}
        onOffset={(offset) => onPage({ index, offset })}
        table={tablePayload as { columns: string[]; rows: unknown[][] }}
        onOutputReplaced={onOutputReplaced}
      />
    );
  }
  const svg = data["image/svg+xml"];
  if (typeof svg === "string") {
    return <div className="output__html" dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  const html = data["text/html"];
  if (typeof html === "string") {
    return <div className="output__html" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  const markdown = data["text/markdown"];
  if (typeof markdown === "string") {
    return <div className="cell__rendered" dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown, resolveAttachment).html }} />;
  }
  const plain = data["text/plain"];
  if (typeof plain === "string") {
    return <pre className="output__stream">{plain}</pre>;
  }
  return null;
}

function TableOutput({ notebookId, cell, index, pageRows, version, initialOffset, onOffset, table, onOutputReplaced }: {
  notebookId: string;
  cell: Cell;
  index: number;
  pageRows: number;
  version: number;
  initialOffset: number;
  onOffset: (offset: number) => void;
  table: { columns: string[]; rows: unknown[][] };
  onOutputReplaced: (message: string) => void;
}) {
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [offset, setOffset] = useState(initialOffset);
  const [total, setTotal] = useState(table.rows.length);

  const load = async (nextOffset: number) => {
    const result = await api.tableRows(notebookId, cell.id, index, version, nextOffset, pageRows);
    if (result.ok) {
      setRows(result.value.rows);
      setOffset(result.value.offset);
      setTotal(result.value.total);
    } else if (result.error.error === "output_replaced") {
      onOutputReplaced("This output was replaced; showing rows from the start.");
      setOffset(0);
      const fresh = await api.tableRows(notebookId, cell.id, index, (result.error as unknown as { version: number }).version, 0, pageRows);
      if (fresh.ok) {
        setRows(fresh.value.rows);
        setOffset(0);
        setTotal(fresh.value.total);
      }
    }
  };

  if (rows === null) {
    void load(offset);
    return <div className="table-output">Loading…</div>;
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + pageRows, total);
  return (
    <div className="table-output">
      <table aria-label="Table output">
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column}>{String(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, columnIndex) => (
                <td key={columnIndex}>{String(value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-pager">
        <button className="button--plain" disabled={offset === 0} onClick={() => void load(Math.max(0, offset - pageRows))}>Previous page</button>
        <span>Rows {from}–{to} of {total}</span>
        <button className="button--plain" disabled={offset + pageRows >= total} onClick={() => void load(offset + pageRows)}>Next page</button>
      </div>
    </div>
  );
}

export function CellArticle(props: {
  cell: Cell;
  index: number;
  selected: boolean;
  editing: boolean;
  canEdit: boolean;
  isViewer: boolean;
  config: LimitsConfig | null;
  tablePages: { index: number; offset: number } | undefined;
  onTablePage: (entry: { index: number; offset: number }) => void;
  resolveAttachment: (name: string) => string;
  onSelect: () => void;
  onSourceChange: (source: string) => void;
  onRun: () => void;
  onCellActions: () => void;
  onMove: (position: number) => void;
  positionCount: number;
  announce: (message: string) => void;
  announceShared: (message: string) => void;
  notebookId: string;
  onOutputReplaced: (message: string) => void;
}) {
  const { cell, index } = props;
  const [dragOver, setDragOver] = useState<number | null>(null);
  const rendered = cell.cell_type === "markdown" ? renderMarkdown(cell.source, props.resolveAttachment) : null;
  const motionClass = props.selected ? " cell--selected" : "";
  const editingClass = props.editing ? " cell--editing" : "";

  return (
    <article
      id={`cell-${cell.id}`}
      className={`cell${motionClass}${editingClass}`}
      aria-label={`${cell.cell_type === "code" ? "Code" : "Markdown"} cell ${index + 1}`}
      tabIndex={-1}
      onMouseDown={() => props.onSelect()}
    >
      <div className="cell__head">
        <span className="exec-count">{execLabel(cell)}</span>
        <span>{cell.cell_type === "code" ? "Code" : "Markdown"} cell {index + 1}</span>
        {cell.locked_by !== null ? <span className="cell__lock">Being edited by {cell.locked_by}</span> : null}
        {props.canEdit ? (
          <button
            className="cell__drag"
            aria-label={`Move cell ${index + 1}`}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", cell.id);
            }}
            onDragOver={(event) => {
              event.preventDefault();
            }}
          >
            <svg width="18" height="14" viewBox="0 0 18 14" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="3" r="1.6" />
              <circle cx="13" cy="3" r="1.6" />
              <circle cx="5" cy="7" r="1.6" />
              <circle cx="13" cy="7" r="1.6" />
              <circle cx="5" cy="11" r="1.6" />
              <circle cx="13" cy="11" r="1.6" />
            </svg>
          </button>
        ) : null}
        <button className="button--plain cell-actions-button" style={{ minHeight: 44 }} onClick={props.onCellActions}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="8" cy="3" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="8" cy="13" r="1.5" />
          </svg>
        </button>
      </div>
      {cell.locked_by !== null ? (
        <p style={{ margin: "6px 12px", color: "var(--muted)", fontSize: "0.85rem" }}>Being edited by {cell.locked_by}</p>
      ) : null}
      {props.isViewer ? (
        <textarea
          id={`source-${cell.id}`}
          className="cell__source"
          aria-label={`Cell ${index + 1} source`}
          readOnly
          aria-readonly="true"
          value={cell.source}
          rows={Math.max(2, cell.source.split("\n").length)}
        />
      ) : (
        <textarea
          id={`source-${cell.id}`}
          className="cell__source"
          aria-label={`Cell ${index + 1} source`}
          value={cell.source}
          rows={Math.max(2, cell.source.split("\n").length)}
          onChange={(event) => props.onSourceChange(event.target.value)}
        />
      )}
      {cell.run_state === "not_run" ? (
        <p className="cell__skipped">Not run: an earlier cell failed</p>
      ) : null}
      {rendered !== null ? (
        <div className="cell__rendered" dangerouslySetInnerHTML={{ __html: rendered.html }} />
      ) : null}
      {cell.cell_type === "code" && cell.outputs.length > 0 ? (
        <div className="output" aria-label={`Output of cell ${index + 1}`} role="region">
          {cell.outputs.map((output, outputIndex) => (
            <OutputView
              key={outputIndex}
              output={output}
              cell={cell}
              config={props.config}
              notebookId={props.notebookId}
              page={props.tablePages}
              onPage={props.onTablePage}
              onOutputReplaced={props.onOutputReplaced}
              resolveAttachment={props.resolveAttachment}
            />
          ))}
        </div>
      ) : null}
      {dragOver !== null ? <div className="drop-line" /> : null}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(index);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(null);
          const draggedId = event.dataTransfer.getData("text/plain");
          if (draggedId !== cell.id) {
            props.onMove(index);
          }
        }}
      />
    </article>
  );
}

export function NotebookDialogs(props: {
  notebookId: string;
  notebook: Notebook;
  checkpoints: Checkpoint[];
  checkpointPanelOpen: boolean;
  compareResult: { checkpoint: Checkpoint; result: CompareResult } | null;
  revertConfirm: { checkpoint: Checkpoint; cellId: string | null } | null;
  paletteOpen: boolean;
  restartConfirm: boolean;
  shareOpen: boolean;
  contentsDrawerOpen: boolean;
  cellSheetId: string | null;
  tocEntries: TocEntry[];
  paletteOptions: string[];
  canEdit: boolean;
  onCloseCheckpoints: () => void;
  onOpenCompare: (checkpoint: Checkpoint) => void;
  onCloseCompare: () => void;
  onRevert: (checkpoint: Checkpoint, cellId: string | null) => void;
  onConfirmRevert: () => void;
  onCancelRevert: () => void;
  onClosePalette: () => void;
  onPaletteCommand: (command: string) => void;
  onConfirmRestart: () => void;
  onCancelRestart: () => void;
  onCloseShare: () => void;
  onCloseContents: () => void;
  onTocEntry: (entry: TocEntry) => void;
  onCloseCellSheet: () => void;
  onCellSheetAction: (action: "run" | "insert" | "type" | "up" | "down" | "delete") => void;
  onRemoveShare: (shareId: string) => Promise<void>;
}) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"editor" | "viewer">("editor");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteActive, setPaletteActive] = useState(0);

  const loadShares = () => {
    void api.shares(props.notebookId).then((result) => {
      if (result.ok) setShares(result.value.shares);
    });
  };

  return (
    <>
      {props.checkpointPanelOpen ? (
        <Dialog labelledBy="checkpoints-title" onClose={props.onCloseCheckpoints}>
          <div role="region" aria-label="Checkpoints">
            <h2 className="dialog__title" id="checkpoints-title">Checkpoints</h2>
            <div className="cascade">
              {props.checkpoints.slice(0, 3).map((checkpoint, index) => (
                <button
                  key={checkpoint.id}
                  className="cascade-window"
                  style={{ left: `${index * 12}%`, top: `${index * 8}%`, zIndex: 3 - index }}
                  onClick={() => props.onOpenCompare(checkpoint)}
                  aria-label={`Compare #${checkpoint.number} ${checkpoint.label}`}
                >
                  <span className="cascade-window__bar">
                    <span className="cascade-window__dot" />
                    <span className="cascade-window__dot" />
                    <span className="cascade-window__dot" />
                    <span className="cascade-window__title">#{checkpoint.number} {checkpoint.label}</span>
                    <span className="cascade-window__time">{new Date(checkpoint.created_at).toLocaleTimeString()}</span>
                  </span>
                  <span className="cascade-window__body">cells and outputs as saved</span>
                  <span className="cascade-window__saved" style={{ display: "block" }}>Saved</span>
                </button>
              ))}
            </div>
            {props.checkpoints.length > 3 ? (
              <ul className="older-list" aria-label="Older checkpoints">
                {props.checkpoints.slice(3).map((checkpoint) => (
                  <li key={checkpoint.id}>
                    <button className="button--plain" onClick={() => props.onOpenCompare(checkpoint)}>
                      Compare #{checkpoint.number} {checkpoint.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Dialog>
      ) : null}

      {props.compareResult !== null ? (
        <Dialog labelledBy="compare-title" onClose={props.onCloseCompare}>
          <div role="region" aria-label="Checkpoint comparison">
            <h2 className="dialog__title" id="compare-title">
              {props.compareResult.result.counts.modified} modified, {props.compareResult.result.counts.added} added, {props.compareResult.result.counts.removed} removed, {props.compareResult.result.counts.moved} moved
            </h2>
            <div className="compare-split">
              <div className="compare-half" aria-label={`Checkpoint #${props.compareResult.checkpoint.number}`}>
                {props.compareResult.result.rows.map((row, rowIndex) => (
                  <div className="compare-row" key={rowIndex} role="group" aria-label={`Row ${rowIndex + 1}: ${row.tag}`}>
                    <div className="compare-row__tag">{row.tag}</div>
                    <div className="compare-row__diff">
                      {row.source_diff.map((op, opIndex) => (
                        <div key={opIndex} className={op.op === "same" ? "diff-same" : op.op === "removed" ? "diff-removed" : "diff-added"}>
                          {op.line}
                        </div>
                      ))}
                    </div>
                    {row.output_changed ? <div className="compare-row__outputs">Output changed</div> : null}
                  </div>
                ))}
              </div>
              <div className="compare-half" aria-label="Current notebook">
                {props.compareResult.result.rows.map((row, rowIndex) => (
                  <div className="compare-row" key={rowIndex} role="group" aria-label={`Row ${rowIndex + 1}: ${row.tag}`}>
                    <div className="compare-row__tag">{row.tag}</div>
                    <div className="compare-row__diff">
                      {row.current_cell !== null ? row.current_cell.source.split("\n").slice(0, 4).map((line, lineIndex) => (
                        <div key={lineIndex} className="diff-same">{line}</div>
                      )) : <div className="diff-removed">(removed)</div>}
                    </div>
                    {row.output_changed ? <div className="compare-row__outputs">Output changed</div> : null}
                    {row.current_cell !== null ? (
                      <button className="button--accent" onClick={() => props.onRevert(props.compareResult?.checkpoint ?? null as never, row.current_cell?.id ?? null)}>Revert this cell</button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="dialog__actions">
              <button className="button--accent" onClick={() => props.onRevert(props.compareResult?.checkpoint as Checkpoint, null)}>Revert notebook</button>
              <button className="button--plain" onClick={props.onCloseCompare}>Close comparison</button>
            </div>
          </div>
        </Dialog>
      ) : null}

      {props.revertConfirm !== null ? (
        <Dialog labelledBy="revert-title" onClose={props.onCancelRevert}>
          <h2 className="dialog__title" id="revert-title">Revert to {props.revertConfirm.checkpoint.label}?</h2>
          <p>A checkpoint named Before revert is saved first.</p>
          <div className="dialog__actions">
            <button className="button--accent" onClick={props.onConfirmRevert}>Revert</button>
            <button className="button--plain" onClick={props.onCancelRevert}>Cancel</button>
          </div>
        </Dialog>
      ) : null}

      {props.paletteOpen ? (
        <Dialog labelledBy="palette-title" onClose={props.onClosePalette}>
          <h2 className="dialog__title" id="palette-title">Command palette</h2>
          <input
            className="search-input"
            aria-label="Search commands"
            placeholder="Search commands"
            value={paletteQuery}
            onChange={(event) => {
              setPaletteQuery(event.target.value);
              setPaletteActive(0);
            }}
            onKeyDown={(event) => {
              const filtered = props.paletteOptions.filter((option) => option.toLowerCase().includes(paletteQuery.toLowerCase()));
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setPaletteActive(Math.min(paletteActive + 1, filtered.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setPaletteActive(Math.max(paletteActive - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const chosen = filtered[paletteActive];
                if (chosen !== undefined) props.onPaletteCommand(chosen);
              }
            }}
          />
          <ul role="listbox" aria-label="Commands" style={{ listStyle: "none", padding: 0, marginTop: 10 }}>
            {props.paletteOptions
              .filter((option) => option.toLowerCase().includes(paletteQuery.toLowerCase()))
              .map((option, index) => (
                <li key={option} role="option" aria-selected={index === paletteActive}>
                  <button className="button--plain" style={{ width: "100%", textAlign: "left" }} data-active={index === paletteActive} onClick={() => props.onPaletteCommand(option)}>
                    {option}
                  </button>
                </li>
              ))}
          </ul>
        </Dialog>
      ) : null}

      {props.restartConfirm ? (
        <Dialog labelledBy="restart-title" onClose={props.onCancelRestart}>
          <h2 className="dialog__title" id="restart-title">Restart kernel?</h2>
          <p>All variables will be cleared. Outputs stay.</p>
          <div className="dialog__actions">
            <button className="button--accent" onClick={props.onConfirmRestart}>Restart</button>
            <button className="button--plain" onClick={props.onCancelRestart}>Cancel</button>
          </div>
        </Dialog>
      ) : null}

      {props.shareOpen ? (
        <Dialog labelledBy="share-title" onClose={props.onCloseShare} restoreFocusTo={document.activeElement as HTMLElement}>
          <h2 className="dialog__title" id="share-title">Share notebook</h2>
          {shareStatus !== null ? <div className="alert" role="alert"><p style={{ margin: 0 }}>{shareStatus}</p></div> : null}
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setShareStatus("Sending invitation…");
              const result = await api.addShare(props.notebookId, { email: shareEmail, role: shareRole });
              if (result.ok) {
                setShareStatus(`Invitation sent to ${shareEmail}`);
                setShareEmail("");
                loadShares();
              } else if (result.error.error === "already_shared") {
                setShareStatus(`${shareEmail} already has access`);
              } else if (result.error.error === "mail_unavailable") {
                setShareStatus("Invitation not sent: email is unavailable");
              } else {
                setShareStatus("Invitation could not be sent.");
              }
            }}
          >
            <label className="field">
              <span className="field__label">Email</span>
              <input className="field__input" type="email" value={shareEmail} onChange={(event) => setShareEmail(event.target.value)} required />
            </label>
            <fieldset style={{ border: "none", padding: 0 }}>
              <legend className="field__label">Role</legend>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", marginRight: 16, minHeight: 44 }}>
                <input type="radio" name="role" value="editor" checked={shareRole === "editor"} onChange={() => setShareRole("editor")} /> Editor
              </label>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center", minHeight: 44 }}>
                <input type="radio" name="role" value="viewer" checked={shareRole === "viewer"} onChange={() => setShareRole("viewer")} /> Viewer
              </label>
            </fieldset>
            <div className="dialog__actions">
              <button className="button--accent" type="submit">Send invitation</button>
            </div>
          </form>
          <div style={{ marginTop: 12 }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1rem", margin: "8px 0" }}>People with access</h3>
            {shares === null ? <p>Loading…</p> : (
              <ul aria-label="People with access" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
                {shares.map((share) => (
                  <li key={share.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>{share.email} · {share.role} · {share.status}</span>
                    <button
                      className="button--plain"
                      aria-label={`Remove ${share.display_name ?? share.email}`}
                      onClick={async () => {
                        await props.onRemoveShare(share.id);
                        loadShares();
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog>
      ) : null}

      {props.contentsDrawerOpen ? (
        <Dialog labelledBy="contents-title" onClose={props.onCloseContents} drawer>
          <h2 className="dialog__title" id="contents-title">Contents</h2>
          <nav aria-label="Table of contents">
            <ul className="toc__list">
              {props.tocEntries.map((entry) => (
                <li key={`${entry.cellId}-${entry.anchor}`}>
                  <a className="toc__link" href={`#${entry.anchor}`} onClick={(event) => { event.preventDefault(); props.onTocEntry(entry); }}>
                    {entry.number} {entry.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="dialog__actions">
            <button className="button--plain" onClick={props.onCloseContents}>Close</button>
          </div>
        </Dialog>
      ) : null}

      {props.cellSheetId !== null ? (
        <Dialog labelledBy="cell-actions-title" onClose={props.onCloseCellSheet} sheet>
          <h2 className="dialog__title" id="cell-actions-title">Cell actions</h2>
          {props.canEdit ? (
            <div style={{ display: "grid", gap: 8 }}>
              <button className="button--plain" onClick={() => props.onCellSheetAction("run")}>Run</button>
              <button className="button--plain" onClick={() => props.onCellSheetAction("insert")}>Insert below</button>
              <button className="button--plain" onClick={() => props.onCellSheetAction("type")}>Change type</button>
              <button className="button--plain" onClick={() => props.onCellSheetAction("up")}>Move up</button>
              <button className="button--plain" onClick={() => props.onCellSheetAction("down")}>Move down</button>
              <button className="button--plain" onClick={() => props.onCellSheetAction("delete")}>Delete</button>
            </div>
          ) : null}
          <div className="dialog__actions">
            <button className="button--plain" onClick={props.onCloseCellSheet}>Close</button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
