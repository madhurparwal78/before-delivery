/* Review queue, sampled-hour review, group scores, public check. */
"use strict";

/* --- Review queue -------------------------------------------------------------- */
const QUEUE_STATES = ["In review", "Cancelling", "Cancelled", "Signed"];

async function renderQueue() {
  let windows = [];
  try { windows = await api("GET", "/api/windows"); } catch (err) { return renderSignIn(); }
  const queue = windows
    .filter((w) => QUEUE_STATES.includes(w.state))
    .sort((a, b) => {
      const sa = QUEUE_STATES.indexOf(a.state), sb = QUEUE_STATES.indexOf(b.state);
      if (sa !== sb) return sa - sb;
      if (a.month !== b.month) return a.month < b.month ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
  const table = el("table", { "aria-label": "Review queue" });
  const tbody = el("tbody");
  const deskStatus = el("div", { role: "status", "aria-label": "Desk status" });
  if (!queue.length) {
    tbody.append(el("tr", {}, el("td", { colspan: "4", text: "NO WINDOWS TO REVIEW." })));
  }
  for (const win of queue) {
    const tr = el("tr", {},
      el("td", {}, link(`${win.site.name} ${win.month}`, `/review/${win.id}`)),
      el("td", { text: win.state }),
      el("td", { text: `${win.lines_confirmed} of 25 recorded` }));
    if (win.state === "In review" && win.review_seconds_left !== null) {
      const timer = el("span", { role: "timer", "aria-label": "Review time left",
                                 text: fmtCountdown(win.review_seconds_left) });
      timers.add({ remaining: win.review_seconds_left, asked: false, el: timer,
                   fetchUpdate: async () => {
                     const fresh = await api("GET", "/api/windows");
                     const row = fresh.find((w) => w.id === win.id);
                     return row ? row.review_seconds_left : null;
                   } });
      tr.append(el("td", {}, timer));
    }
    tbody.append(tr);
  }
  table.replaceChildren(tableHead(["Window", "State", "Recorded", "Time"]), tbody);
  const rotate = el("button", { id: nextId(), text: "Replace signing key" });
  rotate.addEventListener("click", async () => {
    const { dlg } = dialogShell("Replace signing key");
    const replace = el("button", { text: "Replace key" });
    const cancel = el("button", { text: "Cancel" });
    replace.addEventListener("click", async () => {
      try {
        await api("POST", `/api/firms/${ME.firm_id}/keys/rotate`, {});
        announce(deskStatus, "Signing key replaced. Earlier statements still check.");
        closeDialog(dlg);
      } catch (err) { showProblems(dlg, err); }
    });
    cancel.addEventListener("click", () => closeDialog(dlg));
    dlg.append(replace, cancel);
    openDialog(dlg, rotate);
  });
  const content = el("div", { class: "queue-page" },
    el("h1", { text: "YOUR REVIEW QUEUE." }),
    deskStatus, rotate, table);
  land(deskShell(content, "/review"));
}

/* --- Sampled-hour review -------------------------------------------------------- */
async function renderReview(windowId) {
  let win = null, sample = null;
  try {
    win = await api("GET", `/api/windows/${windowId}`);
    sample = await api("GET", `/api/windows/${windowId}/sample`);
  } catch (err) { return renderNotFound(); }
  const deskStatus = el("div", { role: "status", "aria-label": "Desk status" });
  const sealStatus = el("div", { role: "status", "aria-label": "Seal status" });

  const summary = el("section", { "aria-label": "Review summary" },
    el("div", { text: `Window ${win.state}` }),
    el("div", { text: `Allocation digest ${win.allocation_digest}` }),
    el("div", { text: `${sample.hours.filter((h) => h.result).length} of 25 recorded` }),
    el("div", { text: `Opinion ${win.opinion}` }));

  const list = el("ul", { "aria-label": "Sampled hours", class: "sample-list" });
  const evidence = el("section", { "aria-label": "Hour evidence", hidden: true });
  const hideEvidence = el("button", { text: "Hide evidence", hidden: true });

  async function record(hour, result, note) {
    await api("PUT", `/api/windows/${windowId}/sample/${encodeURIComponent(hour.hour_utc)}`,
      { result, note });
  }

  function drawEvidence(hour) {
    evidence.replaceChildren();
    evidence.append(
      el("div", { text: `UTC hour ${hour.hour_utc}` }),
      el("div", { text: `Consumed ${hour.consumed_wh === null ? "none" : fmtThousands(hour.consumed_wh)} Wh` }),
      el("div", { text: `Matched ${fmtThousands(hour.matched_wh)} Wh` }),
      el("div", { text: hour.quality }));
    for (const line of hour.lines) {
      evidence.append(el("div", { text:
        `${line.lot_name || ""} ${fmtThousands(line.wh)} Wh, range ${fmtThousands(Number(line.range_start_wh))} to ${fmtThousands(Number(line.range_end_wh))}, ${line.status}` }));
    }
  }

  function drawList() {
    list.replaceChildren();
    sample.hours.forEach((hour, index) => {
      const agree = el("button", { text: "Agree" });
      const exception = el("button", { text: "Exception" });
      const evidenceBtn = el("button", { text: "Evidence" });
      agree.addEventListener("click", async () => {
        await record(hour, "agree", null);
        hour.result = "agree";
        const recorded = sample.hours.filter((h) => h.result).length;
        announce(deskStatus, recorded === 25 ? "All 25 hours recorded." : `${recorded} of 25 recorded.`);
      });
      exception.addEventListener("click", () => {
        const { dlg, problems } = dialogShell("Record exception");
        const note = el("textarea", { "aria-label": "Exception note", "data-field": "note", rows: "3" });
        const save = el("button", { text: "Save exception" });
        const cancel = el("button", { text: "Cancel" });
        save.addEventListener("click", async () => {
          clearProblems(dlg);
          try {
            await record(hour, "exception", note.value);
            hour.result = "exception";
            closeDialog(dlg);
            const recorded = sample.hours.filter((h) => h.result).length;
            announce(deskStatus, recorded === 25 ? "All 25 hours recorded." : `${recorded} of 25 recorded.`);
          } catch (err) { showProblems(dlg, err); }
        });
        cancel.addEventListener("click", () => closeDialog(dlg));
        dlg.append(note, save, cancel);
        openDialog(dlg, exception);
      });
      evidenceBtn.addEventListener("click", () => {
        drawEvidence(hour);
        if (window.innerWidth < 768) {
          evidence.hidden = false;
          hideEvidence.hidden = false;
          hideEvidence.focus();
        } else {
          evidence.hidden = false;
        }
      });
      const item = el("li", {}, el("span", { text: hour.hour_utc }),
        agree, exception, evidenceBtn,
        el("span", { text: hour.result || "" }));
      list.append(item);
    });
  }
  hideEvidence.addEventListener("click", () => {
    evidence.hidden = true;
    hideEvidence.hidden = true;
    const btn = Array.from(list.querySelectorAll("button"))
      .find((b) => b.textContent === "Evidence");
    if (btn) btn.focus();
  });
  evidence.append(hideEvidence);
  drawList();
  if (window.innerWidth >= 768 && sample.hours.length) {
    evidence.hidden = false;
    hideEvidence.hidden = true;
    drawEvidence(sample.hours[0]);
  }

  // keyboard shortcuts on the sampled list
  list.addEventListener("keydown", async (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const item = event.target.closest("li");
    if (!item) return;
    const index = Array.from(list.children).indexOf(item);
    const hour = sample.hours[index];
    const buttons = Array.from(item.querySelectorAll("button"));
    if (event.key === "y") {
      event.preventDefault();
      const agreeBtn = buttons.find((b) => b.textContent === "Agree");
      if (agreeBtn.getAttribute("aria-disabled") === "true") return;
      agreeBtn.setAttribute("aria-disabled", "true");
      await record(hour, "agree", null);
      hour.result = "agree";
      const recorded = sample.hours.filter((h) => h.result).length;
      announce(deskStatus, recorded === 25 ? "All 25 hours recorded." : `${recorded} of 25 recorded.`);
      const nextItem = list.children[index + 1] || list.children[0];
      if (nextItem) {
        const nextAgree = Array.from(nextItem.querySelectorAll("button"))
          .find((b) => b.textContent === "Agree");
        nextAgree.focus();
      } else {
        findAction("Complete review")?.focus();
      }
      return;
    }
    if (event.key === "x") {
      event.preventDefault();
      buttons.find((b) => b.textContent === "Exception").click();
      return;
    }
    if (event.key === "n") {
      event.preventDefault();
      const nextItem = list.children[index + 1];
      if (nextItem) {
        const control = event.target.textContent;
        Array.from(nextItem.querySelectorAll("button")).find((b) => b.textContent === control)?.focus();
      }
      return;
    }
    if (event.key === "p") {
      event.preventDefault();
      const prevItem = list.children[index - 1];
      if (prevItem) {
        const control = event.target.textContent;
        Array.from(prevItem.querySelectorAll("button")).find((b) => b.textContent === control)?.focus();
      }
      return;
    }
  });

  const actions = el("section", { class: "review-actions" });
  if (win.state === "In review") {
    const complete = el("button", { text: "Complete review" });
    complete.addEventListener("click", async () => {
      try {
        const result = await api("POST", `/api/windows/${windowId}/review/complete`, {});
        win = result;
        renderRoute();
      } catch (err) { announce(deskStatus, err.message); }
    });
    const sendBack = el("button", { text: "Return window" });
    sendBack.addEventListener("click", () => {
      const { dlg, problems } = dialogShell("Return window");
      const reason = el("textarea", { "aria-label": "Reason", "data-field": "reason", rows: "3" });
      const send = el("button", { text: "Send back" });
      const cancel = el("button", { text: "Cancel" });
      send.addEventListener("click", async () => {
        clearProblems(dlg);
        try {
          await api("POST", `/api/windows/${windowId}/review/return`, { reason: reason.value });
          closeDialog(dlg);
          go("/review");
        } catch (err) { showProblems(dlg, err); }
      });
      cancel.addEventListener("click", () => closeDialog(dlg));
      dlg.append(reason, send, cancel);
      openDialog(dlg, sendBack);
    });
    actions.append(complete, sendBack);
  }
  if (win.state === "Cancelled") {
    const sign = el("button", { text: "Sign attestation" });
    sign.addEventListener("click", () => {
      const { dlg, problems } = dialogShell("Sign attestation");
      const name = el("input", { "aria-label": "Type your full name", "data-field": "typed_name" });
      const signBtn = el("button", { text: "Sign" });
      const cancel = el("button", { text: "Cancel" });
      signBtn.addEventListener("click", async () => {
        clearProblems(dlg);
        try {
          const result = await api("POST", `/api/windows/${windowId}/sign`, { typed_name: name.value });
          closeDialog(dlg);
          if (result.landing_url) { go(result.landing_url); return; }
          if (result.message) {
            announce(sealStatus, result.message);
            pollSeal(windowId, result.statement_code, sealStatus);
          }
        } catch (err) { showProblems(dlg, err); }
      });
      cancel.addEventListener("click", () => closeDialog(dlg));
      dlg.append(name, signBtn, cancel);
      openDialog(dlg, sign);
    });
    actions.append(sign);
  }
  const content = el("div", { class: "review-page" },
    el("h1", { text: `${win.site.name} ${win.month}` }),
    summary, list, evidence, actions, deskStatus, sealStatus);
  land(deskShell(content, "/review"));
}

function pollSeal(windowId, code, sealStatus) {
  const timer = setInterval(async () => {
    try {
      const win = await api("GET", `/api/windows/${windowId}`);
      if (win.seal_status === "sealed") {
        clearInterval(timer);
        go(`/check/${code}`);
      } else if (win.seal_status === "held_press" || win.seal_status === "held_store") {
        announce(sealStatus, win.seal_status === "held_press"
          ? "PDF PRESS IS DOWN. YOUR SIGNATURE IS SAFE."
          : "THE STORE IS DOWN. YOUR SIGNATURE IS SAFE.");
      }
    } catch { }
  }, 5000);
}
