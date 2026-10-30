import { el, label, busy, openDialog } from "../dom";
import { api, errorText, localTime, type Me, type VersionT, type CommentT, type AuthorT, type Graph, type NodeT } from "../api";

export interface SheetContext {
  me: Me;
  sceneId: string;
  timeZone: string;
  canEdit: boolean;
  versions: VersionT[];
  comments: CommentT[];
  selectedNodeId: string | null;
  graphAtLatest: Graph;
  onStatus(text: string, isError?: boolean): void;
  refresh(): Promise<void>;
}

export function buildSheet(ctx: SheetContext): HTMLElement {
  const sheet = el("aside", { className: "sidesheet" });
  let tab = "Versions";
  const body = el("div", { className: "panel" });
  body.setAttribute("role", "region");
  body.setAttribute("aria-label", tab);

  function render(): void {
    const tabs = el("div", { className: "states-row" });
    for (const name of ["Versions", "Review links", "Comments", "Assets"]) {
      const btn = el("button", { className: "btn", text: name });
      btn.setAttribute("aria-pressed", String(name === tab));
      btn.addEventListener("click", () => {
        tab = name;
        render();
      });
      tabs.append(btn);
    }
    body.setAttribute("aria-label", tab);
    body.textContent = "";
    if (tab === "Versions") body.append(versionsPanel(ctx));
    else if (tab === "Review links") body.append(reviewPanel(ctx));
    else if (tab === "Comments") body.append(commentsPanel(ctx));
    else body.append(assetsPanel(ctx));
    sheet.textContent = "";
    sheet.append(el("h3", { text: "Versions" }), tabs, body);
  }
  render();
  void ctx.refresh;
  return sheet;
}

function versionsPanel(ctx: SheetContext): HTMLElement {
  const region = el("div", {});
  const saveBtn = el("button", { className: "btn primary", text: "Save version" });
  label(saveBtn, "Save version");
  saveBtn.addEventListener("click", () => {
    const labelInput = el("input", { type: "text", id: "sv-label" }) as HTMLInputElement;
    const save = el("button", { className: "btn primary", type: "submit", text: "Save" });
    const form = el("form", {}, el("div", { className: "field" }, el("label", { for: labelInput.id, text: "Version label" }), labelInput), save);
    form.setAttribute("aria-label", "Save version");
    const dialog = openDialog(form, { name: "Save version", onOpen: () => labelInput.focus() });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = busy(save);
      b.start();
      try {
        const version = (await api(`/api/scenes/${ctx.sceneId}/versions`, { method: "POST", body: { label: labelInput.value } })) as VersionT;
        ctx.onStatus(`Version ${version.number} saved.`);
        dialog.close();
        await ctx.refresh();
      } catch (err) {
        ctx.onStatus(errorText(err), true);
      } finally {
        b.end();
      }
    });
  });
  region.append(saveBtn);

  const stateNames: Record<string, string> = { draft: "Draft", in_review: "In review", scheduled: "Scheduled", published: "Published", withdrawn: "Withdrawn" };
  for (const version of [...ctx.versions].sort((a, b) => b.number - a.number)) {
    const row = el("div", { className: "comment-thread" });
    const waitingForStorage = version.state === "scheduled" && version.publishAt !== null && new Date(version.publishAt).getTime() <= Date.now();
    row.append(el("div", { className: "num", text: `v${version.number} · ${version.label} · ${waitingForStorage ? "Waiting for file storage" : stateNames[version.state]}` }));
    const actions = el("div", { className: "states-row" });
    const add = (btn: HTMLButtonElement, fn: () => Promise<void>): void => {
      btn.addEventListener("click", async () => {
        const b = busy(btn);
        b.start();
        try {
          await fn();
          await ctx.refresh();
        } catch (err) {
          ctx.onStatus(errorText(err), true);
        } finally {
          b.end();
        }
      });
      actions.append(btn);
    };
    if (ctx.canEdit && version.state === "draft") {
      add(el("button", { className: "btn", text: "Submit for review" }), async () => {
        await api(`/api/versions/${version.id}/submit`, { method: "POST" });
        ctx.onStatus("Submitted for review.");
      });
    }
    if (version.state === "in_review" && ctx.me.member?.id !== version.createdBy.id) {
      add(el("button", { className: "btn", text: "Approve" }), async () => {
        await api(`/api/versions/${version.id}/approve`, { method: "POST" });
        ctx.onStatus("Approved.");
      });
    }
    if (ctx.canEdit && version.state === "in_review") {
      const schedule = el("button", { className: "btn", text: "Schedule publish" });
      schedule.addEventListener("click", () => openScheduleDialog(ctx, version));
      actions.append(schedule);
    }
    if (ctx.canEdit && version.state === "scheduled") {
      add(el("button", { className: "btn", text: "Unschedule" }), async () => {
        await api(`/api/versions/${version.id}/unschedule`, { method: "POST" });
        ctx.onStatus("Back in review.");
      });
    }
    if (ctx.canEdit && version.state === "published") {
      add(el("button", { className: "btn", text: "Withdraw" }), async () => {
        await api(`/api/versions/${version.id}/withdraw`, { method: "POST" });
        ctx.onStatus("Withdrawn. The embed no longer shows this version.");
      });
      add(el("button", { className: "btn", text: "Create export" }), async () => {
        const result = (await api(`/api/versions/${version.id}/exports`, { method: "POST" })) as { id: string };
        ctx.onStatus("Export ready.");
        const link = el("a", { className: "btn", href: `/api/exports/${result.id}`, text: "Download export" });
        label(link, "Download export");
        row.append(link);
      });
      if (version.embedId) {
        actions.append(el("a", { className: "btn", href: `/embed/${version.embedId}`, target: "_blank", text: "Open embed" }));
      }
    }
    row.append(actions);
    region.append(row);
  }
  return region;
}

