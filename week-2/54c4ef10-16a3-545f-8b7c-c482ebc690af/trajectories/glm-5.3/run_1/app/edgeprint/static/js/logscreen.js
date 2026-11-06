/* The Log screen: the shooting-log form and Recent exposures. */
"use strict";

(function () {
  const E = window.Edgeprint;
  const A = E.app;
  const R = E.rollscreen;
  const { el, $, fmtSigned, fmtPlain, DASH, MINUS, previewText, Api } =
    Object.assign({}, E, E.ui || {});
  const UI = E.ui;
  const announce = UI.announce;

  async function logScreen(root) {
    const rolls = (await Api.get("/api/rolls")).rolls;
    let entries = [];
    for (const roll of rolls) {
      const body = await Api.get(`/api/rolls/${roll.id}/entries`);
      for (const entry of body.entries) entry.roll = roll;
      entries = entries.concat(body.entries);
    }
    entries.sort((a, b) =>
      (b.created_at === a.created_at)
        ? (b.counter - a.counter) : (b.created_at < a.created_at ? -1 : 1));

    const rollSelect = el("select", { id: "roll", "aria-label": "Roll" });
    for (const roll of rolls) rollSelect.append(el("option", { value: roll.id, text: roll.name }));
    if (rolls.length) rollSelect.value = rolls[0].id;
    const rollById = Object.fromEntries(rolls.map((roll) => [roll.id, roll]));

    let counterDefault = 1;
    if (rolls.length) {
      const first = await Api.get(`/api/rolls/${rolls[0].id}/entries`);
      const highest = first.entries.reduce((max, e) => Math.max(max, e.counter), 0);
      counterDefault = highest === 99 ? "" : highest + 1;
    }
    const counter = el("input", { type: "number", id: "counter", min: 0, max: 99,
                                 step: 1, value: counterDefault });
    const aperture = el("select", { id: "aperture", "aria-label": "Aperture" });
    for (const value of E.APERTURES) {
      aperture.append(el("option", { value, text: `f/${value}`, selected: value === "8" }));
    }
    const shutter = el("input", { id: "shutter", value: "1/125" });
    const ev = el("input", { type: "number", id: "metered_ev", step: "any", value: 12 });
    const note = el("input", { id: "note" });
    const misfire = el("input", { type: "checkbox", id: "misfire" });
    const preview = el("div", { class: "preview", id: "exposure_preview",
                                role: "status", "aria-label": "Exposure preview" });
    const count = el("div", { class: "meta tabular", id: "note_count", text: "0 / 500" });

    const update = () => {
      const roll = rollById[rollSelect.value];
      preview.textContent = previewText(roll, aperture.value, shutter.value, ev.value);
      count.textContent = `${note.value.trim().length} / 500`;
    };
    for (const field of [rollSelect, aperture, shutter, ev, note]) {
      field.addEventListener("input", update);
      field.addEventListener("change", update);
    }
    update();

    const submit = el("button", { class: "btn", text: "Log exposure", id: "log_button" });
    const form = el("form", { class: "form", onsubmit: async (event) => {
      event.preventDefault();
      announce("Logging…");
      const payload = {
        counter: parseInt(counter.value, 10),
        aperture: aperture.value,
        shutter: shutter.value,
        metered_ev: parseFloat(ev.value),
        note: note.value,
        misfire: misfire.checked,
      };
      try {
        const entry = await Api.post(`/api/rolls/${rollSelect.value}/entries`, payload);
        announce(`Note ${entry.counter} logged.`);
        const body = await Api.get(`/api/rolls/${rollSelect.value}/entries`);
        const highest = body.entries.reduce((max, e) => Math.max(max, e.counter), 0);
        counter.value = highest === 99 ? "" : highest + 1;
        note.value = "";
        misfire.checked = false;
        shutter.focus();
        UI.render();
      } catch (error) {
        if (error.status === 401) {
          keepDraft(rollSelect.value, counter.value, aperture.value, shutter.value,
                    ev.value, note.value, misfire.checked, null);
          return;
        }
        if (error.fields) {
          announce(Object.values(error.fields)[0]);
        } else {
          announce(error.message || "Could not log the exposure.");
        }
      }
    } }, [
      el("a", { href: "/rolls/new", text: "New roll" }),
      el("label", { for: "roll", text: "Roll" }), rollSelect,
      el("label", { for: "counter", text: "Counter" }), counter,
      el("label", { for: "aperture", text: "Aperture" }), aperture,
      el("label", { for: "shutter", text: "Shutter" }), shutter,
      el("label", { for: "metered_ev", text: "Metered EV" }), ev,
      preview,
      el("label", { for: "note", text: "Note" }), note, count,
      el("label", { for: "misfire", text: "Misfire" }), misfire,
      submit,
    ]);

    const recent = el("ul", { class: "log", "aria-label": "Recent exposures" });
    for (const entry of entries.slice(0, 20)) {
      const row = R.entryRow(entry.roll, entry, true);
      row.querySelector(`button`) && row.querySelector("button").remove();
      recent.append(row);
    }

    restoreDraft(form);

    root.append(...UI.shell([
      el("h1", { text: "Log" }), form,
      el("h2", { text: "Recent exposures" }), recent,
    ], A.getMe(), A.isStorageDown()));
  }

  function keepDraft(rollId, counter, aperture, shutter, ev, note, misfire, entryId) {
    const draft = { rollId, counter, aperture, shutter, ev, note, misfire, entryId };
    sessionStorage.setItem("edgeprint_draft", JSON.stringify(draft));
    sessionStorage.setItem("edgeprint_draft_target", "/log");
    announce("Your session ended. Sign in to keep this exposure.");
    location.href = "/signin?next=%2Flog";
  }

  async function restoreDraft(form) {
    const raw = sessionStorage.getItem("edgeprint_draft");
    if (!raw) return;
    sessionStorage.removeItem("edgeprint_draft");
    let draft;
    try { draft = JSON.parse(raw); } catch (error) { return; }
    const target = sessionStorage.getItem("edgeprint_draft_target");
    sessionStorage.removeItem("edgeprint_draft_target");
    const response = await fetch("/api/me", { credentials: "same-origin" });
    if (!response.ok) return;
    const me = await response.json();
    if (!me) return;
    if (target === "/log" && draft.entryId === null) {
      const roll = $("#roll");
      const counter = $("#counter");
      const aperture = $("#aperture");
      const shutter = $("#shutter");
      const ev = $("#metered_ev");
      const note = $("#note");
      const misfire = $("#misfire");
      if (roll) roll.value = draft.rollId;
      if (counter) counter.value = draft.counter;
      if (aperture) aperture.value = draft.aperture;
      if (shutter) shutter.value = draft.shutter;
      if (ev) ev.value = draft.ev;
      if (note) note.value = draft.note;
      if (misfire) misfire.checked = draft.misfire;
      announce("Your unsent exposure is back. Press Log exposure to send it.");
      const button = $("#log_button");
      if (button) button.focus();
    }
  }

  window.Edgeprint.logscreen = { logScreen };
})();
