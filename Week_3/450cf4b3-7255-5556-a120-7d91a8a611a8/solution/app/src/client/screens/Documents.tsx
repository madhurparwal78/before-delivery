import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { DocumentKind, DocumentRecord } from "../../shared/api.js";
import { dateLabel } from "../../shared/clock.js";
import { api } from "../api.js";
import { Shell, type Session } from "../App.js";
import { coverLabel, DOCUMENT_LABEL, fingerprintText, GENERIC, meStatusLabel, noticeLine, statusChanged, uploadCopy } from "../copy.js";
import { mirrorForm, takeDraft } from "../draft.js";
import { dayOf } from "../kitchen.js";
import { useRefresh, REFRESH_MS } from "../refresh.js";
import type { Screen } from "../router.js";
import { Icon, Notice, ScreenHeading, tell, TicketStub, useArrivalNotice, type NoticeState } from "../ui.js";


/** Opens the file in a new tab, or reports that storage is down instead of showing a raw error there. */
async function openFile(href: string, onStorageDown: (text: string) => void): Promise<void> {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  const result = await api("GET", href);
  if (result.ok) {
    if (tab) tab.location.href = href;
    return;
  }
  tab?.close();
  if (result.status === 503) onStorageDown(uploadCopy.previewsDown);
}