function openScheduleDialog(ctx: SheetContext, version: VersionT): void {
  const date = el("input", { type: "text", placeholder: "YYYY-MM-DD", id: "sc-date" }) as HTMLInputElement;
  label(date, "Publish date");
  const time = el("input", { type: "text", placeholder: "HH:mm:ss", id: "sc-time" }) as HTMLInputElement;
  label(time, "Publish time");
  const scheduleBtn = el("button", { className: "btn primary", type: "submit", text: "Schedule" });
  const form = el("form", {},
    el("div", { className: "field" }, el("label", { for: date.id, text: "Publish date" }), date),
    el("div", { className: "field" }, el("label", { for: time.id, text: "Publish time" }), time),
    el("p", { className: "num", text: `Time zone: ${ctx.timeZone}` }),
    scheduleBtn,
  );
  form.setAttribute("aria-label", "Schedule publish");
  const dialog = openDialog(form, { name: "Schedule publish", onOpen: () => date.focus() });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = busy(scheduleBtn);
    b.start();
    try {
      const publishAt = `${date.value.trim()} ${time.value.trim()}`;
      const updated = (await api(`/api/versions/${version.id}/schedule`, { method: "POST", body: { publishAt } })) as VersionT;
      ctx.onStatus(`Version ${updated.number} goes live ${localTime(new Date(updated.publishAt!), ctx.timeZone)}.`);
      dialog.close();
      await ctx.refresh();
    } catch (err) {
      ctx.onStatus(errorText(err), true);
    } finally {
      b.end();
    }
  });
}

