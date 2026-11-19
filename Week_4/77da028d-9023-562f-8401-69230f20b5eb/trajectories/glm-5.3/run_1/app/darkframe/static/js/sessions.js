/* The Sessions screen, the session editor, batches, frames, locks. */

import {
  api, announce, duration, paintVerdictCard, openDialog, closeDialog, wireDialog,
  el, showFieldErrors, startTonightRefresh,
  readKey,
} from "./app.js";

let sessions = [];
let currentSession = null;
let lockToken = null;
let lockTimer = null;
let lockExpiresAt = null;

const $ = (id) => document.getElementById(id);

async function boot() {
  readKey();
  import("/static/js/chrome.js").then(({ wireLockButton }) => wireLockButton());
  refreshTonight();
  startTonightRefresh(refreshTonight);
  await loadSessions();
  wireNewSession();
  wireEditor();
  wireBatchDialog();
  $("show-trashed").addEventListener("change", loadSessions);
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "n" && !document.querySelector("dialog[open]")) {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      event.preventDefault();
      $("new-session").click();
    }
  });
}

async function refreshTonight() {
  try {
    const plan = await api("GET", "/api/tonight");
    paintVerdictCard($("tonight-verdict"), plan);
  } catch (err) {
    /* keep the last figures */
  }
}

async function loadSessions() {
  const includeTrashed = $("show-trashed").checked ? "?include_trashed=true" : "";
  const body = await api("GET", `/api/sessions${includeTrashed}`);
  sessions = body.sessions;
  paintSessions();
}

function paintSessions() {
  const tbody = $("sessions-tbody");
  const cards = $("session-cards");
  tbody.textContent = "";
  cards.textContent = "";
  sessions.forEach((s) => {
    const open = el("button", {
      class: "btn ghost",
      type: "button",
      "aria-label": `Open session ${s.observing_date} ${s.project_name}`,
      text: `${s.observing_date} · ${s.project_name}`,
    });
    open.addEventListener("click", () => openEditor(s));
    const tr = el("tr");
    tr.append(
      el("td", { text: s.observing_date }),
      el("td", { text: s.project_name }),
      el("td", { text: s.state }),
      el("td", { class: "num", text: duration(s.integration_seconds) }),
      el("td", { class: "num", text: String(s.frame_count) })
    );
    tr.querySelector = undefined;
    const actionCell = el("td", {});
    actionCell.appendChild(open);
    tr.appendChild(actionCell);
    tbody.appendChild(tr);

    const card = el("div", { class: "card", role: "listitem" });
    card.append(open.cloneNode(true));
    card.append(el("p", { class: "num", text: `${s.state} · ${duration(s.integration_seconds)} · ${s.frame_count} frames` }));
    cards.appendChild(card);
  });
}

function wireNewSession() {
  const dialog = $("new-session-dialog");
  wireDialog(dialog);
  $("new-session").addEventListener("click", async () => {
    const select = $("session-project");
    select.textContent = "";
    try {
      const { projects } = await api("GET", "/api/projects");
      projects.filter((p) => p.state === "active").forEach((p) => {
        select.appendChild(el("option", { value: p.id, text: p.name }));
      });
    } catch (err) {
      /* open anyway */
    }
    openDialog(dialog, $("new-session"));
  });
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const session = await api("POST", "/api/sessions", {
        project_id: $("session-project").value,
        observing_date: $("session-date").value.trim(),
        notes: "",
      });
      closeDialog(dialog);
      await loadSessions();
      announce("session-log", `Session created for ${session.observing_date}.`);
    } catch (err) {
      if (err.fields) showFieldErrors("error-summary", err.fields);
      else announce("session-log", err.message);
    }
  });
}

async function openEditor(session) {
  currentSession = session;
  const dialog = $("session-editor");
  wireDialog(dialog);
  $("session-notes").value = session.notes || "";
  $("started-at").value = session.started_at ? localStamp(session.started_at) : "";
  paintBatches();
  paintEditorButtons();
  await takeLock();
  openDialog(dialog, document.activeElement);
}

function localStamp(iso) {
  return iso.replace("T", " ").slice(0, 16);
}

