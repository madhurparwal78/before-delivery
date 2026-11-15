import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { flushSync } from "react-dom";
import { PREVIEW_SOURCE, type Files, type PreviewMessage, type RenderTicket } from "../../shared/types.js";
import { api } from "../api.js";

export type RenderSource = { kind: "files"; files: Files; libraries: string[] } | { kind: "pen"; penId: string; version?: number };

interface RenderBody {
  html?: string;
  css?: string;
  js?: string;
  libraries?: string[];
  pen_id?: string;
  version?: number;
}

function bodyOf(source: RenderSource): RenderBody {
  return source.kind === "files"
    ? { ...source.files, libraries: source.libraries }
    : { pen_id: source.penId, ...(source.version === undefined ? {} : { version: source.version }) };
}

export interface Renderer {
  start: (source: RenderSource) => void;
}

function isPreviewMessage(value: unknown): value is PreviewMessage {
  const message = value as Partial<PreviewMessage> | null;
  return (
    message !== null &&
    typeof message === "object" &&
    message.source === PREVIEW_SOURCE &&
    typeof message.render === "string" &&
    typeof message.nonce === "string" &&
    typeof message.kind === "string" &&
    typeof message.text === "string"
  );
}

interface FrameProps {
  initial: RenderSource | null;
  ref?: Ref<Renderer>;
  title: string;
  className?: string;
  tabbable?: boolean;
  onStart?: () => void;
  onMessage?: (message: PreviewMessage) => void;
  onReady?: (details: { title: string; text: string }) => void;
  onLoad?: () => void;
}

export function RenderFrame(props: FrameProps): React.JSX.Element {
  const { title, className, tabbable = true } = props;
  const [url, setUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const issued = useRef(0);
  const current = useRef<{ render: string; nonce: string } | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const begin = (wanted: RenderSource): void => {
    const token = ++issued.current;
    void api
      .post<RenderTicket>("/api/renders", bodyOf(wanted))
      .then((ticket) => {
        if (token !== issued.current) return;
        current.current = { render: ticket.render, nonce: ticket.nonce };
        latest.current.onStart?.();
        setUrl(ticket.url);
        setPending(false);
      })
      .catch(() => {
        if (token === issued.current) setPending(false);
      });
  };
  useImperativeHandle(props.ref, () => ({
    start: (wanted) => {
      begin(wanted);
      flushSync(() => setPending(true));
    },
  }));

  useEffect(() => {
    if (latest.current.initial === null) return;
    begin(latest.current.initial);
    setPending(true);
  }, []);

  useEffect(() => {
    const listen = (event: MessageEvent<unknown>): void => {
      const accepted = current.current;
      const message = event.data;
      if (accepted === null || event.source !== frame.current?.contentWindow || !isPreviewMessage(message)) return;
      if (message.render !== accepted.render || message.nonce !== accepted.nonce) return;
      if (message.kind === "ready") latest.current.onReady?.({ title: message.title ?? "", text: message.text });
      else latest.current.onMessage?.(message);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);

  return (
    <iframe
      ref={frame}
      className={className}
      title={title}
      sandbox="allow-scripts"
      src={url ?? undefined}
      tabIndex={tabbable ? 0 : -1}
      aria-busy={pending}
      onLoad={() => latest.current.onLoad?.()}
    />
  );
}

interface RegionProps {
  initial: RenderSource | null;
  ref?: Ref<Renderer>;
  onStart: () => void;
  onMessage: (message: PreviewMessage) => void;
  className?: string;
}

export function PreviewRegion({ initial, ref, onStart, onMessage, className }: RegionProps): React.JSX.Element {
  const [seq, setSeq] = useState(0);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");

  return (
    <div className={`preview ${className ?? ""}`}>
      <section aria-label="Preview" className="stage" data-render-seq={seq} data-preview-title={title} data-preview-text={text}>
        <RenderFrame
          className="stage-frame"
          title="Pen preview"
          initial={initial}
          ref={ref}
          onStart={() => {
            setStatus("");
            onStart();
          }}
          onMessage={onMessage}
          onReady={(details) => {
            setSeq((count) => count + 1);
            setTitle(details.title);
            setText(details.text);
            setStatus("Preview updated");
          }}
        />
      </section>
      <p role="status" aria-label="Preview status" className="preview-status">
        {status}
      </p>
    </div>
  );
}
