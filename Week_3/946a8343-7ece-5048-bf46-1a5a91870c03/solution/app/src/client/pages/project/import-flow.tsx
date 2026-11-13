// `button "Choose spurpack file"`: opens the native file chooser, uploads the text to the group's import route and either lists
// the file's problems or opens `dialog "Import preview"`. Confirming starts the import and goes to the new project's import page.
import { useRef, useState } from "preact/hooks";
import { Dialog } from "../../a11y/dialog.tsx";
import { api, ApiError, useAction } from "../../api.ts";
import { navigate, requestFocusOnArrival } from "../../router.ts";
import { isRecord } from "../../util.ts";
import { Button } from "../../ui/button.tsx";
import { Notice } from "../../ui/feedback.tsx";
import { Heading } from "../../ui/heading.tsx";
import type { ImportPreview } from "./types.ts";

const MAX_SHOWN = 20;

/** `Project Export.spurpack` -> `project-export`: lower-case a-z, 0-9 and -, 2 to 40 characters. */
function slugFromFile(fileName: string): string {
  const stem = fileName.replace(/\.[^.]*$/, "");
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  if (slug.length >= 2) return slug;
  return slug === "" ? "imported" : `${slug}-1`;
}

function problemLines(error: ApiError): string[] {
  const listed = error.details?.errors;
  if (!Array.isArray(listed)) return [];
  return listed.filter((line): line is string => typeof line === "string").slice(0, MAX_SHOWN);
}

interface Staged {
  upload: ImportPreview;
  slug: string;
}

export function PackChooser({ groupId }: { groupId: number }) {
  const input = useRef<HTMLInputElement>(null);
  const chooser = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const upload = useAction(async (file: File) => {
    setProblems([]);
    const slug = slugFromFile(file.name);
    const text = await file.text();
    try {
      const answer = await api.post<ImportPreview>(`/api/groups/${groupId}/imports?slug=${encodeURIComponent(slug)}`, text, { contentType: "text/plain" });
      setStaged({ upload: answer, slug });
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "invalid_pack") setProblems(problemLines(cause));
      throw cause;
    }
  });

  const confirm = useAction(async () => {
    if (staged === null) return;
    const started = await api.post<unknown>(`/api/imports/${staged.upload.id}/confirm`);
    const project = isRecord(started) && typeof started.project === "number" ? started.project : null;
    if (project === null) throw new ApiError(0, "client_error", "The import did not start.");
    try {
      sessionStorage.setItem(`spurline:import:${project}`, JSON.stringify({ id: staged.upload.id, status: "running", progress: 0, error: null, download: null }));
    } catch {
      // The new page then waits for the first live message instead of reading the stored import.
    }
    const path = `/projects/${project}/-/import`;
    setStaged(null);
    requestFocusOnArrival(path);
    navigate(path);
  });

  const failure = upload.error;
  const preview = staged?.upload.preview;
  return (
    <div class="sp-chooser">
      <input
        ref={input}
        type="file"
        hidden
        tabIndex={-1}
        accept=".spurpack,text/plain"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload.run(file);
        }}
      />
      <Button innerRef={chooser} variant="secondary" pending={upload.pending} onClick={() => input.current?.click()}>
        Choose spurpack file
      </Button>
      {failure !== null && problems.length > 0 ? (
        <Notice>
          <p class="sp-chooser__lead">This file can't be imported.</p>
          <ul class="sp-chooser__problems">
            {problems.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {failure !== null && problems.length === 0 ? <Notice>{failure.message}</Notice> : null}
      <Dialog name="Import preview" open={staged !== null} opener={chooser} initialFocus={confirmButton} onClose={() => setStaged(null)} class="sp-import-dialog">
        <Heading level={2} class="sp-import-dialog__title">
          Import preview
        </Heading>
        {preview ? <p class="sp-import-dialog__text">{`Adds ${preview.commits} commits, ${preview.issues} issues, ${preview.requests} requests.`}</p> : null}
        {confirm.error ? <Notice>{confirm.error.message}</Notice> : null}
        <div class="sp-import-dialog__actions">
          <Button innerRef={confirmButton} pending={confirm.pending} onClick={() => void confirm.run()}>
            Import
          </Button>
          <Button variant="secondary" onClick={() => setStaged(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
