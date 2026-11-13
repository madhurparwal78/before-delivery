import { PageCtx } from "../main";
import { h, clearEl, Dialog } from "../ui";
import { api, ProjectDetail, Branch, MergePreview, statusWord, Publish } from "../api";
import { icon, hubDiagram } from "../illustrations";

interface RailState { branches: Branch[]; selected: string; }

export async function renderProjectPage(ctx: PageCtx, slug: string): Promise<void> {
  const main = ctx.main;
  main.innerHTML = "";
  window.__deskCurrentSlug = slug;

  let detail: ProjectDetail;
  try {
    detail = await api<ProjectDetail>(`/api/projects/${slug}`);
  } catch (e: any) {
    if (e.status === 404) throw e;
    throw e;
  }

  const container = h("div", { class: "container", style: "padding-bottom:60px" });
  container.appendChild(h("div", { class: "page-head" },
    h("div", null, h("h1", {}, detail.name), h("p", { class: "sub" }, `${detail.client} · ${detail.repository}`)),
    h("button", { class: "btn btn-outline", onclick: () => openNewBranch(ctx, slug) }, "New branch"),
  ));

  // ----- branch rail -----
  const rail = buildBranchRail(ctx, slug, detail);
  container.appendChild(rail.root);

  // ----- health cards -----
  const healthRow = h("div", { class: "grid-2", style: "margin-top:26px" });
  const importHealth = h("section", { class: "card", role: "region", "aria-label": "Import health" });
  const mergeHealth = h("section", { class: "card", role: "region", "aria-label": "Merge health" });
  fillHealthCards(importHealth, mergeHealth, slug, detail);
  healthRow.appendChild(importHealth);
  healthRow.appendChild(mergeHealth);
  container.appendChild(healthRow);

  // ----- workflows -----
  const wfRegion = h("section", { class: "band-outer", role: "region", "aria-label": "Workflows", style: "margin-top:34px" });
  const bandInner = h("div", { style: "background:var(--band);border-radius:var(--r-lg);padding:30px" });
  bandInner.appendChild(h("h2", { style: "font-size:1.4em;margin-bottom:6px" }, "Workflows"));
  bandInner.appendChild(h("p", { class: "muted", style: "margin-bottom:20px" }, "Everything one desk does with a client's strings."));
  const desktopGrid = h("div", { class: "wf-grid" });
  for (const c of buildWorkflowCards(ctx, slug, detail)) desktopGrid.appendChild(c);
  bandInner.appendChild(desktopGrid);
  const carousel = buildWorkflowCarousel(buildWorkflowCards(ctx, slug, detail));
  bandInner.appendChild(carousel.root);
  wfRegion.appendChild(bandInner);
  container.appendChild(wfRegion);

  // publish status region
  const pubRegion = h("div", { role: "region", "aria-label": "Publish status", class: "mt-24" });
  container.appendChild(pubRegion);

  main.appendChild(container);
  void rail;
}

