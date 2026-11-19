// The pen editor: three code panes, the preview stage, the console band,
// separators, layouts, settings and share dialogs, drafts and conflicts.
import { el, button, link, navigate, status } from "../lib/dom.js";
import { Api, type ClientConfig, type Pen, type ShelfLibrary, type User, formatTimeOnly } from "../lib/api.js";
import { buildHeader, meSync } from "../lib/header.js";
import { PreviewStage, type PreviewMessage } from "../lib/preview.js";
import { unverifiedCopy, buildVerifyBanner, type VerifyBanner } from "../lib/verify.js";

type PaneName = "html" | "css" | "js";

interface Working {
  html: string;
  css: string;
  js: string;
  libraries: string[];
}

export async function editorPage(root: HTMLElement, params: URLSearchParams): Promise<void> {
  const penId = params.get("pen") ?? "";
  root.innerHTML = "";
  buildHeader(root);

  const [config, pen] = await Promise.all([
    (await import("../lib/api.js")).getConfig(),
    Api.get<Pen>(`/api/pens/${penId}`).catch(() => null),
  ]);
  if (!pen) {
    await (await import("./notfound.js")).notFoundPage(root, params, `/pen/${penId}`);
    return;
  }

  const user = meSync();
  const isOwner = user !== null && pen.owner === user.handle;
  const banner: VerifyBanner | null = user && !user.verified ? buildVerifyBanner(user) : null;

  const page = el("div", { class: "editor-root" });

  // --- toolbar ---
  const toolbar = el("div", { class: "editor-toolbar" });
  const titleInput = el("input", { type: "text", value: pen.title, class: "titlebox" });
  titleInput.setAttribute("aria-label", "Pen title");
  const versionLabel = el("span", { class: "version-label", role: "status", "aria-label": "Version label" });
  versionLabel.textContent = pen.head === 0 ? "Not saved yet" : `Version ${pen.head}`;
  toolbar.appendChild(titleInput);
  toolbar.appendChild(versionLabel);

  if (pen.forked_from && "pen_id" in pen.forked_from) {
    const credit = link(`/pen/${pen.forked_from.pen_id}`, `Forked from ${pen.forked_from.title} by ${pen.forked_from.owner}`);
    credit.className = "fork-credit";
    toolbar.appendChild(credit);
  } else if (pen.forked_from && "removed" in pen.forked_from) {
    toolbar.appendChild(el("span", { class: "fork-credit", text: "Forked from a removed pen" }));
  } else if (pen.forked_from && "hidden" in pen.forked_from) {
    toolbar.appendChild(el("span", { class: "fork-credit", text: "Forked from a private pen" }));
  }

  const saveStatus = status("Save status");
  const likesStatus = status("Likes");
  const forksStatus = status("Forks");
  const exportStatus = status("Export status");
  const likeBtn = isOwner || user === null ? null : button(`Like`, { "aria-pressed": String(pen.liked) });
  const forkBtn = isOwner || user === null ? null : button(`Fork`, {});
  if (likeBtn) toolbar.appendChild(likeBtn);
  if (likeBtn) toolbar.appendChild(likesStatus);
  if (forkBtn) toolbar.appendChild(forkBtn);
  if (forkBtn) toolbar.appendChild(forksStatus);

  const saveBtn = button("Save", { class: "primary" });
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(saveStatus);
  const shareBtn = button("Share", {});
  toolbar.appendChild(shareBtn);
  toolbar.appendChild(link(`/pen/${penId}/history`, "History"));
  const exportBtn = button("Export", {});
  toolbar.appendChild(exportBtn);
  toolbar.appendChild(exportStatus);
  const settingsBtn = button("Pen settings", {});
  toolbar.appendChild(settingsBtn);

  if (likeBtn) {
    const setLikes = (n: number) => {
      likesStatus.textContent = n === 1 ? "1 like" : `${n} likes`;
    };
    setLikes(pen.likes);
    likeBtn.addEventListener("click", async () => {
      const pressed = likeBtn.getAttribute("aria-pressed") === "true";
      try {
        const res = pressed
          ? await Api.del<{ liked: boolean; likes: number }>(`/api/pens/${penId}/like`)
          : await Api.put<{ liked: boolean; likes: number }>(`/api/pens/${penId}/like`);
        likeBtn.setAttribute("aria-pressed", String(res.liked));
        setLikes(res.likes);
      } catch (err) {
        if ((err as { error: string }).error === "unverified") {
          likesStatus.textContent = unverifiedCopy(user);
        }
      }
    });
  }
  if (forkBtn) {
    forksStatus.textContent = pen.forks === 1 ? "1 fork" : `${pen.forks} forks`;
    const forkKey = randomKey();
    let forkPending = false;
    forkBtn.addEventListener("click", async () => {
      if (forkPending) return;
      forkPending = true;
      forkBtn.disabled = true;
      try {
        const fork = await Api.post<Pen>(`/api/pens/${penId}/fork`, undefined, forkKey);
        navigate(`/pen/${fork.id}`);
      } catch (err) {
        const e = err as { error: string; message: string };
        if (e.error === "unverified") forksStatus.textContent = unverifiedCopy(user);
        forkPending = false;
        forkBtn.disabled = false;
      }
    });
  }

  page.appendChild(toolbar);
  if (banner) page.appendChild(banner.node);

  // --- conflicts and drafts live above the panes ---
  const notices = el("div", {});
  page.appendChild(notices);

  // --- body: stage + panes ---
  const body = el("div", { class: "editor-body layout-side" });
  const stageCol = el("div", { class: "editor-stage-col" });
  const stage = el("div", { class: "stage", role: "region", "aria-label": "Preview" });
  const stageInner = el("div", { class: "stage-inner" });
  stage.appendChild(stageInner);
  stageCol.appendChild(stage);
  const previewStatus = status("Preview status");
  stageCol.appendChild(previewStatus);

  const preview = new PreviewStage(stageInner);
  preview.onReady(() => {
    stage.setAttribute("data-render-seq", String(preview.renderSeq));
    stage.setAttribute("data-preview-title", "");
    stage.setAttribute("data-preview-text", "");
    const frame = stageInner.querySelector("iframe");
    try {
      const docTitle = (frame as HTMLIFrameElement).contentDocument?.title ?? "";
      stage.setAttribute("data-preview-title", docTitle);
    } catch {
      // sandboxed; the ready message carries the title instead
    }
    previewStatus.textContent = "Preview updated";
  });

  const sepStage = el("div", { class: "sep", role: "separator", tabindex: "0" });
  sepStage.setAttribute("aria-label", "Resize preview and code");
  sepStage.setAttribute("aria-orientation", "vertical");
  sepStage.setAttribute("aria-valuemin", "15");
  sepStage.setAttribute("aria-valuemax", "85");
  sepStage.setAttribute("aria-valuenow", "47");

  const panesCol = el("div", { class: "editor-panes-col pane-col" });

  // --- code panes ---
  const working: Working = {
    html: pen.version?.files.html ?? "",
    css: pen.version?.files.css ?? "",
    js: pen.version?.files.js ?? "",
    libraries: pen.version?.libraries ?? [],
  };
  let loadedVersion = pen.head;
  let baseVersion = pen.head;
  let dirty = false;

  const panes: Record<PaneName, HTMLTextAreaElement> = {} as Record<PaneName, HTMLTextAreaElement>;
  const paneSections: Record<PaneName, HTMLElement> = {} as Record<PaneName, HTMLElement>;
  for (const name of ["html", "css", "js"] as PaneName[]) {
    const section = el("section", { class: "pane-section" });
    section.appendChild(el("h3", { text: name.toUpperCase() }));
    const ta = el("textarea", { class: "code", spellcheck: "false" });
    ta.setAttribute("aria-label", `${name.toUpperCase()} code`);
    ta.value = working[name];
    panes[name] = ta;
    paneSections[name] = section;
    section.appendChild(ta);
    panesCol.appendChild(section);
    if (name !== "js") {
      const sep = el("div", { class: "sep", role: "separator", tabindex: "0" });
      const label = name === "html" ? "Resize HTML and CSS" : "Resize CSS and JS";
      sep.setAttribute("aria-label", label);
      sep.setAttribute("aria-orientation", "horizontal");
      sep.setAttribute("aria-valuemin", "15");
      sep.setAttribute("aria-valuemax", "85");
      sep.setAttribute("aria-valuenow", "50");
      sep.dataset.sep = name === "html" ? "html-css" : "css-js";
      panesCol.appendChild(sep);
      sep.addEventListener("keydown", (e) => sepKeys(e, sep, (v) => setPaneShare(sep, v)));
    }
    ta.addEventListener("input", () => {
      working[name] = ta.value;
      dirty = true;
      schedulePreview();
      scheduleDraft();
    });
    ta.addEventListener("keydown", (e) => paneKeys(e, ta, name));
  }

  // --- layout radios ---
  const layoutGroup = el("div", { role: "radiogroup", "aria-label": "Layout" });
  const layouts = ["side", "stacked", "preview-first"] as const;
  const layoutLabels: Record<string, string> = { side: "Side by side", stacked: "Stacked", "preview-first": "Preview first" };
  let layout = localStorage.getItem(`layout:${penId}`) ?? "side";
  const layoutRadios: Record<string, HTMLInputElement> = {};
  for (const name of layouts) {
    const label = el("label", { class: "radio" });
    const input = el("input", { type: "radio", name: "layout" });
    input.value = name;
    input.setAttribute("role", "radio");
    input.setAttribute("aria-label", layoutLabels[name]!);
    if (name === layout) input.checked = true;
    layoutRadios[name] = input;
    label.appendChild(input);
    label.appendChild(el("span", { text: layoutLabels[name]! }));
    layoutGroup.appendChild(label);
    input.addEventListener("change", () => setLayout(name));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const idx = layouts.indexOf(name);
        setLayout(layouts[(idx + 1) % layouts.length]!);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const idx = layouts.indexOf(name);
        setLayout(layouts[(idx + layouts.length - 1) % layouts.length]!);
      }
    });
  }
  toolbar.appendChild(layoutGroup);

  // --- console band ---
  const consoleBand = el("div", { class: "console-band" });
  const consoleButtons = el("div", { class: "console-buttons" });
  const consoleToggle = button("Console", { "aria-expanded": "true" });
  const consoleCount = el("span", { class: "console-count", text: "0", "aria-hidden": "true" });
  const consoleLog = el("ul", { class: "console-log", role: "log", "aria-label": "Console" });
  consoleLog.setAttribute("data-count", "0");
  const clearBtn = button("Clear console", {});
  consoleButtons.appendChild(consoleToggle);
  consoleButtons.appendChild(consoleCount);
  consoleButtons.appendChild(clearBtn);
  consoleBand.appendChild(consoleButtons);
  consoleBand.appendChild(consoleLog);
  page.appendChild(body);
  page.appendChild(consoleBand);
  root.appendChild(page);

  let consoleOpen = true;
  let entryCount = 0;
  const setConsoleCount = (n: number) => {
    entryCount = n;
    consoleLog.setAttribute("data-count", String(n));
    consoleCount.textContent = String(n);
  };
  consoleToggle.addEventListener("click", () => {
    consoleOpen = !consoleOpen;
    consoleToggle.setAttribute("aria-expanded", String(consoleOpen));
    consoleLog.setAttribute("hidden", consoleOpen ? "false" : "true");
    if (!consoleOpen) consoleLog.style.display = "none";
    else consoleLog.style.display = "";
  });
  clearBtn.addEventListener("click", () => {
    consoleLog.innerHTML = "";
    setConsoleCount(0);
  });

  preview.onEntry((m) => {
    addConsoleEntry(m);
  });

  const addConsoleEntry = (m: PreviewMessage) => {
    const li = el("li", { class: m.kind, text: `${m.kind} ${m.text}` });
    consoleLog.appendChild(li);
    while (consoleLog.children.length > 500) consoleLog.removeChild(consoleLog.firstChild!);
    setConsoleCount(entryCount + 1);
  };

  // --- preview timing: exactly preview_delay_ms after the last edit ---
  let previewTimer: number | null = null;
  const schedulePreview = () => {
    if (previewTimer !== null) window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => {
      previewTimer = null;
      setConsoleCount(0);
      consoleLog.innerHTML = "";
      void preview.render({ html: working.html, css: working.css, js: working.js }, working.libraries, config);
    }, config.preview_delay_ms);
  };

  // first render of the loaded head
  if (pen.head > 0 && pen.version) {
    void preview.render(
      { html: pen.version.files.html, css: pen.version.files.css, js: pen.version.files.js },
      pen.version.libraries,
      config,
    );
  } else {
    void preview.render({ html: "", css: "", js: "" }, [], config);
  }

  // --- drafts ---
  const draftKey = `draft:${penId}`;
  let draftTimer: number | null = null;
  const scheduleDraft = () => {
    if (draftTimer !== null) window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      draftTimer = null;
      const draft = {
        files: { html: working.html, css: working.css, js: working.js },
        base_version: baseVersion,
        saved_at: new Date().toISOString(),
      };
      localStorage.setItem(draftKey, JSON.stringify(draft));
    }, config.draft_interval_ms);
  };

  const offerDraft = () => {
    const raw = localStorage.getItem(draftKey);
    if (!raw) return;
    let draft: { files: { html: string; css: string; js: string }; base_version: number; saved_at: string };
    try {
      draft = JSON.parse(raw);
    } catch {
      return;
    }
    const region = el("div", { role: "region", "aria-label": "Unsaved draft", class: "panel" });
    region.textContent = `You have unsaved edits from ${formatTimeOnly(draft.saved_at)}.`;
    const restore = button("Restore draft", { class: "primary" });
    const discard = button("Discard draft", {});
    region.appendChild(restore);
    region.appendChild(discard);
    notices.appendChild(region);
    restore.addEventListener("click", () => {
      panes.html.value = draft.files.html;
      panes.css.value = draft.files.css;
      panes.js.value = draft.files.js;
      working.html = draft.files.html;
      working.css = draft.files.css;
      working.js = draft.files.js;
      dirty = true;
      schedulePreview();
      closeDraft(region);
      panes.html.focus();
    });
    discard.addEventListener("click", () => {
      localStorage.removeItem(draftKey);
      closeDraft(region);
      panes.html.focus();
    });
  };

  const closeDraft = (region: HTMLElement) => {
    region.remove();
    localStorage.removeItem(draftKey);
  };

  offerDraft();

  const deleteDraft = () => localStorage.removeItem(draftKey);

  // --- saving ---
  const saveStatusSet = (text: string) => {
    saveStatus.textContent = text;
  };

  const doSave = async (overrideBase?: number) => {
    if (!isOwner) {
      saveStatusSet("You may not change this pen.");
      return;
    }
    saveStatusSet("Saving…");
    try {
      const version = await Api.post<{ number: number }>(
        `/api/pens/${penId}/versions`,
        {
          base_version: overrideBase ?? baseVersion,
          files: { html: working.html, css: working.css, js: working.js },
          libraries: working.libraries,
        },
        randomKey(),
      );
      baseVersion = version.number;
      loadedVersion = version.number;
      dirty = false;
      versionLabel.textContent = `Version ${version.number}`;
      saveStatusSet(`Saved as version ${version.number}`);
      deleteDraft();
    } catch (err) {
      const e = err as { error: string; head?: number; fields?: Record<string, string>; message: string };
      if (e.error === "version_conflict") {
        saveStatusSet("");
        showConflict(e.head ?? baseVersion);
      } else if (e.error === "unverified") {
        saveStatusSet(unverifiedCopy(user));
      } else if (e.error === "storage_unavailable") {
        saveStatusSet("Storage is unreachable, so this version was not saved. Your edits are still here.");
      } else if (e.fields && e.fields["files"]) {
        saveStatusSet(e.fields["files"]!);
      } else if (e.fields) {
        const first = Object.values(e.fields)[0];
        saveStatusSet(first ?? "This version was not saved.");
      } else {
        saveStatusSet(e.message);
      }
    }
  };

  saveBtn.addEventListener("click", () => void doSave());

  const showConflict = (head: number) => {
    const alertNode = el("div", { role: "alert", class: "alert", "aria-label": "Version conflict" });
    const line = el("p", { text: `Version ${head} of this pen was saved somewhere else. Your edits are still here.` });
    const keep = button("Keep mine as next version", { class: "primary" });
    const load = button("Load latest", {});
    alertNode.appendChild(line);
    alertNode.appendChild(keep);
    alertNode.appendChild(load);
    notices.appendChild(alertNode);
    keep.focus();
    const close = () => alertNode.remove();
    keep.addEventListener("click", async () => {
      await doSave(head);
      close();
    });
    load.addEventListener("click", async () => {
      const fresh = await Api.get<Pen>(`/api/pens/${penId}`);
      const v = fresh.version;
      if (v) {
        panes.html.value = v.files.html;
        panes.css.value = v.files.css;
        panes.js.value = v.files.js;
        working.html = v.files.html;
        working.css = v.files.css;
        working.js = v.files.js;
        working.libraries = v.libraries;
        baseVersion = fresh.head;
        loadedVersion = fresh.head;
        dirty = false;
        versionLabel.textContent = `Version ${fresh.head}`;
        saveStatusSet(`Loaded version ${fresh.head}`);
        deleteDraft();
        void preview.render({ html: v.files.html, css: v.files.css, js: v.files.js }, v.libraries, config);
      }
      close();
    });
  };

  // --- title ---
  titleInput.addEventListener("change", async () => {
    if (!isOwner) return;
    try {
      await Api.patch(`/api/pens/${penId}`, { title: titleInput.value });
    } catch (err) {
      const e = err as { fields?: Record<string, string> };
      if (e.fields && e.fields.title) saveStatusSet(e.fields.title);
    }
  });

  // --- export ---
  exportBtn.addEventListener("click", async () => {
    try {
      const res = await fetch(`/api/pens/${penId}/export`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (data?.error === "nothing_to_export") {
          exportStatus.textContent = "Save a version before exporting.";
        } else if (data?.error === "storage_unavailable") {
          exportStatus.textContent = "Storage is unreachable, so the export was not made. Your pen is unchanged.";
        } else {
          exportStatus.textContent = "The export was not made.";
        }
        exportBtn.focus();
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${penId}-v${pen.head}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      exportStatus.textContent = `Exported version ${pen.head}`;
    } catch {
      exportStatus.textContent = "Storage is unreachable, so the export was not made. Your pen is unchanged.";
      exportBtn.focus();
    }
  });

  // --- settings dialog ---
  const settingsStatus = status("Settings status");
  const dialog = el("dialog", { class: "settings-dialog", "aria-label": "Pen settings" });
  const visGroup = el("div", { role: "radiogroup", "aria-label": "Visibility" });
  const visibilities: Array<["private" | "unlisted" | "public", string]> = [
    ["private", "Private"],
    ["unlisted", "Unlisted"],
    ["public", "Public"],
  ];
  let visibility = pen.visibility;
  const visRadios: Record<string, HTMLInputElement> = {};
  for (const [value, label] of visibilities) {
    const lab = el("label", { class: "radio" });
    const input = el("input", { type: "radio", name: "visibility", role: "radio", "aria-label": label });
    input.value = value;
    if (pen.visibility === value) input.checked = true;
    visRadios[value] = input;
    lab.appendChild(input);
    lab.appendChild(el("span", { text: label }));
    visGroup.appendChild(lab);
    input.addEventListener("change", async () => {
      try {
        await Api.patch(`/api/pens/${penId}`, { visibility: value });
        visibility = value;
        settingsStatus.textContent = `This pen is now ${value}.`;
      } catch (err) {
        const e = err as { error: string; fields?: Record<string, string> };
        if (e.error === "unverified") settingsStatus.textContent = unverifiedCopy(user);
        else if (e.fields) settingsStatus.textContent = Object.values(e.fields)[0] ?? "";
        visRadios[visibility]!.checked = true;
      }
    });
  }
  dialog.appendChild(el("h3", { text: "Visibility" }));
  dialog.appendChild(visGroup);

  // library combobox
  dialog.appendChild(el("h3", { text: "Libraries" }));
  const libRow = el("div", { class: "combobox-row" });
  const libLabel = el("label", { text: "Add library" });
  const libInput = el("input", { type: "text", placeholder: "Add library" });
  libInput.setAttribute("aria-label", "Add library");
  libInput.setAttribute("role", "combobox");
  libInput.setAttribute("aria-expanded", "false");
  libInput.setAttribute("aria-controls", "settings-lib-listbox");
  const libBox = el("ul", { class: "listbox", id: "settings-lib-listbox", role: "listbox", hidden: "true" });
  libLabel.appendChild(libInput);
  libRow.appendChild(libLabel);
  libRow.appendChild(libBox);
  dialog.appendChild(libRow);
  const libList = el("div", { class: "tag-list", id: "pen-libraries" });
  dialog.appendChild(libList);

  const shelf = await Api.get<{ libraries: ShelfLibrary[] }>("/api/shelf");
  let libHighlighted = -1;
  let libFiltered: ShelfLibrary[] = [];

  const refreshLibList = () => {
    libList.innerHTML = "";
    for (const lib of working.libraries) {
      const chip = el("span", { class: "tag-chip", text: lib });
      const remove = button(`Remove ${lib}`, {}, () => {
        working.libraries = working.libraries.filter((l) => l !== lib);
        refreshLibList();
        schedulePreview();
      });
      chip.appendChild(remove);
      libList.appendChild(chip);
    }
  };
  refreshLibList();

  const updateLibBox = () => {
    const q = libInput.value.trim().toLowerCase();
    libFiltered = shelf.libraries.filter((l) => (q === "" ? !working.libraries.includes(l.id) : l.id.toLowerCase().includes(q) || l.name.toLowerCase().includes(q)));
    libBox.innerHTML = "";
    libFiltered.forEach((l, i) => {
      const li = el("li", { class: "option", role: "option", "aria-selected": i === libHighlighted ? "true" : "false", text: l.id });
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        addLibrary(l.id);
      });
      libBox.appendChild(li);
    });
    libBox.setAttribute("hidden", libFiltered.length === 0 ? "true" : "false");
    libInput.setAttribute("aria-expanded", libFiltered.length > 0 ? "true" : "false");
  };

  const addLibrary = (id: string) => {
    if (!working.libraries.includes(id)) {
      working.libraries.push(id);
      dirty = true;
    }
    libInput.value = "";
    libBox.setAttribute("hidden", "true");
    refreshLibList();
    schedulePreview();
  };

  libInput.addEventListener("input", () => {
    libHighlighted = -1;
    updateLibBox();
  });
  libInput.addEventListener("keydown", (e) => {
    const hiddenBox = libBox.getAttribute("hidden") === "true";
    if (e.key === "ArrowDown" && !hiddenBox) {
      e.preventDefault();
      libHighlighted = Math.min(libHighlighted + 1, libFiltered.length - 1);
      updateLibBox();
    } else if (e.key === "ArrowUp" && !hiddenBox) {
      e.preventDefault();
      libHighlighted = Math.max(libHighlighted - 1, 0);
      updateLibBox();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = libFiltered[libHighlighted >= 0 ? libHighlighted : 0];
      if (chosen) {
        addLibrary(chosen.id);
      } else {
        const text = libInput.value.trim();
        settingsStatus.textContent = `${text} is not on the shelf. Pick a pinned library from the list.`;
      }
    } else if (e.key === "Escape") {
      libBox.setAttribute("hidden", "true");
    }
  });

  // tags
  dialog.appendChild(el("h3", { text: "Tags" }));
  const tagList = el("div", { class: "tag-list", id: "pen-tags" });
  const tagInput = el("input", { type: "text", placeholder: "Add tag" });
  tagInput.setAttribute("aria-label", "Add tag");
  let tags = [...pen.tags];
  const refreshTags = () => {
    tagList.innerHTML = "";
    for (const tag of tags) {
      const chip = el("span", { class: "tag-chip", text: tag });
      const remove = button(`Remove tag ${tag}`, {}, async () => {
        tags = tags.filter((t) => t !== tag);
        try {
          await Api.patch(`/api/pens/${penId}`, { tags });
          refreshTags();
        } catch (err) {
          const e = err as { fields?: Record<string, string> };
          settingsStatus.textContent = e.fields ? Object.values(e.fields)[0]! : "The tag was not removed.";
        }
      });
      chip.appendChild(remove);
      tagList.appendChild(chip);
    }
  };
  refreshTags();
  dialog.appendChild(tagInput);
  dialog.appendChild(tagList);
  tagInput.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const tag = tagInput.value.trim().toLowerCase();
    if (tag === "") return;
    const next = [...tags, tag];
    try {
      await Api.patch(`/api/pens/${penId}`, { tags: next });
      tags = next;
      refreshTags();
      tagInput.value = "";
    } catch (err) {
      const e2 = err as { fields?: Record<string, string> };
      settingsStatus.textContent = e2.fields ? Object.values(e2.fields)[0]! : "The tag was not added.";
    }
  });

  dialog.appendChild(settingsStatus);

  // delete pen
  const deleteWrap = el("div", { style: "margin-top: 16px" });
  const deleteBtn = button("Delete pen", { class: "danger" });
  deleteWrap.appendChild(deleteBtn);
  dialog.appendChild(deleteWrap);
  const closeBtn = button("Close", { class: "primary" });
  dialog.appendChild(closeBtn);

  const confirmDialog = el("dialog", { "aria-label": "Delete this pen?" });
  confirmDialog.setAttribute("role", "alertdialog");
  confirmDialog.appendChild(el("p", { text: `Delete "${pen.title}" and all its versions? Its forks stay, but they will no longer link here.` }));
  const confirmDelete = button("Delete", { class: "danger" });
  const confirmCancel = button("Cancel", {});
  confirmDialog.appendChild(confirmDelete);
  confirmDialog.appendChild(confirmCancel);

  deleteBtn.addEventListener("click", () => {
    confirmDialog.showModal();
    confirmCancel.focus();
  });
  confirmDialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      confirmDialog.close();
      deleteBtn.focus();
    }
  });
  confirmCancel.addEventListener("click", () => {
    confirmDialog.close();
    deleteBtn.focus();
  });
  confirmDelete.addEventListener("click", async () => {
    try {
      await Api.del(`/api/pens/${penId}`);
      confirmDialog.close();
      const dash = await (await import("./dashboard.js")).dashboardPage;
      // announce on the dashboard
      navigate("/dashboard");
      window.setTimeout(() => {
        const s = document.querySelector('[aria-label="Dashboard status"]');
        if (s) s.textContent = `Deleted "${pen.title}"`;
      }, 300);
    } catch (err) {
      const e = err as { error: string };
      settingsStatus.textContent = e.error === "storage_unavailable" ? "Storage is unreachable, so the pen was not deleted." : "The pen was not deleted.";
      confirmDialog.close();
      dialog.showModal();
    }
    void confirmDialog;
  });

  settingsBtn.addEventListener("click", () => {
    dialog.showModal();
    const checked = visRadios[visibility];
    (checked as HTMLInputElement | undefined)?.focus();
  });
  closeBtn.addEventListener("click", () => {
    dialog.close();
    settingsBtn.focus();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dialog.close();
      settingsBtn.focus();
    }
  });
  // focus wrap inside dialogs
  wrapDialog(dialog);
  wrapDialog(confirmDialog);

  page.appendChild(dialog);
  page.appendChild(confirmDialog);

  // --- share dialog ---
  const shareDialog = el("dialog", { "aria-label": "Share" });
  const shareStatus = status("Share status");
  const tabGroup = el("div", { role: "radiogroup", "aria-label": "Starting tab" });
  const tabs: Array<["html" | "css" | "js" | "result", string]> = [
    ["html", "HTML"],
    ["css", "CSS"],
    ["js", "JS"],
    ["result", "Result"],
  ];
  let startTab: "html" | "css" | "js" | "result" = "result";
  const tabRadios: Record<string, HTMLInputElement> = {};
  const linkField = el("input", { type: "text", readonly: "true" });
  linkField.setAttribute("aria-label", "Embed link");
  const codeField = el("textarea", { readonly: "true", rows: "3" });
  codeField.setAttribute("aria-label", "Embed code");
  const updateShare = () => {
    const url = `${location.origin}/embed/${penId}?tab=${startTab}`;
    linkField.value = url;
    codeField.value = `<iframe src="${url}" title="${pen.title} on Ashlar" width="100%" height="400"></iframe>`;
  };
  updateShare();
  for (const [value, label] of tabs) {
    const lab = el("label", { class: "radio" });
    const input = el("input", { type: "radio", name: "starttab", role: "radio", "aria-label": label });
    input.value = value;
    if (value === startTab) input.checked = true;
    tabRadios[value] = input;
    lab.appendChild(input);
    lab.appendChild(el("span", { text: label }));
    tabGroup.appendChild(lab);
    input.addEventListener("change", () => {
      startTab = value;
      updateShare();
    });
    input.addEventListener("keydown", (e) => {
      const idx = tabs.findIndex((t) => t[0] === value);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = tabs[(idx + 1) % tabs.length]!;
        tabRadios[next[0]]!.checked = true;
        startTab = next[0];
        updateShare();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = tabs[(idx + tabs.length - 1) % tabs.length]!;
        tabRadios[prev[0]]!.checked = true;
        startTab = prev[0];
        updateShare();
      }
    });
  }
  const copyBtn = button("Copy link", {});
  const shareClose = button("Close", { class: "primary" });
  shareDialog.appendChild(el("h3", { text: "Starting tab" }));
  shareDialog.appendChild(tabGroup);
  if (visibility === "private") {
    const warn = el("p", { text: "This pen is private, so the embed shows a not-found page. Make it unlisted or public to embed it." });
    shareDialog.appendChild(warn);
  }
  shareDialog.appendChild(el("h3", { text: "Embed link" }));
  shareDialog.appendChild(linkField);
  shareDialog.appendChild(codeField);
  shareDialog.appendChild(copyBtn);
  shareDialog.appendChild(shareClose);
  shareDialog.appendChild(shareStatus);
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(linkField.value);
      shareStatus.textContent = "Link copied";
    } catch {
      linkField.select();
      document.execCommand("copy");
      shareStatus.textContent = "Link copied";
    }
  });
  shareBtn.addEventListener("click", () => {
    updateShare();
    shareDialog.showModal();
    (tabRadios[startTab] as HTMLInputElement | undefined)?.focus();
  });
  shareClose.addEventListener("click", () => {
    shareDialog.close();
    shareBtn.focus();
  });
  shareDialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      shareDialog.close();
      shareBtn.focus();
    }
  });
  wrapDialog(shareDialog);
  page.appendChild(shareDialog);

  // --- Ctrl+S anywhere outside the iframe ---
  page.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void doSave();
    }
  });

  // --- narrow band tabs ---
  buildNarrowTabs();

  function buildNarrowTabs(): void {
    const tablist = el("div", { class: "panes-tabs", role: "tablist", "aria-label": "Panes" });
    const defs: Array<[string, string]> = [
      ["html", "HTML"],
      ["css", "CSS"],
      ["js", "JS"],
      ["result", "Result"],
      ["console", "Console"],
    ];
    let selected = "html";
    const tabButtons: Record<string, HTMLButtonElement> = {};
    for (const [id, label] of defs) {
      const tab = button(label, { role: "tab", "aria-selected": id === selected ? "true" : "false", tabindex: id === selected ? "0" : "-1" });
      tab.setAttribute("aria-controls", `panel-${id}`);
      tabButtons[id] = tab;
      tablist.appendChild(tab);
      tab.addEventListener("click", () => {
        select(id);
      });
      tab.addEventListener("keydown", (e) => {
        const idx = defs.findIndex((d) => d[0] === id);
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const nextId = defs[(idx + (e.key === "ArrowRight" ? 1 : defs.length - 1)) % defs.length]![0];
          tabButtons[nextId]!.focus();
        } else if (e.key === "Home") {
          e.preventDefault();
          tabButtons[defs[0]![0]]!.focus();
        } else if (e.key === "End") {
          e.preventDefault();
          tabButtons[defs[4]![0]]!.focus();
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select(nextFocused(defs, idx));
        }
      });
    }
    const select = (id: string) => {
      selected = id;
      for (const [def] of defs) {
        const btn = tabButtons[def]!;
        btn.setAttribute("aria-selected", def === id ? "true" : "false");
        btn.setAttribute("tabindex", def === id ? "0" : "-1");
      }
      paneSections.html.classList.toggle("hidden-panel", id !== "html");
      paneSections.css.classList.toggle("hidden-panel", id !== "css");
      paneSections.js.classList.toggle("hidden-panel", id !== "js");
      stageCol.classList.toggle("hidden-panel", id !== "result");
      consoleBand.classList.toggle("hidden-panel", id !== "console");
    };
    body.insertBefore(tablist, body.firstChild);
    select("html");
  }

  function nextFocused(defs: Array<[string, string]>, _idx: number): string {
    return document.activeElement instanceof HTMLButtonElement
      ? defs.find((d) => d[1] === document.activeElement!.textContent)?.[0] ?? "html"
      : "html";
  }

  // --- pane keyboard: Tab indent, Shift+Tab outdent, Escape arms leave ---
  let armed = false;
  function paneKeys(e: KeyboardEvent, ta: HTMLTextAreaElement, name: PaneName): void {
    void name;
    if (e.key === "Tab" && !armed) {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const value = ta.value;
      if (start === end) {
        ta.setRangeText("  ", start, end, "end");
      } else {
        const lineStart = value.lastIndexOf("\n", start - 1) + 1;
        const block = value.slice(lineStart, end);
        const lines = block.split("\n");
        const indented = lines.map((l) => "  " + l).join("\n");
        ta.setRangeText(indented, lineStart, end, "preserve");
      }
      working[name] = ta.value;
      dirty = true;
      schedulePreview();
      scheduleDraft();
    } else if (e.key === "Tab" && e.shiftKey && armed) {
      // handled by leaving
    } else if (armed && (e.key === "Tab" || e.key === "Shift+Tab")) {
      // leave
      armed = false;
      return;
    } else if (armed) {
      armed = false;
    }
    if (e.key === "Escape") {
      armed = true;
      e.preventDefault();
      return;
    }
    if (armed && e.key === "Tab") {
      // next control
      armed = false;
    }
  }

  // --- separators: keys and drag ---
  sepStage.addEventListener("keydown", (e) => {
    const now = Number(sepStage.getAttribute("aria-valuenow"));
    let next = now;
    if (e.key === "Left" || e.key === "Up") next = now - 5;
    else if (e.key === "Right" || e.key === "Down") next = now + 5;
    else if (e.key === "Home") next = 15;
    else if (e.key === "End") next = 85;
    else return;
    e.preventDefault();
    next = Math.max(15, Math.min(85, next));
    sepStage.setAttribute("aria-valuenow", String(next));
    applyStageShare(next);
  });
  makeDraggable(sepStage, (v) => {
    sepStage.setAttribute("aria-valuenow", String(v));
    applyStageShare(v);
  });

  function applyStageShare(v: number): void {
    document.documentElement.style.setProperty("--stage-share", `${v}%`);
    localStorage.setItem(`sep-stage:${penId}`, String(v));
  }
  function setPaneShare(sep: HTMLElement, v: number): void {
    const which = sep.dataset.sep === "html-css" ? "--pane-hc" : "--pane-cj";
    document.documentElement.style.setProperty(which, `${v}%`);
    localStorage.setItem(`${sep.dataset.sep === "html-css" ? "sep-html-css" : "sep-css-js"}:${penId}`, String(v));
  }
  function sepKeys(e: KeyboardEvent, sep: HTMLElement, apply: (v: number) => void): void {
    const now = Number(sep.getAttribute("aria-valuenow"));
    let next = now;
    if (e.key === "Left" || e.key === "Up") next = now - 5;
    else if (e.key === "Right" || e.key === "Down") next = now + 5;
    else if (e.key === "Home") next = 15;
    else if (e.key === "End") next = 85;
    else return;
    e.preventDefault();
    next = Math.max(15, Math.min(85, next));
    sep.setAttribute("aria-valuenow", String(next));
    apply(next);
  }

  function makeDraggable(sep: HTMLElement, apply: (v: number) => void): void {
    let dragging = false;
    const isVertical = () => sep.getAttribute("aria-orientation") === "vertical";
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const parent = sep.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const v = isVertical() ? ((e.clientX - rect.left) / rect.width) * 100 : ((e.clientY - rect.top) / rect.height) * 100;
      const clamped = Math.max(15, Math.min(85, Math.round(v)));
      sep.setAttribute("aria-valuenow", String(clamped));
      apply(clamped);
    };
    sep.addEventListener("pointerdown", (e) => {
      dragging = true;
      sep.setPointerCapture(e.pointerId);
    });
    sep.addEventListener("pointermove", move);
    sep.addEventListener("pointerup", () => {
      dragging = false;
    });
  }

  // --- layout application ---
  function setLayout(name: string): void {
    layout = name;
    for (const l of layouts) {
      layoutRadios[l]!.checked = l === name;
    }
    body.classList.remove("layout-side", "layout-stacked", "layout-preview-first");
    body.classList.add(`layout-${name}`);
    localStorage.setItem(`layout:${penId}`, name);
    // separator orientations follow the arrangement
    const stageVertical = name === "side";
    sepStage.setAttribute("aria-orientation", stageVertical ? "vertical" : "horizontal");
    const panesVertical = name !== "side";
    document.querySelectorAll<HTMLElement>(".editor-panes-col .sep").forEach((sep) => {
      sep.setAttribute("aria-orientation", panesVertical ? "vertical" : "horizontal");
    });
    if (name === "side") {
      body.appendChild(stageCol);
      body.appendChild(sepStage);
      body.appendChild(panesCol);
    } else if (name === "stacked") {
      body.appendChild(panesCol);
      body.appendChild(sepStage);
      body.appendChild(stageCol);
    } else {
      body.appendChild(stageCol);
      body.appendChild(sepStage);
      body.appendChild(panesCol);
    }
  }
  setLayout(layout);
  const savedStage = localStorage.getItem(`sep-stage:${penId}`);
  if (savedStage) {
    sepStage.setAttribute("aria-valuenow", savedStage);
    applyStageShare(Number(savedStage));
  }
  const savedHc = localStorage.getItem(`sep-html-css:${penId}`);
  const savedCj = localStorage.getItem(`sep-css-js:${penId}`);
  if (savedHc) document.documentElement.style.setProperty("--pane-hc", `${savedHc}%`);
  if (savedCj) document.documentElement.style.setProperty("--pane-cj", `${savedCj}%`);

  // --- live feed ---
  const feed = new (await import("../lib/session.js")).LiveFeed([penId], user?.id ?? null);
  feed.setHandlers({
    counts: (id, likes, forks) => {
      void id;
      likesStatus.textContent = likes === 1 ? "1 like" : `${likes} likes`;
      forksStatus.textContent = forks === 1 ? "1 fork" : `${forks} forks`;
    },
    head: () => {
      // the editor never replaces code or base_version because of a head event
    },
    account: (verified) => {
      if (verified && user) {
        user.verified = true;
        banner?.refresh(user);
      }
    },
  });
  feed.start();

  void dirty;
  void loadedVersion;
}

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Tab and Shift+Tab wrap inside a dialog while it is open.
function wrapDialog(dialog: HTMLElement): void {
  dialog.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([type='hidden']), textarea, select, [tabindex]:not([tabindex='-1'])")).filter(
      (n) => n.offsetParent !== null || n === document.activeElement,
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
