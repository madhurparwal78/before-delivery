/* Manager and HR screens: Today, floors and policy, attendance, pay periods,
   exports and the audit log. */

function todayScreen(container) {
  const role = App.me.role;
  const home = role === "unit_manager" ? App.me.home_id
    : (new URLSearchParams(location.search).get("home") || HOME_DIR[0].id);
  const homeName = (HOME_DIR.find((entry) => entry.id === home) || {}).name || home;

  const status = statusLine("Today status");
  const host = h("div", {});
  container.append(status, host);

  async function load() {
    let data;
    try { data = await api.get(`/api/homes/${home}/today`); } catch (err) { return; }
    clear(host);
    const dateLabel = formatDateLabel(data.date);
    host.append(h("h1", { text: `Today, ${dateLabel}` }));
    const total = data.totals;
    host.append(h("p", { class: "summary num", text: `${total.on_duty} on duty · ${total.below_floor} shifts below floor` }));

    const table = h("table", { class: "data", "aria-label": "Staffing today" });
    table.append(h("thead", {}, h("tr", {},
      h("th", { text: "Unit" }), h("th", { text: "Shift" }), h("th", { text: "On duty" }),
      h("th", { text: "Floor" }), h("th", { text: "Seniors" }), h("th", { text: "Status" }))));
    const body = h("tbody", {});
    for (const unit of data.units) {
      for (const shift of unit.shifts) {
        const [shortfall, seniorShortfall] = [shift.shortfall, shift.senior_shortfall];
        let statusText = "At floor";
        if (shortfall > 0 && seniorShortfall > 0) statusText = `-${shortfall} below floor, no senior on shift`;
        else if (shortfall > 0) statusText = `-${shortfall} below floor`;
        else if (seniorShortfall > 0) statusText = "no senior on shift";
        body.append(h("tr", { class: `hairline-row num${shortfall > 0 || seniorShortfall > 0 ? " breached" : ""}` },
          h("td", { text: unit.name, "data-label": "Unit" }),
          h("td", { text: shiftWord(shift.shift), "data-label": "Shift" }),
          h("td", { text: String(shift.on_duty), "data-label": "On duty" }),
          h("td", { text: `${shift.floor.min_staff}/${shift.floor.min_seniors}`, "data-label": "Floor" }),
          h("td", { text: String(shift.seniors_on_duty), "data-label": "Seniors" }),
          h("td", { text: statusText, "data-label": "Status" })));
      }
    }
    table.append(body);
    const tableHost = h("div", { class: "panel", "aria-label": "Staffing today" }, table);
    host.append(tableHost);

    const lateHost = h("section", { "aria-label": "Late clock-ins" });
    lateHost.append(h("h2", { text: "Late clock-ins" }));
    const lateList = h("ul", { class: "stack", "aria-label": "Late clock-ins" });
    if (!data.late_clock_ins.length) {
      lateList.append(h("li", {}, h("p", { class: "muted", text: "No late clock-ins waiting." })));
    } else {
      for (const attendance of data.late_clock_ins) {
        const acknowledge = h("button", { class: "btn secondary",
          text: `Acknowledge ${attendance.person.display_name}`,
          onclick: async () => {
            acknowledge.disabled = true;
            setStatus(status, "Saving…");
            try {
              await api.post(`/api/attendance/${attendance.id}/acknowledge`, {});
              setStatus(status, "Acknowledged.");
              await load();
            } catch (err) { setStatus(status, err.message); acknowledge.disabled = false; }
          } });
        lateList.append(h("li", { class: "link-row" },
          h("span", { class: "num", text: `${attendance.person.display_name}, ${formatDateLabel(attendance.date)} ${shiftWord(attendance.shift)}` }),
          acknowledge));
      }
    }
    lateHost.append(lateList);

    const missedHost = h("section", { "aria-label": "Missed clock-outs" });
    missedHost.append(h("h2", { text: "Missed clock-outs" }));
    const missedList = h("ul", { class: "stack", "aria-label": "Missed clock-outs" });
    if (!data.missed_clock_outs.length) {
      missedList.append(h("li", {}, h("p", { class: "muted", text: "No missed clock-outs in the last 7 days." })));
    } else {
      for (const attendance of data.missed_clock_outs) {
        const label = `${formatDateLabel(attendance.date)} ${shiftWord(attendance.shift)}`;
        missedList.append(h("li", { class: "link-row" },
          h("span", { class: "num", text: `${attendance.person.display_name}, ${label}` }),
          h("a", { href: `/attendance?home=${home}&date=${attendance.date}`,
            text: `Correct ${attendance.person.display_name} ${label}` })));
      }
    }
    missedHost.append(missedList);
    host.append(h("div", { class: "today-side" }, lateHost, missedHost));
  }

  load();
  every(30, load);
}

