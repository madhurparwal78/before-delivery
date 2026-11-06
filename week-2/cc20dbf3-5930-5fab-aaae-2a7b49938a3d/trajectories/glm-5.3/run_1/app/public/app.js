/* Common Shed Co. Shedline — browser app */
(() => {
  "use strict";

  /* ---------- shared state ---------- */

  const state = {
    user: null,
    library: null,
    route: null,
  };

  const PENDING_COPY = {
    signIn: "Signing in…",
    hold: "Finding a free unit…",
    cancelHold: "Cancelling…",
    showMore: "Loading more…",
    markReady: "Marking ready…",
    checkout: "Lending…",
    renew: "Renewing…",
    addPhoto: "Uploading photo…",
    checkIn: "Checking in…",
    inspect: "Saving…",
    settle: "Settling…",
  };

  /* ---------- helpers ---------- */

  const $app = document.getElementById("app");

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs !== null) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === "class") el.className = value;
        else if (key === "text") el.textContent = value;
        else if (key === "html") el.innerHTML = value;
        else if (key.startsWith("on") && typeof value === "function") {
          el.addEventListener(key.slice(2), value);
        } else if (value === true) el.setAttribute(key, "");
        else el.setAttribute(key, String(value));
      }
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function announce(regionId, message) {
    const region = document.getElementById(regionId);
    if (region !== null) region.textContent = message;
  }

  function money(cents) {
    const negative = cents < 0;
    const magnitude = Math.abs(Math.round(cents));
    const dollars = Math.floor(magnitude / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${negative ? "-" : ""}$${dollars}.${String(magnitude % 100).padStart(2, "0")}`;
  }

  function localTime(iso) {
    const zone = state.library ? state.library.time_zone : "UTC";
    const instant = new Date(iso);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).formatToParts(instant);
    const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
    let hour = get("hour");
    if (hour === "24") hour = "00";
    return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}, ${hour}:${get("minute")} ${get("timeZoneName")}`;
  }

  function shortDate(iso) {
    const zone = state.library ? state.library.time_zone : "UTC";
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  }

  async function api(path, options = {}) {
    const headers = options.headers ?? {};
    const init = {
      method: options.method ?? "GET",
      headers,
      credentials: "same-origin",
    };
    if (options.body !== undefined) {
      init.body = options.body;
      if (typeof options.body === "string") headers["Content-Type"] = "application/json";
    }
    const response = await fetch(path, init);
    let payload = null;
    const type = response.headers.get("Content-Type") ?? "";
    if (type.includes("application/json")) {
      payload = await response.json();
    }
    if (!response.ok) {
      const error = new Error(payload && payload.error ? payload.error.message : "Something went wrong.");
      error.status = response.status;
      error.code = payload && payload.error ? payload.error.code : null;
      error.fields = payload && payload.error && payload.error.fields ? payload.error.fields : null;
      throw error;
    }
    return payload;
  }

  function retryKey(context, rowKey, formValues) {
    const signature = `${rowKey ?? ""}|${formValues ?? ""}`;
    const store = retryKeys.get(context) ?? new Map();
    const existing = store.get(signature);
    return existing ?? null;
  }

  const retryKeys = new Map();

  function rememberKey(context, rowKey, formValues, key) {
    if (!retryKeys.has(context)) retryKeys.set(context, new Map());
    retryKeys.get(context).set(`${rowKey ?? ""}|${formValues ?? ""}`, key);
  }

  function freshKey() {
    if (crypto.randomUUID !== undefined) return crypto.randomUUID();
    return `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }

  async function apiWithRetryKey(path, body, context, rowKey, formValues, retryOnDrop = false) {
    let key = retryKey(context, rowKey, formValues);
    if (key === null) {
      key = freshKey();
    }
    let payload = null;
    let failed = null;
    try {
      payload = await api(path, {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (retryOnDrop && error.status === undefined) {
        // The network dropped; retry once with the same key.
        payload = await api(path, {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify(body),
        });
      } else {
        failed = error;
      }
    }
    if (failed !== null) {
      if (failed.code === "billing_unavailable") {
        // Keep the key so the same press retries with it once billing returns.
        rememberKey(context, rowKey, formValues, key);
      } else if (retryKeys.has(context)) {
        // A refused request frees the key for a fresh one.
        retryKeys.get(context).delete(`${rowKey ?? ""}|${formValues ?? ""}`);
      }
      throw failed;
    }
    rememberKey(context, rowKey, formValues, key);
    return payload;
  }

  function setPending(button, copy) {
    if (button === null) return;
    button.dataset.originalText = button.textContent;
    button.textContent = copy;
    button.classList.add("pending");
    button.disabled = true;
  }

  function clearPending(button) {
    if (button === null) return;
    if (button.dataset.originalText !== undefined) button.textContent = button.dataset.originalText;
    button.classList.remove("pending");
    button.disabled = false;
  }

  /* ---------- shell ---------- */

  function renderShell(content, activePath) {
    const navLinks = [];
    if (state.user) {
      if (state.user.role === "member") navLinks.push(["/my-loans", "My loans"]);
      if (state.user.role !== "member") navLinks.push(["/counter", "Counter"]);
      if (state.user.role === "founder") navLinks.push(["/ledger", "Ledger"]);
      navLinks.unshift(["/catalogue", "Catalogue"]);
    }

    const nav = h("nav", { class: "main-nav", id: "main-nav", "aria-label": "Main", hidden: isSmall() },
      h("ul", null, navLinks.map(([href, label]) =>
        h("li", null, h("a", { href, "aria-current": location.pathname === href ? "page" : null }, label))
      ))
    );

    const menuButton = state.user ? h("button", {
      class: "menu-button",
      type: "button",
      "aria-expanded": "false",
      "aria-controls": "main-nav",
      onclick: (event) => {
        const expanded = nav.hidden;
        nav.hidden = !expanded;
        event.currentTarget.setAttribute("aria-expanded", String(expanded));
      },
      onkeydown: (event) => {
        if (event.key === "Escape" && !nav.hidden) {
          nav.hidden = true;
          event.currentTarget.setAttribute("aria-expanded", "false");
          event.currentTarget.focus();
        }
      },
    }, "Menu") : null;

    const header = h("header", { class: "header" },
      h("div", { class: "header-inner" },
        h("a", { class: "wordmark", href: state.user ? homePath() : "/" },
          h("img", { src: "/shedline.svg", alt: "" }),
          "COMMON SHED CO."
        ),
        menuButton,
        nav,
        state.user ? h("button", {
          type: "button",
          onclick: async () => {
            await api("/api/session", { method: "DELETE" });
            state.user = null;
            location.assign("/");
          },
        }, "Sign out") : null,
      )
    );

    $app.replaceChildren(
      header,
      h("main", { id: "content" }, content)
    );
    document.title = "Common Shed Co. — Shedline";
  }

  function isSmall() {
    return window.innerWidth <= 768;
  }

  function homePath() {
    if (state.user === null) return "/";
    return state.user.role === "member" ? "/catalogue" : "/counter";
  }

  function notFoundPage() {
    return h("div", null,
      h("h1", { class: "page-title" }, "Not found"),
      h("p", null, h("a", { href: state.user ? homePath() : "/" }, "Back to the desk")),
    );
  }

  /* ---------- sign in ---------- */

  function signInPage() {
    const email = h("input", { type: "email", id: "email", name: "email", autocomplete: "username" });
    const password = h("input", { type: "password", id: "password", name: "password", autocomplete: "current-password" });
    const emailError = h("span", { class: "field-error", id: "email-field-error", role: "none" });
    const passwordError = h("span", { class: "field-error", id: "password-field-error", role: "none" });
    email.setAttribute("aria-describedby", "email-field-error");
    password.setAttribute("aria-describedby", "password-field-error");
    const form = h("form", { class: "sign-in", onsubmit: async (event) => {
      event.preventDefault();
      const button = event.target.querySelector("button");
      setPending(button, PENDING_COPY.signIn);
      announce("form-status", "");
      emailError.textContent = "";
      passwordError.textContent = "";
      try {
        const payload = await api("/api/session", {
          method: "POST",
          body: JSON.stringify({ email: email.value, password: password.value }),
        });
        state.user = payload.user;
        await loadLibrary();
        location.assign(homePath());
      } catch (error) {
        announce("form-status", error.message);
        if (error.fields !== null && typeof error.fields === "object") {
          if (error.fields.email !== undefined) emailError.textContent = error.fields.email;
          if (error.fields.password !== undefined) passwordError.textContent = error.fields.password;
        }
        email.focus();
      } finally {
        clearPending(button);
      }
    }},
      h("h1", null, "Sign in"),
      h("div", { class: "field" }, h("label", { for: "email" }, "Email"), email, emailError),
      h("div", { class: "field" }, h("label", { for: "password" }, "Password"), password, passwordError),
      h("button", { class: "primary", type: "submit" }, "Sign in"),
      h("p", { id: "form-status", class: "status-region", role: "status", "aria-live": "polite" }),
    );
    return form;
  }

  async function loadLibrary() {
    if (state.library === null) {
      state.library = await api("/api/library");
    }
  }

  /* ---------- catalogue ---------- */

  async function cataloguePage() {
    const payload = await api("/api/items");
    const cards = payload.items.map((item) =>
      h("article", { "aria-label": item.name },
        h("h3", null, h("a", { href: `/items/${item.id}` }, item.name)),
        h("div", { class: "meta" },
          h("span", { class: "label" }, item.category),
        ),
        h("div", { class: "meta" },
          h("span", null, item.deposit_cents > 0 ? `Deposit ${money(item.deposit_cents)}` : "No deposit"),
          h("span", null, `Replacement ${money(item.replacement_cents)}`),
        ),
        h("p", { class: "mono", text: `${item.units_free_today} of ${item.unit_count} free today` }),
        h("div", { class: "lane-preview", "aria-hidden": "true" },
          Array.from({ length: Math.max(item.unit_count, 1) }, (_, i) =>
            h("i", { class: i < item.units_free_today ? "free" : "busy" })
          )
        ),
      )
    );
    return h("div", null, h("h1", { class: "page-title" }, "Catalogue"),
      h("div", { class: "catalogue-grid" }, cards));
  }

  /* ---------- item with lanes ---------- */

  function statusWordFor(span) {
    return { held: "Held", out: "Out", overdue: "Overdue" }[span.status];
  }

  function chip(statusKey, word) {
    return h("span", { class: `chip chip-${statusKey}` }, h("span", { class: `swatch swatch-${statusKey}`, "aria-hidden": "true" }), word);
  }

  function laneStrip(unit, lanesWindow, viewer, hatchedRange) {
    const zone = state.library.time_zone;
    const strip = h("div", { class: "lane-strip", role: "img", "aria-label": "" });
    const today = shortDate(new Date().toISOString());
    for (let i = 0; i < 28; i++) {
      const date = addDays(lanesWindow.from, i);
      const isOpen = isLibraryOpenDay(date);
      const span = unit.spans.find((s) => s.start_date <= date && date <= s.end_date);
      let cls = "day-cell";
      if (!isOpen) cls += " closed";
      else if (span !== undefined) cls += ` busy-${span.status}`;
      if (date === today) cls += " today";
      const cell = h("div", { class: cls });
      if (!isOpen) cell.setAttribute("aria-label", `${date} closed`);
      if (i % 7 === 0) {
        cell.append(h("span", { class: "day-marker mono", text: `${date.slice(8)}/${date.slice(5, 7)}` }));
      }
      strip.append(cell);
    }
    void hatchedRange;
    return strip;
  }

  function addDays(dateText, days) {
    const [y, m, d] = dateText.split("-").map(Number);
    const result = new Date(Date.UTC(y, m - 1, d + days));
    return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
  }

  function isLibraryOpenDay(date) {
    if (!state.library) return true;
    if (state.library.closed_dates.includes(date)) return false;
    const [y, m, d] = date.split("-").map(Number);
    const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return state.library.open_days.includes(weekday);
  }

  function nextOpenDay(date) {
    let candidate = addDays(date, 1);
    for (let i = 0; i < 60; i++) {
      if (isLibraryOpenDay(candidate)) return candidate;
      candidate = addDays(candidate, 1);
    }
    return candidate;
  }

  function firstOpenDayFrom(date) {
    let candidate = date;
    for (let i = 0; i < 60; i++) {
      if (isLibraryOpenDay(candidate)) return candidate;
      candidate = addDays(candidate, 1);
    }
    return date;
  }

  async function itemPage(itemId) {
    const [itemPayload, lanesPayload] = await Promise.all([
      api(`/api/items/${itemId}`),
      api(`/api/items/${itemId}/lanes`),
    ]);
    const item = itemPayload.item;
    await loadLibrary();

    const content = h("div", null);
    const pickup = h("input", { type: "date", id: "pickup-date" });
    const ret = h("input", { type: "date", id: "return-date" });
    const availabilityNum = h("span", { class: "num", text: String(item.units_free_today) });
    const availabilityLabel = h("span", { class: "label", text: `of ${item.unit_count} units free today` });
    const availability = h("div", { class: "availability", role: "region", "aria-label": "Availability" },
      availabilityNum, availabilityLabel);
    const lanesHost = h("div", { role: "region", "aria-label": "Unit lanes" });
    const claimResult = h("p", { id: "claim-result", class: "status-region", role: "status", "aria-live": "polite" });
    const holdButton = h("button", { class: "primary", type: "button", disabled: true }, "Hold a unit");

    let currentLanes = lanesPayload;
    let settledClaimUnitId = null;

    function allowedRange() {
      const today = shortDate(new Date().toISOString());
      return { from: today, to: addDays(today, 27) };
    }

    function renderLanes() {
      lanesHost.replaceChildren(...currentLanes.lanes.map((lane) => {
        const group = h("div", { class: "lane", role: "group", "aria-label": `Unit ${lane.label}` });
        const summaryLines = lane.spans.map((span) => {
          const text = `${statusWordFor(span)} ${span.start_date}–${span.end_date} · back ${span.back_on ?? "—"}`
            + (span.borrower ? ` · ${span.borrower.name}` : (span.mine ? " · yours" : ""));
          return h("div", { class: "span-line mono", text });
        });
        group.append(
          h("div", { class: "lane-head" },
            h("span", { class: "unit-label mono", text: `UNIT ${lane.label}` }),
            lane.busy_for_range === true ? chip("held", "Busy") : chip("free", "Free"),
          ),
          laneStrip(lane, currentLanes, state.user, null),
          h("div", { class: "lane-spans" }, summaryLines.length > 0 ? summaryLines : h("div", { class: "span-line mono", text: "Free for the next 28 days" })),
        );
        if (settledClaimUnitId === lane.unit_id) {
          group.prepend(h("div", { class: "claim-bar settled", role: "img", "aria-label": "Claim bar" }));
        }
        return group;
      }));
    }

    async function refreshLanes(start, end) {
      const query = start !== null && end !== null ? `?start=${start}&end=${end}` : "";
      currentLanes = await api(`/api/items/${itemId}/lanes${query}`);
      renderLanes();
      if (start !== null && end !== null) {
        availabilityNum.textContent = String(currentLanes.units_free ?? 0);
        availabilityLabel.textContent = `of ${item.unit_count} units free for these dates`;
      } else {
        availabilityNum.textContent = String(item.units_free_today);
        availabilityLabel.textContent = `of ${item.unit_count} units free today`;
      }
    }

    function updatePickableDates() {
      const { from, to } = allowedRange();
      pickup.min = from;
      pickup.max = to;
      ret.min = pickup.value || from;
      ret.max = to;
    }

    async function datesChanged() {
      updatePickableDates();
      const start = pickup.value;
      const end = ret.value;
      holdButton.disabled = !(start && end);
      if (start && end) {
        await refreshLanes(start, end);
      } else {
        await refreshLanes(null, null);
      }
    }

    const pickupError = h("span", { class: "field-error", id: "pickup-field-error", role: "none" });
    const returnError = h("span", { class: "field-error", id: "return-field-error", role: "none" });
    pickup.setAttribute("aria-describedby", "pickup-field-error");
    ret.setAttribute("aria-describedby", "return-field-error");

    function guardClosedDay(input, errorHost) {
      errorHost.textContent = "";
      if (input.value === "") return true;
      if (!isLibraryOpenDay(input.value)) {
        errorHost.textContent = "Choose an open day: the library is closed then.";
        input.value = "";
        holdButton.disabled = true;
        return false;
      }
      return true;
    }

    pickup.addEventListener("change", () => {
      guardClosedDay(pickup, pickupError);
      void datesChanged();
    });
    ret.addEventListener("change", () => {
      guardClosedDay(ret, returnError);
      void datesChanged();
    });

    const dateField = (labelText, input) =>
      h("div", { class: "field" }, h("label", { for: input.id }, labelText), input);

    holdButton.addEventListener("click", async () => {
      setPending(holdButton, PENDING_COPY.hold);
      claimResult.textContent = "";
      try {
        const payload = await apiWithRetryKey("/api/holds", {
          item_id: itemId,
          start_date: pickup.value,
          end_date: ret.value,
        }, "hold", `${pickup.value}|${ret.value}`, null, true);
        await playClaimDrop(currentLanes, payload.hold.unit.lane_index, payload.hold.unit.label);
        settledClaimUnitId = payload.hold.unit.id;
        await countNumeralDown(Number(availabilityNum.textContent), payload.units_free);
        announce("claim-result", `Held unit ${payload.hold.unit.lane_index + 1} of ${payload.unit_count}, ${payload.units_free} units still free for these dates`);
        await refreshLanes(pickup.value, ret.value);
      } catch (error) {
        await playClaimDrop(currentLanes, -1, null);
        announce("claim-result", error.message);
        await refreshLanes(pickup.value, ret.value);
      } finally {
        clearPending(holdButton);
      }
    });

    const submitOnEnter = (input) => input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (!holdButton.disabled) holdButton.click();
      }
    });
    submitOnEnter(pickup);
    submitOnEnter(ret);

    content.append(
      h("h1", { class: "page-title" }, item.name),
      h("div", { class: "grid" },
        h("div", { class: "box cols-4" },
          h("div", { class: "meta" }, h("span", { class: "label" }, item.category)),
          h("p", null, item.deposit_cents > 0 ? `Deposit ${money(item.deposit_cents)}` : "No deposit"),
          h("p", null, `Replacement ${money(item.replacement_cents)}`),
          dateField("Pickup date", pickup), pickupError,
          dateField("Return date", ret), returnError,
          holdButton,
          claimResult,
        ),
        h("div", { class: "cols-8" },
          availability,
          lanesHost,
        ),
      ),
    );

    renderLanes();
    updatePickableDates();
    return content;
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** The Availability numeral counts down one whole number at a time over about 420ms. */
  async function countNumeralDown(from, to) {
    if (prefersReducedMotion() || to >= from) return;
    const steps = from - to;
    const perStep = Math.max(1, Math.floor(420 / steps));
    for (let value = from; value > to; value--) {
      const numeral = document.querySelector('.availability .num');
      if (numeral === null) return;
      numeral.textContent = String(value - 1);
      await sleep(perStep);
    }
  }

  async function playClaimDrop(lanes, assignedLaneIndex, assignedUnitLabel) {
    if (prefersReducedMotion()) {
      return;
    }
    const lanesRegion = document.querySelector('[aria-label="Unit lanes"]');
    if (lanesRegion === null) return;
    const laneEls = [...lanesRegion.querySelectorAll(".lane")];
    if (laneEls.length === 0) return;
    const bar = h("div", { class: "claim-bar", role: "img", "aria-label": "Claim bar" });
    document.body.append(bar);
    const place = (element, laneIndex) => {
      const host = laneIndex < laneEls.length ? laneEls[laneIndex] : lanesRegion;
      const hostRect = host.getBoundingClientRect();
      const scrollTop = document.documentElement.scrollTop;
      bar.style.position = "absolute";
      bar.style.left = `${hostRect.left + window.scrollX}px`;
      bar.style.width = `${hostRect.width - 12}px`;
      if (laneIndex < laneEls.length) {
        bar.style.top = `${hostRect.top + scrollTop - 14}px`;
      } else {
        bar.style.top = `${hostRect.bottom + scrollTop + 6}px`;
      }
    };
    place(laneEls[0], 0);
    const stepMs = 140;
    const target = assignedLaneIndex >= 0 ? assignedLaneIndex : laneEls.length;
    for (let i = 0; i <= target; i++) {
      place(laneEls[Math.min(i, laneEls.length - 1)], Math.min(i, target));
      await sleep(stepMs);
    }
    if (assignedLaneIndex >= 0) {
      const lane = laneEls[assignedLaneIndex];
      bar.remove();
      const settled = h("div", { class: "claim-bar settled", role: "img", "aria-label": "Claim bar" });
      settled.style.position = "relative";
      settled.style.width = "auto";
      settled.style.left = "auto";
      settled.style.top = "auto";
      lane.prepend(settled);
      await sleep(260);
    } else {
      bar.style.opacity = "0";
      bar.style.transition = "opacity 0.25s ease";
      await sleep(250);
      bar.remove();
    }
  }

  /* ---------- my loans ---------- */

  function statusWordOfHold(hold) {
    return { requested: "Requested", ready: "Ready", collected: "Collected", expired: "Expired", cancelled: "Cancelled" }[hold.status];
  }

  function statusWordOfLoan(loan) {
    return { out: "Out", overdue: "Overdue", returned: "Returned", inspected: "Inspected", settled: "Settled" }[loan.status];
  }

  function holdRow(hold) {
    const li = h("li", { class: "list-row", tabindex: "-1" });
    li.setAttribute("aria-label", `${hold.item.name}, unit ${hold.unit.label} — ${statusWordOfHold(hold)}`);
    li.append(
      h("span", { class: "main", text: `${hold.item.name}, unit ${hold.unit.label}` }),
      chip(hold.status, statusWordOfHold(hold)),
      h("span", { class: "dates mono", text: `${hold.start_date} → ${hold.end_date}` }),
    );
    if (hold.status === "ready" && hold.pickup_deadline) {
      li.append(h("span", { class: "dates mono", text: `Pick up by ${localTime(hold.pickup_deadline)}` }));
    }
    if (hold.status === "requested" || hold.status === "ready") {
      li.append(h("button", {
        type: "button",
        onclick: async (event) => {
          const button = event.currentTarget;
          setPending(button, PENDING_COPY.cancelHold);
          try {
            await api(`/api/holds/${hold.id}/cancel`, { method: "POST", body: "{}" });
            announce("my-loans-status", "Hold cancelled.");
            await refreshMyLoans();
          } catch (error) {
            announce("my-loans-status", error.message);
            await refreshMyLoans();
          } finally {
            clearPending(button);
          }
        },
      }, "Cancel hold"));
    }
    return li;
  }

  const myLoansState = { holds: [], loans: [], holdsCursor: null, loansCursor: null, holdsAll: [], loansAll: [] };

  async function fetchHoldsPage(cursor) {
    const query = cursor !== null ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return api(`/api/holds${query}`);
  }

  async function fetchLoansPage(cursor) {
    const query = cursor !== null ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return api(`/api/loans${query}`);
  }

  let holdsList = null;
  let loansList = null;

  async function refreshMyLoans() {
    if (holdsList === null || loansList === null) return;
    const [holdsPage, loansPage] = await Promise.all([fetchHoldsPage(null), fetchLoansPage(null)]);
    myLoansState.holdsAll = mergeById(myLoansState.holdsAll, holdsPage.holds);
    myLoansState.loansAll = mergeById(myLoansState.loansAll, loansPage.loans);
    myLoansState.holdsCursor = holdsPage.next_cursor;
    myLoansState.loansCursor = loansPage.next_cursor;
    renderMyLoanLists();
  }

  function mergeById(existing, incoming) {
    const map = new Map(existing.map((row) => [row.id, row]));
    for (const row of incoming) map.set(row.id, row);
    return [...map.values()];
  }

  function sortHolds(rows) {
    return [...rows].sort((a, b) =>
      a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1
    );
  }

  function sortLoans(rows) {
    return [...rows].sort((a, b) =>
      a.checked_out_at < b.checked_out_at ? 1 : a.checked_out_at > b.checked_out_at ? -1 : a.id < b.id ? 1 : -1
    );
  }

  function renderMyLoanLists() {
    if (holdsList === null || loansList === null) return;
    const holds = sortHolds(myLoansState.holdsAll);
    const loans = sortLoans(myLoansState.loansAll);
    holdsList.replaceChildren(...holds.map(holdRow));
    loansList.replaceChildren(...loans.map((loan) =>
      h("li", { class: "list-row" },
        h("a", { class: "main", href: `/loans/${loan.id}`, text: `${loan.item.name}, unit ${loan.unit.label}` }),
        chip(loan.status, statusWordOfLoan(loan)),
        h("span", { class: "dates mono", text: `Due ${localTime(loan.due_at)}` }),
      )
    ));
    const moreHolds = document.getElementById("show-more-holds");
    if (moreHolds !== null) moreHolds.hidden = myLoansState.holdsCursor === null;
    const moreLoans = document.getElementById("show-more-loans");
    if (moreLoans !== null) moreLoans.hidden = myLoansState.loansCursor === null;
  }

  async function myLoansPage() {
    await loadLibrary();
    myLoansState.holdsAll = [];
    myLoansState.loansAll = [];
    const statusRegion = h("p", { id: "my-loans-status", class: "status-region", role: "status", "aria-live": "polite" });
    holdsList = h("ul", { class: "rows", style: "list-style:none;padding:0;margin:0" });
    loansList = h("ul", { class: "rows", style: "list-style:none;padding:0;margin:0" });

    const moreHoldsButton = h("button", {
      class: "show-more", type: "button", id: "show-more-holds", hidden: true,
      onclick: async (event) => {
        const button = event.currentTarget;
        setPending(button, PENDING_COPY.showMore);
        try {
          const page = await fetchHoldsPage(myLoansState.holdsCursor);
          myLoansState.holdsAll = mergeById(myLoansState.holdsAll, page.holds);
          myLoansState.holdsCursor = page.next_cursor;
          const before = holdsList.children.length;
          renderMyLoanLists();
          const added = holdsList.children[before];
          if (added !== undefined) {
            added.classList.add("row-arrival");
            added.focus();
          }
          announce("my-loans-status", `Showing ${holdsList.children.length} holds.`);
        } finally {
          clearPending(button);
        }
      },
    }, "Show more holds");

    const moreLoansButton = h("button", {
      class: "show-more", type: "button", id: "show-more-loans", hidden: true,
      onclick: async (event) => {
        const button = event.currentTarget;
        setPending(button, PENDING_COPY.showMore);
        try {
          const page = await fetchLoansPage(myLoansState.loansCursor);
          myLoansState.loansAll = mergeById(myLoansState.loansAll, page.loans);
          myLoansState.loansCursor = page.next_cursor;
          const before = loansList.children.length;
          renderMyLoanLists();
          const added = loansList.children[before];
          if (added !== undefined) {
            added.classList.add("row-arrival");
            added.querySelector("a").focus();
          }
          announce("my-loans-status", `Showing ${loansList.children.length} loans.`);
        } finally {
          clearPending(button);
        }
      },
    }, "Show more loans");

    const holdsRegion = h("section", { class: "box", "aria-label": "Holds" },
      h("h2", null, "Holds"), holdsList, moreHoldsButton);
    const loansRegion = h("section", { class: "box", "aria-label": "Loans" },
      h("h2", null, "Loans"), loansList, moreLoansButton);

    await refreshMyLoans();
    setInterval(() => { void refreshMyLoans().catch(() => undefined); }, 15000);

    return h("div", null,
      h("h1", { class: "page-title" }, "My loans"),
      statusRegion,
      h("div", { class: "grid" },
        h("div", { class: "cols-5" }, holdsRegion),
        h("div", { class: "cols-7" }, loansRegion),
      ),
    );
  }

  /* ---------- loan page ---------- */

  async function loanPage(loanId) {
    await loadLibrary();
    const payload = await api(`/api/loans/${loanId}`).catch((error) => {
      if (error.status === 404) return null;
      throw error;
    });
    if (payload === null) return notFoundPage();
    return renderLoan(payload.loan);
  }

  function renderLoan(loan) {
    const viewer = state.user;
    const isOwner = viewer.id === loan.member.id;
    const isStaff = viewer.role !== "member";
    const isFounder = viewer.role === "founder";

    const counterResult = h("p", { id: "counter-result", class: "status-region", role: "status", "aria-live": "polite" });
    const renewalResult = h("p", { id: "renewal-result", class: "status-region", role: "status", "aria-live": "polite" });
    const settlementResult = h("p", { id: "settlement-result", class: "status-region", role: "status", "aria-live": "polite" });

    const content = h("div", null);
    const heading = h("h1", { class: "page-title", text: `${loan.item.name}, unit ${loan.unit.label}` });

    const detailRows = [
      ["Status", chip(loan.status, statusWordOfLoan(loan))],
      ["Borrower", h("span", { text: loan.member.name })],
      ["Checked out", h("time", { class: "mono", text: localTime(loan.checked_out_at) })],
      ["Due", h("span", null,
        h("time", { class: "mono", text: localTime(loan.due_at) }),
        loan.renewed_at !== null ? h("span", { class: "mono", text: " renewed", style: "font-weight:600" }) : null,
      )],
    ];
    if (loan.returned_at !== null) {
      detailRows.push(["Returned", h("time", { class: "mono", text: localTime(loan.returned_at) })]);
      detailRows.push(["On time", h("span", { text: loan.on_time ? "Yes" : `No — ${loan.late_days} late days` })]);
    }
    detailRows.push(["Deposit", h("span", { class: "money mono", text: loan.deposit_cents > 0 ? money(loan.deposit_cents) : "No deposit" })]);

    const detailBox = h("div", { class: "box" },
      detailRows.map(([label, value]) => h("div", { class: "row" },
        h("span", { class: "label", style: "min-width:110px", text: label }), value)));

    const checkoutPhotos = photoPanel("Checkout photos", loan, "checkout");
    const returnPhotos = photoPanel("Return photos", loan, "return");

    content.append(heading, detailBox);

    if ((isOwner || isStaff) && loan.status === "out" && loan.renewed_at === null) {
      const newDue = h("input", { type: "date", id: "new-due-date" });
      const renewButton = h("button", {
        class: "primary", type: "button",
        onclick: async (event) => {
          const button = event.currentTarget;
          setPending(button, PENDING_COPY.renew);
          renewalResult.textContent = "";
          try {
            const payload = await apiWithRetryKey(`/api/loans/${loan.id}/renewal`, { due_date: newDue.value }, "renew", loan.id, newDue.value);
            await refreshLoanThenAnnounce(loan.id, "renewal-result", `Renewed. Due ${localTime(payload.loan.due_at)}.`);
          } catch (error) {
            announce("renewal-result", error.message);
          } finally {
            clearPending(button);
          }
        },
      }, "Renew");
      content.append(h("div", { class: "box", style: "margin-top:16px" },
        h("h2", null, "Renewal"),
        h("div", { class: "field" }, h("label", { for: "new-due-date" }, "New due date"), newDue,
          h("span", { class: "field-error", id: "renewal-field-error", role: "none" })),
        renewButton,
        renewalResult,
      ));
      newDue.setAttribute("aria-describedby", "renewal-field-error");
    } else if (isOwner || isStaff) {
      content.append(renewalResult);
    }

    content.append(h("div", { class: "grid", style: "margin-top:16px" },
      h("div", { class: "cols-6" }, checkoutPhotos),
      h("div", { class: "cols-6" }, returnPhotos),
    ));

    if (isStaff) {
      const photoInput = h("input", { type: "file", id: "condition-photo", accept: "image/jpeg,image/png,image/webp", capture: "environment" });
      const addButton = h("button", {
        type: "button",
        onclick: async (event) => {
          const button = event.currentTarget;
          if (photoInput.files.length === 0) return;
          setPending(button, PENDING_COPY.addPhoto);
          counterResult.textContent = "";
          const body = new FormData();
          body.append("photo", photoInput.files[0]);
          try {
            await api(`/api/loans/${loan.id}/photos`, { method: "POST", body });
            await refreshLoanThenAnnounce(loan.id, "counter-result", "Photo saved.");
          } catch (error) {
            announce("counter-result", error.message);
          } finally {
            clearPending(button);
          }
        },
      }, "Add photo");
      content.append(h("div", { class: "box", style: "margin-top:16px" },
        h("h2", null, "Add condition photo"),
        h("div", { class: "field" }, h("label", { for: "condition-photo" }, "Condition photo"), photoInput),
        addButton,
        counterResult,
      ));
    }

    if (isStaff && (loan.status === "out" || loan.status === "overdue")) {
      const returnedAt = h("input", { type: "datetime-local", id: "returned-at" });
      const nowLocal = toLocalInputValue(new Date());
      returnedAt.value = nowLocal;
      const checkInButton = h("button", {
        class: "primary", type: "button",
        onclick: async (event) => {
          const button = event.currentTarget;
          setPending(button, PENDING_COPY.checkIn);
          counterResult.textContent = "";
          try {
            const payload = await api(`/api/loans/${loan.id}/return`, {
              method: "POST",
              body: JSON.stringify({ returned_at: fromLocalInputValue(returnedAt.value) }),
            });
            const message = payload.loan.on_time
              ? "Checked in on time."
              : `Checked in late: ${payload.loan.late_days} late days.`;
            await refreshLoanThenAnnounce(loan.id, "counter-result", message);
          } catch (error) {
            announce("counter-result", error.message);
            await refreshLoanThenAnnounce(loan.id, "counter-result", error.message);
          } finally {
            clearPending(button);
          }
        },
      }, "Check in");
      content.append(h("div", { class: "box", style: "margin-top:16px" },
        h("h2", null, "Check in"),
        h("div", { class: "field" }, h("label", { for: "returned-at" }, "Returned at"), returnedAt),
        checkInButton,
      ));
    }

    if (isStaff && loan.status === "returned" && loan.inspection === null) {
      const okRadio = h("input", { type: "radio", name: "condition", id: "condition-ok", value: "ok" });
      const damagedRadio = h("input", { type: "radio", name: "condition", id: "condition-damaged", value: "damaged" });
      const note = h("textarea", { id: "inspection-note", rows: 3, maxlength: "500" });
      const saveButton = h("button", {
        class: "primary", type: "button",
        onclick: async (event) => {
          const button = event.currentTarget;
          setPending(button, PENDING_COPY.inspect);
          counterResult.textContent = "";
          const outcome = document.querySelector('input[name="condition"]:checked')?.value;
          try {
            await api(`/api/loans/${loan.id}/inspection`, {
              method: "POST",
              body: JSON.stringify({ outcome, note: note.value }),
            });
            await refreshLoanThenAnnounce(loan.id, "counter-result", "Inspection saved.");
          } catch (error) {
            announce("counter-result", error.message);
          } finally {
            clearPending(button);
          }
        },
      }, "Save inspection");
      content.append(h("div", { class: "box", style: "margin-top:16px" },
        h("h2", null, "Inspection"),
        h("div", { class: "field", role: "radiogroup", "aria-label": "Condition" },
          h("label", { for: "condition-ok" }, h("span", { class: "label" }, "OK"), okRadio),
          h("label", { for: "condition-damaged" }, h("span", { class: "label" }, "Damaged"), damagedRadio),
        ),
        h("div", { class: "field" }, h("label", { for: "inspection-note" }, "Inspection note"), note),
        saveButton,
      ));
    }

    if (loan.inspection !== null) {
      content.append(h("div", { class: "box", style: "margin-top:16px" },
        h("h2", null, "Inspection"),
        h("div", { class: "row" }, h("span", { class: "label", text: "Condition" }),
          chip(loan.inspection.outcome === "ok" ? "returned" : "overdue", loan.inspection.outcome === "ok" ? "OK" : "Damaged")),
        h("div", { class: "row" }, h("span", { class: "label", text: "Note" }), h("span", { text: loan.inspection.note || "—" })),
        h("div", { class: "row" }, h("span", { class: "label", text: "Inspected at" }),
          h("time", { class: "mono", text: localTime(loan.inspection.inspected_at) })),
      ));
    }

    if (isFounder && loan.status === "inspected") {
      const settleButton = h("button", {
        class: "primary", type: "button",
        onclick: () => openSettleDialog(loan, settlementResult),
      }, "Settle");
      content.append(h("div", { class: "box", style: "margin-top:16px" },
        h("h2", null, "Settlement"), settleButton, settlementResult));
    } else if (isFounder) {
      content.append(settlementResult);
    }

    if (loan.settlement !== null) {
      const receipt = h("div", { class: "receipt", role: "region", "aria-label": "Receipt", tabindex: "-1" },
        h("h2", { style: "margin-bottom:8px" }, "Receipt"),
        receiptLine("Deposit held", money(loan.settlement.deposit_cents)),
        receiptLine("Deposit released", money(loan.settlement.released_cents)),
        receiptLine("Damage charge", money(loan.settlement.damage_cents)),
        receiptLine("Charged beyond deposit", money(loan.settlement.extra_damage_cents)),
        receiptLine("Late fee", `${money(loan.settlement.late_fee_cents)} (${loan.settlement.late_days} late days)`),
        receiptLine("Total charged", money(loan.settlement.total_charged_cents)),
      );
      content.append(h("div", { style: "margin-top:16px" }, receipt));
    }

    return content;
  }

  function receiptLine(label, value) {
    return h("div", { class: "receipt-line" },
      h("span", { class: "label", text: label }),
      h("span", { class: "money mono", text: value }));
  }

  function toLocalInputValue(date) {
    const zone = state.library ? state.library.time_zone : "UTC";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value ?? "00";
    let hour = get("hour");
    if (hour === "24") hour = "00";
    return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
  }

  function fromLocalInputValue(value) {
    if (!value) return null;
    const zone = state.library ? state.library.time_zone : "UTC";
    const [date, time] = value.split("T");
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    const naive = Date.UTC(y, m - 1, d, hh, mm);
    const guessOffset = offsetFor(new Date(naive), zone);
    let guess = naive - guessOffset * 60000;
    const offset = offsetFor(new Date(guess), zone);
    guess = naive - offset * 60000;
    return new Date(guess).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function offsetFor(instant, zone) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" }).formatToParts(instant);
    const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    if (match === null) return 0;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3]));
  }

  function photoPanel(title, loan, stage) {
    const photos = loan.photos.filter((photo) => photo.stage === stage);
    const grid = h("div", { class: "photo-grid" });
    if (photos.length === 0) {
      grid.append(h("p", { class: "mono", text: "No photos yet" }));
    } else {
      photos.forEach((photo, index) => {
        const img = h("img", { alt: `${title.replace(" photos", "")} photo ${index + 1}` });
        img.src = photo.url;
        img.onerror = () => {
          const fallback = h("div", { class: "photo-unavailable", text: "Photo unavailable" });
          img.replaceWith(fallback);
        };
        grid.append(img);
      });
    }
    return h("section", { class: "photo-panel", "aria-label": title },
      h("h3", null, title), grid);
  }

  function openSettleDialog(loan, settlementResult) {
    const dialog = h("dialog", { "aria-label": "Settle loan" });
    const damage = h("input", { type: "text", id: "damage-charge", value: "0.00", inputmode: "decimal" });
    const confirmButton = h("button", { class: "primary", type: "button" }, "Confirm settlement");
    const cancelButton = h("button", { type: "button" }, "Cancel");

    dialog.append(
      h("h2", null, "Settle loan"),
      h("p", { class: "mono", text: `Deposit held ${money(loan.deposit_cents)}` }),
      h("p", { class: "mono", text: `Replacement ${money(loan.replacement_cents)}` }),
      h("div", { class: "field" }, h("label", { for: "damage-charge" }, "Damage charge"), damage),
      h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" }, confirmButton, cancelButton),
    );

    const close = () => {
      dialog.close();
      dialog.remove();
      const opener = document.querySelector('button:not([disabled])');
      void opener;
    };

    cancelButton.addEventListener("click", () => {
      dialog.close();
      dialog.remove();
      const settleButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Settle");
      if (settleButton !== undefined) settleButton.focus();
    });

    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dialog.close();
      dialog.remove();
      const settleButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Settle");
      if (settleButton !== undefined) settleButton.focus();
    });

    confirmButton.addEventListener("click", async () => {
      setPending(confirmButton, PENDING_COPY.settle);
      settlementResult.textContent = "";
      const cents = parseDamageCharge(damage.value);
      if (cents === null) {
        announce("settlement-result", "Damage charge must be whole cents from $0.00 to the item's replacement value.");
        clearPending(confirmButton);
        return;
      }
      try {
        const payload = await apiWithRetryKey(`/api/loans/${loan.id}/settlement`, { damage_cents: cents }, "settle", loan.id, String(cents));
        dialog.close();
        dialog.remove();
        announce("settlement-result", `Settled. Receipt queued for ${loan.member.name}.`);
        const receipt = renderLoanReceipt(payload.loan);
        const oldReceipt = document.querySelector('[aria-label="Receipt"]');
        if (oldReceipt !== null) oldReceipt.replaceWith(receipt);
        else contentHost().append(receipt);
        receipt.focus();
      } catch (error) {
        announce("settlement-result", error.message);
        clearPending(confirmButton);
      }
    });

    document.body.append(dialog);
    dialog.showModal();
    damage.focus();
    void close;

    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dialog.close();
        dialog.remove();
        const settleButton = [...document.querySelectorAll("button")].find((b) => b.textContent === "Settle");
        if (settleButton !== undefined) settleButton.focus();
      }
    });
  }

  function parseDamageCharge(text) {
    const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
    if (match === null) return null;
    const fraction = match[2] === undefined ? 0 : Number(match[2].padEnd(2, "0"));
    return Number(match[1]) * 100 + fraction;
  }

  function renderLoanReceipt(loan) {
    return h("div", { class: "receipt", role: "region", "aria-label": "Receipt", tabindex: "-1", style: "margin-top:16px" },
      h("h2", { style: "margin-bottom:8px" }, "Receipt"),
      receiptLine("Deposit held", money(loan.settlement.deposit_cents)),
      receiptLine("Deposit released", money(loan.settlement.released_cents)),
      receiptLine("Damage charge", money(loan.settlement.damage_cents)),
      receiptLine("Charged beyond deposit", money(loan.settlement.extra_damage_cents)),
      receiptLine("Late fee", `${money(loan.settlement.late_fee_cents)} (${loan.settlement.late_days} late days)`),
      receiptLine("Total charged", money(loan.settlement.total_charged_cents)),
    );
  }

  function contentHost() {
    return document.getElementById("content");
  }

  /** Re-renders the loan page in place, then announces into the fresh live region. */
  async function refreshLoanThenAnnounce(loanId, regionId, message) {
    const payload = await api(`/api/loans/${loanId}`);
    contentHost().replaceChildren(renderLoan(payload.loan));
    announce(regionId, message);
  }

  /* ---------- counter ---------- */

  let counterTimers = [];

  async function counterPage() {
    await loadLibrary();
    const servicesStatus = h("p", { id: "counter-services", class: "status-region", role: "status", "aria-live": "polite" });
    const banner = h("div", { class: "services-banner", hidden: true, id: "services-banner" });
    const result = h("p", { id: "counter-result", class: "status-region", role: "status", "aria-live": "polite" });

    const prepareHost = h("div", { class: "rows" });
    const readyHost = h("div", { class: "rows" });
    const outHost = h("div", { class: "rows" });

    const prepareRegion = h("section", { class: "box", "aria-label": "Holds to prepare" }, h("h2", null, "Holds to prepare"), prepareHost);
    const readyRegion = h("section", { class: "box", "aria-label": "Ready for pickup" }, h("h2", null, "Ready for pickup"), readyHost);
    const outRegion = h("section", { class: "box", "aria-label": "Out on loan" }, h("h2", null, "Out on loan"), outHost);

    const depositByItem = new Map();
    async function readCounter() {
      const [holdsRequested, holdsReady, loansOut, services, items] = await Promise.all([
        api("/api/holds?status=requested"),
        api("/api/holds?status=ready"),
        api("/api/loans?limit=50"),
        api("/api/counter/status"),
        api("/api/items"),
      ]);
      for (const item of items.items) depositByItem.set(item.id, item.deposit_cents);
      const billingDown = services.billing === "down";
      const storageDown = services.photo_storage === "down";
      const messages = [];
      if (billingDown) messages.push("Billing offline — deposit items are blocked. Items without a deposit still lend.");
      if (storageDown) messages.push("Photo storage offline — add photos later.");
      banner.hidden = messages.length === 0;
      banner.textContent = messages.join(" ");
      servicesStatus.textContent = messages.join(" ");

      prepareHost.replaceChildren(...holdsRequested.holds.map((hold) =>
        h("div", { class: "list-row" },
          h("span", { class: "main", text: `${hold.member.name} · ${hold.item.name}, unit ${hold.unit.label}` }),
          h("span", { class: "dates mono", text: `${hold.start_date} → ${hold.end_date}` }),
          h("button", {
            type: "button",
            onclick: async (event) => {
              const button = event.currentTarget;
              setPending(button, PENDING_COPY.markReady);
              try {
                await api(`/api/holds/${hold.id}/ready`, { method: "POST", body: "{}" });
                announce("counter-result", `Marked ready. Pickup notice queued for ${hold.member.name}.`);
                await readCounter();
              } catch (error) {
                announce("counter-result", error.message);
                await readCounter();
              } finally {
                clearPending(button);
              }
            },
          }, "Mark ready"),
        )
      ));

      readyHost.replaceChildren(...holdsReady.holds.map((hold) => {
        const blocked = billingDown && (depositByItem.get(hold.item.id) ?? 0) > 0;
        return h("div", { class: "list-row" },
          h("span", { class: "main", text: `${hold.member.name} · ${hold.item.name}, unit ${hold.unit.label}` }),
          h("span", { class: "dates mono", text: `Pick up by ${hold.pickup_deadline ? localTime(hold.pickup_deadline) : ""}` }),
          blocked ? h("span", { class: "blocked-note", text: "Blocked: billing offline" }) : null,
          h("button", {
            type: "button",
            disabled: blocked,
            onclick: async (event) => {
              const button = event.currentTarget;
              setPending(button, PENDING_COPY.checkout);
              try {
                const payload = await apiWithRetryKey("/api/loans", { hold_id: hold.id }, "checkout", hold.id, null);
                announce("counter-result", `Lent to ${hold.member.name}. Due ${localTime(payload.loan.due_at)}.`);
                await readCounter();
                const row = [...outHost.querySelectorAll("a")].find((a) => a.href.endsWith(payload.loan.id));
                if (row !== undefined) {
                  row.closest(".list-row").classList.add("row-arrival");
                  row.focus();
                }
              } catch (error) {
                announce("counter-result", error.message);
                await readCounter();
              } finally {
                clearPending(button);
              }
            },
          }, "Check out"),
        );
      }));

      outHost.replaceChildren(...loansOut.loans
        .filter((loan) => loan.status === "out" || loan.status === "overdue")
        .map((loan) =>
          h("div", { class: "list-row" },
            h("a", { class: "main", href: `/loans/${loan.id}`, text: `${loan.item.name}, unit ${loan.unit.label}` }),
            h("span", { text: loan.member.name }),
            h("span", { class: "dates mono", text: `Due ${localTime(loan.due_at)}` }),
            chip(loan.status, statusWordOfLoan(loan)),
          )
        ));
    }

    await readCounter();
    counterTimers.forEach((t) => clearInterval(t));
    counterTimers = [setInterval(() => { void readCounter().catch(() => undefined); }, 10000)];

    const members = await api("/api/members");
    const memberSelect = h("select", { id: "walkin-member" },
      h("option", { value: "" }, "Choose member"),
      members.members.map((m) => h("option", { value: m.id }, m.name)));
    const unitSelect = h("select", { id: "walkin-unit" });
    const items = await api("/api/items");
    for (const item of items.items) {
      const lanes = await api(`/api/items/${item.id}/lanes`);
      for (const lane of lanes.lanes) {
        unitSelect.append(h("option", { value: lane.unit_id }, `${item.name} — ${lane.label}`));
      }
    }
    const dueDate = h("input", { type: "date", id: "walkin-due" });
    const checkedOutAt = h("input", { type: "datetime-local", id: "walkin-at" });
    const lendButton = h("button", {
      class: "primary", type: "button",
      onclick: async (event) => {
        const button = event.currentTarget;
        setPending(button, PENDING_COPY.checkout);
        try {
          const body = {
            member_id: memberSelect.value,
            unit_id: unitSelect.value,
            due_date: dueDate.value,
          };
          if (checkedOutAt.value) body.checked_out_at = fromLocalInputValue(checkedOutAt.value);
          const payload = await apiWithRetryKey("/api/loans", body, "walkin", `${memberSelect.value}|${unitSelect.value}|${dueDate.value}|${checkedOutAt.value}`, JSON.stringify(body));
          announce("counter-result", `Lent to ${memberSelect.options[memberSelect.selectedIndex].text}. Due ${localTime(payload.loan.due_at)}.`);
          await readCounter();
          const row = [...outHost.querySelectorAll("a")].find((a) => a.href.endsWith(payload.loan.id));
          if (row !== undefined) {
            row.closest(".list-row").classList.add("row-arrival");
            row.focus();
          }
        } catch (error) {
          announce("counter-result", error.message);
        } finally {
          clearPending(button);
        }
      },
    }, "Lend now");

    const walkIn = h("section", { class: "box", "aria-label": "Walk-in loan", style: "margin-top:16px" },
      h("h2", null, "Walk-in loan"),
      h("div", { class: "field" }, h("label", { for: "walkin-member" }, "Member"), memberSelect),
      h("div", { class: "field" }, h("label", { for: "walkin-unit" }, "Unit"), unitSelect),
      h("div", { class: "field" }, h("label", { for: "walkin-due" }, "Due date"), dueDate),
      h("div", { class: "field" }, h("label", { for: "walkin-at" }, "Checked out at"), checkedOutAt),
      lendButton,
    );

    return h("div", null,
      h("h1", { class: "page-title" }, "Counter"),
      banner,
      servicesStatus,
      result,
      h("div", { class: "grid" },
        h("div", { class: "cols-4" }, prepareRegion),
        h("div", { class: "cols-4" }, readyRegion),
        h("div", { class: "cols-4" }, outRegion),
      ),
      walkIn,
    );
  }

  /* ---------- ledger ---------- */

  async function ledgerPage() {
    await loadLibrary();
    const payload = await api("/api/ledger");
    const kindWords = {
      deposit_hold: "Deposit hold",
      deposit_release: "Deposit release",
      damage_charge: "Damage charge",
      extra_damage: "Extra damage",
      late_fee: "Late fee",
    };
    const table = h("table", { class: "ledger", "aria-label": "Deposit ledger" },
      h("thead", null, h("tr", null,
        ["Loan", "Item", "Kind", "Amount", "Recorded"].map((label) => h("th", { scope: "col", text: label })))),
      h("tbody", null, payload.entries.map((entry) =>
        h("tr", null,
          h("td", { class: "mono", text: entry.loan_id.slice(0, 8) }),
          h("td", { text: entry.item.name }),
          h("td", { class: "mono", text: kindWords[entry.kind] }),
          h("td", { class: "money mono", text: money(entry.amount_cents) }),
          h("td", { class: "mono", text: localTime(entry.created_at) }),
        ))),
    );
    return h("div", null,
      h("h1", { class: "page-title" }, "Deposit ledger"),
      h("p", { class: "deposits-held mono", text: `Deposits held now: ${money(payload.deposits_held_cents)}` }),
      table,
    );
  }

  /* ---------- router ---------- */

  async function route() {
    const path = location.pathname;
    let content = null;

    if (state.user === null) {
      const session = await api("/api/session").then((p) => p.user).catch(() => null);
      state.user = session;
      if (state.user !== null) await loadLibrary().catch(() => undefined);
    }

    if (state.user === null) {
      if (path === "/") {
        content = signInPage();
      } else {
        location.assign("/");
        return;
      }
    } else if (path === "/" || path === "") {
      location.replace(homePath());
      return;
    } else if (path === "/catalogue") {
      content = await cataloguePage();
    } else if (path.startsWith("/items/")) {
      content = await itemPage(path.slice("/items/".length)).catch(() => notFoundPage());
    } else if (path === "/my-loans" && state.user.role === "member") {
      content = await myLoansPage();
    } else if (path.startsWith("/loans/")) {
      content = await loanPage(path.slice("/loans/".length));
    } else if (path === "/counter" && state.user.role !== "member") {
      content = await counterPage();
    } else if (path === "/ledger" && state.user.role === "founder") {
      content = await ledgerPage();
    } else {
      content = notFoundPage();
    }

    renderShell(content, path);
  }

  window.addEventListener("popstate", () => { void route(); });

  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (link === null) return;
    const href = link.getAttribute("href");
    if (href === null || href.startsWith("http") || href.startsWith("#")) return;
    if (link.getAttribute("download") !== null) return;
    event.preventDefault();
    history.pushState(null, "", href);
    void route();
  });

  void route();
})();
