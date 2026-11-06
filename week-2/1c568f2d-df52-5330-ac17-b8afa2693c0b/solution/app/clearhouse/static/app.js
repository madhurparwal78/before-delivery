// Clearhouse: script only updates the parts of a server-rendered page that change after it loads.

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const UNREACHABLE = "The desk could not be reached. Your change was not saved";
const STALE = "This piece changed while you were deciding. Reload and try again";

// Announcements -----------------------------------------------------------------------------------------

function announce(text) {
  const region = $("#desk-updates");
  if (!region) return;
  region.classList.remove("is-faded");
  region.textContent = text;
}

const movedTo = (title, state) => `${title} moved to ${state}`;

document.addEventListener("pointerdown", () => $("#desk-updates")?.classList.add("is-faded"), true);

// Requests ------------------------------------------------------------------------------------------------

async function send(method, url, body) {
  const options = { method, headers: { Accept: "application/json" }, credentials: "same-origin" };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    return { ok: false, status: 0, error: { message: UNREACHABLE } };
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (response.ok) return { ok: true, status: response.status, data };
  return { ok: false, status: response.status, error: data?.error ?? { message: UNREACHABLE }, current: data?.current };
}

async function fetchPage(url, signal) {
  const response = await fetch(url, { headers: { Accept: "text/html" }, credentials: "same-origin", signal });
  if (!response.ok) throw new Error(String(response.status));
  return new DOMParser().parseFromString(await response.text(), "text/html");
}

async function busy(button, work) {
  if (!button) return work();
  const label = button.innerHTML;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "Saving…";
  try {
    return await work();
  } finally {
    if (button.isConnected) {
      button.innerHTML = label;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
}

// Panel alerts and field errors -------------------------------------------------------------------------

function clearErrors(root) {
  const alert = $("[data-panel-alert]", root);
  if (alert) { alert.hidden = true; alert.replaceChildren(); }
  $$("[aria-invalid]", root).forEach((el) => el.removeAttribute("aria-invalid"));
  $$(".field__error", root).forEach((el) => { el.hidden = true; el.textContent = ""; });
}

function fieldFor(root, name) {
  const map = { fee_cents: "fee", delta_cents: "amount" };
  return $(`[name="${map[name] ?? name}"]`, root) ?? $(`[data-${map[name] ?? name}]`, root);
}

function showError(root, error, { onReload } = {}) {
  const alert = $("[data-panel-alert]", root);
  if (!alert) return;
  alert.replaceChildren();
  const message = document.createElement("p");
  const field = error.field ? fieldFor(root, error.field) : null;
  if (field) {
    field.setAttribute("aria-invalid", "true");
    const describe = field.id ? $(`#${CSS.escape(field.id)}-error`, root) ?? $(`#${CSS.escape(field.name + "-" + (root.dataset.kind ?? ""))}-error`, root) : null;
    const errorNode = describe ?? field.closest(".field, .choice")?.querySelector(".field__error");
    if (errorNode) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
      if (!errorNode.id) errorNode.id = `${field.name}-${Math.abs(hash(error.message))}-error`;
      const ids = new Set((field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
      ids.add(errorNode.id);
      field.setAttribute("aria-describedby", [...ids].join(" "));
    }
    const link = document.createElement("a");
    link.href = `#${field.id}`;
    link.textContent = error.message;
    link.addEventListener("click", (event) => { event.preventDefault(); field.focus(); });
    message.append(link);
  } else {
    message.textContent = error.message;
  }
  alert.append(message);
  if (Array.isArray(error.lines)) {
    const list = document.createElement("ul");
    for (const line of error.lines) {
      const item = document.createElement("li");
      item.textContent = line;
      list.append(item);
    }
    alert.append(list);
  }
  if (error.message === STALE && onReload) {
    const reload = document.createElement("button");
    reload.type = "button";
    reload.className = "btn";
    reload.textContent = "Reload piece";
    reload.addEventListener("click", onReload);
    alert.append(reload);
  }
  alert.hidden = false;
}

function hash(text) {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) | 0;
  return value;
}

// Dialogs: focus moves in, Tab stays in, Escape closes, focus returns (after kit/modules/a11y_dialog) -----

function focusables(root) {
  return $$("button, input, select, textarea, a[href], [tabindex]", root).filter((el) =>
    !el.disabled && !el.hidden && el.getAttribute("tabindex") !== "-1" && el.type !== "hidden" && el.getClientRects().length);
}

let openDialogState = null;

function openDialog(dialog, opener) {
  clearErrors(dialog);
  const form = $("form", dialog);
  form?.reset();
  dialog.showModal();
  const first = focusables(dialog)[0];
  first?.focus();
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
    } else if (event.key === "Tab") {
      const items = focusables(dialog);
      if (!items.length) return event.preventDefault();
      const edge = event.shiftKey ? items[0] : items[items.length - 1];
      const active = document.activeElement;
      const groupEdge = edge.type === "radio" && active?.type === "radio" && active.name === edge.name;
      if (active === edge || groupEdge || !dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    }
  };
  const onCancel = (event) => { event.preventDefault(); closeDialog(); };
  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("cancel", onCancel);
  openDialogState = { dialog, opener, onKey, onCancel };
}

function closeDialog({ restoreFocus = true } = {}) {
  const state = openDialogState;
  if (!state) return null;
  openDialogState = null;
  state.dialog.removeEventListener("keydown", state.onKey);
  state.dialog.removeEventListener("cancel", state.onCancel);
  if (state.dialog.open) state.dialog.close();
  if (restoreFocus && state.opener?.isConnected) state.opener.focus();
  return state;
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-close]") && openDialogState) closeDialog();
});

