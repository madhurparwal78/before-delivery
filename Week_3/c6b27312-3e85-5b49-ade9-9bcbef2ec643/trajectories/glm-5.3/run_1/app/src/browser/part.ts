import { el, text as t, announce, viewerId, prefersReducedMotion } from "./dom.js";
import { api, ApiError, type PartResponse, type ReportResponse } from "./api.js";
import { EvalEngine, type EvalSnapshot } from "./eval.js";
import { Viewport, defaultPose, cameraText } from "./viewport.js";
import { matchesNumberGrammar, formatNumber, formatFixed, roundHalfEven, mmToInchText } from "../shared/numbers.js";
import type { ManifestEntry, Values, Solid } from "../shared/records.js";
import { PROCESSES } from "../shared/records.js";

export interface PageContext {
  config: Awaited<ReturnType<typeof api.config>>;
  me: { id: string; displayName: string } | null;
  app: HTMLElement;
}

const UNIT_WORDS: Record<string, string> = { mm: "millimetres", in: "inches", deg: "degrees" };

/** The part page: dimensions, pre-flight, revisions, review and the tape. */
export async function renderPartPage(ctx: PageContext, slug: string, params: URLSearchParams): Promise<void> {
  const revisionParam = params.get("revision") ?? undefined;
  const partResponse = await fetch(`/api/parts/${slug}${revisionParam ? `?revision=${encodeURIComponent(revisionParam)}` : ""}`, { credentials: "same-origin" });
  const knownHeadTag = partResponse.headers.get("etag") ?? "";
  const part = await partResponse.json() as PartResponse;
  const root = el("div", { class: "part-layout" });
  ctx.app.replaceChildren(root);

  // ----- state -----
  const manifest = part.manifest;
  const defaults: Values = {};
  for (const m of manifest) if (!m.derived) defaults[m.name] = m.default;
  let values: Values = {};
  const configParam = params.get("config");
  const dropped: string[] = [];
  if (configParam !== null) {
    values = { ...defaults };
    for (const pair of configParam.split(",").filter(Boolean)) {
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const raw = pair.slice(eq + 1);
      const m = manifest.find((x) => x.name === name && !x.derived);
      if (!m) { dropped.push(name); continue; }
      if (m.kind === "boolean") {
        if (raw !== "true" && raw !== "false") { dropped.push(name); continue; }
        values[name] = raw === "true";
      } else if (m.kind === "enum") {
        if (!m.options?.includes(raw)) { dropped.push(name); continue; }
        values[name] = raw;
      } else {
        if (!matchesNumberGrammar(raw)) { dropped.push(name); continue; }
        const n = Number(raw);
        if (m.kind === "count" && !Number.isInteger(n)) { dropped.push(name); continue; }
        if (m.min !== undefined && n < m.min || m.max !== undefined && n > m.max) { dropped.push(name); continue; }
        values[name] = n;
      }
    }
  } else {
    // The loaded revision's values over the source defaults.
    values = { ...defaults, ...part.revision.values };
    writeConfigAddress(slug, values, defaults, revisionParam);
  }

  let units: "mm" | "in" = localStorage.getItem("tinework:units") === "in" ? "in" : "mm";
  const knownHead = part.headRevisionId;

  // ----- header -----
  const main = el("div", { class: "part-main" });
  const likeBtn = el("button", { "aria-pressed": part.liked ? "true" : "false" }, t(`Like ${part.title}`));
  const saveBtn = el("button", {}, t("Save revision"));
  const zipBtn = el("button", {}, t("Download ZIP"));
  const tarBtn = el("button", {}, t("Download TAR"));
  main.append(
    el("div", { class: "part-head" },
      el("h1", {}, t(part.title)),
      el("span", { class: "muted" }, t(`by ${part.owner.displayName}`)),
      el("div", { class: "actions" }, likeBtn, saveBtn, zipBtn, tarBtn),
    )
  );
  root.append(main);

  // ----- viewport -----
  const viewportCol = el("div", { class: "part-viewport-col" });
  const viewportRoot = el("div", { "data-ui": "viewport", "data-viewer-id": viewerId(), "data-eval-state": "settled", "data-epoch": "0", "data-projection": "perspective" });
  viewportRoot.dataset.epoch = "0";
  const glow = el("div", { class: "solid-glow" });
  viewportRoot.append(glow);
  viewportCol.append(viewportRoot);
  main.append(viewportCol);

  const readouts = el("div", { class: "readouts" });
  const volOut = el("div", { class: "readout" }, el("span", { class: "readout-label" }, t("Volume")), el("span", { class: "readout-value" }, t("—")));
  const bboxOut = el("div", { class: "readout" }, el("span", { class: "readout-label" }, t("Bounding box")), el("span", { class: "readout-value" }, t("—")));
  const facesOut = el("div", { class: "readout" }, el("span", { class: "readout-label" }, t("Faces")), el("span", { class: "readout-value" }, t("—")));
  const digestOut = el("div", { class: "readout" }, el("span", { class: "readout-label" }, t("Digest")), el("span", { class: "readout-value", style: "font-size:11px;overflow-wrap:anywhere" }, t("—")));
  readouts.append(volOut, bboxOut, facesOut, digestOut);
  const slowNotice = el("div", { "data-ui": "slow-notice" }, t("Still evaluating. Large parts can take a few seconds."));
  viewportCol.append(readouts, slowNotice);

  // View toolbar: one Tab stop, moved by arrow keys.
  const toolbar = el("div", { class: "viewport-toolbar", role: "toolbar", "aria-label": "View" });
  const resetBtn = el("button", {}, t("Reset view"));
  const orthoSwitch = el("button", { role: "switch", "aria-checked": "false" }, t("Orthographic"));
  toolbar.append(resetBtn, orthoSwitch);
  viewportRoot.append(toolbar);
  setupToolbarRoving(toolbar, [resetBtn, orthoSwitch]);

  // ----- evaluation engine -----
  let viewport: Viewport | null = null;
  let currentBbox: number[] = [60, 40, 8];
  let basePose = defaultPose(currentBbox);
  const applySnapshot = (snap: EvalSnapshot): void => {
    currentBbox = snap.bbox;
    const solid = snap.solid as Solid | null;
    if (solid && viewport) {
      viewport.setSolid(solid);
    }
    volOut.querySelector(".readout-value")!.textContent = `${formatFixed(snap.volume, 2)}\u202Fmm\u00b3`;
    bboxOut.querySelector(".readout-value")!.textContent = bboxText(snap.bbox);
    facesOut.querySelector(".readout-value")!.textContent = String(snap.faces);
    digestOut.querySelector(".readout-value")!.textContent = snap.digest.slice(0, 16);
    viewportRoot.dataset.digest = snap.digest;
    viewportRoot.dataset.volume = formatFixed(snap.volume, 2);
    viewportRoot.dataset.bbox = snap.bbox.join(",");
    viewportRoot.dataset.faces = String(snap.faces);
    viewportRoot.dataset.seq = String(engine.currentSeq);
    bumpEpochPart();
  };
  const engine = new EvalEngine(
    slug, ctx.config.evalDebounceMs, ctx.config.slowEvalNoticeMs, viewerId(),
    applySnapshot,
    (diag) => {
      findings.setDiagnostic(diag);
      announce("eval-status", `Could not evaluate: ${diag.message}`);
    },
    (state) => {
      viewportRoot.dataset.evalState = state;
      setFrameEvaluating(state === "evaluating");
    },
    viewportRoot
  );
  engine.currentValues = () => values;

  const bumpEpochPart = (): void => {
    const key = `tinework:epoch:part:${slug}`;
    const next = Number(sessionStorage.getItem(key) ?? "0") + 1;
    sessionStorage.setItem(key, String(next));
    viewportRoot.dataset.epoch = String(next);
  };
  const restoreEpochPart = (): void => {
    viewportRoot.dataset.epoch = sessionStorage.getItem(`tinework:epoch:part:${slug}`) ?? "0";
  };
  restoreEpochPart();

  function setFrameEvaluating(on: boolean): void {
    const frame = document.querySelector('[data-ui="frame"]') as SVGRectElement | null;
    if (!frame) return;
    frame.style.strokeDasharray = on ? "6 4" : "";
    if (on && !prefersReducedMotion()) {
      let offset = 0;
      const animate = (): void => {
        offset = (offset + 0.3) % 10;
        frame.style.strokeDashoffset = String(-offset);
        if (frame.style.strokeDasharray) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    } else {
      frame.style.strokeDashoffset = "0";
    }
  }

  // ----- findings -----
  const findingsRegion = el("section", { class: "findings-region", "aria-label": "Findings" });
  const findingsList = el("div", { class: "findings", role: "listbox", "aria-label": "Findings", tabindex: "0" });
  const gotoRow = el("div", { class: "goto-row" });
  findingsRegion.append(el("h2", {}, t("Findings")), findingsList, gotoRow);
  viewportCol.append(findingsRegion);

  const findings = new FindingsController(findingsList, gotoRow, manifest, viewportRoot);

  if (dropped.length > 0) {
    findings.setDropped(`Dropped from the link: ${dropped.join(", ")}`);
    // Rewrite the address without the dropped values.
    writeConfigAddress(slug, values, defaults, revisionParam);
  }

  // ----- build tape -----
  const tapeSection = el("section", { class: "tape-section" });
  const tapeDisabledLine = el("div", { class: "tape-disabled-line", hidden: true });
  const tapeSlider = el("div", {
    class: "tape", role: "slider", "aria-label": "Build tape",
    "aria-valuemin": "0", "aria-valuemax": "0", "aria-valuenow": "0",
    "aria-valuetext": "Operation 0 of 0 · start · empty", tabindex: "0",
  });
  const tapeReadout = el("div", { "data-ui": "tape-readout" }, t(""));
  const tapeRow = el("div", { class: "build-tape" }, tapeSlider, tapeReadout);
  tapeSection.append(el("h2", {}, t("Build tape")), tapeDisabledLine, tapeRow);
  const forkBtn = el("button", { hidden: "" }, t("Fork"));
  const pinLayer = el("div", { style: "position:absolute;inset:0;pointer-events:none" });
  viewportRoot.append(pinLayer);
  const noReportLine = el("div", { class: "tape-disabled-line" }, t(`No pre-flight report for ${part.revision.label} yet.`));

  const tape = new TapeController(tapeSlider, tapeReadout, tapeDisabledLine, forkBtn, viewportRoot, slug, part, values, () => {
    // Drawing a stored snapshot counts one paint.
    bumpEpochPart();
  });
  void tape;
  tapeSection.append(forkBtn, noReportLine);
  viewportCol.append(tapeSection);

  // ----- source pane -----
  const sourceLines = part.source.split("\n");
  const sourcePane = el("div", { class: "source-pane" });
  const lineElems: HTMLElement[] = [];
  sourceLines.forEach((line, i) => {
    const row = el("div", { class: "source-line", "data-line": String(i + 1) });
    row.append(el("span", { class: "line-no" }, t(String(i + 1))), t(line || " "));
    lineElems.push(row);
    sourcePane.append(row);
  });
  viewportCol.append(sourcePane);

  // ----- rail -----
  const rail = el("div", { class: "rail" });
  root.append(rail);
  const narrow = () => window.matchMedia("(max-width: 1023px)").matches;

  // Dimensions group
  const dimsRegion = el("div", { class: "group-region", role: "region", "aria-label": "Dimensions" });
  makeGroup("Dimensions", dimsRegion, true, rail, narrow);
  const unitsRow = el("div", { class: "radiogroup", role: "radiogroup", "aria-label": "Units" });
  const mmRadio = el("button", { role: "radio", "aria-checked": units === "mm" ? "true" : "false" }, t("Millimetres"));
  const inRadio = el("button", { role: "radio", "aria-checked": units === "in" ? "true" : "false" }, t("Inches"));
  unitsRow.append(mmRadio, inRadio);
  const modifiedHead = el("div", { class: "rail-header-row" }, el("span", { class: "modified-count" }, t("0 modified")));
  const resetAllBtn = el("button", {}, t("Reset all"));
  modifiedHead.append(resetAllBtn);
  const controlsList = el("div", { class: "controls-list" });
  dimsRegion.append(modifiedHead, unitsRow, controlsList);

  const controls = new Map<string, { row: HTMLElement; entry: ManifestEntry }>();
  for (const entry of manifest) {
    if (entry.derived) {
      const row = el("div", { class: "control-row" }, el("span", { class: "derived-value" }, t("")));
      row.dataset.name = entry.name;
      controlsList.append(row);
      controls.set(entry.name, { row, entry });
      continue;
    }
    const row = el("div", { class: "control-row" });
    row.dataset.name = entry.name;
    const head = el("div", { class: "control-head" }, el("label", { for: `ctrl-${entry.name}` }, t(entry.label)));
    const unitLabel = el("span", { class: "unit" }, t(unitWordShort(entry, units)));
    head.append(unitLabel);
    row.append(head);
    if (entry.kind === "boolean") {
      const sw = el("button", { role: "switch", "aria-checked": String(values[entry.name] === true), id: `ctrl-${entry.name}` }, t(entry.label));
      sw.addEventListener("click", () => {
        const next = !(values[entry.name] === true);
        values[entry.name] = next;
        sw.setAttribute("aria-checked", String(next));
        onCommit();
      });
      row.append(sw);
    } else if (entry.kind === "enum") {
      const group = el("div", { class: "radiogroup", role: "radiogroup", "aria-label": entry.label });
      for (const option of entry.options ?? []) {
        const rb = el("button", { role: "radio", "aria-checked": String(values[entry.name] === option) }, t(option));
        rb.addEventListener("click", () => {
          values[entry.name] = option;
          for (const other of Array.from(group.children)) other.setAttribute("aria-checked", String(other === rb));
          onCommit();
        });
        group.append(rb);
      }
      row.append(group);
    } else {
      const spinRow = el("div", { class: "spin-row" });
      const spin = el("div", { role: "spinbutton", id: `ctrl-${entry.name}`, tabindex: "0", "aria-valuenow": "0", "aria-valuetext": "" });
      const scrub = el("button", { class: "scrub-button", "aria-label": `Scrub ${entry.label}` });
      scrub.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h12M4 5h8M4 11h8" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>`;
      spinRow.append(spin, scrub);
      row.append(spinRow);
      const wasMarker = el("div", { class: "was-marker", hidden: true });
      const frame = el("div", { class: "modified-frame" });
      row.append(wasMarker, frame);
      bindSpinbutton(spin, scrub, entry, () => values, (v) => {
        values[entry.name] = v;
        onCommit();
      }, () => units);
      controls.set(entry.name, { row, entry });
      row.dataset.name = entry.name;
    }
    if (!entry.derived) controlsList.append(row);
  }
  refreshControls();

  // Pre-flight group
  const preflightRegion = el("div", { class: "group-region", role: "region", "aria-label": "Pre-flight" });
  makeGroup("Pre-flight", preflightRegion, !narrow(), rail, narrow);
  const processGroup = el("div", { class: "radiogroup", role: "radiogroup", "aria-label": "Process" });
  let process = "fdm-04";
  for (const proc of PROCESSES) {
    const rb = el("button", { role: "radio", "aria-checked": String(process === proc.id) }, t(proc.label));
    rb.addEventListener("click", () => {
      process = proc.id;
      for (const other of Array.from(processGroup.children)) other.setAttribute("aria-checked", String(other === rb));
      reportController.markStale();
    });
    processGroup.append(rb);
  }
  const runBtn = el("button", {}, t(part.preflightLeft === null ? "Run pre-flight" : `Run pre-flight (${part.preflightLeft} of ${ctx.config.preflightSignedOutLimit} left this session)`));
  const report = new ReportController(el("section", { class: "report-region", role: "region", "aria-label": "Pre-flight report", "data-state": "unrun", "data-epoch": "0" }), slug);
  const reportController = report;
  reportController.dimFindings = (dim) => findings.dim(dim);
  preflightRegion.append(processGroup, runBtn, report.root);
  const refreshRunButton = async (): Promise<void> => {
    try {
      const fresh = await fetch(`/api/parts/${slug}`, { credentials: "same-origin" });
      const json = await fresh.json() as { preflightLeft: number | null };
      if (json.preflightLeft !== null) {
        runBtn.textContent = `Run pre-flight (${json.preflightLeft} of ${ctx.config.preflightSignedOutLimit} left this session)`;
        if (json.preflightLeft <= 0) runBtn.setAttribute("aria-disabled", "true");
      }
    } catch { /* keep the current text */ }
  };
  window.addEventListener("tinework:report-run", () => { void refreshRunButton(); });
  runBtn.addEventListener("click", () => void reportController.run(values, process, (report) => {
    findings.setReportFindings(report.findings);
  }));

  // Revisions group
  const revRegion = el("div", { class: "group-region", role: "region", "aria-label": "Revisions" });
  makeGroup("Revisions", revRegion, !narrow(), rail, narrow);
  const revList = el("ul", { class: "revisions-list", "aria-label": "Revisions" });
  revRegion.append(revList, el("a", { href: `/tapes/${part.revision.id}` }, t("Open build tape")));
  const isOwner = ctx.me?.id === part.owner.id;
  const refreshRevisions = async (): Promise<void> => {
    const revs = await api.revisions(slug);
    revList.replaceChildren();
    for (const rev of revs.revisions) {
      const row = el("li", { class: "revision-row", ...(rev.id === part.revision.id ? { "aria-current": "true" } : {}) });
      row.append(el("a", { href: `/parts/${slug}?revision=${rev.id}` }, t(rev.label)));
      if (rev.id !== part.revision.id) {
        row.append(el("a", { href: `/parts/${slug}/compare?base=${rev.id}&head=${revs.revisions[0]!.id}` }, t(`Compare ${rev.label} with ${revs.revisions[0]!.label}`)));
      }
      if (isOwner && rev.id !== knownHead) {
        const restoreBtn = el("button", {}, t(`Restore ${rev.label}`));
        restoreBtn.addEventListener("click", () => void openRestoreDialog(rev));
        row.append(el("span", { class: "rev-actions" }, restoreBtn));
      }
      row.append(el("span", { class: "rev-meta" }, t(`· ${rev.message} · ${part.owner.displayName}`)));
      revList.append(row);
    }
  };
  void refreshRevisions();

  // Review group: the owner starts a review; rooms list here.
  const reviewRegion = el("div", { class: "group-region", role: "region", "aria-label": "Review" });
  makeGroup("Review", reviewRegion, !narrow(), rail, narrow);
  const roomsList = el("ul", { class: "rooms-list", "aria-label": "Rooms" });
  const refreshRooms = async (): Promise<void> => {
    roomsList.replaceChildren();
    try {
      const dash = await api.dashboard();
      for (const room of dash.rooms.filter((r) => r.partSlug === slug)) {
        const li = el("li", { class: "room-row" });
        const state = room.state.charAt(0).toUpperCase() + room.state.slice(1);
        li.append(
          el("a", { href: `/rooms/${room.id}` }, t(room.title)),
          el("span", { class: "dash-meta" }, t(`${state} \u00b7 Approvals ${room.approvals} of ${room.requiredApprovals}`)),
        );
        roomsList.append(li);
      }
    } catch { /* signed out: no rooms */ }
  };
  await refreshRooms();
  reviewRegion.append(roomsList);
  if (isOwner) {
    const startReviewBtn = el("button", {}, t("Start review"));
    startReviewBtn.addEventListener("click", () => {
      openDialog("Start a review", (close) => {
        const title = el("input", { type: "text", "aria-label": "Room title" }) as HTMLInputElement;
        const emails = el("input", { type: "text", "aria-label": "Reviewer emails" }) as HTMLInputElement;
        const note = el("p", { class: "dialog-note" }, t("Separate addresses with commas."));
        const createBtn = el("button", { class: "primary" }, t("Create room")) as HTMLButtonElement;
        const cancelBtn = el("button", {}, t("Cancel")) as HTMLButtonElement;
        createBtn.addEventListener("click", async () => {
          createBtn.disabled = true;
          createBtn.classList.add("progress-line");
          try {
            const res = await fetch(`/api/parts/${slug}/rooms`, {
              method: "POST",
              headers: { "content-type": "application/json", "Idempotency-Key": mintKey("room") },
              body: JSON.stringify({ title: title.value, reviewers: emails.value.split(",").map((e) => e.trim()).filter(Boolean) }),
              credentials: "same-origin",
            });
            if (res.status === 201) {
              const room = await res.json() as { id: string };
              close();
              location.href = `/rooms/${room.id}`;
            } else {
              const body = await res.json() as { errors?: Record<string, string> };
              if (body.errors) {
                for (const [field, message] of Object.entries(body.errors)) {
                  const input = field === "title" ? title : emails;
                  input.setAttribute("aria-invalid", "true");
                  input.parentElement?.querySelector(".field-error")?.remove();
                  input.parentElement?.append(el("div", { class: "field-error" }, t(message)));
                }
              }
              createBtn.disabled = false;
              createBtn.classList.remove("progress-line");
            }
          } catch {
            note.textContent = "Not sent yet. Try again.";
            createBtn.disabled = false;
            createBtn.classList.remove("progress-line");
          }
        });
        cancelBtn.addEventListener("click", close);
        return el("div", {},
          el("div", { class: "field" }, el("label", {}, t("Room title")), title),
          el("div", { class: "field" }, el("label", {}, t("Reviewer emails")), emails),
          note,
          el("div", { class: "dialog-actions" }, cancelBtn, createBtn),
        );
      });
    });
    reviewRegion.append(startReviewBtn);
  }

  // ----- first paint -----
  basePose = defaultPose([60, 40, 8]);
  viewport = new Viewport(viewportRoot, basePose);
  viewportRoot.dataset.camera = cameraText(viewport.pose);
  viewport.onCamera(() => {
    viewportRoot.dataset.camera = cameraText(viewport!.pose);
    viewportRoot.dataset.projection = viewport!.pose.projection;
  });
  resetBtn.addEventListener("click", () => {
    viewport!.resetView(defaultPose(currentBbox));
  });
  orthoSwitch.addEventListener("click", () => {
    const next = viewport!.pose.projection === "perspective" ? "orthographic" : "perspective";
    viewport!.setProjection(next);
    orthoSwitch.setAttribute("aria-checked", String(next === "orthographic"));
  });

  // The address's operation parameter decides the tape's starting tick.
  await tape.load(part.revision.id);
  const opParam = params.get("operation");
  const n = tape.n;
  let startOp = n;
  let opUsable = false;
  if (opParam !== null) {
    if (matchesNumberGrammar(opParam) && Number.isInteger(Number(opParam))) {
      const k = Number(opParam);
      if (k >= 0 && k <= n) { startOp = k; opUsable = true; }
    }
    removeParam("operation");
  }
  if (opUsable) {
    await tape.moveTo(startOp, values);
  } else {
    // draw the live configuration after the first evaluation
  }

  // save=1 opens Save revision when signed in
  if (params.get("save") === "1" && ctx.me) {
    removeParam("save");
    openSaveDialog();
  }

  // ----- commits -----
  function onCommit(): void {
    refreshControls();
    reportController.checkStale(values, process);
    writeConfigAddress(slug, values, defaults, revisionParam);
    engine.commit();
    if (tape.currentOp < tape.n) tape.returnToLive();
  }

  function refreshControls(): void {
    let modified = 0;
    for (const [name, { row, entry }] of controls) {
      if (entry.derived) {
        row.querySelector(".derived-value")!.textContent = `${entry.label} ${formatNumber(Number(values[name] ?? entry.default), entry.precision)}\u202Fmm`;
        continue;
      }
      const isDefault = values[name] === defaults[name];
      row.dataset.modified = String(!isDefault);
      if (!isDefault) modified += 1;
      const spin = row.querySelector('[role="spinbutton"]');
      const scrub = row.querySelector(".scrub-button");
      if (spin && entry.kind !== "boolean" && entry.kind !== "enum") {
        updateSpinAria(spin as HTMLElement, entry, Number(values[name]), units);
      }
      void scrub;
      const wasMarker = row.querySelector(".was-marker");
      if (wasMarker) {
        if (isDefault) {
          wasMarker.setAttribute("hidden", "");
          wasMarker.textContent = "";
        } else {
          wasMarker.removeAttribute("hidden");
          wasMarker.textContent = wasMarkerText(entry);
        }
      }
    }
    dimsRegion.querySelector(".modified-count")!.textContent = `${modified} modified`;
    // The address is rewritten after the debounce in engine.commit().
  }

  // ----- units -----
  mmRadio.addEventListener("click", () => setUnits("mm"));
  inRadio.addEventListener("click", () => setUnits("in"));
  function setUnits(u: "mm" | "in"): void {
    units = u;
    localStorage.setItem("tinework:units", u);
    mmRadio.setAttribute("aria-checked", String(u === "mm"));
    inRadio.setAttribute("aria-checked", String(u === "in"));
    refreshControls();
  }

  // ----- reset all -----
  resetAllBtn.addEventListener("click", () => {
    values = { ...defaults };
    for (const [name] of controls) {
      const row = controls.get(name)!.row;
      const sw = row.querySelector('[role="switch"]');
      if (sw) sw.setAttribute("aria-checked", String(values[name] === true));
      const radios = row.querySelectorAll('[role="radio"]');
      radios.forEach((rb, i) => {
        const option = manifest.find((m) => m.name === name)?.options?.[i];
        rb.setAttribute("aria-checked", String(values[name] === option));
      });
    }
    refreshControls();
    onCommit();
  });

  // ----- likes -----
  likeBtn.addEventListener("click", async () => {
    if (!ctx.me) return;
    try {
      const res = likeBtn.getAttribute("aria-pressed") === "true" ? await api.unlike(slug) : await api.like(slug);
      likeBtn.setAttribute("aria-pressed", String(res.liked));
      likeBtn.textContent = `Like ${part.title}`;
      announce("part-activity", "");
    } catch { /* signed out: the tooltip shows */ }
  });
  if (!ctx.me) {
    likeBtn.setAttribute("aria-disabled", "true");
    bindLikeTooltip(likeBtn);
  }

  // ----- downloads -----
  zipBtn.addEventListener("click", () => downloadArchive(slug, part.revision.id, "zip"));
  tarBtn.addEventListener("click", () => downloadArchive(slug, part.revision.id, "tar"));

  // ----- save -----
  saveBtn.addEventListener("click", () => {
    if (!ctx.me) {
      openSignupToSave();
      return;
    }
    openSaveDialog();
  });

  function openSignupToSave(): void {
    const returnTo = `${location.pathname}${location.search}${location.search.includes("save=1") ? "" : "&save=1"}`;
    const dlgRoot = openDialog("Sign up to save", (close) => {
      const email = el("input", { type: "email", "aria-label": "Email" });
      const name = el("input", { type: "text", "aria-label": "Display name" });
      const pass = el("input", { type: "password", "aria-label": "Password" });
      const note = el("p", { class: "dialog-note" });
      const submit = el("button", { class: "primary" }, t("Create account and send link")) as HTMLButtonElement;
      const haveAccount = el("a", { href: "#" }, t("I already have an account"));
      submit.addEventListener("click", async () => {
        try {
          await api.signup((email as HTMLInputElement).value, (pass as HTMLInputElement).value, (name as HTMLInputElement).value, returnTo);
          note.textContent = `Check your inbox: we sent a link to ${(email as HTMLInputElement).value}. It brings you back to this exact configuration.`;
        } catch (err) {
          if (err instanceof ApiError && err.errors) {
            showFieldErrors(backdropOf(), err.errors);
          }
        }
      });
      haveAccount.addEventListener("click", (e) => {
        e.preventDefault();
        close();
        location.href = `/signin?next=${encodeURIComponent(returnTo)}`;
      });
      const form = el("form", {}, el("div", { class: "field" }, el("label", {}, t("Email")), email), el("div", { class: "field" }, el("label", {}, t("Display name")), name), el("div", { class: "field" }, el("label", {}, t("Password")), pass), note, el("div", { class: "dialog-actions" }, submit));
      form.addEventListener("submit", (e) => { e.preventDefault(); void submit.click(); });
      return form;
    });
    function backdropOf(): HTMLElement {
      return dlgRoot.dialog as HTMLElement;
    }
  }

  function openSaveDialog(): void {
    const owner = ctx.me?.id === part.owner.id;
    const saveDlg = openDialog("Save revision", (close) => {
      const message = el("input", { type: "text", "aria-label": "Message" });
      const save = el("button", { class: "primary" }, t("Save")) as HTMLButtonElement;
      const cancel = el("button", {}, t("Cancel"));
      const note = owner ? el("p", { class: "dialog-note" }) : el("p", { class: "dialog-note" }, t(`This part belongs to ${part.owner.displayName}. Saving makes your own copy: ${part.title} (my configuration).`));
      let key = mintKey("save");
      save.addEventListener("click", async () => {
        save.classList.add("progress-line");
        save.disabled = true;
        save.textContent = "Saving...";
        try {
          const etag = knownHeadTag;
          const payload = JSON.stringify({ values, message: (message as HTMLInputElement).value });
          const headers: Record<string, string> = { "content-type": "application/json", "If-Match": etag ?? "", "Idempotency-Key": key };
          const isOwnerWrite = ctx.me?.id === part.owner.id;
          const res = await fetch(isOwnerWrite ? `/api/parts/${slug}/revisions` : `/api/parts/${slug}/copies`, { method: "POST", headers, body: payload, credentials: "same-origin" });
          if (res.status === 201) {
            clearDraft(slug);
            const body = JSON.parse(await res.text()) as { id?: string; slug?: string; revision?: { id: string; label: string } };
            const rev = body.revision!;
            const newSlug = isOwnerWrite ? slug : body.slug!;
            const revId = rev.id;
            close();
            announce("part-activity", `Saved ${(rev as { label?: string }).label ?? ""}.`);
            const config = configText(values, defaults);
            location.href = `/parts/${newSlug}?revision=${revId}&config=${encodeURIComponent(config)}`;
          } else if (res.status === 412) {
            close();
            await showConflict(slug, JSON.parse(await res.text()), values, manifest);
          } else if (res.status === 503) {
            note.textContent = "Saving is paused: part storage is unreachable. Your parts are safe; try again in a few minutes.";
            save.classList.remove("progress-line");
            save.disabled = false;
            save.textContent = "Save";
          } else {
            const body = JSON.parse(await res.text()) as { errors?: Record<string, string> };
            if (body.errors) showFieldErrors(saveDlg.dialog as HTMLElement, body.errors);
            save.classList.remove("progress-line");
            save.disabled = false;
            save.textContent = "Save";
            key = mintKey("save");
          }
        } catch {
          note.textContent = "Not sent yet. Try again.";
          save.classList.remove("progress-line");
          save.disabled = false;
          save.textContent = "Save";
        }
      });
      cancel.addEventListener("click", close);
      return el("div", {}, note, el("div", { class: "field" }, el("label", {}, t("Message")), message), el("div", { class: "dialog-actions" }, cancel, save));
    });
  }

  async function openRestoreDialog(rev: { id: string; label: string }): Promise<void> {
    openDialog(`Restore ${rev.label} as a new revision?`, (close) => {
      const restore = el("button", { class: "primary" }, t("Restore")) as HTMLButtonElement;
      const cancel = el("button", {}, t("Cancel"));
      const note = el("p", { class: "dialog-note" }, t("The current head stays in the history."));
      let key = mintKey("restore");
      restore.addEventListener("click", async () => {
        restore.disabled = true;
        restore.classList.add("progress-line");
        try {
          const etag = knownHeadTag;
          const res = await fetch(`/api/parts/${slug}/revisions/${rev.id}/restore`, {
            method: "POST", headers: { "content-type": "application/json", "If-Match": etag ?? "", "Idempotency-Key": key }, body: "{}", credentials: "same-origin",
          });
          if (res.status === 201) {
            const body = JSON.parse(await res.text()) as { id: string; label: string };
            close();
            announce("part-activity", `Saved ${body.label}.`);
            location.href = `/parts/${slug}?revision=${body.id}`;
          } else if (res.status === 412) {
            close();
            await showConflict(slug, JSON.parse(await res.text()), values, manifest);
          } else if (res.status === 503) {
            note.textContent = "Saving is paused: part storage is unreachable. Your parts are safe; try again in a few minutes.";
            restore.disabled = false;
          } else {
            restore.disabled = false;
          }
        } catch {
          note.textContent = "Not sent yet. Try again.";
          restore.disabled = false;
        }
      });
      cancel.addEventListener("click", close);
      return el("div", {}, note, el("div", { class: "dialog-actions" }, cancel, restore));
    });
  }

  // ----- initial evaluation -----
  await runInitialEvaluation();

  async function runInitialEvaluation(): Promise<void> {
    // Evaluate once to paint the first solid.
    engine.commit();
  }

  // ----- live events -----
  openEventStream(slug, (event) => {
    if (event.type === "revision") {
      void refreshRevisions();
      announce("part-activity", `New revision ${(event.data.revision as { label?: string } | undefined)?.label ?? ""} by ${String(event.data.authorDisplayName ?? "")}.`);
    } else if (event.type === "like") {
      // The like count beside the like button.
    }
  });
}

function wasMarkerText(entry: ManifestEntry): string {
  const d = Number(entry.default);
  if (entry.kind === "count") return `was ${d}`;
  if (entry.kind === "boolean") return `was ${d ? "on" : "off"}`;
  if (entry.kind === "enum") return `was ${String(entry.default)}`;
  return `was ${formatNumber(d, entry.precision)} mm`;
}

function unitWordShort(entry: ManifestEntry, units: "mm" | "in"): string {
  if (entry.kind === "angle") return "\u00b0";
  if (entry.kind === "length") return units === "in" ? "in" : "mm";
  return "";
}

function updateSpinAria(spin: HTMLElement, entry: ManifestEntry, value: number, units: "mm" | "in"): void {
  const shown = units === "in" && entry.kind === "length" ? value / 25.4 : value;
  spin.setAttribute("aria-valuenow", String(Math.round(shown * 10000) / 10000));
  if (entry.min !== undefined) spin.setAttribute("aria-valuemin", String(Math.round((units === "in" && entry.kind === "length" ? entry.min / 25.4 : entry.min) * 10000) / 10000));
  if (entry.max !== undefined) spin.setAttribute("aria-valuemax", String(Math.round((units === "in" && entry.kind === "length" ? entry.max / 25.4 : entry.max) * 10000) / 10000));
  const word = entry.kind === "count" ? "" : ` ${UNIT_WORDS[entry.kind === "angle" ? "deg" : units] ?? ""}`;
  const shownText = entry.kind === "count"
    ? String(value)
    : units === "in" && entry.kind === "length"
      ? mmToInchText(value, entry.precision)
      : formatNumber(value, entry.precision);
  spin.setAttribute("aria-valuetext", `${shownText}${word}`);
  spin.textContent = `${shownText}`;
  const unit = spin.parentElement?.querySelector(".unit-inside");
  if (unit) unit.textContent = unitWordShort(entry, units);
}

/** Keyboard, modifier and scrub behaviour of one spinbutton (DP-02, DP-22). */
function bindSpinbutton(
  spin: HTMLElement,
  scrub: HTMLElement,
  entry: ManifestEntry,
  getValues: () => Values,
  set: (v: number) => void,
  getUnits: () => "mm" | "in"
): void {
  const step = entry.step ?? 0.1;
  const isCount = entry.kind === "count";
  const clamp = (v: number): number => {
    let out = v;
    if (entry.min !== undefined) out = Math.max(entry.min, out);
    if (entry.max !== undefined) out = Math.min(entry.max, out);
    return out;
  };
  const snap = (v: number): number => {
    // Stepped values snap to whole multiples of one tenth of the step.
    const q = step / 10;
    return Math.round(v / q) * q;
  };
  const applyStep = (direction: 1 | -1, mult: number): void => {
    const base = Number(getValues()[entry.name] ?? entry.default);
    const delta = direction * (isCount ? 1 : step * mult);
    const next = clamp(snap(base + delta));
    set(roundHalfEven(next, 3));
  };
  spin.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).isComposing) return;
    const ke = e as KeyboardEvent;
    const mult = ke.ctrlKey || ke.metaKey ? 0.1 : ke.shiftKey ? 10 : 1;
    switch (ke.key) {
      case "ArrowUp":
      case "ArrowRight":
        applyStep(1, mult);
        ke.preventDefault();
        break;
      case "ArrowDown":
      case "ArrowLeft":
        applyStep(-1, mult);
        ke.preventDefault();
        break;
      case "PageUp":
        applyStep(1, 10);
        ke.preventDefault();
        break;
      case "PageDown":
        applyStep(-1, 10);
        ke.preventDefault();
        break;
      case "Enter": {
        const raw = (spin.textContent ?? "").trim();
        commitTyped(raw);
        ke.preventDefault();
        break;
      }
    }
  });
  const commitTyped = (raw: string): void => {
    if (raw === "") return;
    if (!matchesNumberGrammar(raw)) {
      spin.setAttribute("aria-invalid", "true");
      return;
    }
    let v = Number(raw);
    if (getUnits() === "in" && entry.kind === "length") v = v * 25.4;
    spin.removeAttribute("aria-invalid");
    set(clamp(roundHalfEven(v, 3)));
  };
  spin.addEventListener("blur", () => {
    commitTyped((spin.textContent ?? "").trim());
  });
  spin.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key.length === 1 && /[0-9.\-]/.test((e as KeyboardEvent).key)) {
      if (spin.getAttribute("aria-invalid") === "true") {
        spin.textContent = "";
        spin.removeAttribute("aria-invalid");
      }
    }
  });
  // Text editing: keep the caret workable with contenteditable-lite.
  spin.setAttribute("contenteditable", "true");
  spin.addEventListener("input", () => {
    // values commit on Enter or blur only
  });
  spin.addEventListener("paste", (e) => e.preventDefault());

  // Scrub by pointer: one step per 4 pixels; commit on release; Escape restores.
  scrub.addEventListener("pointerdown", (e) => {
    const startValue = Number(getValues()[entry.name] ?? entry.default);
    const startX = e.clientX;
    let current = startValue;
    scrub.setPointerCapture(e.pointerId);
    let moved = false;
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX;
      moved = true;
      const mult = ev.ctrlKey || ev.metaKey ? 0.1 : ev.shiftKey ? 10 : 1;
      const steps = Math.trunc(dx / 4) * (isCount ? 1 : mult);
      const next = clamp(snap(startValue + steps * (isCount ? 1 : step)));
      current = next;
      // Show the moving value without committing.
      spin.textContent = isCount ? String(next) : getUnits() === "in" && entry.kind === "length" ? mmToInchText(next, entry.precision) : formatNumber(next, entry.precision);
    };
    const up = (): void => {
      scrub.removeEventListener("pointermove", move);
      scrub.removeEventListener("pointerup", up);
      scrub.removeEventListener("pointercancel", cancelled);
      if (moved) set(roundHalfEven(current, 3));
    };
    const cancelled = (): void => {
      scrub.removeEventListener("pointermove", move);
      scrub.removeEventListener("pointerup", up);
      scrub.removeEventListener("pointercancel", cancelled);
      // Put back the starting value and commit nothing.
      spin.textContent = isCount ? String(startValue) : getUnits() === "in" && entry.kind === "length" ? mmToInchText(startValue, entry.precision) : formatNumber(startValue, entry.precision);
    };
    scrub.addEventListener("pointermove", move);
    scrub.addEventListener("pointerup", up);
    scrub.addEventListener("pointercancel", cancelled);
    const escWhileDragging = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") {
        cancelled();
        window.removeEventListener("keydown", escWhileDragging);
      }
    };
    window.addEventListener("keydown", escWhileDragging);
  });
}

