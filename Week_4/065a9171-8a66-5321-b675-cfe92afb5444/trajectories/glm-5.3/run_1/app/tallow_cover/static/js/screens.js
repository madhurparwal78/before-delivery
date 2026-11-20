/* Care worker and bank carer screens: shifts, leave, sickness, rota, profile. */

/* ---------- my shifts ---------- */

function shiftsScreen(container) {
  container.append(h("h1", { text: "My shifts" }));
  const status = statusLine("Clock status");
  const listHost = h("ul", { class: "shift-list", "aria-label": "Upcoming shifts" });
  const holidayHost = h("div", {});
  container.append(status, listHost, holidayHost);

  let openAttendance = null;
  let punchInFlight = false;
  let currentKey = null;

  async function load() {
    let data;
    try {
      data = await api.get("/api/me/shifts");
    } catch (err) { return; }
    openAttendance = data.open_attendance;
    clear(listHost);
    const oldPanel = container.querySelector(".open-attendance");
    if (oldPanel) oldPanel.remove();
    if (data.open_attendance) {
      const openAtt = data.open_attendance;
      const openPanel = h("div", { class: "open-attendance num" },
        h("span", { text: `Clocked in at ${hmOf(openAtt.clock_in_at)} for ${formatDateLabel(openAtt.date)} ${shiftWord(openAtt.shift)}.` }));
      container.insertBefore(openPanel, listHost);
    }
    for (const entry of data.assignments) {
      const label = `${shiftLabel(entry)} · ${hmOf(entry.starts_at)}–${hmOf(entry.ends_at)} · ${entry.hours} h`;
      const item = h("li", { class: "num" }, h("span", { text: label }),
        entry.status === "away" ? h("span", { class: "tag", text: "away" }) : null);
      listHost.append(item);
    }
    clear(holidayHost);
    if (data.holiday) {
      holidayHost.append(h("section", { class: "panel", "aria-label": "Holiday" },
        h("p", { class: "num", text: `${data.holiday.remaining_hours} of ${data.holiday.entitlement_hours} hours left this leave year` })));
    }
    renderButton();
  }

  function renderButton() {
    const existing = container.querySelector(".clock-host");
    if (existing) existing.remove();
    const button = h("button", { class: "btn", text: openAttendance ? "Clock out" : "Clock in",
      onclick: () => punch(openAttendance ? "out" : "in") });
    const host = h("div", { class: "clock-host" }, button);
    container.insertBefore(host, listHost);
  }

  async function punch(kind) {
    const button = container.querySelector(".clock-host button");
    if (punchInFlight || !button) return;
    punchInFlight = true;
    button.disabled = true;
    if (kind === "in") {
      if (!currentKey) currentKey = crypto.randomUUID();
      setStatus(status, "Clocking in…");
    } else {
      currentKey = crypto.randomUUID();
      setStatus(status, "Clocking out…");
    }
    let attempt = 0;
    while (true) {
      try {
        const result = await api.call("POST", "/api/punches", { kind },
          { "Idempotency-Key": currentKey });
        const at = hmOf(result.punch.at);
        if (kind === "in") {
          if (result.attendance.late) {
            const minutes = Math.round((new Date(result.attendance.clock_in_at) -
              new Date(result.attendance.rostered_start)) / 60000);
            setStatus(status, `Clocked in at ${at}, ${minutes} minutes late. Your manager will be asked to acknowledge it.`);
          } else {
            setStatus(status, `Clocked in at ${at} for ${shiftLabel(result.attendance)}.`);
          }
          currentKey = null;
        } else {
          setStatus(status, `Clocked out at ${at}. You worked ${result.attendance.worked_hours} hours.`);
        }
        break;
      } catch (err) {
        if (err.offline && attempt < 3) { attempt += 1; await new Promise((r) => setTimeout(r, 500)); continue; }
        if (kind === "in") currentKey = null;
        setStatus(status, err.message);
        break;
      }
    }
    punchInFlight = false;
    await load();
  }

  load();
  every(60, load);
}

/* ---------- request leave ---------- */

