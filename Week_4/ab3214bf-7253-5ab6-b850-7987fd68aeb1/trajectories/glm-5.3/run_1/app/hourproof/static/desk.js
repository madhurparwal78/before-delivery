/* Window desk: score panel, Break the Month, Hour Wall, actions. */
"use strict";

const GRAINS = ["month", "week", "day", "hour"];
const GRAIN_CAPS = { month: "MONTH", week: "WEEK", day: "DAY", hour: "HOUR" };
const GRAIN_LABEL = { month: "Month", week: "Week", day: "Day", hour: "Hour" };

function statusRegions() {
  const deskStatus = el("div", { role: "status", "aria-label": "Desk status" });
  const deskAlert = el("div", { role: "alert", "aria-label": "Desk alert" });
  return { deskStatus, deskAlert };
}

function announce(region, text) {
  region.replaceChildren(document.createTextNode(text));
}

async function renderWindowDesk(windowId) {
  let win = null;
  try { win = await api("GET", `/api/windows/${windowId}`); }
  catch (err) { return renderNotFound(); }
  const { deskStatus, deskAlert } = statusRegions();
  const region = el("section", { "aria-label": "Window desk", class: "window-desk" });

  const scorePanel = el("section", { "aria-label": "Score panel", "data-phase": "settled", class: "score-panel" });
  const grainStatus = el("div", { role: "status", "aria-label": "Grain score" });
  const slider = grainSlider(windowId, win, scorePanel, grainStatus);

  const wallRegion = el("section", { "aria-label": "Hour Wall", class: "hour-wall", hidden: true });
  const bucketsList = el("ul", { "aria-label": "Buckets", class: "buckets" });

  const actions = el("section", { "aria-label": "Window actions", class: "window-actions" });

  const state = { window: win, grain: currentGrain(), hourDetail: null, selection: new Set(),
                  anchor: null, lastRevisionSeen: win.revision, wallFocus: null };

  region.append(scorePanel, slider, grainStatus, bucketsList, wallRegion, actions);

  // window action buttons, shown only in a state that permits them
  const buttons = {};
  const mk = (name, handler) => {
    const btn = el("button", { id: nextId(), text: name });
    btn.addEventListener("click", handler);
    buttons[name] = btn;
    actions.append(btn);
    return btn;
  };
  const pullBtn = mk("Pull meters", () => pullMeters(state, deskStatus, deskAlert));
  const repairBtn = mk("Repair gaps", () => repairGaps(state, deskStatus, deskAlert));
  const spreadBtn = mk("Spread a total", () => openSpreadDialog(state, deskStatus));
  mk("Rerun allocation", () => rerunAllocation(state, deskStatus));
  mk("Sync holdings", () => syncHoldings(state, deskStatus, deskAlert));
  const submitBtn = mk("Submit for review", () => submitWindow(state, deskStatus, deskAlert));
  const resumeBtn = mk("Resume reconciling", () => resumeWindow(state, deskStatus));
  mk("Cancel certificates", () => cancelCertificates(state, deskStatus, deskAlert));
  actions.append(link("Lots", `/windows/${windowId}/lots`), link("Ledger", `/windows/${windowId}/ledger`));

  async function refresh() {
    if (refreshPaused) return;
    try {
      const fresh = await api("GET", `/api/windows/${windowId}`);
      if (fresh.revision > state.lastRevisionSeen) {
        const wasRevision = state.lastRevisionSeen;
        state.lastRevisionSeen = fresh.revision;
        await repaint(fresh);
        if (fresh.last_writer_name && fresh.last_writer_name !== ME.name) {
          announce(deskStatus, `${fresh.last_writer_name} changed this window. Hour score ${pct(fresh.scores.hour_bp)} percent.`);
        }
      } else {
        await repaint(fresh);
      }
    } catch (err) {
      if (err.status === 404) { renderNotFound(); }
    }
  }
  async function repaint(fresh) {
    state.window = fresh;
    drawScorePanel(state);
    paintActions(state);
    if (state.grain === "hour") await drawWall(state);
    else await drawBuckets(state, bucketsList);
    updateTimerRow(fresh);
  }
  window.__refresh = refresh;
  setInterval(refresh, 5000);

  await repaint(win);
  land(deskShell(region, `/windows/${windowId}`));
  if (state.grain === "hour") await drawWall(state); else await drawBuckets(state, bucketsList);
  await loadGrain(state, scorePanel, grainStatus, state.grain);
  openHourFromAddress(state);
}

