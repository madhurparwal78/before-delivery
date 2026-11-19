import { useRef, useState, type ChangeEvent } from "react";
import type { AttachmentJson } from "../../../server/files.js";
import { api, failureText } from "../../lib/api.js";
import { useAnnounce } from "../../lib/announce.js";
import { Button } from "../../lib/ui.js";

const STATE_WORDS: Record<AttachmentJson["status"], string> = { stored: "stored", queued: "waiting for storage" };

/** The `Attachments` region: the files with their storage state, and a file chooser to add one. */
export function Attachments({ number, files, onChanged }: { number: string; files: AttachmentJson[]; onChanged: () => void }): JSX.Element {
  const announce = useAnnounce();
  const chooser = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState("");

  const upload = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    setError("");
    setUploading((names) => [...names, file.name]);
    api<{ attachment: AttachmentJson }>("POST", `/api/records/${number}/attachments`, body).then(
      (response) => {
        setUploading((names) => names.filter((name) => name !== file.name));
        announce(response.attachment.status === "stored" ? `${file.name} attached.` : `${file.name} is queued until file storage returns.`);
        onChanged();
      },
      (failure: unknown) => {
        setUploading((names) => names.filter((name) => name !== file.name));
        setError(failureText(failure));
        announce(failureText(failure));
      },
    );
  };

  return (
    <section className="rf-section" aria-label="Attachments">
      <h3>Attachments</h3>
      <div>
        <Button variant="outline" onClick={() => chooser.current?.click()}>
          Attach file
        </Button>
        <input ref={chooser} type="file" hidden tabIndex={-1} onChange={upload} />
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <ul className="rf-files">
        {uploading.map((name) => (
          <li key={`up-${name}`} aria-label={`${name}, uploading`} className="rf-file">
            <span>{name}</span>
            <span className="status-block status-outlined">uploading</span>
          </li>
        ))}
        {files.map((file) => (
          <li key={file.id} aria-label={`${file.name}, ${STATE_WORDS[file.status]}`} className="rf-file">
            {file.status === "stored" ? (
              <a href={`/api/attachments/${file.id}`} download={file.name}>
                {file.name}
              </a>
            ) : (
              <span>{file.name}</span>
            )}
            <span className={file.status === "stored" ? "status-block" : "status-block status-outlined"}>{STATE_WORDS[file.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