function leaveFormScreen(container) {
  container.append(h("h1", { text: "Request leave" }));
  const status = statusLine("Leave status");
  const type = selectField({ label: "Leave type", name: "type",
    options: [["annual", "Annual leave"], ["unpaid", "Unpaid leave"], ["compassionate", "Compassionate leave"]],
    value: "annual" });
  const firstDay = field({ label: "First day", name: "start_date", type: "date" });
  const lastDay = field({ label: "Last day", name: "end_date", type: "date" });
  const note = field({ label: "Note", name: "note", type: "textarea" });
  const saveDraft = h("button", { class: "btn secondary", text: "Save draft" });
  const submit = h("button", { class: "btn", text: "Submit request" });
  const wraps = { type, start_date: firstDay, end_date: lastDay, note };
  const form = h("form", { "aria-label": "Request leave", onsubmit: (event) => {
    event.preventDefault();
    void submitRequest(true);
  } }, type, h("div", { class: "form-row" }, firstDay, lastDay), note,
    h("div", { class: "action-row" }, saveDraft, submit), status);
  container.append(form);

  saveDraft.addEventListener("click", () => { void submitRequest(false); });

  async function submitRequest(doSubmit) {
    saveDraft.disabled = true;
    submit.disabled = true;
    setStatus(status, doSubmit ? "Submitting…" : "Saving draft…");
    try {
      const body = { type: type.input.value, start_date: firstDay.input.value,
        end_date: lastDay.input.value, note: note.input.value || undefined };
      if (doSubmit) body.submit = true;
      const request = await api.post("/api/leave-requests", body);
      showFieldErrors(wraps, null);
      const home = homeNameFor(App.me.home_id);
      if (doSubmit) {
        setStatus(status, request.short_notice
          ? `Request sent to ${home}. It's inside the notice period, so it's marked short notice.`
          : `Request sent to ${home}.`);
      } else {
        setStatus(status, "Draft saved.");
      }
      note.input.value = "";
    } catch (err) {
      if (err.body && err.body.errors) showFieldErrors(wraps, err.body.errors);
      setStatus(status, (err.body && err.body.errors) ? "Check the highlighted fields." : err.message);
    }
    saveDraft.disabled = false;
    submit.disabled = false;
  }
}

function homeNameFor(homeId) {
  const home = HOME_DIR.find((entry) => entry.id === homeId);
  return home ? home.name : "your home";
}

/* ---------- my requests ---------- */

function leaveListScreen(container) {
  container.append(h("h1", { text: "My requests" }));
  const list = h("ul", { class: "stack", "aria-label": "My requests" });
  container.append(list);
  async function load() {
    const data = await api.get("/api/me/leave-requests");
    clear(list);
    if (!data.items.length) {
      list.append(h("li", {}, h("p", { class: "muted", text: "No leave requests yet." })));
      return;
    }
    for (const request of data.items) {
      const name = `${TYPE_LABEL[request.type]}, ${formatDateLabel(request.start_date)} to ${formatDateLabel(request.end_date)}, ${STATUS_LABEL[request.status]}`;
      const link = h("a", { href: `/leave/${request.id}`, text: name });
      const item = h("li", { class: "link-row" },
        link,
        request.short_notice ? h("span", { class: "tag short-notice", text: "Short notice" }) : null);
      list.append(item);
    }
  }
  load();
}

/* ---------- leave detail ---------- */

