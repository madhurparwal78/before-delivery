import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { api, Refusal, UNEXPECTED } from "../api";
import { lineOf } from "../format";
import { Icon } from "../icons";
import { reducedMotion } from "../motion";
import type { Cursor, FileMeta, Member } from "../types";
import { tintOf } from "./rail";

const LINE_PX = 20;
const PAD_TOP = 12;
const PAD_LEFT = 14;
const SAVE_DELAY_MS = 500;
const STRIPE_MS = 180;
const AMBER = "#F2A63A";
const IDLE_STRIPE = "#3A4451";

interface Buffer {
  text: string;
  base: number;
  dirty: boolean;
  saving: boolean;
  timer: number | undefined;
}

export interface EditorHandle {
  open: (fileId: string) => Promise<void>;
  follow: (cursor: Cursor) => Promise<void>;
  fileChanged: (file: FileMeta) => void;
  fileDeleted: (fileId: string, path: string) => void;
  reloadAll: () => Promise<void>;
  activeId: () => string | null;
}

interface EditorProps {
  projectId: string;
  files: Map<string, FileMeta>;
  canWrite: boolean;
  notice: string;
  followLabel: string;
  participants: Member[];
  cursors: Map<string, Cursor>;
  me: string;
  /** The driver whose baton has landed (drives the stripe and solid caret); null between sessions. */
  landedDriver: string | null;
  stripeFrom: { tint: string; key: number } | null;
  onCursor: (fileId: string, line: number, column: number) => void;
  onStopFollow: () => void;
  onActiveChange: (fileId: string | null) => void;
  /** Rendered at the end of the status row, after the status region (the Ledger toggle). */
  statusEnd: React.ReactNode;
}

