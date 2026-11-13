import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { EllipsisVertical, GripVertical } from "lucide-react";
import { prefersReducedMotion } from "../components/Dialog";
import { renderMarkdown } from "../markdown";
import { shownSource, shownType } from "./model";
import type { CellModel, NotebookState } from "./model";
import { Outputs } from "./Output";
import type { NotebookStore } from "./store";

const countLabel = (model: CellModel): string => {
  const { run_state: state, execution_count: count } = model.server;
  if (state === "queued" || state === "running") return "[*]";
  return count === null ? "[ ]" : `[${count}]`;
};

interface CellProps {
  store: NotebookStore;
  state: NotebookState;
  model: CellModel;
  n: number;
  inSelection: boolean;
  isCursor: boolean;
  narrow: boolean;
  onGrab: (id: string, event: ReactPointerEvent) => void;
}

function CellView({ store, state, model, n, inSelection, isCursor, narrow, onGrab }: CellProps): ReactNode {
  const id = model.server.id;
  const type = shownType(model);
  const source = shownSource(model);
  const editor = useRef<HTMLTextAreaElement>(null);
  const viewer = state.meta?.role === "viewer";
  const holder = model.server.locked_by && !state.locks.has(id) ? model.server.locked_by : null;
  const editing = state.mode === "edit" && isCursor;
  const readOnly = viewer || holder !== null;
  const html = useMemo(
    () => (type === "markdown" ? renderMarkdown(source, { notebookId: state.meta?.id ?? "", cellId: id }) : ""),
    [type, source, state.meta?.id, id],
  );
  const name = `${type === "code" ? "Code" : "Markdown"} cell ${n}`;
  const limits = store.limits;

  const onBlur = (): void => {
    queueMicrotask(() => {
      const article = document.getElementById(`cell-${id}`);
      if (store.state.mode === "edit" && article && !article.contains(document.activeElement) && document.hasFocus()) store.leaveEdit(false);
    });
  };

  const showEditor = type === "code" || (editing && !readOnly);
  const lines = Math.max(2, source.split("\n").length);

  return (
    <article
      id={`cell-${id}`}
      aria-label={name}
      tabIndex={isCursor ? 0 : -1}
      className={`cell ${type}${inSelection ? " selected" : ""}${editing ? " editing" : ""}${model.server.run_state === "running" ? " running" : ""}`}
      data-cell={id}
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLElement) || event.target.closest("button, a")) return;
        if (!isCursor || event.shiftKey) store.select(id, event.shiftKey);
      }}
      onDoubleClick={() => {
        store.select(id);
        store.enterEdit();
      }}
    >
      <div className="cell-side">
        {!viewer && (
          <button type="button" className="grip" aria-label={`Move cell ${n}`} onPointerDown={(event) => onGrab(id, event)}>
            <GripVertical size={18} aria-hidden="true" />
          </button>
        )}
        {type === "code" && <span className="count tabular">{countLabel(model)}</span>}
        {narrow && (
          <button type="button" className="btn actions-button" aria-label="Cell actions" onClick={() => { store.select(id); store.open({ kind: "sheet", cellId: id }); }}>
            <EllipsisVertical size={20} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="cell-main">
        {holder && <p className="lock-label">{`Being edited by ${holder}`}</p>}
        {showEditor ? (
          <textarea
            ref={editor}
            className={type === "code" ? "source code" : "source prose"}
            data-source={id}
            aria-label={`Cell ${n} source`}
            aria-readonly={readOnly || undefined}
            readOnly={readOnly}
            spellCheck={false}
            rows={lines}
            wrap="off"
            value={source}
            onChange={(event) => store.edit(id, event.target.value)}
            onFocus={() => {
              if (!isCursor) store.select(id);
              if (state.mode === "command") store.enterEdit();
            }}
            onBlur={onBlur}
          />
        ) : (
          <div className="md" dangerouslySetInnerHTML={{ __html: html || '<p class="muted italic">Empty markdown cell</p>' }} />
        )}
        {model.server.run_state === "not_run" && <p className="not-run">Not run: an earlier cell failed</p>}
        {type === "code" && model.server.outputs.length > 0 && (
          <section className="outputs" role="region" aria-label={`Output of cell ${n}`}>
            <Outputs
              cell={model.server}
              notebookId={state.meta?.id ?? ""}
              limits={{ lineCap: limits.output_line_cap, byteCap: limits.output_byte_cap, pageRows: limits.table_page_rows }}
              onReplaced={() => store.announce("This output was replaced; showing rows from the start.")}
            />
          </section>
        )}
      </div>
    </article>
  );
}