function leaveDetailScreen(container) {
  const id = location.pathname.split("/")[2];
  const status = statusLine("Leave status");
  container.append(h("h1", { text: "Leave request" }), status);
  const detailHost = h("div", {});
  container.append(detailHost);

  async function load() {
    let request;
    try {
      request = await api.get(`/api/leave-requests/${id}`);
    } catch (err) {
      detailHost.append(h("p", { text: err.message }));
      return;
    }
    clear(detailHost);
    const isHr = App.me.role === "hr_admin";
    detailHost.append(h("div", { class: "panel" },
      h("p", {}, h("strong", { text: request.requester.display_name })),
      h("p", { class: "num", text: `${TYPE_LABEL[request.type]}, ${formatDateLabel(request.start_date)} to ${formatDateLabel(request.end_date)}` }),
      h("p", { class: "num", text: `${request.hours} hours booked` }),
      request.sickness_hours !== "0.00"
        ? h("p", { class: "num", text: `${request.sickness_hours} hours returned for sick days` }) : null,
      h("p", { text: STATUS_LABEL[request.status] }),
      request.short_notice ? h("p", {}, h("span", { class: "tag short-notice", text: "Short notice" })) : null,
      request.note ? h("p", { class: "muted", text: `Note: ${request.note}` }) : null,
      request.decision_reason ? h("p", { class: "muted", text: `Decision: ${request.decision_reason}` }) : null));
    const actions = [];
    if (request.requester.id === App.me.id) {
      if (["draft", "submitted", "escalated", "cover_pending", "approved"].includes(request.status)) {
        actions.push(h("button", { class: "btn secondary", text: "Withdraw request",
          onclick: () => withdraw(request) }));
      }
    }
    if (isHr && request.status === "approved") {
      actions.push(h("button", { class: "btn secondary", text: "Cancel leave",
        onclick: () => cancelDialog(request) }));
    }
    if (actions.length) detailHost.append(h("div", { class: "action-row" }, actions));
  }

  async function withdraw(request) {
    setStatus(status, "Withdrawing…");
    try {
      await api.post(`/api/leave-requests/${id}/withdraw`, {});
      setStatus(status, "Request withdrawn.");
      await load();
    } catch (err) {
      setStatus(status, err.message);
    }
  }

  function cancelDialog(request) {
    dialog({ title: "Cancel approved leave", build: (body, close) => {
      const reason = field({ label: "Reason", name: "reason", type: "textarea" });
      const confirm = h("button", { class: "btn", text: "Confirm cancellation" });
      const errorHost = h("div", {});
      confirm.addEventListener("click", async () => {
        setStatus(status, "Cancelling…");
        try {
          await api.post(`/api/leave-requests/${id}/cancel`, { reason: reason.input.value });
          setStatus(status, `Leave cancelled. ${request.requester.display_name} will be emailed.`);
          close();
          await load();
        } catch (err) {
          reason.showError(err.body && err.body.errors && err.body.errors.reason);
          setStatus(status, err.body && err.body.errors ? err.body.errors.reason || err.message : err.message);
        }
      });
      body.append(reason, h("div", { class: "action-row" }, confirm));
    }});
  }

  load();
}

/* ---------- sickness ---------- */

function sicknessListScreen(container) {
  container.append(h("h1", { text: "Sickness" }));
  const status = statusLine("Sickness status");
  const firstDay = field({ label: "First day off sick", name: "start_date", type: "date" });
  const reason = field({ label: "Reason", name: "reason", type: "textarea" });
  const report = h("button", { class: "btn", text: "Report sickness" });
  const wraps = { start_date: firstDay, reason };
  container.append(h("form", { "aria-label": "Report sickness", onsubmit: async (event) => {
    event.preventDefault();
    report.disabled = true;
    setStatus(status, "Reporting…");
    try {
      const record = await api.post("/api/sickness", {
        start_date: firstDay.input.value, reason: reason.input.value });
      showFieldErrors(wraps, null);
      setStatus(status, record.status === "fit_note_required"
        ? "Sickness reported. Please upload a fit note — you've been off more than 7 days."
        : "Sickness reported. Get well soon.");
      reason.input.value = "";
      await load();
    } catch (err) {
      showFieldErrors(wraps, err.body && err.body.errors);
      setStatus(status, err.body && err.body.errors ? "Check the highlighted fields." : err.message);
    }
    report.disabled = false;
  } }, h("div", { class: "form-row" }, firstDay, reason),
    h("div", { class: "action-row" }, report), status));

  const list = h("ul", { class: "stack" });
  container.append(list);
  async function load() {
    const data = await api.get("/api/me/sickness");
    clear(list);
    for (const record of data.items) {
      list.append(h("li", { class: "link-row" },
        h("a", { href: `/sickness/${record.id}`,
          text: `${formatDateLabel(record.start_date)} · ${sicknessStatusLabel(record)}` })));
    }
  }
  load();
}

