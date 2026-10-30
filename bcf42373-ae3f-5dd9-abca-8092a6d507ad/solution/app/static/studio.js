// Studio: the owner's sign-in and console. The bearer token lives only in this tab's sessionStorage.
const TOKEN_KEY = "ik-studio-token";
const OUTAGE = "That change could not be saved. Try again in a minute.";
const RECEIVED = new Intl.DateTimeFormat("en-NZ", {
  timeZone: "Pacific/Auckland", day: "numeric", month: "long", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

function element(tag, properties = {}, ...children) {
  const node = Object.assign(document.createElement(tag), properties);
  node.append(...children);
  return node;
}

function markFieldErrors(form, errors) {
  for (const [name, message] of Object.entries(errors)) {
    const control = form.elements.namedItem(name);
    document.getElementById(`${form.dataset.prefix}-${name}-error`).textContent = message;
    control?.setAttribute("aria-invalid", "true");
  }
}

function clearFieldErrors(form) {
  for (const control of form.querySelectorAll("[aria-invalid]")) control.removeAttribute("aria-invalid");
  for (const holder of form.querySelectorAll(".field-error")) holder.textContent = "";
}

/* Sign-in ------------------------------------------------------------------------------------------------- */

const signInForm = document.querySelector("[data-sign-in]");

if (signInForm) {
  signInForm.dataset.prefix = "login";
  signInForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = signInForm.querySelector(".submit");
    const alert = signInForm.querySelector('[role="alert"]');
    clearFieldErrors(signInForm);
    alert.replaceChildren();
    button.disabled = true;
    button.textContent = "Signing in…";
    let response = null;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: signInForm.elements.email.value, password: signInForm.elements.password.value }),
      });
    } catch {
      // The network failed: reported below like an outage.
    }
    if (response?.ok) {
      sessionStorage.setItem(TOKEN_KEY, (await response.json()).token);
      location.assign("/studio");
      return;
    }
    button.disabled = false;
    button.textContent = "Sign in";
    const refusal = response && response.status < 500 ? await response.json() : null;
    if (refusal?.errors) markFieldErrors(signInForm, refusal.errors);
    else alert.append(element("p", { textContent: refusal ? refusal.error : "Sign-in is unavailable. Try again in a minute." }));
  });
}

/* Console ------------------------------------------------------------------------------------------------- */

const caseRows = document.querySelector("[data-case-rows]");

class SignedOut extends Error {}

