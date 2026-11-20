/* The approval queue: filters in the address, request list, staffing strip,
   preview motion, cover posting and the decision dialogs. */

const REDUCED = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function queueScreen(container) {
  const query = new URLSearchParams(location.search);
  const role = App.me.role;
  const home = query.get("home") || (role === "unit_manager" ? App.me.home_id : "");
  const statusFilter = query.get("status") || "open";
  const week = query.get("week") || "";
  let selectedRequest = query.get("request") || null;

  container.append(h("h1", { text: "Queue" }));
  const status = statusLine("Queue status");
  const stripStatus = statusLine("Strip announcements");
  const statusFilterHost = h("div", {});
  container.append(status, stripStatus, statusFilterHost);

  const homeSelect = selectField({ label: "Home", name: "home",
    options: role === "hr_admin"
      ? [["", "All homes"], ...HOME_DIR.map((entry) => [entry.id, entry.name])]
      : HOME_DIR.map((entry) => [entry.id, entry.name]),
    value: home });
  const statusSelect = selectField({ label: "Status", name: "status",
    options: [["open", "Open"], ["submitted", "Submitted"], ["escalated", "Escalated"],
      ["cover_pending", "Cover pending"], ["approved", "Approved"],
      ["declined", "Declined"], ["withdrawn", "Withdrawn"], ["cancelled", "Cancelled"]],
    value: statusFilter });
  const weekSelect = selectField({ label: "Week", name: "week",
    options: weekOptions(), value: week });
  statusFilterHost.append(h("div", { class: "panel", role: "group",
    "aria-label": "Queue filters" },
    h("div", { class: "form-row" }, homeSelect, statusSelect, weekSelect)));
  const countsHost = h("div", { class: "counts", role: "region", "aria-label": "Queue counts" });
  container.append(countsHost);

  const requestSelect = h("select", { size: 12, "aria-label": "Requests" });
  const requestHost = h("div", { class: "requests-select" }, requestSelect);
  const detailHost = h("section", { class: "queue-detail", "aria-label": "Request detail" });
  container.append(h("div", { class: "queue-grid" }, requestHost, detailHost));

  // On narrow screens the detail replaces the list behind a Back to queue link.
  const narrow = () => window.matchMedia("(max-width: 640px)").matches;
  const backLink = h("a", { href: "#requests", class: "back-to-queue", text: "Back to queue" });
  backLink.addEventListener("click", (event) => {
    event.preventDefault();
    requestHost.style.display = "";
    detailHost.style.display = "none";
    backLink.remove();
  });
  requestSelect.addEventListener("change", () => {
    if (narrow()) {
      requestHost.style.display = "none";
      detailHost.style.display = "";
      if (!backLink.isConnected) detailHost.parentNode.insertBefore(backLink, detailHost);
    }
  });
  if (narrow()) {
    if (selectedRequest) {
      requestHost.style.display = "none";
      if (!backLink.isConnected) detailHost.parentNode.insertBefore(backLink, detailHost);
    } else {
      detailHost.style.display = "none";
    }
  }

  let requests = [];
  let preview = null;
  let previewOn = false;
  let cellHeights = [];

  homeSelect.input.addEventListener("change", () => {
    navigate(queueUrl({ home: homeSelect.input.value, request: null }));
  });
  statusSelect.input.addEventListener("change", () => {
    navigate(queueUrl({ status: statusSelect.input.value, request: null }));
  });
  weekSelect.input.addEventListener("change", () => {
    navigate(queueUrl({ week: weekSelect.input.value, request: null }));
  });

  function queueUrl(changes) {
    const params = new URLSearchParams();
    const nextHome = "home" in changes ? changes.home : home;
    const nextStatus = "status" in changes ? changes.status : statusFilter;
    const nextWeek = "week" in changes ? changes.week : week;
    const nextRequest = "request" in changes ? changes.request : selectedRequest;
    if (nextHome) params.set("home", nextHome);
    params.set("status", nextStatus);
    params.set("week", nextWeek);
    if (nextRequest) params.set("request", nextRequest);
    return `/queue?${params.toString()}`;
  }

  requestSelect.addEventListener("change", () => {
    selectedRequest = requestSelect.value || null;
    navigate(queueUrl({ request: selectedRequest }), { replace: true });
  });

  async function loadQueue() {
    const data = await api.get(`/api/queue${queueSearch()}`);
    requests = data.items;
    clear(requestSelect);
    if (!requests.length) {
      requestSelect.append(h("option", { value: "", text: "No requests match these filters." }));
      clear(detailHost);
      countsHost.textContent = countsLine(data.counts);
      return;
    }
    for (const request of requests) {
      requestSelect.append(h("option", { value: request.id,
        text: `${request.requester.display_name}, ${TYPE_LABEL[request.type]}, ${formatDateLabel(request.start_date)} to ${formatDateLabel(request.end_date)}, ${STATUS_LABEL[request.status]}` }));
    }
    if (!selectedRequest || !requests.some((entry) => entry.id === selectedRequest)) {
      selectedRequest = requests[0].id;
      history.replaceState({}, "", `/queue?${queueUrl({}).split("?")[1]}`);
    }
    requestSelect.value = selectedRequest;
    countsHost.textContent = countsLine(data.counts);
    await loadDetail();
  }

  function queueSearch() {
    const params = new URLSearchParams();
    if (home) params.set("home", home);
    params.set("status", statusFilter);
    if (week) params.set("week", week);
    return `?${params.toString()}`;
  }

  function countsLine(counts) {
    return `Submitted ${counts.submitted} · Escalated ${counts.escalated} · `
      + `Cover pending ${counts.cover_pending} · Approved ${counts.approved} · `
      + `Declined ${counts.declined}`;
  }

  async function loadDetail() {
    if (!selectedRequest) return;
    const request = requests.find((entry) => entry.id === selectedRequest);
    if (!request) return;
    clear(detailHost);
    detailHost.append(h("h2", { class: "requester-name", text: request.requester.display_name }),
      h("p", { class: "num", text: `${TYPE_LABEL[request.type]}, ${formatDateLabel(request.start_date)} to ${formatDateLabel(request.end_date)}` }),
      h("p", { class: "num", text: `${request.hours} hours` }),
      request.short_notice ? h("p", {}, h("span", { class: "tag short-notice", text: "Short notice" })) : null,
      request.note ? h("p", { class: "muted", text: `Note: ${request.note}` }) : null,
      h("p", { text: STATUS_LABEL[request.status] }));
    if (request.sickness_hours !== "0.00") {
      detailHost.append(h("p", { class: "num muted", text: `${request.sickness_hours} hours returned for sick days` }));
    }
    const previewBtn = h("button", { class: "btn secondary", text: "Preview approval",
      "aria-pressed": String(previewOn) });
    if (!request.unit_id) previewBtn.disabled = true;
    const stripHost = h("div", {});
    const chip = h("button", { class: "cover-chip", text: "Cover", draggable: "true" });
    detailHost.append(previewBtn, stripHost);
    preview = await api.get(`/api/leave-requests/${selectedRequest}/preview`).catch(() => null);
    if (!preview) return;

    renderStrip(stripHost, request, preview, null);

    previewBtn.addEventListener("click", () => {
      previewOn = !previewOn;
      previewBtn.setAttribute("aria-pressed", String(previewOn));
      renderStrip(stripHost, request, preview, previewOn ? "on" : "off");
      announceStrip();
    });

    let fromOffset = 0;
    const weekNav = async (delta) => {
      const candidate = fromOffset + delta;
      const from = new Date(Date.parse(request.start_date + "T00:00:00Z")
        + candidate * 7 * 86400000).toISOString().slice(0, 10);
      if (from < request.start_date || from > request.end_date) return;
      fromOffset = candidate;
      preview = await api.get(`/api/leave-requests/${selectedRequest}/preview?from=${from}`);
      renderStrip(stripHost, request, preview, null);
    };
    const prevWeek = h("button", { class: "btn secondary", text: "Previous 7 days",
      onclick: () => void weekNav(-1) });
    const nextWeek = h("button", { class: "btn secondary", text: "Next 7 days",
      onclick: () => void weekNav(1) });
    const approve = h("button", { class: "btn", text: "Approve" });
    const override = h("button", { class: "btn secondary", text: "Approve with override" });
    const decline = h("button", { class: "btn secondary", text: "Decline" });
    const awaiting = ["submitted", "escalated", "cover_pending"].includes(request.status);
    if (!preview.approvable || !awaiting) {
      approve.disabled = true;
      approve.setAttribute("aria-description", "Cover every gap or approve with override");
    }
    if (!awaiting || !preview.breach_labels.length) override.disabled = true;

    approve.addEventListener("click", () => void decide("approve"));
    override.addEventListener("click", () => overrideDialog(request));
    decline.addEventListener("click", () => declineDialog(request));

    if (preview.shifts.length) detailHost.append(chip);
    detailHost.append(h("div", { class: "action-row" }, prevWeek, nextWeek,
      approve, override, decline));
    setupDrag(chip, stripHost);

    async function decide(action, body) {
      setStatus(status, "Approving…");
      try {
        await api.post(`/api/leave-requests/${selectedRequest}/${action}`, body || {});
        setStatus(status, `Approved. ${request.requester.display_name} will be emailed the decision.`);
        previewOn = false;
        await loadQueue();
      } catch (err) {
        setStatus(status, `Can't approve: ${err.message}`);
        preview = await api.get(`/api/leave-requests/${selectedRequest}/preview`);
        renderStrip(stripHost, request, preview, null);
        announceStrip();
      }
    }

    function overrideDialog(request) {
      dialog({ title: "Approve with override", build: (body, close) => {
        const reason = field({ label: "Override reason", name: "override_reason", type: "textarea" });
        const confirm = h("button", { class: "btn", text: "Confirm approval" });
        confirm.addEventListener("click", async () => {
          try {
            await api.post(`/api/leave-requests/${selectedRequest}/approve`,
              { override_reason: reason.input.value });
            setStatus(status, `Approved. ${request.requester.display_name} will be emailed the decision.`);
            close();
            previewOn = false;
            await loadQueue();
          } catch (err) {
            reason.showError(err.body && err.body.errors && err.body.errors.override_reason);
            setStatus(status, `Can't approve: ${err.message}`);
          }
        });
        body.append(h("p", { text: `Approving past: ${preview.breach_labels.join(", ")}` }),
          reason, h("div", { class: "action-row" }, confirm));
      }});
    }

    function declineDialog(request) {
      dialog({ title: "Decline request", build: (body, close) => {
        const reason = field({ label: "Reason", name: "reason", type: "textarea" });
        const confirm = h("button", { class: "btn", text: "Confirm decline" });
        confirm.addEventListener("click", async () => {
          setStatus(status, "Declining…");
          try {
            await api.post(`/api/leave-requests/${selectedRequest}/decline`,
              { reason: reason.input.value });
            setStatus(status, `Declined. ${request.requester.display_name} will be emailed the decision.`);
            close();
            await loadQueue();
          } catch (err) {
            reason.showError(err.body && err.body.errors && err.body.errors.reason);
            setStatus(status, err.message);
          }
        });
        body.append(reason, h("div", { class: "action-row" }, confirm));
      }});
    }
  }

  function announceStrip() {
    if (!previewOn || !preview || !preview.shifts.length) { setStatus(stripStatus, ""); return; }
    const count = preview.uncovered_breaches;
    const word = count === 1 ? "shift" : "shifts";
    setStatus(stripStatus, count === 0
      ? "Approving keeps every shift at or above its floor."
      : `Approving would leave ${count} ${word} below floor: ${preview.breach_labels.join(", ")}`);
  }

  function shownCounts(entry) {
    return previewOn ? [entry.on_duty_if_approved, entry.seniors_if_approved]
      : [entry.on_duty, entry.seniors_on_duty];
  }

  function shownShortfalls(entry) {
    if (!previewOn) {
      return [Math.max(0, entry.floor.min_staff - entry.on_duty),
        Math.max(0, entry.floor.min_seniors - entry.seniors_on_duty)];
    }
    return [entry.shortfall, entry.senior_shortfall];
  }

  function cellName(entry) {
    const [on] = shownCounts(entry);
    let name = `${entry.label}: ${on} on duty, floor ${entry.floor.min_staff}`;
    const [shortfall, seniorShortfall] = shownShortfalls(entry);
    if (shortfall > 0) name += `, -${shortfall} below floor`;
    if (seniorShortfall > 0) name += ", no senior on shift";
    return name;
  }

  function renderStrip(stripHost, request, previewData, direction) {
    clear(stripHost);
    if (!previewData.shifts.length) {
      stripHost.append(h("div", { class: "panel", role: "group", "aria-label": "Staffing strip" },
        h("p", { text: `${request.requester.display_name} isn't on a unit rota, so approving changes no shift.` })));
      return;
    }
    const strip = h("div", { class: "strip", role: "group", "aria-label": "Staffing strip",
      tabindex: "0" });
    const floorHost = h("div", { class: "floor-line" });
    const animateCells = [];
    previewData.shifts.forEach((entry, index) => {
      const [on] = shownCounts(entry);
      const [shortfall, seniorShortfall] = shownShortfalls(entry);
      const breached = shortfall > 0 || seniorShortfall > 0;
      const cell = h("div", {
        class: `strip-cell num${breached ? " breached" : ""}${entry.affected && previewOn ? " changed" : ""}`,
        role: "group", tabindex: "-1", "aria-label": cellName(entry) });
      const bar = h("div", { class: "bar" });
      const before = entry.on_duty;
      const count = h("span", { class: "count-num",
        text: REDUCED() && previewOn && entry.affected && before !== on
          ? `${before} → ${on}` : String(on) });
      const label = h("span", { class: "cell-label", text: shortLabelFor(entry.date, entry.shift) });
      cell.append(bar, count, label);
      if (breached) {
        const notes = [];
        if (shortfall > 0) notes.push(`-${shortfall} below floor`);
        if (seniorShortfall > 0) notes.push("no senior on shift");
        cell.append(h("span", { class: "breach-note", text: notes.join(", ") }));
      }
      if (previewOn) {
        entry.gaps.forEach((gap) => {
          const slot = h("button", { class: `ghost-slot${gap.cover ? " posted" : ""}`,
            text: gap.cover ? "cover posted" : "" });
          slot.setAttribute("aria-label",
            `Post cover for ${entry.label} (${gap.skill === "senior" ? "Senior" : "Carer"})`);
          if (!gap.cover) slot.addEventListener("click", () => void postCover(entry, gap, slot));
          cell.append(slot);
        });
      }
      strip.append(cell);
      const top = previewData.scale_max
        ? 100 - (entry.floor.min_staff / previewData.scale_max) * 100 : 100;
      const seg = h("span", {});
      seg.style.top = `${top}%`;
      seg.style.left = `${(index / 21) * 100}%`;
      seg.style.width = `${100 / 21}%`;
      floorHost.append(seg);
      const previousHeight = cellHeights[index];
      const targetHeight = previewData.scale_max
        ? Math.max(2, (on / previewData.scale_max) * 100) : 2;
      bar.style.height = (previousHeight === undefined || REDUCED() || direction === null)
        ? `${targetHeight}%` : `${previousHeight}%`;
      if (!REDUCED() && direction !== null
          && Math.abs((previousHeight || 0) - targetHeight) > 0.5) {
        animateCells.push({ bar, targetHeight, index });
      }
    });
    strip.append(floorHost);
    stripHost.append(h("div", { class: "strip-wrap" }, strip));

    strip.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const list = Array.from(strip.querySelectorAll(".strip-cell"));
        const index = list.indexOf(document.activeElement);
        const next = event.key === "ArrowRight"
          ? Math.min(index + 1, list.length - 1) : Math.max(index - 1, 0);
        if (index > -1) { event.preventDefault(); list[next].focus(); }
      }
    });

    cellHeights = previewData.shifts.map((entry) => {
      const [on] = shownCounts(entry);
      return previewData.scale_max ? Math.max(2, (on / previewData.scale_max) * 100) : 2;
    });

    if (animateCells.length && !REDUCED()) {
      const ordered = direction === "off" ? [...animateCells].reverse() : animateCells;
      requestAnimationFrame(() => {
        ordered.forEach((item, position) => {
          setTimeout(() => { item.bar.style.height = `${item.targetHeight}%`; },
            position * 40);
        });
      });
    }

    renderDayStrip(stripHost, previewData);
  }

  function renderDayStrip(stripHost, previewData) {
    const days = h("div", { class: "strip-days", role: "group", "aria-label": "Staffing strip" });
    const byDay = new Map();
    for (const entry of previewData.shifts) {
      if (!byDay.has(entry.date)) byDay.set(entry.date, []);
      byDay.get(entry.date).push(entry);
    }
    for (const [date, entries] of byDay) {
      const cells = entries.map((entry) => {
        const [on] = shownCounts(entry);
        const [shortfall, seniorShortfall] = shownShortfalls(entry);
        const breached = shortfall > 0 || seniorShortfall > 0;
        const width = previewData.scale_max ? (on / previewData.scale_max) * 100 : 0;
        const cell = h("div", {
          class: `day-cell num${breached ? " breached" : ""}${entry.affected && previewOn ? " changed" : ""}`,
          role: "group", "aria-label": cellName(entry) });
        const floorX = previewData.scale_max
          ? Math.min(99, (entry.floor.min_staff / previewData.scale_max) * 100) : 99;
        cell.append(h("div", { class: "bar-track" },
          h("div", { class: "bar", style: `width:${Math.max(4, width)}%` }),
          h("div", { class: "day-floor", style: `left:${floorX}%` })),
          h("span", { class: "count-num", text: String(on) }));
        if (breached) {
          const notes = [];
          if (shortfall > 0) notes.push(`-${shortfall} below floor`);
          if (seniorShortfall > 0) notes.push("no senior on shift");
          cell.append(h("span", { class: "breach-note", text: notes.join(", ") }));
        }
        if (previewOn) {
          entry.gaps.forEach((gap) => {
            const slot = h("button", { class: `ghost-slot${gap.cover ? " posted" : ""}`,
              text: gap.cover ? "cover posted" : "",
              "aria-label": `Post cover for ${entry.label} (${gap.skill === "senior" ? "Senior" : "Carer"})` });
            if (!gap.cover) slot.addEventListener("click", () => void postCover(entry, gap, slot));
            cell.append(slot);
          });
        }
        return cell;
      });
      days.append(h("div", { class: "day-strip" },
        h("div", { class: "day-label", text: formatDateLabel(date) }),
        h("div", { class: "day-cells" }, cells)));
    }
    stripHost.append(days);
  }

  async function postCover(entry, gap, slot) {
    setStatus(status, "Posting cover…");
    try {
      await api.post(`/api/leave-requests/${selectedRequest}/covers`,
        { date: entry.date, shift: entry.shift, skill: gap.skill });
      setStatus(status, `Cover posted for ${entry.label}. Eligible bank carers will be emailed.`);
      slot.classList.add("posted");
      slot.textContent = "cover posted";
      await loadQueue();
    } catch (err) {
      setStatus(status, err.message);
    }
  }

  function setupDrag(chip, stripHost) {
    chip.addEventListener("dragstart", (event) => {
      chip.classList.add("dragging");
      event.dataTransfer.setData("text/plain", "cover");
    });
    chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
    stripHost.addEventListener("dragover", (event) => event.preventDefault());
    stripHost.addEventListener("drop", (event) => {
      event.preventDefault();
      const slot = event.target.closest(".ghost-slot");
      if (slot && !slot.classList.contains("posted")) slot.click();
    });
  }

  void loadQueue();
  every(5, async () => {
    if (!selectedRequest || !preview) return;
    const next = await api.get(`/api/leave-requests/${selectedRequest}/preview`).catch(() => null);
    if (!next) return;
    const changed = JSON.stringify(next) !== JSON.stringify(preview);
    preview = next;
    if (!changed) return;
    const request = requests.find((entry) => entry.id === selectedRequest);
    if (!request) return;
    const stripHost = detailHost.querySelector(".strip-wrap");
    if (stripHost) {
      const host = stripHost.parentElement;
      renderStrip(host, request, preview, null);
      if (previewOn) announceStrip();
    }
  });
}

function weekOptions() {
  const options = [["", "All weeks"]];
  const today = new Date();
  for (let offset = -2; offset <= 8; offset += 1) {
    const base = new Date(today.getTime() + offset * 7 * 86400000);
    const day = (base.getDay() + 6) % 7;
    const monday = new Date(base.getTime() - day * 86400000);
    options.push([isoWeek(monday),
      `Week of ${monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`]);
  }
  return options;
}

function isoWeek(date) {
  const target = new Date(date);
  const day = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  return `${target.getUTCFullYear()}-W${String(1 + Math.round((target - firstThursday) / (7 * 86400000))).padStart(2, "0")}`;
}
