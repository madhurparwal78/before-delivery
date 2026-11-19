import { ApiFailure, get } from "../api";
import { copy } from "../copy";
import { clear, h, layout, setAttr, setText } from "../dom";
import { PageHandle } from "../router";
import { PenStage } from "../scene/twin";
import { openShortcutsDialog, shortcutsBlocked } from "../shell";
import { Defect, penShape, PublicReport } from "../types";

const RECHECK_MS = 15000;

/// The farm manager's read-only report page.
export async function sharePage(container: HTMLElement, token: string): Promise<PageHandle> {
  let report: PublicReport | null = null;
  let selected: string | null = null;
  let destroyed = false;
  let currentTab = "Defects";

  const stageHost = h("div", { class: "stage", "aria-label": "Pen stage", role: "region" });
  const unwrapButton = h("button", { type: "button" }, "Unwrap");
  const sceneStatus = h("div", {
    class: "scene-status num",
    role: "status",
    "aria-label": "Scene status",
  });
  const stageName = h("div", { class: "stage-name" });
  stageHost.appendChild(h("div", { class: "stage-controls" }, [unwrapButton]));
  stageHost.appendChild(stageName);
  stageHost.appendChild(sceneStatus);

  const conditionBody = h("div", { class: "num" });
  const condition = h("section", { class: "panel", "aria-label": "Condition" }, [
    h("div", { class: "panel-title" }, "Condition"),
    conditionBody,
  ]);
  const defectList = h("ul", { class: "list", "aria-label": "Defect list", role: "list" });
  const defects = h("section", { class: "panel", "aria-label": "Defects" }, [
    h("div", { class: "panel-title" }, "Defects"),
    defectList,
  ]);
  const message = h("div", { class: "empty-state hidden" });

  const stage = new PenStage(stageHost, {
    onSelect: (id) => select(id),
    onWallPoint: () => undefined,
    onChange: () => renderSceneStatus(),
    interactive: true,
  });

  const main = h("main", {});
  container.appendChild(main);

  function mountLayout(): void {
    clear(main);
    const mode = layout();
    const stageColumn = h("div", { class: "col-stage" }, stageHost);
    if (mode === "laptop") {
      main.appendChild(
        h("div", { class: "share-layout" }, [
          stageColumn,
          h("div", { class: "share-side" }, [condition, defects]),
        ]),
      );
    } else if (mode === "tablet") {
      main.appendChild(
        h("div", { class: "share-layout" }, [
          stageColumn,
          h("div", { class: "share-lower" }, [condition, defects]),
        ]),
      );
    } else {
      main.appendChild(h("div", { class: "share-layout" }, [stageColumn, phoneTabs()]));
    }
    main.appendChild(message);
  }

  function phoneTabs(): HTMLElement {
    const names = ["Defects", "Condition"];
    const tabs: HTMLButtonElement[] = [];
    const panels = new Map<string, HTMLElement>();
    const tablist = h("div", {
      class: "tablist",
      role: "tablist",
      "aria-label": "Report panels",
    });
    const holder = h("div", {});
    for (const name of names) {
      const panel = h("div", { role: "tabpanel", "aria-label": name, id: `report-${name}` });
      panel.appendChild(name === "Defects" ? defects : condition);
      panels.set(name, panel);
      holder.appendChild(panel);
      const tab = h(
        "button",
        {
          type: "button",
          role: "tab",
          "aria-label": name,
          "aria-controls": `report-${name}`,
          "aria-selected": name === currentTab ? "true" : "false",
          tabindex: name === currentTab ? "0" : "-1",
        },
        name,
      );
      tab.addEventListener("click", () => selectTab(name));
      tabs.push(tab);
      tablist.appendChild(tab);
    }

    function selectTab(name: string): void {
      currentTab = name;
      for (const tab of tabs) {
        const own = tab.textContent ?? "";
        setAttr(tab, "aria-selected", own === name ? "true" : "false");
        setAttr(tab, "tabindex", own === name ? "0" : "-1");
      }
      for (const [key, panel] of panels) panel.hidden = key !== name;
      tabs.find((tab) => tab.textContent === name)?.focus();
    }

    tablist.addEventListener("keydown", (event) => {
      const index = tabs.findIndex((tab) => tab === document.activeElement);
      if (index === -1) return;
      let next = -1;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      if (next === -1) return;
      event.preventDefault();
      event.stopPropagation();
      selectTab(names[next]);
    });

    for (const [key, panel] of panels) panel.hidden = key !== currentTab;
    return h("div", { class: "page" }, [tablist, holder]);
  }

  function renderSceneStatus(): void {
    const view = stage.view();
    const lines = [
      view === "cylinder"
        ? copy.viewCylinder
        : view === "flat"
          ? copy.viewFlat
          : view === "unwrapping"
            ? copy.viewUnwrapping
            : copy.viewWrapping,
      view === "flat" ? copy.cameraFlat : copy.cameraBearing(stage.cameraAzimuth()),
      copy.zoom(stage.zoomLevel()),
      copy.selected(selected),
      copy.focus([]),
      copy.diveClock(null),
    ];
    if (!stage.webgl) lines.push(copy.noWebgl);
    if (sceneStatus.childElementCount !== lines.length) {
      clear(sceneStatus);
      for (const line of lines) sceneStatus.appendChild(h("div", {}, line));
      return;
    }
    const nodes = [...sceneStatus.children] as HTMLElement[];
    lines.forEach((line, index) => setText(nodes[index], line));
    const wrapping = stage.controlTarget() === "flat";
    setText(unwrapButton, wrapping ? "Wrap" : "Unwrap");
    setAttr(unwrapButton, "aria-label", wrapping ? "Wrap" : "Unwrap");
    unwrapButton.hidden = !stage.webgl;
  }

  function liveDefects(): Defect[] {
    return (report?.defects ?? []).filter((defect) => !defect.removed);
  }

  function select(id: string | null): void {
    selected = id;
    stage.setSelected(id);
    if (id) stage.flyTo(id, true);
    renderDefects();
    renderSceneStatus();
  }

  const rows = new Map<string, { root: HTMLElement; button: HTMLButtonElement; text: HTMLElement }>();

  function rowText(defect: Defect): string {
    if (defect.removed) return `${defect.id} Defect removed`;
    if (stage.settledView() === "flat") {
      return `${defect.id} ${defect.type} panel ${defect.cell}`;
    }
    const base = `${defect.id} ${defect.type} ${defect.bearing_deg?.toFixed(1)}\u00b0 ${defect.depth_m?.toFixed(1)} m`;
    return defect.status === "repaired" ? `${base} Repaired` : base;
  }

  /// A check that finds changes updates only the changed rows and lines in
  /// place, and the selected pin stays unless its defect was removed.
  function renderDefects(): void {
    const seen = new Set<string>();
    for (const defect of report?.defects ?? []) {
      seen.add(defect.id);
      let row = rows.get(defect.id);
      if (!row) {
        const text = h("span", {});
        const button = h("button", { type: "button", class: "row-button" }, text);
        button.addEventListener("click", () => select(defect.id));
        const root = h("li", {}, button);
        rows.set(defect.id, { root, button, text });
        defectList.appendChild(root);
        row = { root, button, text };
      }
      setText(row.text, rowText(defect));
      setAttr(
        row.button,
        "aria-label",
        defect.removed ? `${defect.id}, Defect removed` : `${defect.id}, ${defect.type}`,
      );
      setAttr(row.button, "aria-pressed", selected === defect.id ? "true" : "false");
    }
    for (const [id, row] of [...rows]) {
      if (!seen.has(id)) {
        row.root.remove();
        rows.delete(id);
      }
    }
  }

  function renderCondition(): void {
    if (!report) return;
    clear(conditionBody);
    conditionBody.appendChild(
      h(
        "div",
        {},
        copy.gradeLine(report.grade.letter, report.grade.label, report.open_defects),
      ),
    );
    conditionBody.appendChild(
      h(
        "div",
        { class: "num" },
        `${report.open_defects} ${report.open_defects === 1 ? "open defect" : "open defects"}`,
      ),
    );
    if (report.latest_revision) {
      conditionBody.appendChild(
        h(
          "div",
          { class: "num" },
          `Revision ${report.latest_revision.number} \u00b7 ${report.latest_revision.published_at.slice(0, 10)}`,
        ),
      );
    }
    conditionBody.appendChild(
      h(
        "div",
        { class: "num" },
        copy.shareExpiry(report.link.expires_at, report.link.expires_in_s),
      ),
    );
  }

  function showMessage(text: string): void {
    message.classList.remove("hidden");
    setText(message, text);
    clear(defectList);
    rows.clear();
    clear(conditionBody);
    stageHost.classList.add("hidden");
  }

  /// A removed defect's pin hands focus to the next remaining defect in id
  /// order, or the previous one when none follows.
  function focusFallback(removedIds: string[]): void {
    const active = document.activeElement as HTMLElement | null;
    if (!active?.classList.contains("pin")) return;
    const label = active.getAttribute("aria-label") ?? "";
    const id = label.replace("Pin ", "");
    if (!removedIds.includes(id)) return;
    const ids = liveDefects().map((defect) => defect.id).sort();
    const next = ids.find((other) => other > id) ?? [...ids].reverse().find((other) => other < id);
    if (next) stage.pinFor(next)?.focus();
  }

  async function load(initial: boolean): Promise<void> {
    try {
      const payload = (await get(`/api/share/${token}`)) as PublicReport;
      if (destroyed) return;
      const previous = (report?.defects ?? [])
        .filter((defect) => !defect.removed)
        .map((defect) => defect.id);
      report = payload;
      message.classList.add("hidden");
      stageHost.classList.remove("hidden");
      setText(stageName, payload.pen.name);
      stage.setPenLabel(payload.pen.name);
      stage.setPen(
        penShape(payload.pen),
        liveDefects().map((defect) => ({
          id: defect.id,
          bearing_deg: defect.bearing_deg ?? 0,
          depth_m: defect.depth_m ?? 0,
          chart_x_m: defect.chart_x_m ?? 0,
          chart_y_m: defect.chart_y_m ?? 0,
        })),
      );
      if (selected && !liveDefects().some((defect) => defect.id === selected)) {
        selected = null;
        stage.setSelected(null);
      }
      const removed = previous.filter(
        (id) => !liveDefects().some((defect) => defect.id === id),
      );
      renderDefects();
      renderCondition();
      renderSceneStatus();
      if (!initial) focusFallback(removed);
    } catch (failure) {
      if (destroyed) return;
      if (failure instanceof ApiFailure && failure.status === 410) {
        showMessage(copy.shareInactive);
        return;
      }
      if (failure instanceof ApiFailure && failure.status === 404) {
        showMessage(copy.shareMissing);
        return;
      }
      if (initial) showMessage(copy.shareMissing);
    }
  }

  unwrapButton.addEventListener("click", () => {
    if (stage.controlTarget() === "flat") stage.wrap();
    else stage.unwrap();
    renderSceneStatus();
  });

  const keyHandler = (event: KeyboardEvent): void => {
    if (shortcutsBlocked(event.target)) return;
    const onTab = (event.target as HTMLElement | null)?.getAttribute("role") === "tab";
    const flat = stage.controlTarget() === "flat";
    const ids = liveDefects().map((defect) => defect.id);
    switch (event.key) {
      case "ArrowLeft":
        if (onTab) return;
        flat ? stage.panByPanels(-1, 0) : stage.orbit(-15, 0);
        break;
      case "ArrowRight":
        if (onTab) return;
        flat ? stage.panByPanels(1, 0) : stage.orbit(15, 0);
        break;
      case "ArrowUp":
        if (onTab) return;
        flat ? stage.panByPanels(0, 1) : stage.orbit(0, 10);
        break;
      case "ArrowDown":
        if (onTab) return;
        flat ? stage.panByPanels(0, -1) : stage.orbit(0, -10);
        break;
      case "Home":
      case "End":
        return;
      case "+":
      case "=":
        stage.zoomBy(0.25);
        break;
      case "-":
        stage.zoomBy(-0.25);
        break;
      case "u":
      case "U":
        if (!flat) stage.unwrap();
        break;
      case "w":
      case "W":
        if (flat) stage.wrap();
        break;
      case "n":
      case "N": {
        if (!ids.length) return;
        const index = selected ? ids.indexOf(selected) : -1;
        select(ids[(index + 1) % ids.length]);
        break;
      }
      case "p":
      case "P": {
        if (!ids.length) return;
        const index = selected ? ids.indexOf(selected) : 0;
        select(ids[(index - 1 + ids.length) % ids.length]);
        break;
      }
      case "?":
        openShortcutsDialog();
        break;
      default:
        return;
    }
    event.preventDefault();
    renderSceneStatus();
  };
  document.addEventListener("keydown", keyHandler);

  const resizeHandler = (() => {
    let mode = layout();
    return () => {
      if (layout() === mode) return;
      mode = layout();
      mountLayout();
      renderDefects();
    };
  })();
  window.addEventListener("resize", resizeHandler);

  mountLayout();
  renderSceneStatus();
  await load(true);
  const recheck = window.setInterval(() => void load(false), RECHECK_MS);

  return {
    destroy(): void {
      destroyed = true;
      document.removeEventListener("keydown", keyHandler);
      window.removeEventListener("resize", resizeHandler);
      window.clearInterval(recheck);
      stage.destroy();
    },
  };
}
