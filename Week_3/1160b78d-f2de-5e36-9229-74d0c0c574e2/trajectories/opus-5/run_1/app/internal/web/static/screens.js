// Per-screen behaviour: keyboard triage, the incident desk, Handoff Cut, the
// policy editor, the service map and the admin controls.
(() => {
  "use strict";
  const S = window.switchlamp;
  if (!S) return;
  const { api, announce, pending, showProblems, countdownText, localLabel, clockTime,
    openDialog, closeDialog, on, page } = S;

  // ------------------------------------------------------- incident list

  if (page === "incidents") {
    const table = document.getElementById("incident-table");
    const body = document.getElementById("incident-rows");
    const total = document.getElementById("incident-total");
    const results = document.getElementById("bulk-results");
    const empty = document.getElementById("incident-empty");
    const showNew = document.getElementById("show-new");
    const resolveDialog = document.getElementById("resolve-dialog");
    let waiting = [];

    const rows = () => Array.from(body.querySelectorAll("tr[data-incident]"));
    const focused = () => body.querySelector('tr[data-incident][tabindex="0"]') || rows()[0];

    function setFocus(row, moveFocus) {
      if (!row) {
        if (empty && !empty.hidden) empty.focus();
        return;
      }
      rows().forEach((other) => other.setAttribute("tabindex", other === row ? "0" : "-1"));
      if (moveFocus !== false) row.focus();
    }

    function bringIntoView(row) {
      if (!row) return;
      row.scrollIntoView({ block: "center" });
    }

    function selected() {
      return rows().filter((row) => row.getAttribute("aria-selected") === "true");
    }

    function toggleSelection(row) {
      const chosen = row.getAttribute("aria-selected") === "true";
      row.setAttribute("aria-selected", chosen ? "false" : "true");
      const box = row.querySelector('input[type="checkbox"]');
      if (box) box.checked = !chosen;
    }

    function reportResults(lines) {
      results.innerHTML = "";
      lines.forEach((line) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = line;
        results.appendChild(paragraph);
      });
    }

    function filterStatus() {
      return document.getElementById("status-filter").value;
    }

    function keepsRow(status) {
      const filter = filterStatus();
      if (filter === "all") return true;
      if (filter === "open") return status !== "resolved";
      return filter === status;
    }

    // A row that leaves the filter hands focus to the row that took its place.
    function dropRow(row) {
      const all = rows();
      const index = all.indexOf(row);
      row.remove();
      const left = rows();
      const next = left[index] || left[left.length - 1] || null;
      if (empty) empty.hidden = left.length > 0;
      setFocus(next, true);
    }

    async function act(action, chosenRows) {
      const ids = chosenRows.map((row) => row.dataset.id);
      if (!ids.length) return;
      const response = await api("POST", "/api/incidents/bulk", { action, ids });
      if (!response.ok) return;
      const lines = [];
      (response.body.results || []).forEach((result) => {
        const row = chosenRows.find((candidate) => candidate.dataset.id === result.id);
        if (result.status === "ok") {
          lines.push(`#${result.number} ${action === "acknowledge" ? "acknowledged" : "resolved"}.`);
          if (row) {
            const word = action === "acknowledge" ? "Acknowledged" : "Resolved";
            const cell = row.querySelector(".status-word");
            if (cell) cell.textContent = word;
            row.dataset.status = action === "acknowledge" ? "acknowledged" : "resolved";
          }
        } else {
          lines.push(`#${result.number}: Already ${result.decision} by ${result.decided_by}.`);
        }
      });
      reportResults(lines);
      chosenRows.forEach((row) => {
        if (!keepsRow(row.dataset.status)) dropRow(row);
      });
    }

    if (body) {
      rows().forEach((row, index) => row.setAttribute("tabindex", index === 0 ? "0" : "-1"));
      const first = rows()[0];
      if (first) first.focus();

      body.addEventListener("click", (event) => {
        const row = event.target.closest("tr[data-incident]");
        if (!row) return;
        if (event.target.matches('input[type="checkbox"]')) {
          row.setAttribute("aria-selected", event.target.checked ? "true" : "false");
        }
        setFocus(row, false);
      });

      document.addEventListener("keydown", (event) => {
        const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName);
        if (inField) return;
        if (document.querySelector("dialog[open]")) return;
        const all = rows();
        if (!all.length) return;
        const current = focused();
        const index = all.indexOf(current);
        const key = event.key.toLowerCase();
        if (key === "j") {
          event.preventDefault();
          setFocus(all[Math.min(index + 1, all.length - 1)]);
        } else if (key === "k") {
          event.preventDefault();
          setFocus(all[Math.max(index - 1, 0)]);
        } else if (event.key === "Home") {
          event.preventDefault();
          setFocus(all[0]);
          bringIntoView(all[0]);
        } else if (event.key === "End") {
          event.preventDefault();
          setFocus(all[all.length - 1]);
          bringIntoView(all[all.length - 1]);
        } else if (key === "x") {
          event.preventDefault();
          toggleSelection(current);
          setFocus(current);
        } else if (key === "a") {
          event.preventDefault();
          const chosen = selected();
          act("acknowledge", chosen.length ? chosen : [current]);
        } else if (key === "r") {
          event.preventDefault();
          const chosen = selected();
          resolveDialog.chosenRows = chosen.length ? chosen : [current];
          openDialog(resolveDialog, current);
          document.getElementById("resolve-confirm").focus();
        }
      });
    }

    const confirmResolve = document.getElementById("resolve-confirm");
    if (confirmResolve) {
      confirmResolve.addEventListener("click", () => pending(confirmResolve, async () => {
        const chosen = resolveDialog.chosenRows || [];
        closeDialog(resolveDialog);
        await act("resolve", chosen);
      }));
    }
    const cancelResolve = document.getElementById("resolve-cancel");
    if (cancelResolve) cancelResolve.addEventListener("click", () => closeDialog(resolveDialog));

    const acknowledgeSelected = document.getElementById("bulk-acknowledge");
    if (acknowledgeSelected) {
      acknowledgeSelected.addEventListener("click", () => pending(acknowledgeSelected, async () => {
        const chosen = selected();
        await act("acknowledge", chosen.length ? chosen : [focused()]);
      }));
    }
    const resolveSelected = document.getElementById("bulk-resolve");
    if (resolveSelected) {
      resolveSelected.addEventListener("click", () => {
        const chosen = selected();
        resolveDialog.chosenRows = chosen.length ? chosen : [focused()];
        openDialog(resolveDialog, resolveSelected);
        document.getElementById("resolve-confirm").focus();
      });
    }
    const firstButton = document.getElementById("first-incident");
    if (firstButton) {
      firstButton.addEventListener("click", () => {
        const all = rows();
        setFocus(all[0]);
        bringIntoView(all[0]);
      });
    }
    const lastButton = document.getElementById("last-incident");
    if (lastButton) {
      lastButton.addEventListener("click", () => {
        const all = rows();
        setFocus(all[all.length - 1]);
        bringIntoView(all[all.length - 1]);
      });
    }

    // Filters live in the address, so reload, Back and a pasted link agree.
    const statusFilter = document.getElementById("status-filter");
    const serviceFilter = document.getElementById("service-filter");
    const writeFilters = () => {
      const params = new URLSearchParams();
      params.set("status", statusFilter.value);
      if (serviceFilter.value) params.set("service", serviceFilter.value);
      window.history.pushState({}, "", `/incidents?${params.toString()}`);
      window.location.reload();
    };
    if (statusFilter) statusFilter.addEventListener("change", writeFilters);
    if (serviceFilter) serviceFilter.addEventListener("change", writeFilters);

    const saveFilter = document.getElementById("save-filter");
    if (saveFilter) {
      saveFilter.addEventListener("click", () => pending(saveFilter, async () => {
        const name = document.getElementById("filter-name").value;
        const response = await api("POST", "/api/me/saved-filters", {
          name, status: statusFilter.value, service_id: serviceFilter.value || null,
        });
        if (response.ok) {
          announce("Filter saved.");
          window.location.reload();
          return;
        }
        showProblems(document, (response.body || {}).errors);
      }));
    }
    document.querySelectorAll('#saved-filters button[data-filter]').forEach((button) => {
      button.addEventListener("click", () => pending(button, async () => {
        await api("DELETE", `/api/me/saved-filters/${button.dataset.filter}`);
        window.location.reload();
      }));
    });

    const older = document.getElementById("older-incidents");
    const newer = document.getElementById("newer-incidents");
    const paged = (cursor, name) => {
      const params = new URLSearchParams(window.location.search);
      params.set(name, cursor);
      window.location.href = `/incidents?${params.toString()}`;
    };
    if (older) {
      older.addEventListener("click", () => {
        const all = rows();
        if (!all.length) return;
        const last = all[all.length - 1];
        paged(`${Math.floor(new Date(last.dataset.openedAt || Date.now()).getTime() / 1000)}_${last.dataset.incident}`, "after");
      });
    }
    if (newer) {
      newer.addEventListener("click", () => {
        const all = rows();
        if (!all.length) return;
        const first = all[0];
        paged(`${Math.floor(new Date(first.dataset.openedAt || Date.now()).getTime() / 1000)}_${first.dataset.incident}`, "before");
      });
    }

    // A new matching incident never shifts the rows on view.
    on("incident", async (message) => {
      const item = message.data && message.data.item;
      if (!item) return;
      const existing = body.querySelector(`tr[data-incident="${item.number}"]`);
      if (existing) {
        const cell = existing.querySelector(".status-word");
        if (cell) cell.textContent = item.status_word;
        existing.dataset.status = item.status;
        const holders = existing.children[5];
        if (holders) {
          holders.textContent = (item.holders || []).map((h) => h.name).join(", ") || "Nobody";
        }
        if (!keepsRow(item.status)) dropRow(existing);
      } else if (keepsRow(item.status)) {
        if (!waiting.includes(item.number)) waiting.push(item.number);
        showNew.hidden = false;
        showNew.textContent = `Show ${waiting.length} new incidents`;
      }
      const response = await api("GET", `/api/incidents?status=${filterStatus()}&limit=1`);
      if (response.ok && total) total.textContent = String(response.body.total);
    });

    if (showNew) {
      showNew.addEventListener("click", () => {
        const params = new URLSearchParams(window.location.search);
        params.delete("after");
        params.delete("before");
        window.location.href = `/incidents?${params.toString()}`;
      });
    }
  }

  // ------------------------------------------------------- incident page

  if (page === "incident") {
    const id = document.body.dataset.incident;
    const number = Number(document.body.dataset.number);
    const timer = document.getElementById("incident-countdown");
    const label = document.getElementById("countdown-label");
    const holderRegion = document.getElementById("holder-region");
    const holderFigure = document.getElementById("holder-figure");

    const action = async (control, path, body) => pending(control, async () => {
      const response = await api("POST", path, body || {});
      if (response.ok) {
        window.location.reload();
        return response;
      }
      const error = response.body || {};
      if (error.error === "already_decided") {
        announce(`Already ${error.decision} by ${error.decided_by}.`);
      } else if (error.error === "illegal_transition") {
        announce(error.message);
      } else if (error.errors) {
        showProblems(document, error.errors);
      }
      return response;
    });

    const acknowledge = document.getElementById("acknowledge");
    if (acknowledge) acknowledge.addEventListener("click", () => action(acknowledge, `/api/incidents/${id}/acknowledge`));
    const resolve = document.getElementById("resolve");
    if (resolve) resolve.addEventListener("click", () => action(resolve, `/api/incidents/${id}/resolve`));

    const snoozeDialog = document.getElementById("snooze-dialog");
    const snooze = document.getElementById("snooze");
    if (snooze) snooze.addEventListener("click", () => openDialog(snoozeDialog, snooze));
    const snoozeCancel = document.getElementById("snooze-cancel");
    if (snoozeCancel) snoozeCancel.addEventListener("click", () => closeDialog(snoozeDialog));
    const snoozeConfirm = document.getElementById("snooze-confirm");
    if (snoozeConfirm) {
      snoozeConfirm.addEventListener("click", () => pending(snoozeConfirm, async () => {
        const chosen = snoozeDialog.querySelector('input[name="snooze"]:checked').value;
        let body = {};
        if (chosen === "custom") {
          const raw = document.getElementById("snooze-until").value.trim();
          if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw)) {
            document.getElementById("snooze-error").textContent = "Use the format YYYY-MM-DD HH:MM.";
            return;
          }
          body = { until: localToInstant(raw, document.body.dataset.zone || "UTC") };
        } else {
          body = { preset_hours: Number(chosen) };
        }
        const response = await api("POST", `/api/incidents/${id}/snooze`, body);
        if (response.ok) {
          closeDialog(snoozeDialog);
          window.location.reload();
          return;
        }
        const error = response.body || {};
        if (error.error === "illegal_transition") {
          announce(error.message);
          closeDialog(snoozeDialog);
        } else if (error.error === "already_decided") {
          announce(`Already ${error.decision} by ${error.decided_by}.`);
          closeDialog(snoozeDialog);
        } else if (error.errors) {
          document.getElementById("snooze-error").textContent = Object.values(error.errors)[0];
        }
      }));
    }

    const reassignDialog = document.getElementById("reassign-dialog");
    const reassign = document.getElementById("reassign");
    if (reassign) reassign.addEventListener("click", () => openDialog(reassignDialog, reassign));
    const reassignCancel = document.getElementById("reassign-cancel");
    if (reassignCancel) reassignCancel.addEventListener("click", () => closeDialog(reassignDialog));
    const reassignConfirm = document.getElementById("reassign-confirm");
    if (reassignConfirm) {
      reassignConfirm.addEventListener("click", () => pending(reassignConfirm, async () => {
        const person = document.getElementById("reassign-person").value;
        const service = document.getElementById("reassign-service").value;
        const body = {};
        if (person) body.person_id = person;
        if (service) body.service_id = service;
        const response = await api("POST", `/api/incidents/${id}/reassign`, body);
        if (response.ok) {
          closeDialog(reassignDialog);
          window.location.reload();
          return;
        }
        showProblems(document, (response.body || {}).errors);
        closeDialog(reassignDialog);
      }));
    }

    const responderDialog = document.getElementById("responder-dialog");
    const addResponder = document.getElementById("add-responder");
    if (addResponder) addResponder.addEventListener("click", () => openDialog(responderDialog, addResponder));
    const responderCancel = document.getElementById("responder-cancel");
    if (responderCancel) responderCancel.addEventListener("click", () => closeDialog(responderDialog));
    const responderSend = document.getElementById("responder-send");
    if (responderSend) {
      responderSend.addEventListener("click", () => pending(responderSend, async () => {
        const personID = document.getElementById("responder-choice").value;
        const response = await api("POST", `/api/incidents/${id}/responder-requests`, { person_id: personID });
        closeDialog(responderDialog);
        if (response.ok) window.location.reload();
      }));
    }
    const accept = document.getElementById("responder-accept");
    const decline = document.getElementById("responder-decline");
    const request = document.getElementById("responder-request");
    if (accept && request) {
      accept.addEventListener("click", () => action(accept, `/api/responder-requests/${request.dataset.request}/accept`));
    }
    if (decline && request) {
      decline.addEventListener("click", () => action(decline, `/api/responder-requests/${request.dataset.request}/decline`));
    }

    const mergeDialog = document.getElementById("merge-dialog");
    const merge = document.getElementById("merge");
    if (merge) merge.addEventListener("click", () => openDialog(mergeDialog, merge));
    const mergeCancel = document.getElementById("merge-cancel");
    if (mergeCancel) mergeCancel.addEventListener("click", () => closeDialog(mergeDialog));
    const mergeConfirm = document.getElementById("merge-confirm");
    if (mergeConfirm) {
      mergeConfirm.addEventListener("click", () => pending(mergeConfirm, async () => {
        const numbers = document.getElementById("merge-numbers").value
          .split(",").map((value) => value.trim()).filter(Boolean);
        const list = await api("GET", "/api/incidents?status=all&limit=100");
        const ids = (list.body.items || [])
          .filter((item) => numbers.includes(String(item.number)))
          .map((item) => item.id);
        const response = await api("POST", `/api/incidents/${id}/merge`, { source_ids: ids });
        closeDialog(mergeDialog);
        if (response.ok) {
          announce(`Merged ${ids.length} incidents into #${number}.`);
          window.location.reload();
        }
      }));
    }

    document.querySelectorAll("button.split").forEach((button) => {
      button.addEventListener("click", () => pending(button, async () => {
        const alertID = button.dataset.alert;
        const item = button.closest("li");
        const next = item.nextElementSibling;
        const response = await api("POST", `/api/incidents/${id}/alerts/${alertID}/split`);
        if (!response.ok) return;
        item.remove();
        const target = (next && next.querySelector("button.split")) ||
          document.querySelector("#alert-list li:last-child button.split");
        if (target) target.focus();
        announce(`Alert split into incident #${response.body.number} by you.`);
      }));
    });

    // The unfinished note is kept on the server, so it survives a reload, a
    // second tab and another device.
    const note = document.getElementById("note");
    if (note) {
      let timerID = null;
      const save = async () => {
        await api("PUT", `/api/incidents/${id}/note-draft`, { body: note.value });
      };
      note.addEventListener("input", () => {
        window.clearTimeout(timerID);
        timerID = window.setTimeout(save, 1000);
      });
      window.addEventListener("pagehide", () => {
        navigator.sendBeacon(`/api/incidents/${id}/note-draft`, new Blob([
          JSON.stringify({ body: note.value })], { type: "application/json" }));
      });
      window.setInterval(async () => {
        if (document.activeElement === note) return;
        const response = await api("GET", `/api/incidents/${id}/note-draft`);
        if (response.ok && response.body && response.body.body !== note.value) {
          note.value = response.body.body;
        }
      }, 1000);
    }
    const noteForm = document.getElementById("note-form");
    if (noteForm) {
      noteForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const button = document.getElementById("add-note");
        pending(button, async () => {
          const response = await api("POST", `/api/incidents/${id}/notes`, { body: note.value });
          if (response.ok) {
            note.value = "";
            announce("Note added.");
            window.location.reload();
            return;
          }
          showProblems(noteForm, (response.body || {}).errors);
        });
      });
    }

    // The countdown shows the value the server last sent.
    on("countdown", (message) => {
      const mine = (message.data.incidents || []).find((row) => row.id === id);
      if (!mine || !timer) return;
      timer.textContent = mine.kind === "none" ? "--:--" : countdownText(mine.remaining_seconds);
      timer.dataset.kind = mine.kind;
      if (label) label.textContent = mine.label;
      if (holderRegion) {
        holderRegion.dataset.level = mine.level;
        holderRegion.dataset.cycle = mine.cycle;
        holderRegion.dataset.holder = mine.holder;
        holderRegion.dataset.remainingSeconds = mine.remaining_seconds;
      }
      if (holderFigure) holderFigure.textContent = mine.holder;
      const status = document.getElementById("incident-status");
      if (status) {
        const words = { triggered: "Triggered", acknowledged: "Acknowledged", snoozed: "Snoozed", resolved: "Resolved" };
        status.textContent = words[mine.status] || status.textContent;
      }
    });

    on("incident", async (message) => {
      if (!message.data || message.data.incident_id !== id) return;
      const response = await api("GET", `/api/incidents/${id}`);
      if (!response.ok) return;
      paintTimeline(response.body);
    });

    function paintTimeline(incident) {
      const timeline = document.getElementById("timeline");
      if (!timeline) return;
      timeline.innerHTML = "";
      incident.timeline.forEach((entry) => {
        const item = document.createElement("li");
        item.dataset.kind = entry.kind;
        const at = document.createElement("span");
        at.className = "mono";
        at.textContent = localLabel(entry.at, document.body.dataset.zone || "UTC");
        const text = document.createElement("span");
        text.textContent = ` — ${entry.text} `;
        const actor = document.createElement("span");
        actor.className = "actor";
        actor.textContent = entry.actor;
        item.append(at, text, actor);
        timeline.appendChild(item);
      });
      const steps = document.getElementById("step-list");
      if (steps) {
        steps.innerHTML = "";
        incident.steps.forEach((step) => {
          const item = document.createElement("li");
          item.textContent = `${step.person} · ${step.channel} · ${localLabel(step.due_at, document.body.dataset.zone || "UTC")} · ${step.word}`;
          steps.appendChild(item);
        });
      }
    }
  }

  function localToInstant(text, zone) {
    const [datePart, timePart] = text.split(" ");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    const offsetAt = (instant) => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(new Date(instant));
      const get = (type) => Number((parts.find((p) => p.type === type) || {}).value);
      const asUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
      return asUTC - instant;
    };
    let instant = guess - offsetAt(guess);
    instant = guess - offsetAt(instant);
    return new Date(instant).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  window.switchlamp.localToInstant = localToInstant;
})();