/* ---------- floors and policy ---------- */

function floorsScreen(container) {
  const role = App.me.role;
  const home = role === "unit_manager" ? App.me.home_id
    : (new URLSearchParams(location.search).get("home") || HOME_DIR[0].id);
  const isHr = role === "hr_admin";
  const homeEntry = HOME_DIR.find((entry) => entry.id === home) || HOME_DIR[0];
  const status = statusLine("Admin status");
  const host = h("div", {});
  container.append(h("h1", { text: "Floors and policy" }), status, host);

  async function load() {
    const floors = await api.get(`/api/homes/${home}/floors`);
    const policy = await api.get(`/api/homes/${home}/leave-policy`);
    clear(host);
    const floorTable = h("table", { class: "data", "aria-label": "Floor versions" },
      h("thead", {}, h("tr", {},
        h("th", { text: "Unit" }), h("th", { text: "Shift" }),
        h("th", { text: "Minimum staff" }), h("th", { text: "Minimum seniors" }),
        h("th", { text: "Effective from" }))));
    const floorBody = h("tbody", {});
    for (const version of floors.versions) {
      const unit = homeEntry.units.find((entry) => entry.id === version.unit_id);
      floorBody.append(h("tr", { class: "hairline-row num" },
        h("td", { text: unit ? unit.name : version.unit_id, "data-label": "Unit" }),
        h("td", { text: shiftWord(version.shift), "data-label": "Shift" }),
        h("td", { text: `${version.min_staff}/${version.min_seniors}`, "data-label": "Minimum staff" }),
        h("td", { text: version.effective_from, "data-label": "Effective from" })));
    }
    floorTable.append(floorBody);
    host.append(h("h2", { text: "Floor versions" }), floorTable);

    if (isHr) {
      const unit = selectField({ label: "Unit", name: "unit",
        options: homeEntry.units.map((entry) => [entry.id, entry.name]) });
      const shift = selectField({ label: "Shift", name: "shift",
        options: [["early", "Early"], ["late", "Late"], ["night", "Night"]] });
      const minStaff = field({ label: "Minimum staff", name: "min_staff", type: "number" });
      const minSeniors = field({ label: "Minimum seniors", name: "min_seniors", type: "number" });
      const effective = field({ label: "Effective from", name: "effective_from", type: "date" });
      const save = h("button", { class: "btn", text: "Save floor version" });
      const wraps = { unit_id: unit, shift, min_staff: minStaff, min_seniors: minSeniors,
        effective_from: effective };
      host.append(h("form", { class: "panel", "aria-label": "New floor version",
        onsubmit: async (event) => {
          event.preventDefault();
          save.disabled = true;
          setStatus(status, "Saving…");
          try {
            const version = await api.post(`/api/homes/${home}/floors`, {
              unit_id: unit.input.value, shift: shift.input.value,
              min_staff: Number(minStaff.input.value), min_seniors: Number(minSeniors.input.value),
              effective_from: effective.input.value });
            showFieldErrors(wraps, null);
            setStatus(status, `Floor version saved. It applies from ${version.effective_from}.`);
            await load();
          } catch (err) {
            showFieldErrors(wraps, err.body && err.body.errors);
            setStatus(status, err.message);
          }
          save.disabled = false;
        } }, h("h3", { text: "New floor version" }),
        h("div", { class: "form-row" }, unit, shift),
        h("div", { class: "form-row" }, minStaff, minSeniors, effective),
        h("div", { class: "action-row" }, save)));
    }

    const policyTable = h("table", { class: "data", "aria-label": "Leave policy versions" },
      h("thead", {}, h("tr", {},
        h("th", { text: "Notice multiplier" }), h("th", { text: "Effective from" }))));
    const policyBody = h("tbody", {});
    for (const version of policy.versions) {
      policyBody.append(h("tr", { class: "hairline-row num" },
        h("td", { text: String(version.notice_multiplier), "data-label": "Notice multiplier" }),
        h("td", { text: version.effective_from, "data-label": "Effective from" })));
    }
    policyTable.append(policyBody);
    host.append(h("h2", { text: "Leave policy versions" }), policyTable);

    if (isHr) {
      const multiplier = field({ label: "Notice multiplier", name: "notice_multiplier", type: "number" });
      const effective = field({ label: "Effective from", name: "policy_effective_from", type: "date" });
      const save = h("button", { class: "btn", text: "Save leave policy" });
      const wraps = { notice_multiplier: multiplier, effective_from: effective };
      host.append(h("form", { class: "panel", "aria-label": "New leave policy",
        onsubmit: async (event) => {
          event.preventDefault();
          save.disabled = true;
          setStatus(status, "Saving…");
          try {
            const version = await api.post(`/api/homes/${home}/leave-policy`, {
              notice_multiplier: Number(multiplier.input.value),
              effective_from: effective.input.value });
            showFieldErrors(wraps, null);
            setStatus(status, `Leave policy saved. It applies from ${version.effective_from}.`);
            await load();
          } catch (err) {
            showFieldErrors(wraps, err.body && err.body.errors);
            setStatus(status, err.message);
          }
          save.disabled = false;
        } }, h("h3", { text: "New leave policy" }),
        h("div", { class: "form-row" }, multiplier, effective),
        h("div", { class: "action-row" }, save)));
    }
  }
  void load();
}

