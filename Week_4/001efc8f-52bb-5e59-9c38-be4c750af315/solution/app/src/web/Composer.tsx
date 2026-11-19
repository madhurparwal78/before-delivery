import { useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Paperclip, SendHorizontal, TriangleAlert, X } from "lucide-react";
import { PHOTO_BYTES_LIMIT, PHOTO_COPY, PHOTO_COUNT_LIMIT, photoSignature } from "../shared/photoRules";
import { createOutgoing, uploadProgress } from "./data";
import { useReducedMotion } from "./hooks";
import type { QuoteDraft } from "./Shell";
import { announceUpload } from "./store";
import type { Channel } from "./types";

// Browser-side photo checks: only the leading-byte signature, the per-photo size and the tray
// count (brief: Interactions, Choosing photos). Pixel and decode checks are the server's.
async function hasPhotoSignature(file: File): Promise<boolean> {
  return photoSignature(new Uint8Array(await file.slice(0, 12).arrayBuffer())) !== null;
}

// A version 4 UUID from getRandomValues, which works on any origin.
function clientMessageId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function Composer(props: { channel: Channel; threadRootId: string | null; quote: QuoteDraft | null; onClearQuote: () => void }) {
  const { channel, threadRootId, quote } = props;
  const inThread = threadRootId !== null;
  const [text, setText] = useState("");
  const [tray, setTray] = useState<File[]>([]);
  const [refusals, setRefusals] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const trimmed = text.trim();
    if (trimmed === "" && tray.length === 0) {
      setHint("Write a message or attach a photo.");
      return;
    }
    createOutgoing({
      clientMessageId: clientMessageId(),
      channelId: channel.id,
      threadRootId,
      text: trimmed,
      quote,
      files: tray,
    });
    setText("");
    setTray([]);
    setRefusals([]);
    setHint(null);
    props.onClearQuote();
  };

  const choose = async (files: FileList | null) => {
    if (!files) return;
    const accepted = [...tray];
    const refused: string[] = [];
    for (const file of [...files]) {
      if (!(await hasPhotoSignature(file))) refused.push(PHOTO_COPY.wrongType(file.name));
      else if (file.size > PHOTO_BYTES_LIMIT) refused.push(PHOTO_COPY.tooLarge(file.name));
      else if (accepted.length >= PHOTO_COUNT_LIMIT) refused.push(PHOTO_COPY.tooMany);
      else accepted.push(file);
    }
    setTray(accepted);
    setRefusals(refused);
    if (refused.length > 0) announceUpload(refused.join(" "));
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <form className={`composer${inThread ? " composer-thread" : ""}`} onSubmit={send}>
      {quote ? (
        <div className="quote-preview">
          <div>
            <p className="quote-head">
              Quoting <span className="author">{quote.authorName}</span>
            </p>
            <p className="quote-preview-text">{quote.text}</p>
          </div>
          <button className="button button-icon" type="button" aria-label="Remove quote" onClick={props.onClearQuote}>
            <X aria-hidden="true" size={20} />
          </button>
        </div>
      ) : null}
      {tray.length > 0 ? (
        <ul className="tray" aria-label="Photos to send">
          {tray.map((file, i) => (
            <li key={`${file.name}-${i}`} className="tray-item">
              <span className="tray-name">{file.name}</span>
              <button className="button button-icon" type="button" aria-label={`Remove ${file.name}`} onClick={() => setTray(tray.filter((_, j) => j !== i))}>
                <X aria-hidden="true" size={20} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {refusals.length > 0 ? (
        <ul className="refusals">
          {refusals.map((line, i) => (
            <li key={i}>
              <TriangleAlert aria-hidden="true" size={16} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!inThread ? <UploadBar /> : null}
      <div className="composer-row">
        {!inThread ? (
          <>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden aria-label="Attach photos" onChange={(e) => void choose(e.target.files)} />
            <button className="button button-icon" type="button" aria-label="Attach photos" onClick={() => fileRef.current?.click()}>
              <Paperclip aria-hidden="true" size={20} />
            </button>
          </>
        ) : null}
        <textarea
          className="composer-input"
          aria-label={inThread ? "Reply" : "Message"}
          placeholder={inThread ? "Reply in this thread" : `Message #${channel.name}`}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setHint(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          aria-describedby={hint ? hintId : undefined}
        />
        <button className="button button-primary" type="submit">
          <SendHorizontal aria-hidden="true" size={20} />
          {inThread ? "Send reply" : "Send"}
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="field-error">
          <TriangleAlert aria-hidden="true" size={16} />
          <span>{hint}</span>
        </p>
      ) : null}
    </form>
  );
}

// Visible twin of the Upload progress region: fills with the bytes sent, never ahead of them.
function UploadBar() {
  const fraction = useSyncExternalStore(uploadProgress.subscribe, uploadProgress.get);
  const reduced = useReducedMotion();
  if (fraction === null) return null;
  const shown = reduced ? Math.floor(fraction * 4) / 4 : fraction;
  return (
    <div className="progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)}>
      <span className="progress-fill" style={{ transform: `scaleX(${shown})` }} />
    </div>
  );
}
