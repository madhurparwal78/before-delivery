import { ApiFailure, get, post } from "../api";
import { clockText, copy } from "../copy";
import { clear, h, layout, reducedMotion, setAttr, setText } from "../dom";
import { fromOtherDevice, LiveEvent, onLive } from "../live";
import { PageHandle, replaceAddress } from "../router";
import { PenStage } from "../scene/twin";
import { announce, buildFooter, shortcutsBlocked } from "../shell";
import { deviceId, rememberOpenPen } from "../state";
import { CopilotAnswer, Defect, Dive, Pen, penShape, Proposal } from "../types";
import { EditorHandle, openEditor } from "./editor";

interface DefectRow {
  root: HTMLElement;
  button: HTMLButtonElement;
  text: HTMLElement;
  lock: HTMLElement;
}

/// The pen workspace: the live twin, the defect list, the copilot and the
/// editor, with the address holding the settled view and the selection.
export async function workspacePage(
  container: HTMLElement,
  penId: string,
): Promise<PageHandle> {
  let pens: Pen[] = [];
  let pen: Pen | null = null;
  let selected: string | null = null;
  let focusIds: string[] = [];
  let marking = false;
  let editor: EditorHandle | null = null;
  let editorOpener: HTMLElement | null = null;
  let loading = true;
  let diveBase: { elapsed: number; at: number } | null = null;
  let copilotSequence = 0;
  let proposals: Proposal[] = [];
  let destroyed = false;

  const stageHost = h("div", { class: "stage", "aria-label": "Pen stage", role: "region" });
  const unwrapButton = h("button", { type: "button" }, "Unwrap");
  const markButton = h("button", { type: "button", "aria-pressed": "false" }, "Mark defect");
  const sceneStatus = h("div", {
    class: "scene-status num",
    role: "status",
    "aria-label": "Scene status",
  });
  const stageName = h("div", { class: "stage-name" });
  stageHost.appendChild(h("div", { class: "stage-controls" }, [unwrapButton, markButton]));
  stageHost.appendChild(stageName);
  stageHost.appendChild(sceneStatus);

  const penListHost = h("ul", { class: "list", "aria-label": "Pens", role: "list" });
  const penCombo = h("select", { "aria-label": "Pen" });
  const defectList = h("ul", { class: "list", "aria-label": "Defect list", role: "list" });
  const defectEmpty = h("div", { class: "empty-state hidden" }, copy.emptyState);
  const defectPanel = h("section", { class: "panel col-defects", "aria-label": "Defects" }, [
    h("div", { class: "panel-title" }, "Defects"),
    defectEmpty,
    defectList,
  ]);

  const question = h("textarea", { "aria-label": "Ask the copilot", rows: "3" });
  const askButton = h("button", { type: "button" }, "Ask");
  const answerText = h("p", {});
  const copilotActions = h("div", { class: "actions" });
  const copilotStatus = h("div", { role: "status", "aria-label": "Copilot status" });
  const copilotPanel = h("section", { class: "panel col-copilot", "aria-label": "Copilot" }, [
    h("div", { class: "panel-title" }, "Copilot"),
    h("label", { class: "field" }, [h("span", {}, "Ask the copilot"), question]),
    h("div", { class: "actions" }, [askButton]),
    copilotStatus,
    answerText,
    copilotActions,
  ]);

  const stage = new PenStage(stageHost, {
    onSelect: (id) => select(id, true),
    onWallPoint: (point) => openNewEditor(point),
    onChange: () => {
      renderSceneStatus();
      refreshUnwrapButton();
      renderDefects();
      syncAddress();
    },
    interactive: true,
  });

  const rows = new Map<string, DefectRow>();
  const main = h("main", {});
  container.appendChild(main);
  const footer = buildFooter();

  function mountLayout(): void {
    clear(main);
    const mode = layout();
    const stageColumn = h("div", { class: "col-stage" }, stageHost);
    if (mode === "laptop") {
      penListHost.className = "list";
      main.appendChild(
        h("div", { class: "workspace" }, [
          h("section", { class: "panel col-pens" }, penListHost),
          stageColumn,
          copilotPanel,
          defectPanel,
        ]),
      );
    } else if (mode === "tablet") {
      penListHost.className = "pens-strip";
      main.appendChild(
        h("div", { class: "workspace" }, [penListHost, stageColumn,
          h("div", { class: "lower" }, [copilotPanel, defectPanel]),
        ]),
      );
    } else {
      penListHost.className = "list";
      main.appendChild(
        h("div", { class: "workspace" }, [
          h("div", { class: "page" }, h("label", { class: "field" }, [
            h("span", {}, "Pen"),
            penCombo,
          ])),
          stageColumn,
          phoneTabs(),
        ]),
      );
    }
    main.appendChild(footer);
  }

  let currentTab = "Defects";

  function phoneTabs(): HTMLElement {
    const names = ["Defects", "Copilot", "Pens"];
    const tabs: HTMLButtonElement[] = [];
    const panels = new Map<string, HTMLElement>();
    const tablist = h("div", { class: "tablist", role: "tablist", "aria-label": "Pen panels" });
    const holder = h("div", {});
    for (const name of names) {
      const panel = h("div", {
        role: "tabpanel",
        "aria-label": name,
        id: `panel-${name}`,
      });
      if (name === "Defects") panel.appendChild(defectPanel);
      if (name === "Copilot") panel.appendChild(copilotPanel);
      if (name === "Pens") panel.appendChild(penListHost);
      panels.set(name, panel);
      holder.appendChild(panel);
      const tab = h(
        "button",
        {
          type: "button",
          role: "tab",
          "aria-label": name,
          "aria-controls": `panel-${name}`,
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

  // ---------- scene status ----------

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
      copy.focus(focusIds),
      copy.diveClock(diveClockText()),
    ];
    if (marking) lines.push(copy.marking);
    if (loading) lines.push(copy.loading);
    if (!stage.webgl) lines.push(copy.noWebgl);
    if (sceneStatus.childElementCount !== lines.length) {
      clear(sceneStatus);
      for (const line of lines) sceneStatus.appendChild(h("div", {}, line));
      return;
    }
    const nodes = [...sceneStatus.children] as HTMLElement[];
    lines.forEach((line, index) => setText(nodes[index], line));
  }

  function diveClockText(): string | null {
    if (!diveBase) return null;
    const seconds = diveBase.elapsed + (performance.now() - diveBase.at) / 1000;
    return clockText(seconds);
  }

  // ---------- address ----------

  function syncAddress(): void {
    if (!pen) return;
    const view = stage.webgl ? stage.settledView() : "flat";
    let href = `/pens/${pen.id}?view=${view}`;
    if (selected) href += `&defect=${selected}`;
    replaceAddress(href);
  }

  // ---------- defect list ----------

  function rowText(defect: Defect): string {
    if (defect.removed) return `${defect.id} Defect removed`;
    if (stage.settledView() === "flat") {
      return `${defect.id} ${defect.type} panel ${defect.cell}`;
    }
    const base = `${defect.id} ${defect.type} ${defect.bearing_deg?.toFixed(1)}\u00b0 ${defect.depth_m?.toFixed(1)} m`;
    return defect.status === "repaired" ? `${base} Repaired` : base;
  }

  function renderDefects(): void {
    if (!pen) return;
    const defects = pen.defects ?? [];
    defectEmpty.classList.toggle("hidden", defects.length > 0);
    const seen = new Set<string>();
    for (const defect of defects) {
      seen.add(defect.id);
      let row = rows.get(defect.id);
      if (!row) {
        const text = h("span", {});
        const lock = h("span", { class: "row-sub hidden" });
        const button = h("button", { type: "button", class: "row-button" }, [text, lock]);
        button.addEventListener("click", () => select(defect.id, true));
        button.addEventListener("dblclick", () => openExistingEditor(defect.id, button));
        const root = h("li", {}, button);
        row = { root, button, text, lock };
        rows.set(defect.id, row);
        defectList.appendChild(root);
      }
      setText(row.text, rowText(defect));
      setAttr(
        row.button,
        "aria-label",
        defect.removed ? `${defect.id}, Defect removed` : `${defect.id}, ${defect.type}`,
      );
      setAttr(row.button, "aria-pressed", selected === defect.id ? "true" : "false");
      // The lock line belongs on the other device's row.
      if (defect.lock && defect.lock.device_id !== deviceId()) {
        row.lock.classList.remove("hidden");
        setText(row.lock, copy.lockedOn(defect.lock.device_name));
      } else {
        row.lock.classList.add("hidden");
        setText(row.lock, "");
      }
    }
    for (const [id, row] of [...rows]) {
      if (!seen.has(id)) {
        row.root.remove();
        rows.delete(id);
      }
    }
  }

  function liveDefects(): Defect[] {
    return (pen?.defects ?? []).filter((defect) => !defect.removed);
  }

  function select(id: string | null, fly: boolean): void {
    selected = id;
    stage.setSelected(id);
    if (id && fly) stage.flyTo(id, true);
    renderDefects();
    renderSceneStatus();
    syncAddress();
  }

  // ---------- editor ----------

  function closeEditor(): void {
    editor?.close();
    editor = null;
  }

  function openExistingEditor(id: string, opener: HTMLElement | null): void {
    const defect = pen?.defects?.find((entry) => entry.id === id);
    if (!defect || defect.removed) return;
    closeEditor();
    editorOpener = opener;
    selected = id;
    stage.setSelected(id);
    renderDefects();
    editor = openEditor(defectPanel, editorHost, {
      defectId: id,
      readOnlyLock:
        defect.lock && defect.lock.device_id !== deviceId()
          ? defect.lock.device_name
          : null,
    });
  }

  function openNewEditor(point: { x_m: number; y_m: number; z_m: number }): void {
    closeEditor();
    editor = openEditor(defectPanel, editorHost, { defectId: null, wallPoint: point });
  }

  const editorHost = {
    pen: () => pen as Pen,
    defect: (id: string) => pen?.defects?.find((entry) => entry.id === id),
    applyPen: (updated: Pen) => applyPen(updated),
    announce: (message: string) => announce(message),
    focusAfterClose: (id: string | null, deleted: boolean) => {
      if (!id) return;
      const row = rows.get(id);
      // After a delete, focus goes to that defect's placeholder row.
      if (deleted) {
        row?.button.focus();
        return;
      }
      const opener = editorOpener;
      if (opener && document.body.contains(opener)) {
        opener.focus();
        return;
      }
      (stage.pinFor(id) ?? row?.button)?.focus();
    },
    onClosed: () => {
      editor = null;
      editorOpener = null;
    },
  };

  // ---------- pen data ----------

  function applyPen(updated: Pen): void {
    if (!pen || updated.id !== pen.id) return;
    const focusedDefect = defectOfFocus();
    pen = updated;
    stage.setPen(penShape(pen), liveDefects().map(sceneDefect));
    renderDefects();
    // When a focused pin or row goes away, focus falls back to that defect's
    // placeholder row.
    if (focusedDefect && !document.body.contains(document.activeElement)) {
      rows.get(focusedDefect)?.button.focus();
    }
    renderSceneStatus();
    syncProposals();
  }

  function defectOfFocus(): string | null {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return null;
    const label = active.getAttribute("aria-label") ?? "";
    if (active.classList.contains("pin")) return label.replace("Pin ", "");
    if (active.classList.contains("row-button")) return label.split(",")[0];
    return null;
  }

  function sceneDefect(defect: Defect) {
    return {
      id: defect.id,
      bearing_deg: defect.bearing_deg ?? 0,
      depth_m: defect.depth_m ?? 0,
      chart_x_m: defect.chart_x_m ?? 0,
      chart_y_m: defect.chart_y_m ?? 0,
    };
  }

  async function loadPen(): Promise<void> {
    const [penPayload, listPayload] = await Promise.all([
      get(`/api/pens/${penId}`),
      get("/api/pens"),
    ]);
    if (destroyed) return;
    pen = penPayload.pen as Pen;
    pens = listPayload.pens as Pen[];
    rememberOpenPen(pen.id);
    loading = false;
    setText(stageName, pen.name);
    stage.setPenLabel(pen.name);
    stage.setPen(penShape(pen), liveDefects().map(sceneDefect));
    clear(penListHost);
    for (const entry of pens) {
      penListHost.appendChild(
        h("li", {}, h("a", { href: `/pens/${entry.id}` }, entry.name)),
      );
    }
    clear(penCombo);
    for (const entry of pens) {
      penCombo.appendChild(h("option", { value: entry.id }, entry.name));
    }
    penCombo.value = pen.id;
    mountLayout();
    applyAddress();
    renderDefects();
    renderSceneStatus();
    void loadDive();
  }

  /// On load the console puts the address into its canonical form at once, and
  /// shows that end state in a single frame.
  function applyAddress(): void {
    const url = new URL(window.location.href);
    const rawView = url.searchParams.get("view");
    const view = rawView === "flat" ? "flat" : "cylinder";
    stage.setView(stage.webgl ? view : "flat");
    const rawDefect = url.searchParams.get("defect");
    const match = liveDefects().find((defect) => defect.id === rawDefect);
    selected = match ? match.id : null;
    stage.setSelected(selected);
    if (match && stage.settledView() === "cylinder") stage.faceBearing(match.bearing_deg ?? 0);
    if (!stage.webgl) stage.drawFallback();
    syncAddress();
  }

  async function loadDive(): Promise<void> {
    try {
      const payload = await get("/api/dives");
      if (destroyed || !pen) return;
      const running = (payload.dives as Dive[]).find(
        (dive) => dive.pen_id === pen?.id && dive.status === "started",
      );
      diveBase = running ? { elapsed: running.elapsed_s ?? 0, at: performance.now() } : null;
      renderSceneStatus();
    } catch {
      /* the clock simply keeps its last value */
    }
  }

  // ---------- copilot ----------

  function syncProposals(): void {
    clear(copilotActions);
    for (const id of focusIds) {
      const show = h("button", { type: "button" }, `Show ${id}`);
      show.addEventListener("click", () => select(id, true));
      copilotActions.appendChild(show);
    }
    for (const proposal of proposals) {
      const defect = pen?.defects?.find((entry) => entry.id === proposal.defect_id);
      if (!defect || defect.removed) {
        copilotActions.appendChild(
          h("span", { class: "label" }, copy.proposalRemoved(proposal.defect_id)),
        );
        continue;
      }
      if (defect.status === "repaired") {
        copilotActions.appendChild(
          h("span", { class: "label" }, copy.alreadyRepaired(proposal.defect_id)),
        );
        continue;
      }
      const apply = h(
        "button",
        { type: "button" },
        `Apply repair to ${proposal.defect_id}`,
      );
      apply.addEventListener("click", async () => {
        setText(copilotStatus, copy.applyingRepair);
        apply.setAttribute("disabled", "");
        try {
          const payload = await post(`/api/proposals/${proposal.id}/apply`);
          applyPen(payload.pen as Pen);
          setText(copilotStatus, copy.repairRecorded(proposal.defect_id));
        } catch (failure) {
          apply.removeAttribute("disabled");
          setText(
            copilotStatus,
            failure instanceof ApiFailure ? failure.message : copy.unreachable,
          );
        }
      });
      copilotActions.appendChild(apply);
    }
  }

  async function ask(): Promise<void> {
    if (!pen) return;
    const token = ++copilotSequence;
    focusIds = [];
    renderSceneStatus();
    setText(copilotStatus, copy.askingCopilot);
    try {
      const payload = await post(`/api/pens/${pen.id}/copilot`, {
        question: question.value,
      });
      if (token !== copilotSequence || destroyed) return;
      const answer = payload.answer as CopilotAnswer;
      setText(answerText, answer.text ?? "");
      focusIds = answer.focus;
      proposals = answer.proposals;
      syncProposals();
      let message = copy.copilotAnswered;
      if (answer.dropped_ids.length) {
        message = `${message} ${copy.ignoredUnknown(answer.dropped_ids)}`;
      }
      setText(copilotStatus, message);
      if (answer.focus.length) select(answer.focus[0], true);
      renderSceneStatus();
    } catch (failure) {
      if (token !== copilotSequence || destroyed) return;
      focusIds = [];
      setText(
        copilotStatus,
        failure instanceof ApiFailure && failure.code === "copilot_unavailable"
          ? copy.copilotUnavailable
          : failure instanceof ApiFailure
            ? failure.message
            : copy.unreachable,
      );
      renderSceneStatus();
    }
  }

  askButton.addEventListener("click", () => void ask());
  question.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask();
    }
  });
  penCombo.addEventListener("change", () => {
    window.location.assign(`/pens/${penCombo.value}`);
  });

  // ---------- controls ----------

  function setMarking(on: boolean): void {
    marking = on;
    stage.setMarking(on);
    setAttr(markButton, "aria-pressed", on ? "true" : "false");
    renderSceneStatus();
  }

  function refreshUnwrapButton(): void {
    const flat = stage.controlTarget() === "flat";
    setText(unwrapButton, flat ? "Wrap" : "Unwrap");
    setAttr(unwrapButton, "aria-label", flat ? "Wrap" : "Unwrap");
    unwrapButton.hidden = !stage.webgl;
  }

  unwrapButton.addEventListener("click", () => {
    if (stage.controlTarget() === "flat") stage.wrap();
    else stage.unwrap();
    refreshUnwrapButton();
  });
  markButton.addEventListener("click", () => setMarking(!marking));

  // ---------- keyboard ----------

  function stepDefect(step: number): void {
    const ids = liveDefects().map((defect) => defect.id);
    if (!ids.length) return;
    const index = selected ? ids.indexOf(selected) : -1;
    const next = ids[(index + step + ids.length * 2) % ids.length];
    select(next, true);
  }

  const keyHandler = (event: KeyboardEvent): void => {
    if (shortcutsBlocked(event.target)) return;
    const onTab = (event.target as HTMLElement | null)?.getAttribute("role") === "tab";
    const flat = stage.controlTarget() === "flat";
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
        if (onTab) return;
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
      case "N":
        stepDefect(1);
        break;
      case "p":
      case "P":
        stepDefect(-1);
        break;
      case "e":
      case "E":
        if (selected) openExistingEditor(selected, null);
        break;
      case "m":
      case "M":
        setMarking(!marking);
        break;
      case "Enter": {
        const active = document.activeElement as HTMLElement | null;
        if (active?.classList.contains("pin") && active.getAttribute("aria-pressed") === "true") {
          event.preventDefault();
          if (selected) openExistingEditor(selected, active);
        }
        return;
      }
      case "Escape":
        if (marking) setMarking(false);
        return;
      case "?":
        return;
      default:
        return;
    }
    event.preventDefault();
    refreshUnwrapButton();
    renderDefects();
  };

  document.addEventListener("keydown", keyHandler);

  // ---------- live ----------

  const unsubscribe = onLive((event: LiveEvent) => {
    if (!pen) return;
    if (event.type === "farm.erased" && pen.farm_id === event.farm_id) {
      window.location.assign("/");
      return;
    }
    if (event.pen && typeof event.pen === "object") {
      const updated = event.pen as Pen;
      if (updated.id === pen.id) applyPen(updated);
    }
    if (event.pens && typeof event.pens === "object") {
      const map = event.pens as Record<string, Pen>;
      if (map[pen.id]) applyPen(map[pen.id]);
    }
    if (event.type === "lock.changed" && event.pen_id === pen.id) {
      void get(`/api/pens/${pen.id}`).then((payload) => applyPen(payload.pen as Pen));
    }
    if (!fromOtherDevice(event)) return;
    const name = String(event.device_name ?? "");
    const id = String(event.defect_id ?? "");
    if (event.type === "defect.created") announce(copy.otherMarked(name, id));
    if (event.type === "defect.updated") {
      announce(copy.otherUpdated(name, id));
      if (editor && editor.defectId === id) editor.remoteChanged();
    }
    if (event.type === "defect.removed") announce(copy.otherRemoved(name, id));
    if (event.type === "defect.repaired") announce(copy.otherRepaired(name, id));
    if (event.type === "pen.restored") {
      announce(copy.otherRestored(name, Number(event.revision), String(event.pen_name)));
    }
  });

  const diveTimer = window.setInterval(() => {
    if (diveBase) renderSceneStatus();
  }, 1000);
  const divePoll = window.setInterval(() => void loadDive(), 10000);
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
  refreshUnwrapButton();
  await loadPen();
  if (reducedMotion()) stageHost.classList.add("still");

  return {
    destroy(): void {
      destroyed = true;
      unsubscribe();
      document.removeEventListener("keydown", keyHandler);
      window.removeEventListener("resize", resizeHandler);
      window.clearInterval(diveTimer);
      window.clearInterval(divePoll);
      closeEditor();
      stage.destroy();
    },
  };
}