function reviewPanel(ctx: SheetContext): HTMLElement {
  const region = el("div", {});
  const createBtn = el("button", { className: "btn primary", text: "Create review link" });
  createBtn.addEventListener("click", () => {
    const expires = el("input", { type: "text", placeholder: "YYYY-MM-DD HH:mm:ss", id: "rl-expires" }) as HTMLInputElement;
    label(expires, "Expires");
    const create = el("button", { className: "btn primary", type: "submit", text: "Create link" });
    const form = el("form", {}, el("div", { className: "field" }, el("label", { for: expires.id, text: "Expires" }), expires), create);
    form.setAttribute("aria-label", "Create review link");
    const dialog = openDialog(form, { name: "Create review link", onOpen: () => expires.focus() });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = busy(create);
      b.start();
      try {
        const version = ctx.versions.filter((v) => ["draft", "in_review", "scheduled"].includes(v.state)).sort((a, b2) => b2.number - a.number)[0];
        if (!version) throw new Error("Save a version first.");
        const link = (await api(`/api/versions/${version.id}/review-links`, { method: "POST", body: { expiresAt: expires.value } })) as { url: string; expiresAt: string };
        ctx.onStatus(`Review link created. It expires ${localTime(new Date(link.expiresAt), ctx.timeZone)}.`);
        dialog.close();
      } catch (err) {
        ctx.onStatus(errorText(err), true);
      } finally {
        b.end();
      }
    });
  });
  region.append(createBtn);
  void refreshReviewLinks(region, ctx);
  return region;
}

async function refreshReviewLinks(region: HTMLElement, ctx: SheetContext): Promise<void> {
  const version = ctx.versions.filter((v) => ["draft", "in_review", "scheduled"].includes(v.state)).sort((a, b) => b.number - a.number)[0];
  if (!version) {
    region.append(el("p", { text: "Save a version first." }));
    return;
  }
  try {
    const data = (await api(`/api/versions/${version.id}/review-links`)) as { links: { id: string; status: string; expiresAt: string }[] };
    if (data.links.length === 0) {
      region.append(el("p", { text: "No review links yet." }));
    }
    for (const link of data.links) {
      const row = el("div", { className: "comment-thread" });
      row.append(el("div", { className: "num", text: `Link · ${link.status} · expires ${localTime(new Date(link.expiresAt), ctx.timeZone)}` }));
      const actions = el("div", { className: "states-row" });
      if (link.status === "active") {
        const copy = el("button", { className: "btn", text: "Copy link" });
        copy.addEventListener("click", async () => {
          const links = (await api(`/api/versions/${version.id}/review-links`)) as { links: { id: string; status: string }[] };
          void links;
          const fresh = await api(`/api/versions/${version.id}/review-links`);
          void fresh;
          const url = region.dataset.linkUrl ?? "";
          try {
            await navigator.clipboard.writeText(`${window.location.origin}${url}`);
          } catch {
            // clipboard unavailable
          }
        });
        actions.append(copy);
        const regenerate = el("button", { className: "btn", text: "Regenerate link" });
        const b1 = busy(regenerate);
        regenerate.addEventListener("click", async () => {
          b1.start();
          try {
            const fresh = (await api(`/api/review-links/${link.id}/regenerate`, { method: "POST" })) as { url: string };
            ctx.onStatus("New link created. The old link no longer works.");
            region.dispatchEvent(new CustomEvent("refresh"));
            region.textContent = "";
            await refreshReviewLinks(region, ctx);
            region.dataset.linkUrl = fresh.url;
          } finally {
            b1.end();
          }
        });
        actions.append(regenerate);
      }
      const revoke = el("button", { className: "btn danger", text: "Revoke link" });
      const b2 = busy(revoke);
      revoke.addEventListener("click", async () => {
        b2.start();
        try {
          await api(`/api/review-links/${link.id}`, { method: "DELETE" });
          ctx.onStatus("Link revoked.");
          region.textContent = "";
          await refreshReviewLinks(region, ctx);
        } finally {
          b2.end();
        }
      });
      actions.append(revoke);
      row.append(actions);
      region.append(row);
    }
  } catch {
    region.append(el("p", { text: "Review links are only for versions that are not yet published." }));
  }
}