// Lists that load after first paint ---------------------------------------------------------------------

function placeholders(kind) {
  if (kind === "cards") {
    return `<div class="placeholder-grid" aria-hidden="true">${Array.from({ length: 8 }, (_, i) =>
      `<span class="placeholder-card" style="width:${[180, 140, 200, 120][i % 4]}px;height:${[140, 200, 110, 170][i % 4]}px"></span>`).join("")}</div>`;
  }
  const rows = Array.from({ length: 6 }, () =>
    `<tr class="placeholder-row"><td colspan="7"><span class="placeholder-bar"></span></td></tr>`).join("");
  return `<table class="queue-table" aria-hidden="true"><tbody>${rows}</tbody></table>`;
}

const loaders = new Map();

async function loadRegion(name, url, { kind = "rows", after } = {}) {
  const region = $(`[data-region="${name}"]`);
  if (!region) return null;
  loaders.get(name)?.abort();
  const controller = new AbortController();
  loaders.set(name, controller);
  region.setAttribute("aria-busy", "true");
  region.innerHTML = placeholders(kind);
  try {
    const doc = await fetchPage(url, controller.signal);
    const fresh = $(`[data-region="${name}"]`, doc);
    if (!fresh) throw new Error("missing region");
    fresh.setAttribute("aria-busy", "false");
    region.replaceWith(fresh);
    after?.(fresh, doc);
    return fresh;
  } catch (error) {
    if (error.name === "AbortError") return null;
    region.setAttribute("aria-busy", "false");
    region.innerHTML = `<div class="failure"><p>Could not load that list</p><button type="button" class="btn" data-retry>Try again</button></div>`;
    $("[data-retry]", region).addEventListener("click", () => loadRegion(name, url, { kind, after }));
    return null;
  }
}

async function refresh(name, url = location.pathname + location.search) {
  const doc = await fetchPage(url);
  const fresh = $(`[data-region="${name}"]`, doc);
  const region = $(`[data-region="${name}"]`);
  if (fresh && region) region.replaceWith(fresh);
  if (doc.title) document.title = doc.title;
  return fresh;
}

function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function syncClearButton(input) {
  const clear = input.closest(".well")?.querySelector("[data-clear-search]");
  if (clear) clear.hidden = !input.value;
}

// Sign in and out ---------------------------------------------------------------------------------------

