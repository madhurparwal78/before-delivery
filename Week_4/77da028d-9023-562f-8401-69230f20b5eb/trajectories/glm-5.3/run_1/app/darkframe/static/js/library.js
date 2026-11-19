/* The calibration library: sets, masters, versions, retirement. */

import {
  api, announce, paintVerdictCard, openDialog, closeDialog, wireDialog, el,
  showFieldErrors, startTonightRefresh,
  readKey,
} from "./app.js";

let sets = [];
let editing = null;

const $ = (id) => document.getElementById(id);

async function boot() {
  readKey();
  import("/static/js/chrome.js").then(({ wireLockButton }) => wireLockButton());
  refreshTonight();
  startTonightRefresh(refreshTonight);
  await loadSets();
  wireDialogs();
}

async function refreshTonight() {
  try {
    const plan = await api("GET", "/api/tonight");
    paintVerdictCard($("tonight-verdict"), plan);
  } catch (err) {
    /* keep the last figures */
  }
}

async function loadSets() {
  const body = await api("GET", "/api/calibration-sets");
  sets = body.calibration_sets;
  $("empty-library").hidden = sets.length > 0;
  paintSets();
}

function paintSets() {
  const tbody = $("library-tbody");
  const cards = $("library-cards");
  tbody.textContent = "";
  cards.textContent = "";
  sets.forEach((s) => {
    const actions = (host) => {
      const edit = el("button", { class: "btn", type: "button", text: `Edit ${s.name}`, "aria-label": `Edit ${s.name}` });
      edit.addEventListener("click", () => openEdit(s));
      const upload = el("button", { class: "btn", type: "button", text: `Upload master ${s.name}`, "aria-label": `Upload master ${s.name}` });
      upload.addEventListener("click", () => uploadMaster(s));
      const ready = el("button", { class: "btn", type: "button", text: `Mark ready ${s.name}`, "aria-label": `Mark ready ${s.name}` });
      ready.addEventListener("click", async () => {
        try {
          await api("POST", `/api/calibration-sets/${s.id}/transition`, { to: "ready" });
          announce("library-updates", `${s.name} is ready.`);
          await loadSets();
        } catch (err) {
          announce("library-updates", err.message);
        }
      });
      const retire = el("button", { class: "btn", type: "button", text: `Retire ${s.name}`, "aria-label": `Retire ${s.name}` });
      retire.addEventListener("click", async () => {
        try {
          await api("POST", `/api/calibration-sets/${s.id}/transition`, { to: "retired" });
          announce("library-updates", `${s.name} retired.`);
          await loadSets();
        } catch (err) {
          announce("library-updates", err.message);
        }
      });
      const history = el("button", { class: "btn", type: "button", text: `History ${s.name}`, "aria-label": `History ${s.name}` });
      history.addEventListener("click", () => openHistory(s));
      host.append(edit, upload, ready, retire, history);
    };
    const state = s.status === "stale"
      ? `Stale (this set is older than ${s.max_age_days} days. It still calibrates, but consider a fresh library.)`
      : s.status;
    const tr = el("tr");
    tr.append(
      el("td", { text: s.name }),
      el("td", { text: s.kind }),
      el("td", { text: s.camera }),
      el("td", { class: "num", text: String(s.gain) }),
      el("td", { class: "num", text: String(s.offset) }),
      el("td", { class: "num", text: s.exposure_s === null ? "—" : `${s.exposure_s} s` }),
      el("td", { class: "num", text: `${s.temperature_c} °C` }),
      el("td", { class: "num", text: String(s.binning) }),
      el("td", { text: s.filter || "—" }),
      el("td", { class: "num", text: String(s.age_days) }),
      el("td", { text: state })
    );
    const actionCell = el("td", {});
    actions(actionCell);
    tr.appendChild(actionCell);
    tbody.appendChild(tr);

    const card = el("div", { class: "card", role: "listitem" });
    card.appendChild(el("p", { text: s.name }));
    card.appendChild(el("p", { class: "num", text: `${s.kind} · ${s.camera} · gain ${s.gain} · offset ${s.offset} · ${s.age_days} days · ${s.status}` }));
    const row = el("div", { class: "plan-actions" });
    actions(row);
    card.appendChild(row);
    cards.appendChild(card);
  });
}

