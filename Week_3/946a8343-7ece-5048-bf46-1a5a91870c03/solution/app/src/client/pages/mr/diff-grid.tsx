// The diff drawn as `grid "Diff"`: one rowgroup per file holding a header strip, one `row` per line (inline, or the cells of
// both sides one after the other in the side-by-side view), gap rows with the expand buttons, and the threads and comment box
// that hang under their rows. State lives in diff-view.tsx; this file only draws.
import type { ComponentChildren } from "preact";
import type { ExpandDirection } from "../../../shared/diff.ts";
import { Icon } from "../../ui/icons.tsx";
import type { ThreadView } from "./data.ts";
import { cellAnchor, cellKey, holdsThreads, rowId, rowLabel, rowRefOf, sameRow, type Placement, type Selection } from "./diff-model.ts";
import type { CommentTarget, DiffFile, FileItem, GapItem, LineCell, RowRef, ViewMode } from "./diff-types.ts";

export interface FileSection {
  file: DiffFile;
  items: FileItem[];
  /** Threads of this file that no drawn row can hold: outdated ones and those on lines the diff does not show. */
  tail: ThreadView[];
}

interface DiffGridProps {
  sections: readonly FileSection[];
  view: ViewMode;
  active: RowRef | null;
  selection: Selection | null;
  placement: Placement<ThreadView>;
  /** The comment box and the row it hangs under. */
  composer: { target: CommentTarget; box: ComponentChildren } | null;
  renderThread(thread: ThreadView): ComponentChildren;
  onFocusRow(cell: LineCell): void;
  onNumber(cell: LineCell, extend: boolean): void;
  onExpand(file: DiffFile, gap: number, direction: ExpandDirection): void;
}

const STATUS_WORD = { added: "Added", modified: "Modified", deleted: "Deleted", moved: "Moved" } as const;
const MARK = { added: "+", removed: "-", unchanged: " " } as const;

function Extra({ children, kind }: { children: ComponentChildren; kind: "thread" | "box" }) {
  return (
    <div role="row" class={`sp-diff__extra sp-diff__extra--${kind}`}>
      <div role="gridcell" class="sp-diff__extracell">
        {children}
      </div>
    </div>
  );
}

function covers(selection: Selection | null, cell: LineCell): boolean {
  if (selection === null || selection.path !== cell.path || selection.side !== cell.side) return false;
  return cell.n >= Math.min(selection.anchor, selection.head) && cell.n <= Math.max(selection.anchor, selection.head);
}

function Gap({ item, file, onExpand }: { item: GapItem; file: DiffFile; onExpand: DiffGridProps["onExpand"] }) {
  return (
    <div role="row" class="sp-diff__gap">
      <div role="gridcell" class="sp-diff__gapcell">
        {item.canExpandBelow ? (
          <button type="button" class="sp-diff__expand" onClick={() => onExpand(file, item.gap, "below")}>
            <Icon name="chevron-down" size={18} />
            Expand context below
          </button>
        ) : null}
        {item.canExpandAbove ? (
          <button type="button" class="sp-diff__expand" onClick={() => onExpand(file, item.gap, "above")}>
            <Icon name="chevron-up" size={18} />
            Expand context above
          </button>
        ) : null}
        {item.hidden === null ? null : <span class="sp-diff__hidden">{item.hidden === 1 ? "1 line hidden" : `${item.hidden} lines hidden`}</span>}
      </div>
    </div>
  );
}