function initSignIn() {
  const form = $("[data-signin]");
  if (!form) return;
  const summary = $("[data-summary]");
  const show = (messages) => {
    const list = $("ul", summary);
    list.replaceChildren();
    $$("[aria-invalid]", form).forEach((el) => el.removeAttribute("aria-invalid"));
    $$(".field__error", form).forEach((el) => { el.hidden = true; el.textContent = ""; });
    for (const { message, field } of messages) {
      const item = document.createElement("li");
      const target = $(`#${field ?? "email"}`, form);
      const link = document.createElement("a");
      link.href = `#${target.id}`;
      link.textContent = message;
      item.append(link);
      list.append(item);
      if (field) {
        target.setAttribute("aria-invalid", "true");
        target.setAttribute("aria-describedby", `${field}-error`);
        const node = $(`#${field}-error`, form);
        node.textContent = message;
        node.hidden = false;
      }
    }
    summary.hidden = false;
    summary.focus();
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = form.email.value;
    const password = form.password.value;
    const blanks = [];
    if (!email.trim()) blanks.push({ message: "Enter your work email", field: "email" });
    if (!password) blanks.push({ message: "Enter your passphrase", field: "password" });
    if (blanks.length) return show(blanks);
    const button = $("button[type=submit]", form);
    button.disabled = true;
    button.textContent = "Signing in…";
    const result = await send("POST", "/api/auth/login", { email, password });
    if (result.ok) {
      location.assign(form.dataset.next || "/");
      return;
    }
    button.disabled = false;
    button.textContent = "Sign in";
    show([{ message: result.error.message, field: result.error.field }]);
  });
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-sign-out]");
  if (!button) return;
  button.disabled = true;
  const result = await send("POST", "/api/auth/logout");
  if (result.ok || result.status === 401) location.assign("/wall");
  else { button.disabled = false; announce(result.error.message); }
});

// The queue ---------------------------------------------------------------------------------------------

