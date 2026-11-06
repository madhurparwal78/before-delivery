import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatTime, groupDigits } from "../../../../shared/format";
import { call, newRetryKey, post } from "../../api";
import { useOffice, type Role } from "../context";
import { FILE_LIMIT, tooLarge } from "../copy";
import { Dialog, focusRefusal, openDialog } from "../dialog";
import { fieldId, SelectField, type Errors } from "../fields";
import { ActionButton, domId, focusId, TableRegion } from "../layout";
import { PanelTitle, useProject } from "../project";
import { useResource } from "../resource";
import { downloadFile } from "./download";
import "./register.css";

// PL-02 Drawings: the drawing register with optimistic multi-file uploads, revision history and transmittal sets.

interface Revision {
  revision: string;
  state: "current" | "superseded";
  bytes: number;
  contentType: string;
  originalName: string;
  note: string;
  uploadedBy: { name: string } | null;
  uploadedAt: string;
}

interface Sheet {
  id: string;
  code: string;
  title: string;
  currentRevision: string;
  revisions: Revision[];
}

interface Transmittal {
  id: string;
  number: string;
  purpose: string;
  issuedAt: string;
  sheets: { code: string; revision: string }[];
}

interface PendingRow {
  key: string;
  name: string;
  code: string;
  leaving: boolean;
}

const EDITORS: Role[] = ["director", "project_lead", "designer"];
const PURPOSES = [
  { value: "for_construction", label: "For construction" },
  { value: "for_tender", label: "For tender" },
  { value: "for_information", label: "For information" },
];
const purposeLabel = (value: string): string => PURPOSES.find((p) => p.value === value)?.label ?? value;
const STORAGE_DOWN_UPLOAD = (name: string): string => `File storage is unreachable, so ${name} wasn't uploaded. Nothing was saved.`;
const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The sheet code a file uploads to: its name without the extension, in capital letters. */
const codeOf = (name: string): string => name.replace(/\.[^.]*$/, "").toUpperCase();