/** A rail disclosure group; on narrow screens only one is open. */
function makeGroup(name: string, region: HTMLElement, open: boolean, rail: HTMLElement, narrow: () => boolean): HTMLElement {
  const head = el("button", { "aria-expanded": String(open) }, t(name));
  head.innerHTML = `${name}<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" stroke="currentColor" fill="none"/></svg>`;
  const group = el("div", { class: "rail-group", "data-open": String(open) });
  region.setAttribute("data-inert", String(!open));
  group.append(head, region);
  rail.append(group);
  head.addEventListener("click", () => {
    const isOpen = group.dataset.open === "true";
    if (narrow() && !isOpen) {
      for (const other of Array.from(rail.children)) {
        (other as HTMLElement).dataset.open = "false";
        (other as HTMLElement).querySelector(".group-region")?.setAttribute("data-inert", "true");
        ((other as HTMLElement).querySelector("button") as HTMLElement).setAttribute("aria-expanded", "false");
      }
    }
    group.dataset.open = String(!isOpen);
    head.setAttribute("aria-expanded", String(!isOpen));
    region.setAttribute("data-inert", String(isOpen));
  });
  return group;
}

/** The Findings listbox: diagnostic, dropped-link row, pre-flight findings. */
class FindingsController {
  private diagnostic: { code: string; message: string; parameter: string | null } | null = null;
  private droppedText: string | null = null;
  private reportFindings: ReportResponse["findings"] = [];
  private activeIdx = 0;
  private selected = -1;
  private typeAhead = "";
  private typeAheadAt = 0;