function queueUrl() {
  const params = new URLSearchParams();
  const q = $("[data-queue-search]")?.value.trim() ?? "";
  if (q.length >= 2) params.set("q", q);
  for (const control of $$("[data-queue-filter]")) {
    if (control.type === "checkbox") { if (control.checked) params.set(control.name, "1"); }
    else if (control.value && control.value !== "newest") params.set(control.name, control.value);
  }
  const current = new URLSearchParams(location.search).get("state");
  if (current) params.set("state", current);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

async function reloadQueue(url = queueUrl()) {
  history.replaceState(null, "", url);
  await loadRegion("queue-results", url, {
    after: (fresh, doc) => {
      const line = $("#result-line");
      line.innerHTML = $("#result-line", doc).innerHTML;
      announce(line.textContent);
    },
  });
}

function initQueue() {
  const search = $("[data-queue-search]");
  if (!search) return;
  const run = debounce(() => reloadQueue());
  let last = search.value.trim();
  search.addEventListener("input", () => {
    syncClearButton(search);
    const value = search.value.trim();
    if (value.length < 2 && last.length < 2) { last = value; return; }
    last = value;
    run();
  });
  $$("[data-queue-filter]").forEach((control) => control.addEventListener("change", () => reloadQueue()));
}

document.addEventListener("click", (event) => {
  const page = event.target.closest("[data-queue-page]");
  if (page) {
    event.preventDefault();
    const url = new URL(page.href);
    reloadQueue(url.pathname + url.search);
    return;
  }
  const clearFilters = event.target.closest("[data-clear-filters]");
  if (clearFilters) {
    const search = $("[data-queue-search]");
    if (search) { search.value = ""; syncClearButton(search); }
    $$("[data-queue-filter][type=checkbox]").forEach((box) => { box.checked = false; });
    $$(".states [aria-current]").forEach((el) => el.removeAttribute("aria-current"));
    history.replaceState(null, "", "/");
    reloadQueue(queueUrl());
    return;
  }
  const clearSearch = event.target.closest("[data-clear-search]");
  if (clearSearch) {
    const input = $("input[type=search]", clearSearch.closest(".well"));
    input.value = "";
    clearSearch.hidden = true;
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if ($("[data-queue-search]") === input) reloadQueue();
    return;
  }
  const disclosure = event.target.closest("[data-disclosure]");
  if (disclosure) {
    disclosure.setAttribute("aria-expanded", String(disclosure.getAttribute("aria-expanded") !== "true"));
  }
});

// The piece desk ----------------------------------------------------------------------------------------

const desk = () => $('[data-region="desk"]');

function dollarsToCents(text) {
  const clean = text.trim().replace(/[$,\s]/g, "");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

function rerenderDesk() {
  return refresh("desk");
}

async function afterWrite(message, { opener, stamp } = {}) {
  const openerKey = opener?.dataset.step;
  await rerenderDesk();
  announce(message);
  if (stamp) $(`[data-stamp="${stamp}"]`)?.classList.add("stamp--landing");
  const again = openerKey ? $(`[data-step="${openerKey}"]`) : null;
  (again ?? $("#piece-title"))?.focus();
}

function reloadDesk() {
  rerenderDesk().then(() => $("#piece-title")?.focus());
}

async function stepPiece(step, extra, { button, root, opener }) {
  const panel = desk();
  const result = await busy(button, () => send("POST", `/api/pieces/${panel.dataset.pieceId}/transition`,
    { version: Number(panel.dataset.version), action: step, ...extra }));
  if (!result.ok) return showError(root, result.error, { onReload: () => { closeDialog({ restoreFocus: false }); reloadDesk(); } });
  closeDialog({ restoreFocus: false });
  await afterWrite(movedTo(result.data.title, result.data.state), { opener });
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-step]");
  if (!button || !desk()?.contains(button) || button.tagName !== "BUTTON") return;
  const step = button.dataset.step;
  const dialog = $(`#dialog-${step}`);
  if (dialog) return openDialog(dialog, button);
  stepPiece(step, {}, { button, root: desk(), opener: button });
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (form.matches("[data-reason-form]")) {
    event.preventDefault();
    clearErrors(form);
    await stepPiece(form.dataset.step, { reason: form.reason.value },
      { button: $("button[type=submit]", form), root: form, opener: openDialogState?.opener });
  } else if (form.matches("[data-schedule-form]")) {
    event.preventDefault();
    clearErrors(form);
    await stepPiece("schedule", { day: form.day.value.trim() },
      { button: $("button[type=submit]", form), root: form, opener: openDialogState?.opener });
  } else if (form.matches("[data-review-form]")) {
    event.preventDefault();
    clearErrors(form);
    const kind = form.dataset.kind;
    const result = form.querySelector("input[name=result]:checked")?.value;
    if (!result) return showError(form, { field: "result", message: "Result must be pass or fail" });
    const body = { version: Number(desk().dataset.version), kind, result };
    if (form.reason.value.trim()) body.reason = form.reason.value;
    const saved = await busy($("button[type=submit]", form), () =>
      send("POST", `/api/pieces/${desk().dataset.pieceId}/reviews`, body));
    if (!saved.ok) return showError(form, saved.error, { onReload: () => { closeDialog({ restoreFocus: false }); reloadDesk(); } });
    const opener = closeDialog({ restoreFocus: false })?.opener;
    const word = kind === "licence" ? "Licence" : "Accessibility";
    await afterWrite(`${word} review recorded as ${result === "pass" ? "passed" : "failed"}`, { opener, stamp: kind });
  } else if (form.matches("[data-piece-form]")) {
    event.preventDefault();
    await savePiece(form);
  }
});

async function savePiece(form) {
  const root = form.closest('[data-region="desk"]');
  clearErrors(root);
  const fee = dollarsToCents(form.fee.value || "0");
  if (fee === null || fee < 0) {
    return showError(root, { field: "fee_cents", message: "A fee must be between $0.00 and $5,000.00" });
  }
  const button = $("button[type=submit]", form);
  announce("Saving");
  const body = { title: form.title.value, summary: form.summary.value, fee_cents: fee };
  const isNew = root.hasAttribute("data-new-desk");
  const result = await busy(button, () => isNew
    ? send("POST", "/api/pieces", body)
    : send("PATCH", `/api/pieces/${root.dataset.pieceId}`, { version: Number(root.dataset.version), ...body }));
  if (!result.ok) {
    announce("");
    return showError(root, result.error, { onReload: reloadDesk });
  }
  if (isNew) {
    const url = `/pieces/${result.data.id}`;
    const doc = await fetchPage(url);
    $("#main").replaceChildren(...$("#main", doc).childNodes);
    document.title = doc.title;
    history.pushState(null, "", url);
  } else {
    await rerenderDesk();
  }
  announce("Draft saved");
  $("#piece-title")?.focus();
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-new-piece]");
  if (!button) return;
  const template = $("#new-piece");
  $("#main").replaceChildren(template.content.cloneNode(true));
  $("#field-title")?.focus();
});