function sicknessStatusLabel(record) {
  if (record.status === "fit_note_required") return "Fit note required";
  if (record.status === "evidenced") return "Evidenced";
  if (record.status === "closed") return "Closed";
  return "Reported";
}

function sicknessDetailScreen(container) {
  const id = location.pathname.split("/")[2];
  const status = statusLine("Sickness status");
  container.append(h("h1", { text: "Sickness record" }), status);
  const host = h("div", {});
  container.append(host);

  async function load() {
    let record;
    try {
      record = await api.get(`/api/sickness/${id}`);
    } catch (err) {
      host.append(h("p", { text: err.message }));
      return;
    }
    const mine = record.person.id === App.me.id;
    clear(host);
    host.append(h("div", { class: "panel" },
      h("p", { class: "num", text: `${formatDateLabel(record.start_date)} · ${sicknessStatusLabel(record)}` }),
      h("p", { class: "num", text: `${record.days} day${record.days === 1 ? "" : "s"}` })));
    if (mine) {
      const upload = h("input", { type: "file", id: "fit-note-file", "aria-label": "Fit note file" });
      const uploadBtn = h("button", { class: "btn secondary", text: "Upload fit note" });
      host.append(h("div", { class: "panel" },
        h("h3", { text: "Fit note" }),
        h("label", { for: "fit-note-file", text: "Fit note file" }), upload,
        h("div", { class: "action-row" }, uploadBtn)));
      uploadBtn.addEventListener("click", async () => {
        if (!upload.files.length) { setStatus(status, "Choose a PDF, JPEG or PNG of your fit note."); return; }
        if (upload.files[0].size > 5000000) {
          setStatus(status, "Fit notes can be up to 5,000,000 bytes.");
          return;
        }
        uploadBtn.disabled = true;
        setStatus(status, "Uploading fit note…");
        const form = new FormData();
        form.append("file", upload.files[0]);
        try {
          await api.call("POST", `/api/sickness/${id}/fit-note`, form);
          setStatus(status, "Fit note received. It is being stored securely.");
          await load();
        } catch (err) {
          setStatus(status, err.message);
        }
        uploadBtn.disabled = false;
      });
      if (record.fit_note) {
        const openBtn = h("button", { class: "btn secondary", text: "Open fit note" });
        openBtn.addEventListener("click", async () => {
          setStatus(status, "Opening…");
          try {
            const link = await api.get(`/api/sickness/${id}/fit-note`);
            const anchor = document.createElement("a");
            anchor.href = link.url;
            anchor.download = record.fit_note.file_name;
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            setStatus(status, `Downloading ${record.fit_note.file_name}.`);
          } catch (err) {
            setStatus(status, err.message);
          }
        });
        host.append(h("div", { class: "panel" }, openBtn));
      }
      const lastDay = field({ label: "Last day off sick", name: "last_sick_date", type: "date" });
      const back = h("button", { class: "btn", text: "I'm back at work" });
      host.append(h("form", { onsubmit: async (event) => {
        event.preventDefault();
        back.disabled = true;
        setStatus(status, "Saving…");
        try {
          await api.post(`/api/sickness/${id}/return`, { last_sick_date: lastDay.input.value });
          setStatus(status, "Welcome back. Sickness record closed.");
          await load();
        } catch (err) {
          lastDay.showError(err.body && err.body.errors && err.body.errors.last_sick_date);
          setStatus(status, err.message);
        }
        back.disabled = false;
      } }, h("div", { class: "panel" },
        lastDay, h("div", { class: "action-row" }, back))));
    }
  }
  load();
}

/* ---------- team rota ---------- */