  constructor(
    private readonly list: HTMLElement,
    private readonly gotoRow: HTMLElement,
    private readonly manifest: ManifestEntry[],
    private readonly viewportRoot: HTMLElement
  ) {
    list.addEventListener("keydown", (e) => this.onKey(e as KeyboardEvent));
    list.addEventListener("click", (e) => {
      const option = (e.target as HTMLElement).closest('[role="option"]');
      if (!option) return;
      const idx = Array.from(list.querySelectorAll('[role="option"]')).indexOf(option);
      this.activeIdx = idx;
      this.select(idx);
    });
    this.render();
  }

  setDiagnostic(d: { code: string; message: string; parameter: string | null }): void {
    this.diagnostic = d;
    this.render();
  }

  clearDiagnostic(): void {
    this.diagnostic = null;
    this.render();
  }

  setDropped(message: string): void {
    this.droppedText = message;
    this.render();
  }

  setReportFindings(findings: ReportResponse["findings"]): void {
    this.reportFindings = findings;
    this.render();
  }

  dim(on: boolean): void {
    this.list.classList.toggle("dimmed", on);
  }

  private names(): { name: string; severity: string; text: string; parameters: string[] }[] {
    const rows: { name: string; severity: string; text: string; parameters: string[] }[] = [];
    if (this.diagnostic) rows.push({ name: `Diagnostic: ${this.diagnostic.message}`, severity: "Blocking", text: this.diagnostic.message, parameters: this.diagnostic.parameter ? [this.diagnostic.parameter] : [] });
    if (this.droppedText) rows.push({ name: `Advisory: ${this.droppedText}`, severity: "Advisory", text: this.droppedText, parameters: [] });
    for (const f of this.reportFindings) rows.push({ name: `${f.severity}: ${f.message}`, severity: f.severity, text: f.message, parameters: f.parameters });
    return rows;
  }