// Object picker and citations ---------------------------------------------------------------------------

function citedIds() {
  const raw = $("[data-cited-ids]", desk())?.dataset.citedIds ?? "";
  return raw ? raw.split(",").map(Number) : [];
}

async function cite(ids, button) {
  const panel = desk();
  const picker = $("#dialog-picker");
  const root = picker?.open ? picker : panel;
  announce("Saving");
  const result = await busy(button, () => send("PUT", `/api/pieces/${panel.dataset.pieceId}/objects`,
    { version: Number(panel.dataset.version), object_ids: ids }));
  if (!result.ok) {
    announce("");
    return showError(root, result.error, { onReload: reloadDesk });
  }
  await rerenderDesk();
  markCited();
  announce(`${result.data.objects.length} objects cited`);
}

function markCited() {
  const ids = new Set(citedIds());
  for (const button of $$("[data-pick-object]")) {
    const cited = ids.has(Number(button.dataset.pickObject));
    button.setAttribute("aria-disabled", String(cited));
    button.classList.toggle("is-cited", cited);
  }
}

async function loadPicker(url) {
  const holder = $("[data-picker]");
  holder.setAttribute("aria-busy", "true");
  holder.innerHTML = placeholders("cards");
  try {
    const doc = await fetchPage(url);
    const results = $('[data-region="catalogue-results"]', doc);
    for (const link of $$("a.cut", results)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = link.className;
      button.setAttribute("style", link.getAttribute("style"));
      button.setAttribute("aria-label", link.getAttribute("aria-label"));
      button.dataset.pickObject = link.dataset.objectId;
      button.append(...link.childNodes);
      link.replaceWith(button);
    }
    $$("form", results).forEach((form) => form.setAttribute("data-picker-page", ""));
    holder.replaceChildren(...results.childNodes);
    markCited();
  } catch {
    holder.innerHTML = `<div class="failure"><p>Could not load that list</p><button type="button" class="btn" data-retry>Try again</button></div>`;
    $("[data-retry]", holder).addEventListener("click", () => loadPicker(url));
  } finally {
    holder.setAttribute("aria-busy", "false");
  }
}

document.addEventListener("click", (event) => {
  const open = event.target.closest("[data-open-picker]");
  if (open) {
    const dialog = $("#dialog-picker");
    openDialog(dialog, open);
    loadPicker("/catalogue?seed=1");
    return;
  }
  const pick = event.target.closest("[data-pick-object]");
  if (pick) {
    if (pick.getAttribute("aria-disabled") === "true") return;
    cite([...citedIds(), Number(pick.dataset.pickObject)], null);
    return;
  }
  const remove = event.target.closest("[data-remove-object]");
  if (remove) cite(citedIds().filter((id) => id !== Number(remove.dataset.removeObject)), remove);
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-picker-page]");
  if (!form) return;
  event.preventDefault();
  const params = new URLSearchParams(new FormData(form));
  loadPicker(`/catalogue?${params}`);
});

document.addEventListener("input", debounce((event) => {
  if (!event.target.matches("[data-picker-search]")) return;
  const q = event.target.value.trim();
  loadPicker(q.length >= 2 ? `/catalogue?seed=1&q=${encodeURIComponent(q)}` : "/catalogue?seed=1");
}));

// The catalogue -----------------------------------------------------------------------------------------

function initCatalogue() {
  const search = $("[data-catalogue-search]");
  const section = $("[data-catalogue]");
  if (!search || !section) return;
  let last = search.value.trim();
  const run = debounce(() => {
    const params = new URLSearchParams({ seed: section.dataset.seed });
    const q = search.value.trim();
    if (q.length >= 2) params.set("q", q);
    if (section.dataset.license) params.set("license", section.dataset.license);
    const url = `/catalogue?${params}`;
    history.replaceState(null, "", url);
    loadRegion("catalogue-results", url, {
      kind: "cards",
      after: (_fresh, doc) => $("[data-count-line]").replaceWith($("[data-count-line]", doc)),
    });
  });
  search.addEventListener("input", () => {
    syncClearButton(search);
    const value = search.value.trim();
    if (value.length < 2 && last.length < 2) { last = value; return; }
    last = value;
    run();
  });
  $("[data-licence-filter]")?.addEventListener("change", (event) => {
    const form = event.target.form;
    const q = search.value.trim();
    if (q.length >= 2 && !form.q) {
      const hidden = document.createElement("input");
      hidden.type = "hidden"; hidden.name = "q"; hidden.value = q;
      form.append(hidden);
    }
    form.requestSubmit();
  });
}