function fillHealthCards(importHealth: HTMLElement, mergeHealth: HTMLElement, slug: string, detail: ProjectDetail): void {
  const rows = (items: Array<[string, number | string]>) => {
    const ul = h("ul", { class: "info-list" });
    for (const [label, val] of items) ul.appendChild(h("li", null, h("span", null, label), h("span", { class: "num" }, String(val))));
    return ul;
  };
  // import health
  importHealth.innerHTML = "";
  importHealth.appendChild(h("div", { class: "tile-row" }, tile("import"), tile("doc"), tile("undo")));
  importHealth.appendChild(h("h3", { style: "font-size:1.2em" }, "Import health"));
  importHealth.appendChild(h("p", { class: "muted", style: "margin-top:6px" }, "Legacy spreadsheets and TMX files migrate without losing an exact match."));
  importHealth.appendChild(h("p", { style: "margin-top:14px;font-weight:700" }, "Living with"));
  const importItems = h("div", { class: "mt-8" });
  importItems.appendChild(rows([
    ["Entries added", 0], ["Duplicates merged", 0], ["Exact matches reused", 0], ["Rows needing attention", 0],
  ]));
  importHealth.appendChild(importItems);
  const noImportsLine = h("p", { class: "muted small mt-8" }, "No imports yet.");
  importHealth.appendChild(noImportsLine);
  importHealth.appendChild(h("a", { class: "btn btn-outline btn-block", style: "margin-top:16px", href: `/projects/${slug}/tm` }, "Open import report", h("span", { class: "arrow", html: icon("arrow", 16) })));

  api<{ imports: any[] }>(`/api/projects/${slug}/tm/imports`).then(async (res) => {
    const latest = res.imports[0];
    if (!latest) return;
    const report = await api<any>(`/api/projects/${slug}/tm/imports/${latest.import_id}/report`);
    const lis = importHealth.querySelectorAll("ul li");
    if (lis.length === 4) {
      lis[0].querySelector(".num")!.textContent = String(report.added);
      lis[1].querySelector(".num")!.textContent = String(report.duplicates);
      lis[2].querySelector(".num")!.textContent = String(report.applied);
      lis[3].querySelector(".num")!.textContent = String(report.rows.length);
    }
    noImportsLine.remove();
  }).catch(() => { /* keep zeros and No imports yet line */ });

  // merge health
  mergeHealth.innerHTML = "";
  mergeHealth.appendChild(h("div", { class: "tile-row" }, tile("branch"), tile("merge"), tile("undo")));
  mergeHealth.appendChild(h("h3", { style: "font-size:1.2em" }, "Merge health"));
  mergeHealth.appendChild(h("p", { class: "muted", style: "margin-top:6px" }, "Branches keep a working copy of main, and merges never silently overwrite a string."));
  mergeHealth.appendChild(h("p", { style: "margin-top:14px;font-weight:700" }, "Living with"));
  mergeHealth.appendChild(rows([["Conflicts open", 0], ["Branches in review", 0], ["Last merge", "None"], ["Restorable operations", 0]]));
  mergeHealth.appendChild(h("a", { class: "btn btn-outline btn-block", style: "margin-top:16px", href: `/projects/${slug}/merge?branch=main` }, "Open merge preview", h("span", { class: "arrow", html: icon("arrow", 16) })));

  api<any>(`/api/projects/${slug}/operations`).then((res) => {
    const ops = res.operations || [];
    const lastMerge = ops.find((o: any) => o.kind === "merge");
    const restorable = ops.filter((o: any) => o.restorable).length;
    const list = mergeHealth.querySelector("ul");
    if (list) {
      const lis = list.querySelectorAll("li");
      lis[2].querySelector(".num")!.textContent = lastMerge ? "Yes" : "None";
      lis[3].querySelector(".num")!.textContent = String(restorable);
    }
  }).catch(() => { /* keep defaults */ });
  api<{ branches: Branch[] }>(`/api/projects/${slug}/branches`).then((res) => {
    const count = res.branches.filter((b) => b.state === "in_review").length;
    const list = mergeHealth.querySelector("ul");
    if (list) {
      const lis = list.querySelectorAll("li");
      lis[1].querySelector(".num")!.textContent = String(count);
    }
  }).catch(() => { /* keep defaults */ });
  api<{ publishes: Publish[] }>(`/api/projects/${slug}/publishes`).then((res) => {
    void res;
  }).catch(() => { /* ignore */ });
}


function tile(name: string): HTMLElement {
  const el = h("span", { class: "icon-tile plain" });
  el.innerHTML = icon(name, 20);
  return el;
}

// ---------- branch rail ----------

