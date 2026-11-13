import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiFailure, call } from "./api";
import { Dialog, useDialogClose } from "./Dialog";
import { lines } from "./layout";
import { settings } from "./settings";
import { fileTooLargeMessage, fileTypeMessage, length, LIMITS, MESSAGES, postFieldErrors } from "../shared/rules";
import type { FieldErrors, Post, SectionSummary } from "../shared/types";

type PostDialogProps =
  | { kind: "add"; boardId: string; sections: SectionSummary[]; sectionId: string; announce: (line: string) => void; onPosted: (post: Post) => void; onClose: () => void }
  | { kind: "edit"; post: Post; onSaved: () => void; onClose: () => void };

export function PostDialog(props: PostDialogProps) {
  return (
    <Dialog label={props.kind === "add" ? "Add post" : "Edit post"} sheet={props.kind === "add"} onClose={props.onClose}>
      <PostForm {...props} />
    </Dialog>
  );
}

function PostForm(props: PostDialogProps) {
  const close = useDialogClose();
  const editing = props.kind === "edit";
  const [sectionId, setSectionId] = useState(props.kind === "add" ? props.sectionId : "");
  const [title, setTitle] = useState(props.kind === "edit" ? props.post.title : "");
  const [body, setBody] = useState(props.kind === "edit" ? props.post.body : "");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState("");
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const refuse = (found: FieldErrors, message?: string): void => {
    setErrors(found);
    setAlert(message ?? Object.values(found)[0] ?? "");
  };

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (busy) return;
    const found = postFieldErrors(title, body);
    if (Object.keys(found).length) return refuse(found);
    refuse({});
    setBusy(true);
    try {
      if (props.kind === "add") {
        const form = new FormData();
        form.set("section_id", sectionId);
        form.set("title", title);
        form.set("body", body);
        if (file) {
          form.set("file", file);
          props.announce(lines.uploading(file.name));
        }
        const post = await call<Post>("POST", `/api/boards/${props.boardId}/posts`, form);
        props.onPosted(post);
      } else {
        await call("PATCH", `/api/posts/${props.post.id}`, { title, body, version: props.post.version });
        props.onSaved();
      }
      close();
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.status === 413 && error.body.error === "file_too_large" && file) refuse({ file: fileTooLargeMessage(file.name, settings.uploadMaxBytes) });
      else if (error.status === 415 && file) refuse({ file: fileTypeMessage(file.name) });
      else if (error.status === 503) refuse({}, MESSAGES.uploadsDown);
      else if (error.status === 409) refuse({}, MESSAGES.staleEdit);
      else if (error.status === 422) refuse(error.body.errors ?? {});
      else throw error;
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form className="form" onSubmit={(event) => void submit(event)} onKeyDown={onKeyDown} noValidate>
      <h2 className="form-heading">{editing ? "Edit post" : "Add post"}</h2>
      {props.kind === "add" && (
        <div className="field">
          <label htmlFor="post-section">Section</label>
          <select id="post-section" value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
            {props.sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <div className="field-head">
          <label htmlFor="post-title">Title</label>
          <span className={`small ${length(title.trim()) > LIMITS.title ? "danger" : "muted"}`}>
            {length(title.trim())}/{LIMITS.title}
          </span>
        </div>
        <input id="post-title" data-autofocus value={title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" />
        {errors["title"] && <p className="field-error">{errors["title"]}</p>}
      </div>
      <div className="field">
        <div className="field-head">
          <label htmlFor="post-body">Text</label>
          <span className={`small ${length(body.trim()) > LIMITS.body ? "danger" : "muted"}`}>
            {length(body.trim())}/{LIMITS.body.toLocaleString("en-US")}
          </span>
        </div>
        <textarea id="post-body" rows={5} value={body} onChange={(event) => setBody(event.target.value)} />
        {errors["body"] && <p className="field-error">{errors["body"]}</p>}
      </div>
      {props.kind === "add" && (
        <div className="field">
          <input ref={picker} type="file" hidden tabIndex={-1} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <div className="attach">
            <button type="button" className="quiet" onClick={() => picker.current?.click()}>
              Attach a file
            </button>
            {file && <span className="small muted">{file.name}</span>}
          </div>
          {errors["file"] && <p className="field-error">{errors["file"]}</p>}
        </div>
      )}
      <div role="alert" className="field-error">
        {alert}
      </div>
      <div className="form-actions">
        <button type="button" className="quiet" onClick={close}>
          Cancel
        </button>
        <button type="submit" aria-busy={busy}>
          {editing ? (busy ? "Saving…" : "Save post") : busy ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}
