"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/client/api.ts
  async function api(method, path, body, opts = {}) {
    const headers = {};
    if (body !== void 0) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    const res = await fetch(path, {
      method,
      headers,
      body: body === void 0 ? void 0 : JSON.stringify(body),
      credentials: "same-origin"
    });
    if (res.status === 204) return void 0;
    let data = null;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("json")) data = await res.json();
    else data = await res.text();
    if (!res.ok) {
      throw new ApiFail(res.status, data);
    }
    return data;
  }
  async function fetchClock() {
    const c = await api("GET", "/api/clock");
    clockBase = Date.parse(c.now.replace("+05:30", "Z"));
    clockFetchedAt = performance.now();
    clockRate = c.rate;
    return c;
  }
  function businessNowMs() {
    return clockBase + (performance.now() - clockFetchedAt) * clockRate;
  }
  function businessNowStamp() {
    const ms = businessNowMs();
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+05:30`;
  }
  var ApiFail, clockBase, clockFetchedAt, clockRate;
  var init_api = __esm({
    "src/client/api.ts"() {
      "use strict";
      ApiFail = class extends Error {
        constructor(status, body) {
          super(body.message);
          this.status = status;
          this.body = body;
        }
      };
      clockBase = 0;
      clockFetchedAt = 0;
      clockRate = 1;
    }
  });

  // src/client/ui.ts
  async function loadAccount() {
    if (accountKnown) return account;
    try {
      const r = await fetch("/api/me", { credentials: "same-origin" });
      if (r.ok) {
        account = await r.json();
      } else {
        account = null;
      }
    } catch {
      account = null;
    }
    accountKnown = true;
    return account;
  }
  function currentAccount() {
    return account;
  }
  function setAccount(a) {
    account = a;
    accountKnown = true;
  }
  function statusRegion(name, text) {
    let el2 = document.querySelector(`[data-status="${name}"]`);
    if (!el2) {
      el2 = document.createElement("div");
      el2.setAttribute("data-status", name);
      el2.className = "status-line";
      el2.setAttribute("role", "status");
      el2.setAttribute("aria-label", name);
    }
    el2.textContent = text;
    return el2;
  }
  function setStatus(name, text) {
    const el2 = statusRegion(name, text);
    if (!el2.isConnected) document.getElementById("live-regions")?.appendChild(el2);
  }
  function alertRegion(name, html) {
    let el2 = document.querySelector(`[data-alert="${name}"]`);
    if (!el2) {
      el2 = document.createElement("div");
      el2.setAttribute("data-alert", name);
      el2.setAttribute("role", "alert");
      el2.setAttribute("aria-label", name);
    }
    el2.innerHTML = html;
    return el2;
  }
  function setAlert(name, html, focusIt = false) {
    const el2 = alertRegion(name, html);
    if (!el2.isConnected) document.getElementById("live-regions")?.appendChild(el2);
    if (focusIt) el2.focus();
    return el2;
  }
  function clearAlert(name) {
    document.querySelector(`[data-alert="${name}"]`)?.remove();
  }
  function openDialog(build, opener, initialFocus) {
    const el2 = document.createElement("dialog");
    el2.className = "sheet";
    build(el2);
    document.body.appendChild(el2);
    let revert = () => {
      el2.close();
      el2.remove();
      document.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        revert();
        opener?.focus();
        return;
      }
      if (e.key === "Tab") {
        const focusables = Array.from(el2.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((x) => x.offsetParent !== null || x === el2);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (!el2.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    el2.addEventListener("close", () => {
      document.removeEventListener("keydown", onKey, true);
      el2.remove();
    });
    el2.showModal();
    const target = initialFocus ? el2.querySelector(initialFocus) : null;
    (target ?? el2.querySelector("button, input, select, a[href]"))?.focus();
    const originalRevert = revert;
    revert = () => {
      setInertBehind(el2, false);
      originalRevert();
    };
    setInertBehind(el2, true);
    return {
      el: el2,
      close: revert
    };
  }
  function setInertBehind(el2, inert) {
    for (const child of Array.from(document.body.children)) {
      if (child === el2) continue;
      if (inert) {
        child.inert = true;
        child.setAttribute("aria-hidden", "true");
      } else {
        child.inert = false;
        child.removeAttribute("aria-hidden");
      }
    }
  }
  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== void 0) e.textContent = text;
    return e;
  }
  function nextId(prefix) {
    idCounter += 1;
    return `${prefix}-${idCounter}`;
  }
  var account, accountKnown, idCounter;
  var init_ui = __esm({
    "src/client/ui.ts"() {
      "use strict";
      account = null;
      accountKnown = false;
      idCounter = 0;
    }
  });

  // src/client/format.ts
  function formatPaise(paise) {
    const neg = paise < 0;
    const whole = Math.floor(Math.abs(paise) / 100);
    const frac = String(Math.abs(paise) % 100).padStart(2, "0");
    const s = String(whole).replace(/(\d)(?=(\d\d)+\d$)/g, "$1,");
    return `${neg ? "-" : ""}\u20B9${s}.${frac}`;
  }
  function parseStamp(s) {
    return new Date(s.replace("+05:30", "Z"));
  }
  function istParts(s) {
    const d = parseStamp(s);
    return {
      y: d.getUTCFullYear(),
      mo: d.getUTCMonth() + 1,
      d: d.getUTCDate(),
      h: d.getUTCHours(),
      mi: d.getUTCMinutes()
    };
  }
  function stampWords(s) {
    const p = istParts(s);
    const wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
    return `${WD[wd]} ${p.d} ${MON[p.mo - 1]} ${p.y}`;
  }
  function stampHHMM(s) {
    const p = istParts(s);
    return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
  }
  function travelTime(dep, arr) {
    const a = parseStamp(dep).getTime();
    const b = parseStamp(arr).getTime();
    const mins = Math.round((b - a) / 6e4);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }
  function chipClass(status) {
    if (status === "CNF") return "cnf";
    if (status === "RAC") return "rac";
    if (status === "CAN") return "can";
    if (status === "CHART_NOT_CONFIRMED") return "noscnf";
    if (status === "NOSB") return "can";
    return "wl";
  }
  var WD, MON, QUOTA_LABEL, TICKET_KIND_LABEL, BAND_LABEL, BERTH_POS;
  var init_format = __esm({
    "src/client/format.ts"() {
      "use strict";
      WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      QUOTA_LABEL = {
        GN: "General",
        TQ: "Tatkal",
        LD: "Ladies",
        SS: "Senior",
        RAC: "RAC"
      };
      TICKET_KIND_LABEL = {
        booked: "as booked",
        cancellation: "after cancellation",
        chart: "after chart"
      };
      BAND_LABEL = {
        flat: "Flat charge",
        quarter: "25% deduction",
        half: "50% deduction",
        tatkal_confirmed: "Confirmed Tatkal, no refund",
        clerkage: "Clerkage",
        party_clerkage: "Part-confirmed party, clerkage",
        rac_after_chart: "RAC after chart, clerkage",
        after_chart: "After chart, no refund",
        chart_full: "Not confirmed at chart",
        no_fare: "Child, no fare"
      };
      BERTH_POS = {
        LB: "lower",
        MB: "middle",
        UB: "upper",
        SL: "side lower",
        SU: "side upper"
      };
    }
  });

  // src/client/shell.ts
  async function getStations() {
    if (stations) return stations;
    const r = await fetch("/api/stations");
    const d = await r.json();
    stations = d.stations;
    return stations;
  }
  function stationName(code) {
    return stations?.find((s) => s.code === code)?.name ?? code;
  }
  function renderRibbon(stops) {
    const region = el("div", { class: "ribbon", role: "region", "aria-label": "Route", tabindex: "0" });
    const strip = el("div", { class: "strip" });
    for (const s of stops) {
      const stop = el("div", { class: "stop" + (s.terminal ? " terminal" : "") });
      stop.appendChild(el("span", { class: "code" }, s.code));
      stop.appendChild(el("span", { class: "name" }, s.name));
      if (s.time) stop.appendChild(el("span", { class: "time" }, s.time));
      strip.appendChild(stop);
    }
    region.appendChild(strip);
    return region;
  }
  function lucideIcon(name, label = null) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("aria-hidden", "true");
    if (label) {
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", label);
    }
    svg.innerHTML = LUCIDE[name];
    return svg;
  }
  function renderShell(main, opts = {}) {
    const app = document.getElementById("app");
    app.innerHTML = "";
    const top = el("header", { class: "top-bar" });
    const mark = el("span", { class: "wordmark" });
    mark.appendChild(lucideIcon("train"));
    mark.appendChild(document.createTextNode("Pakka Rail "));
    mark.appendChild(el("span", { class: "num" }, "\u092A\u0915\u094D\u0915\u093E"));
    const nav = el("nav", { class: "main-nav", "aria-label": "Main" });
    const links = [
      ["/trains", "Search trains"],
      ["/bookings", "My bookings"],
      ["/pnr", "PNR status"]
    ];
    for (const [href, label] of links) {
      const a = el("a", { href }, label);
      nav.appendChild(a);
    }
    if (currentAccount()) {
      const btn = el("button", { class: "sign-out" }, "Sign out");
      btn.addEventListener("click", async () => {
        await fetch("/api/session", { method: "DELETE" });
        sessionStorage.clear();
        location.href = "/";
      });
      nav.appendChild(btn);
    } else {
      nav.appendChild(el("a", { href: "/signin" }, "Sign in"));
    }
    top.appendChild(mark);
    top.appendChild(nav);
    app.appendChild(top);
    if (opts.ribbon) app.appendChild(opts.ribbon);
    const live = el("div", { id: "live-regions", role: "region", "aria-label": "Live updates" });
    app.appendChild(live);
    app.appendChild(main);
  }
  function setTitle(t) {
    document.title = `${t} \u2014 Pakka Rail`;
  }
  var stations, LUCIDE;
  var init_shell = __esm({
    "src/client/shell.ts"() {
      "use strict";
      init_ui();
      init_format();
      stations = null;
      LUCIDE = {
        train: '<line x1="5" y1="22" x2="19" y2="22"/><line x1="8" y1="2" x2="8" y2="22"/><line x1="16" y1="2" x2="16" y2="22"/><circle cx="10.5" cy="13.5" r="1"/><circle cx="13.5" cy="15.5" r="1"/>',
        ticket: '<path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01"/>',
        clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
      };
    }
  });

  // src/client/misc.ts
  var misc_exports = {};
  __export(misc_exports, {
    renderBookingNotFound: () => renderBookingNotFound,
    renderMyBookings: () => renderMyBookings,
    renderPageNotFound: () => renderPageNotFound,
    renderPnrStatus: () => renderPnrStatus
  });
  async function renderMyBookings() {
    setTitle("My bookings");
    const account2 = currentAccount() ?? await loadAccount();
    if (!account2) {
      location.href = `/signin?next=${encodeURIComponent(location.pathname)}`;
      return;
    }
    const main = el("main", { id: "main" });
    renderShell(main);
    const h1 = el("h1", {}, "My bookings");
    h1.appendChild(lucideIcon("ticket"));
    main.appendChild(h1);
    try {
      const d = await api(
        "GET",
        "/api/bookings"
      );
      const list = el("ul", { "aria-label": "My bookings", class: "plain" });
      for (const b of d.bookings) {
        const li = el("li");
        const a = el("a", { href: `/bookings/${b.pnr}` }, `PNR ${b.pnr}`);
        li.appendChild(a);
        li.appendChild(el(
          "span",
          { class: "small" },
          ` \u2014 ${b.train.number} ${b.train.name} \xB7 ${b.run_date} \xB7 ${b.from} to ${b.to} \xB7 ${b.class} \xB7 ${b.summary}`
        ));
        list.appendChild(li);
      }
      if (d.bookings.length === 0) {
        main.appendChild(el("p", {}, "No bookings yet."));
      }
      main.appendChild(list);
    } catch (e) {
      if (e instanceof ApiFail && e.status === 401) {
        location.href = `/signin?next=${encodeURIComponent(location.pathname)}`;
        return;
      }
      throw e;
    }
  }
  async function renderPnrStatus(initialPnr) {
    setTitle("PNR status");
    const main = el("main", { id: "main" });
    renderShell(main);
    main.appendChild(el("h1", {}, "PNR status"));
    const form = el("form", { class: "search-form", novalidate: "novalidate" });
    const input = el("input", { type: "text", id: "pnr-input", value: initialPnr ?? "", inputmode: "numeric", maxlength: "10", pattern: "[1-9][0-9]{9}" });
    input.setAttribute("aria-label", "PNR number");
    const label = el("label", { for: "pnr-input" }, "PNR number");
    form.appendChild(label);
    form.appendChild(input);
    const btn = el("button", { class: "btn-primary", type: "submit" }, "Check status");
    form.appendChild(btn);
    main.appendChild(form);
    const statusHost = el("div", { class: "status-line" });
    statusHost.setAttribute("role", "status");
    statusHost.setAttribute("aria-label", "PNR lookup");
    statusHost.setAttribute("data-status", "PNR lookup");
    main.appendChild(statusHost);
    const resultHost = el("div", {});
    main.appendChild(resultHost);
    const lookup = async (pnr) => {
      clearAlert("PNR lookup");
      if (!/^[1-9]\d{9}$/.test(pnr)) {
        setStatus("PNR lookup", `No booking has PNR ${pnr}.`);
        return;
      }
      try {
        const d = await api("GET", `/api/pnr/${pnr}`);
        resultHost.innerHTML = "";
        const table = el("div", { class: "pnr-table" });
        const tbl = el("table");
        tbl.setAttribute("aria-label", "PNR status");
        const thead = el("thead");
        const headRow = el("tr");
        for (const col of ["Passenger", "Booking status", "Current status"]) {
          headRow.appendChild(el("th", { scope: "col" }, col));
        }
        thead.appendChild(headRow);
        tbl.appendChild(thead);
        const tbody = el("tbody");
        for (const p of d.passengers) {
          const row = el("tr");
          const tdP = el("td", { "data-col": "Passenger" }, `Passenger ${p.number}`);
          const tdB = el("td", { "data-col": "Booking status" }, p.booking_status);
          const tdC = el("td", { "data-col": "Current status" }, p.current_status);
          row.appendChild(tdP);
          row.appendChild(tdB);
          row.appendChild(tdC);
          tbody.appendChild(row);
        }
        tbl.appendChild(tbody);
        table.appendChild(tbl);
        resultHost.appendChild(table);
        setStatus("PNR lookup", "");
      } catch (e) {
        if (e instanceof ApiFail && e.status === 404) {
          resultHost.innerHTML = "";
          setStatus("PNR lookup", `No booking has PNR ${pnr}.`);
        }
      }
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const pnr = input.value.trim();
      history.replaceState(null, "", pnr ? `/pnr/${pnr}` : "/pnr");
      void lookup(pnr);
    });
    if (initialPnr) await lookup(initialPnr);
  }
  function renderPageNotFound() {
    setTitle("Page not found");
    const main = el("main", { id: "main" });
    renderShell(main);
    main.appendChild(el("h1", {}, "Page not found"));
    main.appendChild(el("p", {}, "The page you asked for does not exist."));
  }
  function renderBookingNotFound() {
    setTitle("Booking not found");
    const main = el("main", { id: "main" });
    renderShell(main);
    main.appendChild(el("h1", {}, "Booking not found"));
    main.appendChild(el("p", {}, "This booking does not exist."));
  }
  var init_misc = __esm({
    "src/client/misc.ts"() {
      "use strict";
      init_api();
      init_ui();
      init_shell();
    }
  });

  // src/client/main.ts
  init_api();

  // src/client/search.ts
  init_api();
  init_ui();
  init_shell();
  async function renderSearch() {
    setTitle("Search trains");
    const stations2 = await getStations();
    const main = el("main", { id: "main" });
    const from = stations2[0]?.code ?? "MMCT";
    const to = stations2[5]?.code ?? "NDLS";
    const ribbon = renderRibbon([
      { code: from, name: stationName(from), time: null, terminal: true },
      { code: to, name: stationName(to), time: null, terminal: true }
    ]);
    renderShell(main, { ribbon });
    main.appendChild(el("h1", {}, "Search trains"));
    const form = el("form", { class: "search-form", novalidate: "novalidate" });
    const fromId = "search-from", toId = "search-to", dateId = "search-date";
    const fromSelect = el("select", { id: fromId, name: "from" });
    fromSelect.setAttribute("aria-label", "From");
    const toSelect = el("select", { id: toId, name: "to" });
    toSelect.setAttribute("aria-label", "To");
    for (const s of stations2) {
      const opt = el("option", { value: s.code }, `${s.code} ${s.name}`);
      if (s.code === from) opt.selected = true;
      fromSelect.appendChild(opt);
    }
    for (const s of stations2) {
      const opt = el("option", { value: s.code }, `${s.code} ${s.name}`);
      if (s.code === to) opt.selected = true;
      toSelect.appendChild(opt);
    }
    const dateInput = el("input", { id: dateId, name: "date", type: "date" });
    dateInput.setAttribute("aria-label", "Journey date");
    const today = /* @__PURE__ */ new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const defaultDate = `${today.getUTCFullYear()}-${pad(today.getUTCMonth() + 1)}-${pad(today.getUTCDate() + 1)}`;
    dateInput.value = defaultDate;
    form.appendChild(el("label", { for: fromId }, "From"));
    form.appendChild(fromSelect);
    form.appendChild(el("label", { for: toId }, "To"));
    form.appendChild(toSelect);
    form.appendChild(el("label", { for: dateId }, "Journey date"));
    form.appendChild(dateInput);
    const quotaFs = el("fieldset");
    quotaFs.appendChild(el("legend", {}, "Quota"));
    quotaFs.setAttribute("role", "radiogroup");
    quotaFs.setAttribute("aria-label", "Quota");
    const radios = el("div", { class: "radios" });
    for (const [code, label] of [["GN", "General"], ["TQ", "Tatkal"], ["LD", "Ladies"], ["SS", "Senior"]]) {
      const id = `quota-${code}`;
      const input = el("input", { type: "radio", id, name: "quota", value: code });
      if (code === "GN") input.checked = true;
      input.setAttribute("aria-label", label);
      const lab = el("label", { for: id }, label);
      radios.appendChild(input);
      radios.appendChild(lab);
    }
    quotaFs.appendChild(radios);
    form.appendChild(quotaFs);
    const actions = el("div", { class: "actions" });
    const submit = el("button", { class: "btn-primary", type: "submit" }, "Search trains");
    actions.appendChild(submit);
    form.appendChild(actions);
    main.appendChild(form);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const quota = form.querySelector('input[name="quota"]:checked').value;
      const params = new URLSearchParams({
        from: fromSelect.value,
        to: toSelect.value,
        date: dateInput.value,
        quota,
        class: "SL"
      });
      location.href = `/trains?${params.toString()}`;
    });
  }

  // src/client/results.ts
  init_api();
  init_ui();
  init_shell();
  init_format();
  var state = null;
  var requestSeq = 0;
  var filtersHandle = null;
  function isPhone() {
    return window.innerWidth < 768;
  }
  async function renderResults() {
    setTitle("Trains");
    const params = new URLSearchParams(location.search);
    const stations2 = await getStations();
    const from = params.get("from") ?? stations2[0].code;
    const to = params.get("to") ?? stations2[5].code;
    const date = params.get("date") ?? "";
    const quota = params.get("quota") ?? "GN";
    const cls = params.get("class") ?? "SL";
    state = {
      from,
      to,
      date,
      quota,
      cls,
      trains: [],
      selected: null,
      latest: { cls, quota, seq: 0 }
    };
    const main = el("main", { id: "main" });
    renderShell(main, { ribbon: ribbonFor([]) });
    main.appendChild(el("h1", {}, `Trains from ${stationName(from)} to ${stationName(to)}`));
    statusRegion("Search result", "Checking trains");
    document.getElementById("live-regions").appendChild(statusRegion("Search result", "Checking trains"));
    document.getElementById("live-regions").appendChild(statusRegion("Availability", ""));
    const summary = el("div", { class: "panel", id: "search-summary" });
    main.appendChild(summary);
    const grid = el("div", { class: "results-grid", id: "results-grid" });
    main.appendChild(grid);
    const layout = isPhone() ? "phone" : "desktop";
    renderFiltersArea(grid, layout);
    const cardsCol = el("div", { id: "cards-col" });
    grid.appendChild(cardsCol);
    if (layout === "desktop") grid.appendChild(el("div", { id: "details-col" }));
    await refreshTrains();
  }
  function attachRibbon(train) {
    const existing = document.querySelector(".ribbon");
    const fresh = ribbonFor(train.stops);
    if (existing) existing.replaceWith(fresh);
    else document.querySelector(".top-bar")?.after(fresh);
  }
  function ribbonFor(stops) {
    const ribbonStops = stops.length > 0 ? stops.map((s) => ({ code: s.code, name: s.name, time: stampHHMM(s.departure_at) })) : null;
    if (ribbonStops) {
      return renderRibbon(ribbonStops.map((s, i) => ({ ...s, terminal: i === 0 || i === ribbonStops.length - 1 })));
    }
    return renderRibbon([
      { code: state.from, name: stationName(state.from), time: null, terminal: true },
      { code: state.to, name: stationName(state.to), time: null, terminal: true }
    ]);
  }
  function updateUrl(cls, quota) {
    const params = new URLSearchParams(location.search);
    params.set("class", cls);
    params.set("quota", quota);
    const url = `${location.pathname}?${params.toString()}`;
    history.replaceState(null, "", url);
  }
  async function refreshTrains(announceAvailability = false) {
    const s = state;
    requestSeq += 1;
    const seq = requestSeq;
    const cls = s.cls;
    const quota = s.quota;
    statusRegion("Search result", "Checking trains");
    try {
      const params = new URLSearchParams({
        from: s.from,
        to: s.to,
        date: s.date,
        quota,
        class: cls
      });
      const d = await api("GET", `/api/trains?${params.toString()}`);
      if (seq !== requestSeq || cls !== state.cls || quota !== state.quota) return;
      s.trains = d.trains;
      const sel = d.trains.find((t) => t.number === s.selected) ?? d.trains[0];
      if (sel) attachRibbon(sel);
      renderCards();
      if (d.trains.length === 0) {
        statusRegion("Search result", `No trains run between ${stationName(s.from)} and ${stationName(s.to)} on ${stampWords(dateToStamp(s.date))}.`);
      } else {
        statusRegion("Search result", `${d.trains.length} trains from ${stationName(s.from)} to ${stationName(s.to)} on ${stampWords(dateToStamp(s.date))}`);
        if (isDesktop() && s.selected === null) {
          s.selected = d.trains[0].number;
        }
        renderSelection();
        if (announceAvailability) {
          announceAvail();
        }
      }
      scheduleClockRefresh();
    } catch {
    }
  }
  function dateToStamp(date) {
    return `${date}T00:00:00+05:30`;
  }
  function isDesktop() {
    return window.innerWidth >= 1200;
  }
  function entryOf(train) {
    const e = train.classes.find((c) => c.class === state.cls && c.quota === state.quota);
    return e ?? train.classes[0];
  }
  function renderFiltersArea(grid, layout) {
    const filtersCol = el("div", { id: "filters-col" });
    if (layout === "phone") {
      const btn = el("button", { class: "filters-btn", "aria-haspopup": "dialog" }, "Filters");
      btn.addEventListener("click", () => openFiltersDialog(btn));
      filtersCol.appendChild(btn);
    } else {
      filtersCol.appendChild(buildRadios());
    }
    grid.insertBefore(filtersCol, grid.firstChild);
  }
  function buildRadios() {
    const wrap = el("div", {});
    const classFs = el("fieldset");
    classFs.setAttribute("role", "radiogroup");
    classFs.setAttribute("aria-label", "Class");
    const classRadios = el("div", { class: "radios" });
    for (const [code, label] of [["SL", "Sleeper (SL)"], ["3A", "AC 3 Tier (3A)"]]) {
      const id = `cls-${code}`;
      const input = el("input", { type: "radio", id, name: "cls", value: code });
      input.setAttribute("aria-label", label);
      if (code === state.cls) input.checked = true;
      input.addEventListener("change", () => changeSelection(code, state.quota));
      const lab = el("label", { for: id }, label);
      classRadios.appendChild(input);
      classRadios.appendChild(lab);
    }
    classFs.appendChild(classRadios);
    wrap.appendChild(classFs);
    const quotaFs = el("fieldset");
    quotaFs.setAttribute("role", "radiogroup");
    quotaFs.setAttribute("aria-label", "Quota");
    const quotaRadios = el("div", { class: "radios" });
    for (const [code, label] of [["GN", "General"], ["TQ", "Tatkal"], ["LD", "Ladies"], ["SS", "Senior"]]) {
      const id = `qta-${code}`;
      const input = el("input", { type: "radio", id, name: "quota", value: code });
      input.setAttribute("aria-label", label);
      if (code === state.quota) input.checked = true;
      input.addEventListener("change", () => changeSelection(state.cls, code));
      const lab = el("label", { for: id }, label);
      quotaRadios.appendChild(input);
      quotaRadios.appendChild(lab);
    }
    quotaFs.appendChild(quotaRadios);
    wrap.appendChild(quotaFs);
    return wrap;
  }
  function changeSelection(cls, quota) {
    state.cls = cls;
    state.quota = quota;
    requestSeq += 1;
    updateUrl(cls, quota);
    syncRadios();
    refreshTrains(true);
    if (filtersHandle) {
    }
  }
  function syncRadios() {
    document.querySelectorAll('input[name="cls"]').forEach((r) => {
      r.checked = r.value === state.cls;
    });
    document.querySelectorAll('input[name="quota"]').forEach((r) => {
      r.checked = r.value === state.quota;
    });
  }
  var filtersOpener = null;
  function openFiltersDialog(opener) {
    filtersOpener = opener;
    const handle = openDialog((dlg) => {
      dlg.setAttribute("aria-label", "Filters");
      const h = el("h2", {}, "Filters");
      dlg.appendChild(h);
      dlg.appendChild(buildRadios());
      const actions = el("div", { class: "dialog-actions" });
      const close = el("button", { class: "btn-primary" }, "Close filters");
      close.addEventListener("click", () => {
        handle.close();
        opener.focus();
      });
      actions.appendChild(close);
      dlg.appendChild(actions);
    }, opener, 'input[type="radio"]');
    filtersHandle = handle;
  }
  function renderCards() {
    const s = state;
    const col = document.getElementById("cards-col");
    col.innerHTML = "";
    const list = el("ul", { "aria-label": "Trains" });
    for (const t of s.trains) {
      const entry = entryOf(t);
      const li = el("li", { "data-train": t.number });
      const card = el("div", { class: "train-card" + (s.selected === t.number ? " selected" : "") });
      const row1 = el("div", { class: "row1" });
      const heading = el("h2", {}, `${t.number} ${t.name}`);
      heading.setAttribute("aria-label", `${t.number} ${t.name}`);
      row1.appendChild(heading);
      const avail = el("span", { class: "avail" }, entry.label);
      row1.appendChild(avail);
      card.appendChild(row1);
      const meta = el("div", { class: "meta" });
      meta.textContent = `${stampHHMM(t.from.departure_at)} \u2192 ${stampHHMM(t.to.arrival_at)} \xB7 ${travelTime(t.from.departure_at, t.to.arrival_at)} \xB7 chart ${stampHHMM(t.chart_at)} \xB7 adult ${formatPaise(entry.adult_fare_paise)}`;
      card.appendChild(meta);
      const links = el("div", { class: "links" });
      const detailsBtn = el("button", { class: "details-btn" }, `Show details ${t.number}`);
      detailsBtn.addEventListener("click", () => {
        s.selected = t.number;
        renderCards();
        renderSelection();
        announceAvail();
      });
      links.appendChild(detailsBtn);
      if (entry.window === "open") {
        const book = el("a", { href: bookingHref(t) }, `Book ${t.number} ${state.cls}`);
        links.appendChild(book);
      }
      card.appendChild(links);
      if (!isDesktop() && s.selected === t.number) {
        card.appendChild(renderTrainDetails(t));
      }
      li.appendChild(card);
      list.appendChild(li);
    }
    col.appendChild(list);
  }
  function bookingHref(t) {
    const params = new URLSearchParams({
      train: t.number,
      run_date: t.run_date,
      from: state.from,
      to: state.to,
      class: state.cls,
      quota: state.quota
    });
    return `/book?${params.toString()}`;
  }
  function renderSelection() {
    const s = state;
    if (isDesktop()) {
      renderCards();
      const detailsCol = document.getElementById("details-col");
      if (detailsCol) {
        detailsCol.innerHTML = "";
        const region = el("div", { role: "region", "aria-label": "Train details" });
        const t = s.trains.find((x) => x.number === s.selected);
        if (t) region.appendChild(renderTrainDetails(t));
        detailsCol.appendChild(region);
      }
    } else {
      renderCards();
    }
  }
  function renderTrainDetails(t) {
    const wrap = el("div", { class: "panel" });
    const entry = entryOf(t);
    wrap.appendChild(el("h3", {}, `Train details`));
    const dl = el("dl", { class: "kv" });
    const add = (k, v) => {
      dl.appendChild(el("dt", {}, k));
      dl.appendChild(el("dd", {}, v));
    };
    add("Availability", entry.label);
    add("Chart", `${stampHHMM(t.chart_at)}`);
    add("Booking window", entry.window === "open" ? "open" : entry.window === "chart_prepared" ? "chart prepared" : `opens ${stampWords(entry.opens_at)}`);
    wrap.appendChild(dl);
    const queueLane = el("div", { class: "queue-cols" });
    queueLane.appendChild(el("div", { class: "queue-lane" }, `WL lane: ${entry.wl ?? 0} \xB7 RAC lane: ${entry.rac ?? 0}`));
    wrap.appendChild(queueLane);
    return wrap;
  }
  function announceAvail() {
    const s = state;
    const t = s.trains.find((x) => x.number === s.selected);
    if (!t) return;
    const entry = entryOf(t);
    const quotaLabel = { GN: "General", TQ: "Tatkal", LD: "Ladies", SS: "Senior" }[s.quota];
    statusRegion("Availability", `${t.number} ${s.cls} ${quotaLabel}: ${entry.label}`);
  }
  var refreshTimer = null;
  function scheduleClockRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    const s = state;
    let earliestBusinessMs = Infinity;
    for (const t of s.trains) {
      const entry = entryOf(t);
      for (const stamp of [entry.opens_at, t.chart_at]) {
        const ms = Date.parse(stamp.replace("+05:30", "Z"));
        if (ms > businessNowMs()) earliestBusinessMs = Math.min(earliestBusinessMs, ms);
      }
    }
    if (earliestBusinessMs === Infinity) return;
    const rate = Math.max(1, window.__pakkaClockRate ?? 1);
    const realDelayMs = (earliestBusinessMs - businessNowMs()) / rate + 300;
    refreshTimer = window.setTimeout(() => {
      void refreshTrains(true);
    }, Math.max(50, Math.min(realDelayMs, 60 * 60 * 1e3)));
  }

  // src/client/booking.ts
  init_api();
  init_ui();
  init_shell();
  init_format();

  // src/client/coachplan.ts
  init_format();
  init_ui();
  var STATE_TAG = {
    free: "free",
    taken: "taken",
    rac_free: "two RAC places free",
    rac_one_free: "one RAC place free",
    rac_full: "RAC full"
  };
  var CELL_W = 64;
  var CELL_H = 40;
  var BAY_GAP = 14;
  var TOP = 46;
  function berthName(coach, berth, h) {
    const pos = BERTH_POS[berth.type] ?? "lower";
    const tags = [QUOTA_LABEL[berth.quota] ?? berth.quota, STATE_TAG[berth.state]];
    const prefs = h.preferredTags.get(`${coach}:${berth.berth}`) ?? [];
    for (const n of prefs) tags.push(`preferred by passenger ${n}`);
    const occ = h.occupantTags?.get(`${coach}:${berth.berth}`) ?? [];
    for (const o of occ) tags.push(`${o.rac ? "RAC" : "CNF"} passenger ${o.number}`);
    return `Berth ${coach} ${berth.berth} ${pos}, ${tags.join(", ")}`;
  }
  function drawCoachPlan(container, data, selectedCoach, vertical, handlers) {
    container.innerHTML = "";
    const coachData = data.coaches.find((c) => c.coach === selectedCoach) ?? data.coaches[0];
    if (!coachData) return;
    const bays = 9;
    const planW = vertical ? CELL_W + 470 : bays * (CELL_W * 2 + 16 + BAY_GAP) + 30;
    const planH = vertical ? bays * (CELL_H * 2 + 22) + TOP + 20 : CELL_H * 2 + TOP + 30;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", String(planW));
    svg.setAttribute("height", String(planH));
    svg.setAttribute("viewBox", `0 0 ${planW} ${planH}`);
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", `Coach plan ${selectedCoach}`);
    const defs = document.createElementNS(svgNS, "defs");
    const pattern = document.createElementNS(svgNS, "pattern");
    pattern.setAttribute("id", "hatch");
    pattern.setAttribute("width", "6");
    pattern.setAttribute("height", "6");
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    pattern.setAttribute("patternTransform", "rotate(45)");
    const line1 = document.createElementNS(svgNS, "line");
    line1.setAttribute("x1", "0");
    line1.setAttribute("y1", "0");
    line1.setAttribute("x2", "0");
    line1.setAttribute("y2", "6");
    line1.setAttribute("stroke", "rgba(43,33,22,0.28)");
    line1.setAttribute("stroke-width", "2");
    pattern.appendChild(line1);
    defs.appendChild(pattern);
    svg.appendChild(defs);
    const planWrap = document.createElementNS(svgNS, "g");
    planWrap.setAttribute("tabindex", "0");
    planWrap.setAttribute("role", "group");
    planWrap.setAttribute("aria-label", `Coach plan ${selectedCoach}`);
    svg.appendChild(planWrap);
    const coachText = document.createElementNS(svgNS, "text");
    coachText.setAttribute("x", "6");
    coachText.setAttribute("y", "16");
    coachText.setAttribute("font-size", "15");
    coachText.setAttribute("font-weight", "700");
    coachText.textContent = selectedCoach;
    planWrap.appendChild(coachText);
    const berthOrder = (bay) => [8 * bay - 7, 8 * bay - 6, 8 * bay - 5, 8 * bay - 4, 8 * bay - 3, 8 * bay - 2, 8 * bay - 1, 8 * bay];
    const berthEls = /* @__PURE__ */ new Map();
    for (let bay = 1; bay <= bays; bay++) {
      const bayX = vertical ? 8 : 24 + (bay - 1) * (CELL_W * 2 + 16 + BAY_GAP);
      const bayY = vertical ? TOP + (bay - 1) * (CELL_H * 2 + 22) : TOP;
      const bayLabel = document.createElementNS(svgNS, "text");
      bayLabel.setAttribute("x", String(bayX + CELL_W));
      bayLabel.setAttribute("y", String(bayY - 8));
      bayLabel.setAttribute("font-size", "12");
      bayLabel.textContent = `Bay ${bay}`;
      planWrap.appendChild(bayLabel);
      for (const [pos, berthNum] of berthOrder(bay).entries()) {
        const berth = coachData.berths.find((b) => b.berth === berthNum);
        const isSide = pos >= 6;
        const stackIdx = pos % 3;
        const col = pos < 6 ? Math.floor(pos / 3) : 0;
        const x = vertical ? bayX + (isSide ? CELL_W + 8 : col * (CELL_W + 4)) : bayX + (isSide ? CELL_W * 2 + 8 : col * (CELL_W + 4));
        const y = bayY + stackIdx * (CELL_H + 4);
        const w = isSide ? vertical ? 120 : CELL_W + 40 : CELL_W;
        const hgt = CELL_H;
        const btn = document.createElementNS(svgNS, "foreignObject");
        btn.setAttribute("x", String(x));
        btn.setAttribute("y", String(y));
        btn.setAttribute("width", String(w));
        btn.setAttribute("height", String(hgt));
        const htmlBtn = document.createElement("button");
        htmlBtn.className = "berth";
        htmlBtn.dataset.coach = selectedCoach;
        htmlBtn.dataset.berth = String(berthNum);
        htmlBtn.dataset.bay = String(bay);
        htmlBtn.dataset.pos = String(pos);
        htmlBtn.dataset.side = isSide ? "1" : "0";
        htmlBtn.dataset.stack = String(stackIdx);
        htmlBtn.setAttribute("aria-label", berthName(selectedCoach, berth, handlers));
        const inner = document.createElement("span");
        inner.setAttribute("aria-hidden", "true");
        inner.style.display = "flex";
        inner.style.gap = "2px";
        inner.style.width = "100%";
        inner.style.height = "100%";
        inner.style.minHeight = "44px";
        inner.style.minWidth = "44px";
        const makeCell = (cls, label, stamp, half) => {
          const cell = el("span", { class: cls });
          cell.style.flex = "1";
          cell.style.display = "flex";
          cell.style.alignItems = "center";
          cell.style.justifyContent = "center";
          cell.style.minHeight = "44px";
          cell.style.position = "relative";
          cell.setAttribute("data-cell-kind", label);
          if (half !== "b") {
            const num = el("span", { class: "mono" });
            num.style.fontSize = "0.68rem";
            num.textContent = stamp ? "CNF" : String(berthNum);
            cell.appendChild(num);
          }
          return cell;
        };
        let stampCnf = false;
        if (berth.quota === "RAC") {
          const occ = handlers.occupantTags?.get(`${selectedCoach}:${berthNum}`) ?? [];
          const selfRac = occ.filter((o) => o.rac).length > 0;
          const other = handlers.occupantTags?.get(`${selectedCoach}:${berthNum}`)?.filter((o) => o.rac).length ?? 0;
          const clsA = berth.state === "rac_full" ? "cell-rac-half-a" : berth.state === "rac_one_free" ? "cell-rac-half-a" : "cell-rac-half-b";
          const taken = berth.state !== "rac_free";
          const cellA = makeCell(berth.state === "rac_free" ? "cell-free cell-any" : taken ? "cell-rac-half-a cell-any" : "cell-free cell-any", "rac-a", false, "a");
          const cellB = makeCell(berth.state === "rac_full" ? "cell-taken cell-any" : "cell-rac-half-b cell-any", "rac-b", false, "b");
          inner.appendChild(cellA);
          inner.appendChild(cellB);
        } else {
          const free = berth.state === "free";
          const cnf = !free && (handlers.occupantTags?.get(`${selectedCoach}:${berthNum}`)?.some((o) => !o.rac) ?? false);
          stampCnf = cnf;
          const cls = free ? "cell-free cell-any" : cnf ? "cell-cnf cell-any" : "cell-taken cell-any";
          const cell = makeCell(cls, free ? "free" : cnf ? "cnf" : "taken", cnf, null);
          if (cnf) cell.querySelector("span")?.setAttribute("class", "berth-stamp");
          else cell.querySelector("span")?.setAttribute("class", "berth-num");
          inner.appendChild(cell);
        }
        const pref = handlers.preferredTags.get(`${selectedCoach}:${berthNum}`);
        if (pref) {
          inner.querySelectorAll(".cell-any").forEach((c) => c.classList.add("cell-preferred"));
        }
        htmlBtn.appendChild(inner);
        btn.appendChild(htmlBtn);
        planWrap.appendChild(btn);
        berthEls.set(berthNum, htmlBtn);
      }
    }
    planWrap.addEventListener("keydown", (e) => {
      const target = e.target;
      if (target !== planWrap && !target.closest(".berth")) return;
      const focused = planWrap.querySelector("button.berth:focus");
      const all = Array.from(planWrap.querySelectorAll("button.berth"));
      const idx = focused ? all.indexOf(focused) : -1;
      const horizontal = !vertical;
      const delta = (l, r, u, d) => horizontal ? l : u;
      let next = -1;
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          const back = e.key === "ArrowLeft" || horizontal && e.key === "ArrowUp" || !horizontal && e.key === "ArrowDown";
          const within = horizontal ? e.key === "ArrowUp" || e.key === "ArrowDown" : e.key === "ArrowLeft" || e.key === "ArrowRight";
          const forwardDir = horizontal ? e.key === "ArrowDown" : e.key === "ArrowRight";
          if (within) {
            const orderPos = focused ? Number(focused.dataset.stack) * 2 + (focused.dataset.side === "1" ? 6 + (forwardDir ? 1 : 0) : (focused.dataset.stack ? 3 : 0) % 2) : 0;
            if (!focused) {
              next = 0;
              break;
            }
            const bayOf = Number(focused.dataset.bay);
            const berthOf = Number(focused.dataset.berth);
            const posInBay = (berthOf - 1) % 8;
            const kbOrder = (p) => p;
            const cur = kbOrder(posInBay);
            const targetPos = forwardDir ? cur + 1 : cur - 1;
            if (targetPos < 0 || targetPos > 7) {
              next = -2;
              break;
            }
            const candidate = all.find((b) => Number(b.dataset.bay) === bayOf && (Number(b.dataset.berth) - 1) % 8 === targetPos);
            next = candidate ? all.indexOf(candidate) : -2;
          } else {
            if (!focused) {
              next = 0;
              break;
            }
            const bayOf = Number(focused.dataset.bay);
            const posInBay = (Number(focused.dataset.berth) - 1) % 8;
            const targetBay = back ? bayOf - 1 : bayOf + 1;
            if (targetBay < 1 || targetBay > 9) {
              next = -2;
              break;
            }
            const candidate = all.find((b) => Number(b.dataset.bay) === targetBay && (Number(b.dataset.berth) - 1) % 8 === posInBay);
            next = candidate ? all.indexOf(candidate) : -2;
          }
          break;
        }
        case "Home":
        case "End": {
          if (!focused) {
            next = 0;
            break;
          }
          const posInBay = (Number(focused.dataset.berth) - 1) % 8;
          const targetBay = e.key === "Home" ? 1 : 9;
          const candidate = all.find((b) => Number(b.dataset.bay) === targetBay && (Number(b.dataset.berth) - 1) % 8 === posInBay);
          next = candidate ? all.indexOf(candidate) : -2;
          break;
        }
        default:
          return;
      }
      e.preventDefault();
      if (next === -2 || next === -1 || next === idx) {
        if (focused) focused.focus();
        return;
      }
      const targetEl = all[next];
      if (targetEl) {
        targetEl.focus();
        targetEl.scrollIntoView({ block: "nearest", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      }
    });
    planWrap.addEventListener("focusin", () => {
      if (!planWrap.contains(document.activeElement) || document.activeElement === planWrap) {
        const all = Array.from(planWrap.querySelectorAll("button.berth"));
        (lastFocused.get(selectedCoach) ?? all[0])?.focus();
      }
    });
    planWrap.addEventListener("focusout", (e) => {
      const btn = e.target.closest?.(".berth");
      if (btn) lastFocused.set(selectedCoach, btn);
    });
    planWrap.addEventListener("click", (e) => {
      const btn = e.target.closest?.(".berth");
      if (btn && handlers.onPick) {
        const berth = coachData.berths.find((b) => String(b.berth) === btn.dataset.berth);
        handlers.onPick(selectedCoach, berth.berth, berth.type);
      }
    });
    container.appendChild(svg);
  }
  var lastFocused = /* @__PURE__ */ new Map();
  function coachPageKey(container, coaches, getCurrent, onSwitch) {
    container.addEventListener("keydown", (e) => {
      if (e.key !== "PageUp" && e.key !== "PageDown") return;
      const idx = Math.max(0, coaches.indexOf(getCurrent()));
      const target = e.key === "PageUp" ? idx - 1 : idx + 1;
      e.preventDefault();
      if (target < 0 || target >= coaches.length) return;
      onSwitch(coaches[target]);
    });
  }

  // src/client/booking.ts
  var GENDERS = [["M", "Male"], ["F", "Female"], ["T", "Transgender"]];
  var PREFS = [
    ["NONE", "No preference"],
    ["LB", "Lower"],
    ["MB", "Middle"],
    ["UB", "Upper"],
    ["SL", "Side lower"],
    ["SU", "Side upper"]
  ];
  function draftKey() {
    return `pakka-draft:${location.pathname}${location.search}`;
  }
  function loadDraft() {
    try {
      const raw = sessionStorage.getItem(draftKey());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  function saveDraft(d) {
    sessionStorage.setItem(draftKey(), JSON.stringify(d));
  }
  function clearDraft() {
    sessionStorage.removeItem(draftKey());
  }
  async function renderBooking() {
    const account2 = currentAccount() ?? await loadAccount();
    if (!account2) {
      location.href = `/signin?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    let windowLabel = "open";
    setTitle("Book");
    const params = parseBookingParams();
    if (!params) {
      location.href = "/";
      return;
    }
    await fetchClock();
    const stations2 = await getStations();
    const p = params;
    const restoredFromDraft = loadDraft() !== null;
    const draft = loadDraft() ?? {
      passengers: [emptyPassenger()],
      keep_in_one_coach: false,
      lower_berth_only: false,
      contact_phone: account2.phone,
      choosing_for: 1,
      coach: ""
    };
    const main = el("main", { id: "main" });
    const ribbon = buildRibbon(stations2, p);
    renderShell(main, { ribbon });
    if (restoredFromDraft) {
      setTimeout(() => document.getElementById("review-btn")?.focus(), 400);
    }
    main.appendChild(el("h1", {}, `Book ${p.train}`));
    const problemHost = el("div", { id: "problem-host" });
    main.appendChild(problemHost);
    const grid = el("div", { class: "booking-grid" });
    main.appendChild(grid);
    const leftCol = el("div", { class: "col-passengers" });
    const planCol = el("div", { class: "col-plan" });
    const fareCol = el("div", { class: "col-fare" });
    grid.appendChild(leftCol);
    grid.appendChild(planCol);
    grid.appendChild(fareCol);
    const passengersHost = el("div", { id: "passengers-host" });
    leftCol.appendChild(passengersHost);
    const addBtn = el("button", { class: "add-passenger" }, "Add passenger");
    addBtn.addEventListener("click", () => {
      draft.passengers.push(emptyPassenger());
      saveDraft(draft);
      renderPassengers();
      quoteFare();
    });
    leftCol.appendChild(addBtn);
    const opts = el("fieldset");
    const keepLabel = el("label", { class: "checkline" });
    const keep = el("input", { type: "checkbox" });
    keep.id = nextId("keep");
    keep.checked = draft.keep_in_one_coach;
    keep.setAttribute("aria-label", "Keep party in one coach");
    keep.addEventListener("change", () => {
      draft.keep_in_one_coach = keep.checked;
      saveDraft(draft);
      clearAlert("Booking problem");
      quoteFare();
    });
    keepLabel.appendChild(keep);
    keepLabel.appendChild(document.createTextNode("Keep party in one coach"));
    opts.appendChild(keepLabel);
    const lowerLabel = el("label", { class: "checkline" });
    const lower = el("input", { type: "checkbox" });
    lower.id = nextId("lower");
    lower.checked = draft.lower_berth_only;
    lower.setAttribute("aria-label", "Book only if a lower berth is allotted");
    lower.addEventListener("change", () => {
      draft.lower_berth_only = lower.checked;
      saveDraft(draft);
      clearAlert("Booking problem");
      quoteFare();
    });
    lowerLabel.appendChild(lower);
    lowerLabel.appendChild(document.createTextNode("Book only if a lower berth is allotted"));
    opts.appendChild(lowerLabel);
    leftCol.appendChild(opts);
    const phoneRow = el("div", {});
    const phoneId = nextId("phone");
    const phoneLabel = el("label", { for: phoneId }, "Mobile number");
    const phone = el("input", { type: "tel", id: phoneId, value: draft.contact_phone });
    phone.setAttribute("aria-label", "Mobile number");
    phone.addEventListener("input", () => {
      draft.contact_phone = phone.value;
      saveDraft(draft);
      clearAlert("Booking problem");
    });
    phoneRow.appendChild(phoneLabel);
    phoneRow.appendChild(phone);
    const phoneErr = el("div", { class: "field-error", "data-err": "contact_phone" });
    phoneRow.appendChild(phoneErr);
    leftCol.appendChild(phoneRow);
    const chooseWrap = el("fieldset");
    const chooseLegend = el("legend", {}, "Choosing for");
    chooseWrap.appendChild(chooseLegend);
    const chooseGroup = el("div", { role: "radiogroup", "aria-label": "Choosing for", id: "choosing-for" });
    chooseWrap.appendChild(chooseGroup);
    planCol.appendChild(chooseWrap);
    const coachTabsHost = el("div", { id: "coach-tabs-host" });
    planCol.appendChild(coachTabsHost);
    const planHost = el("div", { class: "coach-frame", id: "plan-host" });
    planCol.appendChild(planHost);
    planCol.appendChild(el("p", { class: "berth-note" }, "Preferences guide allotment. The exact berth is allotted when you pay."));
    const farePanel = el("div", { class: "panel", id: "fare-panel" });
    const fareTitle = el("h2", {}, "Fare");
    farePanel.appendChild(fareTitle);
    const fareAvail = el("p", { class: "mono" });
    farePanel.appendChild(fareAvail);
    const fareLinesHost = el("ul", { "aria-label": "Fare lines", class: "plain" });
    farePanel.appendChild(fareLinesHost);
    const totalP = el("p", { class: "fare-total", "data-total": "1" });
    farePanel.appendChild(totalP);
    fareCol.appendChild(farePanel);
    document.getElementById("live-regions").appendChild(statusRegionHost("Fare total"));
    document.getElementById("live-regions").appendChild(statusRegionHost("Fare availability"));
    const payBar = el("div", { class: "pay-bar" });
    const reviewBtn = el("button", { class: "btn-primary", id: "review-btn" }, "Review and pay");
    payBar.appendChild(reviewBtn);
    main.appendChild(payBar);
    reviewBtn.addEventListener("click", () => {
      clearAlert("Booking problem");
      clearFormProblems();
      openPayDialog(reviewBtn);
    });
    let coachesData = null;
    let lastFare = null;
    let fareSeq = 0;
    let availLabel = "";
    let fareTimer = null;
    const coachUrl = `/api/trains/${p.train}/runs/${p.run_date}/coachers?class=${p.cls}&from=${p.from}&to=${p.to}`;
    const [coachResp, trainResp] = await Promise.all([
      api("GET", `/api/trains/${p.train}/runs/${p.run_date}/coaches?class=${p.cls}&from=${p.from}&to=${p.to}`).catch(() => null),
      api(
        "GET",
        `/api/trains?from=${p.from}&to=${p.to}&date=${p.run_date}&quota=${p.quota}&class=${p.cls}`
      ).catch(() => null)
    ]);
    coachesData = coachResp;
    if (trainResp) {
      const t = trainResp.trains.find((x) => x.number === p.train);
      const entry = t?.classes.find((c) => c.class === p.cls && c.quota === p.quota);
      availLabel = entry?.label ?? "";
      windowLabel = entry?.window ?? "open";
    }
    fareAvail.textContent = availLabel;
    setStatus("Fare availability", availLabel);
    if (coachesData && !draft.coach) {
      draft.coach = coachesData.coaches[0]?.coach ?? "";
    }
    renderCoachTabs();
    renderPlan();
    renderPassengers();
    renderChoosingFor();
    await quoteFare();
    function emptyPassenger() {
      return { name: "", age: "", gender: "M", pref: "NONE" };
    }
    function statusRegionHost(name) {
      const d = el("div", { class: "status-line" });
      d.setAttribute("role", "status");
      d.setAttribute("aria-label", name);
      d.setAttribute("data-status", name);
      return d;
    }
    function renderPassengers() {
      passengersHost.innerHTML = "";
      for (const [i, pd] of draft.passengers.entries()) {
        const group = el("fieldset", { class: "passenger-group" });
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", `Passenger ${i + 1}`);
        const grid2 = el("div", { class: "passenger-grid" });
        const nameId = nextId("pn");
        grid2.appendChild(el("label", { for: nameId }, "Name"));
        const name = el("input", { type: "text", id: nameId, value: pd.name });
        name.setAttribute("aria-label", "Name");
        name.addEventListener("input", () => {
          pd.name = name.value;
          saveDraft(draft);
        });
        grid2.appendChild(name);
        const nameErr = el("div", { class: "field-error", "data-err": `passengers[${i}].name` });
        grid2.appendChild(nameErr);
        const ageId = nextId("pa");
        grid2.appendChild(el("label", { for: ageId }, "Age"));
        const age = el("input", { type: "number", id: ageId, value: pd.age, min: "0", max: "125" });
        age.setAttribute("aria-label", "Age");
        age.className = "age-input";
        age.setAttribute("role", "spinbutton");
        age.addEventListener("input", () => {
          pd.age = age.value;
          saveDraft(draft);
          clearAlert("Booking problem");
          quoteFare();
        });
        grid2.appendChild(age);
        const ageErr = el("div", { class: "field-error", "data-err": `passengers[${i}].age` });
        grid2.appendChild(ageErr);
        const genderId = nextId("pg");
        grid2.appendChild(el("label", { for: genderId }, "Gender"));
        const gender = el("select", { id: genderId });
        gender.setAttribute("aria-label", "Gender");
        for (const [code, label] of GENDERS) {
          const opt = el("option", { value: code }, label);
          if (code === pd.gender) opt.selected = true;
          gender.appendChild(opt);
        }
        gender.addEventListener("change", () => {
          pd.gender = gender.value;
          saveDraft(draft);
        });
        grid2.appendChild(gender);
        const prefId = nextId("pp");
        grid2.appendChild(el("label", { for: prefId }, "Berth preference"));
        const pref = el("select", { id: prefId });
        pref.setAttribute("aria-label", "Berth preference");
        pref.className = "pref-select";
        for (const [code, label] of PREFS) {
          const opt = el("option", { value: code }, label);
          if (code === pd.pref) opt.selected = true;
          pref.appendChild(opt);
        }
        pref.addEventListener("change", () => {
          pd.pref = pref.value;
          draft.choosing_for = i + 1;
          saveDraft(draft);
          renderChoosingFor();
          renderPlan();
        });
        grid2.appendChild(pref);
        group.appendChild(grid2);
        if (draft.passengers.length > 1) {
          const rm = el("button", { class: "remove-passenger" }, `Remove passenger ${i + 1}`);
          rm.addEventListener("click", () => {
            draft.passengers.splice(i, 1);
            if (draft.choosing_for > draft.passengers.length) draft.choosing_for = draft.passengers.length;
            saveDraft(draft);
            renderPassengers();
            renderChoosingFor();
            renderPlan();
            quoteFare();
          });
          group.appendChild(rm);
        }
        passengersHost.appendChild(group);
      }
    }
    function renderChoosingFor() {
      const host = document.getElementById("choosing-for");
      host.innerHTML = "";
      for (const [i] of draft.passengers.entries()) {
        const id = nextId("cf");
        const input = el("input", { type: "radio", id, name: "choosing-for", value: String(i + 1) });
        input.setAttribute("aria-label", `Passenger ${i + 1}`);
        if (draft.choosing_for === i + 1) input.checked = true;
        input.addEventListener("change", () => {
          draft.choosing_for = i + 1;
          saveDraft(draft);
        });
        const lab = el("label", { for: id }, `Passenger ${i + 1}`);
        host.appendChild(input);
        host.appendChild(lab);
      }
    }
    function renderCoachTabs() {
      const host = document.getElementById("coach-tabs-host");
      host.innerHTML = "";
      if (!coachesData) return;
      const tabs = el("div", { role: "tablist", "aria-label": "Coaches" });
      for (const c of coachesData.coaches) {
        const tab = el("button", { role: "tab", "aria-selected": c.coach === draft.coach ? "true" : "false" }, c.coach);
        tab.dataset.coach = c.coach;
        tab.addEventListener("click", () => {
          draft.coach = c.coach;
          saveDraft(draft);
          renderCoachTabs();
          renderPlan();
        });
        tabs.appendChild(tab);
      }
      host.appendChild(tabs);
      coachPageKey(planHost, coachesData.coaches.map((c) => c.coach), () => draft.coach, (coach) => {
        const prevBerth = document.activeElement?.dataset?.berth ?? "1";
        draft.coach = coach;
        saveDraft(draft);
        renderCoachTabs();
        renderPlan();
        document.querySelector(`[data-coach="${coach}"][data-berth="${prevBerth}"]`)?.focus();
      });
    }
    function renderPlan() {
      const host = document.getElementById("plan-host");
      if (!coachesData) return;
      const preferred = /* @__PURE__ */ new Map();
      for (const [i, pd2] of draft.passengers.entries()) {
        if (pd2.pref && pd2.pref !== "NONE") {
          for (const c of coachesData.coaches) {
            for (const b of c.berths) {
              if (b.type === pd2.pref) {
                const key = `${c.coach}:${b.berth}`;
                const arr = preferred.get(key) ?? [];
                arr.push(i + 1);
                preferred.set(key, arr);
              }
            }
          }
        }
      }
      const chosenPreferred = /* @__PURE__ */ new Map();
      const pd = draft.passengers[draft.choosing_for - 1];
      if (pd && pd.pref !== "NONE") {
        for (const c of coachesData.coaches) {
          for (const b of c.berths) {
            if (b.type === pd.pref) {
              chosenPreferred.set(`${c.coach}:${b.berth}`, [draft.choosing_for]);
            }
          }
        }
      }
      const vertical = window.innerWidth < 768;
      drawCoachPlan(host, coachesData, draft.coach, vertical, {
        preferredTags: chosenPreferred,
        onPick: (coach, berth, type) => {
          const p2 = draft.passengers[draft.choosing_for - 1];
          if (p2) {
            p2.pref = type;
            saveDraft(draft);
            renderPassengers();
            renderPlan();
            document.querySelector(`[data-coach="${coach}"][data-berth="${berth}"]`)?.focus();
          }
        }
      });
    }
    function quoteFare() {
      if (fareTimer) clearTimeout(fareTimer);
      fareTimer = window.setTimeout(async () => {
        fareSeq += 1;
        const seq = fareSeq;
        const passengers = draft.passengers.filter((pd) => pd.age !== "").map((pd) => ({ age: Number(pd.age) }));
        if (passengers.length === 0) return;
        try {
          const q = await api("POST", "/api/fare-quote", {
            train: p.train,
            run_date: p.run_date,
            from: p.from,
            to: p.to,
            class: p.cls,
            quota: p.quota,
            passengers
          });
          if (seq !== fareSeq) return;
          lastFare = q;
          paintFare(q);
        } catch {
        }
      }, 250);
    }
    function paintFare(q) {
      fareLinesHost.innerHTML = "";
      for (const line of q.lines) {
        const li = el("li", { class: "fare-line" });
        li.appendChild(el("span", {}, line.label));
        li.appendChild(el("span", { class: "num" }, formatPaise(line.amount_paise)));
        fareLinesHost.appendChild(li);
      }
      totalP.textContent = `Total ${formatPaise(q.total_paise)}`;
      totalP.classList.remove("flash");
      void totalP.offsetWidth;
      totalP.classList.add("flash");
      setStatus("Fare total", `Total ${formatPaise(q.total_paise)}`);
    }
    function clearFormProblems() {
      document.querySelectorAll("[data-err]").forEach((n) => {
        n.textContent = "";
      });
      clearAlert("Form problems");
    }
    function fieldLinkHref(field) {
      if (field === "passengers") return "#add";
      if (field === "contact_phone") return "#phone";
      const m = /^passengers\[(\d+)\]/.exec(field);
      if (m) return `#pax-${Number(m[1]) + 1}`;
      return "#";
    }
    function focusField(field) {
      const m = /^passengers\[(\d+)\]\.(\w+)/.exec(field);
      if (m) {
        const idx = Number(m[1]);
        const kind = m[2];
        const groups = passengersHost.querySelectorAll(".passenger-group");
        const group = groups[idx];
        if (group) {
          const sel = kind === "name" ? 'input[type="text"]' : kind === "age" ? ".age-input" : "select";
          group.querySelector(sel)?.focus();
          return;
        }
      }
      if (field === "passengers") {
        addBtn.focus();
        return;
      }
      if (field === "contact_phone") {
        phone.focus();
        return;
      }
      phone.focus();
    }
    function acceptedStatus() {
      const adults = draft.passengers.filter((pd) => Number(pd.age) >= 5).length || 1;
      const m = /AVL (\d+) \/ RAC (\d+) \/ (GNWL|RLWL|PQWL) (\d+)|AVL (\d+) \/ RAC (\d+) \/ REGRET|AVL (\d+) \/ (TQWL) (\d+)|AVL (\d+) \/ REGRET|AVL (\d+)|NOT AVAILABLE|CHART PREPARED/.exec(availLabel) ?? [];
      const gnAvl = Number(m[1] ?? m[5] ?? m[11] ?? m[12] ?? "0");
      const gnRac = Number(m[2] ?? m[6] ?? "0");
      const tqAvl = Number(m[8] ?? "0");
      if (p.quota === "LD" || p.quota === "SS") return "CNF";
      if (p.quota === "TQ") return tqAvl >= adults ? "CNF" : "WL";
      if (availLabel.includes("CHART PREPARED") || availLabel.includes("NOT AVAILABLE")) return "WL";
      if (gnAvl >= adults) return "CNF";
      if (gnAvl + gnRac >= adults) return "RAC";
      return "WL";
    }
    async function openPayDialog(opener) {
      const total = lastFare?.total_paise ?? 0;
      const totalStr = formatPaise(total);
      let payClicked = false;
      const handle = openDialog((dlg) => {
        dlg.setAttribute("aria-label", "Confirm and pay");
        dlg.appendChild(el("h2", {}, "Confirm and pay"));
        const ul = el("ul", { class: "plain" });
        for (const line of lastFare?.lines ?? []) {
          const li = el("li", { class: "fare-line" });
          li.appendChild(el("span", {}, line.label));
          li.appendChild(el("span", { class: "num" }, formatPaise(line.amount_paise)));
          ul.appendChild(li);
        }
        dlg.appendChild(ul);
        const tot = el("p", { class: "fare-total" }, `Total ${totalStr}`);
        dlg.appendChild(tot);
        const actions = el("div", { class: "dialog-actions" });
        const pay = el("button", { class: "btn-primary" }, `Pay ${totalStr}`);
        pay.addEventListener("click", async () => {
          if (payClicked) return;
          payClicked = true;
          pay.disabled = true;
          setStatus("Booking result", "Processing payment");
          await submitBooking(handle, pay);
        });
        const back = el("button", { class: "back-btn" }, "Back");
        back.addEventListener("click", () => {
          handle.close();
          opener.focus();
        });
        actions.appendChild(pay);
        actions.appendChild(back);
        dlg.appendChild(actions);
      }, opener, ".btn-primary");
    }
    async function submitBooking(handle, payBtn) {
      const key = sessionStorage.getItem("pakka-idem-key") ?? newIdemKey();
      const body = {
        train: p.train,
        run_date: p.run_date,
        from: p.from,
        to: p.to,
        class: p.cls,
        quota: p.quota,
        passengers: draft.passengers.map((pd) => ({
          name: pd.name,
          age: Number(pd.age),
          gender: pd.gender,
          berth_preference: pd.pref
        })),
        keep_in_one_coach: draft.keep_in_one_coach,
        lower_berth_only: draft.lower_berth_only,
        accept: acceptedStatus(),
        contact_phone: draft.contact_phone
      };
      try {
        const booking = await api("POST", "/api/bookings", body, { idempotencyKey: key });
        sessionStorage.removeItem("pakka-idem-key");
        clearDraft();
        const pnr = booking.pnr;
        handle.close();
        const statusHost = document.createElement("div");
        statusHost.setAttribute("role", "status");
        statusHost.setAttribute("aria-label", "Booking result");
        statusHost.setAttribute("data-status", "Booking result");
        statusHost.textContent = `Booked. PNR ${pnr}. E-ticket saved. Email copy queued.`;
        document.getElementById("live-regions").appendChild(statusHost);
        location.href = `/bookings/${pnr}`;
      } catch (err) {
        payBtn.removeAttribute("disabled");
        if (err instanceof ApiFail) {
          sessionStorage.setItem("pakka-idem-key", key);
          handle.close();
          payBtn.focus();
          if (err.status === 401) {
            location.href = `/signin?ended=1&next=${encodeURIComponent(location.pathname + location.search)}`;
            return;
          }
          handleBookingError(err, payBtn);
        }
      }
    }
    function handleBookingError(err, opener) {
      const b = err.body;
      if (err.status === 422 && b.errors) {
        renderFormProblems(b.errors);
        return;
      }
      if (b.error === "availability_changed" && b.offer) {
        setAlert("Booking problem", `<p>Availability changed before you paid. Nothing was charged. Now available: ${b.offer.label}.</p>`);
        offerButton(b.offer.label, b.offer.accept, opener);
      } else if (b.error === "waitlist_full") {
        setAlert("Booking problem", `<p>The waiting list for this train is full. Nothing was booked or charged.</p>`);
      } else if (b.error === "party_split") {
        setAlert("Booking problem", `<p>Party could not be kept in one coach. Nothing was booked or charged.</p>`);
      } else if (b.error === "no_lower_berth") {
        setAlert("Booking problem", `<p>No lower berth could be allotted. Nothing was booked or charged.</p>`);
      } else if (b.error === "quota_full") {
        const label = QUOTA_LABEL[p.quota];
        setAlert("Booking problem", `<p>Not enough ${label} quota berths are left. Nothing was booked or charged.</p>`);
      } else if (b.error === "booking_not_open") {
        const d = new Date(b.opens_at.replace("+05:30", "Z"));
        const words = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        setAlert("Booking problem", `<p>Bookings for this train open on ${words}.</p>`);
      } else if (b.error === "tatkal_not_open") {
        const d = new Date(b.opens_at.replace("+05:30", "Z"));
        const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
        const words = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
        setAlert("Booking problem", `<p>Tatkal opens at ${time} IST on ${words}.</p>`);
      } else if (b.error === "chart_prepared") {
        setAlert("Booking problem", `<p>The chart for this train is prepared. Bookings are closed.</p>`);
      } else if (b.error === "payment_unavailable") {
        setAlert("Booking problem", `<p>Payments are down right now. Nothing was charged and no berth is held. Try again in a few minutes.</p>`);
      } else if (b.error === "ticket_storage_unavailable") {
        setAlert("Booking problem", `<p>E-tickets can't be saved right now. Nothing was charged and no berth is held. Try again in a few minutes.</p>`);
      }
      refreshAvailLabel();
    }
    async function refreshAvailLabel() {
      try {
        const d = await api(
          "GET",
          `/api/trains?from=${p.from}&to=${p.to}&date=${p.run_date}&quota=${p.quota}&class=${p.cls}`
        );
        const t = d.trains.find((x) => x.number === p.train);
        const entry = t?.classes.find((c) => c.class === p.cls && c.quota === p.quota);
        if (entry) {
          availLabel = entry.label;
          windowLabel = "open";
          fareAvail.textContent = availLabel;
          setStatus("Fare availability", availLabel);
        }
      } catch {
      }
    }
    function offerButton(offerLabel, accept, opener) {
      const host = document.getElementById("problem-host");
      const existing = host.querySelector(".offer-btn-host");
      existing?.remove();
      const div = el("div", { class: "offer-btn-host" });
      const btn = el("button", { class: "btn-primary" }, `Book at ${offerLabel}`);
      btn.addEventListener("click", async () => {
        clearAlert("Booking problem");
        div.remove();
        const key = newIdemKey();
        const body = {
          train: p.train,
          run_date: p.run_date,
          from: p.from,
          to: p.to,
          class: p.cls,
          quota: p.quota,
          passengers: draft.passengers.map((pd) => ({
            name: pd.name,
            age: Number(pd.age),
            gender: pd.gender,
            berth_preference: pd.pref
          })),
          keep_in_one_coach: draft.keep_in_one_coach,
          lower_berth_only: draft.lower_berth_only,
          accept,
          contact_phone: draft.contact_phone
        };
        setStatus("Booking result", "Processing payment");
        try {
          const booking = await api("POST", "/api/bookings", body, { idempotencyKey: key });
          clearDraft();
          location.href = `/bookings/${booking.pnr}`;
        } catch (err) {
          if (err instanceof ApiFail) {
            if (err.status === 401) {
              location.href = `/signin?ended=1&next=${encodeURIComponent(location.pathname + location.search)}`;
              return;
            }
            handleBookingError(err, opener);
          }
        }
      });
      div.appendChild(btn);
      const cs = el("a", { href: `/trains?from=${p.from}&to=${p.to}&date=${p.run_date}&quota=${p.quota}&class=${p.cls}` }, "Change search");
      div.appendChild(cs);
      host.appendChild(div);
    }
    function renderFormProblems(errors) {
      const links = Object.entries(errors).map(([field, message]) => `<li><a href="${fieldLinkHref(field)}" data-field="${field}">${message}</a></li>`).join("");
      const alertEl = setAlert("Form problems", `<h2>Check these fields</h2><ul>${links}</ul>`);
      for (const [field, message] of Object.entries(errors)) {
        const target = document.querySelector(`[data-err="${field}"]`);
        if (target) target.textContent = message;
      }
      alertEl.querySelector("ul")?.setAttribute("role", "list");
      for (const a of Array.from(alertEl.querySelectorAll("a"))) {
        a.addEventListener("click", (e) => {
          e.preventDefault();
          focusField(a.dataset.field ?? "");
        });
      }
      alertEl.focus();
    }
    main.addEventListener("focusin", () => {
      if (window.innerWidth < 768) {
        const focused = document.activeElement;
        if (focused && (focused.tagName === "INPUT" || focused.tagName === "SELECT")) {
          setTimeout(() => focused.scrollIntoView({ block: "center", behavior: "auto" }), 60);
        }
      }
    });
  }
  function newIdemKey() {
    const key = crypto.randomUUID();
    sessionStorage.setItem("pakka-idem-key", key);
    return key;
  }
  function parseBookingParams() {
    const params = new URLSearchParams(location.search);
    const train = params.get("train");
    const run_date = params.get("run_date");
    const from = params.get("from");
    const to = params.get("to");
    const cls = params.get("class") ?? "SL";
    const quota = params.get("quota") ?? "GN";
    if (!train || !run_date || !from || !to) return null;
    return { train, run_date, from, to, cls, quota };
  }
  function buildRibbon(stops, p) {
    const ribbon = document.createElement("div");
    ribbon.className = "ribbon";
    ribbon.setAttribute("role", "region");
    ribbon.setAttribute("aria-label", "Route");
    const strip = el("div", { class: "strip" });
    const fromStop = el("div", { class: "stop terminal" });
    fromStop.appendChild(el("span", { class: "code" }, p.from));
    const toStop = el("div", { class: "stop terminal" });
    toStop.appendChild(el("span", { class: "code" }, p.to));
    strip.appendChild(fromStop);
    strip.appendChild(toStop);
    ribbon.appendChild(strip);
    return ribbon;
  }

  // src/client/detail.ts
  init_api();
  init_ui();
  init_shell();
  init_format();
  var lastShown = /* @__PURE__ */ new Map();
  var paintedVersion = 0;
  var pollTimer = null;
  var cancelDialogOpen = false;
  var heldBack = [];
  var dropPlaying = false;
  var lastGoodStamp = null;
  async function renderBookingDetail(pnr) {
    setTitle(`PNR ${pnr}`);
    const account2 = currentAccount() ?? await loadAccount();
    if (!account2) {
      location.href = `/signin?next=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }
    await fetchClock();
    let body;
    try {
      body = await api("GET", `/api/bookings/${pnr}`);
    } catch (e) {
      if (e instanceof ApiFail && e.status === 404) {
        renderNotFound("Booking not found");
        return;
      }
      throw e;
    }
    paintedVersion = body.version;
    const main = el("main", { id: "main" });
    const search = await api(
      "GET",
      `/api/trains?from=${body.from.code}&to=${body.to.code}&date=${body.run_date}&quota=GN&class=${body.class}`
    ).catch(() => null);
    const train = search?.trains.find((t) => t.number === body.train.number);
    const ribbon = train ? renderRibbon(train.stops.map((s, i) => ({
      code: s.code,
      name: s.name,
      time: stampHHMM(s.departure_at),
      terminal: i === 0 || i === train.stops.length - 1
    }))) : renderRibbon([
      { code: body.from.code, name: body.from.name, time: null, terminal: true },
      { code: body.to.code, name: body.to.name, time: null, terminal: true }
    ]);
    renderShell(main, { ribbon });
    const h1 = el("h1", {}, `PNR ${pnr}`);
    main.appendChild(h1);
    const live = document.getElementById("live-regions");
    for (const name of ["PNR updates", "Booking result", "Cancellation result"]) {
      const d = el("div", { class: "status-line" });
      d.setAttribute("role", "status");
      d.setAttribute("aria-label", name);
      d.setAttribute("data-status", name);
      live.appendChild(d);
    }
    const grid = el("div", { class: "detail-grid" });
    main.appendChild(grid);
    const col1 = el("div", {});
    const col2 = el("div", {});
    const col3 = el("div", {});
    grid.appendChild(col1);
    grid.appendChild(col2);
    grid.appendChild(col3);
    let coachesData = null;
    let currentCoach = null;
    try {
      coachesData = await api(
        "GET",
        `/api/trains/${body.train.number}/runs/${body.run_date}/coaches?class=${body.class}&from=${body.from.code}&to=${body.to.code}`
      );
      currentCoach = coachesData.coaches[0]?.coach ?? null;
    } catch {
    }
    paint(body, true);
    startPolling(pnr);
    function paint(b, isFirst) {
      const changed = [];
      const prev = lastShown.get(b.pnr) ?? {};
      for (const p of b.passengers) {
        const before = prev[p.number];
        if (before !== void 0 && before !== p.current_status.label) {
          changed.push({ number: p.number, from: before, to: p.current_status.label });
        }
        prev[p.number] = p.current_status.label;
      }
      lastShown.set(b.pnr, prev);
      col1.innerHTML = "";
      const summary = el("div", { class: "panel" });
      const dl = el("dl", { class: "kv" });
      const add = (k, v) => {
        dl.appendChild(el("dt", {}, k));
        dl.appendChild(el("dd", {}, v));
      };
      add("Train", `${b.train.number} ${b.train.name}`);
      add("Run date", stampWords(`${b.run_date}T00:00:00+05:30`));
      add("From", `${b.from.code} ${b.from.name}`);
      add("To", `${b.to.code} ${b.to.name}`);
      add("Class", b.class);
      add("Quota", QUOTA_LABEL[b.quota] ?? b.quota);
      add("Departure", `${stampHHMM(b.departure_at)} IST`);
      add("Arrival", `${stampHHMM(b.arrival_at)} IST`);
      add("Total fare", formatPaise(b.total_paise));
      add("Contact", b.contact_phone);
      summary.appendChild(dl);
      col1.appendChild(summary);
      const chartPanel = el("div", { class: "panel" });
      if (b.chart_prepared) {
        const h2 = el("h2", {}, "Chart prepared");
        chartPanel.appendChild(h2);
        chartPanel.appendChild(el("p", {}, "Statuses are final. Berths no longer move."));
      } else {
        const t = parseStamp(b.chart_at);
        const hh = `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
        const p = el("p", {}, `Chart at ${hh} IST, ${stampWords(b.chart_at)}`);
        p.prepend(lucideIcon("clock"));
        chartPanel.appendChild(p);
      }
      col1.appendChild(chartPanel);
      const passHost = el("ul", { "aria-label": "Passengers", class: "plain" });
      passHost.id = "passengers-list";
      for (const p of b.passengers) {
        const li = el("li", { class: "passenger-line" });
        li.dataset.passenger = String(p.number);
        const label = `${p.number} ${p.name} ${p.age} ${p.current_status.label}`;
        li.appendChild(el("span", {}, `Passenger ${p.number}`));
        li.appendChild(el("span", {}, `${p.name}, ${p.age}`));
        const chip = buildChip(p.current_status.label, p.number);
        li.appendChild(chip);
        li.setAttribute("aria-label", label);
        if (p.current_status.status === "CHART_NOT_CONFIRMED") {
          const refund = b.refunds.find((r) => r.reason === "chart");
          const text = refund?.status === "issued" ? "Not confirmed \u2014 refund issued" : "Not confirmed \u2014 refund pending";
          const span = el("span", { class: "small" }, text);
          span.setAttribute("data-notcnf", String(p.number));
          li.appendChild(span);
        }
        passHost.appendChild(li);
      }
      col1.appendChild(passHost);
      col2.innerHTML = "";
      const planPanel = el("div", { class: "panel" });
      planPanel.appendChild(el("h2", {}, "Coach plan"));
      if (coachesData) {
        const tabsHost = el("div", {});
        const tabs = el("div", { role: "tablist", "aria-label": "Coaches" });
        for (const c of coachesData.coaches) {
          const tab = el("button", { role: "tab", "aria-selected": c.coach === currentCoach ? "true" : "false" }, c.coach);
          tab.addEventListener("click", () => {
            currentCoach = c.coach;
            paintPlan();
            tabs.querySelectorAll('[role="tab"]').forEach((x) => x.setAttribute("aria-selected", x.textContent === c.coach ? "true" : "false"));
          });
          tabs.appendChild(tab);
        }
        tabsHost.appendChild(tabs);
        planPanel.appendChild(tabsHost);
        const planHost = el("div", { class: "coach-frame", id: "detail-plan-host" });
        planPanel.appendChild(planHost);
        col2.appendChild(planPanel);
        paintPlan();
      } else {
        planPanel.appendChild(el("p", {}, "The coach plan is not available."));
        col2.appendChild(planPanel);
      }
      const existingWhat = document.getElementById("what-changed");
      existingWhat?.remove();
      const queue = el("div", { role: "region", "aria-label": "Queue" });
      const queueWrap = el("div", { class: "queue-cols" });
      const wlLane = el("div", { class: "queue-lane", role: "region", "aria-label": "WL lane" });
      wlLane.appendChild(el("h3", {}, "WL lane"));
      const wlChips = el("div", { class: "chips" });
      const racLane = el("div", { class: "queue-lane", role: "region", "aria-label": "RAC lane" });
      racLane.appendChild(el("h3", {}, "RAC lane"));
      const racChips = el("div", { class: "chips" });
      for (const p of b.passengers) {
        const st = p.current_status;
        if (["GNWL", "RLWL", "PQWL", "TQWL"].includes(st.status)) {
          wlChips.appendChild(buildQueueChip(p.number, st.label));
        } else if (st.status === "RAC") {
          racChips.appendChild(buildQueueChip(p.number, st.label));
        }
      }
      wlLane.appendChild(wlChips);
      racLane.appendChild(racChips);
      queueWrap.appendChild(wlLane);
      queueWrap.appendChild(racLane);
      queue.appendChild(queueWrap);
      if (window.innerWidth < 768) col2.appendChild(queue);
      else col3.appendChild(queue);
      const panel3 = el("div", { class: "panel" });
      panel3.appendChild(el("h2", {}, "Tickets and refunds"));
      const ticketsList = el("ul", { "aria-label": "E-tickets", class: "tickets-list" });
      for (const t of b.tickets) {
        const li = el("li");
        const a = el(
          "a",
          { href: `/api/bookings/${b.pnr}/tickets/${t.version}` },
          `Download e-ticket v${t.version} (${TICKET_KIND_LABEL[t.kind] ?? t.kind})`
        );
        a.addEventListener("click", (e) => {
          e.preventDefault();
          downloadTicket(b.pnr, t.version);
        });
        li.appendChild(a);
        ticketsList.appendChild(li);
      }
      panel3.appendChild(ticketsList);
      const refundsList = el("ul", { "aria-label": "Refunds", class: "refunds-list" });
      for (const r of b.refunds) {
        const li = el("li");
        li.appendChild(el("span", { class: "num" }, `${formatPaise(r.refund_paise)}`));
        li.appendChild(document.createTextNode(" "));
        const state2 = el("span", { class: "refund-state" }, r.status === "issued" ? "Refund issued" : "Refund pending");
        li.appendChild(state2);
        refundsList.appendChild(li);
      }
      panel3.appendChild(refundsList);
      if (b.cancellations.length > 0) {
        panel3.appendChild(el("h3", {}, "Cancellations"));
        for (const c of b.cancellations) {
          const ul = el("ul", { class: "plain" });
          for (const p of c.passengers) {
            const li = el("li", { class: "small" });
            li.textContent = `Passenger ${p.number}: ${BAND_LABEL[p.band] ?? p.band}, refund ${formatPaise(p.refund_paise)}`;
            ul.appendChild(li);
          }
          panel3.appendChild(ul);
        }
      }
      col3.appendChild(panel3);
      const cancellable = b.passengers.filter((p) => !["CAN", "CHART_NOT_CONFIRMED"].includes(p.current_status.status) && b.state !== "journey_complete");
      if (cancellable.length > 0) {
        const cancelBtn = el("button", { class: "cancel-btn" }, "Cancel passengers");
        cancelBtn.addEventListener("click", () => openCancelDialog(cancelBtn, b));
        col3.appendChild(cancelBtn);
      }
      if (!isFirst && changed.length > 0) {
        if (cancelDialogOpen) {
          heldBack.push(...changed);
        } else if (prefersReducedMotion()) {
          playReducedMotion(changed);
        } else {
          playChartDrop(changed, b);
        }
      }
      lastGoodStamp = businessNowStamp();
    }
    function paintPlan() {
      if (!coachesData || !currentCoach) return;
      const host = document.getElementById("detail-plan-host");
      if (!host) return;
      const occupantTags = /* @__PURE__ */ new Map();
      for (const p of body.passengers) {
        const st = p.current_status;
        if ((st.status === "CNF" || st.status === "RAC") && st.coach && st.berth) {
          const key = `${st.coach}:${st.berth}`;
          const arr = occupantTags.get(key) ?? [];
          arr.push({ number: p.number, rac: st.status === "RAC" });
          occupantTags.set(key, arr);
        }
      }
      drawCoachPlan(host, coachesData, currentCoach, window.innerWidth < 768, {
        preferredTags: /* @__PURE__ */ new Map(),
        occupantTags
      });
      coachPageKey(host, coachesData.coaches.map((c) => c.coach), () => currentCoach ?? coachesData.coaches[0].coach, (coach) => {
        const prevBerth = document.activeElement?.dataset?.berth ?? "1";
        currentCoach = coach;
        const tabs = document.querySelectorAll('#detail-plan-host [role="tab"]');
        paintPlan();
        document.querySelectorAll('[role="tab"]').forEach((t) => t.setAttribute("aria-selected", t.textContent === coach ? "true" : "false"));
        const focusBack = document.querySelector(`[data-coach="${coach}"][data-berth="${prevBerth}"]`);
        focusBack?.focus();
      });
    }
    function buildChip(label, number) {
      const st = label.split(" ")[0];
      const chip = el("span", { class: `chip ${chipClass(st === "NOT" ? "CHART_NOT_CONFIRMED" : st)}`, "data-chip": String(number) });
      const txt = el("span", { class: "txt" }, label);
      chip.appendChild(txt);
      return chip;
    }
    function buildQueueChip(number, label) {
      const chip = buildChip(label, number);
      chip.dataset.lane = label.split(" ")[0] === "RAC" ? "rac" : "wl";
      return chip;
    }
    function startPolling(pnrArg) {
      const tick = async () => {
        try {
          const b = await api("GET", `/api/bookings/${pnrArg}`);
          if (b.version > paintedVersion) {
            paintedVersion = b.version;
            body = b;
            if (cancelDialogOpen) {
              const prev = lastShown.get(b.pnr) ?? {};
              for (const p of b.passengers) {
                const before = prev[p.number];
                if (before !== void 0 && before !== p.current_status.label) {
                  heldBack.push({ number: p.number, from: before, to: p.current_status.label });
                }
                prev[p.number] = p.current_status.label;
              }
              lastShown.set(b.pnr, prev);
            } else if (dropPlaying) {
              heldBack.push(...collectChanges(b));
            } else {
              const wasFirst = false;
              paint(b, wasFirst);
            }
          }
          lastGoodStamp = businessNowStamp();
          scheduleNext(b);
        } catch {
          setStatus("PNR updates", `Can't reach Pakka right now. Showing status from ${lastGoodStamp ? stampHHMM(lastGoodStamp) : "--:--"} IST.`);
          scheduleNext(null);
        }
      };
      const scheduleNext = (b) => {
        if (pollTimer) clearTimeout(pollTimer);
        const done = b && b.state === "journey_complete" && b.refunds.every((r) => r.status === "issued");
        if (done) return;
        pollTimer = window.setTimeout(tick, 2e4);
      };
      pollTimer = window.setTimeout(tick, 2e4);
    }
    function collectChanges(b) {
      const prev = lastShown.get(b.pnr) ?? {};
      const out = [];
      for (const p of b.passengers) {
        const before = prev[p.number];
        if (before !== void 0 && before !== p.current_status.label) {
          out.push({ number: p.number, from: before, to: p.current_status.label });
        }
        prev[p.number] = p.current_status.label;
      }
      lastShown.set(b.pnr, prev);
      return out;
    }
    async function playChartDrop(changes, b) {
      dropPlaying = true;
      announceLines(changes);
      const sorted = [...changes].sort((x, y) => x.number - y.number);
      for (const ch of sorted) {
        await dropOne(ch, b);
      }
      dropPlaying = false;
      if (heldBack.length > 0) {
        const batch = heldBack;
        heldBack = [];
        paint(body, false);
        await playChartDrop(batch, body);
      }
    }
    function announceLines(changes) {
      const lines = changes.map((c) => `Passenger ${c.number}: ${speakLabel(c.from)} to ${speakLabel(c.to)}`);
      setStatus("PNR updates", lines.join("\n"));
    }
    function speakLabel(label) {
      if (label.startsWith("CNF ")) {
        const parts = label.split(" ");
        const pos = { LB: "lower", MB: "middle", UB: "upper", SL: "side lower", SU: "side upper" }[parts[3]] ?? "lower";
        return `CNF, ${parts[1]} berth ${parts[2]}, ${pos}`;
      }
      if (label === "NOT CNF") return "not confirmed, refund pending";
      if (label === "CAN") return "cancelled";
      return label;
    }
    async function dropOne(ch, b) {
      const chip = document.querySelector(`[data-chip="${ch.number}"]`);
      if (!chip) return;
      const fromLabel = ch.from;
      const toLabel = ch.to;
      const fromKind = kindOf(fromLabel);
      const toKind = kindOf(toLabel);
      const fromNum = Number(fromLabel.split(" ")[1] ?? "0");
      const toNum = toKind === fromKind ? Number(toLabel.split(" ")[1] ?? "0") : 1;
      if (fromKind === "wl" && fromNum > toNum) {
        const steps = fromNum - toNum;
        const duration = Math.min(420, Math.max(240, steps * 30));
        for (let n = fromNum; n >= toNum; n--) {
          const at = (fromNum - n) / Math.max(1, steps) * duration;
          await sleep(at === 0 ? 0 : Math.max(16, duration / steps));
          chip.textContent = `${fromLabel.split(" ")[0]} ${n}`;
        }
      }
      if (toKind === "rac" || toKind === "cnf") {
        const target = findBerthCell(toLabel, b);
        if (target) {
          const fromRect = chip.getBoundingClientRect();
          const toRect = target.getBoundingClientRect();
          const dx = toRect.left - fromRect.left;
          const dy = toRect.top - fromRect.top;
          chip.style.position = "fixed";
          chip.style.left = `${fromRect.left}px`;
          chip.style.top = `${fromRect.top}px`;
          chip.style.zIndex = "50";
          const duration = toKind === "rac" ? 320 : 420;
          const anim = chip.animate(
            [
              { transform: "translate(0, 0) scale(1)", opacity: 1 },
              { transform: `translate(${dx}px, ${dy}px) scale(${toKind === "rac" ? 0.6 : 1})`, opacity: 0.9 }
            ],
            { duration, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" }
          );
          await anim.finished.catch(() => void 0);
        }
      }
      const finalChip = document.querySelector(`[data-chip="${ch.number}"]`);
      if (finalChip) {
        finalChip.className = `chip ${chipClass(kindOf(toLabel) === "cnf" ? "CNF" : toKind === "rac" ? "RAC" : toKind === "wl" ? "WL" : toKind === "can" ? "CAN" : "CHART_NOT_CONFIRMED")}`;
        finalChip.style.position = "";
        finalChip.style.left = "";
        finalChip.style.top = "";
        finalChip.style.zIndex = "";
        finalChip.textContent = "";
        const txt = el("span", { class: "txt" }, toLabel);
        finalChip.appendChild(txt);
      }
      await sleep(120);
    }
    function kindOf(label) {
      if (label.startsWith("CNF")) return "cnf";
      if (label.startsWith("RAC")) return "rac";
      if (label === "CAN") return "can";
      if (label === "NOT CNF") return "notcnf";
      if (label === "NOSB") return "nosb";
      return "wl";
    }
    function findBerthCell(toLabel, b) {
      const parts = toLabel.split(" ");
      if (kindOf(toLabel) === "cnf") {
        const coach = parts[1];
        const berth = parts[2];
        return document.querySelector(`[data-coach="${coach}"][data-berth="${berth}"]`);
      }
      if (kindOf(toLabel) === "rac") {
        const coach = parts[2];
        const berth = parts[3];
        return document.querySelector(`[data-coach="${coach}"][data-berth="${berth}"]`);
      }
      return null;
    }
    function playReducedMotion(changes) {
      announceLines(changes);
      const host = col2;
      const region = el("div", { class: "what-changed", role: "region", "aria-label": "What changed", id: "what-changed" });
      const ul = el("ul");
      for (const c of changes) {
        ul.appendChild(el("li", {}, `Passenger ${c.number}: ${speakLabel(c.from)} to ${speakLabel(c.to)}`));
      }
      region.appendChild(el("h3", {}, "What changed"));
      region.appendChild(ul);
      host.insertBefore(region, host.firstChild);
    }
    function sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }
    async function downloadTicket(pnrArg, version) {
      try {
        const res = await fetch(`/api/bookings/${pnrArg}/tickets/${version}`, { credentials: "same-origin" });
        if (!res.ok) {
          setAlert("Ticket problem", `<p>E-tickets can't be downloaded right now. Try again in a few minutes.</p>`);
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = el("a", { href: url, download: `e-ticket-${pnrArg}-v${version}.pdf` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        setAlert("Ticket problem", `<p>E-tickets can't be downloaded right now. Try again in a few minutes.</p>`);
      }
    }
    function openCancelDialog(opener, b) {
      cancelDialogOpen = true;
      const selected = /* @__PURE__ */ new Set();
      let quoteTimer = null;
      const handle = openDialog((dlg) => {
        dlg.setAttribute("aria-label", "Cancel passengers");
        dlg.appendChild(el("h2", {}, "Cancel passengers"));
        const listHost = el("div", { id: "cancel-list" });
        dlg.appendChild(listHost);
        const previewHost = el("ul", { "aria-label": "Refund preview", class: "plain", id: "refund-preview" });
        dlg.appendChild(previewHost);
        const actions = el("div", { class: "dialog-actions" });
        const confirmBtn = el("button", { class: "btn-primary", id: "cancel-confirm" }, "Cancel and refund \u2014");
        confirmBtn.disabled = true;
        const keepBtn = el("button", { id: "keep-booking" }, "Keep booking");
        actions.appendChild(confirmBtn);
        actions.appendChild(keepBtn);
        dlg.appendChild(actions);
        const renderList = () => {
          listHost.innerHTML = "";
          const cancellable = body.passengers.filter((p) => !["CAN", "CHART_NOT_CONFIRMED"].includes(p.current_status.status) && body.state !== "journey_complete");
          for (const p of cancellable) {
            const id = `cancel-pax-${p.number}`;
            const line = el("div", { class: "checkline" });
            const input = el("input", { type: "checkbox", id });
            input.setAttribute("aria-label", `Passenger ${p.number}`);
            if (selected.has(p.number)) input.checked = true;
            input.addEventListener("change", () => {
              if (input.checked) selected.add(p.number);
              else selected.delete(p.number);
              quoteSoon();
            });
            const lab = el("label", { for: id }, `Passenger ${p.number} \u2014 ${p.current_status.label}`);
            line.appendChild(input);
            line.appendChild(lab);
            listHost.appendChild(line);
          }
        };
        const quoteSoon = () => {
          if (quoteTimer) clearTimeout(quoteTimer);
          quoteTimer = window.setTimeout(quoteNow, 150);
        };
        const quoteNow = async () => {
          const numbers = [...selected].sort((a, b2) => a - b2);
          if (numbers.length === 0) {
            previewHost.innerHTML = "";
            confirmBtn.textContent = "Cancel and refund \u2014";
            confirmBtn.disabled = true;
            return;
          }
          try {
            const q = await api(
              "POST",
              `/api/bookings/${b.pnr}/cancellation-quote`,
              { passengers: numbers }
            );
            previewHost.innerHTML = "";
            for (const p of q.passengers) {
              const li = el("li");
              const bandLabel = BAND_LABEL[p.band] ?? p.band;
              const gstPart = p.gst_paise > 0 ? ` incl. GST ${formatPaise(p.gst_paise)}` : "";
              li.textContent = `Passenger ${p.number}: ${bandLabel}, deduction ${formatPaise(p.deduction_paise)}${gstPart}, refund ${formatPaise(p.refund_paise)}`;
              previewHost.appendChild(li);
            }
            confirmBtn.textContent = `Cancel and refund ${formatPaise(q.refund_paise)}`;
            confirmBtn.disabled = false;
          } catch {
          }
        };
        renderList();
        quoteNow();
        keepBtn.addEventListener("click", () => {
          handle.close();
          cancelDialogOpen = false;
          opener.focus();
          if (heldBack.length > 0 && !prefersReducedMotion()) {
            const batch = heldBack;
            heldBack = [];
            paint(body, false);
            void playChartDrop(batch, body);
          } else if (heldBack.length > 0) {
            const batch = heldBack;
            heldBack = [];
            paint(body, false);
            playReducedMotion(batch);
          }
        });
        confirmBtn.addEventListener("click", async () => {
          const numbers = [...selected].sort((a, b2) => a - b2);
          if (numbers.length === 0) return;
          confirmBtn.disabled = true;
          setStatus("Cancellation result", "Cancelling");
          try {
            const res = await api(
              "POST",
              `/api/bookings/${b.pnr}/cancellations`,
              { passengers: numbers },
              { idempotencyKey: crypto.randomUUID() }
            );
            paintedVersion = res.booking.version;
            body = res.booking;
            handle.close();
            cancelDialogOpen = false;
            opener.focus();
            const refundTotal = res.cancellation.refund_paise;
            setStatus("Cancellation result", refundTotal > 0 ? `Cancelled. Refund of ${formatPaise(refundTotal)} recorded.` : "Cancelled. No refund is due.");
            paint(res.booking, false);
          } catch (err) {
            confirmBtn.disabled = false;
            if (err instanceof ApiFail) {
              if (err.body.error === "already_cancelled") {
                setStatus("Cancellation result", "That passenger is already cancelled.");
              } else if (err.body.error === "journey_complete") {
                setStatus("Cancellation result", "This journey is complete. It can no longer be cancelled.");
              }
              handle.close();
              cancelDialogOpen = false;
              opener.focus();
            }
          }
        });
      }, opener, "#cancel-list input");
      const observer = new MutationObserver(() => {
      });
      observer.disconnect();
    }
  }
  function renderNotFound(title) {
    setTitle(title);
    const main = el("main", { id: "main" });
    renderShell(main);
    main.appendChild(el("h1", {}, title));
  }

  // src/client/main.ts
  init_misc();

  // src/client/auth.ts
  init_api();
  init_ui();
  init_shell();
  function safeNext(next) {
    if (next === null) return null;
    if (!next.startsWith("/")) return INVALID_NEXT;
    if (next.length > 1 && (next[1] === "/" || next[1] === "\\")) return INVALID_NEXT;
    if (next.includes("\\")) return INVALID_NEXT;
    if (/[\x00-\x1F\x7F]/.test(next)) return INVALID_NEXT;
    return next;
  }
  var INVALID_NEXT = "/";
  var BOOKINGS_LANDING = "/bookings";
  function landingPath(nextParam) {
    const next = safeNext(nextParam);
    if (next === null) return BOOKINGS_LANDING;
    return next;
  }
  function problemAlertCopy(body) {
    if (body.error === "invalid_credentials") return "Email or password is wrong.";
    if (body.error === "email_taken") return "An account already uses this email.";
    if (body.errors) {
      const first = Object.values(body.errors)[0];
      if (first) return first;
    }
    return "Something went wrong. Try again.";
  }
  function fieldErrorsList(body) {
    return body.errors ?? {};
  }
  async function renderAuth(mode) {
    setTitle(mode === "signin" ? "Sign in" : "Create account");
    const params = new URLSearchParams(location.search);
    const nextParam = params.get("next");
    const main = el("main", { id: "main" });
    renderShell(main);
    const h = el("h1", {}, mode === "signin" ? "Sign in" : "Create account");
    main.appendChild(h);
    const form = el("form", { novalidate: "novalidate" });
    const fields = mode === "signin" ? [
      { key: "email", label: "Email", type: "email", value: "" },
      { key: "password", label: "Password", type: "password", value: "" }
    ] : [
      { key: "name", label: "Full name", type: "text", value: "" },
      { key: "email", label: "Email", type: "email", value: "" },
      { key: "phone", label: "Mobile number", type: "tel", value: "" },
      { key: "password", label: "Password", type: "password", value: "" }
    ];
    const inputs = {};
    for (const f of fields) {
      const row = el("div", { class: "field" });
      const id = nextId("f");
      const label = el("label", { for: id }, f.label);
      const input = el("input", { id, name: f.key, type: f.type, autocomplete: "off" });
      input.setAttribute("aria-label", f.label);
      inputs[f.key] = input;
      row.appendChild(label);
      row.appendChild(input);
      const err = el("div", { class: "field-error", "data-err": f.key });
      row.appendChild(err);
      form.appendChild(row);
    }
    const submit = el(
      "button",
      { class: "btn-primary", type: "submit" },
      mode === "signin" ? "Sign in" : "Create account"
    );
    form.appendChild(submit);
    main.appendChild(form);
    if (mode === "signin" && params.get("ended") === "1") {
      setAlert("Sign-in problem", "<p>Your session ended. Sign in again to finish this booking. Nothing was charged.</p>");
    }
    if (mode === "signin") {
      const p = el("p");
      const nextEnc = nextParam ? `?next=${encodeURIComponent(nextParam)}` : "";
      p.appendChild(el("a", { href: `/register${nextEnc}` }, "Create account"));
      main.appendChild(p);
    } else {
      const p = el("p");
      const nextEnc = nextParam ? `?next=${encodeURIComponent(nextParam)}` : "";
      p.appendChild(el("a", { href: `/signin${nextEnc}` }, "Sign in"));
      main.appendChild(p);
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAlert("Sign-in problem");
      const body = {};
      for (const f of fields) body[f.key] = inputs[f.key].value;
      try {
        const account2 = await api(
          "POST",
          mode === "signin" ? "/api/session" : "/api/accounts",
          body
        );
        setAccount(account2);
        sessionStorage.clear();
        location.href = landingPath(nextParam);
      } catch (err) {
        if (err instanceof ApiFail) {
          const copy = problemAlertCopy(err.body);
          setAlert("Sign-in problem", `<p>${copy}</p>`);
          for (const [k, v] of Object.entries(fieldErrorsList(err.body))) {
            const target = form.querySelector(`[data-err="${k}"]`);
            if (target) target.textContent = v;
          }
        }
      }
    });
  }

  // src/client/main.ts
  init_ui();
  async function route() {
    const path = location.pathname;
    await loadAccount();
    if (path === "/" || path === "") return renderSearch();
    if (path === "/trains") return renderResults();
    if (path.startsWith("/book") && !path.startsWith("/bookings")) return renderBooking();
    if (path === "/bookings") return renderMyBookings();
    const bookingMatch = /^\/bookings\/(\d{10})$/.exec(path);
    if (bookingMatch) return renderBookingDetail(bookingMatch[1]);
    const bookingBad = /^\/bookings\/[^/]+$/.exec(path);
    if (bookingBad) {
      const { renderBookingNotFound: renderBookingNotFound2 } = await Promise.resolve().then(() => (init_misc(), misc_exports));
      return renderBookingNotFound2();
    }
    if (path === "/pnr") return renderPnrStatus(null);
    const pnrMatch = /^\/pnr\/(\d{10})$/.exec(path);
    if (pnrMatch) return renderPnrStatus(pnrMatch[1]);
    if (path === "/signin") return renderAuth("signin");
    if (path === "/register") return renderAuth("register");
    return renderPageNotFound();
  }
  async function boot() {
    try {
      const c = await fetchClock();
      window.__pakkaClockRate = c.rate;
      window.setInterval(() => {
        void fetchClock();
      }, 3e4);
    } catch {
    }
    await route();
  }
  window.addEventListener("popstate", () => {
    void route();
  });
  boot();
})();