// Duplicate acknowledgement -----------------------------------------------------------------------------

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-ack]");
  if (!button) return;
  const root = $('[data-region="object"]');
  const result = await busy(button, () => send("POST", `/api/pieces/${button.dataset.piece}/duplicate-acks`,
    { object_id: Number(button.dataset.object), duplicate_object_id: Number(button.dataset.duplicate) }));
  if (!result.ok) return showError(root, result.error);
  await refresh("object");
  announce("Duplicate acknowledged");
  $("#similar-title")?.setAttribute("tabindex", "-1");
  $("#similar-title")?.focus();
});

// The schedule ------------------------------------------------------------------------------------------

document.addEventListener("click", (event) => {
  const book = event.target.closest("[data-book]");
  if (book) {
    const dialog = $("#dialog-book");
    openDialog(dialog, book);
    dialog.dataset.day = book.dataset.book;
    $("[data-book-day]", dialog).textContent = book.dataset.book;
    $$("[data-pick]", dialog).forEach((pick) => pick.setAttribute("aria-pressed", "false"));
    return;
  }
  const pick = event.target.closest("[data-pick]");
  if (pick) {
    $$("[data-pick]", pick.closest("dialog")).forEach((other) => other.setAttribute("aria-pressed", String(other === pick)));
    return;
  }
  const unbook = event.target.closest("[data-unbook]");
  if (unbook) {
    const dialog = $("#dialog-unbook");
    openDialog(dialog, unbook);
    Object.assign(dialog.dataset, { day: unbook.dataset.unbook, version: unbook.dataset.version, title: unbook.dataset.pieceTitle });
    $("[data-unbook-day]", dialog).textContent = unbook.dataset.unbook;
    $("[data-unbook-title]", dialog).textContent = unbook.dataset.pieceTitle;
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (form.matches("[data-book-form]")) {
    event.preventDefault();
    clearErrors(form);
    const dialog = form.closest("dialog");
    const chosen = $('[data-pick][aria-pressed="true"]', form);
    if (!chosen) return showError(form, { message: "Choose a cleared piece to feature on this day" });
    const result = await busy($("button[type=submit]", form), () => send("PUT", `/api/schedule/${dialog.dataset.day}`,
      { piece_id: Number(chosen.dataset.pick), version: Number(chosen.dataset.version) }));
    if (!result.ok) return showError(form, result.error);
    closeDialog({ restoreFocus: false });
    await refresh("schedule");
    announce(movedTo(chosen.dataset.title, "scheduled"));
    $(`[data-unbook="${dialog.dataset.day}"]`)?.focus();
  } else if (form.matches("[data-unbook-form]")) {
    event.preventDefault();
    clearErrors(form);
    const dialog = form.closest("dialog");
    const result = await busy($("button[type=submit]", form), () =>
      send("DELETE", `/api/schedule/${dialog.dataset.day}?version=${dialog.dataset.version}`));
    if (!result.ok) return showError(form, result.error);
    closeDialog({ restoreFocus: false });
    await refresh("schedule");
    announce(movedTo(dialog.dataset.title, "cleared"));
    $(`[data-book="${dialog.dataset.day}"]`)?.focus();
  }
});

// The budget --------------------------------------------------------------------------------------------

function centsToDollars(cents) {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.trunc(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  return `${sign}${whole}${rest ? `.${String(rest).padStart(2, "0").replace(/0$/, "")}` : ""}`;
}

document.addEventListener("click", async (event) => {
  const multiply = event.target.closest("[data-multiply]");
  if (multiply) {
    const input = $("[data-amount]", multiply.closest("tr"));
    const cents = dollarsToCents(input.value || "0");
    if (cents !== null) input.value = centsToDollars(cents * Number(multiply.dataset.multiply));
    return;
  }
  const apply = event.target.closest("[data-apply]");
  if (apply) {
    const row = apply.closest("[data-fee-row]");
    const root = $('[data-region="budget"]');
    clearErrors(root);
    const input = $("[data-amount]", row);
    const delta = dollarsToCents(input.value);
    if (delta === null) {
      input.setAttribute("aria-invalid", "true");
      return showError(root, { message: `Type an amount in dollars for ${row.dataset.title}` });
    }
    const result = await busy(apply, () => send("PATCH", `/api/budget/${root.dataset.quarter}`,
      { piece_id: Number(row.dataset.pieceId), delta_cents: delta, version: Number(row.dataset.version) }));
    if (!result.ok) return showError(root, result.error);
    await refresh("budget");
    const fresh = $(`[data-fee-row][data-piece-id="${row.dataset.pieceId}"]`);
    announce(`Fee for ${row.dataset.title} is now ${$(".num", fresh)?.textContent.trim()}`);
    $("[data-amount]", fresh)?.focus();
    return;
  }
  const reset = event.target.closest("[data-open-reset]");
  if (reset) openDialog($("#dialog-reset"), reset);
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!form.matches("[data-reset-form]")) return;
  event.preventDefault();
  const root = $('[data-region="budget"]');
  const result = await busy($("button[type=submit]", form), () =>
    send("PATCH", `/api/budget/${root.dataset.quarter}`, { reset: true }));
  if (!result.ok) return showError(form, result.error);
  closeDialog({ restoreFocus: false });
  await refresh("budget");
  announce("Every fee this quarter is back to its submitted value");
  $("[data-open-reset]")?.focus();
});

// The audit trail ---------------------------------------------------------------------------------------

function initAudit() {
  const form = $("[data-audit-filters]");
  if (!form) return;
  const apply = () => {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (value) params.set(key, value);
    const query = params.toString();
    history.replaceState(null, "", query ? `/audit?${query}` : "/audit");
    $("[data-export]").href = query ? `/api/audit/export?${query}` : "/api/audit/export";
    loadRegion("audit-results", query ? `/audit?${query}` : "/audit");
  };
  form.addEventListener("change", apply);
  form.addEventListener("submit", (event) => { event.preventDefault(); apply(); });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-audit-page]");
  if (!link) return;
  event.preventDefault();
  const url = new URL(link.href);
  history.replaceState(null, "", url.pathname + url.search);
  loadRegion("audit-results", url.pathname + url.search);
});

