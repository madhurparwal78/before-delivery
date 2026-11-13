// Handoff Cut, the policy editor, the service map and the desk screens.
(() => {
  "use strict";
  const S = window.switchlamp;
  if (!S) return;
  const { api, announce, pending, showProblems, countdownText, localLabel, clockTime,
    openDialog, closeDialog, on, page } = S;

  const STEP = 15 * 60 * 1000;

  // ------------------------------------------------------------- schedule

  if (page === "schedule") {
    const scheduleID = document.body.dataset.schedule;
    const zone = document.body.dataset.zone;
    const rangeStart = new Date(document.body.dataset.from).getTime();
    const rangeEnd = new Date(document.body.dataset.to).getTime();
    const row = document.getElementById("final-schedule");
    const tab = document.getElementById("cut-tab");
    const preview = document.getElementById("cut-preview");
    const cutFor = document.getElementById("cut-for");
    const canLead = document.body.dataset.canLead === "true";

    const snap = (instant) => Math.round(instant / STEP) * STEP;

    function instantAtX(clientX) {
      const box = row.getBoundingClientRect();
      const share = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
      return snap(rangeStart + share * (rangeEnd - rangeStart));
    }

    function shareOf(instant) {
      return (instant - rangeStart) / (rangeEnd - rangeStart);
    }

    let anchor = null;
    let edge = null;
    let cursor = null;
    let dragging = false;

    function lengthText(minutes) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`;
    }

    function paintTab(instant, length) {
      if (!tab) return;
      tab.hidden = false;
      tab.style.left = `${shareOf(instant) * 100}%`;
      if (length === null) {
        tab.textContent = "Cut here";
        return;
      }
      tab.textContent = `Ends ${clockTime(new Date(instant).toISOString(), zone)}, ${lengthText(length)}`;
    }

    // Each block under the cut splits live into pieces that keep their person.
    function paintPreviewBlocks() {
      row.querySelectorAll('[data-preview="true"]').forEach((piece) => piece.remove());
      row.querySelectorAll(".block").forEach((block) => (block.hidden = false));
      if (anchor === null || edge === null) return;
      const from = Math.min(anchor, edge);
      const to = Math.max(anchor, edge);
      const total = rangeEnd - rangeStart;
      const person = cutFor.options[cutFor.selectedIndex].textContent;
      Array.from(row.querySelectorAll(".block")).forEach((block) => {
        const start = new Date(block.dataset.start).getTime();
        const end = new Date(block.dataset.end).getTime();
        if (end <= from || start >= to) return;
        block.hidden = true;
        const pieces = [];
        if (start < from) pieces.push([start, from, block.dataset.person, block.dataset.source]);
        pieces.push([Math.max(start, from), Math.min(end, to), person, "override"]);
        if (end > to) pieces.push([to, end, block.dataset.person, block.dataset.source]);
        pieces.forEach(([pieceStart, pieceEnd, name, source]) => {
          const piece = document.createElement("div");
          piece.className = `block block-${source}`;
          piece.dataset.preview = "true";
          piece.dataset.start = new Date(pieceStart).toISOString();
          piece.dataset.end = new Date(pieceEnd).toISOString();
          piece.dataset.person = name;
          piece.dataset.source = source;
          piece.dataset.minutes = String(Math.round((pieceEnd - pieceStart) / 60000));
          piece.style.width = `${((pieceEnd - pieceStart) / total) * 100}%`;
          piece.textContent = name;
          row.insertBefore(piece, block);
        });
      });
    }

    let previewTimer = null;
    async function askPreview() {
      if (anchor === null || edge === null) return;
      const from = Math.min(anchor, edge);
      const to = Math.max(anchor, edge);
      if (from === to) {
        preview.textContent = "";
        return;
      }
      const response = await api("POST", `/api/schedules/${scheduleID}/overrides/preview`, {
        person_id: cutFor.value || null,
        start: new Date(from).toISOString().replace(/\.\d{3}Z$/, "Z"),
        end: new Date(to).toISOString().replace(/\.\d{3}Z$/, "Z"),
      });
      if (response.ok) preview.textContent = response.body.summary;
    }

    function schedulePreview() {
      window.clearTimeout(previewTimer);
      previewTimer = window.setTimeout(askPreview, 60);
    }

    async function commit() {
      const from = Math.min(anchor, edge);
      const to = Math.max(anchor, edge);
      anchor = null;
      edge = null;
      if (from === to) {
        paintPreviewBlocks();
        return;
      }
      const response = await api("POST", `/api/schedules/${scheduleID}/overrides`, {
        person_id: cutFor.value || null,
        start: new Date(from).toISOString().replace(/\.\d{3}Z$/, "Z"),
        end: new Date(to).toISOString().replace(/\.\d{3}Z$/, "Z"),
      });
      if (response.ok) {
        announce(response.body.message);
        window.location.reload();
        return;
      }
      const error = response.body || {};
      if (error.error === "override_overlap") {
        announce(error.message);
      } else if (error.errors) {
        announce(Object.values(error.errors)[0]);
      }
      paintPreviewBlocks();
      preview.textContent = "";
    }

    if (row && canLead) {
      row.addEventListener("pointermove", (event) => {
        if (!dragging) {
          paintTab(instantAtX(event.clientX), null);
          return;
        }
        edge = instantAtX(event.clientX);
        paintTab(edge, Math.abs(edge - anchor) / 60000);
        paintPreviewBlocks();
        schedulePreview();
      });
      row.addEventListener("pointerleave", () => {
        if (!dragging && tab) tab.hidden = true;
      });
      row.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        anchor = instantAtX(event.clientX);
        edge = anchor;
        dragging = true;
        row.setPointerCapture(event.pointerId);
        paintTab(edge, 0);
      });
      row.addEventListener("pointerup", async (event) => {
        if (!dragging) return;
        dragging = false;
        row.releasePointerCapture(event.pointerId);
        await commit();
      });
      window.addEventListener("keydown", (event) => {
        if (dragging && event.key === "Escape") {
          dragging = false;
          anchor = null;
          edge = null;
          paintPreviewBlocks();
          preview.textContent = "";
        }
      });

      // The same cut by keyboard, with the same 15-minute step.
      row.addEventListener("focus", () => {
        const now = Date.now();
        cursor = now >= rangeStart && now < rangeEnd
          ? Math.floor((now - rangeStart) / STEP) * STEP + rangeStart
          : rangeStart;
        paintTab(cursor, null);
      });
      row.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Enter", "Escape"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Escape") {
          anchor = null;
          edge = null;
          paintPreviewBlocks();
          preview.textContent = "";
          return;
        }
        if (event.key === "Enter") {
          if (anchor === null) {
            anchor = cursor;
            edge = cursor;
            paintTab(edge, 0);
            return;
          }
          commit();
          return;
        }
        const move = event.key === "ArrowRight" ? STEP : -STEP;
        if (anchor === null) {
          cursor = Math.min(Math.max(cursor + move, rangeStart), rangeEnd);
          paintTab(cursor, null);
          return;
        }
        edge = Math.min(Math.max(edge + move, rangeStart), rangeEnd);
        paintTab(edge, Math.abs(edge - anchor) / 60000);
        paintPreviewBlocks();
        schedulePreview();
      });
    }

    const overrideDialog = document.getElementById("override-dialog");
    const openOverride = document.getElementById("schedule-override");
    if (openOverride) openOverride.addEventListener("click", () => openDialog(overrideDialog, openOverride));
    const overrideCancel = document.getElementById("override-cancel");
    if (overrideCancel) overrideCancel.addEventListener("click", () => closeDialog(overrideDialog));
    const overrideSave = document.getElementById("override-save");
    if (overrideSave) {
      overrideSave.addEventListener("click", () => pending(overrideSave, async () => {
        const startText = document.getElementById("override-start").value.trim();
        const endText = document.getElementById("override-end").value.trim();
        const pattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
        const errors = {};
        if (!pattern.test(startText)) errors["override-start"] = "Use the format YYYY-MM-DD HH:MM.";
        if (!pattern.test(endText)) errors["override-end"] = "Use the format YYYY-MM-DD HH:MM.";
        if (Object.keys(errors).length) {
          showProblems(overrideDialog, errors);
          return;
        }
        const response = await api("POST", `/api/schedules/${scheduleID}/overrides`, {
          person_id: document.getElementById("override-person").value || null,
          start: window.switchlamp.localToInstant(startText, zone),
          end: window.switchlamp.localToInstant(endText, zone),
        });
        if (response.ok) {
          announce(response.body.message);
          closeDialog(overrideDialog);
          window.location.reload();
          return;
        }
        const error = response.body || {};
        if (error.error === "override_overlap") {
          announce(error.message);
          closeDialog(overrideDialog);
          return;
        }
        showProblems(overrideDialog, error.errors);
      }));
    }

    const viewZone = document.getElementById("view-zone");
    if (viewZone) {
      viewZone.addEventListener("change", () => {
        const params = new URLSearchParams(window.location.search);
        params.set("zone", viewZone.value);
        params.set("from", document.getElementById("range-start").value);
        params.set("days", document.body.dataset.days || "7");
        window.history.pushState({}, "", `${window.location.pathname}?${params.toString()}`);
        window.location.reload();
      });
    }
    const moveWeek = (days) => {
      const start = document.getElementById("range-start").value;
      const date = new Date(`${start}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      const params = new URLSearchParams(window.location.search);
      params.set("from", date.toISOString().slice(0, 10));
      params.set("zone", zone);
      window.location.href = `${window.location.pathname}?${params.toString()}`;
    };
    const previous = document.getElementById("previous-week");
    if (previous) previous.addEventListener("click", () => moveWeek(-7));
    const next = document.getElementById("next-week");
    if (next) next.addEventListener("click", () => moveWeek(7));
    const rangeStartField = document.getElementById("range-start");
    if (rangeStartField) {
      rangeStartField.addEventListener("change", () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(rangeStartField.value.trim())) {
          showProblems(document, { "range-start": "Use the format YYYY-MM-DD." });
          return;
        }
        const params = new URLSearchParams(window.location.search);
        params.set("from", rangeStartField.value.trim());
        params.set("zone", zone);
        window.location.href = `${window.location.pathname}?${params.toString()}`;
      });
    }

    on("schedule", () => window.location.reload());
  }

  // -------------------------------------------------------- policy editor

  if (page === "policy") {
    const list = document.getElementById("levels");
    const notice = document.getElementById("policy-notice");
    let lifted = null;
    let orderAtLift = null;

    function renumber() {
      Array.from(list.children).forEach((item, index) => {
        const position = index + 1;
        item.dataset.level = String(position);
        const handle = item.querySelector(".move-handle");
        handle.setAttribute("aria-label", `Move level ${position}`);
        handle.textContent = `Move level ${position}`;
        item.querySelector(".timeout").setAttribute("aria-label", `Timeout for level ${position}`);
      });
    }

    function moveTo(item, position) {
      const items = Array.from(list.children);
      const target = items[position];
      if (position >= items.length) list.appendChild(item);
      else list.insertBefore(item, target);
      renumber();
      announce(`Level moved to position ${Array.from(list.children).indexOf(item) + 1}.`);
      item.querySelector(".move-handle").focus();
    }

    if (list) {
      list.querySelectorAll(".move-handle").forEach((handle) => {
        handle.setAttribute("draggable", "true");
        handle.addEventListener("dragstart", (event) => {
          lifted = handle.closest("li");
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", lifted.dataset.level);
        });
        handle.addEventListener("keydown", (event) => {
          const item = handle.closest("li");
          const items = Array.from(list.children);
          const index = items.indexOf(item);
          if (event.key === " " || event.key === "Spacebar") {
            event.preventDefault();
            if (lifted === item) {
              lifted = null;
              orderAtLift = null;
            } else {
              lifted = item;
              orderAtLift = items.slice();
            }
            return;
          }
          if (!lifted || lifted !== item) return;
          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (index > 0) moveTo(item, index - 1);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            if (index < items.length - 1) moveTo(item, index + 1);
          } else if (event.key === "Escape") {
            event.preventDefault();
            orderAtLift.forEach((entry) => list.appendChild(entry));
            renumber();
            lifted = null;
            handle.focus();
          }
        });
      });
      list.addEventListener("dragover", (event) => event.preventDefault());
      list.addEventListener("drop", (event) => {
        event.preventDefault();
        const target = event.target.closest("li");
        if (!lifted || !target || target === lifted) return;
        const items = Array.from(list.children);
        moveTo(lifted, items.indexOf(target));
        lifted = null;
      });
    }

    const addLevel = document.getElementById("add-level");
    if (addLevel) {
      addLevel.addEventListener("click", () => {
        const item = document.createElement("li");
        const position = list.children.length + 1;
        item.dataset.level = String(position);
        item.innerHTML = `<button type="button" class="move-handle" aria-label="Move level ${position}">Move level ${position}</button>
          <input class="timeout" type="number" min="1" aria-label="Timeout for level ${position}" value="30">
          <span class="targets"></span><span class="target-data" hidden></span>`;
        list.appendChild(item);
      });
    }

    const savePolicy = document.getElementById("save-policy");
    if (savePolicy) {
      savePolicy.addEventListener("click", () => pending(savePolicy, async () => {
        const levels = Array.from(list.children).map((item) => ({
          timeout_minutes: Number(item.querySelector(".timeout").value),
          targets: (item.querySelector(".target-data").textContent || "")
            .split(";").filter(Boolean).map((entry) => {
              const [type, id] = entry.split(":");
              return { type, id };
            }),
        }));
        const version = Number(document.body.dataset.version);
        const response = await api("PUT", `/api/policies/${document.body.dataset.policy}`, {
          name: document.querySelector("h1").textContent,
          repeats: Number(document.getElementById("repeats").value),
          levels,
        }, { "If-Match": `"${version}"` });
        if (response.ok) {
          const body = response.body;
          notice.hidden = false;
          notice.textContent = `${body.running_incidents} running incidents keep version ${body.previous_version}. ` +
            `Version ${body.version} applies to later incidents.`;
          document.body.dataset.version = String(body.version);
          announce("Saved.");
          return;
        }
        if (response.status === 412) {
          announce("Someone saved a newer version. Reload to see it.");
          return;
        }
        showProblems(document, (response.body || {}).errors);
      }));
    }
  }

  // ---------------------------------------------------------- service map

  if (page === "services") {
    const tree = document.getElementById("service-map");
    if (tree) {
      const visible = () => Array.from(tree.querySelectorAll('[role="treeitem"]')).filter((item) => {
        let parent = item.parentElement.closest('[role="treeitem"]');
        while (parent) {
          if (parent.getAttribute("aria-expanded") === "false") return false;
          parent = parent.parentElement.closest('[role="treeitem"]');
        }
        return true;
      });
      const focus = (item) => {
        if (!item) return;
        tree.querySelectorAll('[role="treeitem"]').forEach((other) =>
          other.setAttribute("tabindex", other === item ? "0" : "-1"));
        item.focus();
      };
      tree.addEventListener("keydown", (event) => {
        const item = event.target.closest('[role="treeitem"]');
        if (!item) return;
        const items = visible();
        const index = items.indexOf(item);
        const group = item.querySelector('[role="group"]');
        switch (event.key) {
          case "ArrowDown":
            event.preventDefault();
            focus(items[Math.min(index + 1, items.length - 1)]);
            break;
          case "ArrowUp":
            event.preventDefault();
            focus(items[Math.max(index - 1, 0)]);
            break;
          case "ArrowRight":
            event.preventDefault();
            if (group && item.getAttribute("aria-expanded") === "false") {
              item.setAttribute("aria-expanded", "true");
            } else if (group) {
              focus(group.querySelector('[role="treeitem"]'));
            }
            break;
          case "ArrowLeft": {
            event.preventDefault();
            if (group && item.getAttribute("aria-expanded") === "true") {
              item.setAttribute("aria-expanded", "false");
              break;
            }
            const parent = item.parentElement.closest('[role="treeitem"]');
            if (parent) focus(parent);
            break;
          }
          case "Home":
            event.preventDefault();
            focus(items[0]);
            break;
          case "End":
            event.preventDefault();
            focus(items[items.length - 1]);
            break;
          default:
            break;
        }
      });
      tree.addEventListener("click", (event) => {
        const item = event.target.closest('[role="treeitem"]');
        if (item) focus(item);
      });
    }
    on("status", async () => {
      const response = await api("GET", "/api/services");
      if (!response.ok) return;
      const active = document.activeElement;
      (response.body.items || []).forEach((service) => {
        document.querySelectorAll(`[data-service="${CSS.escape(service.name)}"]`).forEach((item) => {
          item.dataset.status = service.status;
          const word = item.querySelector(".status-word");
          if (word) word.textContent = service.status;
        });
      });
      if (active && document.contains(active)) active.focus();
    });
  }

  // ----------------------------------------------------------- integration

  if (page === "integration" || page === "integrations") {
    const integrationID = document.body.dataset.integration;
    const counter = document.getElementById("counter-figure");
    const retry = document.getElementById("retry-countdown");
    on("countdown", (message) => {
      const mine = (message.data.integrations || []).find((row) => row.integration_id === integrationID);
      if (!mine) return;
      if (counter && mine.count !== null && mine.count !== undefined && !counter.classList.contains("notice-bar")) {
        counter.textContent = `${mine.count} / 120`;
      }
      if (retry) {
        retry.textContent = mine.retry_after ? `${mine.retry_after} s` : "Accepting events";
        retry.dataset.seconds = String(mine.retry_after || 0);
      }
    });
    on("integration", async (message) => {
      if (!integrationID || message.data.integration_id !== integrationID) return;
      const response = await api("GET", `/api/integrations/${integrationID}/events?limit=50`);
      if (!response.ok) return;
      const rows = document.querySelector("#event-log tbody");
      if (!rows) return;
      rows.innerHTML = "";
      response.body.items.forEach((entry) => {
        const row = document.createElement("tr");
        const cells = [
          localLabel(entry.at, document.body.dataset.zone || "UTC"),
          entry.action || "", entry.dedup_key || "", entry.outcome, entry.reason || "",
          entry.incident_number ? `#${entry.incident_number}` : "",
        ];
        cells.forEach((value, index) => {
          const cell = document.createElement("td");
          if (index === 0 || index === 2) cell.className = "mono";
          cell.textContent = value;
          row.appendChild(cell);
        });
        rows.appendChild(row);
      });
    });

    const replayDialog = document.getElementById("replay-dialog");
    document.querySelectorAll("button.replay").forEach((button) => {
      button.addEventListener("click", () => {
        replayDialog.deadLetter = button.dataset.deadLetter;
        document.getElementById("corrected-message").value = button.dataset.raw || "";
        openDialog(replayDialog, button);
      });
    });
    const replayCancel = document.getElementById("replay-cancel");
    if (replayCancel) replayCancel.addEventListener("click", () => closeDialog(replayDialog));
    const replayConfirm = document.getElementById("replay-confirm");
    if (replayConfirm) {
      replayConfirm.addEventListener("click", () => pending(replayConfirm, async () => {
        const raw = document.getElementById("corrected-message").value.trim();
        let body = {};
        if (raw) {
          try {
            body = { message: JSON.parse(raw) };
          } catch (err) {
            document.getElementById("replay-error").textContent = "Body is not valid JSON.";
            return;
          }
        }
        const response = await api("POST", `/api/dead-letters/${replayDialog.deadLetter}/replay`, body);
        if (response.ok) {
          closeDialog(replayDialog);
          announce("Replayed. The event applied once.");
          window.location.reload();
          return;
        }
        const error = response.body || {};
        document.getElementById("replay-error").textContent =
          (error.errors && error.errors.message) || "This dead letter could not be replayed.";
      }));
    }
  }

  // -------------------------------------------------------------- on call

  if (page === "oncall") {
    const figure = document.getElementById("oncall-figure");
    const timer = document.getElementById("handoff-countdown");
    const choice = document.getElementById("schedule-choice");
    if (choice) {
      choice.addEventListener("change", () => {
        document.body.dataset.schedule = choice.value;
        window.location.href = `/oncall?schedule=${choice.value}`;
      });
    }
    on("countdown", (message) => {
      const mine = (message.data.oncall || []).find((row) => row.schedule_id === document.body.dataset.schedule);
      if (mine) {
        if (figure) figure.textContent = mine.holder;
        if (timer) {
          timer.textContent = countdownText(mine.remaining_seconds);
          timer.dataset.remainingSeconds = String(mine.remaining_seconds);
        }
      }
      (message.data.oncall || []).forEach((row) => {
        const item = document.querySelector(`#holder-list li[data-schedule="${row.schedule_id}"] .holder-name`);
        if (item) item.textContent = row.holder;
      });
    });
    on("schedule", () => window.location.reload());
  }

  // ------------------------------------------------------------ analytics

  if (page === "analytics") {
    const bar = document.getElementById("analytics-progress");
    const text = document.getElementById("progress-text");
    let jobID = document.body.dataset.job;

    async function paintJob() {
      const response = await api("GET", `/api/analytics/jobs/${jobID}`);
      if (!response.ok) return;
      const job = response.body;
      bar.setAttribute("aria-valuenow", String(job.done));
      bar.setAttribute("aria-valuemax", String(job.total));
      text.textContent = `${job.done} of ${job.total} services measured`;
      if (job.state !== "done") {
        window.setTimeout(paintJob, 1000);
        return;
      }
      const rows = document.getElementById("measure-rows");
      rows.innerHTML = "";
      (job.rows || []).forEach((measure) => {
        rows.appendChild(measureRow(measure.name, measure.incidents, measure.mtta_minutes, measure.mttr_minutes));
      });
      if (job.overall) {
        rows.appendChild(measureRow("All services", job.overall.incidents, job.overall.mtta_minutes, job.overall.mttr_minutes));
        document.getElementById("overall-mtta").textContent = job.overall.mtta_minutes;
      }
      document.getElementById("download-csv").href = `/api/analytics/jobs/${jobID}/download`;
    }

    function measureRow(name, incidents, mtta, mttr) {
      const row = document.createElement("tr");
      [name, String(incidents), mtta, mttr].forEach((value, index) => {
        const cell = document.createElement("td");
        if (index > 1) cell.className = "mono";
        cell.textContent = value;
        row.appendChild(cell);
      });
      return row;
    }

    on("analytics", (message) => {
      if (message.data.job_id !== jobID) return;
      bar.setAttribute("aria-valuenow", String(message.data.done));
      bar.setAttribute("aria-valuemax", String(message.data.total));
      text.textContent = `${message.data.done} of ${message.data.total} services measured`;
    });

    const run = document.getElementById("run-analytics");
    if (run) {
      run.addEventListener("click", () => pending(run, async () => {
        const from = document.getElementById("from").value.trim();
        const to = document.getElementById("to").value.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
          showProblems(document, { from: "Use the format YYYY-MM-DD." });
          return;
        }
        const response = await api("POST", "/api/analytics/jobs", { from, to });
        if (!response.ok) {
          showProblems(document, (response.body || {}).errors);
          return;
        }
        jobID = response.body.id;
        const params = new URLSearchParams({ from, to, job: jobID });
        window.history.pushState({}, "", `/analytics?${params.toString()}`);
        paintJob();
      }));
    }
    paintJob();
  }

  // ---------------------------------------------------------------- admin

  if (page === "admin") {
    document.querySelectorAll(".role-choice").forEach((choice) => {
      choice.addEventListener("change", () => pending(choice, async () => {
        const response = await api("PATCH", `/api/users/${choice.dataset.person}`, { role: choice.value });
        if (response.ok) {
          announce("Saved.");
          return;
        }
        announce("That role change was refused.");
      }));
    });
    document.querySelectorAll(".sign-out-person").forEach((button) => {
      button.addEventListener("click", () => pending(button, async () => {
        await api("POST", `/api/users/${button.dataset.person}/sign-out`);
        announce("Saved.");
      }));
    });
    document.querySelectorAll(".remove-person").forEach((button) => {
      button.addEventListener("click", () => pending(button, async () => {
        const response = await api("DELETE", `/api/users/${button.dataset.person}`);
        const breaks = document.getElementById("removal-breaks");
        breaks.innerHTML = "";
        if (response.ok) {
          window.location.reload();
          return;
        }
        const error = response.body || {};
        (error.breaks || []).forEach((entry) => {
          const item = document.createElement("li");
          item.textContent = entry.policy
            ? `${entry.policy}: level ${entry.level}`
            : `${entry.schedule}: ${localLabel(entry.start, document.body.dataset.zone || "UTC")} to ${localLabel(entry.end, document.body.dataset.zone || "UTC")}`;
          breaks.appendChild(item);
        });
        announce(`${button.dataset.name} cannot be removed yet.`);
        button.focus();
      }));
    });

    const keyForm = document.getElementById("key-form");
    if (keyForm) {
      keyForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const button = document.getElementById("create-key");
        pending(button, async () => {
          const response = await api("POST", "/api/api-keys", {
            name: document.getElementById("key-name").value,
            scope: document.getElementById("key-scope").value,
          });
          if (response.ok) {
            document.getElementById("new-key").textContent = response.body.key;
            announce("Saved.");
            return;
          }
          showProblems(keyForm, (response.body || {}).errors);
        });
      });
    }
    document.querySelectorAll(".rotate-key").forEach((button) => {
      button.addEventListener("click", () => pending(button, async () => {
        const response = await api("POST", `/api/api-keys/${button.dataset.key}/rotate`, { grace_minutes: 60 });
        if (response.ok) {
          document.getElementById("new-key").textContent = response.body.key;
          announce("Saved.");
          window.setTimeout(() => window.location.reload(), 1500);
        }
      }));
    });
    document.querySelectorAll(".revoke-key").forEach((button) => {
      button.addEventListener("click", () => pending(button, async () => {
        await api("DELETE", `/api/api-keys/${button.dataset.key}`);
        window.location.reload();
      }));
    });

    const advance = document.getElementById("advance-clock");
    if (advance) {
      advance.addEventListener("click", () => pending(advance, async () => {
        const seconds = Number(document.getElementById("advance-seconds").value);
        const response = await api("POST", "/api/operator/clock", { advance_seconds: seconds });
        if (response.ok) {
          document.getElementById("clock-now").textContent = response.body.now;
          announce(`Clock moved to ${response.body.now}.`);
        }
      }));
    }
    const hold = document.getElementById("hold-clock");
    if (hold) {
      hold.addEventListener("change", () => pending(hold, async () => {
        const response = await api("POST", "/api/operator/clock", { frozen: hold.checked });
        if (response.ok) document.getElementById("clock-now").textContent = response.body.now;
      }));
    }
    on("clock", (message) => {
      const now = document.getElementById("clock-now");
      if (now && message.data.now) now.textContent = message.data.now;
    });
  }

  // ------------------------------------------------------------------- me

  if (page === "me") {
    const form = document.getElementById("settings-form");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const button = document.getElementById("save-settings");
        pending(button, async () => {
          const delays = document.getElementById("delays").value
            .split(",").map((value) => value.trim()).filter(Boolean);
          const body = {
            timezone: document.getElementById("time-zone").value,
            quiet_start: document.getElementById("quiet-start").value.trim() || null,
            quiet_end: document.getElementById("quiet-end").value.trim() || null,
            low_urgency_delay: Number(document.getElementById("low-delay").value),
          };
          if (delays.every((value) => /^\d+$/.test(value))) {
            body.notification_delays = delays.map(Number);
          } else {
            showProblems(form, { "notification-delays": "Use 1 to 5 whole minutes from 0 to 60, separated by commas." });
            return;
          }
          const response = await api("PATCH", "/api/me", body);
          if (response.ok) {
            showProblems(form, {});
            announce("Saved.");
            return;
          }
          showProblems(form, (response.body || {}).errors);
        });
      });
    }
    const create = document.getElementById("create-calendar");
    const regenerate = document.getElementById("regenerate-calendar");
    const revoke = document.getElementById("revoke-calendar");
    const makeToken = (button) => pending(button, async () => {
      const response = await api("POST", "/api/me/calendar-token");
      if (response.ok) document.getElementById("calendar-url").textContent = response.body.url;
    });
    if (create) create.addEventListener("click", () => makeToken(create));
    if (regenerate) regenerate.addEventListener("click", () => makeToken(regenerate));
    if (revoke) {
      revoke.addEventListener("click", () => pending(revoke, async () => {
        await api("DELETE", "/api/me/calendar-token");
        document.getElementById("calendar-url").textContent = "No calendar link yet.";
      }));
    }
  }

  // ------------------------------------------------------------- webhooks

  if (page === "webhooks") {
    const form = document.getElementById("endpoint-form");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const button = document.getElementById("add-endpoint");
        pending(button, async () => {
          const types = Array.from(document.querySelectorAll('input[name="event-type"]:checked')).map((box) => box.value);
          const scope = Array.from(document.querySelectorAll('input[name="scope"]:checked')).map((box) => box.value);
          const response = await api("POST", "/api/webhooks", {
            name: document.getElementById("endpoint-name").value,
            path: document.getElementById("receiver-path").value,
            event_types: types, service_ids: scope,
          });
          if (response.ok) {
            window.location.reload();
            return;
          }
          showProblems(form, (response.body || {}).errors);
        });
      });
    }
    document.querySelectorAll(".replay-delivery").forEach((button) => {
      button.addEventListener("click", () => pending(button, async () => {
        const response = await api("POST", `/api/webhook-deliveries/${button.dataset.delivery}/replay`);
        if (response.ok) {
          announce("Replay queued under the same event id.");
          window.setTimeout(() => window.location.reload(), 1200);
          return;
        }
        announce("That delivery is still running.");
      }));
    });
  }

  // ----------------------------------------------------------- status desk

  if (page === "status-desk") {
    const form = document.getElementById("update-form");
    const read = () => ({
      title: document.getElementById("update-title").value,
      body: document.getElementById("update-body").value,
      state: document.getElementById("update-state").value,
      service_ids: Array.from(document.querySelectorAll('input[name="affected"]:checked')).map((box) => box.value),
    });
    const saveDraft = document.getElementById("save-draft");
    if (saveDraft) {
      saveDraft.addEventListener("click", () => pending(saveDraft, async () => {
        const response = await api("POST", "/api/status-updates", read());
        if (response.ok) {
          announce("Saved.");
          window.location.reload();
          return;
        }
        showProblems(form, (response.body || {}).errors);
      }));
    }
    const publish = document.getElementById("publish-update");
    if (publish) {
      publish.addEventListener("click", () => pending(publish, async () => {
        const draft = await api("POST", "/api/status-updates", read());
        if (!draft.ok) {
          showProblems(form, (draft.body || {}).errors);
          return;
        }
        const response = await api("POST", `/api/status-updates/${draft.body.id}/publish`);
        if (response.ok) {
          announce(`Published. Notices to ${response.body.subscribers} subscribers are on their way.`);
          window.setTimeout(() => window.location.reload(), 1200);
        }
      }));
    }
    document.querySelectorAll("button.publish").forEach((button) => {
      button.addEventListener("click", () => pending(button, async () => {
        const response = await api("POST", `/api/status-updates/${button.dataset.update}/publish`);
        if (response.ok) {
          announce(`Published. Notices to ${response.body.subscribers} subscribers are on their way.`);
          window.setTimeout(() => window.location.reload(), 1200);
        }
      }));
    });
  }

  // ----------------------------------------------------------- maintenance

  if (page === "maintenance") {
    const form = document.getElementById("maintenance-form");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const button = document.getElementById("add-window");
        pending(button, async () => {
          const zone = document.body.dataset.zone || "UTC";
          const start = document.getElementById("window-start").value.trim();
          const end = document.getElementById("window-end").value.trim();
          const pattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
          const errors = {};
          if (!pattern.test(start)) errors["window-start"] = "Use the format YYYY-MM-DD HH:MM.";
          if (!pattern.test(end)) errors["window-end"] = "Use the format YYYY-MM-DD HH:MM.";
          if (Object.keys(errors).length) {
            showProblems(form, errors);
            return;
          }
          const response = await api("POST", "/api/maintenance-windows", {
            service_id: document.getElementById("window-service").value,
            starts_at: window.switchlamp.localToInstant(start, zone),
            ends_at: window.switchlamp.localToInstant(end, zone),
          });
          if (response.ok) {
            window.location.reload();
            return;
          }
          showProblems(form, (response.body || {}).errors);
        });
      });
    }
    document.querySelectorAll(".end-window").forEach((button) => {
      button.addEventListener("click", () => pending(button, async () => {
        await api("DELETE", `/api/maintenance-windows/${button.dataset.window}`);
        window.location.reload();
      }));
    });
  }
})();