  private render(): void {
    const rows = this.names();
    this.list.replaceChildren();
    if (rows.length === 0) {
      const empty = el("div", { class: "muted", style: "padding:10px 12px" }, t("No findings yet."));
      this.list.append(empty);
      return;
    }
    rows.forEach((row, i) => {
      const option = el("div", { role: "option", "aria-selected": String(this.selected === i), id: `finding-${i}` });
      const sev = el("span", { class: `sev sev-${row.severity}` });
      sev.innerHTML = severityIcon(row.severity);
      sev.append(t(row.severity));
      option.append(sev, el("span", { class: "option-text" }, t(row.text)));
      this.list.append(option);
    });
    if (this.activeIdx >= rows.length) this.activeIdx = Math.max(0, rows.length - 1);
    this.list.setAttribute("aria-activedescendant", `finding-${this.activeIdx}`);
    this.renderGoto();
  }

  private renderGoto(): void {
    this.gotoRow.replaceChildren();
    const rows = this.names();
    const row = rows[this.activeIdx];
    if (!row) return;
    for (const p of row.parameters) {
      const entry = this.manifest.find((m) => m.name === p && !m.derived);
      if (!entry) continue;
      const btn = el("button", {}, t(`Go to ${entry.label}`));
      btn.addEventListener("click", () => {
        const control = document.querySelector(`#ctrl-${p}`) as HTMLElement | null;
        if (control) {
          const rowEl = control.closest(".rail-group");
          rowEl?.querySelector("button")?.dispatchEvent(new Event("click"));
          control.focus();
        }
      });
      this.gotoRow.append(btn);
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    const rows = this.names();
    if (rows.length === 0) return;
    if (e.key === "ArrowDown") {
      this.activeIdx = Math.min(rows.length - 1, this.activeIdx + 1);
      e.preventDefault();
      this.render();
    } else if (e.key === "ArrowUp") {
      this.activeIdx = Math.max(0, this.activeIdx - 1);
      e.preventDefault();
      this.render();
    } else if (e.key === "Home") {
      this.activeIdx = 0;
      e.preventDefault();
      this.render();
    } else if (e.key === "End") {
      this.activeIdx = rows.length - 1;
      e.preventDefault();
      this.render();
    } else if (e.key === "Enter" || e.key === " ") {
      this.select(this.activeIdx);
      e.preventDefault();
    } else if (e.key.length === 1 && /[a-zA-Z]/.test(e.key)) {
      const now = Date.now();
      if (now - this.typeAheadAt > 500) this.typeAhead = "";
      this.typeAheadAt = now;
      this.typeAhead += e.key.toLowerCase();
      const start = this.activeIdx;
      for (let i = 1; i <= rows.length; i++) {
        const idx = (start + i) % rows.length;
        if (rows[idx]!.name.toLowerCase().startsWith(this.typeAhead)) {
          this.activeIdx = idx;
          this.render();
          break;
        }
      }
      e.preventDefault();
    }
  }

  private select(idx: number): void {
    this.selected = idx;
    const rows = this.names();
    const row = rows[idx];
    this.render();
    if (row) {
      const finding = this.reportFindings.find((f) => f.message === row.text);
      if (finding?.pose) {
        glideToPose(this.viewportRoot, finding.pose);
      }
    }
  }
}

export function severityIcon(severity: string): string {
  if (severity === "Blocking") {
    return `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="currentColor"/><path d="M7 4.5v3.5M7 9.6v.2" stroke="#0a0e16" stroke-width="1.4"/></svg>`;
  }
  if (severity === "Advisory") {
    return `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2l5 9H2z" fill="currentColor"/><path d="M7 5.5v2.5M7 9.4v.2" stroke="#0a0e16" stroke-width="1.2"/></svg>`;
  }
  return `<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
}

/** The pre-flight report region and its states (DP-28). */
class ReportController {
  readonly root: HTMLElement;
  dimFindings: ((dim: boolean) => void) | null = null;
  private state: "unrun" | "running" | "complete" | "unsupported" | "stale" = "unrun";
  private report: ReportResponse | null = null;
  private reportValues: Values | null = null;
  private reportProcess: string | null = null;

  constructor(root: HTMLElement, private readonly slug: string) {
    this.root = root;
  }

  async run(values: Values, process: string, onFindings?: (report: ReportResponse) => void): Promise<void> {
    this.state = "running";
    this.root.dataset.state = "running";
    this.root.replaceChildren(el("p", { class: "muted" }, t("Checking\u2026")));
    announce("preflight-status", `Checking against ${processLabel(process)}...`);
    try {
      const report = await api.preflight(this.slug, values, process);
      this.report = report;
      this.reportValues = { ...values };
      this.reportProcess = process;
      const staleNow = !valuesEqual(values, this.reportValues) || process !== this.reportProcess;
      this.state = staleNow ? "stale" : report.status === "unsupported" ? "unsupported" : "complete";
      this.root.dataset.state = this.state;
      this.render();
      announce("preflight-status", `Pre-flight complete: ${report.findings.filter((f) => f.severity === "Blocking").length} blocking, ${report.findings.filter((f) => f.severity === "Advisory").length} advisory.`);
      onFindings?.(report);
      bumpEpoch(this.root, `tinework:epoch:report:${this.slug}`);
      window.dispatchEvent(new CustomEvent("tinework:report-run", { detail: {} }));
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          announce("preflight-status", "Sign in to run more pre-flight reports.");
          this.state = "unrun";
          this.root.dataset.state = "unrun";
          this.root.replaceChildren(el("p", { class: "muted" }, t("Sign in to run more pre-flight reports.")));
          return;
        }
      }
      this.state = "unrun";
      this.root.dataset.state = "unrun";
      this.root.replaceChildren(el("p", { class: "muted" }, t("Pre-flight could not run.")));
    }
  }

  get currentState(): string { return this.state; }

  markStale(): void {
    if (this.state !== "running") return;
    this.state = "stale";
    this.root.dataset.state = "stale";
  }

  checkStale(values: Values, process: string): void {
    if (this.state !== "complete" && this.state !== "unsupported" && this.state !== "stale") return;
    const matches = this.reportValues !== null && valuesEqual(values, this.reportValues) && process === this.reportProcess;
    this.state = matches ? (this.report!.status === "unsupported" ? "unsupported" : "complete") : "stale";
    this.root.dataset.state = this.state;
    this.render();
    this.dimFindings?.(this.state === "stale");
  }

  private render(): void {
    const report = this.report;
    this.root.replaceChildren();
    if (!report) return;
    if (this.state === "stale") {
      this.root.append(el("div", { class: "alert", role: "alert" }, t("This report describes an earlier configuration. Run pre-flight again to update it.")));
    }
    if (report.status === "unsupported") {
      this.root.append(el("p", {}, t(report.message ?? "")));
      return;
    }
    const summary = el("ul", { class: "findings-summary", style: "list-style:none;padding:0;display:flex;flex-direction:column;gap:4px" });
    for (const f of report.findings) {
      const row = el("li", { class: "finding-row" });
      const sev = el("span", { class: `sev sev-${f.severity}` });
      sev.innerHTML = severityIcon(f.severity);
      sev.append(t(f.severity));
      row.append(sev, el("span", { class: "option-text" }, t(f.message)));
      summary.append(row);
    }
    this.root.append(summary);
    const bands = el("div", { class: "cost-bands", style: "margin-top:12px" });
    for (const band of report.costBands) {
      bands.append(el("div", { class: "muted" }, t(`Quantity ${band.quantity}: ${band.text}`)));
    }
    bands.append(el("div", { class: "muted" }, t(`Typical lead time ${processLeadTime(report.process)}`)));
    bands.append(el("div", {}, t(`Confidence: ${report.confidence ?? ""}`)));
    bands.append(el("div", { class: "muted" }, t("Estimate from geometry alone. Not a quote: no supplier has seen this part.")));
    this.root.append(bands);
  }
}

function valuesEqual(a: Values, b: Values): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

function processLabel(id: string): string {
  return PROCESSES.find((p) => p.id === id)?.label ?? id;
}

function processLeadTime(id: string): string {
  return PROCESSES.find((p) => p.id === id)?.leadTime ?? "";
}

function bboxText(bbox: number[]): string {
  return bbox.map((n) => formatNumber(n, 2)).join(" \u00d7 ") + "\u202Fmm";
}

function writeConfigAddress(slug: string, values: Values, defaults: Values, revision?: string): void {
  void slug;
  const cfg = configText(values, defaults);
  const params = new URLSearchParams();
  if (revision) params.set("revision", revision);
  params.set("config", cfg);
  const url = `${location.pathname}?${params.toString()}`;
  history.replaceState(null, "", url);
}

function configText(values: Values, defaults: Values): string {
  const out: string[] = [];
  for (const name of Object.keys(values).sort()) {
    if (values[name] === defaults[name]) continue;
    const v = values[name];
    if (typeof v === "number") out.push(`${name}=${String(v)}`);
    else if (typeof v === "boolean") out.push(`${name}=${v}`);
    else out.push(`${name}=${v}`);
  }
  return out.join(",");
}

function removeParam(name: string): void {
  const params = new URLSearchParams(location.search);
  params.delete(name);
  const qs = params.toString();
  history.replaceState(null, "", qs ? `${location.pathname}?${qs}` : location.pathname);
}

export function mintKey(kind: string): string {
  return `${kind}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/** Open a modal dialog; Tab cycles inside, Escape closes, focus returns. */
export function openDialog(title: string, build: (close: () => void) => HTMLElement): { close: () => void; dialog: HTMLElement } {
  const backdrop = el("div", { class: "dialog-backdrop" });
  const dialog = el("div", { role: "dialog", "aria-label": title });
  const h = el("h2", {}, t(title));
  dialog.append(h);
  let closed = false;
  const opener = document.activeElement as HTMLElement | null;
  const close = (): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.body.classList.remove("dialog-open");
    const target = opener?.isConnected ? opener : document.getElementById("main");
    target?.focus();
  };
  const body = build(close);
  dialog.append(body);
  backdrop.append(dialog);
  document.getElementById("dialog-root")!.append(backdrop);
  document.body.classList.add("dialog-open");
  const firstField = dialog.querySelector("input, textarea, select") as HTMLElement | null;
  (firstField ?? (dialog.querySelector("button") as HTMLElement)).focus();
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")).filter((n) => !n.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const idx = focusables.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && (idx <= 0)) {
        focusables[focusables.length - 1]!.focus();
        e.preventDefault();
      } else if (!e.shiftKey && idx === focusables.length - 1) {
        focusables[0]!.focus();
        e.preventDefault();
      }
    }
  });
  return { close, dialog };
}