/** Documents on file, newest first: the tenant's own page and the owner's tenant detail share it. */
export function DocumentsTable({ documents, detail, onStorageDown }: { documents: readonly DocumentRecord[]; detail: boolean; onStorageDown: (text: string) => void }): JSX.Element {
  return (
    <table class="table" aria-label="Documents on file">
      <thead>
        <tr>
          <th scope="col">Type</th><th scope="col">Expires</th><th scope="col">Cover</th><th scope="col">Uploaded</th>
          <th scope="col">Fingerprint</th><th scope="col">File</th>
        </tr>
      </thead>
      <tbody>
        {documents.map((d) => {
          const href = `/api/documents/${d.id}/file`;
          return (
            <tr key={d.id} data-current={d.current ? "true" : "false"}>
              <td data-label="Type">
                {DOCUMENT_LABEL[d.kind]}
                {d.notices.length > 0 ? (
                  <ul class="notices">{d.notices.map((n) => <li key={n.point} class="email-line" data-status={n.status}>{noticeLine(n)}</li>)}</ul>
                ) : null}
              </td>
              <td data-label="Expires">{dateLabel(d.expiresOn)}</td>
              <td data-label="Cover" class="cover" data-cover={d.coverState}>{coverLabel(d.coverState, d.daysLeft)}</td>
              <td data-label="Uploaded">{dateLabel(dayOf(d.uploadedAt))}</td>
              <td data-label="Fingerprint" class="mono">{fingerprintText(d.sha256)}</td>
              <td data-label="File">
                {d.hasFile ? (
                  <span class="file-cell">
                    {detail && d.contentType?.startsWith("image/")
                      ? <img class="preview" src={href} alt="" width={40} height={40} onError={() => onStorageDown(uploadCopy.previewsDown)} />
                      : null}
                    <a href={href} target="_blank" rel="noopener" onClick={(e) => { e.preventDefault(); void openFile(href, onStorageDown); }}>Open</a>
                  </span>
                ) : "On paper"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Documents({ session, screen }: { session: Session; screen: Screen }): JSX.Element {
  const userId = session.me.id;
  const [restored] = useState(() => takeDraft(userId));
  const [documents, setDocuments] = useState<DocumentRecord[] | null>(null);
  const [kind, setKind] = useState<DocumentKind>(restored?.kind ?? "insurance_certificate");
  const [expiresOn, setExpiresOn] = useState(restored?.expiresOn ?? "");
  const [limit, setLimit] = useState(restored?.limit ?? "");
  const [insured, setInsured] = useState(restored?.insured ?? false);
  const [file, setFile] = useState<File | null>(restored?.file ?? null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useArrivalNotice();
  const [statusNotice, setStatusNotice] = useState<NoticeState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const lastStatus = useRef(meStatusLabel(session.me));
  const ownChange = useRef(false);

  useEffect(() => {
    if (!restored) return;
    if (restored.file && fileInput.current) {
      const transfer = new DataTransfer();
      transfer.items.add(restored.file);
      fileInput.current.files = transfer.files;
    }
    setNotice(tell(uploadCopy.restored));
  }, []);

  // The form reports its values so a 401 can keep them for the same account's next sign-in.
  useEffect(() => {
    mirrorForm({ userId, kind, expiresOn, limit, insured, file });
  }, [kind, expiresOn, limit, insured, file]);
  useEffect(() => () => mirrorForm(null), []);

  const refresh = useRefresh(async (current) => {
    const [fresh, docs] = await Promise.all([session.refreshMe(), api<{ documents: DocumentRecord[] }>("GET", "/api/documents")]);
    if (!current()) return;
    if (docs.ok) {
      const list = docs.data.documents;
      setDocuments((prev) => (prev && JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
    }
    if (!fresh) return;
    const label = meStatusLabel(fresh);
    if (label === lastStatus.current) return;
    lastStatus.current = label;
    if (ownChange.current) ownChange.current = false;
    else setStatusNotice(tell(statusChanged(label)));
  }, REFRESH_MS);

  const submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData();
    form.set("kind", kind);
    form.set("expiresOn", expiresOn);
    if (kind === "insurance_certificate") {
      form.set("perOccurrenceLimit", limit.replace(/[,\s$]/g, ""));
      form.set("additionalInsured", insured ? "true" : "false");
    }
    if (file) form.set("file", file);
    setBusy(true);
    setErrors({});
    setNotice(tell(uploadCopy.pending));
    const result = await api<DocumentRecord>("POST", "/api/documents", { form });
    setBusy(false);
    if (result.ok) {
      setNotice(tell(uploadCopy.done(result.data.kind, result.data.expiresOn)));
      setExpiresOn("");
      setLimit("");
      setInsured(false);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      ownChange.current = true;
      await refresh();
      ownChange.current = false;
    } else if (result.status === 503) {
      setNotice(tell(uploadCopy.storageDown, "outage"));
    } else if (result.status === 422 && result.error) {
      const fields = result.error.fields ?? {};
      setErrors(fields);
      setNotice(tell(Object.values(fields).join(" ") || GENERIC, "conflict"));
    } else if (result.status !== 401) {
      setNotice(tell(GENERIC, "outage"));
    }
  };

  const describe = (name: string): { "aria-invalid"?: "true"; "aria-describedby"?: string } =>
    errors[name] ? { "aria-invalid": "true", "aria-describedby": `${name}-error` } : {};
  const fieldError = (name: string): JSX.Element | null => (errors[name] ? <p class="field__error" id={`${name}-error`}>{errors[name]}</p> : null);

  return (
    <Shell session={session} screen={screen}>
      <section class="screen">
        <header class="screen__head">
          <ScreenHeading>Your documents</ScreenHeading>
          <p class="status-line">Status: {meStatusLabel(session.me)}</p>
          <Notice notice={statusNotice} />
        </header>
        <div class="documents">
          <form class="panel upload" aria-label="Upload document" onSubmit={(e) => void submit(e)} noValidate>
            <h2>Upload a document</h2>
            <div class="radios" role="radiogroup" aria-label="Document type">
              {(["insurance_certificate", "food_handler_card"] as const).map((k) => (
                <label key={k} class="radio">
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                  {DOCUMENT_LABEL[k]}
                </label>
              ))}
            </div>
            <div class="field">
              <label for="expires-on">Expires on</label>
              <input id="expires-on" type="date" value={expiresOn} onInput={(e) => setExpiresOn(e.currentTarget.value)} {...describe("expiresOn")} />
              {fieldError("expiresOn")}
            </div>
            {kind === "insurance_certificate" ? (
              <>
                <div class="field">
                  <label for="limit">Per-occurrence limit (dollars)</label>
                  <input id="limit" type="text" inputMode="numeric" value={limit} onInput={(e) => setLimit(e.currentTarget.value)} {...describe("perOccurrenceLimit")} />
                  {fieldError("perOccurrenceLimit")}
                </div>
                <div class="field field--check">
                  <input id="insured" type="checkbox" checked={insured} onChange={(e) => setInsured(e.currentTarget.checked)} {...describe("additionalInsured")} />
                  <label for="insured">Names Halfsheet Commissary as additional insured</label>
                </div>
                {fieldError("additionalInsured")}
              </>
            ) : null}
            <div class="field">
              <label for="file">File</label>
              <input id="file" type="file" ref={fileInput} accept="application/pdf,image/png,image/jpeg"
                onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
                aria-describedby={errors.file ? "file-help file-error" : "file-help"} aria-invalid={errors.file ? "true" : undefined} />
              <p class="help" id="file-help">PDF, PNG or JPEG</p>
              {fieldError("file")}
            </div>
            <button type="submit" class="button button--ink" disabled={busy}><Icon name="upload" />Upload</button>
            <Notice notice={notice} />
          </form>
          <section class="panel">
            <h2>Documents on file</h2>
            <DocumentsTable documents={documents ?? []} detail={false} onStorageDown={(text) => setNotice(tell(text, "outage"))} />
            {documents && documents.length === 0
              ? <TicketStub>Upload your certificate of insurance and food-handler card to be reviewed.</TicketStub>
              : null}
          </section>
        </div>
      </section>
    </Shell>
  );
}
