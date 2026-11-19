/* Analyst actions on a window, with the published announcement copy. */
"use strict";

async function pullMeters(state, deskStatus, deskAlert) {
  const btn = findAction("Pull meters");
  setPending(btn);
  try {
    const result = await api("POST", `/api/windows/${state.window.id}/meters/pull`,
      { revision: state.window.revision });
    state.window = result;
    announce(deskStatus, `Pull done. ${result.missing_hours === 0 ? 0 : result.missing_hours} hours still Missing.`);
    await repaintAll(state);
  } catch (err) {
    handleActionError(err, deskAlert, btn);
  } finally { clearPending(btn); }
}

async function repairGaps(state, deskStatus, deskAlert) {
  const btn = findAction("Repair gaps");
  setPending(btn);
  try {
    const result = await api("POST", `/api/windows/${state.window.id}/gaps/repair`,
      { revision: state.window.revision });
    announce(deskStatus,
      `Repair done. ${result.filled.length} hours filled. ${result.unfilled.length} hours still Missing.`);
    announce(deskStatus, `Allocation done. Hour score ${pct(result.window.scores.hour_bp)} percent. ${result.window.unmatched_hours} unmatched hours.`);
    state.window = result.window;
    await repaintAll(state);
  } catch (err) {
    handleActionError(err, deskAlert, btn);
  } finally { clearPending(btn); }
}

async function rerunAllocation(state, deskStatus) {
  const btn = findAction("Rerun allocation");
  setPending(btn);
  try {
    const result = await api("POST", `/api/windows/${state.window.id}/allocation`,
      { revision: state.window.revision });
    announce(deskStatus,
      `Allocation done. Hour score ${pct(result.window.scores.hour_bp)} percent. ${result.window.unmatched_hours} unmatched hours.`);
    state.window = result.window;
    await repaintAll(state);
  } catch (err) {
    handleActionError(err, null, btn);
  } finally { clearPending(btn); }
}

async function syncHoldings(state, deskStatus, deskAlert) {
  const btn = findAction("Sync holdings");
  setPending(btn);
  try {
    const result = await api("POST", `/api/windows/${state.window.id}/holdings/sync`,
      { revision: state.window.revision });
    if (result.held_elsewhere.length) {
      announce(deskStatus, `${result.held_elsewhere.length} bundles are held by another window.`);
    }
    announce(deskStatus,
      `Allocation done. Hour score ${pct(result.window.scores.hour_bp)} percent. ${result.window.unmatched_hours} unmatched hours.`);
    state.window = result.window;
    await repaintAll(state);
  } catch (err) {
    handleActionError(err, deskAlert, btn);
  } finally { clearPending(btn); }
}

async function submitWindow(state, deskStatus, deskAlert) {
  const btn = findAction("Submit for review");
  setPending(btn);
  try {
    const result = await api("POST", `/api/windows/${state.window.id}/submit`,
      { revision: state.window.revision });
    announce(deskStatus, "Sent for review. The verifier has 25 hours to test.");
    state.window = result;
    await repaintAll(state);
  } catch (err) {
    handleActionError(err, deskAlert, btn);
  } finally { clearPending(btn); }
}

async function resumeWindow(state, deskStatus) {
  const btn = findAction("Resume reconciling");
  setPending(btn);
  try {
    const result = await api("POST", `/api/windows/${state.window.id}/resume`,
      { revision: state.window.revision });
    state.window = result;
    await repaintAll(state);
  } catch (err) {
    handleActionError(err, null, btn);
  } finally { clearPending(btn); }
}

async function cancelCertificates(state, deskStatus, deskAlert) {
  const btn = findAction("Cancel certificates");
  setPending(btn);
  try {
    const result = await api("POST", `/api/windows/${state.window.id}/cancellations`, {});
    announce(deskStatus, "Sent to the registry. Lots read Cancelled once it confirms.");
    state.window = result.window;
    await repaintAll(state);
  } catch (err) {
    handleActionError(err, deskAlert, btn);
  } finally { clearPending(btn); }
}

function findAction(name) {
  return Array.from(document.querySelectorAll("button"))
    .find((b) => b.textContent === name);
}

function setPending(btn) {
  if (btn) { btn.setAttribute("aria-disabled", "true"); btn.dataset.pending = "1"; }
}

function clearPending(btn) {
  if (btn) { btn.removeAttribute("aria-disabled"); delete btn.dataset.pending; }
}

function handleActionError(err, deskAlert, btn) {
  if (err.status === 409 && err.code === "STALE_REVISION") {
    const region = document.querySelector('[role="status"][aria-label="Desk status"]');
    if (region) announce(region, err.message);
    return;
  }
  if (err.status === 503) {
    const region = deskAlert || document.querySelector('[role="alert"][aria-label="Desk alert"]');
    if (region) announce(region, err.message);
    return;
  }
  if (err.fields && Object.keys(err.fields).length) {
    const region = deskAlert || document.querySelector('[role="alert"][aria-label="Desk alert"]');
    if (region) announce(region, Object.values(err.fields)[0]);
    return;
  }
  const region = deskAlert || document.querySelector('[role="alert"][aria-label="Desk alert"]');
  if (region) announce(region, err.message);
}

async function repaintAll(state) {
  const fresh = await api("GET", `/api/windows/${state.window.id}`);
  state.window = fresh;
  const panel = document.querySelector('[aria-label="Score panel"]');
  const grainStatus = document.querySelector('[role="status"][aria-label="Grain score"]');
  window.__monthScore = fresh.scores.month_bp;
  if (state.grain === "hour") await drawWall(state);
  else await drawBuckets(state, document.querySelector('[aria-label="Buckets"]'));
  paintActions({ window: fresh });
  const head = document.querySelector(".window-head");
  if (head) head.replaceChildren(...windowHeadNodes(fresh));
}

function paintActions(state) {
  const win = state.window;
  const show = {
    "Pull meters": win.state === "Awaiting meters" || win.state === "Reconciling",
    "Repair gaps": win.state === "Reconciling",
    "Spread a total": win.state === "Reconciling" && state.selection && state.selection.size >= 2,
    "Rerun allocation": win.state === "Reconciling",
    "Sync holdings": win.state === "Reconciling",
    "Submit for review": win.state === "Reconciling",
    "Resume reconciling": win.state === "Returned",
    "Cancel certificates": win.state === "Cancelling",
  };
  for (const [name, visible] of Object.entries(show)) {
    const btn = findAction(name);
    if (btn) btn.hidden = !visible;
  }
}

function windowHeadNodes(win) {
  const nodes = [
    el("h1", { text: `${win.site.name} ${win.month}` }),
    el("div", { class: "state-word", text: win.state }),
  ];
  const facts = el("div", { class: "window-facts" });
  facts.append(el("span", { text: `Missing hours ${win.missing_hours}` }));
  facts.append(el("span", { text: `Unmatched ${fmtThousands(win.unmatched_wh)} Wh` }));
  facts.append(el("span", { text: `Unmatched hours ${win.unmatched_hours}` }));
  facts.append(el("span", { text: `Residual ${win.residual_emissions_g === null ? "unknown" : fmtThousands(win.residual_emissions_g)} g CO2` }));
  if (["Cancelling", "Cancelled", "Signed", "Sealed", "Restated"].includes(win.state)) {
    facts.append(el("span", { text: `Confirmed ${win.lines_confirmed} of ${win.lines_total} lines` }));
  }
  nodes.push(facts);
  return nodes;
}

function updateTimerRow(win) { /* handled by render */ }