type Measure = { char: number };

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, handle) {
  const { projectId, files, canWrite, notice, followLabel, participants, cursors, me, landedDriver, stripeFrom } = props;
  const buffers = useRef(new Map<string, Buffer>());
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [, setVersion] = useState(0);
  const [message, setMessage] = useState("");
  const [scroll, setScroll] = useState({ top: 0, left: 0, height: 400 });
  const [measure, setMeasure] = useState<Measure>({ char: 7.8 });
  const [selfCaret, setSelfCaret] = useState<{ line: number; column: number } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const stripe = useRef<HTMLDivElement>(null);
  const wipe = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const escaped = useRef(false);
  const filesRef = useRef(files);
  filesRef.current = files;
  const propsRef = useRef(props);
  propsRef.current = props;
  const activeRef = useRef(active);
  activeRef.current = active;
  const bump = () => setVersion((v) => v + 1);

  const pathOf = (id: string) => filesRef.current.get(id)?.path ?? "this file";

  const load = useCallback(
    async (id: string) => {
      const result = await api<{ file: FileMeta & { content: string } }>(`/api/projects/${projectId}/files/${id}`);
      const existing = buffers.current.get(id);
      if (existing?.timer) window.clearTimeout(existing.timer);
      buffers.current.set(id, { text: result.file.content, base: result.file.revision, dirty: false, saving: false, timer: undefined });
      bump();
    },
    [projectId],
  );

  const restoreSelection = useRef<[number, number, number] | null>(null);

  /** Reloads a file from the server, keeping the caret and scroll where they were when it is the open tab. */
  const reload = useCallback(
    async (id: string) => {
      const element = area.current;
      const keep: [number, number, number] | null =
        element && activeRef.current === id ? [element.selectionStart, element.selectionEnd, element.scrollTop] : null;
      await load(id).catch(() => undefined);
      restoreSelection.current = keep;
      bump();
    },
    [load],
  );

  const save = useCallback(
    async (id: string) => {
      const buffer = buffers.current.get(id);
      if (!buffer || buffer.saving || !buffer.dirty) return;
      buffer.saving = true;
      buffer.timer = undefined;
      const sent = buffer.text;
      setMessage("Saving…");
      try {
        const result = await api<{ file: FileMeta }>(`/api/projects/${projectId}/files/${id}`, {
          method: "PUT",
          body: { content: sent, base_revision: buffer.base },
        });
        buffer.saving = false;
        buffer.base = result.file.revision;
        if (buffer.text === sent) {
          buffer.dirty = false;
          setMessage("All changes saved");
        } else {
          buffer.timer = window.setTimeout(() => void save(id), SAVE_DELAY_MS);
        }
      } catch (error) {
        buffer.saving = false;
        const code = error instanceof Refusal ? error.code : "";
        const path = pathOf(id);
        if (code === "validation" || code === "too_large") {
          setMessage(`${path} is too large to save.`);
          return;
        }
        if (code === "not_found") return;
        setMessage(
          code === "stale_revision"
            ? `A newer version of ${path} was saved. Your change wasn't applied — the editor now shows the latest version.`
            : code === "not_driver" || code === "session_paused"
              ? ""
              : UNEXPECTED,
        );
        void reload(id);
      }
    },
    [projectId, reload],
  );

  const open = useCallback(
    async (id: string) => {
      setTabs((list) => (list.includes(id) ? list : [...list, id]));
      setActive(id);
      if (!buffers.current.has(id)) await load(id);
    },
    [load],
  );

  useImperativeHandle(
    handle,
    () => ({
      open,
      activeId: () => activeRef.current,
      follow: async (cursor) => {
        if (!filesRef.current.has(cursor.file_id)) return;
        pendingScroll.current = cursor.line;
        await open(cursor.file_id);
        bump();
      },
      fileChanged: (file) => {
        const buffer = buffers.current.get(file.id);
        if (buffer && !buffer.dirty && !buffer.saving && file.revision > buffer.base) {
          void reload(file.id);
        }
        bump();
      },
      fileDeleted: (id, path) => {
        const buffer = buffers.current.get(id);
        if (buffer?.timer) window.clearTimeout(buffer.timer);
        buffers.current.delete(id);
        setTabs((list) => {
          if (!list.includes(id)) return list;
          setMessage(`${path} was deleted.`);
          const next = list.filter((t) => t !== id);
          setActive((current) => (current === id ? (next[next.length - 1] ?? null) : current));
          return next;
        });
      },
      reloadAll: async () => {
        const ids = [...buffers.current.keys()];
        await Promise.all(ids.map((id) => (filesRef.current.has(id) ? load(id).catch(() => undefined) : Promise.resolve())));
      },
    }),
    [open, load, reload],
  );

  // Tabs whose file no longer exists close (a restore or import can remove files without a delete frame here).
  useEffect(() => {
    setTabs((list) => {
      const next = list.filter((id) => files.has(id));
      if (next.length === list.length) return list;
      setActive((current) => (current && files.has(current) ? current : (next[next.length - 1] ?? null)));
      return next;
    });
  }, [files]);

  useEffect(() => props.onActiveChange(active), [active]);

  useEffect(() => {
    const probe = document.createElement("span");
    probe.className = "measure";
    probe.textContent = "0".repeat(40);
    document.body.appendChild(probe);
    const read = () => setMeasure({ char: probe.getBoundingClientRect().width / 40 || 7.8 });
    read();
    void document.fonts?.ready.then(read);
    return () => probe.remove();
  }, []);

  const buffer = active ? buffers.current.get(active) : undefined;
  const text = buffer?.text ?? "";
  const lines = text.split("\n").length;

  useLayoutEffect(() => {
    const element = area.current;
    const keep = restoreSelection.current;
    if (element && keep) {
      restoreSelection.current = null;
      element.setSelectionRange(Math.min(keep[0], element.value.length), Math.min(keep[1], element.value.length));
      element.scrollTop = keep[2];
    }
    if (!element || pendingScroll.current === null || !buffer) return;
    const top = PAD_TOP + (pendingScroll.current - 1) * LINE_PX;
    if (top < element.scrollTop || top + LINE_PX > element.scrollTop + element.clientHeight) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2);
    }
    pendingScroll.current = null;
    setScroll({ top: element.scrollTop, left: element.scrollLeft, height: element.clientHeight });
  });

  // Write-stripe: on landing it starts in the old driver's tint and turns amber line by line, top to bottom.
  useLayoutEffect(() => {
    if (!stripeFrom || !stripe.current || !wipe.current) return;
    if (reducedMotion()) return;
    const visible = Math.max(1, Math.min(lines, Math.ceil((area.current?.clientHeight ?? 400) / LINE_PX)));
    stripe.current.style.backgroundColor = stripeFrom.tint;
    const animation = wipe.current.animate([{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)" }], {
      duration: STRIPE_MS,
      easing: `steps(${visible}, end)`,
    });
    const done = () => stripe.current?.style.removeProperty("background-color");
    animation.finished.then(done, done);
    return () => animation.cancel();
  }, [stripeFrom?.key]);

  const onInput = (value: string) => {
    if (!active || !buffer || !canWrite) return;
    buffer.text = value;
    buffer.dirty = true;
    if (buffer.timer) window.clearTimeout(buffer.timer);
    const id = active;
    buffer.timer = window.setTimeout(() => void save(id), SAVE_DELAY_MS);
    bump();
  };

  const reportCursor = () => {
    const element = area.current;
    if (!element || !active) return;
    const at = lineOf(element.value, element.selectionStart);
    props.onCursor(active, at.line, at.column);
    setSelfCaret(element.selectionStart === element.selectionEnd ? at : null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      escaped.current = true;
      props.onStopFollow();
      return;
    }
    if (event.key === "Tab") {
      if (escaped.current || !canWrite || event.shiftKey) {
        escaped.current = false;
        return;
      }
      event.preventDefault();
      props.onStopFollow();
      document.execCommand("insertText", false, "  ");
      return;
    }
    escaped.current = false;
    if (event.key.length === 1 || event.key === "Enter" || event.key === "Backspace" || event.key === "Delete") {
      if (!event.ctrlKey && !event.metaKey) props.onStopFollow();
    }
  };

  const onTabsKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const at = active ? tabs.indexOf(active) : -1;
    const focusTab = (id: string) => {
      setActive(id);
      queueMicrotask(() => document.getElementById(`tab-${id}`)?.focus());
    };
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = tabs[(at + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      if (next) focusTab(next);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? tabs[0] : tabs[tabs.length - 1];
      if (next) focusTab(next);
    } else if (event.key === "Delete" && active) {
      event.preventDefault();
      closeTab(active, true);
    }
  };

  const closeTab = (id: string, refocus = false) => {
    const next = tabs.filter((t) => t !== id);
    setTabs(next);
    if (active === id) {
      const replacement = next[Math.max(0, tabs.indexOf(id) - 1)] ?? null;
      setActive(replacement);
      if (refocus && replacement) queueMicrotask(() => document.getElementById(`tab-${replacement}`)?.focus());
    }
  };

  const first = Math.max(0, Math.floor((scroll.top - PAD_TOP) / LINE_PX));
  const count = Math.ceil(scroll.height / LINE_PX) + 2;
  const numbers = [];
  for (let n = first; n < Math.min(lines, first + count); n++) {
    numbers.push(
      <span key={n} style={{ top: PAD_TOP + n * LINE_PX - scroll.top }}>
        {n + 1}
      </span>,
    );
  }

  const carets = [...cursors.values()]
    .filter((c) => c.user_id !== me && c.file_id === active)
    .map((c) => {
      const solid = c.user_id === landedDriver;
      return (
        <span
          key={c.user_id}
          className={solid ? "caret caret-driver" : "caret caret-viewer"}
          style={
            {
              top: PAD_TOP + (c.line - 1) * LINE_PX - scroll.top,
              left: PAD_LEFT + (c.column - 1) * measure.char - scroll.left,
              "--tint": tintOf(participants, c.user_id),
            } as React.CSSProperties
          }
        />
      );
    });
  const iDrive = landedDriver === me;

  return (
    <div className="editor-main">
      <div className="tabs-row">
        <div role="tablist" aria-label="Open files" aria-owns={tabs.map((id) => `tab-${id}`).join(" ")} />
        <div className="tabs" onKeyDown={onTabsKey}>
          {tabs.map((id) => {
            const path = files.get(id)?.path ?? "";
            const selected = id === active;
            return (
              <div key={id} className={selected ? "tab-wrap is-active" : "tab-wrap"}>
                <button
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  aria-label={path}
                  aria-selected={selected}
                  aria-controls="code-editor"
                  tabIndex={selected ? 0 : -1}
                  className="tab"
                  onClick={() => setActive(id)}
                >
                  <span className="mono">{path}</span>
                  {buffers.current.get(id)?.dirty && <span className="tab-dirty" aria-hidden="true" />}
                </button>
                <button type="button" tabIndex={-1} className="tab-close" aria-label={`Close ${path}`} onClick={() => closeTab(id)}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className={`code${iDrive ? " code-driving" : ""}`}>
        <div className="gutter" aria-hidden="true">
          <div className="line-numbers">{buffer && numbers}</div>
          <div
            ref={stripe}
            className="stripe"
            hidden={!buffer}
            style={
              { "--stripe": landedDriver ? AMBER : IDLE_STRIPE, top: PAD_TOP - scroll.top, height: lines * LINE_PX } as React.CSSProperties
            }
          >
            <div ref={wipe} className="stripe-wipe" />
          </div>
        </div>
        <div className="code-surface">
          <textarea
            ref={area}
            id="code-editor"
            className="code-text"
            aria-label="Code editor"
            aria-readonly={!canWrite || !buffer ? "true" : "false"}
            readOnly={!canWrite || !buffer}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            wrap="off"
            value={text}
            placeholder={buffer ? undefined : props.files.size ? "Open a file from the tree." : "No files yet — create one with New file."}
            onChange={(event) => onInput(event.target.value)}
            onKeyDown={onKeyDown}
            onPointerDown={() => props.onStopFollow()}
            onSelect={reportCursor}
            onKeyUp={reportCursor}
            onFocus={reportCursor}
            onBlur={() => setSelfCaret(null)}
            onScroll={(event) =>
              setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft, height: event.currentTarget.clientHeight })
            }
          />
          <div className="carets" aria-hidden="true">
            {carets}
            {selfCaret && reducedMotion() && document.activeElement === area.current && (
              <span
                className={iDrive ? "caret caret-self caret-driver" : "caret caret-self"}
                style={{ top: PAD_TOP + (selfCaret.line - 1) * LINE_PX - scroll.top, left: PAD_LEFT + (selfCaret.column - 1) * measure.char - scroll.left }}
              />
            )}
          </div>
        </div>
      </div>
      <div className="status-row">
        <p role="status" aria-label="Editor status" className="editor-status">
          {notice && <span className={notice === REMOVED_NOTICE ? "notice notice-removed" : "notice"}>{notice}</span>}
          {followLabel && <span className="follow-label">{followLabel}</span>}
          {message && <span className="save-state">{message}</span>}
        </p>
        {props.statusEnd}
      </div>
    </div>
  );
});

export const REMOVED_NOTICE = "You were removed from this project.";
