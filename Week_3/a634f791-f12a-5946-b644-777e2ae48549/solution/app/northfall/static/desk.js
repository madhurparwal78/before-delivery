// The private desk: sign-in and the session, the reference list and totals (always from GET /api/desk/references),
// the reference editor, keyboard reordering, preview links and the enquiry queue.
"use strict";

const SESSION_KEY = "northfall.desk-session";
const UNREACHABLE = "The desk cannot be reached. Your change was not saved.";
const SESSION_ENDED = "Your session has ended. Sign in to finish.";
const UNSAVED = "Unsaved changes. Press Escape again to discard.";
const MOVE_REFUSED = "The order could not be changed";
const MOST_FIGURES = 6;
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const editorBelowRow = matchMedia("(max-width: 1099px)");

const messages = document.querySelector(".desk-messages");
const signInPanel = document.querySelector(".sign-in");
const signInForm = document.querySelector(".sign-in-form");
const signInAlert = signInForm.querySelector(".form-alert");
const workspace = document.querySelector(".workspace");
const referenceList = document.querySelector(".desk-list");
const enquiryList = document.querySelector(".enquiry-list");
const editorSlot = document.querySelector(".editor-slot");
const newReference = document.querySelector('[data-action="new"]');
const arrowIcon = document.getElementById("arrow-template").content;
const publicUrl = document.body.dataset.publicUrl;
const textFields = document.body.dataset.textFields.split(" ");

const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "{}");
const desk = {
  token: stored.token, role: stored.role, programme: stored.programme,
  references: [], editor: null, pending: null, busy: new Set(),
};

class Unreachable extends Error {}
class SessionEnded extends Error {}

// ---------------------------------------------------------------- talking to the API

async function request(method, path, body, headers) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Unreachable();
  }
  if (response.status >= 500) throw new Unreachable();
  return response;
}

async function call(method, path, body, headers = {}) {
  const response = await request(method, path, body, { Authorization: `Bearer ${desk.token}`, ...headers });
  if (response.status === 401) throw new SessionEnded();
  return { status: response.status, ok: response.ok, data: response.status === 204 ? null : await response.json() };
}

// A message identical to the one showing is still a fresh change: the region empties first.
function say(text, tone = "done") {
  messages.textContent = "";
  messages.dataset.tone = tone;
  messages.textContent = text;
}

function clearMessage() {
  messages.textContent = "";
}

function helsinkiTime(instant) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki", day: "numeric", month: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${Number(parts.day)}.${Number(parts.month)}.${parts.year} ${parts.hour}:${parts.minute}`;
}

function makeButton(label, action, name) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "button button-quiet";
  element.dataset.action = action;
  element.setAttribute("aria-label", name);
  element.append(label, arrowIcon.cloneNode(true));
  return element;
}

// ---------------------------------------------------------------- where focus lands after each action

const focusTargets = {
  "sign-in": () => document.getElementById("references-heading"),
  new: () => desk.editor.form.elements.title,
  create: () => desk.editor.addFigure,
  "add-figure": () => desk.editor.figureRows.lastElementChild.querySelector('[data-figure="label"]'),
  "remove-figure": ({ index }) => desk.editor.figureRows.children[index]?.querySelector('[data-action="remove-figure"]') ?? desk.editor.addFigure,
  save: () => desk.editor.submit,
  window: () => desk.editor.form.querySelector('[data-action="save-window"]'),
  publish: ({ slug }) => rowButton(slug, "retire") ?? rowButton(slug, "edit"),
  retire: ({ slug }) => rowButton(slug, "publish") ?? rowButton(slug, "edit"),
  preview: ({ slug }) => rowButton(slug, "preview") ?? rowButton(slug, "edit"),
  refused: ({ slug, action }) => rowButton(slug, action) ?? rowButton(slug, "edit"),
  move: ({ slug, action }) => {
    const pressed = rowButton(slug, action);
    const other = rowButton(slug, action === "up" ? "down" : "up");
    if (pressed && !pressed.disabled) return pressed;
    return other && !other.disabled ? other : rowButton(slug, "edit");
  },
  "delete-enquiry": ({ id }) => enquiryList.querySelector(`[data-id="${id}"] button`) ?? document.getElementById("enquiries-heading"),
  "close-editor": ({ slug }) => (slug && rowButton(slug, "edit")) || newReference,
};

function land(target, context = {}) {
  if (desk.token) (focusTargets[target](context) ?? document.getElementById("references-heading")).focus();
}

