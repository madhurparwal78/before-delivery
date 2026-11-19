// The embed page: a compact reader for another site's iframe.
import { el, button, link } from "../lib/dom.js";
import { Api, type Pen } from "../lib/api.js";
import { PreviewStage } from "../lib/preview.js";

export async function embedPage(root: HTMLElement, params: URLSearchParams, path: string): Promise<void> {
  const penId = params.get("pen") ?? "";
  root.innerHTML = "";
  const pen = await Api.get<Pen>(`/api/pens/${penId}`).catch(() => null);
  if (!pen || pen.head === 0) {
    await (await import("./notfound.js")).notFoundPage(root, params, `/embed/${penId}`);
    return;
  }

  const page = el("div", { class: "embed-root" });
  const topbar = el("div", { class: "embed-topbar" });
  const title = el("strong", { text: pen.title });
  const owner = el("span", { class: "row-meta", text: ` by ${pen.owner}` });
  topbar.appendChild(title);
  topbar.appendChild(owner);
  topbar.appendChild(el("span", { class: "spacer", style: "flex:1" }));
  const open = link(`/pen/${penId}`, "Open on Ashlar");
  open.target = "_blank";
  open.rel = "noreferrer";
  topbar.appendChild(open);
  page.appendChild(topbar);

  const tablist = el("div", { class: "embed-tabs", role: "tablist", "aria-label": "Embed" });
  const panels = el("div", { class: "embed-panels" });
  const defs: Array<["html" | "css" | "js" | "result", string]> = [
    ["html", "HTML"],
    ["css", "CSS"],
    ["js", "JS"],
    ["result", "Result"],
  ];
  const urlTab = new URLSearchParams(location.search).get("tab");
  const startTab = defs.some((d) => d[0] === urlTab) ? (urlTab as "html" | "css" | "js" | "result") : "result";
  let selected = startTab;

  const tabButtons: Record<string, HTMLButtonElement> = {};
  const panelNodes: Record<string, HTMLElement> = {};

  const stage = el("div", { class: "stage", role: "region", "aria-label": "Preview" });
  const stageInner = el("div", { class: "stage-inner" });
  stage.appendChild(stageInner);
  const preview = new PreviewStage(stageInner);
  preview.onReady(() => {
    stage.setAttribute("data-render-seq", String(preview.renderSeq));
    stage.setAttribute("data-preview-title", "");
    stage.setAttribute("data-preview-text", "");
  });

  const rerun = button("Rerun", {});
  topbar.appendChild(rerun);
  rerun.addEventListener("click", () => {
    if (pen.version) {
      void preview.render(
        { html: pen.version.files.html, css: pen.version.files.css, js: pen.version.files.js },
        pen.version.libraries,
        await_config(),
      );
    }
  });

  function await_config(): import("../lib/api.js").ClientConfig {
    return cachedConfig;
  }

  const cachedConfig = await (await import("../lib/api.js")).getConfig();

  for (const [id, label] of defs) {
    const tab = button(label, { role: "tab", "aria-selected": id === selected ? "true" : "false", tabindex: id === selected ? "0" : "-1" });
    tab.setAttribute("aria-controls", `embed-panel-${id}`);
    tabButtons[id] = tab;
    tablist.appendChild(tab);
    const panel = el("div", { class: "embed-panel", role: "tabpanel", id: `embed-panel-${id}`, "aria-label": label });
    panel.setAttribute("hidden", "true");
    if (id !== "result") {
      const pre = el("pre", { class: "code-view" });
      pre.textContent = pen.version ? pen.version.files[id] : "";
      panel.appendChild(pre);
    } else {
      panel.appendChild(stage);
    }
    panelNodes[id] = panel;
    panels.appendChild(panel);
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
        tabButtons[defs[3]![0]]!.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const focused = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
        const target = defs.find((d) => d[1] === focused?.textContent)?.[0];
        if (target) select(target);
      }
    });
  }

  const select = (id: string) => {
    selected = id as "html" | "css" | "js" | "result";
    for (const [def] of defs) {
      tabButtons[def]!.setAttribute("aria-selected", def === id ? "true" : "false");
      tabButtons[def]!.setAttribute("tabindex", def === id ? "0" : "-1");
      panelNodes[def]!.setAttribute("hidden", def === id ? "false" : "true");
      if (def !== id) panelNodes[def]!.setAttribute("data-inert", "true");
      else panelNodes[def]!.removeAttribute("data-inert");
    }
  };

  page.appendChild(tablist);
  page.appendChild(panels);
  root.appendChild(page);

  select(startTab);
  if (pen.version) {
    void preview.render(
      { html: pen.version.files.html, css: pen.version.files.css, js: pen.version.files.js },
      pen.version.libraries,
      cachedConfig,
    );
  }
  void selected;
}