function wireDialogs() {
  const dialog = $("new-set-dialog");
  wireDialog(dialog);
  $("new-set").addEventListener("click", () => openDialog(dialog, $("new-set")));
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const kind = $("set-kind").value;
    const body = {
      name: $("set-name").value.trim(),
      kind,
      camera: $("set-camera").value.trim(),
      gain: Number($("set-gain").value),
      offset: Number($("set-offset").value),
      exposure_s: kind === "dark" ? Number($("set-exposure").value) : null,
      temperature_c: Number($("set-temp").value),
      binning: Number($("set-binning").value),
      filter: kind === "flat" ? $("set-filter").value : null,
      frame_count: Number($("set-frames").value),
      captured_on: $("set-captured").value.trim(),
    };
    try {
      const created = await api("POST", "/api/calibration-sets", body);
      closeDialog(dialog);
      await loadSets();
      announce("library-updates", `${created.name} added to the library.`);
    } catch (err) {
      if (err.fields) showFieldErrors("error-summary", err.fields);
      else announce("library-updates", err.message);
    }
  });

  const editDialog = $("edit-set-dialog");
  wireDialog(editDialog);
  editDialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const updated = await api("PATCH", `/api/calibration-sets/${editing.id}`, {
        name: $("edit-name").value.trim(),
        camera: $("edit-camera").value.trim(),
        gain: Number($("edit-gain").value),
        offset: Number($("edit-offset").value),
        exposure_s: editing.kind === "dark" ? Number($("edit-exposure").value) : null,
        temperature_c: Number($("edit-temp").value),
        binning: Number($("edit-binning").value),
        filter: editing.kind === "flat" ? $("edit-filter").value : null,
        frame_count: Number($("edit-frames").value),
        captured_on: $("edit-captured").value.trim(),
      });
      closeDialog(editDialog);
      await loadSets();
      announce("library-updates", `${updated.name} updated.`);
    } catch (err) {
      if (err.fields) showFieldErrors("error-summary", err.fields);
      else announce("library-updates", err.message);
    }
  });

  const historyDialog = $("history-dialog");
  wireDialog(historyDialog);
}

function openEdit(set) {
  editing = set;
  $("edit-name").value = set.name;
  $("edit-camera").value = set.camera;
  $("edit-gain").value = String(set.gain);
  $("edit-offset").value = String(set.offset);
  $("edit-exposure").value = set.exposure_s === null ? "" : String(set.exposure_s);
  $("edit-temp").value = String(set.temperature_c);
  $("edit-binning").value = String(set.binning);
  $("edit-filter").value = set.filter || "";
  $("edit-frames").value = String(set.frame_count);
  $("edit-captured").value = set.captured_on;
  openDialog($("edit-set-dialog"), document.activeElement);
}

async function uploadMaster(set) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".fits,image/fits,application/octet-stream";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      await api("PUT", `/api/calibration-sets/${set.id}/master?filename=${encodeURIComponent(file.name)}`, file);
      announce("library-updates", `Master stored for ${set.name}.`);
      await loadSets();
    } catch (err) {
      announce("library-updates", err.message);
    }
  });
  input.click();
}

async function openHistory(set) {
  const { versions } = await api("GET", `/api/calibration-sets/${set.id}/versions`);
  const host = $("history-body");
  host.textContent = "";
  versions.slice(0, -1).forEach((v) => {
    const n = v.version;
    const btn = el("button", { class: "btn", type: "button", text: `Restore version ${n}`, "aria-label": `Restore version ${n}` });
    btn.addEventListener("click", async () => {
      try {
        const restored = await api("POST", `/api/calibration-sets/${set.id}/restore`, { version: n });
        closeDialog($("history-dialog"));
        await loadSets();
        announce("library-updates", `${restored.name} restored to version ${n}.`);
      } catch (err) {
        announce("library-updates", err.message);
      }
    });
    const row = el("p", { class: "num", text: `Version ${n} · ${v.name} · ${v.camera}` });
    row.appendChild(btn);
    host.appendChild(row);
  });
  const current = versions[versions.length - 1];
  if (current) host.appendChild(el("p", { class: "num", text: `Current version ${current.version}` }));
  openDialog($("history-dialog"), document.activeElement);
}

boot();