export function DrawingsPanel() {
  const office = useOffice();
  const { project, reloadRevision } = useProject();
  const sheets = useResource<{ sheets: Sheet[] }>(`/api/projects/${project.id}/sheets`);
  const transmittals = useResource<{ transmittals: Transmittal[] }>(`/api/projects/${project.id}/transmittals`);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [history, setHistory] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const chooser = useRef<HTMLInputElement>(null);
  const revisionChooser = useRef<HTMLInputElement>(null);
  const [revisionFor, setRevisionFor] = useState<string | null>(null);
  const canEdit = !!office.member && EDITORS.includes(office.member.role);

  /** Fades a refused row out over 160 ms, then removes it. */
  const dropRow = (key: string): void => {
    const row = document.getElementById(domId("upload", key));
    const remove = (): void => flushSync(() => setPending((rows) => rows.filter((r) => r.key !== key)));
    if (!row || reducedMotion()) {
      remove();
      return;
    }
    flushSync(() => setPending((rows) => rows.map((r) => (r.key === key ? { ...r, leaving: true } : r))));
    row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: "cubic-bezier(0.62, 0, 0.08, 1)", fill: "forwards" })
      .finished.then(remove, remove);
  };

  const upload = async (files: File[], code?: string): Promise<void> => {
    if (!files.length) return;
    const rows = files.map((file, index) => ({ key: `${Date.now()}-${index}-${file.name}`, name: file.name, code: code ?? codeOf(file.name), leaving: false }));
    flushSync(() => setPending((current) => [...rows, ...current]));
    const problems: string[] = [];
    let uploaded = 0;
    for (const [index, file] of files.entries()) {
      const row = rows[index];
      office.announce(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
      const form = new FormData();
      form.append("sheetCode", row.code);
      form.append("title", row.code);
      form.append("file", file, file.name);
      const result = await call<{ revision: Revision; sheet: Sheet }>("POST", `/api/projects/${project.id}/sheet-revisions`, undefined, { raw: form });
      if (result.ok) {
        uploaded++;
        await sheets.reload();
        flushSync(() => setPending((current) => current.filter((r) => r.key !== row.key)));
        office.announce(`${file.name} added as ${result.data.sheet.code} revision ${result.data.revision.revision}.`);
        continue;
      }
      const body = office.refused(result);
      if (!body) {
        flushSync(() => setPending((current) => current.filter((r) => r.key !== row.key)));
        if (result.status === 401 || result.body.error === "access_removed") return;
        continue;
      }
      if (body.error === "storage_unavailable") problems.push(STORAGE_DOWN_UPLOAD(file.name));
      else if (body.error === "file_too_large" || body.error === "body_too_large") problems.push(`${file.name} wasn't uploaded: ${tooLarge(file.name, FILE_LIMIT)}`);
      else problems.push(`${file.name} wasn't uploaded: ${Object.values(body.errors ?? {})[0] ?? "it was refused"}`);
      office.alert(problems.join(" "));
      dropRow(row.key);
    }
    office.announce(`${uploaded} of ${files.length} files uploaded.`);
  };

  const list = sheets.data?.sheets ?? [];
  const issued = transmittals.data?.transmittals ?? [];

  return (
    <>
      <PanelTitle section="drawings" />
      <div className="panel-heading">
        <div>
          <h2>Drawing register</h2>
          <p className="panel-lede">{list.length} sheets · revisions run A, B, C on, skipping I and O</p>
        </div>
        {canEdit && (
          <div className="actions">
            <button type="button" className="button button-primary" onClick={() => chooser.current?.click()}>Upload sheets</button>
            <button type="button" className="button" onClick={() => setIssuing(true)}>Issue set</button>
            <input ref={chooser} type="file" multiple hidden aria-label="Sheet files" accept=".pdf,.png,.jpg,.jpeg,.svg"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                void upload(files);
              }} />
            <input ref={revisionChooser} type="file" hidden aria-label="Revision file" accept=".pdf,.png,.jpg,.jpeg,.svg"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (revisionFor) void upload(files, revisionFor);
              }} />
          </div>
        )}
      </div>
      <div className="panel-body register-body">
        <TableRegion label="Drawing register, scrolls sideways">
          <table className="register-table">
            <caption className="visually-hidden">Drawing register</caption>
            <thead>
              <tr><th scope="col">Sheet</th><th scope="col">Title</th><th scope="col">Revision</th><th scope="col">State</th>
                <th scope="col" className="num">Bytes</th><th scope="col">Uploaded</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr>
            </thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.key} id={domId("upload", row.key)} className={row.leaving ? "row-uploading row-leaving" : "row-uploading"}>
                  <td className="sheet-code">{row.code}</td>
                  <td>{row.name}</td>
                  <td>—</td>
                  <td><span className="badge"><span className="pulse-dot" aria-hidden="true" />Uploading</span></td>
                  <td className="num">—</td>
                  <td>—</td>
                  <td />
                </tr>
              ))}
              {list.map((sheet) => {
                const current = sheet.revisions.find((r) => r.revision === sheet.currentRevision) ?? sheet.revisions[sheet.revisions.length - 1];
                return (
                  <SheetRows key={sheet.id} sheet={sheet} current={current} open={history === sheet.id} canEdit={canEdit}
                    onHistory={() => setHistory(history === sheet.id ? null : sheet.id)}
                    onRevision={() => {
                      setRevisionFor(sheet.code);
                      revisionChooser.current?.click();
                    }} />
                );
              })}
              {!list.length && !pending.length && sheets.data && (
                <tr><td colSpan={7} className="empty-cell">No sheets yet. Upload the first drawings to start the register.</td></tr>
              )}
            </tbody>
          </table>
        </TableRegion>

        <section className="transmittals" aria-labelledby="transmittals-heading">
          <h3 id="transmittals-heading">Transmittals</h3>
          {issued.length ? (
            <ul className="transmittal-list">
              {[...issued].reverse().map((t) => (
                <li key={t.id}>
                  <a id={domId("transmittal", t.number)} className="button" href={`/api/transmittals/${t.id}/zip`}
                    onClick={(event) => {
                      event.preventDefault();
                      void downloadFile(office, `/api/transmittals/${t.id}/zip`, `${t.number}.zip`);
                    }}>Download {t.number}</a>
                  <span>{purposeLabel(t.purpose)} · {t.sheets.length} sheets · {formatTime(t.issuedAt)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="empty-cell">No transmittals issued yet.</p>}
        </section>
      </div>

      {canEdit && (
        <IssueSetDialog open={issuing} sheets={list} projectId={project.id} onCancel={() => setIssuing(false)}
          onIssued={async (number) => {
            await transmittals.reload();
            await reloadRevision();
            flushSync(() => setIssuing(false));
            focusId(domId("transmittal", number));
          }} />
      )}
    </>
  );
}

function SheetRows({ sheet, current, open, canEdit, onHistory, onRevision }: {
  sheet: Sheet; current: Revision; open: boolean; canEdit: boolean; onHistory: () => void; onRevision: () => void;
}) {
  const office = useOffice();
  const fileUrl = (revision: string): string => `/api/sheets/${sheet.id}/revisions/${revision}/file`;
  const fileName = (revision: Revision): string => `${sheet.code}_${revision.revision}${revision.originalName.match(/\.[^.]+$/)?.[0] ?? ""}`;
  return (
    <>
      <tr>
        <td className="sheet-code">{sheet.code}</td>
        <td>{sheet.title}</td>
        <td><span className="revision-letter">{current.revision}</span></td>
        <td><span className="badge"><span className="shape state-current" aria-hidden="true" />Current</span></td>
        <td className="num">{groupDigits(current.bytes)}</td>
        <td className="uploaded">{formatTime(current.uploadedAt)}{current.uploadedBy && <span className="uploaded-by">{current.uploadedBy.name}</span>}</td>
        <td>
          <div className="row-actions sheet-actions">
            <button type="button" className="button" onClick={() => void downloadFile(office, fileUrl(current.revision), fileName(current))}>
              Download {sheet.code} rev {current.revision}
            </button>
            <button type="button" className="button" aria-expanded={open} onClick={onHistory}>History of {sheet.code}</button>
            {canEdit && <button type="button" className="button" onClick={onRevision}>New revision of {sheet.code}</button>}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="history-row">
          <td colSpan={7}>
            <ol className="history-list">
              {[...sheet.revisions].reverse().map((revision) => (
                <li key={revision.revision}>
                  <span className="revision-letter">{revision.revision}</span>
                  <span>{revision.state === "current" ? "Current" : "Superseded, read-only"}</span>
                  <span>{revision.originalName}</span>
                  <span>{groupDigits(revision.bytes)} bytes</span>
                  <span>{formatTime(revision.uploadedAt)}</span>
                  {revision.note && <span className="history-note">{revision.note}</span>}
                </li>
              ))}
            </ol>
          </td>
        </tr>
      )}
    </>
  );
}

function IssueSetDialog({ open, sheets, projectId, onCancel, onIssued }: {
  open: boolean; sheets: Sheet[]; projectId: string; onCancel: () => void; onIssued: (number: string) => Promise<void>;
}) {
  const office = useOffice();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [purpose, setPurpose] = useState("for_construction");
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState("");
  const retryKey = useRef(newRetryKey());
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChosen(new Set(sheets.map((s) => s.id)));
      setPurpose("for_construction");
      setErrors({});
      setError("");
      retryKey.current = newRetryKey();
    }
  }

  const issue = async (): Promise<void> => {
    const sheetRevisions = sheets.filter((s) => chosen.has(s.id)).map((s) => ({ sheetId: s.id, revision: s.currentRevision }));
    office.announce("Building transmittal…");
    const result = await post<{ transmittal: Transmittal }>(`/api/projects/${projectId}/transmittals`, { purpose, sheetRevisions },
      { idempotencyKey: retryKey.current });
    if (result.ok) {
      const t = result.data.transmittal;
      retryKey.current = newRetryKey();
      office.announce(`Transmittal ${t.number} issued with ${t.sheets.length} sheets.`);
      await onIssued(t.number);
      return;
    }
    const body = office.refused(result, { id: "issue-set", values: { purpose } });
    if (!body) {
      focusRefusal(openDialog());
      return;
    }
    if (body.error === "validation") {
      flushSync(() => {
        setErrors(body.errors ?? {});
        setError("");
      });
    } else if (body.error === "storage_unavailable") {
      const copy = "File storage is unreachable, so the set wasn't issued. No transmittal was created.";
      office.alert(copy);
      flushSync(() => setError(copy));
    }
    focusRefusal(openDialog());
  };

  const groupId = fieldId("issue", "sheetRevisions");
  return (
    <Dialog title="Issue set" open={open} onCancel={onCancel} error={error}
      actions={<ActionButton primary type="submit" pending="Building transmittal…" onAction={issue}>Issue transmittal</ActionButton>}>
      <fieldset className="issue-sheets" aria-describedby={errors.sheetRevisions ? `${groupId}-error` : undefined}>
        <legend>Current revisions</legend>
        {sheets.map((sheet) => (
          <label key={sheet.id} className="check">
            <input type="checkbox" checked={chosen.has(sheet.id)} onChange={(event) => {
              const next = new Set(chosen);
              if (event.target.checked) next.add(sheet.id);
              else next.delete(sheet.id);
              setChosen(next);
            }} />
            <span>{sheet.code} rev {sheet.currentRevision}</span>
          </label>
        ))}
        {!sheets.length && <p>No sheets to issue yet.</p>}
        {errors.sheetRevisions && <span className="field-error" id={`${groupId}-error`} tabIndex={-1}>{errors.sheetRevisions}</span>}
      </fieldset>
      <SelectField label="Purpose" name="purpose" form="issue" value={purpose} onChange={setPurpose} options={PURPOSES} error={errors.purpose} />
    </Dialog>
  );
}