function showFieldErrors(dialog: HTMLElement, errors: Record<string, string>): void {
  for (const [field, message] of Object.entries(errors)) {
    const input = dialog.querySelector(`[aria-label="${field}"]`) as HTMLElement | null;
    if (input) {
      input.setAttribute("aria-invalid", "true");
      let errNode = input.parentElement?.querySelector(".field-error") as HTMLElement | null;
      if (!errNode) {
        errNode = el("div", { class: "field-error" }, t(message));
        input.parentElement?.append(errNode);
      } else {
        errNode.textContent = message;
      }
    }
  }
}

/** The tape slider and its stored snapshots. */
class TapeController {
  private ops: { index: number; kind: string; op: string; line: number | null; digest: string; volume: number; delta: number; bbox: number[] }[] = [];
  n = 0;
  currentOp = 0;
  private solidCache = new Map<string, Solid>();

  constructor(
    private readonly slider: HTMLElement,
    private readonly readout: HTMLElement,
    private readonly disabledLine: HTMLElement,
    private readonly forkBtn: HTMLElement,
    private readonly viewportRoot: HTMLElement,
    private readonly slug: string,
    private readonly part: PartResponse,
    private readonly values: Values,
    private readonly onPaint: () => void
  ) {}

  async load(revisionId: string): Promise<void> {
    const tape = await api.tape(revisionId);
    void this.disabledLine; void this.viewportRoot; void this.slug; void this.part; void this.onPaint;
    this.ops = tape.operations;
    this.n = tape.n;
    this.slider.setAttribute("aria-valuemax", String(this.n));
    this.slider.setAttribute("aria-valuenow", String(this.n));
    this.renderTicks();
    this.moveTo(this.n, this.values);
    this.readout.textContent = this.readoutText(this.n);
    // Fork control (owner only, at or after the body).
    const bodyIndex = this.ops.findIndex((o) => o.kind === "body");
    if (bodyIndex !== -1) {
      this.forkBtn.textContent = `Fork from operation ${this.n}`;
      this.forkBtn.removeAttribute("hidden");
      (this.forkBtn as HTMLButtonElement).dataset.op = String(this.n);
    }
  }