/* ---------- attendance ---------- */

function attendanceScreen(container) {
  const query = new URLSearchParams(location.search);
  const role = App.me.role;
  const home = query.get("home") || (role === "unit_manager" ? App.me.home_id : HOME_DIR[0].id);
  const date = query.get("date") || new Date().toISOString().slice(0, 10);
  const status = statusLine("Admin status");
  const host = h("div", {});
  container.append(h("h1", { text: "Attendance" }), status, host);

  async function load() {
    const data = await api.get(`/api/homes/${home}/attendance?date=${date}`).catch(() => null);
    if (!data) { host.append(h("p", { class: "muted", text: "No attendance for this day." })); return; }
    clear(host);
    const homeEntry = HOME_DIR.find((entry) => entry.id === home) || HOME_DIR[0];
    host.append(h("p", { class: "muted", text: `${homeEntry.name} · ${formatDateLabel(date)}` }));
    const table = h("table", { class: "data", "aria-label": "Attendance" },
      h("thead", {}, h("tr", {},
        h("th", { text: "Person" }), h("th", { text: "Shift" }),
        h("th", { text: "Clock in" }), h("th", { text: "Clock out" }),
        h("th", { text: "Worked hours" }), h("th", { text: "Late" }),
        h("th", { text: "Actions" }))));
    const body = h("tbody", {});
    for (const attendance of data.items) {
      const label = `${formatDateLabel(attendance.date)} ${shiftWord(attendance.shift)}`;
      body.append(h("tr", { class: "hairline-row num" },
        h("td", { text: attendance.person.display_name, "data-label": "Person" }),
        h("td", { text: label, "data-label": "Shift" }),
        h("td", { text: attendance.clock_in_at ? instantClock(attendance.clock_in_at) : "", "data-label": "Clock in" }),
        h("td", { text: attendance.clock_out_at ? instantClock(attendance.clock_out_at)
          : (attendance.missed_clock_out ? "Missed clock-out" : ""), "data-label": "Clock out" }),
        h("td", { text: attendance.worked_hours || "", "data-label": "Worked hours" }),
        h("td", { text: attendance.late ? (attendance.late_acknowledged ? "yes" : "yes, waiting") : "no", "data-label": "Late" }),
        h("td", {}, h("button", { class: "btn quiet",
          text: `Correct ${attendance.person.display_name} ${label}`,
          onclick: () => correctDialog(attendance, label) }))));
    }
    table.append(body);
    host.append(table);

    // add actions for rostered people without attendance on this day
    const taken = new Set(data.items.map((attendance) => attendance.assignment_id));
    const addHost = h("div", { class: "panel" }, h("h3", { text: "Add attendance" }));
    let addable = 0;
    for (const unit of homeEntry.units) {
      const rota = await api.get(`/api/units/${unit.id}/rota?from=${date}`).catch(() => null);
      if (!rota) continue;
      for (const entry of rota.entries) {
        if (entry.date !== date || taken.has(entry.assignment_id)) continue;
        const label = `${formatDateLabel(entry.date)} ${shiftWord(entry.shift)}`;
        addable += 1;
        addHost.append(h("button", { class: "btn secondary",
          text: `Add attendance for ${entry.person.display_name} ${label}`,
          onclick: () => addDialog(entry, label) }));
      }
    }
    if (addable) host.append(addHost);
  }

  function instantClock(iso) {
    return hmOf(iso);
  }

  function attendanceFields(body, clockIn, clockOut, reasonText) {
    const clockInField = field({ label: "Clock in", name: "clock_in_at", type: "datetime-local", value: clockIn });
    const clockOutField = field({ label: "Clock out", name: "clock_out_at", type: "datetime-local", value: clockOut });
    const reasonField = field({ label: "Reason", name: "reason", type: "textarea", value: reasonText });
    body.append(clockInField, clockOutField, reasonField);
    return { clock_in_at: clockInField, clock_out_at: clockOutField, reason: reasonField };
  }

  function toInstant(value) {
    if (!value) return null;
    // datetime-local carries no offset: apply Europe/London as it applies now.
    const now = new Date();
    const london = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
    const guessOffsetMinutes = (london - now) / 60000;
    const parsed = new Date(value);
    const shifted = new Date(parsed.getTime() - guessOffsetMinutes * 60000);
    return shifted.toISOString();
  }

  function correctDialog(attendance, label) {
    dialog({ title: "Correct attendance", build: (body, close) => {
      const wraps = attendanceFields(body,
        localValue(attendance.clock_in_at), localValue(attendance.clock_out_at),
        attendance.correction_note);
      const save = h("button", { class: "btn", text: "Save correction" });
      save.addEventListener("click", async () => {
        save.disabled = true;
        setStatus(status, "Saving correction…");
        try {
          await api.patch(`/api/attendance/${attendance.id}`, {
            clock_in_at: toInstant(wraps.clock_in_at.input.value),
            clock_out_at: toInstant(wraps.clock_out_at.input.value),
            reason: wraps.reason.input.value }, { "If-Match": `"${attendance.version}"` });
          setStatus(status, "Attendance corrected.");
          close();
          await load();
        } catch (err) {
          if (err.body && err.body.current) {
            const current = err.body.current;
            wraps.clock_in_at.input.value = localValue(current.clock_in_at);
            wraps.clock_out_at.input.value = localValue(current.clock_out_at);
            setStatus(status, err.message);
          } else {
            showFieldErrors(wraps, err.body && err.body.errors);
            setStatus(status, err.message);
          }
          save.disabled = false;
        }
      });
      body.append(h("div", { class: "action-row" }, save));
    }});
  }

  function localValue(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    const london = new Date(date.toLocaleString("en-US", { timeZone: "Europe/London" }));
    const pad = (n) => String(n).padStart(2, "0");
    return `${london.getFullYear()}-${pad(london.getMonth() + 1)}-${pad(london.getDate())}T${pad(london.getHours())}:${pad(london.getMinutes())}`;
  }

  function addDialog(rosterEntry, label) {
    dialog({ title: "Add attendance", build: (body, close) => {
      const clockIn = field({ label: "Clock in", name: "add_clock_in_at", type: "datetime-local",
        value: localValue(rosterEntry.starts_at) });
      const clockOut = field({ label: "Clock out", name: "add_clock_out_at", type: "datetime-local" });
      const reason = field({ label: "Reason", name: "add_reason", type: "textarea" });
      const save = h("button", { class: "btn", text: "Save correction" });
      const wraps = { clock_in_at: clockIn, clock_out_at: clockOut, reason };
      save.addEventListener("click", async () => {
        save.disabled = true;
        setStatus(status, "Saving correction…");
        try {
          await api.post("/api/attendance", {
            assignment_id: rosterEntry.assignment_id,
            clock_in_at: toInstant(clockIn.input.value),
            clock_out_at: toInstant(clockOut.input.value),
            reason: reason.input.value });
          setStatus(status, "Attendance added.");
          close();
          await load();
        } catch (err) {
          showFieldErrors(wraps, err.body && err.body.errors);
          setStatus(status, err.message);
          save.disabled = false;
        }
      });
      body.append(h("p", { text: `${rosterEntry.person.display_name}, ${label}` }),
        clockIn, clockOut, reason, h("div", { class: "action-row" }, save));
    }});
  }

  load();
}