function paintBatches() {
  const host = $("editor-batches");
  host.textContent = "";
  (currentSession.batches || []).forEach((b, index) => {
    const n = index + 1;
    const wrap = el("div", { class: "card", style: "margin: 8px 0;" });
    wrap.appendChild(el("p", { class: "num", text: `${b.filter} · ${b.sub_count} subs × ${b.exposure_s} s = ${duration(b.integration_seconds)}` }));
    wrap.appendChild(el("p", { class: "num", text: `${b.camera} · gain ${b.gain} · offset ${b.offset} · ${b.temperature_c} °C · bin ${b.binning} · ${b.frame_count} frames` }));
    const calibrate = el("button", { class: "btn", type: "button", text: `Calibrate ${b.filter} batch ${n}`, "aria-label": `Calibrate ${b.filter} batch ${n}` });
    calibrate.addEventListener("click", () => openCalibration(b));
    wrap.appendChild(calibrate);
    host.appendChild(wrap);
  });
}

function paintEditorButtons() {
  const state = currentSession.state;
  $("start-imaging").hidden = state !== "planned";
  $("log-batch").hidden = state !== "imaging";
  $("finish-log").hidden = state !== "imaging";
  $("amend-session").hidden = !(state === "logged" || state === "amended");
  $("trash-session").hidden = !["planned", "logged", "amended"].includes(state);
  $("restore-session").hidden = state !== "trashed";
}

async function takeLock() {
  try {
    const body = await api("POST", `/api/sessions/${currentSession.id}/lock`, lockToken ? { lock_token: lockToken } : {});
    lockToken = body.lock_token;
    lockExpiresAt = new Date(body.expires_at);
    if (lockTimer) clearTimeout(lockTimer);
    lockTimer = setTimeout(() => {
      announce("session-log-editor", "Your edit lock expired. Your notes are kept; save to take the lock again.");
    }, Math.max(1000, body.expires_in_seconds * 1000));
  } catch (err) {
    if (err.code === "session_locked") {
      announce("session-log-editor", "This session is open for editing on another device.");
    }
  }
}

function wireEditor() {
  $("close-editor").addEventListener("click", () => {
    closeDialog($("session-editor"));
    api("DELETE", `/api/sessions/${currentSession.id}/lock`, { lock_token: lockToken }).catch(() => {});
  });
  $("save-notes").addEventListener("click", () => saveNotes());
  $("start-imaging").addEventListener("click", async () => {
    try {
      const body = {};
      const value = $("started-at").value.trim();
      if (value) body.started_at = value;
      currentSession = await api("POST", `/api/sessions/${currentSession.id}/start`, body);
      paintBatches();
      paintEditorButtons();
      announce("session-log-editor", `Imaging started. Night of ${currentSession.observing_date}.`);
    } catch (err) {
      announce("session-log-editor", err.message);
    }
  });
  $("finish-log").addEventListener("click", async () => {
    try {
      currentSession = await api("POST", `/api/sessions/${currentSession.id}/log`, {});
      paintBatches();
      paintEditorButtons();
      announce("session-log-editor", `Session logged: ${duration(currentSession.integration_seconds)} integrated.`);
      await loadSessions();
    } catch (err) {
      announce("session-log-editor", err.message);
    }
  });
  $("amend-session").addEventListener("click", openAmend);
  $("trash-session").addEventListener("click", async () => {
    try {
      currentSession = await api("POST", `/api/sessions/${currentSession.id}/trash`, {});
      paintBatches();
      paintEditorButtons();
      announce("session-log-editor", "Session moved to trash.");
      await loadSessions();
    } catch (err) {
      announce("session-log-editor", err.message);
    }
  });
  $("restore-session").addEventListener("click", async () => {
    try {
      currentSession = await api("POST", `/api/sessions/${currentSession.id}/restore`, {});
      paintBatches();
      paintEditorButtons();
      announce("session-log-editor", "Session restored.");
      await loadSessions();
    } catch (err) {
      announce("session-log-editor", err.message);
    }
  });
  $("upload-frames").addEventListener("click", () => $("frame-files").click());
  $("frame-files").addEventListener("change", uploadFrames);
}

async function saveNotes() {
  const notes = $("session-notes").value;
  try {
    currentSession = await api("PATCH", `/api/sessions/${currentSession.id}/notes`, { notes, lock_token: lockToken });
    announce("session-log-editor", "Notes saved.");
  } catch (err) {
    if (err.code === "lock_expired") {
      announce("session-log-editor", "Your edit lock expired. Your notes are kept; save to take the lock again.");
      await takeLock();
      try {
        currentSession = await api("PATCH", `/api/sessions/${currentSession.id}/notes`, { notes, lock_token: lockToken });
        announce("session-log-editor", "Notes saved.");
      } catch (second) {
        announce("session-log-editor", second.message);
      }
    } else {
      announce("session-log-editor", err.code === "session_locked" ? "This session is open for editing on another device." : err.message);
    }
  }
}