function rotaScreen(container) {
  container.append(h("h1", { text: "Team rota" }));
  const status = statusLine("Rota status");
  const query = new URLSearchParams(location.search);
  let unitId = query.get("unit") ||
    (App.me.unit_id) ||
    (App.me.role === "hr_admin" ? "larchfield-rowan" : null);
  const homeFilter = query.get("home");
  if (!unitId && homeFilter) {
    const home = HOME_DIR.find((entry) => entry.id === homeFilter);
    unitId = home && home.units[0] && home.units[0].id;
  }
  if (!unitId) unitId = "larchfield-rowan";
  const unitPicker = selectField({ label: "Unit", name: "unit",
    options: HOME_DIR.flatMap((home) => home.units.map((unit) => [unit.id, `${home.name} · ${unit.name}`])),
    value: unitId });
  container.append(h("div", { class: "panel" }, unitPicker));
  container.append(status);

  const weekHost = h("div", {});
  container.append(weekHost);

  let fromDate = domainMonday(new Date().toISOString().slice(0, 10));
  const isManager = App.me.role === "unit_manager" || App.me.role === "hr_admin";

  async function load() {
    const data = await api.get(`/api/units/${unitId}/rota?from=${fromDate}`);
    clear(weekHost);
    const table = h("table", { class: "data", "aria-label": "Team rota" });
    const head = h("thead", {}, h("tr", {},
      h("th", { text: "Person" }),
      ...[0, 1, 2, 3, 4, 5, 6].map((offset) => {
        const day = new Date(Date.parse(data.from + "T00:00:00Z") + offset * 86400000);
        return h("th", { class: "num", text: day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) });
      })));
    table.append(head);
    const people = {};
    for (const entry of data.entries) {
      const key = entry.person.id;
      people[key] = people[key] || { name: entry.person.display_name,
        cells: { early: {}, late: {}, night: {} } };
      people[key].cells[entry.shift][entry.date] = entry;
    }
    const body = h("tbody", {});
    for (const personId of Object.keys(people).sort((a, b) =>
      people[a].name.localeCompare(people[b].name))) {
      const person = people[personId];
      const row = h("tr", { class: "hairline-row" },
        h("td", { text: person.name, "data-label": "Person" }));
      for (const [index, day] of [...Array(7).keys()].map((offset) =>
        new Date(Date.parse(data.from + "T00:00:00Z") + offset * 86400000)
          .toISOString().slice(0, 10))) {
        const cell = h("td", { "data-label": `Day ${index + 1}` });
        for (const shift of ["early", "late", "night"]) {
          const entry = person.cells[shift][day];
          if (!entry) continue;
          const label = `${formatDateLabel(entry.date)} ${shiftWord(entry.shift)}`;
          const cellHost = h("div", { class: "rota-cell" },
            h("span", { text: entry.is_you ? "You" : person.name }),
            entry.status === "away" ? h("span", { class: "muted", text: "away" }) : null);
          if (isManager) {
            cellHost.append(h("button", { class: "btn quiet", text: `Remove ${person.name} from ${label}`,
              "aria-label": `Remove ${person.name} from ${label}`,
              onclick: async () => {
                setStatus(status, "Saving…");
                try {
                  await api.del(`/api/rota/assignments/${entry.assignment_id}`);
                  setStatus(status, `${person.name} removed from ${label}.`);
                  await load();
                } catch (err) { setStatus(status, err.message); }
              } }));
          }
          cell.append(cellHost);
        }
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body);
    weekHost.append(table);

    if (isManager) {
      const addPanel = h("div", { class: "panel" }, h("h3", { text: "Add to a shift" }));
      for (const shift of ["early", "late", "night"]) {
        addPanel.append(h("p", { class: "small muted", text: `${shiftWord(shift)} shifts` }));
        addPanel.append(h("div", { class: "action-row" },
          [...Array(7).keys()].map((offset) => {
            const day = new Date(Date.parse(data.from + "T00:00:00Z") + offset * 86400000)
              .toISOString().slice(0, 10);
            const label = `${formatDateLabel(day)} ${shiftWord(shift)}`;
            return h("button", { class: "btn secondary", text: `Add to ${label}`,
              onclick: () => addDialog(unitId, day, shift) });
          })));
      }
      weekHost.append(addPanel);
    }
  }

  function addDialog(unitId, date, shift) {
    const label = `${formatDateLabel(date)} ${shiftWord(shift)}`;
    dialog({ title: "Add to shift", build: (body, close) => {
      const input = h("input", { type: "text", id: "colleague-input", role: "combobox",
        "aria-expanded": "true", "aria-controls": "colleague-results", "aria-label": "Colleague" });
      const host = h("ul", { class: "stack", id: "colleague-results", role: "listbox", "aria-label": "Colleague results" });
      const add = h("button", { class: "btn", text: "Add to shift" });
      add.disabled = true;
      let chosen = null;
      async function search(text) {
        const data = await api.get(`/api/homes/${homeIdForUnit(unitId)}/people?q=${encodeURIComponent(text)}`);
        clear(host);
        for (const person of data.items) {
          host.append(h("li", {}, h("button", { class: "btn quiet", type: "button",
            text: `${person.display_name} (${person.role === "bank_carer" ? "bank carer" : "care worker"}${person.skill === "senior" ? ", senior" : ""})`,
            onclick: () => {
              chosen = person;
              input.value = person.display_name;
              add.disabled = false;
              clear(host);
            } })));
        }
      }
      let searchTimer = null;
      input.addEventListener("input", () => {
        chosen = null;
        add.disabled = true;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => search(input.value), 200);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" && host.firstChild) { event.preventDefault(); host.firstChild.querySelector("button").focus(); }
      });
      host.addEventListener("keydown", (event) => {
        const items = Array.from(host.querySelectorAll("button"));
        const index = items.indexOf(event.target);
        if (event.key === "ArrowDown" && index > -1 && items[index + 1]) { event.preventDefault(); items[index + 1].focus(); }
        if (event.key === "ArrowUp" && index > -1 && items[index - 1]) { event.preventDefault(); items[index - 1].focus(); }
        if (event.key === "Enter" && index > -1) { event.preventDefault(); event.target.click(); }
      });
      add.addEventListener("click", async () => {
        if (!chosen) return;
        add.disabled = true;
        setStatus(status, "Saving…");
        try {
          await api.post("/api/rota/assignments", { person_id: chosen.id,
            unit_id: unitId, date, shift });
          setStatus(status, `${chosen.display_name} added to ${label}.`);
          close();
          await load();
        } catch (err) {
          add.disabled = false;
          setStatus(status, err.message);
        }
      });
      body.append(h("div", { class: "field" }, h("label", { for: "colleague-input", text: "Colleague" }), input),
        host, h("div", { class: "action-row" }, add));
      void search("");
    }});
  }

  const prev = h("button", { class: "btn secondary", text: "Previous week" });
  const next = h("button", { class: "btn secondary", text: "Next week" });
  prev.addEventListener("click", () => { fromDate = shiftWeek(fromDate, -7); void load(); });
  next.addEventListener("click", () => { fromDate = shiftWeek(fromDate, 7); void load(); });
  container.insertBefore(h("div", { class: "action-row" }, prev, next), weekHost);

  unitPicker.input.addEventListener("change", () => {
    unitId = unitPicker.input.value;
    navigate(`/rota?unit=${unitId}`, { replace: true });
  });

  load();
}