  private renderTicks(): void {
    const inner = el("div", { class: "tape-track" });
    inner.style.position = "absolute";
    inner.style.inset = "8px 0";
    for (let i = 0; i <= this.n; i++) {
      const tick = el("div", { class: "tick" });
      tick.style.left = `${(i / Math.max(1, this.n)) * 100}%`;
      inner.append(tick);
    }
    const playhead = el("div", { class: "playhead" });
    playhead.style.left = "100%";
    inner.append(playhead);
    this.slider.replaceChildren(inner);
  }

  readoutText(k: number): string {
    const op = this.ops[k];
    if (!op) return "";
    if (op.kind === "start") return `Operation 0 of ${this.n} \u00b7 empty`;
    if (op.kind === "params") return `Operation ${k} of ${this.n} \u00b7 ${op.op}`;
    const change = op.delta / 1000;
    const sign = change > 0 ? "+" : change < 0 ? "\u2212" : "\u00b1";
    return `Operation ${k} of ${this.n} \u00b7 ${op.op} \u00b7 ${sign}${formatNumber(Math.abs(change), 2, { exact: true })} cm\u00b3`;
  }

  async moveTo(k: number, values: Values): Promise<void> {
    void values;
    this.currentOp = k;
    this.slider.setAttribute("aria-valuenow", String(k));
    const playhead = this.slider.querySelector(".playhead") as HTMLElement | null;
    if (playhead) playhead.style.left = `${(k / Math.max(1, this.n)) * 100}%`;
    this.slider.setAttribute("aria-valuetext", `Operation ${k} of ${this.n} \u00b7 ${this.ops[k]?.kind ?? "start"} \u00b7 ${this.ops[k]?.op ?? "empty"}`);
    this.readout.textContent = this.readoutText(k);
    const op = this.ops[k];
    if (op) {
      // Highlight and scroll the source line.
      document.querySelectorAll(".source-line[aria-current]").forEach((n) => n.removeAttribute("aria-current"));
      const lineEl = document.querySelector(`.source-line[data-line="${op.line}"]`);
      lineEl?.setAttribute("aria-current", "true");
      lineEl?.scrollIntoView({ block: "nearest" });
      // Fetch the stored solid by digest and draw it (never a recomputation).
      const solid = await this.fetchSolid(op.digest);
      if (solid) {
        window.dispatchEvent(new CustomEvent("tinework:tape-solid", { detail: { solid, op } }));
      }
    }
  }

