// Inspector, Comments and History panels (brief: Inspector, Comments, History, Live inspector).
import { useEffect, useRef, useState } from "preact/hooks";
import { copy, historyText, shapeLabel } from "../../shared/copy";
import { boundingBox, FIELD_RANGE, inRange, type GeometryField } from "../../shared/geometry";
import type { Box, CommentView, Shape, ShapeFields, VersionView } from "../../shared/types";
import { announce } from "../announce";
import { commitFields, selectedShapes, setSelectionLayer } from "./commands";
import type { WorkspaceStore } from "./store";
import { canResolve, isOwner } from "../../shared/rules";

/** The selection as drawn right now, including the person's own drag preview. */
function liveSelection(store: WorkspaceStore): Shape[] {
  const preview = store.dragPreview;
  return selectedShapes(store).map((s) => (preview?.has(s.id) ? { ...s, ...(preview.get(s.id) as Box) } : s));
}

function inspectorHeading(store: WorkspaceStore): string {
  const shapes = selectedShapes(store);
  if (!shapes.length) return "Nothing selected";
  return shapes.length === 1 ? shapeLabel(shapes[0] as Shape) : `${shapes.length} selected`;
}

/**
 * A number field that keeps a focused, uncommitted draft whatever arrives from others. A value outside the
 * field's range, or not a whole number, is refused in place: nothing is sent and the range message shows.
 */
function NumberField({ label, field, value, readOnly, onCommit }: { label: string; field: GeometryField; value: number | null; readOnly: boolean; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const shown = draft ?? (value === null ? "" : String(value));
  const [min, max] = FIELD_RANGE[field];
  const commit = () => {
    if (draft === null) return;
    const n = draft.trim() === "" ? Number.NaN : Number(draft);
    if (!inRange(field, n)) {
      if (!refused) announce(copy.range(min, max));
      setRefused(true);
      return;
    }
    setDraft(null);
    setRefused(false);
    if (n !== value) onCommit(n);
  };
  const id = `field-${label.toLowerCase()}`;
  return (
    <div class="num-field">
      <label for={id}>{label}</label>
      <input id={id} type="number" class="mono" value={shown} readOnly={readOnly || value === null} step={1}
        aria-invalid={refused ? "true" : undefined} aria-describedby={refused ? `${id}-error` : undefined}
        onInput={(e) => {
          setDraft(e.currentTarget.value);
          setRefused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Tab") commit();
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
            setRefused(false);
          }
          if (e.key === "Enter") e.preventDefault();
        }}
        onBlur={commit} />
      {refused && <p id={`${id}-error`} class="field-error">{copy.range(min, max)}</p>}
    </div>
  );
}

function LabelField({ shape, readOnly, store }: { shape: Shape | null; readOnly: boolean; store: WorkspaceStore }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && shape && draft !== shape.label) commitFields(store, { label: draft });
    setDraft(null);
  };
  return (
    <div class="text-field">
      <label for="field-label">Label</label>
      <input id="field-label" value={draft ?? shape?.label ?? ""} readOnly={readOnly || !shape}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          }
        }}
        onBlur={commit} />
    </div>
  );
}