// ---------------------------------------------------------------- running an action

// Every desk action goes through here: one press at a time per row or form. `write` is the action's one call: a session
// ending there keeps the action pending, to retry with its payload. `finish` shows the answer from a re-read.
async function act(key, write, finish) {
  if (desk.busy.has(key)) return;
  desk.busy.add(key);
  try {
    let answer;
    try {
      answer = await write();
    } catch (error) {
      if (error instanceof SessionEnded) sessionEnded(() => act(key, write, finish));
      else if (error instanceof Unreachable) say(UNREACHABLE, "refused");
      else throw error;
      return;
    }
    await finish(answer);
  } finally {
    desk.busy.delete(key);
  }
}

// A re-read after a write has already landed: it may not undo the action's own report, and never retries the write.
async function reread(options) {
  try {
    await refresh(options);
  } catch (error) {
    if (error instanceof SessionEnded) sessionEnded(null);
    else if (!(error instanceof Unreachable)) throw error;
  }
}

// ---------------------------------------------------------------- signing in and out

function keepSession(token, role, programme) {
  Object.assign(desk, { token, role, programme });
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, role, programme }));
}

function sessionEnded(pending) {
  if (!desk.token) return;
  sessionStorage.removeItem(SESSION_KEY);
  desk.token = null;
  desk.pending = pending;
  say(SESSION_ENDED, "refused");
  signInPanel.hidden = false;
  signInForm.elements.email.focus();
}

signInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (desk.busy.has("sign-in")) return;
  desk.busy.add("sign-in");
  const submit = signInForm.querySelector('button[type="submit"]');
  const label = submit.querySelector(".button-label");
  const rest = () => {
    submit.disabled = false;
    label.textContent = "Sign in";
  };
  signInAlert.textContent = "";
  submit.disabled = true;
  label.textContent = "Signing in…";
  try {
    const response = await request("POST", "/api/auth/login",
      { email: signInForm.elements.email.value, password: signInForm.elements.password.value });
    const answer = await response.json();
    rest();
    if (response.ok) {
      await signedIn(answer, response.headers.get("X-Desk-Programme"));
    } else {
      signInAlert.textContent = answer.message;
      submit.focus();
    }
  } catch (error) {
    if (!(error instanceof Unreachable)) throw error;
    rest();
    say(UNREACHABLE, "refused");
    submit.focus();
  } finally {
    desk.busy.delete("sign-in");
  }
});

// To the same programme a pending action resumes once with its payload; to another it is discarded.
async function signedIn(answer, programme) {
  const { pending } = desk;
  const samePlace = desk.programme === programme;
  desk.pending = null;
  keepSession(answer.token, answer.role, programme);
  signInForm.reset();
  signInPanel.hidden = true;
  clearMessage();
  if (pending && samePlace) {
    await pending();
    return;
  }
  if (pending) closeEditor();
  await reread();
  land("sign-in");
}

// ---------------------------------------------------------------- re-reading from the server

async function refresh({ slide = false } = {}) {
  const [references, enquiries] = await Promise.all([
    call("GET", "/api/desk/references"), call("GET", "/api/desk/enquiries"),
  ]);
  showReferences(references.data, slide);
  showEnquiries(enquiries.data);
  workspace.hidden = false;
}

function showTotals(references) {
  const count = (state) => references.filter((reference) => reference.state === state).length;
  document.querySelector(".desk-totals").textContent =
    `${count("live")} live, ${count("withheld")} withheld, ${count("draft")} drafts, ${count("retired")} retired`;
}

// ---------------------------------------------------------------- the reference list

function rowOf(slug) {
  return referenceList.querySelector(`.desk-row[data-slug="${CSS.escape(slug)}"]`);
}

function rowButton(slug, action) {
  return rowOf(slug)?.querySelector(`.desk-actions [data-action="${action}"]`) ?? null;
}

function actionsFor(reference, liveCount) {
  const { title, state } = reference;
  const rowActions = [["Edit", "edit", `Edit ${title}`]];
  if (state === "draft" || state === "retired") {
    rowActions.push(["Publish", "publish", `Publish ${title}`], ["Preview link", "preview", `Make a preview link for ${title}`]);
  } else {
    rowActions.push(["Retire", "retire", `Retire ${title}`]);
  }
  if (state === "live") {
    rowActions.push(["Up", "up", `Move ${title} up`, reference.ordinal === 1], ["Down", "down", `Move ${title} down`, reference.ordinal === liveCount]);
  }
  return rowActions;
}