function buildBranchRail(ctx: PageCtx, slug: string, detail: ProjectDetail): { root: HTMLElement } {
  const root = h("section", { style: "margin-top:22px" });
  const strip = h("div", { class: "rail-strip", role: "tablist", "aria-label": "Branches" });
  const indicator = h("div", { class: "rail-indicator", style: "left:0;width:0" });
  const panelsHolder = h("div", { class: "rail-panel" });
  root.appendChild(strip);
  root.appendChild(panelsHolder);

  const branches = detail.branches;
  const railState: RailState = { branches, selected: "main" };
  const requested = new URLSearchParams(location.search).get("branch");
  const liveBranchNames = branches.filter((b) => !b.is_main && (b.state === "open" || b.state === "in_review")).map((b) => b.name);
  const allTabs = ["main", ...liveBranchNames];
  if (requested && allTabs.includes(requested)) railState.selected = requested;
  else if (requested && requested !== "main") {
    history.replaceState(null, "", `/projects/${slug}?branch=main`);
  }

  const tabs: Array<{ name: string; el: HTMLElement }> = [];
  for (const name of allTabs) {
    const idx = allTabs.indexOf(name);
    const tab = h("button", { class: "rail-tab", role: "tab", id: `tab-${cssId(name)}`, "aria-selected": name === railState.selected ? "true" : "false",
      "aria-controls": `panel-${cssId(name)}`, tabindex: name === railState.selected ? "0" : "-1" }, name);
    if (name !== "main") {
      const st = branches.find((b) => b.name === name);
      if (st) tab.appendChild(h("span", { class: "pill", style: "font-size:11px;color:var(--muted)" }, statusWord(st.state)));
    }
    tab.addEventListener("click", () => selectTab(name));
    tab.addEventListener("keydown", (ev: KeyboardEvent) => {
      if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        ev.preventDefault();
        const dir = ev.key === "ArrowRight" ? 1 : -1;
        const next = allTabs[(idx + dir + allTabs.length) % allTabs.length];
        selectTab(next);
        tabs.find((t) => t.name === next)!.el.focus();
      } else if (ev.key === "Home") {
        ev.preventDefault(); selectTab("main"); tabs[0].el.focus();
      } else if (ev.key === "End") {
        ev.preventDefault(); const last = allTabs[allTabs.length - 1]; selectTab(last); tabs.find((t) => t.name === last)!.el.focus();
      }
    });
    tabs.push({ name, el: tab });
    strip.appendChild(tab);
  }
  strip.appendChild(indicator);

  function positionIndicator(animated = true): void {
    const active = tabs.find((t) => t.name === railState.selected);
    if (!active) return;
    indicator.style.transitionDuration = animated ? "" : "0s";
    indicator.style.left = `${active.el.offsetLeft}px`;
    indicator.style.width = `${active.el.offsetWidth}px`;
    strip.scrollTo({ left: Math.max(0, active.el.offsetLeft - 60), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  async function loadPanel(name: string): Promise<void> {
    clearEl(panelsHolder);
    const panel = h("div", { class: "rail-panel", role: "tabpanel", id: `panel-${cssId(name)}`, "aria-labelledby": `tab-${cssId(name)}` });
    panelsHolder.appendChild(panel);
    const left = h("div");
    const illusCol = h("div", { class: "illus-col" });
    const grid = h("div", { class: "rail-grid" }, left, illusCol);
    panel.appendChild(grid);

    const countsHolder = h("div", { class: "counts-row" });
    for (let i = 0; i < 4; i++) countsHolder.appendChild(h("div", { class: "stat-col" }, h("div", { class: "skel big" })));
    left.appendChild(countsHolder);
    try {
      const prev = await api<MergePreview>(`/api/projects/${slug}/branches/${encodeURIComponent(name)}/merge-preview`);
      clearEl(countsHolder);
      const isMain = name === "main";
      const items: Array<[string, number | string]> = isMain
        ? [["Keys", prev.keys], ["Needs review", prev.needs_review], ["Below MQM threshold", prev.below_threshold], ["Last publish", lastPublishWord(detail.last_publish)]]
        : [["New keys", prev.new_keys], ["Edited keys", prev.edited_keys], ["Conflicts", prev.conflicts.filter((c) => !c.resolution).length], ["Below MQM threshold", prev.below_threshold]];
      for (const [cap, val] of items) {
        countsHolder.appendChild(h("div", { class: "stat-col" }, h("div", { class: "val num" }, String(val)), h("div", { class: "cap" }, cap)));
      }
      if (!isMain) {
        const conflictBlock = h("div", { class: "mt-16" });
        conflictBlock.appendChild(h("h4", { style: "font-size:1em" }, "Conflicting keys"));
        const list = h("ul", { class: "info-list" });
        const unresolved = prev.conflicts.filter((c) => !c.resolution);
        if (unresolved.length === 0) list.appendChild(h("li", null, h("span", { class: "muted" }, "No conflicts with main.")));
        else for (const c of unresolved) list.appendChild(h("li", null, h("span", null, c.key), h("span", { class: "muted" }, fieldWord(c.field))));
        conflictBlock.appendChild(list);
        const linksRow = h("div", { class: "row mt-16" });
        linksRow.appendChild(h("a", { class: "btn btn-outline btn-sm", href: `/projects/${slug}/editor?branch=${encodeURIComponent(name)}` }, "Open editor"));
        linksRow.appendChild(h("a", { class: "btn btn-outline btn-sm", href: `/projects/${slug}/merge?branch=${encodeURIComponent(name)}` }, "Open merge preview"));
        conflictBlock.appendChild(linksRow);
        left.appendChild(conflictBlock);
      } else {
        const linksRow = h("div", { class: "row mt-16" });
        linksRow.appendChild(h("a", { class: "btn btn-outline btn-sm", href: `/projects/${slug}/editor?branch=main` }, "Open editor"));
        left.appendChild(linksRow);
      }
      illusCol.innerHTML = hubDiagram({
        repository: detail.repository,
        tmCount: detail.tm_entries,
        routes: detail.target_languages.map((l) => [l, detail.ai_routes[l] || "lexa-general"] as [string, string]),
        label: `How ${name} connects to the repository, translation memory and AI route`,
      });
    } catch {
      clearEl(countsHolder);
      countsHolder.appendChild(h("p", { class: "muted" }, "The desk couldn't reach the server. Check your connection and try again."));
    }
  }

  function selectTab(name: string): void {
    railState.selected = name;
    for (const t of tabs) {
      t.el.setAttribute("aria-selected", t.name === name ? "true" : "false");
      t.el.setAttribute("tabindex", t.name === name ? "0" : "-1");
    }
    const url = `/projects/${slug}?branch=${encodeURIComponent(name)}`;
    history.replaceState(null, "", url);
    positionIndicator();
    // counts, URL and ARIA state change at the moment of choosing; the panels
    // fade out, pause 50ms, then fade in, unless the system asks for no motion
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const current = panelsHolder.firstElementChild as HTMLElement | null;
    if (reduce || !current) {
      void loadPanel(name);
      return;
    }
    current.classList.add("leave");
    setTimeout(() => {
      void loadPanel(name).then(() => {
        const next = panelsHolder.firstElementChild as HTMLElement | null;
        if (!next) return;
        setTimeout(() => {
          void next.offsetWidth;
          next.classList.add("enter");
        }, 50);
      });
    }, 150);
  }

  // initial
  for (const t of tabs) {
    t.el.setAttribute("aria-selected", t.name === railState.selected ? "true" : "false");
    t.el.setAttribute("tabindex", t.name === railState.selected ? "0" : "-1");
  }
  requestAnimationFrame(() => positionIndicator(false));
  void loadPanel(railState.selected);
  return { root };
}

function lastPublishWord(p: Publish | null): string {
  if (!p || !p.pull_request) return "Never";
  return `Pull request #${p.pull_request.number}`;
}

function fieldWord(f: string): string {
  if (f === "presence") return "presence";
  if (f.startsWith("translation:")) return f.slice(11);
  return f;
}

function cssId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-");
}

// ---------- workflows ----------

function buildWorkflowCards(ctx: PageCtx, slug: string, detail: ProjectDetail): HTMLElement[] {
  const mk = (title: string, body: string, glyph: string, onClick: () => void) => {
    const card = h("article", { class: "wf-card" });
    const gt = h("span", { class: "gt" });
    gt.innerHTML = `<span class="in">${icon(glyph, 20)}</span>`;
    card.appendChild(gt);
    card.appendChild(h("h3", { style: "margin-top:4px" }, title));
    card.appendChild(h("p", {}, body));
    card.appendChild(h("button", { class: "btn btn-outline btn-sm", onclick: onClick }, title));
    return card;
  };
  const openBranches = detail.branches.filter((b) => b.state === "open" || b.state === "in_review");
  return [
    mk("Import translation memory", "Bring a client's legacy spreadsheet or TMX file into the project's translation memory.", "import", () => location.assign(`/projects/${slug}/tm`)),
    mk("Upload source file", "Upload a JSON source locale file to an open branch's working copy.", "upload", () => openUploadDialog(ctx, slug, detail)),
    mk("Draft with AI", "Fill untranslated segments from exact matches first, then the routed AI engine.", "ai", () => openDraftDialog(ctx, slug, detail)),
    mk("Assign review", "Give a reviewer the segments that need review on one branch and language.", "review", () => openAssignDialog(ctx, slug, detail)),
    mk("Merge a branch", "Review conflicts, resolve them with a hold, and merge into main.", "merge", () => {
      const current = new URLSearchParams(location.search).get("branch");
      const branch = current && openBranches.find((b) => b.name === current) ? current : (openBranches[0] ? openBranches[0].name : "main");
      location.assign(`/projects/${slug}/merge?branch=${encodeURIComponent(branch)}`);
    }),
    mk("Publish", "Write approved locale bundles and open a pull request on the client's repository.", "publish", () => openPublishDialog(ctx, slug, detail)),
  ];
}

function buildWorkflowCarousel(cards: HTMLElement[]): { root: HTMLElement } {
  const root = h("div", { class: "carousel", hidden: false });
  const viewport = h("div", { class: "viewport" });
  const track = h("div", { class: "track" });
  cards.forEach((c) => track.appendChild(h("div", { class: "slide" }, c)));
  viewport.appendChild(track);
  root.appendChild(viewport);
  let index = 0;
  const prev = h("button", { class: "arrow-btn", "aria-label": "Previous workflow" });
  prev.innerHTML = icon("arrowL", 18);
  const next = h("button", { class: "arrow-btn", "aria-label": "Next workflow" });
  next.innerHTML = icon("arrow", 18);
  const dots: HTMLElement[] = [];
  cards.forEach((_, i) => {
    const d = h("button", { class: "dot-btn", "aria-label": `Show workflow ${i + 1}`, "aria-current": i === 0 ? "true" : "false" }, h("i"));
    d.addEventListener("click", () => goTo(i));
    dots.push(d);
    void d;
  });
  const dotsRow = h("div", { class: "dots" });
  for (const d of dots) dotsRow.appendChild(d);
  const ctrlRow = h("div", { class: "ctrl-row" }, prev, dotsRow, next);
  root.appendChild(ctrlRow);
  prev.addEventListener("click", () => goTo(index - 1));
  next.addEventListener("click", () => goTo(index + 1));

  function goTo(i: number): void {
    index = (i + cards.length) % cards.length;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.style.transitionDuration = reduce ? "0s" : "";
    track.style.transform = `translateX(-${index * 100}%)`;
    dots.forEach((d, di) => d.setAttribute("aria-current", di === index ? "true" : "false"));
  }

  // swipe
  let startX = 0;
  viewport.addEventListener("touchstart", (ev: TouchEvent) => { startX = ev.touches[0].clientX; }, { passive: true });
  viewport.addEventListener("touchend", (ev: TouchEvent) => {
    const dx = ev.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) goTo(index + (dx < 0 ? 1 : -1));
  }, { passive: true });
  goTo(0);
  return { root };
}