function domainMonday(isoDate) {
  const date = new Date(isoDate + "T00:00:00Z");
  const day = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - day * 86400000).toISOString().slice(0, 10);
}

function shiftWeek(isoDate, days) {
  return new Date(Date.parse(isoDate + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

function homeIdForUnit(unitId) {
  if (App.me.role === "unit_manager") return App.me.home_id;
  const home = HOME_DIR.find((entry) => entry.units.some((unit) => unit.id === unitId));
  return home ? home.id : "larchfield";
}

/* ---------- profile ---------- */

function profileScreen(container) {
  container.append(h("h1", { text: "Profile" }));
  const status = statusLine("Profile status");
  const name = field({ label: "Display name", name: "display_name", value: App.me.display_name });
  const save = h("button", { class: "btn", text: "Save name" });
  container.append(h("form", { "aria-label": "Profile", onsubmit: async (event) => {
    event.preventDefault();
    save.disabled = true;
    setStatus(status, "Saving…");
    try {
      const me = await api.patch("/api/me", { display_name: name.input.value });
      App.me = me;
      name.showError(null);
      setStatus(status, "Name updated.");
    } catch (err) {
      name.showError(err.body && err.body.errors && err.body.errors.display_name);
      setStatus(status, err.message);
    }
    save.disabled = false;
  } }, name, h("div", { class: "action-row" }, save), status,
    h("p", { class: "muted", text: App.me.email })));
}