export function InspectorPanel({ store }: { store: WorkspaceStore }) {
  const shapes = liveSelection(store);
  const page = store.page;
  const box = shapes.length ? boundingBox(shapes) : null;
  const single = shapes.length === 1 ? (shapes[0] as Shape) : null;
  const readOnly = !store.editable;
  const commit = (fields: ShapeFields) => commitFields(store, fields);
  const layerIds = new Set(shapes.map((s) => s.layer));
  return (
    <div class="inspector">
      <h2 id="inspector-heading">{inspectorHeading(store)}</h2>
      <div class="num-grid">
        <NumberField label="X" field="x" value={box?.x ?? null} readOnly={readOnly} onCommit={(x) => commit({ x })} />
        <NumberField label="Y" field="y" value={box?.y ?? null} readOnly={readOnly} onCommit={(y) => commit({ y })} />
        <NumberField label="Width" field="w" value={box?.w ?? null} readOnly={readOnly || !single} onCommit={(w) => commit({ w })} />
        <NumberField label="Height" field="h" value={box?.h ?? null} readOnly={readOnly || !single} onCommit={(h) => commit({ h })} />
      </div>
      <LabelField key={single?.id ?? "none"} shape={single} readOnly={readOnly} store={store} />
      <div class="text-field">
        <label for="field-layer">Layer</label>
        <select id="field-layer" disabled={readOnly || !shapes.length} value={layerIds.size === 1 ? [...layerIds][0] : ""}
          onChange={(e) => setSelectionLayer(store, e.currentTarget.value)}>
          {layerIds.size !== 1 && <option value="">{shapes.length ? "Several layers" : "No selection"}</option>}
          {[...(page?.layers ?? [])].sort((a, b) => b.order - a.order).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ comments

function Thread({ store, root, replies, open }: { store: WorkspaceStore; root: CommentView; replies: CommentView[]; open: boolean }) {
  const [reply, setReply] = useState<string | null>(null);
  const shape = store.view?.pages.flatMap((p) => p.shapes).find((s) => s.id === root.shape);
  const resolvable = canResolve(store.role, root.author.id === store.me?.id);
  const send = async () => {
    if (!reply?.trim()) return;
    const res = await store.call("POST", `/api/diagrams/${store.diagramId}/comments`, { shape: root.shape, text: reply, parent: root.id });
    if (res.ok) {
      setReply(null);
      void store.refreshComments();
    }
  };
  return (
    <li class={`thread${open ? " open" : ""}`}>
      <button type="button" class="thread-head" aria-expanded={open} onClick={() => {
        store.openThread = open ? null : root.id;
        store.emit();
      }}>
        <span class="thread-shape">{shape ? shapeLabel(shape) : "Deleted shape"}</span>
        <span class="thread-text">{root.text}</span>
        <span class="thread-meta">{root.author.name}{replies.length ? ` · ${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : ""}</span>
      </button>
      {open && (
        <div class="thread-body">
          {replies.map((r) => <p key={r.id} class="reply"><strong>{r.author.name}</strong> {r.text}</p>)}
          {!root.resolved && (
            <div class="thread-actions">
              {reply === null ? (
                <button type="button" class="ghost" onClick={() => setReply("")}>Reply</button>
              ) : (
                <div class="reply-box">
                  <label class="visually-hidden" for={`reply-${root.id}`}>Reply</label>
                  <textarea id={`reply-${root.id}`} value={reply} onInput={(e) => setReply(e.currentTarget.value)} ref={(el) => {
                    if (el && reply === "") el.focus();
                  }} />
                  <button type="button" class="primary" onClick={send}>Post reply</button>
                </div>
              )}
              {resolvable && (
                <button type="button" class="ghost" onClick={async () => {
                  const res = await store.call("POST", `/api/diagrams/${store.diagramId}/comments/${root.id}/resolve`);
                  if (res.ok) {
                    store.openThread = null;
                    void store.refreshComments();
                  }
                }}>Resolve</button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function CommentsPanel({ store }: { store: WorkspaceStore }) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const target = store.commentTarget ? store.page?.shapes.find((s) => s.id === store.resolve(store.commentTarget as string)) : selectedShapes(store)[0];
  useEffect(() => {
    if (store.composerFocus) box.current?.focus();
  }, [store.composerFocus]);
  const roots = store.comments.filter((c) => !c.parent);
  const open = roots.filter((c) => !c.resolved);
  const resolved = roots.filter((c) => c.resolved);
  const repliesOf = (id: string) => store.comments.filter((c) => c.parent === id);
  const post = async (e: Event) => {
    e.preventDefault();
    if (!target || !text.trim()) return;
    const res = await store.call("POST", `/api/diagrams/${store.diagramId}/comments`, { shape: target.id, text });
    if (res.ok) {
      setText("");
      void store.refreshComments();
    } else if (res.status !== 401) announce(res.error.message);
  };
  return (
    <div class="comments">
      <form class="composer" onSubmit={post}>
        <label for="comment-box">Comment{target ? ` on ${shapeLabel(target)}` : ""}</label>
        <textarea id="comment-box" ref={box} aria-label="Comment" value={text} disabled={!target}
          placeholder={target ? "" : "Select a shape to comment on it."} onInput={(e) => setText(e.currentTarget.value)} />
        <button type="submit" class="primary" disabled={!target}>Post comment</button>
      </form>
      <ul class="threads">
        {open.map((c) => <Thread key={c.id} store={store} root={c} replies={repliesOf(c.id)} open={store.openThread === c.id} />)}
      </ul>
      {!open.length && <p class="muted">No open threads.</p>}
      <h3>{copy.resolvedHeading(resolved.length)}</h3>
      <ul class="threads resolved">
        {resolved.map((c) => <Thread key={c.id} store={store} root={c} replies={repliesOf(c.id)} open={store.openThread === c.id} />)}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ history

export function HistoryPanel({ store, onSave }: { store: WorkspaceStore; onSave: (opener: HTMLElement) => void }) {
  const [restoring, setRestoring] = useState(false);
  const preview = store.preview;
  const restore = async (version: VersionView) => {
    setRestoring(true);
    announce(copy.restoring(version.displayName));
    const res = await store.call<{ version: VersionView; seq: number }>("POST", `/api/diagrams/${store.diagramId}/versions/${version.id}/restore`);
    setRestoring(false);
    if (!res.ok) return;
    store.rememberRestore(res.data.seq);
    store.backToLatest(true);
    store.focusKey = "canvas";
    store.emit();
  };
  return (
    <div class="history">
      {store.editable && <button type="button" class="primary" onClick={(e) => onSave(e.currentTarget)}>Save version</button>}
      {preview && (
        <div class="preview-actions">
          {isOwner(store.role) && (
            <button type="button" class="primary" disabled={restoring} onClick={() => void restore(preview.version)}>Restore this version</button>
          )}
          <button type="button" class="ghost" onClick={() => store.backToLatest()}>Back to latest</button>
          {restoring && <p class="muted">{copy.restoring(preview.version.displayName)}</p>}
        </div>
      )}
      <ul class="versions" aria-label="Versions">
        {store.versions.map((v) => {
          const text = historyText(v.displayName, v.author.name, v.createdAt);
          return (
            <li key={v.id}>
              <a href={`/d/${store.diagramId}?page=${store.pageId}&version=${v.id}`} aria-current={preview?.version.id === v.id ? "true" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  void store.openVersion(v);
                }}>
                <span class="v-name">{v.displayName}</span><span class="v-meta">{text.slice(v.displayName.length, text.lastIndexOf(" · "))}<span class="v-time">{text.slice(text.lastIndexOf(" · "))}</span></span>
              </a>
            </li>
          );
        })}
      </ul>
      {!store.versions.length && <p class="muted">No versions yet. One is saved automatically a few minutes after an edit.</p>}
    </div>
  );
}