async function uploadFrames() {
  const files = Array.from($("frame-files").files || []);
  if (!files.length || !currentSession) return;
  const batch = currentSession.batches[0];
  if (!batch) {
    announce("upload-progress-editor", "Log a batch before uploading frames.");
    return;
  }
  for (const file of files) {
    const percent = (p) => announce("upload-progress-editor", `Uploading ${file.name}: ${p}%`);
    percent(0);
    percent(25);
    percent(50);
    percent(75);
    try {
      const body = await api("PUT", `/api/batches/${batch.id}/frames/${encodeURIComponent(file.name)}`, file);
      announce("upload-progress-editor", `${file.name} stored. ${body.session_frame_count} frames in this session.`);
    } catch (err) {
      announce("upload-progress-editor", `${file.name} was not stored: ${err.message}`);
    }
  }
  currentSession = await api("GET", `/api/sessions/${currentSession.id}`);
  paintBatches();
  $("frame-files").value = "";
}

function wireBatchDialog() {
  const dialog = $("log-batch-dialog");
  wireDialog(dialog);
  $("log-batch").addEventListener("click", async () => {
    const select = $("batch-filter");
    select.textContent = "";
    try {
      const project = await api("GET", `/api/projects/${currentSession.project_id}`);
      project.filters.forEach((f) => select.appendChild(el("option", { value: f.filter, text: f.filter })));
    } catch (err) {
      /* open anyway */
    }
    openDialog(dialog, $("log-batch"));
  });
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = `batch-${currentSession.id}-${Date.now()}`;
    const body = {
      filter: $("batch-filter").value,
      sub_count: Number($("batch-subs").value),
      exposure_s: Number($("batch-exposure").value),
      camera: $("batch-camera").value.trim(),
      gain: Number($("batch-gain").value),
      offset: Number($("batch-offset").value),
      temperature_c: Number($("batch-temp").value),
      binning: Number($("batch-binning").value),
    };
    try {
      const reply = await api("POST", `/api/sessions/${currentSession.id}/batches`, body, { idempotencyKey: key });
      currentSession = reply.session;
      paintBatches();
      announce("session-log-editor", `${body.sub_count} subs of ${body.exposure_s} s in ${body.filter} added.`);
    } catch (err) {
      announce("session-log-editor", err.message);
    }
  });
}

async function openAmend() {
  const first = currentSession.batches[0];
  if (!first) return;
  const value = Number($("batch-subs").value);
  try {
    const batches = currentSession.batches.map((b) => ({
      id: b.id, filter: b.filter, sub_count: b.sub_count, exposure_s: b.exposure_s,
      camera: b.camera, gain: b.gain, offset: b.offset, temperature_c: b.temperature_c, binning: b.binning,
    }));
    if (batches.length) batches[0].sub_count = Number(batches[0].sub_count) === value ? batches[0].sub_count : value;
    currentSession = await api("POST", `/api/sessions/${currentSession.id}/amend`, { batches });
    paintBatches();
    paintEditorButtons();
    announce("session-log-editor", "Session amended.");
    await loadSessions();
  } catch (err) {
    announce("session-log-editor", err.message);
  }
}

async function openCalibration(batch) {
  try {
    const { candidates } = await api("GET", `/api/batches/${batch.id}/calibration-candidates`);
    const pick = candidates.find((c) => c.matches);
    if (!pick) {
      announce("session-log-editor", "No calibration set matches this batch.");
      return;
    }
    const reply = await api("POST", `/api/batches/${batch.id}/calibration`, { calibration_set_id: pick.calibration_set_id });
    if (reply.warning === "stale") {
      announce("session-log-editor", `Warning: this set is older than its limit. It still calibrates, but consider a fresh library.`);
    } else {
      announce("session-log-editor", `${pick.name} will calibrate this batch.`);
    }
    currentSession = await api("GET", `/api/sessions/${currentSession.id}`);
    paintBatches();
  } catch (err) {
    announce("session-log-editor", err.message);
  }
}

boot();