// ---------- dialogs ----------

function fieldErr(dlg: HTMLElement, msg: string): void {
  let box = dlg.querySelector<HTMLElement>(".inline-err");
  if (!box) {
    box = h("div", { class: "inline-err", role: "alert" });
    dlg.appendChild(box);
  }
  box.textContent = msg;
  box.hidden = false;
}

function openNewBranch(ctx: PageCtx, slug: string): void {
  const nameInput = h("input", { class: "control", "aria-label": "Branch name", placeholder: "feature/checkout-redesign" }) as HTMLInputElement;
  const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "New branch" });
  dlg.appendChild(h("h2", {}, "New branch"));
  dlg.appendChild(h("p", { class: "sub" }, "A working copy of main, with its own keys and translations."));
  dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Branch name"), nameInput));
  const cancel = h("button", { class: "btn btn-outline" }, "Cancel");
  const create = h("button", { class: "btn btn-primary" }, "Create branch");
  dlg.appendChild(h("div", { class: "actions-row" }, cancel, create));
  const dialog = new Dialog(dlg, document.activeElement as HTMLElement);
  dialog.open();
  cancel.addEventListener("click", () => dialog.close(false));
  create.addEventListener("click", async () => {
    create.disabled = true;
    ctx.fb.setStatus("Creating branch.");
    try {
      const b = await api(`/api/projects/${slug}/branches`, { method: "POST", json: { name: nameInput.value.trim() } });
      ctx.fb.setStatus(`Created branch ${(b as any).name}.`);
      dialog.close(true);
      history.replaceState(null, "", `/projects/${slug}?branch=${encodeURIComponent((b as any).name)}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (e: any) {
      create.disabled = false;
      ctx.fb.clearStatus();
      const msg = e.fields && e.fields.name ? e.fields.name : e.message;
      fieldErr(dlg, msg);
      ctx.fb.setProblem(msg);
      nameInput.focus();
    }
  });
}

function openUploadDialog(ctx: PageCtx, slug: string, detail: ProjectDetail): void {
  const openBranches = detail.branches.filter((b) => b.state === "open" && !b.is_main).map((b) => b.name);
  const options = openBranches.length ? openBranches : ["main"];
  const select = h("select", { class: "control", "aria-label": "Branch" }) as HTMLSelectElement;
  for (const o of options) select.appendChild(h("option", { value: o }, o));
  const file = h("input", { class: "control", type: "file", "aria-label": "Source file", accept: ".json,application/json" }) as HTMLInputElement;
  const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Upload source file" });
  dlg.appendChild(h("h2", {}, "Upload source file"));
  dlg.appendChild(h("p", { class: "sub" }, "The working copy is normalised; the original is stored as submitted."));
  dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Branch"), select));
  dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Source file"), file));
  const cancel = h("button", { class: "btn btn-outline" }, "Cancel");
  const upload = h("button", { class: "btn btn-primary" }, "Upload");
  dlg.appendChild(h("div", { class: "actions-row" }, cancel, upload));
  const dialog = new Dialog(dlg, document.activeElement as HTMLElement);
  dialog.open();
  cancel.addEventListener("click", () => dialog.close(false));
  upload.addEventListener("click", async () => {
    if (!file.files || !file.files[0]) { fieldErr(dlg, "Choose a JSON source file."); return; }
    upload.disabled = true;
    ctx.fb.setStatus("Uploading source file.");
    const fd = new FormData();
    fd.append("file", file.files[0]);
    try {
      const res = await api<any>(`/api/projects/${slug}/branches/${encodeURIComponent(select.value)}/source-files`, { method: "POST", body: fd });
      ctx.fb.setStatus(`Stored ${res.filename} as submitted: ${res.keys_added} keys added, ${res.keys_changed} changed, ${res.keys_unchanged} unchanged.`);
      dialog.close(true);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (e: any) {
      upload.disabled = false;
      ctx.fb.clearStatus();
      const msg = e.fields && e.fields.file ? e.fields.file : e.message;
      fieldErr(dlg, msg);
      ctx.fb.setProblem(msg);
    }
  });
}

function openDraftDialog(ctx: PageCtx, slug: string, detail: ProjectDetail): void {
  const branches = detail.branches.filter((b) => b.state === "open").map((b) => b.name);
  const bSelect = h("select", { class: "control", "aria-label": "Branch" }) as HTMLSelectElement;
  for (const o of branches.length ? branches : ["main"]) bSelect.appendChild(h("option", { value: o }, o));
  const lSelect = h("select", { class: "control", "aria-label": "Language" }) as HTMLSelectElement;
  for (const o of detail.target_languages) lSelect.appendChild(h("option", { value: o }, o));
  const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Draft with AI" });
  dlg.appendChild(h("h2", {}, "Draft with AI"));
  dlg.appendChild(h("p", { class: "sub" }, "Exact translation-memory matches are reused first; the rest go to the routed engine."));
  dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Branch"), bSelect));
  dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Language"), lSelect));
  const cancel = h("button", { class: "btn btn-outline" }, "Cancel");
  const draft = h("button", { class: "btn btn-primary" }, "Draft");
  dlg.appendChild(h("div", { class: "actions-row" }, cancel, draft));
  const dialog = new Dialog(dlg, document.activeElement as HTMLElement);
  dialog.open();
  cancel.addEventListener("click", () => dialog.close(false));
  draft.addEventListener("click", async () => {
    draft.disabled = true;
    const lang = lSelect.value;
    ctx.fb.setStatus(`Drafting ${lang} segments.`);
    try {
      const res = await api<{ tm_reused: number; ai_drafted: number }>(`/api/projects/${slug}/branches/${encodeURIComponent(bSelect.value)}/drafts`, { method: "POST", json: { language: lang } });
      ctx.fb.setStatus(`Drafted ${res.ai_drafted} segments with AI and reused ${res.tm_reused} exact matches.`);
      dialog.close(true);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (e: any) {
      draft.disabled = false;
      ctx.fb.clearStatus();
      const msg = e.message;
      fieldErr(dlg, msg);
      ctx.fb.setProblem(msg);
    }
  });
}

function openAssignDialog(ctx: PageCtx, slug: string, detail: ProjectDetail): void {
  const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Assign review" });
  dlg.appendChild(h("h2", {}, "Assign review"));
  dlg.appendChild(h("p", { class: "sub" }, "Give a reviewer every unassigned segment that needs review."));
  const rSelect = h("select", { class: "control", "aria-label": "Reviewer" }) as HTMLSelectElement;
  const bSelect = h("select", { class: "control", "aria-label": "Branch" }) as HTMLSelectElement;
  const lSelect = h("select", { class: "control", "aria-label": "Language" }) as HTMLSelectElement;
  const loadReviewers = async () => {
    clearEl(rSelect);
    try {
      const res = await api<{ reviewers: any[] }>(`/api/projects/${slug}/reviewers`);
      if (res.reviewers.length === 0) rSelect.appendChild(h("option", { value: "" }, "No reviewers invited yet"));
      for (const r of res.reviewers) rSelect.appendChild(h("option", { value: r.id }, `${r.name}`));
    } catch {
      rSelect.appendChild(h("option", { value: "" }, "No reviewers invited yet"));
    }
  };
  void loadReviewers();
  for (const b of detail.branches.filter((x) => x.state !== "merged" && x.state !== "abandoned")) bSelect.appendChild(h("option", { value: b.name }, b.name));
  for (const l of detail.target_languages) lSelect.appendChild(h("option", { value: l }, l));
  dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Reviewer"), rSelect));
  dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Branch"), bSelect));
  dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Language"), lSelect));
  const cancel = h("button", { class: "btn btn-outline" }, "Cancel");
  const assign = h("button", { class: "btn btn-primary" }, "Assign");
  dlg.appendChild(h("div", { class: "actions-row" }, cancel, assign));
  const dialog = new Dialog(dlg, document.activeElement as HTMLElement);
  dialog.open();
  void loadReviewers();
  cancel.addEventListener("click", () => dialog.close(false));
  assign.addEventListener("click", async () => {
    assign.disabled = true;
    const lang = lSelect.value;
    ctx.fb.setStatus("Assigning segments.");
    try {
      const reviewerId = rSelect.value;
      const res = await api<any>(`/api/projects/${slug}/assignments`, { method: "POST", json: { reviewer_id: reviewerId, branch: bSelect.value, language: lang } });
      const reviewerName = rSelect.options[rSelect.selectedIndex]?.textContent || "reviewer";
      const exp = new Date(res.expires_at);
      const hh = String(exp.getHours()).padStart(2, "0");
      const mm = String(exp.getMinutes()).padStart(2, "0");
      ctx.fb.setStatus(`Assigned ${res.segment_ids.length} segments to ${reviewerName} until ${hh}:${mm}.`);
      dialog.close(true);
    } catch (e: any) {
      assign.disabled = false;
      ctx.fb.clearStatus();
      fieldErr(dlg, e.message);
      ctx.fb.setProblem(e.message);
    }
  });
}

function openPublishDialog(ctx: PageCtx, slug: string, detail: ProjectDetail): void {
  const dlg = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Publish" });
  dlg.appendChild(h("h2", {}, "Publish"));
  dlg.appendChild(h("p", { class: "sub" }, "Approved strings become a bundle per language and a pull request on the repository."));
  const bSelect = h("select", { class: "control", "aria-label": "Branch" }) as HTMLSelectElement;
  const choices = detail.branches.filter((b) => b.state === "open" || b.state === "in_review").map((b) => b.name);
  for (const o of ["main", ...choices]) bSelect.appendChild(h("option", { value: o }, o));
  dlg.appendChild(h("label", { class: "field" }, h("span", { class: "label" }, "Branch"), bSelect));
  const cancel = h("button", { class: "btn btn-outline" }, "Cancel");
  const publish = h("button", { class: "btn btn-primary" }, "Publish to repository");
  dlg.appendChild(h("div", { class: "actions-row" }, cancel, publish));
  const dialog = new Dialog(dlg, document.activeElement as HTMLElement);
  dialog.open();
  cancel.addEventListener("click", () => dialog.close(false));
  publish.addEventListener("click", async () => {
    publish.disabled = true;
    ctx.fb.setStatus("Publish queued.");
    const key = `pub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const res = await api<Publish>(`/api/projects/${slug}/publishes`, { method: "POST", headers: { "Idempotency-Key": key }, json: { branch: bSelect.value } });
      dialog.close(true);
      await pollPublish(ctx, slug, res);
    } catch (e: any) {
      publish.disabled = false;
      ctx.fb.clearStatus();
      fieldErr(dlg, e.message);
      ctx.fb.setProblem(e.message);
    }
  });
}