/* ---------- pay periods ---------- */

function payPeriodsScreen(container) {
  container.append(h("h1", { text: "Pay periods" }));
  const status = statusLine("Admin status");
  const host = h("div", {});
  container.append(status, host);

  async function load() {
    const data = await api.get("/api/pay-periods");
    clear(host);
    const today = new Date();
    for (const period of data.items) {
      const label = monthLabel(period.period);
      const row = h("div", { class: "link-row" },
        h("span", { class: "num", text: label }),
        period.closed_at ? h("span", { class: "tag", text: "Closed" }) : null);
      if (!period.closed_at && periodEnded(period.period)) {
        const close = h("button", { class: "btn secondary", text: `Close ${label}` });
        close.addEventListener("click", async () => {
          close.disabled = true;
          setStatus(status, `Closing ${label}…`);
          try {
            const result = await api.post(`/api/pay-periods/${period.period}/close`, {});
            setStatus(status, `${label} closed. ${result.entries.length} ledger entries added.`);
            await load();
          } catch (err) {
            setStatus(status, err.message);
            close.disabled = false;
          }
        });
        row.append(close);
      }
      host.append(row);
    }
  }
  load();
}

function monthLabel(period) {
  const months = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  const [year, month] = period.split("-");
  return `${months[Number(month) - 1]} ${year}`;
}