function commentsPanel(ctx: SheetContext): HTMLElement {
  const region = el("div", {});
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", "Comments");
  const list = el("div", {});
  function nodeName(nodeId: string): string {
    return ctx.graphAtLatest.nodes.find((n: NodeT) => n.id === nodeId)?.name ?? nodeId;
  }
  for (const comment of ctx.comments) {
    const thread = el("div", { className: `comment-thread${comment.resolved ? " resolved" : ""}` });
    thread.append(
      el("div", { className: "meta", text: `${comment.author.name} on ${nodeName(comment.nodeId)}` }),
      el("div", { className: "body", text: comment.body }),
    );
    const resolve = el("button", { className: "btn", text: "Resolve" });
    label(resolve, "Resolve");
    resolve.addEventListener("click", async () => {
      await api(`/api/comments/${comment.id}`, { method: "PATCH", body: { resolved: !comment.resolved } });
      await ctx.refresh();
    });
    thread.append(resolve);
    list.append(thread);
  }
  const input = el("textarea", { rows: 3, placeholder: "Comment on the selected object…" }) as HTMLTextAreaElement;
  input.setAttribute("aria-label", "Comment");
  const post = el("button", { className: "btn primary", text: "Post comment" });
  label(post, "Post comment");
  const mentionList = el("ul", { className: "mention-list", style: { display: "none" }, role: "listbox" });
  label(mentionList, "Mention a teammate");
  let mentionStart = -1;
  let mentionQuery = "";
  let mentionIndex = 0;
  let mentionMembers: { id: string; name: string }[] = [];
  input.addEventListener("input", async () => {
    const text = input.value;
    const at = text.lastIndexOf("@");
    if (at === -1) {
      mentionList.style.display = "none";
      mentionStart = -1;
      return;
    }
    const query = text.slice(at + 1).split(/\s/)[0] ?? "";
    mentionStart = at;
    mentionQuery = query;
    const data = (await api(`/api/scenes/${ctx.sceneId}/mentionable?q=${encodeURIComponent(query)}`)) as { members: { id: string; name: string }[] };
    mentionMembers = data.members;
    mentionIndex = 0;
    mentionList.textContent = "";
    mentionMembers.forEach((member, i) => {
      const option = el("li", { role: "option", text: member.name });
      if (i === 0) option.classList.add("active");
      option.addEventListener("click", () => {
        insertMention(member.name);
      });
      mentionList.append(option);
    });
    mentionList.style.display = mentionMembers.length > 0 ? "" : "none";
  });
  function insertMention(name: string): void {
    input.value = `${input.value.slice(0, mentionStart)}@${name} `;
    mentionList.style.display = "none";
    input.focus();
  }
  input.addEventListener("keydown", (e) => {
    if (mentionList.style.display === "none") return;
    const options = Array.from(mentionList.querySelectorAll<HTMLElement>("[role='option']"));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      mentionIndex = (mentionIndex + 1) % options.length;
      options.forEach((o, i) => o.classList.toggle("active", i === mentionIndex));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      mentionIndex = (mentionIndex - 1 + options.length) % options.length;
      options.forEach((o, i) => o.classList.toggle("active", i === mentionIndex));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const member = mentionMembers[mentionIndex];
      if (member) insertMention(member.name);
    } else if (e.key === "Escape") {
      mentionList.style.display = "none";
    }
  });
  post.addEventListener("click", async () => {
    if (!ctx.selectedNodeId) {
      ctx.onStatus("Select an object first.", true);
      return;
    }
    const b = busy(post);
    b.start();
    try {
      const data = (await api(`/api/scenes/${ctx.sceneId}/mentionable?q=`)) as { members: { id: string; name: string }[] };
      const mentions = data.members.filter((m) => input.value.includes(`@${m.name}`)).map((m) => m.id);
      await api(`/api/scenes/${ctx.sceneId}/comments`, { method: "POST", body: { nodeId: ctx.selectedNodeId, body: input.value, mentions } });
      ctx.onStatus("Comment posted.");
      input.value = "";
      await ctx.refresh();
    } catch (err) {
      ctx.onStatus(errorText(err), true);
    } finally {
      b.end();
    }
  });
  region.append(list, input, mentionList, post);
  void ({} as AuthorT);
  return region;
}

