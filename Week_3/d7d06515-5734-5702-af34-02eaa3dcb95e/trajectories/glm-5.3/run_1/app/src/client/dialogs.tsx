import { useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "./api.js";
import { copy } from "../shared/copy.js";
import { aliases, commandNames, prompts, shortcuts } from "../shared/commands.js";
import { accessLabels } from "../shared/copy.js";
import type { DrawingResponse, ExportsResponse, MeResponse, RevisionsResponse, SharesResponse } from "./types.js";

export function ConflictDialog(props: { text: string; onClose: () => void; onLoadLatest: () => Promise<void> }): JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <dialog open aria-role="alertdialog" aria-label="Edit conflict">
      <div className="dialog-body">
        <h2>Edit conflict</h2>
        <p>{props.text}</p>
        <div className="dialog-actions">
          <button className="btn btn-outline" type="button" onClick={props.onClose}>Cancel</button>
          <button className="btn btn-filled" type="button" ref={ref} onClick={() => void props.onLoadLatest()}>
            Load latest
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function EditorDialogs(props: {
  dialog: string;
  onClose: () => void;
  drawing: DrawingResponse;
  onCommand: (name: string, args: Record<string, unknown>) => void;
  onReload: () => Promise<void>;
  me: MeResponse | null;
  onStartTrace: (id: string) => Promise<void>;
  onAnnounce: (text: string) => void;
  onCommandHistory: (text: string) => void;
}): JSX.Element {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, [props.dialog]);

  return (
    <>
      {props.dialog === "reference" && <ReferenceDialog onClose={props.onClose} closeRef={closeRef} />}
      {props.dialog === "saveas" && (
        <SaveAsDialog drawing={props.drawing} onClose={props.onClose} closeRef={closeRef} />
      )}
      {props.dialog === "export" && (
        <ExportDialog drawing={props.drawing} onClose={props.onClose} closeRef={closeRef} onAnnounce={props.onAnnounce} onCommandHistory={props.onCommandHistory} />
      )}
      {props.dialog === "layers" && (
        <dialog open aria-label="Layers">
          <div className="dialog-body">
            <h2>Layers</h2>
            <p>Use the Layers panel to add, rename and change layers.</p>
            <div className="dialog-actions">
              <button className="btn btn-outline" type="button" ref={closeRef} onClick={props.onClose}>Close</button>
            </div>
          </div>
        </dialog>
      )}
      {props.dialog === "blocks" && (
        <dialog open aria-label="Blocks">
          <div className="dialog-body">
            <h2>Blocks</h2>
            <p>Choose a block in the Blocks panel, then pick its insertion point.</p>
            <div className="dialog-actions">
              <button className="btn btn-outline" type="button" ref={closeRef} onClick={props.onClose}>Close</button>
            </div>
          </div>
        </dialog>
      )}
      {props.dialog === "share" && (
        <ShareDialog
          drawing={props.drawing}
          onClose={props.onClose}
          closeRef={closeRef}
          onAnnounce={props.onAnnounce}
          onCommandHistory={props.onCommandHistory}
        />
      )}
    </>
  );
}