  private async fetchSolid(digest: string): Promise<Solid | null> {
    if (this.solidCache.has(digest)) return this.solidCache.get(digest)!;
    try {
      const res = await fetch(`/api/solids/${digest}`, { credentials: "same-origin" });
      if (!res.ok) return null;
      const solid = await res.json() as Solid;
      this.solidCache.set(digest, solid);
      return solid;
    } catch {
      return null;
    }
  }

  returnToLive(): void {
    // A commit returns the viewport to the live configuration.
    this.slider.setAttribute("aria-valuenow", String(this.n));
    const playhead = this.slider.querySelector(".playhead") as HTMLElement | null;
    if (playhead) playhead.style.left = "100%";
    this.currentOp = this.n;
    this.readout.textContent = this.readoutText(this.n);
  }
}

/** The roving-tabindex toolbar: one Tab stop, arrow keys move. */
function setupToolbarRoving(toolbar: HTMLElement, items: HTMLElement[]): void {
  let active = 0;
  const update = (): void => {
    items.forEach((item, i) => {
      item.setAttribute("tabindex", i === active ? "0" : "-1");
    });
  };
  update();
  toolbar.addEventListener("keydown", (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === "ArrowRight") {
      active = Math.min(items.length - 1, active + 1);
      items[active]!.focus();
      ke.preventDefault();
    } else if (ke.key === "ArrowLeft") {
      active = Math.max(0, active - 1);
      items[active]!.focus();
      ke.preventDefault();
    } else if (ke.key === "Home") {
      active = 0;
      items[0]!.focus();
      ke.preventDefault();
    } else if (ke.key === "End") {
      active = items.length - 1;
      items[items.length - 1]!.focus();
      ke.preventDefault();
    }
  });
  toolbar.addEventListener("focusin", (e) => {
    const idx = items.indexOf(e.target as HTMLElement);
    if (idx !== -1) active = idx;
  });
}

