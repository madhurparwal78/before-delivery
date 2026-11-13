import { PageCtx } from "../main";
import { h, clearEl, Dialog } from "../ui";
import { api, ProjectDetail, Reviewer, SourceFile } from "../api";

export async function renderSettingsPage(ctx: PageCtx, slug: string): Promise<void> {
  const main = ctx.main;
  main.innerHTML = "";
  window.__deskCurrentSlug = slug;
  const detail = await api<ProjectDetail>(`/api/projects/${slug}`);

  const container = h("div", { class: "container", style: "padding-bottom:60px" });
  container.appendChild(h("div", { class: "page-head" },
    h("div", null, h("h1", {}, "Project settings"), h("p", { class: "sub" }, `${detail.name} · ${detail.client}`)),
    h("a", { class: "btn btn-outline btn-sm", href: `/projects/${slug}` }, "Back to project"),
  ));

  const grid = h("div", { class: "settings-grid", style: "margin-top:24px" });
  container.appendChild(grid);
  main.appendChild(container);

  // reviewers card
  const reviewersCard = h("div", { class: "card" });
  reviewersCard.appendChild(h("h3", { style: "font-size:1.15em" }, "Reviewers"));
  const rName = h("input", { class: "control", "aria-label": "Reviewer name" }) as HTMLInputElement;
  const rEmail = h("input", { class: "control", type: "email", "aria-label": "Reviewer email" }) as HTMLInputElement;
  reviewersCard.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Reviewer name"), rName));
  reviewersCard.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Reviewer email"), rEmail));
  const newKeyRegion = h("div", { role: "region", "aria-label": "New access key" });
  const inviteBtn = h("button", { class: "btn btn-primary" }, "Invite reviewer");
  reviewersCard.appendChild(inviteBtn);
  reviewersCard.appendChild(newKeyRegion);
  const reviewersList = h("div", { class: "mt-16" });
  reviewersCard.appendChild(reviewersList);
  grid.appendChild(reviewersCard);

  inviteBtn.addEventListener("click", async () => {
    inviteBtn.disabled = true;
    ctx.fb.setStatus("Inviting reviewer.");
    clearEl(newKeyRegion);
    try {
      const res = await api<{ name: string; access_key: string | null }>(`/api/projects/${slug}/reviewers`, { method: "POST", json: { name: rName.value.trim(), email: rEmail.value.trim() } });
      if (res.access_key) {
        ctx.fb.setStatus(`Invited ${res.name}. Copy the access key now; it won't be shown again.`);
        newKeyRegion.appendChild(h("div", { class: "secret-box" }, res.access_key));
      } else {
        ctx.fb.setStatus(`Added ${res.name} to this project.`);
      }
      rName.value = "";
      rEmail.value = "";
      await loadReviewers();
    } catch (e: any) {
      const msg = e.code === "reviewer_exists" ? "That reviewer already has access to this project." : e.message;
      ctx.fb.clearStatus();
      ctx.fb.setProblem(msg);
    } finally { inviteBtn.disabled = false; }
  });

  async function loadReviewers(): Promise<void> {
    clearEl(reviewersList);
    try {
      const res = await api<{ reviewers: Reviewer[] }>(`/api/projects/${slug}/reviewers`);
      if (res.reviewers.length === 0) { reviewersList.appendChild(h("p", { class: "muted" }, "No reviewers yet.")); return; }
      const ul = h("ul", { class: "info-list" });
      for (const r of res.reviewers) ul.appendChild(h("li", null, h("span", null, `${r.name} (${r.email})`)));
      reviewersList.appendChild(ul);
    } catch { reviewersList.appendChild(h("p", { class: "muted" }, "No reviewers yet.")); }
  }

  // tokens card
  const tokensCard = h("div", { class: "card" });
  tokensCard.appendChild(h("h3", { style: "font-size:1.15em" }, "CI tokens"));
  const tLabel = h("input", { class: "control", "aria-label": "Token label" }) as HTMLInputElement;
  tokensCard.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Token label"), tLabel));
  const createBtn = h("button", { class: "btn btn-primary" }, "Create token");
  tokensCard.appendChild(createBtn);
  const newTokenRegion = h("div", { role: "region", "aria-label": "New token" });
  tokensCard.appendChild(newTokenRegion);
  const tokensList = h("div", { class: "mt-16" });
  tokensCard.appendChild(tokensList);
  grid.appendChild(tokensCard);

  createBtn.addEventListener("click", async () => {
    createBtn.disabled = true;
    ctx.fb.setStatus("Creating token.");
    clearEl(newTokenRegion);
    try {
      const res = await api<{ token: string; label: string }>(`/api/projects/${slug}/tokens`, { method: "POST", json: { label: tLabel.value.trim() } });
      ctx.fb.setStatus("Token created. Copy it now; it won't be shown again.");
      newTokenRegion.appendChild(h("div", { class: "secret-box" }, res.token));
      tLabel.value = "";
      await loadTokens();
    } catch (e: any) {
      ctx.fb.clearStatus();
      ctx.fb.setProblem(e.message);
    } finally { createBtn.disabled = false; }
  });

  async function loadTokens(): Promise<void> {
    clearEl(tokensList);
    try {
      const res = await api<{ tokens: any[] }>(`/api/projects/${slug}/tokens`);
      if (res.tokens.length === 0) { tokensList.appendChild(h("p", { class: "muted" }, "No tokens yet.")); return; }
      const ul = h("ul", { class: "info-list" });
      for (const t of res.tokens) ul.appendChild(h("li", null, h("span", null, t.label)));
      tokensList.appendChild(ul);
    } catch { tokensList.appendChild(h("p", { class: "muted" }, "No tokens yet.")); }
  }

  // webhook card
  const hookCard = h("div", { class: "card" });
  hookCard.appendChild(h("h3", { style: "font-size:1.15em" }, "Webhook endpoint"));
  const url = h("input", { class: "control", type: "url", "aria-label": "Endpoint URL", placeholder: "https://ci.example.test/hook" }) as HTMLInputElement;
  hookCard.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Endpoint URL"), url));
  const saveHook = h("button", { class: "btn btn-primary" }, "Save endpoint");
  hookCard.appendChild(saveHook);
  const secretLine = h("p", { class: "small muted mt-8" }, "Signing secret: none yet");
  hookCard.appendChild(secretLine);
  grid.appendChild(hookCard);

  saveHook.addEventListener("click", async () => {
    saveHook.disabled = true;
    ctx.fb.setStatus("Saving endpoint.");
    try {
      const res = await api<{ url: string; signing_secret: string }>(`/api/projects/${slug}/webhook`, { method: "PUT", json: { url: url.value.trim() } });
      ctx.fb.setStatus("Webhook endpoint saved.");
      secretLine.textContent = `Signing secret: ${res.signing_secret}`;
    } catch (e: any) {
      ctx.fb.clearStatus();
      ctx.fb.setProblem(e.message);
    } finally { saveHook.disabled = false; }
  });

  api<any>(`/api/projects/${slug}/webhook`).then((res) => {
    url.value = res.url || "";
    secretLine.textContent = `Signing secret: ${res.signing_secret || "none"}`;
  }).catch(() => { /* none set */ });

  // source files card
  const filesCard = h("div", { class: "card" });
  filesCard.appendChild(h("h3", { style: "font-size:1.15em" }, "Source files"));
  const filesList = h("div", { class: "mt-8" });
  filesCard.appendChild(filesList);
  grid.appendChild(filesCard);

  async function loadFiles(): Promise<void> {
    clearEl(filesList);
    try {
      const res = await api<{ files: SourceFile[] }>(`/api/projects/${slug}/source-files`);
      if (res.files.length === 0) { filesList.appendChild(h("p", { class: "muted" }, "No source files uploaded yet.")); return; }
      const ul = h("ul", { class: "info-list" });
      for (const f of res.files) {
        const dl = h("a", { href: `/api/projects/${slug}/source-files/${f.file_id}/original`, download: f.filename, "data-download": "" }, "Download original");
        ul.appendChild(h("li", null, h("span", null, `${f.filename} · ${f.branch}`), h("span", null, dl)));
      }
      filesList.appendChild(ul);
    } catch { filesList.appendChild(h("p", { class: "muted" }, "No source files uploaded yet.")); }
  }

  // erase card
  const eraseCard = h("div", { class: "card", style: "margin-top:24px;border-left:4px solid var(--ink)" });
  eraseCard.appendChild(h("h3", { style: "font-size:1.15em" }, "Erase project"));
  eraseCard.appendChild(h("p", { class: "muted" }, "Removes every row, file, token and webhook application for this project."));
  const eraseBtn = h("button", { class: "btn btn-danger" }, "Erase project");
  eraseCard.appendChild(eraseBtn);
  container.appendChild(eraseCard);

  eraseBtn.addEventListener("click", () => {
    const confirmBox = h("input", { class: "control", "aria-label": "Type the project slug to confirm" }) as HTMLInputElement;
    const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Erase project" });
    dlg.appendChild(h("h2", {}, "Erase project"));
    dlg.appendChild(h("p", { class: "sub" }, `Type ${slug} to confirm. This removes every stored file and cannot be undone.`));
    dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Type the project slug to confirm"), confirmBox));
    const cancel = h("button", { class: "btn btn-outline" }, "Cancel");
    const erase = h("button", { class: "btn btn-primary" }, "Erase everything");
    dlg.appendChild(h("div", { class: "actions-row" }, cancel, erase));
    const dialog = new Dialog(dlg, eraseBtn);
    dialog.open();
    cancel.addEventListener("click", () => dialog.close(false));
    erase.addEventListener("click", async () => {
      erase.disabled = true;
      ctx.fb.setStatus("Erasing project.");
      try {
        await api(`/api/projects/${slug}`, { method: "DELETE", json: { confirm: confirmBox.value.trim() } });
        ctx.fb.setStatus(`Erased ${detail.name} and every stored file.`);
        dialog.close(true);
        await ctx.shell.refreshProjects();
        history.pushState(null, "", "/desk");
        window.dispatchEvent(new PopStateEvent("popstate"));
      } catch (e: any) {
        erase.disabled = false;
        ctx.fb.clearStatus();
        const msg = e.fields && e.fields.confirm ? "Type the project slug exactly to confirm." : e.message;
        ctx.fb.setProblem(msg);
        confirmBox.focus();
      }
    });
  });

  await Promise.all([loadReviewers(), loadTokens(), loadFiles()]);
}
