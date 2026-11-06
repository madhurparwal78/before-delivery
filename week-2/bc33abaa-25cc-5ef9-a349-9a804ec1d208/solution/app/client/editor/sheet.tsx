// The editor's side sheet: versions, review links, comments with mentions, and assets.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Comment, Version, VersionState } from "../../shared/api-types.js";
import { isoSecond, localTime, zonedInstant } from "../../shared/format.js";
import { ApiError, del, get, patch, post, request } from "../api.js";
import { Button, Dialog, EmptyDrawing, Field, Icon, Status, enterMotion, useBusy } from "../ui.js";
import { OUTAGE_COPY, READ_ONLY_COPY } from "../pages/shell.js";
import { WALL_FORMAT_ERROR } from "../pages/workspace.js";
import type { EditorModel, ReviewLink } from "./model.js";

const STATE_NAMES: Record<VersionState, string> = { draft: "Draft", in_review: "In review", scheduled: "Scheduled", published: "Published", withdrawn: "Withdrawn" };

export interface Permissions { manageVersions: boolean; approve: boolean; comment: boolean; upload: boolean }

function failure(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Try again.";
  if (error.status === 503) return error.body.service === "billing" ? OUTAGE_COPY.billing : OUTAGE_COPY.file_storage;
  if (error.code === "workspace_read_only") return READ_ONLY_COPY.dunning;
  return "The request could not be completed.";
}

// --- Versions --------------------------------------------------------------------------------------------------

function VersionRow({ model, version, can }: { model: EditorModel; version: Version; can: Permissions }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const exportId = model.exports.get(version.id);
  const act = async (name: string, path: string, success: string, failures: Record<string, string> = {}) => {
    setBusy(name);
    try {
      await post(path);
      model.setStatus(success);
      await model.loadVersions();
    } catch (error) {
      model.setStatus(error instanceof ApiError && failures[error.code] ? failures[error.code] : failure(error));
    } finally {
      setBusy(null);
      model.emit();
    }
  };
  const mine = version.createdBy.kind === model.me.kind && version.createdBy.id === model.me.id;
  const waiting = version.state === "scheduled" && version.publishAt !== null && Date.parse(version.publishAt) <= Date.now();
  return (
    <li class="version-row">
      <span class="truncate" title={version.label}>{`v${version.number} · ${version.label} · ${STATE_NAMES[version.state]}`}</span>
      <span class="muted small">
        {version.publishAt && version.state === "scheduled" ? <>Goes live <span class="num">{model.localTime(version.publishAt)}</span></> : null}
        {version.publishedAt && version.state === "published" ? <>Live since <span class="num">{model.localTime(version.publishedAt)}</span></> : null}
        {version.approvals.length > 0 ? <> · approved by {version.approvals.map((a) => a.member.name).join(", ")}</> : null}
      </span>
      {waiting ? <span class="badge pending">Waiting for file storage</span> : null}
      <div class="row-actions" style={{ justifyContent: "flex-start" }}>
        {can.manageVersions && version.state === "draft" ? <Button small busy={busy === "submit"} onClick={() => { void act("submit", `/api/versions/${version.id}/submit`, "Submitted for review."); }}>Submit for review</Button> : null}
        {can.approve && !mine && version.state === "in_review" ? <Button small busy={busy === "approve"} onClick={() => { void act("approve", `/api/versions/${version.id}/approve`, "Approved.", { not_in_review: "Only in-review versions can be approved." }); }}>Approve</Button> : null}
        {can.manageVersions && version.state === "in_review" ? <Button small variant="primary" onClick={() => setScheduling(true)}>Schedule publish</Button> : null}
        {can.manageVersions && version.state === "scheduled" ? <Button small busy={busy === "unschedule"} onClick={() => { void act("unschedule", `/api/versions/${version.id}/unschedule`, "Back in review."); }}>Unschedule</Button> : null}
        {can.manageVersions && version.state === "published" ? <Button small busy={busy === "withdraw"} onClick={() => { void act("withdraw", `/api/versions/${version.id}/withdraw`, "Withdrawn. The embed no longer shows this version."); }}>Withdraw</Button> : null}
        {can.manageVersions && version.state === "published" ? (
          <Button small busy={busy === "export"} onClick={() => {
            setBusy("export");
            post<{ id: string }>(`/api/versions/${version.id}/exports`).then((created) => {
              model.exports.set(version.id, created.id);
              model.setStatus("Export ready.");
            }, (error: unknown) => model.setStatus(error instanceof ApiError && error.code === "not_published" ? "Only published versions can be exported." : failure(error)))
              .finally(() => setBusy(null));
          }}>Create export</Button>
        ) : null}
        {exportId ? <a class="button small" href={`/api/exports/${exportId}`} download>Download export</a> : null}
        {version.embedId && version.state === "published" ? <a class="button small quiet" href={`/embed/${version.embedId}`} target="_blank" rel="noopener">Open embed</a> : null}
      </div>
      {scheduling ? <ScheduleDialog model={model} version={version} onClose={() => setScheduling(false)} /> : null}
    </li>
  );
}