export async function pollPublish(ctx: PageCtx, slug: string, p: Publish): Promise<void> {
  const region = document.querySelector<HTMLElement>('[role="region"][aria-label="Publish status"]');
  if (!region) return;
  clearEl(region);
  const box = h("div", { class: "banner", style: "margin-top:20px" });
  const label = h("div", { class: "label" }, "Publish");
  const text = h("p", {}, statusWord(p.state));
  box.appendChild(label);
  box.appendChild(text);
  region.appendChild(box);
  let current = p;
  while (current.state === "queued" || current.state === "awaiting_host_confirmation") {
    if (current.state === "awaiting_host_confirmation") ctx.fb.setStatus("Waiting for the repository host to confirm the pull request.");
    await new Promise((r) => setTimeout(r, 2000));
    try {
      current = await api<Publish>(`/api/projects/${slug}/publishes/${p.id}`);
    } catch { return; }
    if (current.state === "published") {
      text.textContent = `Published as pull request #${current.pull_request?.number}.`;
    } else if (current.state === "failed") {
      text.textContent = statusWord(current.state);
    } else {
      text.textContent = statusWord(current.state);
    }
    if (current.state === "published") {
      ctx.fb.setStatus(`Published as pull request #${current.pull_request?.number}.`);
    } else if (current.state === "failed") {
      ctx.fb.setProblem(failCopy(current.failure_reason));
    }
  }
}

function failCopy(reason: string | null): string {
  if (reason === "git_host_unavailable") return "Publish failed: the repository host isn't answering.";
  if (reason === "pull_request_rejected") return "Publish failed: the repository host rejected the pull request.";
  if (reason === "not_confirmed") return "Publish failed: the repository host didn't confirm the pull request.";
  return "Publish failed.";
}