function startStudio(token) {
  const status = document.querySelector("[data-studio-status]");
  const errors = document.querySelector("[data-studio-errors]");
  const editor = document.querySelector("[data-editor]");
  const inbox = document.querySelector("[data-inquiries]");
  editor.dataset.prefix = "editor";
  const disciplines = Object.fromEntries([...editor.elements.discipline.options].map((option) => [option.value, option.text]));
  const projectTypes = JSON.parse(inbox.dataset.projectTypes);
  const fieldsOf = (kind) => [...editor.querySelectorAll(`[data-kind="${kind}"]`)].map((field) => field.dataset.field);
  const textFields = [...fieldsOf("text"), ...fieldsOf("area")];
  const numberFields = fieldsOf("number");
  let cases = [];
  let editing = null;

  async function api(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      location.replace("/studio/login");
      throw new SignedOut();
    }
    if (response.status >= 500) throw new Error(`studio answered ${response.status}`);
    return response;
  }

  function say(message) {
    errors.replaceChildren();
    status.textContent = message;
  }

  function refuse(message) {
    status.textContent = "";
    errors.replaceChildren(element("p", { textContent: message }));
  }

  async function act(button, work) {
    button.disabled = true;
    try {
      await work();
    } catch (error) {
      if (error instanceof SignedOut) return;
      refuse(OUTAGE);
    } finally {
      button.disabled = false;
    }
  }

  function rowButton(label, name, onPress) {
    const button = element("button", { type: "button", className: "row-button", textContent: label });
    button.setAttribute("aria-label", `${label} ${name}`);
    button.addEventListener("click", () => act(button, onPress));
    return button;
  }

  function cell(label, ...content) {
    const td = element("td", {}, ...content);
    td.dataset.label = label;
    return td;
  }

  function caseRow(caseStudy) {
    const state = caseStudy.published ? "Published" : "Draft";
    return element("tr", {},
      element("th", { scope: "row", className: "case-row-title" }, caseStudy.title),
      cell("Slug", element("code", { textContent: caseStudy.slug })),
      cell("Discipline", disciplines[caseStudy.discipline]),
      cell("State", element("span", { className: `chip chip-${state.toLowerCase()}`, textContent: state })),
      cell("Featured", caseStudy.featured ? "Featured" : "No"),
      cell("Position", String(caseStudy.position)),
      element("td", { className: "row-actions" },
        rowButton("Edit", caseStudy.title, async () => openEditor(caseStudy)),
        rowButton(caseStudy.published ? "Unpublish" : "Publish", caseStudy.title, () => publish(caseStudy)),
        rowButton("Delete", caseStudy.title, () => remove(caseStudy))));
  }

  async function loadCases() {
    cases = await (await api("GET", "/api/studio/cases")).json();
    caseRows.replaceChildren(...(cases.length ? cases.map(caseRow)
      : [element("tr", {}, element("td", { colSpan: 7, className: "table-note", textContent: "No case studies yet." }))]));
  }

  async function publish(caseStudy) {
    const response = await api("POST", `/api/studio/cases/${caseStudy.id}/publish`, { published: !caseStudy.published });
    if (response.ok) say(caseStudy.published ? "Unpublished." : "Published.");
    else {
      const refusal = await response.json();
      refuse(refusal.errors ? Object.values(refusal.errors).join(" ") : refusal.error);
    }
    await loadCases();
  }

  async function remove(caseStudy) {
    const response = await api("DELETE", `/api/studio/cases/${caseStudy.id}`);
    if (response.ok) {
      say("Deleted.");
      if (editing?.id === caseStudy.id) closeEditor();
    } else refuse((await response.json()).error);
    await loadCases();
  }

  function openEditor(caseStudy) {
    editing = caseStudy;
    clearFieldErrors(editor);
    editor.reset();
    editor.hidden = false;
    editor.querySelector("[data-editor-title]").textContent = caseStudy ? `Editing ${caseStudy.title}` : "New case study";
    editor.querySelector("[data-save]").textContent = caseStudy ? "Save" : "Save draft";
    editor.querySelector("[data-slug-input]").hidden = Boolean(caseStudy);
    editor.querySelector("[data-slug-fixed]").hidden = !caseStudy;
    editor.querySelector("[data-slug-value]").textContent = caseStudy ? caseStudy.slug : "";
    if (caseStudy) {
      for (const name of [...textFields, ...numberFields, "discipline"]) editor.elements[name].value = caseStudy[name];
      editor.elements.featured.checked = caseStudy.featured;
    }
    editor.elements.title.focus();
  }

  function closeEditor() {
    editing = null;
    editor.hidden = true;
  }

  function editorValues() {
    const values = { discipline: editor.elements.discipline.value, featured: editor.elements.featured.checked };
    for (const name of textFields) values[name] = editor.elements[name].value;
    for (const name of numberFields) {
      const typed = editor.elements[name].value.trim();
      if (typed) values[name] = /^-?\d+$/.test(typed) ? Number(typed) : typed;
    }
    if (editing) return Object.fromEntries(Object.entries(values).filter(([name, value]) => value !== editing[name]));
    return { ...values, slug: editor.elements.slug.value };
  }

  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = editor.querySelector("[data-save]");
    act(button, async () => {
      clearFieldErrors(editor);
      const response = editing
        ? await api("PATCH", `/api/studio/cases/${editing.id}`, editorValues())
        : await api("POST", "/api/studio/cases", editorValues());
      if (response.ok) {
        say(editing ? "Saved." : "Draft created.");
        closeEditor();
        await loadCases();
        return;
      }
      const refusal = await response.json();
      if (!refusal.errors) refuse(refusal.error);
      else if (refusal.errors.body) refuse(refusal.errors.body);
      else {
        markFieldErrors(editor, refusal.errors);
        refuse("Check the highlighted fields.");
      }
    });
  });
  editor.querySelector("[data-cancel]").addEventListener("click", closeEditor);
  document.querySelector("[data-create]").addEventListener("click", () => openEditor(null));

  function inquiryItem(inquiry) {
    const resolved = inquiry.status === "resolved";
    const item = element("li", { className: "inquiry-row" },
      element("div", { className: "inquiry-head" },
        element("p", { className: "inquiry-name", textContent: inquiry.name }),
        element("span", { className: `chip chip-${inquiry.status}`, textContent: resolved ? "Resolved" : "New" })),
      element("p", { className: "inquiry-meta" },
        `${inquiry.email} · ${inquiry.phone} · ${inquiry.project_type ? projectTypes[inquiry.project_type] : "No preference"}`),
      element("p", { className: "inquiry-time" }, "Received ",
        element("time", { dateTime: inquiry.received_at, textContent: RECEIVED.format(new Date(inquiry.received_at)) })),
      element("p", { className: "inquiry-message", textContent: inquiry.message }));
    if (!resolved) item.append(rowButton("Mark resolved", inquiry.name, () => resolve(inquiry)));
    return item;
  }

  async function loadInquiries() {
    const inquiries = await (await api("GET", "/api/studio/inquiries")).json();
    inbox.replaceChildren(...(inquiries.length ? inquiries.map(inquiryItem)
      : [element("li", { className: "table-note", textContent: "No inquiries yet." })]));
  }

  async function resolve(inquiry) {
    const response = await api("POST", `/api/studio/inquiries/${inquiry.id}/resolve`);
    if (response.ok) say("Marked resolved.");
    else refuse((await response.json()).error);
    await loadInquiries();
  }

  const signOut = document.querySelector("[data-sign-out]");
  signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    } catch {
      // Offline: the token is still forgotten in this tab below.
    }
    sessionStorage.removeItem(TOKEN_KEY);
    location.assign("/studio/login");
  });

  Promise.all([loadCases(), loadInquiries()]).catch((error) => {
    if (!(error instanceof SignedOut)) refuse("The studio is briefly offline. Try again in a minute.");
  });
}

if (caseRows) {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) startStudio(token);
  else location.replace("/studio/login");
}
