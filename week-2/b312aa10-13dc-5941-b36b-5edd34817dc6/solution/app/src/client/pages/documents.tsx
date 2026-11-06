import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ApiFailure, get, post, upload } from "../api.js";
import { context, showError, useStore } from "../store.js";
import { useBankMonth } from "../shell.js";
import { Button, Empty, Field, focusFirstInvalid, useAction } from "../ui.js";
import type { DocumentRecord } from "../types.js";
import { DOCUMENT_TYPES } from "../../shared/format.js";
import { variantCopy } from "../../shared/copy.js";

const STATUS: Record<DocumentRecord["status"], string> = {
  submitted: "Submitted", approved: "Approved", expiring: "Expiring", expired: "Expired", superseded: "Superseded",
};

export function DocumentsScreen() {
  const ctx = useStore(context)!;
  const role = ctx.session.user.role;
  const [docs, setDocs] = useState<DocumentRecord[] | null>(null);
  const { busy, run } = useAction();
  useBankMonth(ctx.kitchen.currentMonth);
  const load = (): void => {
    get<{ documents: DocumentRecord[] }>("/api/documents").then(({ data }) => setDocs(data.documents), () => setDocs([]));
  };
  useEffect(load, []);

  /** Redraws one row from the document in a refusal's body. */
  const redrawRow = (current: DocumentRecord): void =>
    setDocs((rows) => rows && rows.map((row) => (row.id === current.id ? current : row)));

  // Approve sends the version the row had when the table loaded.
  const approve = (d: DocumentRecord): void => {
    void run(`approve-${d.id}`, "Approving…", async () => {
      await post(`/api/documents/${d.id}/approve`, { version: d.version });
      load();
      return `Approved ${d.businessName} ${DOCUMENT_TYPES[d.type]}.`;
    }, (error) => {
      if (!(error instanceof ApiFailure) || !error.body.current) return false;
      const current = error.body.current as DocumentRecord;
      redrawRow(current);
      if (error.code === "stale_version") showError(variantCopy("stale_version_document"));
      else if (error.code === "document_superseded") showError(variantCopy("document_superseded", DOCUMENT_TYPES[current.type], current.businessName));
      else showError(variantCopy("invalid_transition_document", STATUS[current.status]));
      return true;
    });
  };

  // The two layouts are built from the same rows; crossing 768 pixels swaps them in place, moving
  // focus to the control with the same name, with no request sent.
  const narrow = useNarrow();
  const rowsRef = useRef<HTMLDivElement>(null);
  const focusName = useRef<string | null>(null);
  narrow.before.current = (): void => {
    const active = document.activeElement as HTMLElement | null;
    focusName.current = active && rowsRef.current?.contains(active) ? active.getAttribute("aria-label") : null;
  };
  useLayoutEffect(() => {
    const name = focusName.current;
    focusName.current = null;
    if (!name) return;
    [...(rowsRef.current?.querySelectorAll<HTMLElement>("a, button") ?? [])].find((el) => el.getAttribute("aria-label") === name)?.focus();
  }, [narrow.value]);

  const download = (d: DocumentRecord) => (
    <a href={`/api/documents/${d.id}/file`} download aria-label={`Download ${DOCUMENT_TYPES[d.type]}`}>Download</a>
  );
  // A pending Approve stays focusable, so focus can follow it across a layout switch; it is
  // aria-disabled and busy, and pressing it again does nothing.
  const approveButton = (d: DocumentRecord) => {
    if (role !== "operator" || d.status !== "submitted") return null;
    const pending = busy === `approve-${d.id}`;
    return (
      <button type="button" class="btn" aria-busy={pending ? "true" : undefined} aria-disabled={pending ? "true" : undefined}
        aria-label={`Approve ${d.businessName} ${DOCUMENT_TYPES[d.type]}`} onClick={() => { if (!pending) approve(d); }}>
        Approve
      </button>
    );
  };
  const pairs = (d: DocumentRecord): Array<[string, string | number]> => [
    ["Business", d.businessName], ["Type", DOCUMENT_TYPES[d.type]], ["Status", STATUS[d.status]],
    ["Version", d.version], ["File", d.fileName], ["Expires", d.expiryDate],
  ];

  return (
    <div class="screen">
      <h1>Documents</h1>
      <div class="grid">
        {role === "member" && <UploadForm onUploaded={load} />}
        <section class={role === "member" ? "panel span-8" : "panel span-12"}>
          <h2>{role === "member" ? "Your documents" : "Member documents"}</h2>
          <div ref={rowsRef}>
            {docs === null ? <p class="loading">Loading…</p> : docs.length === 0 ? <Empty>No documents yet.</Empty> : narrow.value ? (
              <ul class="doc-list" role="list" aria-label="Documents">
                {docs.map((d) => (
                  <li key={d.id} class="doc-card">
                    {pairs(d).map(([label, value]) => (
                      <p class="doc-pair"><span class="doc-label">{label}</span> <span class="doc-value">{value}</span></p>
                    ))}
                    <div class="doc-actions">{download(d)}{approveButton(d)}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <table class="table doc-table" aria-label="Documents">
                <thead>
                  <tr>{["Business", "Type", "Status", "Version", "File", "Expires", "Actions"].map((h) => <th scope="col">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      {pairs(d).map(([label, value]) => <td class={label === "File" || label === "Business" ? "wrap" : undefined}>{value}</td>)}
                      <td><span class="doc-actions">{download(d)}{approveButton(d)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Below 768 CSS pixels (the exact published edge); `before` runs just before the layout swaps. */
function useNarrow(): { value: boolean; before: { current: () => void } } {
  const query = "(min-width: 768px)";
  const [value, setValue] = useState(() => !matchMedia(query).matches);
  const before = useRef<() => void>(() => undefined);
  useEffect(() => {
    const mq = matchMedia(query);
    const update = (): void => {
      const next = !mq.matches;
      before.current();
      setValue(next);
    };
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return { value, before };
}

function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const [type, setType] = useState("");
  const [expiry, setExpiry] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const file = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const { busy, run } = useAction();
  const submit = (e: Event): void => {
    e.preventDefault();
    const chosen = file.current?.files?.[0];
    const body = new FormData();
    body.set("type", type);
    body.set("expiryDate", expiry);
    if (chosen) body.set("file", chosen, chosen.name);
    void run("upload", `Uploading ${chosen?.name ?? "file"}…`, async () => {
      await upload("/api/documents", body);
      setErrors({});
      form.current?.reset();
      setType("");
      setExpiry("");
      onUploaded();
      return "Uploaded. Waiting for approval.";
    }, (error) => {
      if (error instanceof ApiFailure && error.code === "validation_failed") {
        setErrors(error.fieldErrors);
        focusFirstInvalid(form.current);
        return true;
      }
      setErrors({});
      return false;
    });
  };
  return (
    <section class="panel span-4">
      <h2>Upload a document</h2>
      <form ref={form} class="form" onSubmit={submit} noValidate>
        <Field label="Document type" error={errors.type}>
          {(p) => (
            <select {...p} class="input" value={type} onChange={(e) => setType(e.currentTarget.value)}>
              <option value="">Choose a type</option>
              <option value="insurance_certificate">Insurance certificate</option>
              <option value="food_handler_card">Food-handler card</option>
            </select>
          )}
        </Field>
        <Field label="Expiry date" error={errors.expiryDate} hint="YYYY-MM-DD">
          {(p) => <input {...p} class="input" type="text" autoComplete="off" value={expiry} onInput={(e) => setExpiry(e.currentTarget.value)} />}
        </Field>
        <Field label="File" error={errors.file} hint="PDF, PNG or JPEG, up to 5 MB">
          {(p) => <input {...p} ref={file} class="input input-file" type="file" accept="application/pdf,image/png,image/jpeg" />}
        </Field>
        <div class="actions"><Button type="submit" variant="primary" busy={busy === "upload"}>Upload</Button></div>
      </form>
    </section>
  );
}