function periodEnded(period) {
  const now = new Date();
  const [year, month] = period.split("-").map(Number);
  return now.getUTCFullYear() > year
    || (now.getUTCFullYear() === year && now.getUTCMonth() + 1 > month);
}

/* ---------- exports ---------- */

function exportsScreen(container) {
  container.append(h("h1", { text: "Exports" }));
  const status = statusLine("Admin status");
  const host = h("div", {});
  container.append(status, host);

  const period = field({ label: "Pay period", name: "period", value: previousMonth() });
  const checks = HOME_DIR.map((home) => {
    const input = h("input", { type: "checkbox", id: `home-${home.id}`, checked: true });
    const label = h("label", { for: `home-${home.id}` }, input, h("span", { text: home.name }));
    input.dataset.homeId = home.id;
    return { input, label, home };
  });
  const group = h("div", { class: "panel", role: "group", "aria-label": "Homes" },
    h("h3", { text: "Homes" }), checks.map((entry) => entry.label));
  const create = h("button", { class: "btn", text: "Export timesheets" });
  const wraps = { period };
  const form = h("form", { "aria-label": "Export timesheets", onsubmit: async (event) => {
    event.preventDefault();
    create.disabled = true;
    setStatus(status, "Preparing export…");
    const homeIds = checks.filter((entry) => entry.input.checked).map((entry) => entry.home.id);
    try {
      const result = await api.post("/api/exports/timesheets",
        { period: period.input.value, home_ids: homeIds });
      setStatus(status, `Timesheet export created: ${result.row_count} rows.`);
      await load();
    } catch (err) {
      showFieldErrors({ period }, err.body && err.body.errors);
      setStatus(status, err.body && err.body.errors ? "Check the highlighted fields." : err.message);
    }
    create.disabled = false;
  } }, period, group, h("div", { class: "action-row" }, create));
  container.append(form);

  const list = h("ul", { class: "stack", "aria-label": "Exports" });
  container.append(list);

  async function load() {
    const data = await api.get("/api/exports");
    clear(list);
    for (const exportItem of data.items) {
      const download = h("button", { class: "btn secondary",
        text: `Download ${exportItem.period} export`,
        onclick: async () => {
          setStatus(status, "Opening…");
          try {
            const link = await api.get(`/api/exports/${exportItem.id}/download`);
            const anchor = document.createElement("a");
            anchor.href = link.url;
            anchor.download = `timesheets-${exportItem.period}.csv`;
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
          } catch (err) { setStatus(status, err.message); }
        } });
      list.append(h("li", { class: "link-row" },
        h("span", { class: "num", text: `${exportItem.period} · ${exportItem.row_count} rows · ${exportItem.storage}` }),
        download));
    }
  }
  load();
}