interface Props {
  store: NotebookStore;
  state: NotebookState;
  narrow: boolean;
}

/** A deleted cell shrinking away; it is removed when its motion ends. */
function Ghost({ model, onDone }: { model: CellModel; onDone: () => void }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const motion = box.current?.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scaleY(0.94)" }], { duration: 200, easing: "ease", fill: "forwards" });
    if (motion) motion.onfinish = onDone;
    return () => motion?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={box} className="cell leaving" aria-hidden="true">
      <pre>{shownSource(model)}</pre>
    </div>
  );
}

interface GhostItem {
  model: CellModel;
  index: number;
}

/** The cells region: every cell in server order, a drop line while dragging, and short entry and exit motion. */
export function Cells({ store, state, narrow }: Props): ReactNode {
  const seen = useRef<Set<string> | null>(null);
  const previous = useRef<CellModel[]>([]);
  const tops = useRef(new Map<string, number>());
  const [ghosts, setGhosts] = useState<GhostItem[]>([]);
  const [drop, setDrop] = useState<number | null>(null);
  const region = useRef<HTMLElement>(null);
  const selected = new Set(store.selectedIds());

  useLayoutEffect(() => {
    if (!prefersReducedMotion()) {
      const now = new Set(state.cells.map((m) => m.server.id));
      const gone = previous.current.flatMap((model, index) => (now.has(model.server.id) ? [] : [{ model, index }]));
      if (gone.length && seen.current) setGhosts((list) => [...list, ...gone]);
      for (const m of state.cells) {
        if (seen.current && !seen.current.has(m.server.id)) {
          document.getElementById(`cell-${m.server.id}`)?.animate([{ opacity: 0, transform: "scaleY(0.94)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: "ease" });
        }
      }
      const id = state.moved;
      const element = id ? document.getElementById(`cell-${id}`) : null;
      const before = id ? tops.current.get(id) : undefined;
      if (element && before !== undefined) {
        const delta = before - element.getBoundingClientRect().top;
        if (Math.abs(delta) > 1) element.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], { duration: 200, easing: "ease" });
      }
    }
    previous.current = state.cells;
    seen.current ??= new Set();
    for (const m of state.cells) seen.current.add(m.server.id);
    tops.current = new Map(state.cells.map((m) => [m.server.id, document.getElementById(`cell-${m.server.id}`)?.getBoundingClientRect().top ?? 0]));
  }, [state.cells, state.moved]);

  useEffect(() => {
    if (state.focusToken === 0 || state.cursor === null) return;
    const target = state.mode === "edit" ? document.querySelector<HTMLElement>(`[data-source="${state.cursor}"]`) : document.getElementById(`cell-${state.cursor}`);
    target?.focus({ preventScroll: true });
    document.getElementById(`cell-${state.cursor}`)?.scrollIntoView({ block: "nearest", behavior: "instant" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.focusToken]);

  const grab = (id: string, event: ReactPointerEvent): void => {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const from = store.indexOf(id);
    const slot = (y: number): number => {
      const articles = [...(region.current?.querySelectorAll<HTMLElement>("[data-cell]") ?? [])];
      const at = articles.findIndex((el) => y < el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2);
      return at === -1 ? articles.length : at;
    };
    const over = (e: PointerEvent): void => setDrop(slot(e.clientY));
    const finish = (e: PointerEvent): void => {
      handle.removeEventListener("pointermove", over);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      const to = slot(e.clientY);
      setDrop(null);
      void store.move(id, to > from ? to - 1 : to);
    };
    handle.addEventListener("pointermove", over);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  };

  const rows: ReactNode[] = [];
  const ghostAt = (index: number): ReactNode[] =>
    ghosts
      .filter((g) => g.index === index)
      .map((g) => (
        <Ghost key={`ghost-${g.model.server.id}`} model={g.model} onDone={() => setGhosts((list) => list.filter((x) => x !== g))} />
      ));
  state.cells.forEach((model, index) => {
    rows.push(...ghostAt(index));
    if (drop === index) rows.push(<div key="drop" className="drop-line" aria-hidden="true" />);
    rows.push(
      <CellView
        key={model.server.id}
        store={store}
        state={state}
        model={model}
        n={index + 1}
        inSelection={selected.has(model.server.id)}
        isCursor={state.cursor === model.server.id}
        narrow={narrow}
        onGrab={grab}
      />,
    );
  });
  rows.push(...ghostAt(state.cells.length));
  if (drop === state.cells.length) rows.push(<div key="drop" className="drop-line" aria-hidden="true" />);

  return (
    <section className="cells" role="region" aria-label="Cells" ref={region}>
      {rows}
    </section>
  );
}