function newRow(slug) {
  const row = document.createElement("li");
  row.className = "desk-row";
  row.dataset.slug = slug;
  const main = document.createElement("div");
  main.className = "desk-row-main";
  for (const className of ["desk-ordinal", "desk-row-title", "desk-sector", "desk-state"]) {
    const cell = document.createElement("span");
    cell.className = className;
    main.append(cell, " ");
  }
  const actions = document.createElement("div");
  actions.className = "desk-actions";
  row.append(main, " ", actions);
  return row;
}

// Rows and their buttons are kept where they stay the same, so focus, an open editor and its caret survive a re-read.
function fillRow(row, reference, liveCount) {
  row.querySelector(".desk-ordinal").textContent = reference.ordinal ?? "not live";
  row.querySelector(".desk-row-title").textContent = reference.title;
  row.querySelector(".desk-sector").textContent = reference.sector;
  const state = row.querySelector(".desk-state");
  state.textContent = reference.state;
  state.dataset.state = reference.state;
  const actions = row.querySelector(".desk-actions");
  const wanted = actionsFor(reference, liveCount);
  const kept = new Map([...actions.children].map((control) => [control.dataset.action, control]));
  wanted.forEach(([label, action, name, disabled], position) => {
    const control = kept.get(action) ?? makeButton(label, action, name);
    kept.delete(action);
    control.setAttribute("aria-label", name);
    control.disabled = Boolean(disabled);
    if (actions.children[position] !== control) actions.insertBefore(control, actions.children[position] ?? null);
  });
  kept.forEach((control) => control.remove());
}

function showReferences(references, slide) {
  const before = slide && !calm.matches
    ? new Map([...referenceList.children].map((row) => [row.dataset.slug, row.getBoundingClientRect().top]))
    : null;
  const held = document.activeElement;
  desk.references = references;
  showTotals(references);
  const liveCount = references.filter((reference) => reference.state === "live").length;
  const keep = new Set(references.map((reference) => reference.slug));
  [...referenceList.children].forEach((row) => {
    if (!keep.has(row.dataset.slug)) {
      row.querySelector(".editor") && editorSlot.append(row.querySelector(".editor"));
      row.remove();
    }
  });
  references.forEach((reference, position) => {
    const row = rowOf(reference.slug) ?? newRow(reference.slug);
    fillRow(row, reference, liveCount);
    if (referenceList.children[position] !== row) referenceList.insertBefore(row, referenceList.children[position] ?? null);
  });
  placeEditor();
  if (held !== document.activeElement && held?.isConnected) held.focus({ preventScroll: true });
  if (before) slideRows(before);
}