function ScheduleDialog({ model, version, onClose }: { model: EditorModel; version: Version; onClose: () => void }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  return (
    <Dialog title="Schedule publish" onClose={onClose}>
      {(close) => (
        <form onSubmit={(e) => {
          e.preventDefault();
          const at = zonedInstant(`${date.trim()} ${time.trim()}`, model.timeZone);
          if (!at) { setError("Use YYYY-MM-DD and HH:mm:ss."); return; }
          void run(async () => {
            try {
              const updated = await post<Version>(`/api/versions/${version.id}/schedule`, { publishAt: isoSecond(at) });
              model.setStatus(`Version ${updated.number} goes live ${localTime(isoSecond(at), model.timeZone)}.`);
              await model.loadVersions();
              model.emit();
              close();
            } catch (err) {
              const copy: Record<string, string> = {
                approval_required: "This version needs an approval from someone other than its author.",
                another_version_scheduled: "Another version of this scene is already scheduled.",
              };
              if (err instanceof ApiError && err.status === 422) setError("Pick a time between 5 seconds and 365 days from now.");
              else { model.setStatus(err instanceof ApiError && copy[err.code] ? copy[err.code] : failure(err)); close(); }
            }
          });
        }}>
          <div class="dialog-body">
            <p>{`v${version.number} · ${version.label}`}</p>
            <Field label="Publish date" placeholder="YYYY-MM-DD" value={date} onInput={(e) => setDate(e.currentTarget.value)} />
            <Field label="Publish time" placeholder="HH:mm:ss" value={time} onInput={(e) => setTime(e.currentTarget.value)} error={error} />
            <p class="muted small">Time zone: {model.timeZone}</p>
          </div>
          <footer><Button onClick={close}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Schedule</Button></footer>
        </form>
      )}
    </Dialog>
  );
}

function SaveVersionDialog({ model, onClose }: { model: EditorModel; onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  return (
    <Dialog title="Save version" onClose={onClose}>
      {(close) => (
        <form onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            try {
              const version = await post<Version>(`/api/scenes/${model.sceneId}/versions`, { label });
              model.setStatus(`Version ${version.number} saved.`);
              await model.uploadThumbnail(version.id);
              await model.loadVersions();
              model.emit();
              close();
            } catch (err) {
              if (err instanceof ApiError && err.status === 422) setError(err.fieldErrors.label ?? "Use 1 to 60 characters");
              else { model.setStatus(failure(err)); close(); }
            }
          });
        }}>
          <div class="dialog-body">
            <Field label="Version label" value={label} onInput={(e) => setLabel(e.currentTarget.value)} error={error} />
            <p class="muted small">Saves the scene as it is at operation {model.latestSeq}. Later edits never change it.</p>
          </div>
          <footer><Button onClick={close}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Save</Button></footer>
        </form>
      )}
    </Dialog>
  );
}

function VersionsPanel({ model, can }: { model: EditorModel; can: Permissions }) {
  const [saving, setSaving] = useState(false);
  return (
    <section aria-labelledby="versions-title">
      <div class="panel-title"><h2 id="versions-title">Versions</h2>{can.manageVersions ? <Button small variant="primary" onClick={() => setSaving(true)}>Save version</Button> : null}</div>
      <div class="panel-body">
        {model.versions.length === 0 ? <p class="muted small">No versions yet. Save one to send it for review.</p> : null}
        <ul class="thread-list">{[...model.versions].reverse().map((v) => <VersionRow key={v.id} model={model} version={v} can={can} />)}</ul>
      </div>
      {saving ? <SaveVersionDialog model={model} onClose={() => setSaving(false)} /> : null}
    </section>
  );
}

// --- Review links ----------------------------------------------------------------------------------------------

