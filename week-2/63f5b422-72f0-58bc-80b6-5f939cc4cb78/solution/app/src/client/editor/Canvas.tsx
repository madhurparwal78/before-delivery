import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { notice } from "../../shared/notices.js";
import { camel } from "../../shared/nodecss.js";
import { sanitizeRichText } from "../../shared/richtext.js";
import { declarations } from "../../shared/styles.js";
import { locateOnPage, treeOrder } from "../../shared/tree.js";
import { BREAKPOINT_LABEL, BREAKPOINTS, FRAME_WIDTH, type Breakpoint, type DocNode, type Entry } from "../../shared/types.js";
import { easeOut } from "../ui/motion.js";
import { useEditor, type EditorState } from "./context.js";
import { startDrag } from "./drag.js";

const PAD = 24;
const GAP = 24;
const FAN_MS = 420;
const STAGGER_MS = 90;
const FAN_TOTAL = FRAME_WIDTH.desktop + FRAME_WIDTH.tablet + FRAME_WIDTH.phone;
const MIN_HEIGHT: Record<Breakpoint, number> = { desktop: 800, tablet: 1024, phone: 812 };

function NodeView({ node, bp, entry }: { node: DocNode; bp: Breakpoint; entry?: Entry }) {
  const { state, sync, layoutFrames } = useEditor();
  const { doc } = state;
  const style: Record<string, string> = {};
  for (const [key, value] of declarations(node.styles, bp, doc.tokens)) style[camel(key)] = value;
  let selectedBy: string | undefined;
  for (const [userId, nodeId] of sync.selections) if (nodeId === node.id && userId !== state.meId) selectedBy = userId;
  const bound = (prop: "text" | "imageId") => (entry && node.bind?.[prop] ? (entry.values[node.bind[prop] as string] ?? "") : undefined);
  const level = node.type === "heading" ? (node.props.level ?? 1) : 0;
  const common = {
    "data-node-id": node.id,
    "data-node-type": node.type,
    "data-entry-id": entry?.id,
    "data-selected": state.selectedId === node.id ? "true" : undefined,
    "data-selected-by": selectedBy,
    role: "group",
    "aria-roledescription": node.type,
    "aria-label": node.name,
    className: `pn pn-${node.type}${level ? ` pn-h${level}` : ""}`,
    style: style as CSSProperties,
  };
  const kids = () => node.children.map((child) => <NodeView key={child.id} node={child} bp={bp} entry={entry} />);
  switch (node.type) {
    case "heading":
      return <div {...common}>{bound("text") ?? node.props.text}</div>;
    case "text": {
      const value = bound("text");
      const field = doc.collection.fields.find((f) => f.name === node.bind?.text);
      if (value !== undefined && field?.kind === "rich_text") return <div {...common} dangerouslySetInnerHTML={{ __html: sanitizeRichText(value) }} />;
      return <div {...common}>{value ?? node.props.text}</div>;
    }
    case "button":
      return <div {...common}>{bound("text") ?? node.props.text}</div>;
    case "image": {
      const imageId = bound("imageId") ?? node.props.imageId;
      return (
        <div {...common}>
          {imageId ? (
            <img src={`/api/images/${imageId}`} alt="" draggable={false} onLoad={layoutFrames} style={{ objectPosition: `${node.props.focalX ?? 50}% ${node.props.focalY ?? 50}%` }} />
          ) : (
            <span className="pl-noimage">No image</span>
          )}
        </div>
      );
    }
    case "collection_list": {
      const template = node.children[0];
      const entries = [...doc.collection.entries].sort((a, b) => a.order - b.order);
      return (
        <div {...common}>
          {template && entries.length ? (
            entries.map((e) => (
              <div key={e.id} className="pl-entry" data-collection-row={e.id}>
                <NodeView node={template} bp={bp} entry={e} />
              </div>
            ))
          ) : (
            <p className="pl-empty">{notice.emptyList}</p>
          )}
        </div>
      );
    }
    default:
      return <div {...common}>{kids()}</div>;
  }
}

