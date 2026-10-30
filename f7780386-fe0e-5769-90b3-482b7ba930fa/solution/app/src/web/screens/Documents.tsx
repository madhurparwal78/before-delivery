// Documents (member and crew cook): upload a certificate with its expiry date and see what is on file.

import { useRef, useState } from "preact/hooks";
import type { CertificateDocument } from "../../shared/api.js";
import type { Session } from "../App.js";
import { call, get } from "../api.js";
import { perform } from "../feedback.js";
import { DOCUMENT_KIND_WORDS, DOCUMENT_STATUS_WORDS } from "../format.js";
import { Download } from "../icons.js";
import { Cell, EmptyRow, ScreenHead, useData } from "./shared.js";

const KIND_BY_LABEL: Record<string, CertificateDocument["kind"]> = {
  "Liability insurance": "liability_insurance",
  "Food handler card": "food_handler_card",
};

const UPLOAD_REFUSALS: Record<string, string> = {
  unsupported_file_type: "Only PDF, PNG or JPEG files are accepted.",
  file_too_large: "Files must be 5,000,000 bytes or smaller.",
  payload_too_large: "Files must be 5,000,000 bytes or smaller.",
  storage_unavailable: "File storage is unreachable. Nothing was saved; try again shortly.",
};

const FIELD_REFUSALS: Record<string, string> = {
  empty: "That file is empty.",
  invalid_filename: "Rename the file: its name can't contain slashes or two dots in a row.",
  required: "Choose a file to upload.",
  already_expired: "That expiry date has already passed.",
  invalid: "Enter the expiry date as a date.",
};

interface CrewCook {
  id: string;
  name: string;
}

/** The member's crew cooks, as named on the food handler cards the member has on file. */
function crewOnFile(documents: CertificateDocument[]): CrewCook[] {
  const named = new Map<string, string>();
  for (const doc of documents) if (doc.crew_cook_id && doc.crew_cook_name) named.set(doc.crew_cook_id, doc.crew_cook_name);
  return [...named].map(([id, name]) => ({ id, name }));
}

export function DocumentsScreen({ session }: { session: Session }) {
  const { user } = session;
  const crew = user.role === "crew_cook";
  const documents = useData(() => get<{ documents: CertificateDocument[] }>("/api/documents"), []);
  const cooks: CrewCook[] = crew ? [{ id: user.id, name: user.name }] : crewOnFile(documents.data?.documents ?? []);
  const [kind, setKind] = useState(crew ? "Food handler card" : "Liability insurance");
  const [cook, setCook] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const forCard = kind === "Food handler card";
  const chosenCook = crew ? user.id : cook || cooks[0]?.id || "";

  const submit = async (event: Event) => {
    event.preventDefault();
    const form = new FormData();
    form.set("kind", KIND_BY_LABEL[kind] ?? "");
    form.set("expires_on", expires);
    if (forCard) form.set("crew_cook_id", chosenCook);
    const file = fileRef.current?.files?.[0];
    if (file) form.set("file", file, file.name);
    setBusy(true);
    const done = await perform(
      "Uploading…",
      () => call<{ document: CertificateDocument }>("POST", "/api/documents", form),
      () => "Document uploaded and waiting for review.",
      (failure) => {
        const field = failure.body.errors?.file ?? failure.body.errors?.expires_on;
        if (field && FIELD_REFUSALS[field]) return { text: FIELD_REFUSALS[field] };
        return UPLOAD_REFUSALS[failure.body.error] ? { text: UPLOAD_REFUSALS[failure.body.error] } : null;
      },
    );
    setBusy(false);
    if (done) {
      formRef.current?.reset();
      setExpires("");
      await documents.reload();
    }
  };

  const rows = documents.data?.documents ?? [];
  return (
    <section class="screen">
      <ScreenHead title="Documents">
        <p class="screen-head__note">{crew ? "Your food handler card on file with the kitchen." : "Liability insurance for your business and food handler cards for your crew."}</p>
      </ScreenHead>
      <form class="panel form-grid" aria-label="Upload document" ref={formRef} onSubmit={submit} noValidate>
        <label class="field">
          <span class="field__label">Document type</span>
          <select value={kind} onChange={(e) => setKind(e.currentTarget.value)}>
            {!crew && <option value="Liability insurance">Liability insurance</option>}
            <option value="Food handler card">Food handler card</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Crew cook</span>
          <select value={chosenCook} disabled={!forCard} onChange={(e) => setCook(e.currentTarget.value)}>
            {cooks.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span class="field__label">Expires on</span>
          <input type="date" required value={expires} onInput={(e) => setExpires(e.currentTarget.value)} />
        </label>
        <label class="field field--file">
          <span class="field__label">File</span>
          <input type="file" ref={fileRef} accept="application/pdf,image/png,image/jpeg" aria-describedby="file-hint" required />
        </label>
        <p class="field__hint" id="file-hint">
          PDF, PNG or JPEG, up to 5,000,000 bytes
        </p>
        <div class="form-grid__actions">
          <button type="submit" class="button button--primary" disabled={busy} aria-busy={busy ? "true" : "false"}>
            Upload document
          </button>
        </div>
      </form>
      <table class="table">
        <caption>Documents on file</caption>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Person</th>
            <th scope="col">Expires on</th>
            <th scope="col">Status</th>
            <th scope="col">File</th>
          </tr>
        </thead>
        <tbody>
          {!documents.data && <EmptyRow columns={5}>Loading…</EmptyRow>}
          {documents.data && rows.length === 0 && <EmptyRow columns={5}>Nothing on file yet.</EmptyRow>}
          {rows.map((doc) => (
            <tr key={doc.id}>
              <Cell label="Type">{DOCUMENT_KIND_WORDS[doc.kind]}</Cell>
              <Cell label="Person">{doc.crew_cook_name ?? user.business_name ?? user.name}</Cell>
              <Cell label="Expires on">
                {doc.expires_on}
              </Cell>
              <Cell label="Status">
                <span class={`status-word status-word--${doc.status}`}>{DOCUMENT_STATUS_WORDS[doc.status]}</span>
                {doc.rejection_reason && <span class="table__note">{doc.rejection_reason}</span>}
              </Cell>
              <Cell label="File">
                <a class="link-button" href={`/api/documents/${doc.id}/file`} download>
                  <Download />
                  <span>Download</span>
                </a>
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
