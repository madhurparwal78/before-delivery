// Console pages: every action calls the API with the member's session token, answers in place with a toast,
// marks its panel busy while it waits and keeps what was typed on a refusal.
(() => {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const token = $('meta[name="tessel-session"]').content;
  const live = $("[data-live]");
  const toastBox = $("[data-toasts]");
  const GENERIC = "Something went wrong. Try again.";
  const FAR = "9999-12-31T23:59:59Z";
  const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : n);
  const motion = (el, frames, options) => (!reduce.matches && el.animate ? el.animate(frames, options) : null);
  const f = (form, name) => form.elements.namedItem(name);
  const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child);
    return el;
  }

  // ---- the API ----------------------------------------------------------------------------------
  class Unreachable extends Error {}

  function sessionEnded() {
    const query = new URLSearchParams({ next: location.pathname + location.search, ended: "1" });
    window.location.assign(`/login?${query}`);
  }

  async function api(method, path, { params, body, idempotent } = {}) {
    const url = new URL(path, location.origin);
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    const headers = { Authorization: `Bearer ${token}` };
    if (path.startsWith("/api/v2")) headers["API-Version"] = "2";
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotent) headers["Idempotency-Key"] = idempotent;
    let res;
    let answer;
    try {
      res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      answer = await res.json();
    } catch {
      throw new Unreachable(GENERIC);
    }
    if (res.status === 401 && ["UNAUTHENTICATED", "INVALID_API_KEY"].includes(answer.error?.code)) {
      sessionEnded();
      throw new Unreachable("ended");
    }
    return { ok: answer.success, status: res.status, data: answer.data, error: answer.error, requestId: answer.meta?.request_id };
  }

  // ---- feedback: toasts, live region, busy panels, field errors ----------------------------------
  function announce(text) {
    live.textContent = text;
  }

  function dismiss(el) {
    clearTimeout(el.timer);
    if (!el.isConnected || el.dataset.leaving) return;
    el.dataset.leaving = "1";
    const leave = motion(el, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-8px)" }], { duration: 200, easing: "ease-in" });
    if (leave) leave.finished.then(() => el.remove(), () => el.remove());
    else el.remove();
  }

  function toast(message, { error = false, undo = null } = {}) {
    const text = h("span", { class: "toast-message", text: message });
    const el = h("div", { class: `toast${error ? " toast-error" : ""}`, role: "status" }, text);
    const arm = () => {
      clearTimeout(el.timer);
      el.timer = setTimeout(() => dismiss(el), 6000);
    };
    if (undo) {
      const button = h("button", { type: "button", class: "text-button", "data-undo": true, text: "Undo" });
      button.addEventListener("click", () => undo({ el, text, button, arm }));
      el.append(button);
    }
    el.append(h("button", { type: "button", class: "text-button", text: "Close", onclick: () => dismiss(el) }));
    toastBox.prepend(el);
    while (toastBox.children.length > 3) toastBox.lastElementChild.remove();
    arm();
    return el;
  }

  async function busy(button, panel, work) {
    if (button.dataset.busy) return undefined;
    button.dataset.busy = "1";
    const label = button.textContent;
    if (button.dataset.busyLabel) button.textContent = button.dataset.busyLabel;
    button.setAttribute("aria-disabled", "true");
    panel?.setAttribute("aria-busy", "true");
    try {
      return await work();
    } finally {
      delete button.dataset.busy;
      button.textContent = label;
      button.removeAttribute("aria-disabled");
      panel?.removeAttribute("aria-busy");
    }
  }

  function clearErrors(root) {
    for (const el of $$("[data-error-for]", root)) el.textContent = "";
    for (const el of $$("[aria-invalid]", root)) el.removeAttribute("aria-invalid");
  }

  function fieldError(root, name, message) {
    const slot = $(`[data-error-for="${name}"]`, root) || $('[data-error-for="general"]', root);
    if (!slot) return;
    slot.textContent = message;
    const input = slot.closest(".field")?.querySelector("input, textarea, select");
    if (input) input.setAttribute("aria-invalid", "true");
  }

  // A refusal names its field: shown beside it and in a toast. A missing answer shows the generic line.
  function refusal(root, result, slotFor = (field) => field) {
    if (result instanceof Unreachable) {
      if (result.message !== "ended") fieldError(root, slotFor(null) || "general", GENERIC);
      return;
    }
    fieldError(root, slotFor(result.error.field) || "general", result.error.message);
    toast(result.error.message, { error: true });
  }

  async function attempt(work) {
    try {
      return await work();
    } catch (err) {
      if (err instanceof Unreachable) return err;
      throw err;
    }
  }

  function flash(row) {
    row.classList.remove("flash");
    void row.offsetWidth;
    row.classList.add("flash");
  }

  function stagger(rows) {
    rows.forEach((row, i) => motion(row, [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }],
      { duration: 260, delay: i < 20 ? i * 28 : 0, easing: "ease-out", fill: "backwards" }));
  }

  function removeRow(row) {
    const leave = motion(row, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-4px)" }], { duration: 200, easing: "ease-in" });
    if (leave) leave.finished.then(() => row.remove(), () => row.remove());
    else row.remove();
  }

  const badge = (text, kind = "") => h("span", { class: `badge ${kind}`.trim(), text });

  // Keyboard-complete modal dialogs (kit module a11y_dialog, adapted).
  function focusables(root) {
    return $$("button, input, select, textarea, a[href], [tabindex]", root)
      .filter((el) => !el.disabled && !el.hidden && el.tabIndex >= 0 && el.getClientRects().length);
  }
  function openDialog(dialog, opener, onClose) {
    dialog.showModal();
    (focusables(dialog).find((el) => el.tagName === "INPUT") || focusables(dialog)[0])?.focus();
    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const items = focusables(dialog);
      const edge = e.shiftKey ? items[0] : items[items.length - 1];
      if (document.activeElement === edge || !dialog.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    };
    const onCancel = (e) => {
      e.preventDefault();
      close();
    };
    let open = true;
    function close() {
      if (!open) return;
      open = false;
      dialog.removeEventListener("keydown", onKey);
      dialog.removeEventListener("cancel", onCancel);
      dialog.close();
      if (opener?.isConnected) opener.focus();
      onClose?.();
    }
    dialog.addEventListener("keydown", onKey);
    dialog.addEventListener("cancel", onCancel);
    return close;
  }

  // ---- /console: databases ---------------------------------------------------------------------
  function databasesPage() {
    const rows = $("[data-database-rows]");
    if (!rows) return;
    const panel = $("[data-databases-panel]");
    const owner = !!$("[data-create]");
    const empty = $("[data-empty]", rows);

    const statusBadge = (status) => h("span", { class: `badge status-${status}`, "data-status": true, text: status });
    function rowFor(d) {
      return h("tr", { "data-database": d.name },
        h("th", { scope: "row", "data-label": "Name" }, h("a", { class: "row-link", href: `/console/db/${d.name}`, text: d.name })),
        h("td", { "data-label": "Status" }, statusBadge(d.status)),
        h("td", { "data-label": "Collections", class: "num", text: fmt(d.collections) }),
        h("td", { "data-label": "Sources", class: "num", text: fmt(d.sources) }),
        h("td", { "data-label": "Pending log entries", class: "num", text: fmt(d.pending) }),
        h("td", { "data-label": "Index generation", class: "num", text: fmt(d.generation) }),
        h("td", { "data-label": "Created" }, h("time", { text: d.created_at })),
        owner ? h("td", { class: "row-actions" }, h("button", { type: "button", class: "text-button danger", "data-delete-database": d.name, text: "Delete" })) : null);
    }
    function place(row) {
      const name = row.dataset.database;
      const after = $$("tr[data-database]", rows).find((r) => r.dataset.database > name);
      rows.insertBefore(row, after || empty);
      empty.hidden = true;
    }
    function watch(name) {
      const poll = async () => {
        const row = $(`tr[data-database="${name}"]`, rows);
        if (!row) return;
        const result = await attempt(() => api("GET", "/api/v2/databases/status", { params: { database: name } }));
        if (result instanceof Unreachable || !result.ok) return void setTimeout(poll, 1500);
        if (result.data.status === "ready") {
          $("[data-status]", row).replaceWith(statusBadge("ready"));
          flash(row);
        } else {
          setTimeout(poll, 600);
        }
      };
      setTimeout(poll, 600);
    }
    $$('tr[data-database] [data-status]', rows).forEach((b) => { if (b.textContent === "provisioning") watch(b.closest("tr").dataset.database); });

    const create = $("[data-create]");
    if (create) {
      create.addEventListener("submit", (e) => {
        e.preventDefault();
        const button = $('button[type="submit"]', create);
        busy(button, panel, async () => {
          clearErrors(create);
          const name = f(create, "name").value;
          const result = await attempt(() => api("POST", "/api/v2/databases", { body: { name }, idempotent: newKey() }));
          if (result instanceof Unreachable || !result.ok) return refusal(create, result, (f) => (f === "name" || !f ? "name" : "name"));
          const row = rowFor({ name: result.data.name, status: result.data.status, collections: 1, sources: 0, pending: 0, generation: 0, created_at: result.data.created_at });
          place(row);
          flash(row);
          f(create, "name").value = "";
          announce("Database created");
          toast("Database created");
          watch(result.data.name);
        });
      });
    }

    const importOpen = $("[data-import-open]");
    const importForm = $("[data-import]");
    if (importOpen && importForm) {
      importOpen.addEventListener("click", () => {
        const panelEl = $("#import-panel");
        panelEl.hidden = !panelEl.hidden;
        importOpen.setAttribute("aria-expanded", String(!panelEl.hidden));
        if (!panelEl.hidden) f(importForm, "document").focus();
      });
      importForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const button = $('button[type="submit"]', importForm);
        busy(button, $("#import-panel"), async () => {
          clearErrors(importForm);
          let doc;
          try {
            doc = JSON.parse(f(importForm, "document").value);
          } catch {
            return fieldError(importForm, "document", "Paste the export document as JSON");
          }
          const result = await attempt(() => api("POST", "/api/v2/databases/import", { body: { name: f(importForm, "name").value, document: doc }, idempotent: newKey() }));
          if (result instanceof Unreachable || !result.ok) {
            return refusal(importForm, result, (f) => (f && f.startsWith("document") ? "document" : f === "name" ? "name" : "general"));
          }
          const d = result.data;
          const row = rowFor({ name: d.name, status: d.status, collections: new Set(doc.collections.map((c) => c.name).concat("default")).size, sources: d.sources, pending: d.sources, generation: 0, created_at: d.created_at });
          place(row);
          flash(row);
          f(importForm, "name").value = "";
          toast("Database imported");
          watch(d.name);
        });
      });
    }

    const dialog = $("#delete-dialog");
    if (dialog) {
      const form = $("[data-delete-form]", dialog);
      const confirmInput = $("#delete-confirm", dialog);
      const confirm = $("[data-confirm]", dialog);
      let target = null;
      let close = null;
      confirmInput.addEventListener("input", () => { confirm.disabled = confirmInput.value !== target; });
      $("[data-cancel]", dialog).addEventListener("click", () => close?.());
      rows.addEventListener("click", (e) => {
        const opener = e.target.closest("[data-delete-database]");
        if (!opener) return;
        target = opener.dataset.deleteDatabase;
        $("[data-delete-name]", dialog).textContent = target;
        confirmInput.value = "";
        confirm.disabled = true;
        clearErrors(form);
        close = openDialog(dialog, opener);
      });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (confirmInput.value !== target) return;
        busy(confirm, form, async () => {
          const result = await attempt(() => api("DELETE", "/api/v2/databases", { params: { database: target } }));
          if (result instanceof Unreachable || !result.ok) return refusal(form, result, () => "general");
          const row = $(`tr[data-database="${target}"]`, rows);
          close();
          if (row) removeRow(row);
          if (!$$("tr[data-database]", rows).length) empty.hidden = false;
          (create ? f(create, "name") : $("#main")).focus();
          toast(`Database ${target} deleted`);
        });
      });
    }
  }

  // ---- /console/db/{name}: the workspace ---------------------------------------------------------
  function workspacePage() {
    const dataNode = $("#workspace-data");
    if (!dataNode) return;
    const ws = JSON.parse(dataNode.textContent);
    const database = ws.database;
    const canWrite = ws.role !== "viewer";
    const moments = new Set(ws.moments);
    const tabList = $("[data-workspace-tabs]");
    const tabs = $$('[role="tab"]', tabList);
    const marker = $(".tab-marker", tabList);
    const params = new URLSearchParams(location.search);
    const state = {
      tab: params.get("tab") || "sources",
      sources: { collection: "default", sort: "id", filter: "" },
      graph: { statement: "", as_of: "" },
      search: { words: "" },
      entity: { entity: "", as_of: "" },
      explore: { as_of: "", predicates: null, node: "" },
    };
    if (!tabs.some((t) => t.dataset.tab === state.tab)) state.tab = "sources";
    const keys = { sources: ["collection", "sort", "filter"], graph: ["statement", "as_of"], search: ["words"], entity: ["entity", "as_of"], explore: ["as_of", "predicates", "node"] };
    for (const key of keys[state.tab] || []) {
      if (!params.has(key)) continue;
      state[state.tab][key] = key === "predicates" ? params.get(key).split(",").filter(Boolean) : params.get(key);
    }

    function writeAddress() {
      const q = new URLSearchParams({ tab: state.tab });
      for (const key of keys[state.tab] || []) {
        const v = state[state.tab][key];
        const defaults = { collection: "default", sort: "id" };
        if (key === "predicates") { if (v) q.set(key, v.join(",")); continue; }
        if (v && v !== defaults[key]) q.set(key, v);
      }
      history.replaceState(null, "", `${location.pathname}?${q}`);
    }

    function moveMarker() {
      const on = tabs.find((t) => t.getAttribute("aria-selected") === "true");
      if (!on || !marker) return;
      marker.style.width = `${on.offsetWidth}px`;
      marker.style.transform = `translateX(${on.offsetLeft}px)`;
    }
    function choose(name, focus) {
      state.tab = name;
      for (const t of tabs) {
        const on = t.dataset.tab === name;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = $(`#panel-${t.dataset.tab}`);
        if (on && panel.hidden) {
          panel.classList.remove("entering");
          void panel.offsetWidth;
          panel.classList.add("entering");
        }
        panel.hidden = !on;
        if (on && focus) t.focus();
      }
      moveMarker();
      writeAddress();
      loaders[name]();
    }
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => choose(t.dataset.tab, false));
      t.addEventListener("keydown", (e) => {
        const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        choose(tabs[(next + tabs.length) % tabs.length].dataset.tab, true);
      });
    });
    window.addEventListener("resize", moveMarker);

    let collections = ["default"];
    async function loadCollections() {
      const result = await attempt(() => api("GET", "/api/v2/databases/collections", { params: { database } }));
      if (result instanceof Unreachable || !result.ok) return;
      collections = result.data.collections;
      const picker = $("[data-collection-picker]");
      const chosen = state.sources.collection;
      picker.replaceChildren(...collections.map((c) => h("option", { value: c, text: c, selected: c === chosen })));
      if (!collections.includes(chosen)) picker.value = "default";
      const group = $("[data-search-collections]");
      const checked = new Set($$("input:checked", group).map((i) => i.value));
      $$(".check", group).forEach((el) => el.remove());
      collections.forEach((c) => group.append(h("label", { class: "check" }, h("input", { type: "checkbox", value: c, checked: checked.size ? checked.has(c) : c === "default" }), ` ${c}`)));
    }

    // -- Sources --
    const sourcesPanel = $("#panel-sources");
    const sourceRows = $("[data-source-rows]");
    let sources = [];
    let ingestRow = null;

    function sortedSources() {
      const key = state.sources.sort.replace(/^-/, "");
      const dir = state.sources.sort.startsWith("-") ? -1 : 1;
      const needle = state.sources.filter.toLowerCase();
      return sources
        .filter((s) => !needle || s.id.toLowerCase().includes(needle) || s.title.toLowerCase().includes(needle))
        .sort((a, b) => {
          const x = a[key];
          const y = b[key];
          const c = typeof x === "number" ? x - y : x < y ? -1 : x > y ? 1 : 0;
          return (c || (a.id < b.id ? -1 : 1)) * dir;
        });
    }
    function renderSources(flashId) {
      for (const th of $$("th[data-sort]", sourcesPanel)) {
        const key = th.dataset.sort;
        const sort = state.sources.sort;
        if (sort === key) th.setAttribute("aria-sort", "ascending");
        else if (sort === `-${key}`) th.setAttribute("aria-sort", "descending");
        else th.removeAttribute("aria-sort");
      }
      const list = sortedSources();
      const rows = list.map((s) => h("tr", { "data-source": s.id },
        h("th", { scope: "row", "data-label": "ID", text: s.id }),
        h("td", { "data-label": "Title", text: s.title }),
        h("td", { "data-label": "Version", class: "num", text: fmt(s.version) }),
        h("td", { "data-label": "Tokens", class: "num", text: fmt(s.token_count) }),
        h("td", { "data-label": "Facts", class: "num", text: fmt(s.facts) }),
        h("td", { "data-label": "Status" }, s.indexing_status === "completed" ? badge("Indexed") : badge("In write log", "status-pending")),
        h("td", { "data-label": "Ingested" }, h("time", { text: s.ingested_at })),
        canWrite ? h("td", { class: "row-actions" },
          h("button", { type: "button", class: "text-button", "data-edit": s.id, text: "Edit" }),
          h("button", { type: "button", class: "text-button danger", "data-delete": s.id, text: "Delete" })) : null));
      const empty = h("tr", { class: "empty-row" }, h("td", { colspan: "8", text: sources.length ? "No sources match this filter" : "No sources in this collection" }));
      sourceRows.replaceChildren(...(ingestRow ? [ingestRow] : []), ...(rows.length ? rows : [empty]));
      if (flashId) {
        const row = $(`tr[data-source="${CSS.escape(flashId)}"]`, sourceRows);
        if (row) flash(row);
      }
    }
    async function loadSources(flashId) {
      await loadCollections();
      const result = await attempt(() => api("POST", "/api/v2/context/list", { body: { database, collection: state.sources.collection } }));
      const error = $("[data-panel-error]", sourcesPanel);
      error.textContent = "";
      if (result instanceof Unreachable) return void (result.message !== "ended" && (error.textContent = GENERIC));
      if (!result.ok) return void (error.textContent = result.error.message);
      sources = result.data.sources;
      renderSources(flashId);
    }
    $("[data-collection-picker]").addEventListener("change", (e) => {
      state.sources.collection = e.target.value;
      writeAddress();
      loadSources();
    });
    const filterBox = $("#sources-filter");
    filterBox.value = state.sources.filter;
    filterBox.addEventListener("input", () => {
      state.sources.filter = filterBox.value;
      writeAddress();
      renderSources();
    });
    for (const button of $$("[data-sort-key]", sourcesPanel)) {
      button.addEventListener("click", () => {
        const key = button.dataset.sortKey;
        state.sources.sort = state.sources.sort === key ? `-${key}` : key;
        writeAddress();
        renderSources();
      });
    }

    function factRow(values = {}) {
      const li = $("#fact-row").content.firstElementChild.cloneNode(true);
      const n = newKey().slice(0, 8);
      for (const label of $$("label[data-for]", li)) {
        const input = $(`[data-f="${label.dataset.for}"]`, li);
        input.id = `fact-${label.dataset.for}-${n}`;
        label.htmlFor = input.id;
        input.value = values[label.dataset.for] || "";
      }
      $("[data-remove-fact]", li).addEventListener("click", () => li.remove());
      return li;
    }
    function openIngest(prefill = null) {
      if (!ingestRow) {
        ingestRow = $("#ingest-row").content.firstElementChild.cloneNode(true);
        const form = $("form", ingestRow);
        for (const label of $$("label[data-for]", form)) {
          const input = form.elements[label.dataset.for];
          input.id = `ingest-${label.dataset.for}`;
          label.htmlFor = input.id;
        }
        $("[data-add-fact]", form).addEventListener("click", () => $("[data-fact-rows]", form).append(factRow()));
        $("[data-ingest-close]", form).addEventListener("click", () => {
          ingestRow.remove();
          ingestRow = null;
          $("[data-ingest-open]")?.focus();
        });
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          submitIngest(form);
        });
        sourceRows.prepend(ingestRow);
      }
      const form = $("form", ingestRow);
      f(form, "collection").value = state.sources.collection;
      form.dataset.ifVersion = prefill ? String(prefill.version) : "";
      f(form, "id").value = prefill?.id || "";
      f(form, "title").value = prefill?.title || "";
      f(form, "text").value = prefill?.text || "";
      $("[data-fact-rows]", form).replaceChildren(factRow());
      clearErrors(form);
      (prefill ? f(form, "title") : f(form, "id")).focus();
    }
    async function submitIngest(form) {
      const button = $('button[type="submit"]', form);
      await busy(button, sourcesPanel, async () => {
        clearErrors(form);
        const rowsSent = $$(".fact-row", form).filter((li) => $$("input", li).some((i) => i.value !== ""));
        const source = { title: f(form, "title").value, text: f(form, "text").value,
          facts: rowsSent.map((li) => Object.fromEntries($$("input", li).map((i) => [i.dataset.f, i.value]))) };
        if (f(form, "id").value !== "") source.id = f(form, "id").value;
        if (form.dataset.ifVersion) source.if_version = Number(form.dataset.ifVersion);
        const body = { database, sources: [source] };
        if (f(form, "collection").value !== "") body.collection = f(form, "collection").value;
        const result = await attempt(() => api("POST", "/api/v2/context/ingest", { body, idempotent: newKey() }));
        if (result instanceof Unreachable || !result.ok) {
          if (!(result instanceof Unreachable)) {
            const m = /^sources\.0\.facts\.(\d+)\.(\w+)$/.exec(result.error.field || "");
            if (m && rowsSent[Number(m[1])]) {
              fieldError(rowsSent[Number(m[1])], m[2], result.error.message);
              toast(result.error.message, { error: true });
              return;
            }
          }
          return refusal(form, result, (f) => {
            if (!f) return "general";
            if (f === "collection") return "collection";
            const field = f.replace(/^sources\.0\./, "").replace(/^sources$/, "general");
            return { if_version: "title", facts: "facts" }[field] || (["id", "title", "text"].includes(field) ? field : "general");
          });
        }
        for (const fact of source.facts) if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(fact.valid_from)) moments.add(fact.valid_from);
        const written = result.data.results[0];
        ingestRow.remove();
        ingestRow = null;
        state.sources.collection = body.collection || "default";
        announce("Source ingested");
        toast("Source ingested");
        await loadSources(written.id);
      });
    }
    $("[data-ingest-open]")?.addEventListener("click", () => openIngest());
    sourceRows.addEventListener("click", async (e) => {
      const edit = e.target.closest("[data-edit]");
      const del = e.target.closest("[data-delete]");
      if (edit) {
        const shown = sources.find((s) => s.id === edit.dataset.edit);
        const result = await attempt(() => api("GET", "/api/v2/context/source", { params: { database, collection: state.sources.collection, id: shown.id } }));
        if (result instanceof Unreachable || !result.ok) return void toast(result.error?.message || GENERIC, { error: true });
        openIngest({ id: shown.id, version: shown.version, title: result.data.title, text: result.data.text });
      }
      if (del) {
        const id = del.dataset.delete;
        const collection = state.sources.collection;
        await busy(del, sourcesPanel, async () => {
          const result = await attempt(() => api("DELETE", "/api/v2/context", { params: { database, collection, id } }));
          if (result instanceof Unreachable || !result.ok) return void toast(result.error?.message || GENERIC, { error: true });
          const row = del.closest("tr");
          sources = sources.filter((s) => s.id !== id);
          removeRow(row);
          toast("Source deleted", { undo: async ({ text, button, arm }) => {
            if (button.dataset.busy) return;
            button.dataset.busy = "1";
            const back = await attempt(() => api("POST", "/api/v2/context/restore", { body: { database, collection, id } }));
            delete button.dataset.busy;
            if (back instanceof Unreachable || !back.ok) return void toast(back.error?.message || GENERIC, { error: true });
            text.textContent = "Source restored";
            button.remove();
            arm();
            if (state.sources.collection === collection) await loadSources(id);
          } });
        });
      }
    });

    // -- Graph query --
    const graphPanel = $("#panel-graph");
    const graphForm = $("[data-graph-form]");
    const statement = $("#graph-statement");
    const graphAsOf = $("#graph-as-of");
    statement.value = state.graph.statement;
    graphAsOf.value = state.graph.as_of;
    async function runGraph() {
      state.graph = { statement: statement.value, as_of: graphAsOf.value };
      writeAddress();
      const button = $('button[type="submit"]', graphForm);
      await busy(button, graphPanel, async () => {
        clearErrors(graphForm);
        const body = { database, query_by: "cypher", cypher: statement.value };
        if (graphAsOf.value !== "") body.as_of = graphAsOf.value;
        const result = await attempt(() => api("POST", "/api/v2/query", { body }));
        if (result instanceof Unreachable) return void (result.message !== "ended" && fieldError(graphForm, "cypher", GENERIC));
        if (!result.ok) return fieldError(graphForm, "cypher", `${result.error.code}: ${result.error.message}`);
        const { columns, rows, served_from: s } = result.data;
        const wrap = $("[data-graph-results]", graphPanel);
        const table = $("table", wrap);
        $("thead", table).replaceChildren(h("tr", {}, columns.map((c) => h("th", { scope: "col", text: c }))));
        const trs = rows.map((r) => h("tr", {}, r.map((v) => h("td", { text: String(fmt(v)) }))));
        $("tbody", table).replaceChildren(...trs);
        wrap.hidden = !rows.length;
        $("[data-graph-empty]", graphPanel).hidden = !!rows.length;
        $("[data-served]", graphPanel).textContent =
          `Served from index generation ${s.index_generation} at LSN ${s.indexed_lsn} plus ${s.wal_entries_applied} pending write log entries`;
        stagger(trs);
        announce(`Query answered: ${rows.length} rows`);
      });
    }
    graphForm.addEventListener("submit", (e) => {
      e.preventDefault();
      runGraph();
    });
    statement.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        runGraph();
      }
    });
    for (const example of $$("[data-example]", graphForm)) {
      example.addEventListener("click", () => {
        statement.value = example.dataset.example;
        runGraph();
      });
    }

    // -- Search --
    const searchPanel = $("#panel-search");
    const searchForm = $("[data-search-form]");
    const words = $("#search-words");
    words.value = state.search.words;
    async function runSearch() {
      state.search.words = words.value;
      writeAddress();
      const button = $('button[type="submit"]', searchForm);
      await busy(button, searchPanel, async () => {
        clearErrors(searchForm);
        const chosen = $$("[data-search-collections] input:checked", searchForm).map((i) => i.value);
        const body = { database, query_by: "text", query: words.value, max_results: Number($("#search-limit").value) };
        if (chosen.length) body.collections = chosen;
        const result = await attempt(() => api("POST", "/api/v2/query", { body }));
        if (result instanceof Unreachable) return void (result.message !== "ended" && fieldError(searchForm, "query", GENERIC));
        if (!result.ok) return fieldError(searchForm, "query", result.error.message);
        const requestId = result.requestId;
        const wrap = $("[data-search-results]", searchPanel);
        const trs = result.data.results.map((r) => h("tr", { "data-result": r.id },
          h("th", { scope: "row", text: r.id }),
          h("td", { text: r.title }),
          h("td", { class: "num", text: r.score.toFixed(4) }),
          h("td", { text: r.snippet }),
          h("td", { class: "row-actions" }, h("button", { type: "button", class: "text-button", text: "Not useful",
            onclick: (e) => openFeedback(e.currentTarget.closest("tr"), requestId) }))));
        $("tbody", wrap).replaceChildren(...trs);
        wrap.hidden = !trs.length;
        $("[data-search-empty]", searchPanel).hidden = !!trs.length;
        stagger(trs);
        announce(`Search found ${trs.length} sources`);
      });
    }
    function openFeedback(row, requestId) {
      $$(".feedback-row", searchPanel).forEach((r) => r.remove());
      const form = h("form", { class: "inline-form", novalidate: true },
        h("div", { class: "field" }, h("label", { for: "feedback-rating", text: "Rating" }),
          h("select", { id: "feedback-rating", name: "rating" },
            h("option", { value: "negative", text: "Negative", selected: true }), h("option", { value: "neutral", text: "Neutral" }),
            h("option", { value: "positive", text: "Positive" }))),
        h("div", { class: "field" }, h("label", { for: "feedback-comment", text: "Comment" }),
          h("textarea", { id: "feedback-comment", name: "comment", rows: "2" }), h("p", { class: "field-error", "data-error-for": "feedback" })),
        h("button", { type: "submit", class: "capsule capsule-primary", "data-busy-label": "Sending...", text: "Send feedback" }),
        h("p", { class: "field-error", "data-error-for": "general" }));
      const feedbackRow = h("tr", { class: "feedback-row" }, h("td", { colspan: "5" }, form));
      row.after(feedbackRow);
      f(form, "comment").focus();
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        busy($('button[type="submit"]', form), searchPanel, async () => {
          clearErrors(form);
          const result = await attempt(() => api("POST", "/api/v2/feedback", { body: { request_id: requestId, rating: f(form, "rating").value, feedback: f(form, "comment").value } }));
          if (result instanceof Unreachable || !result.ok) return refusal(form, result, (f) => (f === "feedback" ? "feedback" : "general"));
          feedbackRow.remove();
          toast("Feedback sent");
        });
      });
    }
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      runSearch();
    });

    // -- Entity --
    const entityPanel = $("#panel-entity");
    const entityForm = $("[data-entity-form]");
    const entityName = $("#entity-name");
    const entityAsOf = $("#entity-as-of");
    entityName.value = state.entity.entity;
    entityAsOf.value = state.entity.as_of;
    const entityLink = (name) => h("a", { class: "inline-link", href: `?${new URLSearchParams({ tab: "entity", entity: name, ...(entityAsOf.value ? { as_of: entityAsOf.value } : {}) })}`, "data-entity-link": name, text: name });
    function relationTable(title, list) {
      if (!list.length) return null;
      const trs = list.map((r) => h("tr", {}, h("td", { text: r.predicate }), h("td", {}, entityLink(r.other)), h("td", {}, h("time", { text: r.valid_from })),
        h("td", { text: r.reason }), h("td", { text: r.source_id })));
      return { node: h("div", {}, h("h3", { text: title }), h("div", { class: "table-wrap" }, h("table", { class: "data-table" },
        h("caption", { class: "sr-only", text: title }),
        h("thead", {}, h("tr", {}, ["Predicate", "Entity", "Valid from", "Reason", "Source"].map((c) => h("th", { scope: "col", text: c })))),
        h("tbody", {}, trs)))), rows: trs };
    }
    async function lookUp() {
      state.entity = { entity: entityName.value, as_of: entityAsOf.value };
      writeAddress();
      const button = $('button[type="submit"]', entityForm);
      await busy(button, entityPanel, async () => {
        clearErrors(entityForm);
        const asOf = entityAsOf.value || undefined;
        const now = await attempt(() => api("GET", "/api/v2/context/relations", { params: { database, entity: entityName.value, as_of: asOf } }));
        if (now instanceof Unreachable) return void (now.message !== "ended" && fieldError(entityForm, "entity", GENERIC));
        if (!now.ok) return fieldError(entityForm, "entity", now.error.message);
        const ever = await attempt(() => api("GET", "/api/v2/context/relations", { params: { database, entity: entityName.value, as_of: FAR } }));
        const predicates = ever.ok ? [...new Set(ever.data.outgoing.map((r) => r.predicate))] : [];
        const histories = [];
        for (const predicate of predicates) {
          const one = await attempt(() => api("GET", "/api/v2/context/history", { params: { database, entity: entityName.value, predicate } }));
          if (one.ok && one.data.facts.length) histories.push(one.data);
        }
        const answer = $("[data-entity-answer]", entityPanel);
        const parts = [relationTable("Outgoing", now.data.outgoing), relationTable("Incoming", now.data.incoming)].filter(Boolean);
        const historyRows = [];
        if (histories.length) {
          const groups = histories.map((hist) => {
            const trs = hist.facts.map((f) => h("tr", {}, h("td", {}, entityLink(f.object)), h("td", {}, h("time", { text: f.valid_from })),
              h("td", {}, f.superseded_at ? h("time", { text: f.superseded_at }) : h("span", { class: "current", text: "current" })),
              h("td", { text: f.reason }), h("td", { text: f.source_id })));
            historyRows.push(...trs);
            return h("div", { class: "table-wrap" }, h("table", { class: "data-table" }, h("caption", { class: "sr-only", text: `History of ${hist.predicate}` }),
              h("thead", {}, h("tr", {}, h("th", { scope: "col", colspan: "5", text: hist.predicate })),
                h("tr", {}, ["Object", "Valid from", "Superseded at", "Reason", "Source"].map((c) => h("th", { scope: "col", text: c })))),
              h("tbody", {}, trs)));
          });
          parts.push({ node: h("div", { class: "history" }, h("h3", { text: "History" }), groups), rows: [] });
        }
        answer.replaceChildren(h("h2", { class: "panel-title", text: now.data.entity }), ...parts.map((p) => p.node));
        const empty = !parts.length;
        answer.hidden = empty;
        $("[data-entity-empty]", entityPanel).hidden = !empty;
        stagger(parts.flatMap((p) => p.rows).concat(historyRows));
      });
    }
    entityForm.addEventListener("submit", (e) => {
      e.preventDefault();
      lookUp();
    });
    entityPanel.addEventListener("click", (e) => {
      const link = e.target.closest("[data-entity-link]");
      if (!link) return;
      e.preventDefault();
      entityName.value = link.dataset.entityLink;
      lookUp();
    });

    // -- Stats --
    const statsPanel = $("#panel-stats");
    const previous = {};
    async function loadStats() {
      const result = await attempt(() => api("GET", "/api/v2/databases/stats", { params: { database } }));
      if (result instanceof Unreachable || !result.ok) return void fieldError(statsPanel, "stats", result.error?.message || GENERIC);
      for (const [key, value] of Object.entries(result.data)) {
        const cell = $(`[data-counter="${key}"]`, statsPanel);
        if (!cell) continue;
        $("dd", cell).textContent = fmt(value);
        if (key in previous && previous[key] !== value) {
          cell.classList.remove("pulse");
          void cell.offsetWidth;
          cell.classList.add("pulse");
        }
        previous[key] = value;
      }
    }
    $("[data-compact]", statsPanel)?.addEventListener("click", (e) => {
      const button = e.currentTarget;
      busy(button, statsPanel, async () => {
        clearErrors(statsPanel);
        const result = await attempt(() => api("POST", "/api/v2/databases/compact", { body: { database } }));
        if (result instanceof Unreachable || !result.ok) return refusal(statsPanel, result, () => "stats");
        const d = result.data;
        const line = d.folded_entries ? `Folded ${d.folded_entries} entries into generation ${d.generation}` : "Nothing to fold";
        $("[data-compact-line]", statsPanel).textContent = line;
        announce(line);
        toast(line);
        await loadStats();
      });
    });
    $("[data-export]", statsPanel)?.addEventListener("click", (e) => {
      const button = e.currentTarget;
      busy(button, statsPanel, async () => {
        clearErrors(statsPanel);
        const result = await attempt(() => api("POST", "/api/v2/databases/export", { body: { database }, idempotent: newKey() }));
        if (result instanceof Unreachable || !result.ok) return refusal(statsPanel, result, () => "stats");
        const jobId = result.data.job_id;
        const lines = $("[data-export-lines]", statsPanel);
        lines.replaceChildren();
        const order = ["queued", "running", "succeeded"];
        let reached = -1;
        const reach = (status) => {
          const target = order.indexOf(status);
          for (let i = reached + 1; i <= target && i < 2; i += 1) lines.append(h("li", { text: i === 0 ? "Export queued" : "Export running" }));
          reached = Math.max(reached, Math.min(target, 1));
        };
        reach("queued");
        toast("Export queued");
        const poll = async () => {
          const job = await attempt(() => api("GET", `/api/v2/jobs/${jobId}`));
          if (job instanceof Unreachable || !job.ok) return void setTimeout(poll, 1000);
          reach(job.data.status);
          if (job.data.status !== "succeeded") return void setTimeout(poll, 300);
          const download = await attempt(() => api("GET", `/api/v2/jobs/${jobId}/download`));
          if (download instanceof Unreachable || !download.ok) return void toast(download.error?.message || GENERIC, { error: true });
          const blob = new Blob([JSON.stringify(download.data, null, 2)], { type: "application/json" });
          const link = h("a", { class: "inline-link", href: URL.createObjectURL(blob), download: `${database}-lsn-${download.data.lsn}.json`, text: "Download" });
          lines.append(h("li", { class: "done" }, "Export ready ", link));
          announce("Export ready");
          toast("Export ready");
        };
        setTimeout(poll, 300);
      });
    });

    // -- Explore --
    const explorePanel = $("#panel-explore");
    const slider = $("#explore-moment");
    const momentValue = $("[data-moment-value]", explorePanel);
    const canvas = $("[data-explore-canvas]", explorePanel);
    const inspector = $("[data-inspector]", explorePanel);
    const findBox = $("#explore-find");
    let answer = { nodes: [], edges: [] };
    let timeline = [];
    const keyOf = (name) => name.normalize("NFC").toLowerCase().trim();

    function syncTimeline() {
      timeline = [...moments].sort();
      slider.max = String(timeline.length);
      const asOf = state.explore.as_of;
      let at = timeline.length;
      if (asOf) {
        at = 0;
        timeline.forEach((m, i) => { if (m <= asOf) at = i; });
      }
      slider.value = String(at);
      const label = at === timeline.length ? "now" : timeline[at];
      slider.setAttribute("aria-valuetext", label);
      momentValue.textContent = label;
    }
    function visible() {
      const allowed = state.explore.predicates ? new Set(state.explore.predicates) : null;
      const edges = answer.edges.filter((e) => !allowed || allowed.has(e.predicate));
      const used = new Set(edges.flatMap((e) => [e.subject, e.object]));
      return { edges, nodes: answer.nodes.filter((n) => used.has(n)) };
    }
    function drawExplore(animateRows) {
      const { nodes, edges } = visible();
      const group = $("[data-predicate-group]", explorePanel);
      const present = [...new Set(answer.edges.map((e) => e.predicate).concat(state.explore.predicates ? [] : []))].sort();
      $$(".check", group).forEach((el) => el.remove());
      present.forEach((p) => group.append(h("label", { class: "check" }, h("input", { type: "checkbox", value: p, checked: !state.explore.predicates || state.explore.predicates.includes(p) }), ` ${p}`)));
      $("[data-explore-summary]", explorePanel).textContent = `${nodes.length} entities, ${edges.length} relations`;
      $("[data-explore-empty]", explorePanel).hidden = answer.edges.length > 0;
      const width = canvas.clientWidth || 800;
      const height = canvas.clientHeight || 460;
      const at = new Map(nodes.map((n, i) => {
        if (nodes.length === 1) return [n, [width / 2, height / 2]];
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length;
        return [n, [width / 2 + Math.cos(angle) * width * 0.38, height / 2 + Math.sin(angle) * height * 0.38]];
      }));
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("aria-hidden", "true");
      const pairCount = new Map();
      for (const e of edges) {
        const [x1, y1] = at.get(e.subject);
        const [x2, y2] = at.get(e.object);
        const line = document.createElementNS(svgNS, "line");
        Object.entries({ x1, y1, x2, y2, class: "explore-edge" }).forEach(([k, v]) => line.setAttribute(k, v));
        const pair = [e.subject, e.object].sort().join("\u0000");
        const nth = pairCount.get(pair) || 0;
        pairCount.set(pair, nth + 1);
        const label = document.createElementNS(svgNS, "text");
        Object.entries({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 6 + nth * 16, class: "explore-label", "text-anchor": "middle" }).forEach(([k, v]) => label.setAttribute(k, v));
        label.textContent = e.predicate;
        svg.append(line, label);
      }
      const needle = findBox.value.toLowerCase();
      const buttons = nodes.map((n) => {
        const [x, y] = at.get(n);
        const b = h("button", { type: "button", class: `node-chip${needle && n.toLowerCase().includes(needle) ? " match" : ""}`, "aria-pressed": String(n === state.explore.node), "data-node": n, text: n, title: n });
        b.style.left = `${x}px`;
        b.style.top = `${y}px`;
        return b;
      });
      canvas.replaceChildren(svg, ...buttons);
      const count = needle ? nodes.filter((n) => n.toLowerCase().includes(needle)).length : null;
      $("[data-find-count]", explorePanel).textContent = count === null ? "" : count === 1 ? "1 matching entity" : `${count} matching entities`;
      const trs = edges.map((e) => h("tr", {}, h("td", { text: e.subject }), h("td", { text: e.predicate }), h("td", { text: e.object }), h("td", {}, h("time", { text: e.valid_from })), h("td", { text: e.source_id })));
      $("[data-explore-table] tbody", explorePanel).replaceChildren(...trs);
      if (animateRows) stagger(trs);
      if (state.explore.node && !nodes.includes(state.explore.node)) inspector.hidden = true;
    }
    async function inspect(name) {
      state.explore.node = name;
      writeAddress();
      for (const b of $$("[data-node]", canvas)) b.setAttribute("aria-pressed", String(b.dataset.node === name));
      const result = await attempt(() => api("GET", "/api/v2/context/relations", { params: { database, entity: name, as_of: state.explore.as_of || undefined } }));
      if (result instanceof Unreachable || !result.ok) return;
      $("#inspector-title").textContent = `Inspect ${result.data.entity}`;
      const line = (r) => h("li", {}, h("span", { text: r.predicate }), " ", h("span", { text: r.other }));
      $("[data-outgoing]", inspector).replaceChildren(...(result.data.outgoing.length ? result.data.outgoing.map(line) : [h("li", { text: "None" })]));
      $("[data-incoming]", inspector).replaceChildren(...(result.data.incoming.length ? result.data.incoming.map(line) : [h("li", { text: "None" })]));
      inspector.hidden = false;
    }
    async function loadExplore(animateRows) {
      syncTimeline();
      const result = await attempt(() => api("GET", "/api/v2/context/graph", { params: { database, as_of: state.explore.as_of || undefined } }));
      if (result instanceof Unreachable || !result.ok) return void ($("[data-explore-summary]", explorePanel).textContent = result.error?.message || GENERIC);
      answer = result.data;
      answer.edges.forEach((e) => moments.add(e.valid_from));
      if (timeline.length !== moments.size) syncTimeline();
      drawExplore(animateRows);
      if (state.explore.node && answer.nodes.includes(state.explore.node)) await inspect(state.explore.node);
    }
    slider.addEventListener("input", () => {
      const i = Number(slider.value);
      state.explore.as_of = i >= timeline.length ? "" : timeline[i];
      writeAddress();
      loadExplore(true);
    });
    $("[data-predicate-group]", explorePanel).addEventListener("change", () => {
      const checked = $$("[data-predicate-group] input:checked", explorePanel).map((i) => i.value);
      const all = [...new Set(answer.edges.map((e) => e.predicate))];
      state.explore.predicates = checked.length === all.length ? null : checked;
      writeAddress();
      drawExplore(false);
    });
    findBox.addEventListener("input", () => drawExplore(false));
    canvas.addEventListener("click", (e) => {
      const node = e.target.closest("[data-node]");
      if (node) inspect(node.dataset.node);
    });
    canvas.addEventListener("keydown", (e) => {
      const node = e.target.closest("[data-node]");
      if (!node) return;
      const all = $$("[data-node]", canvas);
      const i = all.indexOf(node);
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (step) {
        e.preventDefault();
        all[(i + step + all.length) % all.length].focus();
      }
    });
    window.addEventListener("resize", () => { if (!explorePanel.hidden) drawExplore(false); });

    const loaders = {
      sources: () => loadSources(),
      graph: () => (statement.value.trim() ? runGraph() : null),
      search: () => (words.value.trim() ? runSearch() : loadCollections()),
      entity: () => (entityName.value.trim() ? lookUp() : null),
      stats: () => loadStats(),
      explore: () => loadExplore(false),
    };
    loadCollections();
    moveMarker();
    loaders[state.tab]();
  }

  // ---- /console/settings ------------------------------------------------------------------------
  function settingsPage() {
    const memberRows = $("[data-member-rows]");
    if (!memberRows) return;
    const me = $(".rail-email").textContent;
    const addForm = $("[data-add-member]");
    const roleSelect = (email, role) => {
      const id = `role-${newKey().slice(0, 8)}`;
      return [h("label", { class: "sr-only", for: id, text: `Role for ${email}` }),
        h("select", { id, "data-member-role": email }, ["owner", "editor", "viewer"].map((r) => h("option", { value: r, text: r, selected: r === role })))];
    };
    if (addForm) {
      addForm.addEventListener("submit", (e) => {
        e.preventDefault();
        busy($('button[type="submit"]', addForm), addForm, async () => {
          clearErrors(addForm);
          const body = { email: f(addForm, "email").value, role: f(addForm, "role").value, password: f(addForm, "password").value };
          const result = await attempt(() => api("POST", "/api/v2/members", { body }));
          if (result instanceof Unreachable || !result.ok) return refusal(addForm, result, (f) => (["email", "password"].includes(f) ? f : "email"));
          const { email, role } = result.data;
          const row = h("tr", { "data-member": email }, h("th", { scope: "row", "data-label": "Email", text: email }),
            h("td", { "data-label": "Role" }, roleSelect(email, role)),
            h("td", { class: "row-actions" }, h("button", { type: "button", class: "text-button danger", "data-remove-member": email, text: "Remove" })));
          const after = $$("tr[data-member]", memberRows).find((r) => r.dataset.member > email);
          memberRows.insertBefore(row, after || null);
          flash(row);
          addForm.reset();
          toast(`${email} added as ${role}`);
        });
      });
    }
    memberRows.addEventListener("change", async (e) => {
      const select = e.target.closest("[data-member-role]");
      if (!select) return;
      const email = select.dataset.memberRole;
      const before = [...select.options].find((o) => o.defaultSelected)?.value;
      const result = await attempt(() => api("PATCH", `/api/v2/members/${encodeURIComponent(email)}`, { body: { role: select.value } }));
      if (result instanceof Unreachable || !result.ok) {
        select.value = before;
        return void toast(result.error?.message || GENERIC, { error: true });
      }
      [...select.options].forEach((o) => { o.defaultSelected = o.value === result.data.role; });
      toast(`${email} is now ${result.data.role}`);
      if (email === me && result.data.role !== "owner") window.location.reload();
    });
    memberRows.addEventListener("click", (e) => {
      const remove = e.target.closest("[data-remove-member]");
      if (!remove) return;
      const email = remove.dataset.removeMember;
      busy(remove, memberRows.closest(".table-wrap"), async () => {
        const result = await attempt(() => api("DELETE", `/api/v2/members/${encodeURIComponent(email)}`));
        if (result instanceof Unreachable || !result.ok) return void toast(result.error?.message || GENERIC, { error: true });
        removeRow(remove.closest("tr"));
        toast(`${email} removed`);
        if (email === me) window.location.assign("/login");
      });
    });

    $("[data-logout-all]").addEventListener("click", (e) => {
      busy(e.currentTarget, null, async () => {
        const result = await attempt(() => api("POST", "/api/auth/logout-all"));
        if (result instanceof Unreachable || !result.ok) return void toast(result.error?.message || GENERIC, { error: true });
        window.location.assign("/login");
      });
    });

    const pw = $("[data-change-password]");
    pw.addEventListener("submit", (e) => {
      e.preventDefault();
      clearErrors(pw);
      if ($("#pw-new").value !== $("#pw-confirm").value) return fieldError(pw, "confirm", "The passwords do not match");
      busy($('button[type="submit"]', pw), pw, async () => {
        const body = { current_password: $("#pw-current").value, new_password: $("#pw-new").value };
        const result = await attempt(() => api("POST", "/api/auth/password", { body }));
        if (result instanceof Unreachable || !result.ok) {
          return refusal(pw, result, (f) => (f === "new_password" ? "new_password" : result.error?.code === "BAD_CREDENTIALS" ? "current_password" : "current_password"));
        }
        pw.reset();
        toast("Password changed");
      });
    });

    const totp = $("[data-totp]");
    const setOn = (on) => {
      $("[data-totp-state]", totp).textContent = on ? "On" : "Off";
      $("[data-totp-disable]", totp).hidden = !on;
      $("[data-totp-setup]", totp).hidden = on;
    };
    $("[data-totp-setup]", totp).addEventListener("click", (e) => {
      busy(e.currentTarget, totp, async () => {
        const result = await attempt(() => api("POST", "/api/auth/totp/setup"));
        if (result instanceof Unreachable || !result.ok) return void toast(result.error?.message || GENERIC, { error: true });
        $("[data-totp-secret]", totp).textContent = result.data.secret.match(/.{1,4}/g).join(" ");
        $("[data-totp-uri]", totp).textContent = result.data.otpauth_uri;
        $("[data-totp-setup-panel]", totp).hidden = false;
        $("[data-recovery]", totp).hidden = true;
        $("#totp-code-on").focus();
      });
    });
    const enable = $("[data-totp-enable]", totp);
    enable.addEventListener("submit", (e) => {
      e.preventDefault();
      busy($('button[type="submit"]', enable), totp, async () => {
        clearErrors(enable);
        const result = await attempt(() => api("POST", "/api/auth/totp/enable", { body: { code: $("#totp-code-on").value } }));
        if (result instanceof Unreachable || !result.ok) return refusal(enable, result, () => "code");
        $("[data-totp-setup-panel]", totp).hidden = true;
        $("[data-recovery-codes]", totp).replaceChildren(...result.data.recovery_codes.map((c) => h("li", { text: c })));
        $("[data-recovery]", totp).hidden = false;
        enable.reset();
        setOn(true);
        $("[data-totp-off]", totp).hidden = false;
        toast("Two-step sign-in is on");
      });
    });
    const disable = $("[data-totp-disable]", totp);
    disable.addEventListener("submit", (e) => {
      e.preventDefault();
      busy($('button[type="submit"]', disable), totp, async () => {
        clearErrors(disable);
        const result = await attempt(() => api("POST", "/api/auth/totp/disable", { body: { code: $("#totp-code-off").value } }));
        if (result instanceof Unreachable || !result.ok) return refusal(disable, result, () => "code");
        disable.reset();
        $("[data-recovery]", totp).hidden = true;
        $("[data-totp-off]", totp).hidden = false;
        setOn(false);
        toast("Two-step sign-in is off");
      });
    });
  }

  // ---- /console/settings/keys -------------------------------------------------------------------
  function keysPage() {
    const form = $("[data-create-key]");
    if (!form) return;
    const rows = $("[data-key-rows]");
    const secretBox = $("[data-secret-box]");
    const choices = $("[data-scope-choices]", form);
    const showSecret = (secret) => {
      $("[data-secret]", secretBox).textContent = secret;
      secretBox.hidden = false;
    };
    $$('input[name="key-scope"]', form).forEach((r) => r.addEventListener("change", () => { choices.hidden = form.querySelector('input[name="key-scope"]:checked').value !== "chosen"; }));
    const actions = (id) => [h("button", { type: "button", class: "text-button", "data-rotate-key": id, text: "Rotate" }),
      h("button", { type: "button", class: "text-button danger", "data-revoke-key": id, text: "Revoke" })];
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      busy($('button[type="submit"]', form), form, async () => {
        clearErrors(form);
        const body = { name: $("#key-name").value, role: $("#key-role").value };
        const chosen = form.querySelector('input[name="key-scope"]:checked').value === "chosen";
        if (chosen) body.databases = $$('input[type="checkbox"]:checked', choices).map((i) => i.value);
        const result = await attempt(() => api("POST", "/api/v2/keys", { body }));
        if (result instanceof Unreachable || !result.ok) return refusal(form, result, (f) => (f === "name" ? "name" : f && f.startsWith("databases") ? "databases" : "name"));
        const k = result.data;
        showSecret(k.secret);
        const row = h("tr", { "data-key": k.id }, h("th", { scope: "row", "data-label": "Name", text: k.name }),
          h("td", { "data-label": "Role" }, badge(k.role)), h("td", { "data-label": "Prefix" }, h("code", { text: k.prefix })),
          h("td", { "data-label": "Scope", text: chosen ? (body.databases.slice().sort().join(", ") || "No database") : "All databases" }),
          h("td", { "data-label": "Created" }, h("time", { text: "just now" })), h("td", { class: "row-actions" }, actions(k.id)));
        rows.prepend(row);
        $("[data-empty]", rows).hidden = true;
        flash(row);
        $("#key-name").value = "";
        toast(`Key ${k.name} created`);
      });
    });
    rows.addEventListener("click", (e) => {
      const rotate = e.target.closest("[data-rotate-key]");
      const revoke = e.target.closest("[data-revoke-key]");
      const button = rotate || revoke;
      if (!button) return;
      const row = button.closest("tr");
      const name = $("th", row).textContent;
      busy(button, rows.closest(".table-wrap"), async () => {
        const id = button.dataset.rotateKey || button.dataset.revokeKey;
        const result = await attempt(() => (rotate ? api("POST", `/api/v2/keys/${id}/rotate`) : api("DELETE", `/api/v2/keys/${id}`)));
        if (result instanceof Unreachable || !result.ok) return void toast(result.error?.message || GENERIC, { error: true });
        if (rotate) {
          showSecret(result.data.secret);
          $('[data-label="Prefix"] code', row).textContent = result.data.prefix;
          toast(`Key ${name} rotated`);
        } else {
          $(".row-actions", row).replaceChildren(badge("Revoked"));
          toast(`Key ${name} revoked`);
        }
        flash(row);
      });
    });
  }

  // ---- /console/settings/billing ----------------------------------------------------------------
  function billingPage() {
    const buttons = $$("[data-switch-plan]");
    if (!buttons.length) return;
    const section = buttons[0].closest("section");
    const titles = { ship: "Ship", scale: "Scale" };
    for (const button of buttons) {
      button.addEventListener("click", () => {
        busy(button, section, async () => {
          clearErrors(section);
          const result = await attempt(() => api("PUT", "/api/v2/org/plan", { body: { plan: button.dataset.switchPlan } }));
          if (result instanceof Unreachable || !result.ok) return refusal(section, result, () => "plan");
          $("[data-current-plan]").textContent = titles[result.data.plan];
          for (const b of buttons) b.className = `capsule ${b.dataset.switchPlan === result.data.plan ? "capsule-secondary" : "capsule-primary"}`;
          toast(`Plan is ${titles[result.data.plan]}`);
          const usage = await attempt(() => api("GET", "/api/v2/usage"));
          if (usage.ok) {
            const lines = $$(".bill-lines dd");
            const money = (c) => `$${Math.floor(c / 100).toLocaleString("en-US")}.${String(c % 100).padStart(2, "0")}`;
            const u = usage.data;
            [fmt(u.month_tokens), fmt(u.storage_bytes), money(u.ontology_cents), money(u.storage_cents), money(u.usage_cents),
              money(u.minimum_cents), money(u.billed_cents)].forEach((v, i) => { lines[i].textContent = v; });
            if (u.minimum_applied) lines[5].append(" ", badge("minimum applies", "amber"));
          }
        });
      });
    }
  }

  // ---- /console/settings/audit ------------------------------------------------------------------
  function auditPage() {
    const more = $("[data-load-more]");
    if (!more) return;
    const rows = $("[data-audit-rows]");
    const params = new URLSearchParams(location.search);
    more.addEventListener("click", () => {
      busy(more, $("[data-audit-panel]"), async () => {
        const result = await attempt(() => api("GET", "/api/v2/audit", { params: { action: params.get("action"), actor: params.get("actor"), cursor: more.dataset.cursor } }));
        if (result instanceof Unreachable || !result.ok) return void toast(result.error?.message || GENERIC, { error: true });
        const trs = result.data.events.map((ev) => h("tr", {}, h("td", { "data-label": "Time" }, h("time", { text: ev.at })), h("td", { "data-label": "Actor", text: ev.actor }),
          h("td", { "data-label": "Action" }, h("code", { text: ev.action })), h("td", { "data-label": "Target", text: ev.target }), h("td", { "data-label": "Detail", text: ev.detail })));
        const empty = $(".empty-row", rows);
        trs.forEach((tr) => rows.insertBefore(tr, empty));
        stagger(trs);
        more.dataset.cursor = result.data.next_cursor || "";
        more.hidden = !result.data.next_cursor;
      });
    });
  }

  databasesPage();
  workspacePage();
  settingsPage();
  keysPage();
  billingPage();
  auditPage();
})();