function frames(state: EditorState): Breakpoint[] {
  if (state.layout === "phone") return ["phone"];
  return state.fan === "closed" ? [state.bp] : [...BREAKPOINTS];
}

function Banners() {
  const { state, act } = useEditor();
  return (
    <>
      {state.storageDown && (
        <div id="storage-banner" role="alert" className="pl-banner pl-banner-alert">
          {notice.storageBanner}
        </div>
      )}
      {state.role === "viewer" && (
        <div id="mode-banner" className="pl-banner">
          {notice.commentMode(state.ownerName)}
        </div>
      )}
      {state.preview && (
        <div id="preview-banner" className="pl-banner pl-banner-preview">
          <span>{notice.preview(state.preview.name)}</span>
          <span className="pl-banner-actions">
            {state.role !== "viewer" && (
              <button type="button" className="pl-primary" onClick={() => act.openDialog({ kind: "restore" })} aria-busy={state.busy.restore || undefined} disabled={state.busy.restore}>
                Restore this version
              </button>
            )}
            <button type="button" className="pl-button" onClick={act.leavePreview}>
              Back to latest
            </button>
          </span>
        </div>
      )}
    </>
  );
}

export function Canvas({ registerLayout }: { registerLayout: (fn: () => void) => void }) {
  const editor = useEditor();
  const { state, act, sync, canvasRef } = editor;
  const stageRef = useRef<HTMLDivElement>(null);
  const latest = useRef(state);
  latest.current = state;
  const shown = frames(state);
  const fanVisible = shown.length > 1;

  const layout = () => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const s = latest.current;
    const pad = s.layout === "phone" ? 0 : PAD;
    const avail = Math.max(120, canvas.clientWidth - pad * 2);
    const progress = Number(canvas.getAttribute("data-fan-progress") ?? "0");
    const list = [...stage.querySelectorAll<HTMLElement>(":scope > [data-frame]")];
    const fit = Math.min(1, (avail - 2 * GAP) / FAN_TOTAL);
    const current: Breakpoint = s.layout === "phone" ? "phone" : s.bp;
    const finalX: Record<Breakpoint, number> = {
      desktop: pad,
      tablet: pad + FRAME_WIDTH.desktop * fit + GAP,
      phone: pad + (FRAME_WIDTH.desktop + FRAME_WIDTH.tablet) * fit + 2 * GAP,
    };
    let height = 0;
    const scales = new Map<Breakpoint, number>();
    for (const frame of list) {
      const bp = frame.getAttribute("data-frame") as Breakpoint;
      const width = FRAME_WIDTH[bp];
      const single = Math.min(1, avail / width);
      const centred = pad + Math.max(0, (avail - width * single) / 2);
      let x = centred;
      let scale = single;
      let opacity = 1;
      if (list.length > 1) {
        const local = bp === "phone" ? Math.max(0, (progress * FAN_MS - STAGGER_MS) / (FAN_MS - STAGGER_MS)) : progress;
        const eased = easeOut(local);
        const start = bp === current ? { x: centred, s: single, o: 1 } : { x: pad + FRAME_WIDTH.desktop * fit * 0.5, s: fit, o: 0 };
        x = start.x + (finalX[bp] - start.x) * eased;
        scale = start.s + (fit - start.s) * eased;
        opacity = start.o + (1 - start.o) * eased;
      }
      scales.set(bp, scale);
      frame.style.transform = `translate(${x.toFixed(2)}px, ${pad}px) scale(${scale.toFixed(4)})`;
      frame.style.opacity = opacity.toFixed(3);
      for (const tag of frame.querySelectorAll<HTMLElement>("[data-updated-tag], .pl-frame-label")) tag.style.transform = `scale(${(1 / scale).toFixed(4)})`;
      height = Math.max(height, frame.offsetHeight * scale);
    }
    stage.style.height = `${Math.ceil(height + pad * 2)}px`;
    const stageBox = stage.getBoundingClientRect();
    const line = stage.querySelector<SVGPathElement>("#cascade-line path");
    if (line && s.selectedId) {
      const boxes = BREAKPOINTS.map((bp) => stage.querySelector(`[data-frame="${bp}"] [data-node-id="${s.selectedId}"]`)?.getBoundingClientRect()).filter(
        (r): r is DOMRect => !!r && r.width > 0,
      );
      const y = (r: DOMRect) => (r.top + r.height / 2 - stageBox.top).toFixed(1);
      const segments = boxes.slice(1).map((to, i) => `M ${(boxes[i].right - stageBox.left).toFixed(1)} ${y(boxes[i])} L ${(to.left - stageBox.left).toFixed(1)} ${y(to)}`);
      line.setAttribute("d", segments.join(" "));
    }
    const frameOf = stage.querySelector<HTMLElement>(`[data-frame="${current}"]`);
    for (const pin of stage.querySelectorAll<HTMLElement>("[data-pin-node]")) {
      const target = frameOf?.querySelector(`[data-node-id="${pin.getAttribute("data-pin-node")}"]`)?.getBoundingClientRect();
      if (!target || target.width === 0) {
        pin.style.display = "none";
        continue;
      }
      pin.style.display = "";
      pin.style.left = `${(target.right - stageBox.left - pin.offsetWidth / 2).toFixed(1)}px`;
      pin.style.top = `${(target.top - stageBox.top - pin.offsetHeight / 2).toFixed(1)}px`;
    }
    const frameBox = frameOf?.getBoundingClientRect();
    const scale = scales.get(current) ?? 1;
    for (const cursor of stage.querySelectorAll<HTMLElement>("[data-cursor-x]")) {
      if (!frameBox) continue;
      cursor.style.left = `${(frameBox.left - stageBox.left + Number(cursor.getAttribute("data-cursor-x")) * scale).toFixed(1)}px`;
      cursor.style.top = `${(frameBox.top - stageBox.top + Number(cursor.getAttribute("data-cursor-y")) * scale).toFixed(1)}px`;
    }
  };
  registerLayout(layout);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setAttribute("data-fan", "closed");
    canvas.setAttribute("data-fan-progress", "0.00");
    const observer = new ResizeObserver(() => layout());
    observer.observe(canvas);
    window.addEventListener("resize", layout);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", layout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nodeAt = (target: EventTarget | null) => (target as Element | null)?.closest?.("[data-frame] [data-node-id]")?.getAttribute("data-node-id") ?? null;
  const onClick = (event: MouseEvent) => {
    const id = nodeAt(event.target);
    if (!id) return;
    act.select(id, { fromCanvas: true });
    canvasRef.current?.focus({ preventScroll: true });
  };
  const onPointerDown = (event: PointerEvent) => {
    const id = nodeAt(event.target);
    if (id && id === state.selectedId && !state.readOnly && state.layout !== "phone") startDrag(event, { kind: "node", nodeId: id }, act);
  };
  const onPointerMove = (event: PointerEvent) => {
    const frame = stageRef.current?.querySelector<HTMLElement>(`[data-frame="${state.layout === "phone" ? "phone" : state.bp}"]`);
    if (!frame) return;
    const box = frame.getBoundingClientRect();
    const scale = box.width / FRAME_WIDTH[frame.getAttribute("data-frame") as Breakpoint];
    act.pointer(Math.round((event.clientX - box.left) / scale), Math.round((event.clientY - box.top) / scale));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget && !(event.target as Element).hasAttribute("data-frame")) return;
    if (event.altKey || event.ctrlKey || event.metaKey || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    const order = treeOrder(state.page.root);
    const at = state.selectedId ? order.findIndex((n) => n.id === state.selectedId) : -1;
    const next = at < 0 ? (event.key === "ArrowDown" ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)));
    if (order[next]) act.select(order[next].id);
  };

  const pins = !fanVisible ? state.threads.filter((t) => t.status === "open" && locateOnPage(state.doc, t.nodeId)?.owner.page.id === state.page.id) : [];
  const cursors = [...sync.cursors].filter(([id, c]) => id !== state.meId && c.pageId === state.page.id && !state.preview);
  const empty = state.page.root.children.length === 0;
  const drop = state.drag?.slot && state.drag.box;

  return (
    <div className="pl-canvas-col">
      <Banners />
      <div
        id="canvas"
        ref={canvasRef}
        role="region"
        aria-label="Canvas"
        tabIndex={0}
        className="pl-canvas pl-ground"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => act.pointer(null, null)}
        onKeyDown={onKeyDown}
      >
        <div className="pl-stage" ref={stageRef}>
          {shown.map((bp) => (
            <div
              key={bp}
              data-frame={bp}
              tabIndex={-1}
              aria-label={`${BREAKPOINT_LABEL[bp]} ${FRAME_WIDTH[bp]} frame`}
              className={`pl-frame pl-surface${state.bp === bp && fanVisible ? " pl-frame-current" : ""}`}
              style={{ width: FRAME_WIDTH[bp], minHeight: MIN_HEIGHT[bp] }}
            >
              <NodeView node={state.page.root} bp={bp} />
              {state.updatedTags.has(bp) && (
                <span data-updated-tag className="pl-updated">
                  Updated
                </span>
              )}
              {fanVisible && (
                <span className="pl-frame-label" aria-hidden="true">
                  {BREAKPOINT_LABEL[bp]} <span className="pl-mono">{FRAME_WIDTH[bp]}</span>
                </span>
              )}
            </div>
          ))}
          {fanVisible && (
            <svg id="cascade-line" aria-hidden="true" className="pl-cascade-line">
              <path d="" />
            </svg>
          )}
          {pins.map((t) => (
            <button
              key={t.id}
              id={`pin-${t.id}`}
              type="button"
              tabIndex={-1}
              className="pl-pin"
              data-pin-node={t.nodeId}
              aria-label={`Comment by ${t.author.name} on ${t.nodeName}`}
              onClick={(e) => {
                e.stopPropagation();
                act.select(t.nodeId);
                if (state.layout === "phone") act.setPhoneSheet("comments");
                else act.openPanel("comments");
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="currentColor" />
              </svg>
            </button>
          ))}
          {cursors.map(([id, c]) => (
            <div key={id} id={`cursor-${id}`} aria-hidden="true" className="pl-cursor" data-cursor-x={c.x} data-cursor-y={c.y}>
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 3l7 18 2.5-7.5L21 11z" fill="currentColor" />
              </svg>
              <span>{c.name}</span>
            </div>
          ))}
        </div>
        {empty && !fanVisible && (
          <div className="pl-empty-page" aria-hidden="true">
            <svg width="96" height="96" viewBox="0 0 96 96" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 82 L14 14 L82 82 Z" />
              <path d="M26 70 L26 44 L52 70 Z" />
              <path d="M14 26 h6 M14 38 h6 M14 50 h6 M14 62 h6 M26 82 v-6 M38 82 v-6 M50 82 v-6 M62 82 v-6" />
            </svg>
            <p>{state.readOnly || state.layout === "phone" ? "This page is empty." : "Press A to add a component"}</p>
          </div>
        )}
      </div>
      {drop && state.drag?.slot && (
        <div
          id="drop-indicator"
          aria-hidden="true"
          data-parent={state.drag.slot.parentId}
          data-index={state.drag.slot.index}
          className="pl-drop"
          style={{ left: drop.left, top: drop.top - 1, width: drop.width }}
        />
      )}
      <div id="announcer" role="status" aria-live="polite" data-announcement-count="0" className="pl-announcer" />
      <div data-toast aria-hidden="true" className="pl-toast" hidden />
    </div>
  );
}