function ReviewLinksPanel({ model, can }: { model: EditorModel; can: Permissions }) {
  const [creating, setCreating] = useState(false);
  const target = [...model.versions].reverse().find((v) => v.state === "draft" || v.state === "in_review" || v.state === "scheduled");
  const refresh = async () => { await model.loadVersions(); model.emit(); };
  const regenerate = async (link: ReviewLink) => {
    try {
      const fresh = await post<{ token: string }>(`/api/review-links/${link.id}/regenerate`);
      await refresh();
      model.links = model.links.map((l) => (l.id === link.id ? { ...l, token: fresh.token } : l));
      model.setStatus("New link created. The old link no longer works.");
    } catch (error) { model.setStatus(failure(error)); }
  };
  const revoke = async (link: ReviewLink) => {
    try { await del(`/api/review-links/${link.id}`); await refresh(); model.setStatus("Link revoked."); }
    catch (error) { model.setStatus(failure(error)); }
  };
  const copy = async (link: ReviewLink) => {
    if (!link.token) return;
    await navigator.clipboard.writeText(`${location.origin}/review/${link.token}`);
    model.setStatus("Link copied.");
  };
  const visible = model.links.filter((l) => l.status === "active");
  return (
    <section aria-labelledby="links-title">
      <div class="panel-title"><h2 id="links-title">Review links</h2>{can.manageVersions ? <Button small onClick={() => setCreating(true)}>Create review link</Button> : null}</div>
      <div class="panel-body">
        <p class="muted small">{target ? `New links open v${target.number} · ${target.label}, read only, without signing in.` : "Save a version to share a read-only review link."}</p>
        <ul class="link-list">
          {visible.map((link) => {
            const version = model.versions.find((v) => v.id === link.versionId);
            return (
              <li key={link.id}>
                <span class="small">v{version?.number} · expires <span class="num">{model.localTime(link.expiresAt)}</span></span>
                <span class="row-actions">
                  {link.token ? <Button small onClick={() => { void copy(link); }}>Copy link</Button> : null}
                  {can.manageVersions ? <Button small onClick={() => { void regenerate(link); }}>Regenerate link</Button> : null}
                  {can.manageVersions ? <Button small onClick={() => { void revoke(link); }}>Revoke link</Button> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      {creating ? <CreateLinkDialog model={model} versionId={target?.id ?? null} onClose={() => setCreating(false)} /> : null}
    </section>
  );
}

function CreateLinkDialog({ model, versionId, onClose }: { model: EditorModel; versionId: string | null; onClose: () => void }) {
  const [expires, setExpires] = useState("");
  const [error, setError] = useState("");
  const [busy, run] = useBusy();
  return (
    <Dialog title="Create review link" onClose={onClose}>
      {(close) => (
        <form onSubmit={(e) => {
          e.preventDefault();
          const at = zonedInstant(expires, model.timeZone);
          if (!at) { setError(WALL_FORMAT_ERROR); return; }
          if (!versionId) { model.setStatus("Review links are only for versions that are not yet published."); close(); return; }
          void run(async () => {
            try {
              const link = await post<{ id: string; token: string; expiresAt: string }>(`/api/versions/${versionId}/review-links`, { expiresAt: isoSecond(at) });
              await model.loadVersions();
              model.links = model.links.map((l) => (l.id === link.id ? { ...l, token: link.token } : l));
              model.setStatus(`Review link created. It expires ${localTime(link.expiresAt, model.timeZone)}.`);
              close();
            } catch (err) {
              const copy: Record<string, string> = {
                review_links_disabled: "Review links are turned off for this workspace.",
                version_not_reviewable: "Review links are only for versions that are not yet published.",
              };
              if (err instanceof ApiError && err.status === 422) setError(err.fieldErrors.expiresAt ?? WALL_FORMAT_ERROR);
              else model.setStatus(err instanceof ApiError && copy[err.code] ? copy[err.code] : failure(err));
            }
          });
        }}>
          <div class="dialog-body">
            <Field label="Expires" placeholder="YYYY-MM-DD HH:mm:ss" value={expires} onInput={(e) => setExpires(e.currentTarget.value)} error={error} />
            <p class="muted small">Time zone: {model.timeZone}. Links last at most 30 days.</p>
          </div>
          <footer><Button onClick={close}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Create link</Button></footer>
        </form>
      )}
    </Dialog>
  );
}

// --- Comments --------------------------------------------------------------------------------------------------

interface Mentionable { id: string; name: string; role: string }

function CommentsPanel({ model, can }: { model: EditorModel; can: Permissions }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Mentionable[]>([]);
  const [options, setOptions] = useState<Mentionable[]>([]);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const box = useRef<HTMLTextAreaElement>(null);
  const threads = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (query === null) { setOptions([]); return; }
    let live = true;
    get<{ members: Mentionable[] }>(`/api/scenes/${model.sceneId}/mentionable?q=${encodeURIComponent(query)}`)
      .then((r) => { if (live) { setOptions(r.members); setActive(0); } }, () => undefined);
    return () => { live = false; };
  }, [query]);

  useEffect(() => {
    if (!model.focusThread) return;
    threads.current?.querySelector<HTMLElement>(`[data-thread="${model.focusThread}"]`)?.scrollIntoView({ block: "nearest" });
  }, [model.focusThread]);

  const onInput = (e: Event) => {
    const textarea = e.currentTarget as HTMLTextAreaElement;
    setBody(textarea.value);
    const before = textarea.value.slice(0, textarea.selectionStart ?? textarea.value.length);
    const match = /@([^@\n]{0,40})$/.exec(before);
    setQuery(match ? match[1] : null);
  };
  const insert = (member: Mentionable) => {
    const textarea = box.current;
    if (!textarea || query === null) return;
    const caret = textarea.selectionStart ?? body.length;
    const start = body.slice(0, caret).lastIndexOf("@");
    const next = `${body.slice(0, start)}@${member.name} ${body.slice(caret)}`;
    setBody(next);
    setPicked([...picked.filter((p) => p.id !== member.id), member]);
    setQuery(null);
    requestAnimationFrame(() => { textarea.focus(); const at = start + member.name.length + 2; textarea.setSelectionRange(at, at); });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (query === null || options.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((active + 1) % options.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((active - 1 + options.length) % options.length); }
    else if (e.key === "Enter") { e.preventDefault(); insert(options[active]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setQuery(null); }
  };
  const submit = () => run(async () => {
    setError("");
    if (!model.selection) { setError("Select an object to pin the comment to."); return; }
    const mentions = picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    try {
      await post(`/api/scenes/${model.sceneId}/comments`, { nodeId: model.selection, body, mentions });
      setBody("");
      setPicked([]);
      model.setStatus("Comment posted.");
      await model.loadComments();
      model.emit();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setError(err.fieldErrors.body ?? "Use 1 to 2000 characters");
      else model.setStatus(failure(err));
    }
  });
  const resolve = async (comment: Comment) => {
    try {
      await patch(`/api/comments/${comment.id}`, { resolved: !comment.resolved });
      await model.loadComments();
      model.setStatus(comment.resolved ? "Thread reopened." : "Thread resolved.");
    } catch (err) { model.setStatus(failure(err)); }
  };
  const sorted = [...model.comments].sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.createdAt.localeCompare(b.createdAt));
  const listId = "mention-options";
  return (
    <section role="region" aria-label="Comments" class="sheet-comments">
      <div class="panel-title"><h2>Comments</h2><span class="muted small">{model.selection ? `Pinned to ${model.nodeName(model.selection)}` : "Select an object to pin"}</span></div>
      <div class="panel-body">
        {can.comment ? (
          <div class="composer">
            <label for="comment-box">Comment</label>
            <textarea id="comment-box" ref={box} value={body} onInput={onInput} onKeyDown={onKeyDown} aria-label="Comment"
              aria-invalid={error ? "true" : undefined} aria-describedby={error ? "comment-error" : undefined}
              aria-controls={query !== null ? listId : undefined} aria-activedescendant={query !== null && options[active] ? `mention-${options[active].id}` : undefined}
              placeholder="Type @ to mention a teammate" />
            {query !== null && options.length > 0 ? (
              <ul id={listId} role="listbox" aria-label="Mention a teammate" class="mention-list">
                {options.map((m, i) => (
                  <li key={m.id} id={`mention-${m.id}`} role="option" aria-selected={i === active ? "true" : "false"}
                    onMouseDown={(e) => { e.preventDefault(); insert(m); }}>{m.name}<span class="muted small"> · {m.role.replace("_", " ")}</span></li>
                ))}
              </ul>
            ) : null}
            {error ? <span class="field-error" id="comment-error">{error}</span> : null}
            <div><Button variant="primary" busy={busy} onClick={() => { void submit(); }}><Icon name="comment" />Post comment</Button></div>
          </div>
        ) : null}
        <ul class="thread-list" ref={threads}>
          {sorted.map((c) => (
            <li key={c.id} data-thread={c.id} class={`thread${c.resolved ? " resolved" : ""}${model.focusThread === c.id ? " focused" : ""}`}>
              <div class="thread-meta"><span>{c.author.name} · on {model.nodeName(c.nodeId)}</span><span class="num">{model.localTime(c.createdAt)}</span></div>
              <p>{c.body}</p>
              {can.comment ? <div><Button small onClick={() => { void resolve(c); }}>{c.resolved ? "Reopen" : "Resolve"}</Button></div> : null}
            </li>
          ))}
        </ul>
        {model.comments.length === 0 ? (
          <div class="empty"><EmptyDrawing /><p>No comments yet. Select an object, then pin a comment to it.</p></div>
        ) : null}
      </div>
    </section>
  );
}

// --- Assets ----------------------------------------------------------------------------------------------------

function AssetsPanel({ model, can, onAdd }: { model: EditorModel; can: Permissions; onAdd: (assetId: string, name: string) => void }) {
  const modelInput = useRef<HTMLInputElement>(null);
  const textureInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  const upload = async (kind: "model" | "texture", file: File) => {
    setStatus(`Uploading ${file.name}…`);
    const form = new FormData();
    form.append("kind", kind);
    form.append("file", file, file.name);
    try {
      await request("POST", "/api/assets", undefined, { raw: form });
      setStatus(`${file.name} uploaded.`);
      await model.loadAssets();
      model.emit();
    } catch (error) {
      if (!(error instanceof ApiError)) { setStatus(`${file.name} could not be uploaded.`); return; }
      if (error.code === "file_too_large") setStatus(`${file.name} is too large. The limit is ${String(error.body.limitBytes)} bytes.`);
      else if (error.code === "unsupported_type") setStatus(`${file.name} is not a binary glTF model or a PNG or JPEG texture.`);
      else if (error.fieldErrors.file === "File name is not allowed") setStatus(`${file.name} has a name that is not allowed.`);
      else if (error.fieldErrors.file) setStatus("Textures can be at most 4096 by 4096 pixels.");
      else setStatus(failure(error));
    }
  };
  const pick = (kind: "model" | "texture") => (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void upload(kind, file);
    input.value = "";
  };
  return (
    <section aria-labelledby="assets-title">
      <div class="panel-title"><h2 id="assets-title">Assets</h2></div>
      <div class="panel-body">
        {can.upload ? (
          <div class="row-actions" style={{ justifyContent: "flex-start" }}>
            <Button small onClick={() => modelInput.current?.click()}><Icon name="upload" />Upload model</Button>
            <Button small onClick={() => textureInput.current?.click()}><Icon name="upload" />Upload texture</Button>
            <input ref={modelInput} type="file" accept=".glb,model/gltf-binary" hidden onChange={pick("model")} />
            <input ref={textureInput} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" hidden onChange={pick("texture")} />
          </div>
        ) : null}
        <Status label="Upload status" text={status} />
        <ul aria-label="Assets" class="asset-list">
          {model.assets.map((a) => (
            <li key={a.id}>
              <span class="truncate" title={a.name}>{a.name}<span class="muted small"> · {a.kind} · <span class="num">{a.bytes}</span> bytes</span></span>
              {a.kind === "model" && model.canEdit ? <Button small onClick={() => onAdd(a.id, a.name)}>{`Add ${a.name} to scene`}</Button> : null}
            </li>
          ))}
        </ul>
        {model.assets.length === 0 ? <p class="muted small">Upload a .glb model or a PNG or JPEG texture.</p> : null}
      </div>
    </section>
  );
}

export function Sheet({ model, can, onAddAsset }: { model: EditorModel; can: Permissions; onAddAsset: (assetId: string, name: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (ref.current) enterMotion(ref.current, "x"); }, []);
  return (
    <aside ref={ref} id="editor-sheet" class="panel sheet" aria-label="Versions, review links, comments and assets">
      <div class="sheet-versions">
        <VersionsPanel model={model} can={can} />
        <ReviewLinksPanel model={model} can={can} />
      </div>
      <CommentsPanel model={model} can={can} />
      <div class="sheet-versions"><AssetsPanel model={model} can={can} onAdd={onAddAsset} /></div>
    </aside>
  );
}