// Settings ----------------------------------------------------------------------------------------------

async function savePreference(fields) {
  const root = $(".settings");
  clearErrors(root);
  const result = await send("PUT", "/api/preferences", fields);
  if (!result.ok) return showError(root, result.error);
  document.documentElement.classList.toggle("hc", result.data.high_contrast);
  announce("Preferences saved");
}

document.addEventListener("change", (event) => {
  const control = event.target.closest("[data-pref]");
  if (!control || control.getAttribute("role") === "switch") return;
  const name = control.dataset.pref;
  savePreference({ [name]: name === "rows_per_page" ? Number(control.value) : control.value });
});

document.addEventListener("click", async (event) => {
  const toggle = event.target.closest('[role="switch"][data-pref]');
  if (toggle) {
    const next = toggle.getAttribute("aria-checked") !== "true";
    toggle.setAttribute("aria-checked", String(next));
    savePreference({ [toggle.dataset.pref]: next });
    return;
  }
  const exporter = event.target.closest("[data-export-pack]");
  if (exporter) {
    const result = await send("GET", "/api/pack");
    if (!result.ok) return showError($(".settings"), result.error);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" }));
    link.download = "clearhouse-pack.json";
    document.body.append(link);
    link.click();
    link.remove();
  }
});

document.addEventListener("change", async (event) => {
  const input = event.target.closest("[data-import-pack]");
  if (!input || !input.files.length) return;
  const root = $(".settings");
  clearErrors(root);
  input.disabled = true;
  const text = await input.files[0].text();
  const result = await send("POST", "/api/pack", text);
  input.disabled = false;
  input.value = "";
  if (!result.ok) return showError(root, result.error);
  announce(`Imported ${result.data.imported} pieces`);
});

// Start -------------------------------------------------------------------------------------------------

initSignIn();
initQueue();
initCatalogue();
initAudit();
