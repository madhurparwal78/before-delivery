import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { Files, PreviewMessage, RenderTicket } from "../shared/types";
import { api } from "./api";

export type RenderSource = { files: Files; libraries: string[] } | { penId: string; version?: number };

export interface ConsoleEntry {
  id: number;
  kind: PreviewMessage["kind"];
  text: string;
}

const consoleLimit = 500;

/** The one place a preview message becomes a console line: `<label> <text>`. */
export function consoleEntryText(message: PreviewMessage): string {
  const line = message.kind === "uncaught" && message.line !== null ? ` (line ${message.line})` : "";
  return `${message.kind} ${message.text}${line}`;
}

function isPreviewMessage(data: unknown): data is PreviewMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Record<string, unknown>;
  return message.source === "ashlar-preview" && typeof message.render === "string" && typeof message.nonce === "string" && typeof message.text === "string";
}

export function renderBody(source: RenderSource): unknown {
  if ("penId" in source) return source.version === undefined ? { pen_id: source.penId } : { pen_id: source.penId, version: source.version };
  return { ...source.files, libraries: source.libraries };
}

export interface Preview {
  ticket: RenderTicket | null;
  frameRef: { current: HTMLIFrameElement | null };
  seq: number;
  title: string;
  text: string;
  status: string;
  entries: ConsoleEntry[];
  count: number;
  render: (source: RenderSource) => void;
  clearConsole: () => void;
}

export function usePreview(): Preview {
  const [ticket, setTicket] = useState<RenderTicket | null>(null);
  const ticketRef = useRef<RenderTicket | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const requestRef = useRef(0);
  const entryId = useRef(0);
  const [ready, setReady] = useState({ seq: 0, title: "", text: "", status: "" });
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [count, setCount] = useState(0);

  const render = useCallback((source: RenderSource) => {
    const request = ++requestRef.current;
    void api<RenderTicket>("POST", "/api/renders", renderBody(source)).then((result) => {
      if (!result.ok || request !== requestRef.current) return;
      ticketRef.current = result.data;
      setTicket(result.data);
      setEntries([]);
      setCount(0);
    });
  }, []);

  const clearConsole = useCallback(() => {
    setEntries([]);
    setCount(0);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const current = ticketRef.current;
      const frame = frameRef.current;
      if (!current || !frame || event.source !== frame.contentWindow) return;
      const data: unknown = event.data;
      if (!isPreviewMessage(data) || data.render !== current.render || data.nonce !== current.nonce) return;
      if (data.kind === "ready") {
        setReady((previous) => ({ seq: previous.seq + 1, title: data.title ?? "", text: data.text.trim(), status: "Preview updated" }));
        return;
      }
      const entry: ConsoleEntry = { id: ++entryId.current, kind: data.kind, text: consoleEntryText(data) };
      setEntries((previous) => (previous.length >= consoleLimit ? [...previous.slice(previous.length - consoleLimit + 1), entry] : [...previous, entry]));
      setCount((previous) => previous + 1);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return { ticket, frameRef, ...ready, entries, count, render, clearConsole };
}

export function PreviewRegion({ preview }: { preview: Preview }) {
  return (
    <section
      role="region"
      aria-label="Preview"
      class="preview-region"
      data-render-seq={String(preview.seq)}
      data-preview-title={preview.title}
      data-preview-text={preview.text}
    >
      {preview.ticket && (
        <iframe
          key={preview.ticket.render}
          ref={(element) => {
            preview.frameRef.current = element;
          }}
          src={preview.ticket.url}
          title="Pen preview"
          sandbox="allow-scripts"
          referrerpolicy="no-referrer"
        />
      )}
    </section>
  );
}

export function PreviewStatus({ preview }: { preview: Preview }) {
  return (
    <p role="status" aria-label="Preview status" class="preview-status">
      {preview.status}
    </p>
  );
}

export function ConsoleLog({ preview, hidden }: { preview: Preview; hidden?: boolean }) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [preview.entries]);
  return (
    <div role="log" aria-label="Console" class="console-log" data-count={String(preview.count)} hidden={hidden} ref={logRef}>
      <ul>
        {preview.entries.map((entry) => (
          <li key={entry.id} class={`console-entry console-${entry.kind}`}>
            {entry.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