function ReferenceDialog(props: { onClose: () => void; closeRef: React.RefObject<HTMLButtonElement | null> }): JSX.Element {
  return (
    <dialog open aria-label="Command reference">
      <div className="dialog-body">
        <h2>Command reference</h2>
        <table className="files" style={{ marginBottom: 14 }}>
          <thead>
            <tr><th>Alias</th><th>Command</th><th>Prompts</th></tr>
          </thead>
          <tbody>
            {Object.entries(aliases).map(([alias, command]) => (
              <tr key={alias}>
                <td>{alias}</td>
                <td>{command}</td>
                <td style={{ color: "#a7adb5" }}>{(prompts[command] ?? []).join(" → ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 style={{ fontSize: 15, margin: "12px 0 6px" }}>Shortcuts</h3>
        <table className="files">
          <tbody>
            {shortcuts.map((shortcut) => (
              <tr key={shortcut.keys}>
                <td>{shortcut.keys}</td>
                <td>{shortcut.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="dialog-actions">
          <button className="btn btn-outline" type="button" ref={props.closeRef} onClick={props.onClose}>Close</button>
        </div>
      </div>
    </dialog>
  );
}

function SaveAsDialog(props: { drawing: DrawingResponse; onClose: () => void; closeRef: React.RefObject<HTMLButtonElement | null> }): JSX.Element {
  const [name, setName] = useState(props.drawing.name.replace(/\.dxf$/i, "") + " copy");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <dialog open aria-label="Save as">
      <div className="dialog-body">
        <h2>Save as</h2>
        {error && <div className="alert" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="saveas-name">File name</label>
          <input id="saveas-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="dialog-actions">
          <button className="btn btn-outline" type="button" ref={props.closeRef} onClick={props.onClose}>Cancel</button>
          <button
            className="btn btn-filled"
            type="button"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                const result = await api<{ drawing: { id: string } }>(`/api/drawings/${props.drawing.id}/copy`, { json: { name } });
                window.location.href = `/d/${result.drawing.id}`;
              } catch (err) {
                if (err instanceof ApiFailure) setError(err.fields.name ?? err.code);
              } finally {
                setPending(false);
              }
            }}
          >
            Save
          </button>
        </div>
      </div>
    </dialog>
  );
}

function ExportDialog(props: {
  drawing: DrawingResponse;
  onClose: () => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  onAnnounce: (text: string) => void;
  onCommandHistory: (text: string) => void;
}): JSX.Element {
  const [format, setFormat] = useState<"pdf" | "dxf">("pdf");
  const [layout, setLayout] = useState("Layout1");
  const [exports, setExports] = useState<ExportsResponse["exports"]>([]);
  const [pending, setPending] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<RevisionsResponse["revisions"]>([]);

  const loadExports = async (): Promise<void> => {
    try {
      const result = await api<ExportsResponse>(`/api/drawings/${props.drawing.id}/exports`);
      setExports(result.exports);
    } catch {
      /* leave list as-is */
    }
  };

  useEffect(() => {
    void loadExports();
    const timer = setInterval(() => void loadExports(), 1200);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (revisionsOpen) {
      void api<RevisionsResponse>("/api/templates/title-block-a3/revisions").then((r) => setRevisions(r.revisions)).catch(() => undefined);
    }
  }, [revisionsOpen]);

  const pendingRef = useRef(false);

  return (
    <dialog open aria-label="Export">
      <div className="dialog-body">
        <h2>Export</h2>
        <div role="radiogroup" aria-label="Format" style={{ display: "flex", gap: 14, margin: "10px 0" }}>
          <label>
            <input type="radio" name="format" checked={format === "pdf"} onChange={() => setFormat("pdf")} /> PDF
          </label>
          <label>
            <input type="radio" name="format" checked={format === "dxf"} onChange={() => setFormat("dxf")} /> DXF
          </label>
        </div>
        <div className="field">
          <label htmlFor="export-layout">Layout</label>
          <select id="export-layout" value={layout} disabled={format === "dxf"} onChange={(e) => setLayout(e.target.value)}>
            {props.drawing.layouts.map((l) => (
              <option key={l.name} value={l.name}>{l.name}</option>
            ))}
          </select>
        </div>
        <div className="dialog-actions">
          <button className="btn btn-outline" type="button" onClick={() => setRevisionsOpen(true)}>Title block revisions</button>
          <button className="btn btn-outline" type="button" ref={props.closeRef} onClick={props.onClose}>Close</button>
          <button
            className="btn btn-filled"
            type="button"
            disabled={pending}
            onClick={async () => {
              if (pendingRef.current) return;
              pendingRef.current = true;
              setPending(true);
              try {
                const result = await api<{ export: { id: string; file: string } }>(`/api/drawings/${props.drawing.id}/exports`, {
                  json: { format, layout: format === "dxf" ? "Model" : layout },
                });
                props.onCommandHistory(`${result.export.file} · Rendering…`);
                for (let i = 0; i < 40; i++) {
                  await new Promise((r) => setTimeout(r, 500));
                  const detail = await api<{ export: { state: string; file: string } }>(`/api/exports/${result.export.id}`);
                  if (detail.export.state === "stored") {
                    props.onCommandHistory(copy.exportReady(detail.export.file));
                    props.onAnnounce(copy.exportReadyAnnounce(detail.export.file));
                    break;
                  }
                  if (detail.export.state === "failed") {
                    props.onCommandHistory(copy.exportFailed(detail.export.file));
                    props.onAnnounce(copy.storageDownExport);
                    break;
                  }
                }
                await loadExports();
              } catch (err) {
                if (err instanceof ApiFailure && err.code === "storage_unavailable") {
                  props.onAnnounce(copy.storageDownExport);
                }
              } finally {
                pendingRef.current = false;
                setPending(false);
              }
            }}
          >
            {pending ? "Rendering…" : "Export"}
          </button>
        </div>
        <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Exports</h3>
        <ul aria-label="Exports" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {exports.map((item) => (
            <li key={item.id} className="panel" style={{ padding: "8px 10px", display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>
                {item.state === "stored"
                  ? copy.exportReady(item.file)
                  : item.state === "failed"
                    ? copy.exportFailed(item.file)
                    : copy.exportReady(item.file).replace(" · Ready", " · Rendering…")}
              </span>
              {item.state === "stored" && item.download_url && (
                <a className="btn btn-outline btn-small" href={item.download_url} download>
                  Download {item.file}
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
      {revisionsOpen && (
        <TitleBlockDialog
          revisions={revisions}
          onClose={() => setRevisionsOpen(false)}
          onAnnounce={props.onAnnounce}
        />
      )}
    </dialog>
  );
}

function TitleBlockDialog(props: {
  revisions: RevisionsResponse["revisions"];
  onClose: () => void;
  onAnnounce: (text: string) => void;
}): JSX.Element {
  const [footerNote, setFooterNote] = useState("Issued for coordination.");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const today = new Date();
  const tomorrow = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate() + 1).padStart(2, "0")}`;
  return (
    <dialog open aria-label="Title block A3">
      <div className="dialog-body">
        <h2>Title block A3</h2>
        {error && <div className="alert" role="alert">{error}</div>}
        <ul aria-label="Revisions" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6, margin: "10px 0" }}>
          {props.revisions.map((revision) => (
            <li key={revision.letter} className="panel" style={{ padding: "6px 10px" }}>
              Revision {revision.letter} · {revision.footer_note} · {revision.effective_date}
            </li>
          ))}
        </ul>
        <div className="field">
          <label htmlFor="tb-footer">Footer note</label>
          <input id="tb-footer" value={footerNote} onChange={(e) => setFooterNote(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tb-date">Effective date</label>
          <input id="tb-date" placeholder={tomorrow} value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </div>
        <div className="dialog-actions">
          <button className="btn btn-outline" type="button" onClick={props.onClose}>Close</button>
          <button
            className="btn btn-filled"
            type="button"
            onClick={async () => {
              try {
                const result = await api<{ revision: { letter: string; effective_date: string } }>(
                  "/api/templates/title-block-a3/revisions",
                  { json: { footer_note: footerNote, effective_date: effectiveDate || tomorrow } },
                );
                props.onAnnounce(copy.revisionAdded(result.revision.letter, result.revision.effective_date));
                props.onClose();
              } catch (err) {
                if (err instanceof ApiFailure) {
                  setError(err.fields.footer_note ?? err.fields.effective_date ?? err.code);
                }
              }
            }}
          >
            Add revision
          </button>
        </div>
      </div>
    </dialog>
  );
}

function ShareDialog(props: {
  drawing: DrawingResponse;
  onClose: () => void;
  closeRef: React.RefObject<HTMLButtonElement | null>;
  onAnnounce: (text: string) => void;
  onCommandHistory: (text: string) => void;
}): JSX.Element {
  const [access, setAccess] = useState<"view" | "markup" | "edit">("view");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [shares, setShares] = useState<SharesResponse["shares"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const loadShares = async (): Promise<void> => {
    try {
      const result = await api<SharesResponse>(`/api/drawings/${props.drawing.id}/shares`);
      setShares(result.shares);
    } catch {
      /* leave as-is */
    }
  };

  useEffect(() => {
    void loadShares();
  }, []);

  return (
    <dialog open aria-label="Share drawing">
      <div className="dialog-body">
        <h2>Share drawing</h2>
        {error && <div className="alert" role="alert">{error}</div>}
        <div role="radiogroup" aria-label="Access" style={{ display: "flex", gap: 14, margin: "10px 0" }}>
          {(["view", "markup", "edit"] as const).map((level) => (
            <label key={level}>
              <input
                type="radio"
                name="share-access"
                checked={access === level}
                onChange={() => setAccess(level)}
              />{" "}
              {accessLabels[level]}
            </label>
          ))}
        </div>
        <div className="field">
          <label htmlFor="share-email">Recipient email</label>
          <input id="share-email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="share-name">Recipient name</label>
          <input id="share-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="share-expiry">Expiry date</label>
          <input id="share-expiry" placeholder="YYYY-MM-DD" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
        <div className="dialog-actions" style={{ flexWrap: "wrap" }}>
          <button
            className="btn btn-outline"
            type="button"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                const result = await api<{ share: { id: string; url: string; recipient_email: string } }>(
                  `/api/drawings/${props.drawing.id}/shares`,
                  { json: { access, recipient_email: email, recipient_name: name, expiry_date: expiry === "" ? null : expiry } },
                );
                try {
                  await navigator.clipboard.writeText(result.share.url);
                  props.onAnnounce(copy.linkCopied);
                } catch {
                  props.onCommandHistory(result.share.url);
                }
                await loadShares();
              } catch (err) {
                if (err instanceof ApiFailure) {
                  setError(err.fields.recipient_email ?? err.fields.expiry_date ?? err.fields.access ?? err.code);
                }
              } finally {
                setPending(false);
              }
            }}
          >
            Copy link
          </button>
          <button
            className="btn btn-filled"
            type="button"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                const share = await api<{ share: { id: string; recipient_email: string } }>(
                  `/api/drawings/${props.drawing.id}/shares`,
                  { json: { access, recipient_email: email, recipient_name: name, expiry_date: expiry === "" ? null : expiry } },
                );
                const invite = await api<{ invite: string; sent_to: string }>(`/api/shares/${share.share.id}/invite`, { method: "POST" });
                props.onAnnounce(copy.inviteSent(invite.sent_to));
                await loadShares();
              } catch (err) {
                if (err instanceof ApiFailure) {
                  if (err.code === "invite_cooldown") {
                    const seconds = Number(err.extra.retry_after_seconds ?? 60);
                    setError(copy.inviteCooldown(email, seconds));
                  } else if (err.code === "mail_unavailable") {
                    setError(copy.inviteMailDown);
                  } else {
                    setError(err.fields.recipient_email ?? err.fields.expiry_date ?? err.code);
                  }
                }
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? copy.invitePending : "Send invite"}
          </button>
          <button className="btn btn-outline" type="button" ref={props.closeRef} onClick={props.onClose}>Close</button>
        </div>
        <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Share links</h3>
        <ul aria-label="Share links" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {shares.map((share) => (
            <li key={share.id} className="panel" style={{ padding: "8px 10px", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span>
                {copy.shareItem(
                  share.access === "view" ? "Can view" : share.access === "markup" ? "Can mark up" : "Can edit",
                  share.recipient_email,
                  share.status,
                )}
              </span>
              <button
                className="btn btn-outline btn-small"
                type="button"
                onClick={async () => {
                  await api(`/api/shares/${share.id}/revoke`, { method: "POST" });
                  props.onAnnounce(copy.linkRevoked(share.recipient_email));
                  await loadShares();
                }}
              >
                Revoke link for {share.recipient_email}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}