function assetsPanel(ctx: SheetContext): HTMLElement {
  const region = el("div", {});
  const uploadStatus = el("div", { className: "status", role: "status" });
  label(uploadStatus, "Upload status");
  const modelBtn = el("button", { className: "btn", text: "Upload model" });
  label(modelBtn, "Upload model");
  const textureBtn = el("button", { className: "btn", text: "Upload texture" });
  label(textureBtn, "Upload texture");
  const list = el("ul", { className: "layers" });
  list.setAttribute("role", "list");
  label(list, "Assets");

  async function refreshAssets(): Promise<void> {
    const data = (await api("/api/assets")) as { assets: { id: string; kind: string; name: string; bytes: number }[] };
    list.textContent = "";
    for (const asset of data.assets) {
      const item = el("li", {}, el("div", { className: "num", text: `${asset.name} · ${asset.kind} · ${asset.bytes} bytes` }));
      const addBtn = el("button", { className: "btn", text: `Add ${asset.name} to scene` });
      label(addBtn, `Add ${asset.name} to scene`);
      addBtn.addEventListener("click", async () => {
        const b = busy(addBtn);
        b.start();
        try {
          await api(`/api/scenes/${ctx.sceneId}/ops`, {
            method: "POST",
            body: {
              ops: [{
                type: "node.add",
                payload: {
                  node: {
                    id: `n_${Date.now().toString(36)}`,
                    name: asset.name,
                    kind: "mesh",
                    parentId: ctx.selectedNodeId ?? "n_root",
                    primitive: "box",
                    assetId: asset.id,
                    position: [0, 0, 0],
                    rotation: [0, 0, 0],
                    scale: [1, 1, 1],
                    materialLayers: [],
                    visible: true,
                  },
                },
              }],
            },
          });
          await ctx.refresh();
        } catch (err) {
          ctx.onStatus(errorText(err), true);
        } finally {
          b.end();
        }
      });
      item.append(addBtn);
      list.append(item);
    }
  }
  void refreshAssets();

  async function upload(kind: "model" | "texture"): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = kind === "model" ? ".glb" : ".png,.jpg,.jpeg";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      uploadStatus.textContent = `Uploading ${file.name}…`;
      uploadStatus.classList.remove("error");
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      const res = await fetch("/api/assets", { method: "POST", body: form, credentials: "same-origin" });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const errors = body.errors as Record<string, string> | undefined;
        if (res.status === 413) {
          uploadStatus.textContent = `${file.name} is too large. The limit is ${String(body.limitBytes)} bytes.`;
        } else if (res.status === 415) {
          uploadStatus.textContent = `${file.name} is not a binary glTF model or a PNG or JPEG texture.`;
        } else if (errors?.file === "File name is not allowed") {
          uploadStatus.textContent = `${file.name} has a name that is not allowed.`;
        } else if (errors?.file) {
          uploadStatus.textContent = errors.file;
        } else if (res.status === 503) {
          uploadStatus.textContent = "File storage is unavailable. Your edits are saved; uploads, versions and publishing will resume when it is back.";
        } else {
          uploadStatus.textContent = "Upload failed.";
        }
        uploadStatus.classList.add("error");
        return;
      }
      uploadStatus.textContent = `${file.name} uploaded.`;
      await refreshAssets();
    });
    input.click();
  }
  modelBtn.addEventListener("click", () => void upload("model"));
  textureBtn.addEventListener("click", () => void upload("texture"));
  region.append(modelBtn, textureBtn, uploadStatus, list);
  return region;
}
