// Attach file: opens the chooser unless storage is down, shows progress, announces the start and
// the result in the upload status region, and lists the parent's attachments as download links.
import { Paperclip } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Attachment } from "../api";
import { STORAGE_NOTICE, useServices } from "../services";
import { codePoints, FILE_LIMIT, FILENAME_LIMIT } from "../../shared/text";

/** An upload's response and a live update can each bring the same attachment; it is listed once. */
export function withAttachment(list: Attachment[], attachment: Attachment): Attachment[] {
  return list.some((a) => a.id === attachment.id) ? list : [...list, attachment];
}

export function Attachments(props: { attachments: Attachment[] }): JSX.Element | null {
  if (props.attachments.length === 0) return null;
  return (
    <ul className="attachments">
      {props.attachments.map((a) => (
        <li key={a.id}>
          <Paperclip aria-hidden="true" size={16} strokeWidth={1.5} />
          <a href={`/api/attachments/${a.id}`} download={a.filename}>
            {a.filename}
          </a>
          <span className="mono muted">{Math.max(1, Math.round(a.size / 1024))} KB</span>
        </li>
      ))}
    </ul>
  );
}

export function Uploader(props: { path: string; onUploaded: (attachment: Attachment) => void; compact?: boolean }): JSX.Element {
  const { status, refresh } = useServices();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const storageDown = status?.storage === "unavailable";

  const say = (text: string): void => {
    flushSync(() => setMessage(""));
    setMessage(text);
  };

  const upload = (file: File): void => {
    const name = file.name;
    if (codePoints(name) > FILENAME_LIMIT) return say("That file name is too long. Use 255 characters or fewer.");
    if (file.size === 0) return say(`${name} is empty and was not attached.`);
    if (file.size > FILE_LIMIT) return say(`${name} is too large and was not attached.`);
    const form = new FormData();
    form.append("file", file, name);
    const request = new XMLHttpRequest();
    request.open("POST", props.path);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      setProgress(null);
      if (request.status === 201) {
        const attachment = JSON.parse(request.responseText) as Attachment;
        say(`Attached ${attachment.filename}.`);
        props.onUploaded(attachment);
        return;
      }
      if (request.status >= 500) {
        refresh();
        return say("Upload failed: storage is unavailable. Nothing was attached.");
      }
      if (request.status === 413) return say(`${name} is too large and was not attached.`);
      say(`${name} is empty and was not attached.`);
    };
    request.onerror = () => {
      setProgress(null);
      refresh();
      say("Upload failed: storage is unavailable. Nothing was attached.");
    };
    setProgress(0);
    say(`Uploading ${name}`);
    request.send(form);
  };

  return (
    <div className="uploader">
      <button
        type="button"
        className="button"
        aria-disabled={storageDown ? "true" : undefined}
        onClick={() => {
          if (storageDown) say(STORAGE_NOTICE);
          else input.current?.click();
        }}
      >
        <Paperclip aria-hidden="true" size={18} strokeWidth={1.5} />
        Attach file
      </button>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) upload(file);
        }}
      />
      {progress !== null && <progress aria-label="Upload progress" max={100} value={progress} className="progress" />}
      <p role="status" aria-label="Upload status" aria-live="polite" className="upload-status">
        {message}
      </p>
    </div>
  );
}