/** Signed-out like button: tooltip on hover or focus. */
function bindLikeTooltip(btn: HTMLElement): void {
  let tip: HTMLElement | null = null;
  const show = (): void => {
    if (tip) return;
    tip = el("div", { class: "tooltip", role: "tooltip" }, t("Sign in to like parts"));
    document.body.append(tip);
    const r = btn.getBoundingClientRect();
    (tip as HTMLElement).style.left = `${r.left}px`;
    (tip as HTMLElement).style.top = `${r.bottom + 8}px`;
  };
  const hide = (): void => {
    tip?.remove();
    tip = null;
  };
  btn.addEventListener("mouseenter", show);
  btn.addEventListener("mouseleave", hide);
  btn.addEventListener("focus", show);
  btn.addEventListener("blur", hide);
}

/** Download an archive as a navigation. */
function downloadArchive(slug: string, revisionId: string, kind: "zip" | "tar"): void {
  void slug;
  const a = document.createElement("a");
  a.href = `/api/revisions/${revisionId}/archive.${kind}`;
  a.download = "";
  document.body.append(a);
  a.click();
  a.remove();
}

/** The conflict alert (DP-41) and the draft (DP-63). */
async function showConflict(slug: string, body: { headRevisionId: string; head: { id: string; label: string; values: Values } }, knownValues: Values, manifest: ManifestEntry[]): Promise<void> {
  const alert = el("div", { class: "alert", role: "alert" });
  alert.append(el("p", {}, t(`This part changed since you opened it. ${body.head.label} is now the latest revision.`)));
  const list = el("ul", { "aria-label": `Changes in ${body.head.label}` });
  // One parameter change line per parameter whose value differs between the
  // page's known head (before) and the new head (after), in declaration order.
  const changes: string[] = [];
  for (const entry of manifest) {
    if (entry.derived) continue;
    const before = knownValues[entry.name];
    const after = body.head.values[entry.name];
    if (before !== after) {
      changes.push(parameterChangeLine(entry, before, after));
    }
  }
  if (changes.length === 0) {
    list.append(el("li", {}, t("No parameter changes.")));
  } else {
    for (const line of changes) {
      list.append(el("li", {}, t(line)));
    }
  }
  alert.append(list);
  const openBtn = el("button", {}, t(`Open ${body.head.label}`));
  const keepBtn = el("button", {}, t(`Keep my values on ${body.head.label}`));
  const actions = el("div", { class: "alert-actions" }, openBtn, keepBtn);
  alert.append(actions);
  document.getElementById("app")!.prepend(alert);
  openBtn.addEventListener("click", () => {
    clearDraft(slug);
    location.href = `/parts/${slug}?revision=${body.headRevisionId}`;
  });
  keepBtn.addEventListener("click", () => {
    alert.remove();
    announce("part-activity", `Your values now build on ${body.head.label}.`);
    sessionStorage.setItem(`tinework:known-head:${slug}`, body.headRevisionId);
  });
}

function parameterChangeLine(entry: ManifestEntry, before: unknown, after: unknown): string {
  const fmt = (v: unknown): string => {
    if (typeof v === "number") return formatNumber(v, entry.precision);
    return String(v);
  };
  const unit = entry.kind === "length" ? " mm" : entry.kind === "angle" ? " \u00b0" : "";
  return `${entry.label}: ${fmt(before)} \u2192 ${fmt(after)}${unit}`;
}

function clearDraft(slug: string): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(`tinework:draft:${slug}:`)) localStorage.removeItem(key);
  }
}

/** Bump a painted epoch under its sessionStorage key (H5). */
export function bumpEpoch(root: HTMLElement, key: string): void {
  const next = Number(sessionStorage.getItem(key) ?? "0") + 1;
  sessionStorage.setItem(key, String(next));
  root.dataset.epoch = String(next);
}

/** Glide the camera to a pose; reduced motion applies it in one frame. */
export function glideToPose(viewportRoot: HTMLElement, pose: { position: number[]; target: number[]; up: number[]; fov: number }): void {
  viewportRoot.dispatchEvent(new CustomEvent("tinework:glide", { detail: pose }));
}

/** Open a resumable event stream for one part. */
export function openEventStream(slug: string, onEvent: (event: { type: string; data: Record<string, unknown> }) => void): void {
  let lastId = sessionStorage.getItem(`tinework:stream:${slug}`) ?? "";
  let es: EventSource | null = null;
  const connect = (): void => {
    const url = lastId ? `/api/events?parts=${encodeURIComponent(slug)}&lastId=${encodeURIComponent(lastId)}` : `/api/events?parts=${encodeURIComponent(slug)}`;
    es = new EventSource(url);
    for (const type of ["revision", "comment", "approvals", "like"]) {
      es.addEventListener(type, (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as Record<string, unknown>;
        const id = (ev as MessageEvent).lastEventId;
        if (id) {
          lastId = id;
          sessionStorage.setItem(`tinework:stream:${slug}`, id);
        }
        onEvent({ type, data });
      });
    }
    es.addEventListener("error", () => {
      es?.close();
      setTimeout(connect, 1000);
    });
  };
  connect();
}