function slideRows(before) {
  for (const row of referenceList.children) {
    const was = before.get(row.dataset.slug);
    const shift = was === undefined ? 0 : was - row.getBoundingClientRect().top;
    if (shift) row.animate([{ transform: `translateY(${shift}px)` }, { transform: "translateY(0)" }],
      { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  }
}

calm.addEventListener("change", () => {
  if (calm.matches) document.getAnimations().forEach((animation) => animation.finish());
});

function titleOf(slug) {
  return desk.references.find((reference) => reference.slug === slug)?.title ?? slug;
}

// ---------------------------------------------------------------- row actions

// After any action the list is re-read; the editor on this row takes the server's new version.
async function afterRowAction(slug) {
  await reread();
  if (desk.token && desk.editor?.slug === slug) await refreshEditorVersion();
}

function rowAction(slug, action, path, succeeded) {
  return act(`row:${slug}`, () => {
    say("Saving…");
    return call("POST", path);
  }, async (answer) => {
    await afterRowAction(slug);
    if (answer.ok) {
      say(succeeded(answer.data));
      land(action, { slug });
    } else {
      say(answer.data.message, "refused");
      land("refused", { slug, action });
    }
  });
}

function moveRow(slug, action) {
  const reference = desk.references.find((item) => item.slug === slug);
  const ordinal = reference.ordinal + (action === "up" ? -1 : 1);
  return act(`row:${slug}`, () => {
    clearMessage();
    return call("PUT", "/api/desk/order", { slug, ordinal });
  }, async (answer) => {
    await reread({ slide: true });
    if (answer.ok) {
      const placed = answer.data.find((item) => item.slug === slug);
      say(`${reference.title} moved to position ${placed.ordinal} of ${answer.data.length}`);
    } else {
      say(MOVE_REFUSED, "refused");
    }
    land("move", { slug, action });
  });
}

referenceList.addEventListener("click", (event) => {
  const control = event.target.closest(".desk-actions button");
  if (!control) return;
  const { slug } = control.closest(".desk-row").dataset;
  const title = titleOf(slug);
  const path = `/api/desk/references/${encodeURIComponent(slug)}`;
  switch (control.dataset.action) {
    case "edit":
      openEditor(slug);
      break;
    case "publish":
      rowAction(slug, "publish", `${path}/publish`, () => `${title} is published`);
      break;
    case "retire":
      rowAction(slug, "retire", `${path}/retire`, () => `${title} is retired`);
      break;
    case "preview":
      rowAction(slug, "preview", `${path}/preview`, (link) =>
        `Preview link ready: ${publicUrl}/references/${slug}?preview=${link.token} (expires ${helsinkiTime(link.expires_at)})`);
      break;
    default:
      moveRow(slug, control.dataset.action);
  }
});

newReference.addEventListener("click", () => openEditor(null));

// ---------------------------------------------------------------- the reference editor

function placeEditor() {
  referenceList.querySelector(".desk-row[data-editing]")?.removeAttribute("data-editing");
  if (!desk.editor) return;
  const { element, slug } = desk.editor;
  const row = slug && rowOf(slug);
  row?.setAttribute("data-editing", "");
  const home = row && editorBelowRow.matches ? row : editorSlot;
  if (element.parentElement === home) return;
  const held = element.contains(document.activeElement) ? document.activeElement : null;
  home.append(element);
  held?.focus({ preventScroll: true });
}

editorBelowRow.addEventListener("change", placeEditor);

function renumberFigures() {
  const { figureRows, addFigure, count } = desk.editor;
  [...figureRows.children].forEach((row, position) => {
    const number = position + 1;
    row.querySelectorAll(".field").forEach((field) => {
      const input = field.querySelector("input");
      const part = input.dataset.figure;
      input.id = `figure-${number}-${part}`;
      field.querySelector("label").htmlFor = input.id;
      field.querySelector("label").textContent = `Figure ${number} ${part}`;
    });
    row.querySelector('[data-action="remove-figure"]').setAttribute("aria-label", `Remove figure ${number}`);
  });
  count.textContent = `Figures ${figureRows.children.length} of ${MOST_FIGURES}`;
  addFigure.disabled = figureRows.children.length >= MOST_FIGURES;
}

function addFigureRow(figure = { label: "", value: "" }) {
  const row = document.getElementById("figure-template").content.firstElementChild.cloneNode(true);
  row.querySelector('[data-figure="label"]').value = figure.label;
  row.querySelector('[data-figure="value"]').value = figure.value;
  desk.editor.figureRows.append(row);
  renumberFigures();
}

function figuresInEditor() {
  return [...desk.editor.figureRows.children].map((row) => ({
    label: row.querySelector('[data-figure="label"]').value,
    value: row.querySelector('[data-figure="value"]').value,
  }));
}

// What Escape compares: the reference's fields and the window's, each marked clean by its own save.
function editorContent() {
  const { form } = desk.editor;
  return JSON.stringify([textFields.map((name) => form.elements[name].value), figuresInEditor()]);
}

function editorWindow() {
  const { form } = desk.editor;
  return JSON.stringify(["clearance_from", "clearance_until"].map((name) => form.elements[name]?.value));
}

function clearFieldErrors(scope) {
  scope.querySelectorAll("[data-error-for]").forEach((error) => { error.textContent = ""; });
  scope.querySelectorAll("[aria-invalid]").forEach((field) => field.removeAttribute("aria-invalid"));
}

function showFieldErrors(scope, errors) {
  const failing = [];
  for (const [key, message] of Object.entries(errors)) {
    scope.querySelector(`[data-error-for="${key}"]`).textContent = message;
    const field = key === "figures"
      ? scope.querySelector(".figure-rows input") ?? desk.editor.addFigure
      : scope.elements[key];
    field.setAttribute("aria-invalid", "true");
    failing.push(field);
  }
  const order = [...scope.elements];
  failing.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0].focus();
}

function recordedWindowText(reference) {
  return reference.clearance_from
    ? `Clearance window: ${reference.clearance_from} to ${reference.clearance_until}`
    : "No clearance window is recorded.";
}

function buildClearance(reference) {
  const place = desk.editor.element.querySelector(".clearance");
  place.replaceChildren();
  if (!reference) return;
  if (desk.role === "steward") {
    const fields = document.getElementById("clearance-steward-template").content.firstElementChild.cloneNode(true);
    fields.querySelector('[name="clearance_from"]').value = reference.clearance_from ?? "";
    fields.querySelector('[name="clearance_until"]').value = reference.clearance_until ?? "";
    place.append(fields);
  } else {
    const text = document.createElement("p");
    text.className = "clearance-text";
    text.textContent = recordedWindowText(reference);
    place.append(text);
  }
}

// An action from this desk on the editor's own row refreshes the version and the recorded window, never the typing.
async function refreshEditorVersion() {
  const answer = await call("GET", `/api/desk/references/${encodeURIComponent(desk.editor.slug)}`);
  if (!answer.ok) return;
  desk.editor.version = answer.data.version;
  desk.editor.hadFigures = desk.editor.hadFigures || answer.data.figures.length > 0;
  const { form, element } = desk.editor;
  if (!element.querySelector(".clearance").children.length) buildClearance(answer.data);
  const text = element.querySelector(".clearance-text");
  if (text) text.textContent = recordedWindowText(answer.data);
  if (form.elements.clearance_from && !desk.editor.windowTyped) {
    form.elements.clearance_from.value = answer.data.clearance_from ?? "";
    form.elements.clearance_until.value = answer.data.clearance_until ?? "";
  }
  if (!desk.editor.windowTyped) desk.editor.cleanWindow = editorWindow();
}

function closeEditor() {
  desk.editor?.element.remove();
  desk.editor = null;
  placeEditor();
}

function openEditor(slug) {
  return act(`editor:${slug}`, () => (slug ? call("GET", `/api/desk/references/${encodeURIComponent(slug)}`) : null), async (reference) => {
    if (reference && !reference.ok) {
      say(reference.data.message, "refused");
      await reread();
      land("refused", { slug, action: "edit" });
      return;
    }
    closeEditor();
    const element = document.getElementById("editor-template").content.firstElementChild.cloneNode(true);
    const form = element.querySelector(".editor-form");
    desk.editor = {
      element, form, slug, version: reference?.data.version,
      hadFigures: Boolean(reference?.data.figures.length), windowTyped: false, escapeArmed: false,
      figureRows: element.querySelector(".figure-rows"), count: element.querySelector(".figure-count"),
      addFigure: element.querySelector('[data-action="add-figure"]'), submit: form.querySelector('button[type="submit"]'),
    };
    showEditorHeading(reference?.data.title);
    for (const name of textFields) form.elements[name].value = reference?.data[name] ?? "";
    (reference?.data.figures ?? []).forEach((figure) => addFigureRow(figure));
    renumberFigures();
    buildClearance(reference?.data);
    desk.editor.cleanContent = editorContent();
    desk.editor.cleanWindow = editorWindow();
    placeEditor();
    land("new");
  });
}

function showEditorHeading(title) {
  const { element, submit } = desk.editor;
  element.querySelector(".editor-heading").textContent = title ? `Editing ${title}` : "New reference";
  submit.querySelector(".button-label").textContent = title ? "Save the reference" : "Create the draft";
}

function saveBody() {
  const { form, hadFigures } = desk.editor;
  const body = Object.fromEntries(textFields.map((name) => [name, form.elements[name].value]));
  const figures = figuresInEditor();
  if (figures.length || hadFigures) body.figures = figures;
  return body;
}

function saveReference() {
  const editor = desk.editor;
  const { form, slug, version } = editor;
  const body = saveBody();
  const creating = !slug;
  return act("editor", () => {
    clearFieldErrors(form);
    say("Saving…");
    return creating
      ? call("POST", "/api/desk/references", body)
      : call("PATCH", `/api/desk/references/${encodeURIComponent(slug)}`, body, { "If-Match": `"${version}"` });
  }, async (answer) => {
    if (answer.status === 422) {
      clearMessage();
      showFieldErrors(form, answer.data.errors);
      return;
    }
    if (!answer.ok) {
      await reread();
      say(answer.data.message, "refused");
      if (desk.editor === editor) land("save");
      return;
    }
    editor.slug = answer.data.slug;
    await reread();
    say(answer.data.clearance_voided ? `Saved. Record a new clearance window for ${body.title}.` : "Saved");
    if (desk.editor !== editor || !desk.token) return;
    await refreshEditorVersion();
    showEditorHeading(body.title);
    editor.cleanContent = editorContent();
    land(creating ? "create" : "save");
  });
}

function saveClearanceWindow() {
  const editor = desk.editor;
  const { form, slug } = editor;
  const payload = { clearance_from: form.elements.clearance_from.value, clearance_until: form.elements.clearance_until.value };
  return act("editor", () => {
    clearFieldErrors(form);
    say("Saving…");
    return call("PUT", `/api/desk/references/${encodeURIComponent(slug)}/clearance`, payload);
  }, async (answer) => {
    if (answer.status === 422) {
      clearMessage();
      showFieldErrors(form, answer.data.errors);
      return;
    }
    if (!answer.ok) {
      await reread();
      say(answer.data.message, "refused");
      if (desk.editor === editor) land("window");
      return;
    }
    editor.windowTyped = false;
    await afterRowAction(slug);
    say(`Clearance window saved for ${titleOf(slug)}`);
    if (desk.editor === editor) land("window");
  });
}

// One listener on the slot and the rows, so the editor keeps answering wherever it is placed.
function editorClick(event) {
  const control = event.target.closest(".editor button");
  if (!control || !desk.editor) return;
  switch (control.dataset.action) {
    case "add-figure":
      addFigureRow();
      land("add-figure");
      break;
    case "remove-figure": {
      const row = control.closest(".figure-row");
      const index = [...desk.editor.figureRows.children].indexOf(row);
      row.remove();
      renumberFigures();
      land("remove-figure", { index });
      break;
    }
    case "save-window":
      saveClearanceWindow();
      break;
  }
}

function editorSubmit(event) {
  if (!event.target.matches(".editor-form")) return;
  event.preventDefault();
  saveReference();
}

function editorKeydown(event) {
  if (!desk.editor || !event.target.closest(".editor")) return;
  if (event.key === "Enter" && event.target.matches('.clearance input')) {
    event.preventDefault();
    saveClearanceWindow();
    return;
  }
  if (event.key !== "Escape") return;
  const dirty = editorContent() !== desk.editor.cleanContent || editorWindow() !== desk.editor.cleanWindow;
  if (dirty && !desk.editor.escapeArmed) {
    desk.editor.escapeArmed = true;
    say(UNSAVED);
    return;
  }
  const { slug } = desk.editor;
  closeEditor();
  land("close-editor", { slug });
}

function editorInput(event) {
  if (!desk.editor || !event.target.closest(".editor")) return;
  desk.editor.escapeArmed = false;
  if (event.target.closest(".clearance")) desk.editor.windowTyped = true;
}

for (const home of [editorSlot, referenceList]) {
  home.addEventListener("click", editorClick);
  home.addEventListener("submit", editorSubmit);
  home.addEventListener("keydown", editorKeydown);
  home.addEventListener("input", editorInput);
}

// ---------------------------------------------------------------- the enquiry queue

function showEnquiries(enquiries) {
  document.querySelector(".enquiry-count").textContent = `${enquiries.length} open enquiries`;
  enquiryList.replaceChildren(...enquiries.map((enquiry) => {
    const row = document.createElement("li");
    row.className = "enquiry-row";
    row.dataset.id = enquiry.id;
    const text = document.createElement("div");
    const address = document.createElement("p");
    address.textContent = enquiry.email;
    const meta = document.createElement("p");
    meta.className = "enquiry-meta";
    meta.textContent = [enquiry.reference ? titleOf(enquiry.reference) : "No particular reference",
      enquiry.phone, helsinkiTime(enquiry.created_at)].filter(Boolean).join(" · ");
    text.append(address, meta);
    row.append(text);
    if (desk.role === "steward") row.append(makeButton("Delete", "delete", `Delete the enquiry from ${enquiry.email}`));
    return row;
  }));
}

enquiryList.addEventListener("click", (event) => {
  const control = event.target.closest('button[data-action="delete"]');
  if (!control) return;
  const row = control.closest(".enquiry-row");
  const { id } = row.dataset;
  const next = row.nextElementSibling?.dataset.id;
  act(`enquiry:${id}`, () => {
    say("Saving…");
    return call("DELETE", `/api/desk/enquiries/${id}`);
  }, async (answer) => {
    await reread();
    if (answer.ok) {
      say("Enquiry deleted");
      land("delete-enquiry", { id: next });
    } else {
      say(answer.data.message, "refused");
      land("delete-enquiry", { id });
    }
  });
});

// ---------------------------------------------------------------- opening the desk

if (desk.token) {
  signInPanel.hidden = true;
  reread();
}