function Line({ cell, props, unresolved }: { cell: LineCell; props: DiffGridProps; unresolved: number }) {
  const ref = rowRefOf(cell);
  const active = props.active !== null && sameRow(ref, props.active);
  const numbers =
    cell.col === "i"
      ? [cell.oldNumber, cell.newNumber]
      : cell.col === "l"
        ? [cell.oldNumber]
        : [cell.newNumber];
  return (
    <div
      role="row"
      aria-label={rowLabel(cell, unresolved)}
      tabIndex={active ? 0 : -1}
      class={`sp-diff__row sp-diff__row--${cell.kind} sp-diff__row--${cell.col}`}
      data-row=""
      data-key={rowId(cell)}
      data-path={cell.path}
      data-side={cell.side}
      data-n={cell.n}
      data-holds={holdsThreads(cell) ? "true" : "false"}
      data-selected={covers(props.selection, cell) ? "true" : undefined}
      onFocus={() => props.onFocusRow(cell)}
    >
      {numbers.map((number, index) => (
        <div
          key={index}
          role="gridcell"
          class="sp-diff__num sp-mono"
          onClick={(event) => props.onNumber(cell, event.shiftKey)}
        >
          {number}
        </div>
      ))}
      <div role="gridcell" class="sp-diff__code sp-mono">
        <span class="sp-diff__mark" aria-hidden="true">
          {MARK[cell.kind]}
        </span>
        <span class="sp-diff__text">{cell.text}</span>
      </div>
    </div>
  );
}

function threadsAt(props: DiffGridProps, cell: LineCell | null): readonly ThreadView[] {
  return cell !== null && holdsThreads(cell) ? (props.placement.byAnchor.get(cellAnchor(cell)) ?? []) : [];
}

function holdsComposer(props: DiffGridProps, cell: LineCell | null): boolean {
  const target = props.composer?.target;
  return target !== undefined && cell !== null && holdsThreads(cell) && cell.path === target.path && cell.side === target.side && cell.n === (target.end ?? target.start);
}

function Under({ props, cells }: { props: DiffGridProps; cells: ReadonlyArray<LineCell | null> }) {
  const threads = cells.flatMap((cell) => threadsAt(props, cell));
  const box = cells.some((cell) => holdsComposer(props, cell)) ? props.composer?.box : null;
  return (
    <>
      {threads.map((thread) => (
        <Extra key={thread.id} kind="thread">
          {props.renderThread(thread)}
        </Extra>
      ))}
      {box ? <Extra kind="box">{box}</Extra> : null}
    </>
  );
}

function Items({ section, props }: { section: FileSection; props: DiffGridProps }) {
  const { file } = section;
  return (
    <>
      {section.items.map((item, index) => {
        if (item.kind === "gap") return <Gap key={`g${item.gap}`} item={item} file={file} onExpand={props.onExpand} />;
        if (item.kind === "line") {
          const cell = item.cell;
          return (
            <div key={cellKey(cell)} class="sp-diff__unit">
              <Line cell={cell} props={props} unresolved={threadsAt(props, cell).filter((thread) => !thread.resolved).length} />
              <Under props={props} cells={[cell]} />
            </div>
          );
        }
        const { left, right } = item;
        return (
          <div key={`p${index}`} class="sp-diff__unit sp-diff__unit--pair">
            {left === null ? <div class="sp-diff__void" role="presentation" /> : <Line cell={left} props={props} unresolved={threadsAt(props, left).filter((thread) => !thread.resolved).length} />}
            {right === null ? <div class="sp-diff__void" role="presentation" /> : <Line cell={right} props={props} unresolved={threadsAt(props, right).filter((thread) => !thread.resolved).length} />}
            <Under props={props} cells={[left, right]} />
          </div>
        );
      })}
    </>
  );
}

export function DiffGrid(props: DiffGridProps) {
  return (
    <div role="grid" aria-label="Diff" class={`sp-diff sp-diff--${props.view}`}>
      {props.sections.map((section) => (
        <div key={section.file.path} role="rowgroup" class="sp-diff__file" data-file={section.file.path}>
          <div role="row" class="sp-diff__filehead">
            <div role="columnheader" class="sp-diff__headcell">
              <span class="sp-diff__path sp-mono">{section.file.old_path !== null && section.file.old_path !== section.file.path ? `${section.file.old_path} → ${section.file.path}` : section.file.path}</span>
              <span class="sp-diff__status">{STATUS_WORD[section.file.status]}</span>
            </div>
          </div>
          <Items section={section} props={props} />
          {section.tail.map((thread) => (
            <Extra key={thread.id} kind="thread">
              {props.renderThread(thread)}
            </Extra>
          ))}
        </div>
      ))}
    </div>
  );
}