function currentGrain() {
  const value = new URLSearchParams(location.search).get("grain");
  return GRAINS.includes(value) ? value : "month";
}

/* --- Break the Month slider ---------------------------------------------- */
function grainSlider(windowId, win, scorePanel, grainStatus) {
  const slider = el("input", {
    type: "range", min: "0", max: "3", step: "1", value: String(GRAINS.indexOf(currentGrain())),
    role: "slider", "aria-label": "Break the Month", class: "grain-slider",
  });
  slider.setAttribute("aria-valuetext", GRAIN_CAPS[currentGrain()]);
  slider.setAttribute("aria-valuemin", "0");
  slider.setAttribute("aria-valuemax", "3");
  slider.setAttribute("aria-valuenow", String(GRAINS.indexOf(currentGrain())));
  let settled = currentGrain();
  slider.addEventListener("input", () => {
    const target = GRAINS[Number(slider.value)];
    setGrain(target, win.id, scorePanel, grainStatus, slider);
  });
  slider.dataset.settled = settled;
  return slider;
}

let highestRevisionSeen = 0;
async function setGrain(target, windowId, scorePanel, grainStatus, slider) {
  const url = new URL(location.href);
  url.searchParams.set("grain", target);
  history.replaceState({}, "", url);
  slider.setAttribute("aria-valuetext", GRAIN_CAPS[target]);
  slider.setAttribute("aria-valuenow", String(GRAINS.indexOf(target)));
  try {
    const reply = await api("GET", `/api/windows/${windowId}/grains/${target}`);
    if (reply.revision < highestRevisionSeen) {
      // discard and ask once more
      const again = await api("GET", `/api/windows/${windowId}/grains/${target}`);
      return applyGrainReply(again, target, scorePanel, grainStatus, slider);
    }
    highestRevisionSeen = Math.max(highestRevisionSeen, reply.revision);
    applyGrainReply(reply, target, scorePanel, grainStatus, slider);
  } catch (err) {
    if (err.status >= 500) {
      const previous = GRAINS.indexOf(slider.dataset.settled);
      slider.value = String(previous);
      scorePanel.dataset.phase = "settled";
      const failure = el("div", { class: "grain-failure", text: "THAT GRAIN DID NOT LOAD. MOVE AGAIN." });
      scorePanel.append(failure);
    }
  }
}

function applyGrainReply(reply, target, scorePanel, grainStatus, slider) {
  scorePanel.dataset.phase = "settled";
  drawBlocks(scorePanel, reply, target);
  const numeral = scorePanel.querySelector("[data-score-numeral]");
  if (numeral) numeral.textContent = `${bpPct(reply.score_bp)}%`;
  const month = reply.monthScore !== undefined ? reply.monthScore : window.__monthScore || 0;
  const points = Math.max(0, (window.__monthScore || reply.score_bp) - reply.score_bp);
  announce(grainStatus,
    `${GRAIN_LABEL[target]} grain. ${pct(reply.score_bp)} percent matched. ${pct(points)} points gone since month.`);
  slider.dataset.settled = target;
  const bucketsList = document.querySelector('[aria-label="Buckets"]');
  if (bucketsList) { bucketsList.replaceChildren(); }
}

function drawBlocks(panel, reply, grain) {
  const area = panel.querySelector("[data-block-area]") || el("div", { class: "block-area", "data-block-area": "" });
  area.replaceChildren();
  const max = Math.max(...reply.buckets.map((b) => (b.consumed_wh || 0) + (b.surplus_wh || 0)), 1);
  for (const bucket of reply.buckets) {
    const block = el("div", {
      class: "block", "data-bucket-key": bucket.key,
      "data-matched-wh": bucket.matched_wh, "data-consumed-wh": bucket.consumed_wh,
      "data-surplus-wh": bucket.surplus_wh,
    });
    const matchedH = (bucket.matched_wh / max) * 100;
    const surplusH = (bucket.surplus_wh / max) * 100;
    block.append(el("div", { class: "block-matched", "data-block-part": "matched",
                             style: `height:${matchedH}%` }));
    block.append(el("div", { class: "block-surplus", "data-block-part": "surplus",
                             style: `height:${surplusH}%` }));
    area.append(block);
  }
  if (!panel.contains(area)) panel.append(area);
  if (!panel.querySelector("[data-score-numeral]")) {
    panel.append(el("div", { class: "score-numeral", "data-score-numeral": "", text: "COUNTING" }));
  }
}
