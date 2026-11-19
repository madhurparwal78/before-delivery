/* Hour detail dialog, spread dialog, and hour address handling. */
"use strict";

async function openHourDetail(state, hourKey, openerCell) {
  state.wallFocus = hourKey;
  const url = new URL(location.href);
  url.searchParams.set("hour", hourKey);
  history.pushState({}, "", url);
  const revisionAtOpen = state.window.revision;
  try {
    const hour = await api("GET", `/api/windows/${state.window.id}/hours/${encodeURIComponent(hourKey)}`);
    const { dlg, problems } = dialogShell("Hour detail");
    dlg.classList.add("pink");
    dlg.append(el("h2", { text: "Hour detail" }));
    const head = el("div", { class: "hour-head" });
    const paintHead = () => {
      head.replaceChildren(
        el("div", { text: `UTC hour ${hour.hour_utc}` }),
        el("div", { text: hour.local_label }),
        el("div", { class: "hour-consumed", text: `Consumed ${hour.consumed_wh === null ? "none" : fmtThousands(hour.consumed_wh)} Wh` }),
        el("div", { text: `Matched ${fmtThousands(hour.matched_wh)} Wh` }),
        el("div", { class: "hour-quality", text: hour.quality }),
      );
      if (hour.substitution_reason) {
        head.append(el("div", { text: `Reason ${hour.substitution_reason}` }));
      }
    };
    paintHead();
    dlg.append(head);
    const linesList = el("ul", { class: "hour-lines" });
    const paintLines = () => {
      linesList.replaceChildren();
      for (const line of hour.lines) {
        linesList.append(el("li", { text:
          `${line.lot_name || ""} ${fmtThousands(line.wh)} Wh, range ${fmtThousands(Number(line.range_start_wh))} to ${fmtThousands(Number(line.range_end_wh))}, ${line.status}` }));
      }
    };
    paintLines();
    dlg.append(linesList);

    let fieldsHost = null;
    let valueInput = null;
    let reasonInput = null;
    if ((hour.quality === "Missing" || hour.quality === "Estimated") && state.window.state === "Reconciling") {
      fieldsHost = el("div", { class: "substitution-fields" });
      valueInput = el("input", { type: "text", "aria-label": "Substitution value in watt-hours",
                                  "data-field": "value_wh" });
      reasonInput = el("textarea", { "aria-label": "Reason", "data-field": "reason", rows: "3" });
      const save = el("button", { text: "Save substitution" });
      save.addEventListener("click", async () => {
        clearProblems(dlg);
        if (!/^\d*$/.test(valueInput.value)) {
          showProblems(dlg, { fields: { value_wh: "Enter a whole number of watt-hours." } });
          return;
        }
        try {
          await api("PUT", `/api/windows/${state.window.id}/hours/${encodeURIComponent(hourKey)}/substitution`, {
            revision: revisionAtOpen,
            value_wh: Number(valueInput.value),
            reason: reasonInput.value,
          });
          closeDialog(dlg);
          await repaintAll(state);
        } catch (err) {
          if (err.code === "STALE_REVISION") {
            showProblems(dlg, err);
            if (!dlg.querySelector('button[data-retry]')) {
              const retry = el("button", { text: "Retry on latest", "data-retry": "1" });
              retry.addEventListener("click", async () => {
                clearProblems(dlg);
                try {
                  const fresh = await api("GET", `/api/windows/${state.window.id}`);
                  await api("PUT", `/api/windows/${state.window.id}/hours/${encodeURIComponent(hourKey)}/substitution`, {
                    revision: fresh.revision,
                    value_wh: Number(valueInput.value),
                    reason: reasonInput.value,
                  });
                  closeDialog(dlg);
                  await repaintAll(state);
                } catch (retryErr) { showProblems(dlg, retryErr); }
              });
              dlg.append(retry);
            }
            return;
          }
          showProblems(dlg, err);
        }
      });
      fieldsHost.append(valueInput, reasonInput, save);
      dlg.append(fieldsHost);
    }
    const close = el("button", { text: "Close" });
    close.addEventListener("click", () => { closeDialog(dlg); removeFromAddress("hour"); });
    dlg.append(close);
    openDialog(dlg, openerCell);
    dlg.dataset.hour = hourKey;
    state.hourDetail = { dlg, hourKey, revisionAtOpen };
    // live refresh keeps the panel open and the typed values intact
    const live = setInterval(async () => {
      if (!dlg.open && !dlg.isConnected) { clearInterval(live); return; }
      try {
        const fresh = await api("GET", `/api/windows/${state.window.id}/hours/${encodeURIComponent(hourKey)}`);
        hour.consumed_wh = fresh.consumed_wh;
        hour.quality = fresh.quality;
        hour.matched_wh = fresh.matched_wh;
        hour.lines = fresh.lines;
        paintHead(); paintLines();
      } catch { }
    }, 5000);
    state.hourDetailLive = live;
  } catch (err) {
    removeFromAddress("hour");
  }
}

function removeFromAddress(key) {
  const url = new URL(location.href);
  url.searchParams.delete(key);
  history.replaceState({}, "", url);
}

function openHourFromAddress(state) {
  const hour = new URLSearchParams(location.search).get("hour");
  if (!hour) return;
  if (!state.window || true) {
    const valid = wallData && wallData.buckets.some((b) => b.key === hour);
    if (!valid) { removeFromAddress("hour"); return; }
  }
  const cell = document.querySelector(`[data-hour="${hour}"]`);
  if (cell) openHourDetail(state, hour, cell);
}

/* --- Spread a total --------------------------------------------------------- */
function openSpreadDialog(state, deskStatus) {
  const opener = findAction("Spread a total");
  const focusCellKey = state.wallFocus;
  const { dlg, problems } = dialogShell("Spread a total");
  dlg.append(el("h2", { text: "Spread a total" }));
  const total = el("input", { type: "text", "aria-label": "Total in watt-hours", "data-field": "total_wh" });
  const reason = el("textarea", { "aria-label": "Reason", "data-field": "reason", rows: "3" });
  const spread = el("button", { text: "Spread" });
  const cancel = el("button", { text: "Cancel" });
  spread.addEventListener("click", async () => {
    clearProblems(dlg);
    if (!/^\d*$/.test(total.value)) {
      showProblems(dlg, { fields: { total_wh: "Enter a whole number of watt-hours." } });
      return;
    }
    try {
      const hours = Array.from(state.selection).sort();
      const result = await api("POST", `/api/windows/${state.window.id}/hours/spread`, {
        revision: state.window.revision, hours, total_wh: Number(total.value), reason: reason.value,
      });
      announce(deskStatus, `Spread done. ${hours.length} hours filled.`);
      announce(deskStatus, `Allocation done. Hour score ${pct(result.scores.hour_bp)} percent. ${result.unmatched_hours} unmatched hours.`);
      closeDialog(dlg);
      state.selection = new Set();
      const cell = document.querySelector(`[data-hour="${focusCellKey}"]`);
      if (cell) focusCell(cell);
      await repaintAll(state);
    } catch (err) {
      if (err.status === 409 && err.code === "STALE_REVISION") { showProblems(dlg, err); return; }
      showProblems(dlg, err);
    }
  });
  cancel.addEventListener("click", () => closeDialog(dlg));
  dlg.append(total, reason, spread, cancel);
  openDialog(dlg, opener);
}
