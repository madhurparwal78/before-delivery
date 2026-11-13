import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure, useAnnouncer } from "./api.js";
import { copy } from "../shared/copy.js";
import { formatBytes } from "../shared/format.js";
import type { FolderResponse, MeResponse, UploadResponse, VersionsResponse } from "./types.js";
import type { FileItem } from "../shared/types.js";

export function Dashboard(props: {
  me: MeResponse | null;
  onSignOut: () => void;
  view: string | null;
  folder: string | null;
}): JSX.Element {
  const [items, setItems] = useState<FileItem[]>([]);
  const [folderName, setFolderName] = useState("My Drawings");
  const [sort, setSort] = useState("modified");
  const [order, setOrder] = useState("desc");
  const [query, setQuery] = useState("");
  const [listView, setListView] = useState(true);
  const [announcements, setAnnouncements] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "quote" | "support" | "delete"; name?: string; id?: string } | null>(null);
  const [newFolderRow, setNewFolderRow] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<{ name: string; status: string } | null>(null);
  const [versionDialog, setVersionDialog] = useState<{ id: string; name: string } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const announcer = useAnnouncer();

  const load = useCallback(async (): Promise<void> => {
    const folder = props.folder ?? "root";
    const view = props.view;
    let path: string;
    if (view === "recent") {
      const result = await api<{ items: FileItem[] }>("/api/recent");
      setItems(result.items);
      setFolderName("Recent");
      return;
    }
    if (view === "samples") {
      const result = await api<FolderResponse>(`/api/folders/root?sort=${sort}&order=${order}`);
      void result;
      const samples = await api<{ items: FileItem[] }>("/api/folders/root?sort=name&order=asc");
      const names = samples.items.filter((i) => i.owner === "Corbel Works");
      setItems(names);
      setFolderName("Sample Files");
      return;
    }
    const params = new URLSearchParams({ sort, order, q: query });
    const result = await api<FolderResponse>(`/api/folders/${folder}?${params.toString()}`);
    setItems(result.items);
    setFolderName(result.folder.name);
  }, [props.folder, props.view, sort, order, query]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onmessage = () => void load().catch(() => undefined);
    return () => events.close();
  }, [load]);

  const announce = (text: string): void => {
    setAnnouncements(text);
    announcer.announce(text);
  };

  const trialText = props.me
    ? props.me.trial.ended
      ? "Your trial has ended"
      : props.me.trial.days_left === 1
        ? "1 day left in your trial"
        : `${props.me.trial.days_left} days left in your trial`
    : "";

  const visibleCount = items.length;

  const createFolder = async (name: string): Promise<void> => {
    try {
      await api("/api/folders", { json: { parent_id: props.folder ?? "root", name } });
      setNewFolderRow(null);
      await load();
    } catch (err) {
      if (err instanceof ApiFailure) announce(err.fields.name ?? err.code);
    }
  };

  const uploadFile = async (file: File): Promise<void> => {
    setUploadState({ name: file.name, status: copy.uploading(file.name) });
    const body = new FormData();
    body.append("file", file);
    try {
      const result = await api<UploadResponse>(`/api/folders/${props.folder ?? "root"}/uploads`, {
        method: "POST",
        body,
      });
      setUploadState({ name: file.name, status: copy.stored });
      const suffix = result.file_version > 1 ? ` ${copy.sameNameUpload(file.name, result.file_version)}` : "";
      announce(copy.importSummary(result.imported, result.skipped) + suffix);
      await load();
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.code === "storage_unavailable") announce(copy.storageDownUpload);
        else if (err.code === "file_too_large") announce(copy.fileTooLarge(file.name, Number(err.extra.limit_bytes ?? 0)));
        else announce(err.fields.file ?? err.code);
      }
    } finally {
      setTimeout(() => setUploadState(null), 2500);
    }
  };

  const deleteItem = async (id: string, name: string): Promise<void> => {
    try {
      await api(`/api/drawings/${id}`, { method: "DELETE" });
      announce(copy.deleted(name));
      setDialog(null);
      await load();
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.code === "folder_not_empty") announce(copy.folderNotEmpty(name));
        else announce(err.code);
        setDialog(null);
      }
    }
  };

  const deleteFolder = async (id: string, name: string): Promise<void> => {
    try {
      await api(`/api/folders/${id}`, { method: "DELETE" });
      announce(copy.deleted(name));
      setDialog(null);
      await load();
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.code === "folder_not_empty") announce(copy.folderNotEmpty(name));
        else announce(err.code);
        setDialog(null);
      }
    }
  };

  const headerLabel = (column: string): string => {
    const map: Record<string, string> = {
      type: "File Type",
      name: "Name",
      modified: "Date Modified",
      size: "Size",
      owner: "Owner",
      shared: "Shared",
    };
    return map[column] ?? column;
  };

  const toggleSort = (column: string): void => {
    if (sort === column) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSort(column);
      setOrder(column === "modified" ? "desc" : "asc");
    }
  };

  const ariaSort = (column: string): "ascending" | "descending" | "none" => {
    if (sort !== column) return "none";
    return order === "asc" ? "ascending" : "descending";
  };

  return (
    <div>
      <header style={{ display: "flex", gap: "10px", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #2a2e33", flexWrap: "wrap" }}>
        <img src="/brand/corbel-works.svg" alt="Corbel Works" height="24" />
        <span className="status-chip" style={{ marginLeft: 8 }}>{trialText}</span>
        <button className="btn btn-outline btn-small" type="button" onClick={() => setDialog({ kind: "quote" })}>
          Get Pro for $12/month
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ color: "#a7adb5", fontSize: 14 }}>{props.me?.user.name}</span>
        <button
          className="btn btn-outline btn-small"
          type="button"
          onClick={async () => {
            await api("/api/auth/signout", { method: "POST" }).catch(() => undefined);
            window.location.href = "/";
          }}
        >
          Sign out
        </button>
        <button
          className="btn btn-outline btn-small"
          type="button"
          aria-label="Files menu"
          onClick={() => setDialog({ kind: "support" })}
          style={{ display: "none" }}
        >
          Files menu
        </button>
      </header>

      <div style={{ display: "flex", minHeight: "calc(100vh - 60px)" }}>
        <nav aria-label="Files" style={{ width: 220, borderRight: "1px solid #2a2e33", padding: "14px", display: "grid", gap: "8px", alignContent: "start" }}>
          <button className="btn btn-filled btn-small" type="button" onClick={async () => {
            const result = await api<{ drawing: FileItem }>("/api/drawings", { json: { folder_id: props.folder ?? "root" } });
            window.location.href = `/d/${result.drawing.id}`;
          }}>New Drawing</button>
          <button className="btn btn-outline btn-small" type="button" onClick={() => fileInput.current?.click()}>Upload…</button>
          <input
            ref={fileInput}
            type="file"
            accept=".dxf"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
              e.target.value = "";
            }}
          />
          <button className="btn btn-outline btn-small" type="button" onClick={() => setNewFolderRow("")}>New Folder</button>
          <a href="/drawings?view=recent" style={{ color: "#7ad7e8" }}>Recent</a>
          <a href="/drawings?view=samples" style={{ color: "#7ad7e8" }}>Sample Files</a>
          <a href="/drawings" style={{ color: "#7ad7e8" }}>My Drawings</a>
        </nav>

        <main style={{ flex: 1, padding: "14px", minWidth: 0 }}>
          <div className="toolbar" style={{ marginBottom: 12 }}>
            <button className="btn btn-outline btn-small" type="button" onClick={() => void load()}>Refresh</button>
            <button className="btn btn-outline btn-small" type="button" onClick={() => setDialog({ kind: "support" })}>Manage Support Files</button>
            <input
              type="search"
              aria-label="Search this folder"
              placeholder="Search this folder"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ background: "#0b0d0f", border: "1px solid #33383e", borderRadius: 2, minHeight: 36, padding: "4px 10px", minWidth: 160 }}
            />
            <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
              <legend className="sr-only">View</legend>
              <div role="radiogroup" aria-label="View" style={{ display: "flex", gap: 4 }}>
                <label>
                  <input type="radio" name="view" checked={listView} onChange={() => setListView(true)} /> List
                </label>
                <label>
                  <input type="radio" name="view" checked={!listView} onChange={() => setListView(false)} /> Grid
                </label>
              </div>
            </fieldset>
          </div>

          {uploadState && <div className="banner" style={{ marginBottom: 10 }}>{uploadState.name} · {uploadState.status === copy.stored ? copy.stored : copy.uploading(uploadState.name)}</div>}

          {newFolderRow !== null && (
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input
                autoFocus
                aria-label="Folder name"
                defaultValue={newFolderRow}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const value = (e.target as HTMLInputElement).value.trim();
                    if (value) void createFolder(value);
                  } else if (e.key === "Escape") setNewFolderRow(null);
                }}
                onBlur={(e) => {
                  const value = e.target.value.trim();
                  if (value) void createFolder(value);
                  else setNewFolderRow(null);
                }}
                style={{ flex: 1, background: "#0b0d0f", border: "1px solid #33383e", borderRadius: 2, minHeight: 38, padding: "4px 10px" }}
              />
            </div>
          )}

          {listView ? (
            <table className="files" aria-label="Files">
              <thead>
                <tr>
                  {["type", "name", "modified", "size", "owner", "shared"].map((column) => (
                    <th key={column} aria-sort={ariaSort(column)}>
                      <button type="button" onClick={() => toggleSort(column)}>
                        {headerLabel(column)}
                        {sort === column ? (order === "asc" ? " ▲" : " ▼") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.kind === "folder" ? "Folder" : "Drawing"}</td>
                    <td>
                      <a
                        href={item.kind === "folder" ? `/drawings?folder=${item.id}` : `/d/${item.id}`}
                        style={{ color: "#7ad7e8" }}
                      >
                        {item.name}
                      </a>
                      <button
                        className="btn btn-outline btn-small"
                        type="button"
                        aria-label={`More actions for ${item.name}`}
                        aria-haspopup="menu"
                        onClick={(e) => {
                          const menu = document.createElement("div");
                          void menu;
                          const next = !document.getElementById(`menu-${item.id}`);
                          document.querySelectorAll("[id^=menu-]").forEach((m) => m.remove());
                          if (next) {
                            const node = document.createElement("div");
                            node.id = `menu-${item.id}`;
                            node.setAttribute("role", "menu");
                            node.style.cssText = "position:fixed;background:#16181b;border:1px solid #2a2e33;padding:6px;display:grid;gap:4px;z-index:99";
                            const rect = (e.target as HTMLElement).getBoundingClientRect();
                            node.style.top = `${rect.bottom + 4}px`;
                            node.style.left = `${rect.left}px`;
                            const versionButton = document.createElement("button");
                            versionButton.textContent = "Version history";
                            versionButton.setAttribute("role", "menuitem");
                            versionButton.style.cssText = "all:unset;cursor:pointer;color:#7ad7e8;padding:6px 10px";
                            versionButton.onclick = () => {
                              setVersionDialog({ id: item.id, name: item.name });
                              node.remove();
                            };
                            if (item.kind === "drawing") node.append(versionButton);
                            const deleteButton = document.createElement("button");
                            deleteButton.textContent = "Delete";
                            deleteButton.setAttribute("role", "menuitem");
                            deleteButton.style.cssText = "all:unset;cursor:pointer;color:#7ad7e8;padding:6px 10px";
                            deleteButton.onclick = () => {
                              setDialog({ kind: "delete", name: item.name, id: item.id });
                              node.remove();
                            };
                            node.append(deleteButton);
                            document.body.append(node);
                          }
                        }}
                      >
                        ⋯
                      </button>
                    </td>
                    <td>{item.modified_label}</td>
                    <td>{item.size_label}</td>
                    <td>{item.owner}</td>
                    <td>{item.shared ? "Shared" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <ul aria-label="Files" style={{ listStyle: "none", padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {items.map((item) => (
                <li key={item.id} className="panel" style={{ padding: 12 }}>
                  <a href={item.kind === "folder" ? `/drawings?folder=${item.id}` : `/d/${item.id}`} style={{ color: "#7ad7e8" }}>
                    {item.name}
                  </a>
                  <div style={{ color: "#a7adb5", fontSize: 12.5 }}>{item.modified_label}</div>
                </li>
              ))}
            </ul>
          )}

          {items.length === 0 && (
            <div className="empty-state">
              {query !== "" ? (
                <p>{copy.noSearchMatch(query)}</p>
              ) : (
                <p>{props.view === "recent" || props.view === "samples" ? "No drawings yet." : copy.emptyFolder}</p>
              )}
            </div>
          )}

          <p role="status" aria-label="Files status" className="sr-only" style={{ margin: "10px 0" }}>
            {visibleCount === 1 ? "1 item" : `${visibleCount} items`}
          </p>
        </main>

        <aside aria-label="Welcome" className="panel" style={{ width: 240, padding: 16, margin: "14px" }}>
          <h2 style={{ fontSize: 16 }}>Welcome back, {props.me?.user.name.split(" ")[0]}</h2>
          <div style={{ display: "grid", gap: 8, marginTop: 12, fontSize: 14 }}>
            <a href="/reference.html">Command reference</a>
            <a href="/shortcuts.html">Keyboard shortcuts</a>
            <a href="/drawings?view=samples">Sample files</a>
          </div>
        </aside>
      </div>

      <div className="sr-only" role="status" aria-label="Announcements" aria-live="polite">
        {announcements}
      </div>

      {dialog?.kind === "quote" && <QuoteDialog onClose={() => setDialog(null)} email={props.me?.user.email ?? ""} />}
      {dialog?.kind === "support" && <SupportDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && dialog.id && dialog.name && (
        <dialog open>
          <form method="dialog" className="dialog-body" onSubmit={(e) => { e.preventDefault(); setDialog(null); }}>
            <h2>Delete {dialog.name}?</h2>
            <p>{copy.deleteBody}</p>
            <div className="dialog-actions">
              <button className="btn btn-outline" type="button" onClick={() => setDialog(null)}>Cancel</button>
              <button
                className="btn btn-filled"
                type="button"
                onClick={() => {
                  const item = items.find((i) => i.id === dialog.id);
                  if (item?.kind === "folder") void deleteFolder(dialog.id!, dialog.name!);
                  else void deleteItem(dialog.id!, dialog.name!);
                }}
              >
                Delete
              </button>
            </div>
          </form>
        </dialog>
      )}
      {versionDialog && <VersionDialog id={versionDialog.id} name={versionDialog.name} onClose={() => setVersionDialog(null)} onRestored={announce} />}
    </div>
  );
}

function QuoteDialog(props: { onClose: () => void; email: string }): JSX.Element {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => closeRef.current?.focus(), []);
  const send = async (): Promise<void> => {
    setPending(true);
    setAlert(null);
    try {
      await api("/api/quotes", { json: {} });
      setSent(copy.quoteSent(props.email));
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "mail_unavailable") setAlert(copy.quoteMailDown);
    } finally {
      setPending(false);
    }
  };
  return (
    <dialog open>
      <div className="dialog-body">
        <h2>Corbel Draft Pro</h2>
        <p>{copy.quoteBody}</p>
        {sent && <div className="banner" style={{ marginTop: 10 }}>{sent}</div>}
        {alert && <div className="alert" role="alert" style={{ marginTop: 10 }}>{alert}</div>}
        <div className="dialog-actions">
          <button className="btn btn-outline" type="button" onClick={props.onClose} ref={closeRef}>Close</button>
          <button className="btn btn-filled" type="button" onClick={send} disabled={pending}>
            {pending ? copy.quotePending : "Email me a quote"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function SupportDialog(props: { onClose: () => void }): JSX.Element {
  const [files, setFiles] = useState<{ linetypes: string[]; plot_styles: string[]; blocks: string[]; templates: string[]; text_styles: string[] } | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
    void api<typeof files>("/api/support-files").then(setFiles).catch(() => undefined);
  }, []);
  return (
    <dialog open>
      <div className="dialog-body">
        <h2>Support files</h2>
        {files ? (
          <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
            <div><strong>Linetypes:</strong> {files.linetypes.join(", ")}</div>
            <div><strong>Plot styles:</strong> {files.plot_styles.join(", ")}</div>
            <div><strong>Blocks:</strong> {files.blocks.join(", ")}</div>
            <div><strong>Templates:</strong> {files.templates.join(", ")}</div>
            <div><strong>Text styles:</strong> {files.text_styles.join(", ")}</div>
          </div>
        ) : (
          <p>Loading…</p>
        )}
        <div className="dialog-actions">
          <button className="btn btn-outline" type="button" onClick={props.onClose} ref={closeRef}>Close</button>
        </div>
      </div>
    </dialog>
  );
}

function VersionDialog(props: { id: string; name: string; onClose: () => void; onRestored: (text: string) => void }): JSX.Element {
  const [versions, setVersions] = useState<VersionsResponse | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    closeRef.current?.focus();
    void api<VersionsResponse>(`/api/drawings/${props.id}/file-versions`).then(setVersions).catch(() => undefined);
  }, [props.id]);
  const restore = async (n: number, baseVersion: number): Promise<void> => {
    try {
      const result = await api<{ file_version: number; version: number }>(`/api/drawings/${props.id}/file-versions/${n}/restore`, { json: { base_version: baseVersion } });
      props.onRestored(copy.restored(n, result.file_version));
      props.onClose();
    } catch (err) {
      if (err instanceof ApiFailure && err.code === "storage_unavailable") props.onRestored(copy.storageDownUpload);
      else if (err instanceof ApiFailure) props.onRestored(err.code);
    }
  };
  return (
    <dialog open aria-label={`Version history — ${props.name}`}>
      <div className="dialog-body">
        <h2>Version history — {props.name}</h2>
        {versions === null ? (
          <p>Loading…</p>
        ) : versions.versions.length === 0 ? (
          <p>{copy.noVersions}</p>
        ) : (
          <ul aria-label="Versions" style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
            {versions.versions.map((v) => (
              <li key={v.number} className="panel" style={{ padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>
                  Version {v.number} · {v.created_label} · {v.actor} · {formatBytes(v.size_bytes)}
                </span>
                <button className="btn btn-outline btn-small" type="button" onClick={() => void restore(v.number, versions.versions[0].number)}>
                  Restore version {v.number}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button className="btn btn-outline" type="button" onClick={props.onClose} ref={closeRef}>Close</button>
        </div>
      </div>
    </dialog>
  );
}