function previousMonth() {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previous = new Date(first.getTime() - 86400000);
  return previous.toISOString().slice(0, 7);
}

/* ---------- audit log ---------- */

function auditScreen(container) {
  container.append(h("h1", { text: "Audit log" }));
  const role = App.me.role;
  const home = role === "unit_manager" ? App.me.home_id : null;
  const host = h("div", {});
  container.append(host);

  async function load() {
    const data = await api.get(`/api/audit${home ? `?home=${home}` : ""}`);
    clear(host);
    const table = h("table", { class: "data", "aria-label": "Audit log" },
      h("thead", {}, h("tr", {},
        h("th", { text: "When" }), h("th", { text: "Who" }), h("th", { text: "Action" }),
        h("th", { text: "Target" }), h("th", { text: "Before" }),
        h("th", { text: "After" }), h("th", { text: "Reason" }))));
    const body = h("tbody", {});
    for (const entry of data.items) {
      body.append(h("tr", { class: "hairline-row" },
        h("td", { class: "num", text: entry.at, "data-label": "When" }),
        h("td", { text: entry.actor.display_name, "data-label": "Who" }),
        h("td", { text: entry.action, "data-label": "Action" }),
        h("td", { class: "num", text: `${entry.target.type} ${entry.target.id}`, "data-label": "Target" }),
        h("td", { text: summarize(entry.before), "data-label": "Before" }),
        h("td", { text: summarize(entry.after), "data-label": "After" }),
        h("td", { text: entry.reason || "", "data-label": "Reason" })));
    }
    table.append(body);
    host.append(table);
  }
  load();
}

function summarize(state) {
  if (!state) return "—";
  if (state.status) return state.status;
  if (state.min_staff !== undefined) return `${state.min_staff}/${state.min_seniors} from ${state.effective_from}`;
  if (state.notice_multiplier !== undefined) return `×${state.notice_multiplier} from ${state.effective_from}`;
  return "…";
}
