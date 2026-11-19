// src/client/lib.ts
var currentSession = null;
async function api(method, path, body) {
  const headers = {};
  if (body !== void 0 && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    body: body === void 0 ? void 0 : body instanceof FormData ? body : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  let error = null;
  try {
    const parsed = JSON.parse(text);
    if (res.ok) data = parsed;
    else error = parsed;
  } catch {
    if (!res.ok) error = { error: "unknown", message: "Something went wrong." };
  }
  if (res.status === 401) {
    currentSession = null;
  }
  return { ok: res.ok, status: res.status, data, error, headers: res.headers };
}
async function loadSession() {
  const r = await api("GET", "/api/me");
  if (r.data) {
    currentSession = { account: r.data };
  }
  return currentSession;
}
function session() {
  return currentSession;
}
function setSession(s) {
  currentSession = s;
}
function signOut() {
  currentSession = null;
  return api("POST", "/api/auth/signout").then(() => void 0);
}
var routes = [];
function route(pattern, render) {
  const regex = new RegExp(`^${pattern}/?$`);
  routes.push({ regex, render });
}
async function renderPath(pathname, params) {
  for (const r of routes) {
    const m = pathname.match(r.regex);
    if (m) {
      return r.render(m, params);
    }
  }
  return notFoundPage();
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === void 0 || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k === "text") node.textContent = String(v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2), v);
    } else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child === null || child === void 0) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}
function link(href, text, cls) {
  const a = el("a", { href, class: cls });
  a.textContent = text;
  a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    history.pushState(null, "", href);
    void mountApp();
  });
  return a;
}
function live(id) {
  const found = document.getElementById(id);
  if (found) return found;
  const div = el("div", { id, role: "status", "aria-live": "polite", class: "visually-hidden" });
  document.body.append(div);
  return div;
}
function announce(id, message) {
  const region = live(id);
  region.textContent = "";
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}
async function mountApp() {
  const app = document.getElementById("app");
  if (!app) return;
  const url = new URL(window.location.href);
  if (!currentSession) {
    await loadSession();
  }
  app.replaceChildren();
  const node = await renderPath(url.pathname, url.searchParams);
  app.append(node);
}
function navigate(to, replace = false) {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  void mountApp();
}
function notFoundPage() {
  return el(
    "main",
    { class: "page-narrow" },
    el(
      "section",
      { class: "panel not-found", "aria-labelledby": "nf-h" },
      el("h1", { id: "nf-h" }, "This page does not exist.")
    )
  );
}

// src/client/app.ts
function topBar(opts) {
  const acc = opts.account;
  const bar = el("header", { class: "topbar" });
  bar.append(el("span", { class: "wordmark" }, "Rushes"));
  const navLinks = [];
  navLinks.push(link("/explore", "Explore"));
  if (acc && (acc.role === "designer" || acc.role === "ops_lead")) {
    const slug = opts.currentSlug ?? acc.workspaces[0]?.slug;
    if (slug) navLinks.push(link(`/w/${slug}`, "Wall"));
  }
  if (acc && acc.role === "ops_lead" && opts.currentSlug) {
    navLinks.push(link(`/w/${opts.currentSlug}/admin`, "Admin"));
  }
  const nav = el("nav", { class: "main-nav", "aria-label": "Main" }, ...navLinks);
  if (opts.bare) {
    bar.append(nav, accountControl(acc));
    return bar;
  }
  const menuButton = el("button", {
    class: "menu-button",
    "aria-expanded": "false",
    "aria-controls": "main-nav-panel"
  }, "Menu");
  menuButton.addEventListener("click", () => {
    const open = nav.classList.toggle("nav-open");
    menuButton.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) nav.querySelector("a")?.focus();
  });
  const closeMenu = () => {
    nav.classList.remove("nav-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.focus();
  };
  nav.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  });
  menuButton.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  });
  bar.append(menuButton, nav);
  if (acc && (acc.role === "designer" || acc.role === "ops_lead")) {
    if (acc.role === "ops_lead" && acc.workspaces.length > 1) {
      const select = el("select", { class: "ws-switcher", "aria-label": "Brand workspace" });
      for (const ws of acc.workspaces) {
        const opt = el("option", { value: ws.slug }, ws.name);
        if (ws.slug === opts.currentSlug) opt.selected = true;
        select.append(opt);
      }
      select.addEventListener("change", () => {
        window.location.href = `/w/${select.value}`;
      });
      bar.append(select);
    } else {
      const wsName = acc.workspaces.find((w) => w.slug === opts.currentSlug)?.name ?? acc.workspaces[0]?.name;
      if (wsName) bar.append(el("span", { class: "ws-name" }, wsName));
    }
  }
  bar.append(accountControl(acc));
  return bar;
}
function accountControl(acc) {
  const wrap = el("div", { class: "account-control" });
  if (!acc) {
    wrap.append(link("/signin", "Sign in"));
    return wrap;
  }
  wrap.append(
    el("span", { class: "account-name" }, acc.displayName),
    el("button", {
      class: "btn btn-ghost",
      onclick: async () => {
        await signOut();
        window.location.href = "/explore";
      }
    }, "Sign out")
  );
  return wrap;
}

// src/client/screens/signin.ts
function safeReturnPath(next) {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next[1] === "/" || next[1] === "\\") return null;
  if (next.includes("\\")) return null;
  if (next.toLowerCase().includes("%5c")) return null;
  if (next.toLowerCase().includes("%2f%2f")) return null;
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  const own = next === "/explore" || /^\/@[^/]+$/.test(next) || /^\/c\/[^/]+$/.test(next) || /^\/w\/[^/]+(\/.*)?$/.test(next);
  return own ? next : null;
}
function defaultDestination(account) {
  if (account.role === "ops_lead") {
    const first = account.workspaces[0];
    return first ? `/w/${first.slug}` : "/explore";
  }
  if (account.role === "designer") {
    const ws = account.workspaces[0];
    return ws ? `/w/${ws.slug}` : "/explore";
  }
  return "/explore";
}
function errorSummary(errors, fieldTargets) {
  const summary = el("div", { class: "error-summary", role: "alert", id: "error-summary", tabindex: "-1" });
  const h = el("h2", {}, "There is a problem");
  summary.append(h);
  const ul = el("ul");
  for (const [field, message] of Object.entries(errors)) {
    const li = el("li");
    const a = el("a", { href: `#${fieldTargets[field] ?? field}` }, message);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const target = document.getElementById(fieldTargets[field] ?? field);
      target?.focus();
    });
    li.append(a);
    ul.append(li);
  }
  summary.append(ul);
  return summary;
}
function markInvalid(input, message) {
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", `${input.id}-error`);
  let msg = document.getElementById(`${input.id}-error`);
  if (!msg) {
    msg = el("div", { class: "error-message", id: `${input.id}-error` });
    input.after(msg);
  }
  msg.textContent = message;
}
function clearInvalid(form) {
  form.querySelectorAll('[aria-invalid="true"]').forEach((n) => n.removeAttribute("aria-invalid"));
  form.querySelectorAll(".error-message").forEach((n) => n.remove());
  document.getElementById("error-summary")?.remove();
}
function formField(labelText, input, hint) {
  const field = el("div", { class: "field" });
  const label = el("label", { for: input.id }, labelText);
  field.append(label, input);
  if (hint) field.append(el("div", { class: "muted small" }, hint));
  return field;
}
async function renderSignIn(params) {
  const next = safeReturnPath(params.get("next"));
  const main = el("main", { class: "page-narrow" });
  main.append(topBar({ account: session()?.account ?? null, bare: true }));
  const section = el("section", { class: "panel" });
  section.append(el("h1", {}, "Sign in to Rushes"));
  const form = el("form", { novalidate: true });
  const email = el("input", { type: "email", id: "signin-email", autocomplete: "email" });
  email.setAttribute("aria-label", "Email");
  const password = el("input", { type: "password", id: "signin-password", autocomplete: "current-password" });
  password.setAttribute("aria-label", "Password");
  const submit = el("button", { type: "submit", class: "btn btn-primary" }, "Sign in");
  submit.setAttribute("aria-label", "Sign in");
  form.append(
    formField("Email", email),
    formField("Password", password),
    el("div", {}, submit)
  );
  const nav = el("p", { class: "small" });
  const createLink = link(`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`, "Create an account");
  nav.append("No account? ", createLink);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearInvalid(section);
    submit.disabled = true;
    const r = await api("POST", "/api/auth/signin", { email: email.value, password: password.value });
    submit.disabled = false;
    if (r.ok && r.data) {
      setSession({ account: r.data });
      navigate(next ?? defaultDestination(r.data));
      return;
    }
    const err = r.error;
    if (err?.error === "validation") {
      const errors = err.errors ?? {};
      section.prepend(errorSummary(errors, { email: "signin-email", password: "signin-password" }));
      document.getElementById("error-summary")?.focus();
      for (const [field, message] of Object.entries(errors)) {
        const input = field === "email" ? email : password;
        markInvalid(input, message);
      }
    } else {
      const message = err?.message ?? "Email or password is incorrect.";
      section.prepend(errorSummary({ email: message }, { email: "signin-email" }));
      document.getElementById("error-summary")?.focus();
      markInvalid(email, message);
    }
  });
  section.append(form, nav);
  main.append(section);
  return main;
}
async function renderSignUp(params) {
  const next = safeReturnPath(params.get("next"));
  const main = el("main", { class: "page-narrow" });
  main.append(topBar({ account: session()?.account ?? null, bare: true }));
  const section = el("section", { class: "panel" });
  section.append(el("h1", {}, "Follow curators on Rushes"));
  const form = el("form", { novalidate: true });
  const email = el("input", { type: "email", id: "signup-email", autocomplete: "email" });
  email.setAttribute("aria-label", "Email");
  const displayName = el("input", { type: "text", id: "signup-displayname", autocomplete: "name" });
  displayName.setAttribute("aria-label", "Display name");
  const handle = el("input", { type: "text", id: "signup-handle", autocomplete: "username" });
  handle.setAttribute("aria-label", "Handle");
  const password = el("input", { type: "password", id: "signup-password", autocomplete: "new-password" });
  password.setAttribute("aria-label", "Password");
  const submit = el("button", { type: "submit", class: "btn btn-primary" }, "Create account");
  submit.setAttribute("aria-label", "Create account");
  form.append(
    formField("Email", email),
    formField("Display name", displayName),
    formField("Handle", handle, "3 to 24 lowercase letters, digits or hyphens."),
    formField("Password", password, "Use at least 10 characters."),
    el("div", {}, submit)
  );
  const nav = el("p", { class: "small" });
  nav.append("Already have an account? ", link(`/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`, "Sign in"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearInvalid(section);
    submit.disabled = true;
    const r = await api("POST", "/api/auth/signup", {
      email: email.value,
      displayName: displayName.value,
      handle: handle.value,
      password: password.value
    });
    submit.disabled = false;
    if (r.ok && r.data) {
      setSession({ account: r.data });
      navigate(next ?? defaultDestination(r.data));
      return;
    }
    const errors = r.error?.errors ?? {};
    section.prepend(errorSummary(errors, { email: "signup-email", displayName: "signup-displayname", handle: "signup-handle", password: "signup-password" }));
    document.getElementById("error-summary")?.focus();
    for (const [field, message] of Object.entries(errors)) {
      const input = { email, displayName, handle, password }[field];
      if (input) markInvalid(input, message);
    }
  });
  section.append(form, nav);
  main.append(section);
  return main;
}
async function renderInvite(token) {
  const main = el("main", { class: "page-narrow" });
  const info = await api("GET", `/api/invites/${token}`);
  if (!info.ok) {
    main.append(el("section", { class: "panel" }, el("h1", {}, info.error?.error === "invite_used" ? "This invite has already been used." : "This page does not exist.")));
    return main;
  }
  main.append(topBar({ account: session()?.account ?? null, bare: true }));
  const section = el("section", { class: "panel" });
  section.append(
    el("h1", {}, `Join ${info.data.workspaceName}`),
    el("p", { class: "muted" }, `Invited as ${info.data.email}`)
  );
  const form = el("form", { novalidate: true });
  const handle = el("input", { type: "text", id: "invite-handle" });
  handle.setAttribute("aria-label", "Handle");
  const password = el("input", { type: "password", id: "invite-password" });
  password.setAttribute("aria-label", "Password");
  const submit = el("button", { type: "submit", class: "btn btn-primary" }, `Join ${info.data.workspaceName}`);
  form.append(
    formField("Handle", handle),
    formField("Password", password, "Use at least 10 characters."),
    el("div", {}, submit)
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearInvalid(section);
    submit.disabled = true;
    const r = await api("POST", `/api/invites/${token}/accept`, { handle: handle.value, password: password.value });
    submit.disabled = false;
    if (r.ok && r.data) {
      setSession({ account: r.data });
      navigate(defaultDestination(r.data));
      return;
    }
    const errors = r.error?.errors ?? {};
    section.prepend(errorSummary(errors, { handle: "invite-handle", password: "invite-password" }));
    document.getElementById("error-summary")?.focus();
    for (const [field, message] of Object.entries(errors)) {
      if (field === "handle") markInvalid(handle, message);
      if (field === "password") markInvalid(password, message);
    }
  });
  section.append(form);
  main.append(section);
  return main;
}

// src/shared/constants.ts
var FEED_PAGE_SIZE = 20;
var MAX_EXPLORE_PAGES = 10;
var STATUS_LABELS = {
  draft: "Draft",
  in_review: "In review",
  embargoed: "Embargoed",
  public: "Public",
  withdrawn: "Withdrawn"
};

// src/client/screens/clip-details.ts
var ClipDetailsDialog = class {
  state;
  file;
  dialog;
  title;
  rate;
  duration;
  submit;
  constructor(state, file) {
    this.state = state;
    this.file = file;
    this.dialog = el("dialog", { class: "dialog", "aria-label": "Clip details" });
    this.dialog.append(el("h2", {}, "Clip details"));
    this.title = el("input", { type: "text", id: "clip-title" });
    this.title.setAttribute("aria-label", "Title");
    this.title.value = this.file.name.replace(/\.[^.]+$/, "");
    this.rate = el("input", { type: "radio", name: "frame-rate", id: "rate-25", value: "25" });
    this.rate.checked = true;
    this.duration = el("input", { type: "number", id: "clip-duration", min: "1", max: "3600000", value: "2000" });
    this.duration.setAttribute("aria-label", "Duration");
    const radios = el("div", { class: "field", role: "radiogroup", "aria-label": "Frame rate" });
    radios.append(el("label", {}, "Frame rate"));
    for (const value of ["24", "25", "30"]) {
      const id = `rate-${value}`;
      const radio = el("input", { type: "radio", name: "frame-rate", id, value });
      if (value === "25") radio.checked = true;
      const label = el("label", { for: id }, value);
      radios.append(el("span", { class: "row" }, radio, label));
    }
    this.dialog.append(radios);
    const form = el("form", { novalidate: true });
    form.append(
      formField("Title", this.title),
      radios,
      el("div", {}, el("button", { type: "submit", class: "btn btn-primary", id: "clip-upload" }, "Upload clip")),
      el("button", { type: "button", class: "btn btn-ghost", id: "clip-cancel" }, "Cancel")
    );
    this.submit = form.querySelector("#clip-upload");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearInvalid(this.dialog);
      const rateValue = Number(this.dialog.querySelector('input[name="frame-rate"]:checked')?.value ?? "25");
      this.submit.disabled = true;
      const body = new FormData();
      body.append("file", this.file, this.file.name);
      body.append("title", this.title.value);
      body.append("frameRate", String(rateValue));
      body.append("durationMs", this.duration.value || "2000");
      const r = await api("POST", `/api/workspaces/${this.state.slug}/references`, body);
      this.submit.disabled = false;
      if (r.ok && r.data) {
        this.state.references.unshift(r.data);
        const list = document.getElementById("references-list");
        if (list) list.prepend(el("li", {}, windowWallCard(r.data)));
        announce("wall-announcements", `Uploaded ${r.data.title}.`);
        this.close();
        return;
      }
      const errors = r.error?.errors ?? {};
      if (Object.keys(errors).length > 0) {
        this.dialog.prepend(errorSummary(errors, { title: "clip-title", frameRate: "rate-25", durationMs: "clip-duration" }));
        document.getElementById("error-summary")?.focus();
        if (errors.title) markInvalid(this.title, errors.title);
        if (errors.durationMs) markInvalid(this.duration, errors.durationMs);
      } else {
        const message = r.error?.message ?? "The clip was not uploaded.";
        this.dialog.prepend(errorSummary({ title: message }, { title: "clip-title" }));
        document.getElementById("error-summary")?.focus();
      }
    });
    form.querySelector("#clip-cancel").addEventListener("click", () => this.close());
    this.dialog.append(form);
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close();
    });
  }
  open() {
    document.body.append(this.dialog);
    this.dialog.showModal();
    this.title.focus();
  }
  close() {
    this.dialog.close();
    this.dialog.remove();
    const btn = document.getElementById("upload-btn");
    btn?.focus();
  }
};
function windowWallCard(ref) {
  const card = el("article", { class: "ref-card" });
  const video = el("video", { src: ref.mediaUrl, preload: "metadata", muted: true });
  card.append(video, el("div", { class: "ref-title-full" }, ref.title));
  return card;
}

// src/client/screens/add-to-cluster.ts
var AddToClusterDialog = class {
  state;
  reference;
  opener;
  dialog;
  input;
  listbox;
  options = [];
  highlighted = -1;
  seq = 0;
  constructor(state, reference, opener) {
    this.state = state;
    this.reference = reference;
    this.opener = opener;
    this.dialog = el("dialog", { class: "dialog", "aria-label": "Add to cluster" });
    this.dialog.append(el("h2", {}, "Add to cluster"));
    this.input = el("input", { type: "text", id: "picker-input" });
    this.input.setAttribute("aria-label", "Find a cluster");
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-expanded", "true");
    this.input.setAttribute("aria-controls", "picker-list");
    this.input.setAttribute("aria-autocomplete", "list");
    this.listbox = el("ul", { id: "picker-list", role: "listbox", "aria-label": "Clusters", class: "stack" });
    this.dialog.append(
      el("div", { class: "field" }, el("label", { for: "picker-input" }, "Find a cluster"), this.input),
      this.listbox
    );
    this.input.addEventListener("input", () => {
      void this.filter(this.input.value);
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.moveHighlight(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.moveHighlight(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (this.highlighted >= 0 && this.options[this.highlighted]) {
          void this.add(this.options[this.highlighted]);
        } else if (this.options.length === 1) {
          void this.add(this.options[0]);
        }
      }
    });
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close();
    });
  }
  open() {
    document.body.append(this.dialog);
    this.dialog.showModal();
    void this.filter("");
    this.input.focus();
  }
  close() {
    this.dialog.close();
    this.dialog.remove();
    this.opener.focus();
  }
  async filter(q) {
    const seq = ++this.seq;
    const r = await api(
      "GET",
      `/api/workspaces/${this.state.slug}/clusters${q ? `?q=${encodeURIComponent(q)}` : ""}`
    );
    if (seq !== this.seq) return;
    if (this.input.value !== q) return;
    if (!r.ok) return;
    this.options = r.data.clusters;
    this.highlighted = this.options.length === 1 ? 0 : -1;
    this.render();
  }
  render() {
    this.listbox.replaceChildren();
    this.options.forEach((c, i) => {
      const li = el("li", { role: "option", id: `picker-option-${i}`, "aria-selected": i === this.highlighted ? "true" : "false", class: "tray-item" });
      li.append(el("span", { class: "tray-item-title" }, c.title), el("span", { class: "muted small mono" }, `${c.itemCount} items`));
      li.addEventListener("click", () => void this.add(c));
      this.listbox.append(li);
    });
    if (this.highlighted >= 0) {
      this.listbox.children[this.highlighted]?.scrollIntoView({ block: "nearest" });
    }
  }
  moveHighlight(delta) {
    if (this.options.length === 0) return;
    this.highlighted = (this.highlighted + delta + this.options.length) % this.options.length;
    this.render();
  }
  async add(cluster) {
    const r = await api(
      "POST",
      `/api/clusters/${cluster.id}/entries`,
      { referenceId: this.reference.id, isPrivate: false }
    );
    if (r.ok && r.data) {
      announce("tray-announcements", `Added ${this.reference.title}. ${r.data.itemCount} items in ${cluster.title}.`);
      this.close();
      window.dispatchEvent(new CustomEvent("rushes:cluster-chosen", { detail: { clusterId: cluster.id } }));
      return;
    }
    const err = r.error;
    if (err?.error === "already_in_cluster") {
      announce("tray-announcements", `${this.reference.title} is already in ${cluster.title}.`);
    } else if (err?.error === "cluster_locked") {
      announce("tray-announcements", `${cluster.title} is locked and cannot take new items.`);
    } else if (err?.error === "seat_required") {
      announce("wall-announcements", "You need a pro seat to make changes. Ask your design ops lead.");
      this.close();
      return;
    }
    this.close();
  }
};

// src/client/screens/new-cluster.ts
var NewClusterDialog = class {
  state;
  opener;
  dialog;
  title;
  publicDescription;
  internalNote;
  submit;
  constructor(state, opener) {
    this.state = state;
    this.opener = opener;
    this.dialog = el("dialog", { class: "dialog", "aria-label": "New cluster" });
    this.dialog.append(el("h2", {}, `New cluster in ${state.workspace?.name ?? ""}`));
    this.title = el("input", { type: "text", id: "nc-title" });
    this.title.setAttribute("aria-label", "Title");
    this.publicDescription = el("textarea", { id: "nc-public" });
    this.publicDescription.setAttribute("aria-label", "Public description");
    this.internalNote = el("textarea", { id: "nc-note" });
    this.internalNote.setAttribute("aria-label", "Internal note");
    const form = el("form", { novalidate: true });
    form.append(
      formField("Title", this.title),
      formField("Public description", this.publicDescription),
      formField("Internal note", this.internalNote),
      el(
        "div",
        { class: "row" },
        el("button", { type: "submit", class: "btn btn-primary", id: "nc-create" }, "Create cluster"),
        el("button", { type: "button", class: "btn btn-ghost", id: "nc-cancel" }, "Cancel")
      )
    );
    this.submit = form.querySelector("#nc-create");
    this.title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearInvalid(this.dialog);
      this.submit.disabled = true;
      const r = await api("POST", `/api/workspaces/${this.state.slug}/clusters`, {
        title: this.title.value,
        publicDescription: this.publicDescription.value,
        internalNote: this.internalNote.value
      });
      this.submit.disabled = false;
      if (r.ok && r.data) {
        try {
          window.sessionStorage.setItem("rushes.createdCluster", r.data.id);
        } catch {
        }
        this.close();
        navigate(`/w/${this.state.slug}/clusters/${r.data.id}`);
        return;
      }
      const errors = r.error?.errors ?? {};
      this.dialog.prepend(errorSummary(errors, { title: "nc-title", publicDescription: "nc-public", internalNote: "nc-note" }));
      document.getElementById("error-summary")?.focus();
      for (const [field, message] of Object.entries(errors)) {
        if (field === "title") markInvalid(this.title, message);
        if (field === "publicDescription") markInvalid(this.publicDescription, message);
        if (field === "internalNote") markInvalid(this.internalNote, message);
      }
    });
    form.querySelector("#nc-cancel").addEventListener("click", () => this.close());
    this.dialog.append(form);
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close();
    });
  }
  open() {
    document.body.append(this.dialog);
    this.dialog.showModal();
    this.title.focus();
  }
  close() {
    this.dialog.close();
    this.dialog.remove();
    this.opener?.focus();
  }
};

// src/shared/domain.ts
function timecodeOf(frameIndex, frameRate) {
  const ff = frameIndex % frameRate;
  const totalSeconds = Math.floor(frameIndex / frameRate);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return [hh, mm, ss, ff].map((p) => String(p).padStart(2, "0")).join(":");
}

// src/client/screens/strip.ts
var SprocketStrip = class {
  state;
  clip;
  opener;
  node;
  timeline;
  framesWrap;
  playheadLine;
  slider;
  preview;
  timecodeEl;
  pluckBtn;
  closeBtn;
  video;
  totalFrames;
  frameRate;
  frameIndex = 0;
  tiles = [];
  reducedMotion = false;
  constructor(state, clip, opener) {
    this.state = state;
    this.clip = clip;
    this.opener = opener;
    this.totalFrames = clip.totalFrames ?? 1;
    this.frameRate = clip.frameRate ?? 25;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.node = el("section", { class: `strip ${this.reducedMotion ? "" : "sprocket"}`, id: "sprocket-strip", role: "region", "aria-label": "Sprocket strip" });
    const head = el("div", { class: "strip-head" });
    this.preview = el("canvas", { class: "strip-preview", "aria-label": "Frame preview", role: "img" });
    this.preview.width = 296;
    this.preview.height = 168;
    this.timecodeEl = el("div", { class: "strip-timecode mono", role: "timer", "aria-label": "Timecode" }, this.timecodeOf(0));
    this.timeline = el("div", { class: "strip-timeline", id: "strip-timeline" });
    this.framesWrap = el("div", { class: "strip-frames" });
    this.playheadLine = el("div", { class: "playhead" });
    this.slider = el("input", {
      type: "range",
      min: "0",
      max: String(this.totalFrames - 1),
      value: "0",
      step: "1",
      class: "playhead-slider"
    });
    this.slider.style.position = "absolute";
    this.slider.style.left = "0";
    this.slider.style.width = "100%";
    this.slider.style.height = "100%";
    this.slider.style.opacity = "0";
    this.slider.style.margin = "0";
    this.slider.style.cursor = "ew-resize";
    this.slider.style.touchAction = "none";
    this.slider.setAttribute("role", "slider");
    this.slider.setAttribute("aria-label", "Playhead");
    this.slider.setAttribute("aria-valuemin", "0");
    this.slider.setAttribute("aria-valuemax", String(this.totalFrames - 1));
    this.slider.setAttribute("aria-valuenow", "0");
    this.slider.setAttribute("aria-valuetext", this.timecodeOf(0));
    this.timeline.append(this.framesWrap, this.playheadLine, this.slider);
    this.pluckBtn = el("button", { class: "btn btn-primary", id: "pluck-btn" }, "Pluck");
    this.pluckBtn.setAttribute("aria-label", "Pluck frame");
    this.closeBtn = el("button", { class: "btn", id: "close-clip" }, "Close");
    this.closeBtn.setAttribute("aria-label", "Close clip");
    head.append(this.preview, this.timecodeEl, this.pluckBtn, this.closeBtn);
    this.node.append(this.timeline, head);
    this.video = el("video", { src: clip.mediaUrl, preload: "auto", muted: true, crossorigin: "anonymous" });
    this.video.style.display = "none";
    this.video.playsInline = true;
    this.node.append(this.video);
    this.timeline.addEventListener("pointerdown", (e) => {
      this.timeline.setPointerCapture(e.pointerId);
      this.scrubTo(e.clientX);
    });
    this.timeline.addEventListener("pointermove", (e) => {
      if (e.buttons > 0 || this.timeline.hasPointerCapture(e.pointerId)) {
        this.scrubTo(e.clientX);
      }
    });
    this.timeline.addEventListener("pointerup", () => {
    });
    this.timeline.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) this.scrubTo(t.clientX);
    }, { passive: false });
    this.timeline.addEventListener("touchmove", (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) this.scrubTo(t.clientX);
    }, { passive: false });
    this.slider.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? this.frameRate : 1;
      let handled = true;
      if (e.key === "ArrowRight") this.setFrame(Math.min(this.totalFrames - 1, this.frameIndex + step));
      else if (e.key === "ArrowLeft") this.setFrame(Math.max(0, this.frameIndex - step));
      else if (e.key === "Home") this.setFrame(0);
      else if (e.key === "End") this.setFrame(this.totalFrames - 1);
      else if (e.key === "p" || e.key === "P") {
        this.pluck();
      } else handled = false;
      if (handled) e.preventDefault();
    });
    this.node.addEventListener("keydown", (e) => {
      if ((e.key === "p" || e.key === "P") && document.activeElement !== this.slider) {
        e.preventDefault();
        this.pluck();
      }
    });
    const escapeClose = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    };
    this.slider.addEventListener("keydown", escapeClose);
    this.timeline.addEventListener("keydown", escapeClose);
    this.pluckBtn.addEventListener("click", () => this.pluck());
    this.closeBtn.addEventListener("click", () => this.close());
    this.video.addEventListener("loadeddata", () => {
      void this.sample();
    });
    this.video.addEventListener("seeked", () => {
      this.drawCurrentFrame();
    });
  }
  open() {
    this.state.strip = this;
    const layout = document.querySelector(".wall-layout");
    const tray = layout?.querySelector(".tray");
    if (layout && tray) {
      layout.insertBefore(this.node, tray);
    } else {
      document.querySelector("main")?.append(this.node);
    }
    this.slider.focus();
    void this.sample();
  }
  close() {
    this.node.remove();
    if (this.state.strip === this) this.state.strip = null;
    this.opener.focus();
  }
  timecodeOf(index) {
    return timecodeOf(index, this.frameRate);
  }
  frameTime(index) {
    return index / this.frameRate;
  }
  scrubTo(clientX) {
    const rect = this.timeline.getBoundingClientRect();
    const w = rect.width;
    if (w <= 0) return;
    const x = clientX - rect.left;
    const index = Math.min(this.totalFrames - 1, Math.max(0, Math.floor(x / w * this.totalFrames)));
    this.setFrame(index);
  }
  setFrame(index) {
    this.frameIndex = index;
    this.video.currentTime = Math.min(Math.max(this.frameTime(index), 0), Math.max(0, (this.video.duration || 0) - 1e-3));
    this.updateReadouts();
    this.drawCurrentFrame();
  }
  updateReadouts() {
    const tc = this.timecodeOf(this.frameIndex);
    this.timecodeEl.textContent = tc;
    this.slider.value = String(this.frameIndex);
    this.slider.setAttribute("aria-valuenow", String(this.frameIndex));
    this.slider.setAttribute("aria-valuetext", tc);
    const rect = this.timeline.getBoundingClientRect();
    const pct = this.totalFrames > 1 ? this.frameIndex / (this.totalFrames - 1) : 0;
    this.playheadLine.style.left = `${pct * 100}%`;
    this.tiles.forEach((tile, i) => {
      tile.classList.toggle("current", i === this.frameIndex);
    });
  }
  async sample() {
    if (!this.video.videoWidth) {
      await new Promise((resolve) => {
        const done = () => resolve();
        this.video.addEventListener("loadeddata", done, { once: true });
        setTimeout(done, 800);
      });
    }
    const rect = this.timeline.getBoundingClientRect();
    const width = rect.width || 600;
    let count = Math.floor(width / 64);
    count = Math.max(8, count);
    count = Math.min(count, this.totalFrames);
    this.tiles = [];
    this.framesWrap.replaceChildren();
    const indices = [];
    for (let i = 0; i < count; i++) {
      const idx = count === 1 ? 0 : Math.round(i / (count - 1) * (this.totalFrames - 1));
      indices.push(idx);
    }
    for (const idx of indices) {
      const canvas = el("canvas", { class: "strip-frame" });
      canvas.width = 160;
      canvas.height = 90;
      this.tiles.push(canvas);
      this.framesWrap.append(canvas);
      await this.seekAndDraw(canvas, idx);
    }
    this.updateReadouts();
    this.drawCurrentFrame();
  }
  resample() {
    void this.sample();
  }
  async seekAndDraw(canvas, index) {
    const time = this.frameTime(index);
    await new Promise((resolve) => {
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        this.video.removeEventListener("seeked", onSeeked);
      };
      this.video.addEventListener("seeked", onSeeked);
      try {
        this.video.currentTime = time;
      } catch {
        cleanup();
        resolve();
      }
      setTimeout(() => {
        cleanup();
        resolve();
      }, 500);
    });
    const ctx = canvas.getContext("2d");
    if (ctx && this.video.videoWidth) {
      ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    }
  }
  drawCurrentFrame() {
    const ctx = this.preview.getContext("2d");
    if (ctx && this.video.videoWidth) {
      ctx.drawImage(this.video, 0, 0, this.preview.width, this.preview.height);
    }
  }
  async pluck() {
    const clusterId = recalledTrayCluster();
    if (!clusterId) {
      announce("tray-announcements", "Choose a cluster in the tray before plucking.");
      return;
    }
    const canvas = el("canvas");
    canvas.width = this.video.videoWidth || 320;
    canvas.height = this.video.videoHeight || 180;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      announce("tray-announcements", "Storage is unreachable. Frame 00:00:00:00 was not saved and the cluster is unchanged.");
      return;
    }
    const frameIndex = this.frameIndex;
    const tc = this.timecodeOf(frameIndex);
    announce("tray-announcements", `Saving frame ${tc}...`);
    this.pluckBtn.disabled = true;
    const form = new FormData();
    form.append("still", blob, `still-${frameIndex}.png`);
    form.append("frameIndex", String(frameIndex));
    form.append("clusterId", clusterId);
    const r = await api(
      "POST",
      `/api/workspaces/${this.state.slug}/clips/${this.clip.id}/stills`,
      form
    );
    this.pluckBtn.disabled = false;
    if (r.ok && r.data) {
      announce("tray-announcements", `Plucked ${tc} from ${this.clip.title}. ${r.data.cluster.itemCount} items.`);
      window.dispatchEvent(new CustomEvent("rushes:cluster-updated", { detail: { clusterId } }));
      this.focusPlayhead();
      return;
    }
    const err = r.error;
    if (err?.error === "cluster_locked") {
      announce("tray-announcements", `The active cluster is locked and cannot take new items.`);
    } else if (err?.error === "storage_unavailable") {
      announce("tray-announcements", `Storage is unreachable. Frame ${tc} was not saved and the cluster is unchanged.`);
    } else if (err?.error === "seat_required") {
      announce("wall-announcements", "You need a pro seat to make changes. Ask your design ops lead.");
    } else {
      announce("tray-announcements", `Storage is unreachable. Frame ${tc} was not saved and the cluster is unchanged.`);
    }
    this.focusPlayhead();
  }
  focusPlayhead() {
    this.slider.focus();
  }
};

// src/client/screens/tray.ts
var Tray = class {
  state;
  node;
  switcher;
  newBtn;
  list;
  countEl;
  trayPanel;
  toggleBtn = null;
  trayPanelEscape = () => {
  };
  cluster = null;
  lifted = null;
  items = [];
  constructor(state) {
    this.state = state;
    this.node = el("aside", { class: "tray", role: "complementary", "aria-label": "Cluster tray" });
    this.trayPanel = el("div", { class: "tray-panel", id: "tray-panel", hidden: true });
    this.toggleBtn = el("button", { class: "btn tray-toggle", "aria-expanded": "false", "aria-controls": "tray-panel" }, "");
    this.trayPanelEscape = (e) => {
      if (e.key !== "Escape" || this.lifted !== null) return;
      if (this.trayPanel.hidden) return;
      this.trayPanel.hidden = true;
      this.toggleBtn.setAttribute("aria-expanded", "false");
      this.toggleBtn.focus();
    };
    this.toggleBtn.addEventListener("click", () => {
      const open = this.trayPanel.hidden;
      this.trayPanel.hidden = !open;
      this.toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        this.trayPanel.querySelector("select")?.focus();
      }
    });
    this.node.append(this.toggleBtn);
    const head = el("div", { class: "tray-head" });
    this.switcher = el("select", { id: "tray-cluster", "aria-label": "Tray cluster" });
    this.switcher.addEventListener("change", () => {
      rememberTrayCluster(this.switcher.value);
      void this.loadCluster(this.switcher.value);
    });
    this.newBtn = el("button", { class: "btn small", id: "new-cluster-btn" }, "New cluster");
    this.newBtn.setAttribute("aria-label", "New cluster");
    this.newBtn.addEventListener("click", () => {
      const dialog = new NewClusterDialog(this.state, this.newBtn);
      dialog.open();
    });
    this.countEl = el("span", { class: "tray-count", id: "tray-count" }, "0 items");
    this.countEl.id = "tray-count";
    this.countEl.setAttribute("aria-label", "Item count");
    head.append(this.switcher, this.newBtn, this.countEl);
    this.trayPanel.append(head);
    this.list = el("ul", { class: "tray-list", id: "tray-list", "aria-label": "Cluster order" });
    this.trayPanel.append(this.list);
    this.trayPanel.addEventListener("keydown", (e) => this.trayPanelEscape(e));
    this.node.append(this.trayPanel);
    const announcements = el("div", { id: "tray-announcements", role: "status", class: "visually-hidden" });
    announcements.setAttribute("aria-live", "polite");
    document.body.append(announcements);
    window.addEventListener("rushes:cluster-chosen", (e) => {
      const { clusterId } = e.detail;
      rememberTrayCluster(clusterId);
      void this.loadClusters(clusterId);
    });
    window.addEventListener("rushes:cluster-updated", (e) => {
      const { clusterId } = e.detail;
      if (this.cluster?.id === clusterId) void this.loadCluster(clusterId);
    });
    const applyViewport = () => {
      const toggle = this.toggleBtn;
      if (!toggle) return;
      const wide = window.innerWidth >= 720;
      toggle.hidden = wide;
      if (wide) {
        this.trayPanel.hidden = false;
      } else {
        this.trayPanel.hidden = toggle.getAttribute("aria-expanded") !== "true";
      }
    };
    window.addEventListener("resize", applyViewport);
    applyViewport();
    void this.loadClusters(recalledTrayCluster());
  }
  async loadClusters(preferred) {
    const r = await api("GET", `/api/workspaces/${this.state.slug}/clusters`);
    if (!r.ok) return;
    const clusters = r.data.clusters;
    this.switcher.replaceChildren();
    for (const c of clusters) {
      const opt = el("option", { value: c.id }, c.title);
      this.switcher.append(opt);
    }
    let target = preferred && clusters.some((c) => c.id === preferred) ? preferred : clusters[0]?.id ?? null;
    if (target) {
      this.switcher.value = target;
      rememberTrayCluster(target);
      await this.loadCluster(target);
    }
  }
  async loadCluster(clusterId) {
    const r = await api("GET", `/api/clusters/${clusterId}`);
    if (!r.ok) {
      this.cluster = null;
      return;
    }
    this.cluster = r.data;
    this.items = [...r.data.entries];
    this.switcher.value = clusterId;
    this.renderItems();
  }
  updateCount() {
    const n = this.items.length;
    this.countEl.textContent = `${n} items`;
    if (this.toggleBtn) {
      this.toggleBtn.replaceChildren();
      const prefix = el("span", { class: "visually-hidden" }, "Cluster tray: ");
      const label = el("span", {}, `${this.cluster?.title ?? ""} \xB7 ${n} items`);
      this.toggleBtn.append(prefix, label);
    }
  }
  renderItems() {
    this.list.replaceChildren();
    this.updateCount();
    this.items.forEach((entry, i) => {
      this.list.append(this.itemRow(entry, i + 1));
    });
  }
  itemRow(entry, slot) {
    const li = el("li", {
      class: `tray-item${this.lifted === entry.id ? " lifted" : ""}${this.lifted === entry.id ? " active-slot" : ""}`,
      "data-entry-id": entry.id
    });
    const slotEl = el("span", { class: "tray-slot mono" }, String(slot));
    const grip = el("button", { class: "grip", "aria-label": `Reorder ${entry.reference.title}`, type: "button" }, "\u283F");
    grip.setAttribute("tabindex", "0");
    const thumbSrc = entry.reference.kind === "clip" ? "" : entry.reference.mediaUrl;
    const thumb = thumbSrc ? el("img", { class: "tray-thumb", src: thumbSrc, alt: "" }) : el("span", { class: "tray-thumb" }, "\u25B6");
    const titleWrap = el("div", { class: "tray-item-title" });
    titleWrap.append(el("div", {}, entry.reference.title));
    if (entry.reference.kind === "still" && entry.reference.sourceClipTitle && entry.reference.timecode) {
      titleWrap.append(el("div", { class: "tray-item-sub" }, `${entry.reference.sourceClipTitle} \xB7 ${entry.reference.timecode}`));
    }
    li.append(slotEl, grip, thumb, titleWrap);
    if (entry.isPrivate) li.append(el("span", { class: "private-tag" }, "Private"));
    grip.addEventListener("keydown", (e) => this.handleKey(e, entry, grip));
    grip.addEventListener("pointerdown", (e) => this.startDrag(e, entry, li, grip));
    return li;
  }
  handleKey(e, entry, grip) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (this.lifted === null) {
        this.lift(entry, grip);
      } else {
        void this.drop(entry, grip);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (this.lifted !== null) {
        this.cancelMove(grip);
      }
      return;
    }
    if (this.lifted !== null && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? -1 : 1;
      this.step(entry, dir);
    }
  }
  lift(entry, grip) {
    this.lifted = entry.id;
    const pos = this.items.findIndex((x) => x.id === entry.id) + 1;
    announce("tray-announcements", `Lifted ${entry.reference.title}, position ${pos} of ${this.items.length}. Use arrow keys to move, Space to drop, Escape to cancel.`);
    this.renderItems();
    const g = this.gripFor(entry.id);
    (g ?? grip).focus();
  }
  step(entry, dir) {
    const idx = this.items.findIndex((x) => x.id === entry.id);
    const next = idx + dir;
    if (next < 0 || next >= this.items.length) return;
    const copy = [...this.items];
    const [item] = copy.splice(idx, 1);
    copy.splice(next, 0, item);
    this.items = copy;
    announce("tray-announcements", `${entry.reference.title}, position ${next + 1} of ${this.items.length}.`);
    this.renderItems();
    const g = this.gripFor(entry.id);
    g?.focus();
  }
  cancelMove(grip) {
    const id = this.lifted;
    this.lifted = null;
    if (this.cluster && id) {
      void this.loadCluster(this.cluster.id).then(() => {
        const entry = this.cluster?.entries.find((e) => e.id === id);
        const pos = this.cluster?.entries.findIndex((e) => e.id === id) ?? 0;
        if (entry) {
          announce("tray-announcements", `Move cancelled. ${entry.reference.title} is back at position ${pos + 1} of ${this.cluster?.entries.length}.`);
        }
        const g = this.gripFor(id);
        g?.focus();
      });
    } else {
      this.renderItems();
      grip?.focus();
    }
  }
  async drop(entry, grip) {
    const target = this.items.findIndex((x) => x.id === entry.id) + 1;
    const clusterId = this.cluster?.id;
    const version = this.cluster?.version;
    this.lifted = null;
    if (!clusterId || version === void 0) return;
    const r = await api(
      "POST",
      `/api/clusters/${clusterId}/entries/${entry.id}/move`,
      { toPosition: target, version }
    );
    if (r.ok && r.data) {
      announce("tray-announcements", `Moved ${entry.reference.title} to position ${target} of ${this.items.length}. Order saved.`);
      await this.loadCluster(clusterId);
      const g2 = this.gripFor(entry.id);
      g2?.focus();
      return;
    }
    const err = r.error;
    if (err?.error === "stale_order") {
      const version2 = err.version;
      const ids = err.entryIds ?? [];
      announce("tray-announcements", "The order changed elsewhere. Showing the latest order.");
      if (this.cluster) {
        const byId = new Map(this.items.map((x) => [x.id, x]));
        this.items = ids.map((id) => byId.get(id)).filter((x) => Boolean(x));
        this.cluster.version = version2 ?? this.cluster.version;
        this.renderItems();
      }
      const g2 = this.gripFor(entry.id);
      g2?.focus();
      return;
    }
    if (err?.error === "cluster_locked") {
      announce("tray-announcements", `${this.cluster?.title} is locked while ${this.cluster?.status}. The order is unchanged.`);
      void this.loadCluster(clusterId);
      const g2 = this.gripFor(entry.id);
      g2?.focus();
      return;
    }
    announce("tray-announcements", "The order could not be saved. Try again.");
    void this.loadCluster(clusterId);
    const g = this.gripFor(entry.id);
    g?.focus();
  }
  gripFor(entryId) {
    return this.list.querySelector(`li[data-entry-id="${entryId}"] .grip`);
  }
  // --- Drag reorder ------------------------------------------------------
  dragging = null;
  startDrag(e, entry, li, grip) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const from = this.items.findIndex((x) => x.id === entry.id);
    this.dragging = { entryId: entry.id, from, placeholder: el("li", { class: "tray-item", "data-placeholder": "true" }, "\u2026") };
    li.classList.add("lifted");
    grip.setPointerCapture(e.pointerId);
    const move = (ev) => this.dragMove(ev);
    const up = (ev) => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", cancel);
      this.dragEnd(ev, entry, grip);
    };
    const cancel = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", cancel);
      this.cancelDrag(entry, grip);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", cancel);
    e.preventDefault();
  }
  dragMove(e) {
    const y = e.clientY;
    const rows = Array.from(this.list.querySelectorAll("li[data-entry-id]"));
    let insertBefore = null;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        insertBefore = row;
        break;
      }
    }
    const ph = this.dragging?.placeholder;
    if (!ph) return;
    if (insertBefore) this.list.insertBefore(ph, insertBefore);
    else this.list.append(ph);
  }
  dragEnd(_e, entry, grip) {
    const ph = this.dragging?.placeholder;
    const dropIndex = ph ? Array.from(this.list.children).indexOf(ph) : -1;
    ph?.remove();
    this.dragging = null;
    const copy = [...this.items];
    const from = copy.findIndex((x) => x.id === entry.id);
    if (dropIndex === from) {
      this.renderItems();
      grip.focus();
      return;
    }
    if (from === -1 || dropIndex === -1) {
      this.renderItems();
      return;
    }
    const to = dropIndex > from ? dropIndex : dropIndex;
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    this.items = copy;
    this.renderItems();
    void this.sendMove(entry, to + 1, grip);
  }
  cancelDrag(entry, grip) {
    this.dragging?.placeholder.remove();
    this.dragging = null;
    this.renderItems();
    grip.focus();
  }
  async sendMove(entry, toPosition, grip) {
    const clusterId = this.cluster?.id;
    const version = this.cluster?.version;
    if (!clusterId || version === void 0) return;
    const r = await api(
      "POST",
      `/api/clusters/${clusterId}/entries/${entry.id}/move`,
      { toPosition, version }
    );
    if (r.ok && r.data) {
      announce("tray-announcements", `Moved ${entry.reference.title} to position ${toPosition} of ${this.items.length}. Order saved.`);
      await this.loadCluster(clusterId);
      grip.focus();
      return;
    }
    const err = r.error;
    if (err?.error === "stale_order") {
      announce("tray-announcements", "The order changed elsewhere. Showing the latest order.");
      const byId = new Map(this.items.map((x) => [x.id, x]));
      this.items = (err.entryIds ?? []).map((id) => byId.get(id)).filter((x) => Boolean(x));
      if (this.cluster) this.cluster.version = err.version ?? this.cluster.version;
      this.renderItems();
    } else if (err?.error === "cluster_locked") {
      announce("tray-announcements", `${this.cluster?.title} is locked while ${this.cluster?.status}. The order is unchanged.`);
      await this.loadCluster(clusterId);
    } else {
      announce("tray-announcements", "The order could not be saved. Try again.");
      await this.loadCluster(clusterId);
    }
    grip.focus();
  }
};

// src/client/screens/wall.ts
var TRAY_KEY = "rushes.activeCluster";
async function renderWall(slug, params) {
  const acc = session()?.account ?? null;
  if (!acc) {
    navigate(`/signin?next=${encodeURIComponent(`/w/${slug}`)}`, true);
    return el("div");
  }
  const wsRes = await api("GET", `/api/workspaces/${slug}`);
  if (!wsRes.ok) return notFoundPage();
  const workspace = wsRes.data;
  const state = {
    slug,
    workspace,
    references: [],
    clusters: [],
    query: params.get("q"),
    trayCluster: null,
    strip: null
  };
  const page = el("div", { class: "wall-page" });
  page.append(topBar({ account: acc, currentSlug: slug }));
  const tools = el("div", { class: "wall-tools" });
  const searchForm = el("form", { role: "search", class: "search-wrap", id: "wall-search" });
  const searchBox = el("input", {
    type: "search",
    id: "wall-search-box",
    placeholder: "Search this brand",
    value: state.query ?? "",
    "aria-label": "Search references and clusters"
  });
  const searchStatus = el("div", { id: "search-status", role: "status", class: "visually-hidden" });
  searchStatus.setAttribute("aria-live", "polite");
  searchForm.append(searchBox, searchStatus);
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = searchBox.value;
    if (q.length >= 101) {
      document.getElementById("wall-error-summary")?.remove();
      const summary = errorSummary({ q: "Enter 1 to 100 characters." }, { q: "wall-search-box" });
      summary.id = "wall-error-summary";
      searchForm.before(summary);
      summary.focus();
      markInvalid(searchBox, "Enter 1 to 100 characters.");
      return;
    }
    runSearch(q, true);
  });
  tools.append(searchForm);
  const uploadBtn = el("button", { class: "btn", id: "upload-btn" }, "Upload");
  uploadBtn.setAttribute("aria-label", "Upload references");
  uploadBtn.addEventListener("click", () => uploadFlow(state));
  tools.append(uploadBtn);
  const wallAnnouncements = el("div", { id: "wall-announcements", role: "status", class: "visually-hidden" });
  wallAnnouncements.setAttribute("aria-live", "polite");
  tools.append(wallAnnouncements);
  const layout = el("div", { class: "wall-layout" });
  const main = el("div", { class: "wall-main" });
  const resultsRegion = el("section", { id: "search-results", "aria-label": "Search results", class: "stack" });
  const wallRegion = el("section", { id: "reference-wall", "aria-label": "Reference wall" });
  const masonry = el("div", { class: "masonry" });
  const list = el("ul", { id: "references-list", "aria-label": "References" });
  masonry.append(list);
  wallRegion.append(masonry);
  main.append(tools, resultsRegion, wallRegion);
  const tray = new Tray(state);
  layout.append(main, tray.node);
  page.append(layout);
  let searchTimer;
  let searchSeq = 0;
  async function runSearch(q, commit) {
    const trimmed = q;
    if (trimmed.length >= 101) {
      searchStatus.textContent = "Enter 1 to 100 characters.";
      announce("search-field-error", "Enter 1 to 100 characters.");
      return;
    }
    if (trimmed === "") {
      const seq2 = ++searchSeq;
      state.query = null;
      resultsRegion.replaceChildren();
      resultsRegion.hidden = true;
      wallRegion.hidden = false;
      searchStatus.textContent = "";
      history.replaceState(null, "", `/w/${slug}`);
      await loadReferences();
      return;
    }
    searchStatus.textContent = "Searching...";
    const thisQuery = trimmed;
    const seq = ++searchSeq;
    const r = await api(
      "GET",
      `/api/workspaces/${slug}/search?q=${encodeURIComponent(thisQuery)}`
    );
    if (seq !== searchSeq) return;
    if (thisQuery !== searchBox.value) return;
    if (!r.ok) {
      searchStatus.textContent = "The search could not run. Try again.";
      return;
    }
    const data = r.data;
    state.query = thisQuery;
    wallRegion.hidden = true;
    resultsRegion.hidden = false;
    resultsRegion.replaceChildren();
    const clusterHeading = el("h2", { id: "cluster-count" }, `${data.counts.clusters} clusters`);
    const clusterList = el("ul", { class: "search-clusters stack" });
    for (const c of data.clusters) {
      clusterList.append(el(
        "li",
        {},
        link(`/w/${slug}/clusters/${c.id}`, c.title, "search-cluster-link"),
        el("span", { class: "muted small" }, `${STATUS_LABELS[c.status] ?? c.status} \xB7 ${c.itemCount} items`)
      ));
    }
    const refHeading = el("h2", { id: "ref-count" }, `${data.counts.references} references`);
    const refList = el("ul", { class: "search-refs stack" });
    for (const ref of data.references) {
      refList.append(el("li", {}, referenceCard(state, ref)));
    }
    resultsRegion.append(clusterHeading, clusterList, refHeading, refList);
    const summary = data.counts.clusters === 0 && data.counts.references === 0 ? `Nothing in ${workspace.name} matches ${thisQuery}.` : `${data.counts.clusters} clusters and ${data.counts.references} references match ${thisQuery}.`;
    searchStatus.textContent = summary;
    if (commit) {
      history.replaceState(null, "", `/w/${slug}?q=${encodeURIComponent(thisQuery)}`);
    } else if (state.query !== null) {
      history.replaceState(null, "", `/w/${slug}?q=${encodeURIComponent(thisQuery)}`);
    }
  }
  searchBox.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    const q = searchBox.value;
    if (q.length >= 101) {
      searchStatus.textContent = "Enter 1 to 100 characters.";
      return;
    }
    searchTimer = window.setTimeout(() => {
      void runSearch(searchBox.value, false);
    }, 250);
  });
  if (state.query !== null && state.query !== "") {
    await runSearch(state.query, false);
  } else {
    resultsRegion.hidden = true;
    await loadReferences();
  }
  async function loadReferences() {
    const r = await api("GET", `/api/workspaces/${slug}/references?limit=50`);
    if (r.ok) {
      state.references = r.data.items;
      renderWallCards(state, list);
    }
  }
  return page;
}
function renderWallCards(state, list) {
  list.replaceChildren();
  for (const ref of state.references) {
    list.append(el("li", {}, referenceCard(state, ref)));
  }
}
function referenceCard(state, ref) {
  const card = el("article", { class: "ref-card", "data-ref-id": ref.id });
  const isClip = ref.kind === "clip";
  const isStill = ref.kind === "still";
  let media;
  if (isClip) {
    const video = el("video", { src: ref.mediaUrl, preload: "metadata", muted: true });
    media = video;
  } else {
    const img = el("img", { src: ref.mediaUrl, alt: "", loading: "lazy" });
    img.addEventListener("error", () => {
      const note = el("div", { class: "ref-preview-unavailable" }, "Preview unavailable");
      img.replaceWith(note);
    });
    media = img;
  }
  card.append(media);
  const title = el("div", { class: "ref-title-full" }, ref.title);
  if (isClip) {
    title.append(el("span", { class: "clip-tag" }, ` \xB7 ${ref.totalFrames} frames`));
  }
  if (isStill && ref.sourceClipTitle && ref.timecode) {
    title.append(el("div", { class: "still-meta" }, `${ref.sourceClipTitle} \xB7 ${ref.timecode}`));
  }
  card.append(title);
  const actions = el("div", { class: "ref-actions" });
  const addBtn = el("button", { class: "btn small" }, "Add to cluster");
  addBtn.setAttribute("aria-label", `Add ${ref.title} to cluster`);
  addBtn.addEventListener("click", () => {
    const dialog = new AddToClusterDialog(state, ref, addBtn);
    dialog.open();
  });
  actions.append(addBtn);
  if (isClip) {
    const openBtn = el("button", { class: "btn small" }, "Open clip");
    openBtn.setAttribute("aria-label", `Open clip ${ref.title}`);
    openBtn.addEventListener("click", () => {
      openStrip(state, ref, openBtn);
    });
    actions.append(openBtn);
  }
  card.append(actions);
  return card;
}
function openStrip(state, clip, opener) {
  if (state.strip) {
    state.strip.close();
  }
  const strip = new SprocketStrip(state, clip, opener);
  state.strip = strip;
  strip.open();
}
async function uploadFlow(state) {
  const input = el("input", { type: "file", multiple: true, accept: "image/jpeg,image/png,image/webp,video/mp4,video/webm" });
  input.addEventListener("change", async () => {
    const files = Array.from(input.files ?? []);
    for (const file of files) {
      await uploadOne(state, file);
    }
  });
  input.click();
}
async function uploadOne(state, file) {
  const isClip = /\.(mp4|webm)$/i.test(file.name) || file.type.startsWith("video/");
  if (isClip) {
    const dialog = new ClipDetailsDialog(state, file);
    dialog.open();
    return;
  }
  announce("wall-announcements", `Uploading ${file.name}...`);
  const form = new FormData();
  form.append("file", file, file.name);
  const r = await api("POST", `/api/workspaces/${state.slug}/references`, form);
  if (r.ok && r.data) {
    state.references.unshift(r.data);
    const list = document.getElementById("references-list");
    if (list) {
      list.prepend(el("li", {}, referenceCard(state, r.data)));
    }
    announce("wall-announcements", `Uploaded ${r.data.title}.`);
  } else {
    const err = r.error;
    const code = err?.error;
    if (code === "storage_unavailable") {
      announce("wall-announcements", `Storage is unreachable. ${file.name} was not uploaded.`);
    } else if (code === "too_large") {
      announce("wall-announcements", `${file.name} is larger than the limit for its type.`);
    } else if (code === "unsupported_media_type") {
      announce("wall-announcements", `${file.name} is not a supported image or clip.`);
    } else if (code === "seat_required") {
      announce("wall-announcements", "You need a pro seat to make changes. Ask your design ops lead.");
    } else {
      announce("wall-announcements", `${file.name} was not uploaded.`);
    }
  }
}
function rememberTrayCluster(clusterId) {
  try {
    localStorage.setItem(TRAY_KEY, clusterId);
  } catch {
  }
}
function recalledTrayCluster() {
  try {
    return localStorage.getItem(TRAY_KEY);
  } catch {
    return null;
  }
}

// src/client/screens/settings.ts
var REFRESH_MS = 25e3;
async function renderSettings(slug, clusterId) {
  const acc = session()?.account ?? null;
  if (!acc) {
    navigate(`/signin?next=${encodeURIComponent(`/w/${slug}/clusters/${clusterId}`)}`, true);
    return el("div");
  }
  const page = el("div");
  const wsRes = await api("GET", `/api/workspaces/${slug}`);
  if (!wsRes.ok) return notFoundPage();
  const workspace = wsRes.data;
  const load = async () => api("GET", `/api/clusters/${clusterId}`);
  const first = await load();
  if (!first.ok) return notFoundPage();
  const wasJustCreated = window.sessionStorage.getItem("rushes.createdCluster") === clusterId;
  if (wasJustCreated) {
    window.sessionStorage.removeItem("rushes.createdCluster");
  }
  page.append(topBar({ account: acc, currentSlug: slug }));
  const main = el("main", { class: "two-col" });
  const left = el("section", { class: "stack", "aria-label": "Cluster details" });
  const right = el("section", { class: "stack", "aria-label": "Review and comments" });
  let cluster = first.data;
  const status = clusterStatusHeader();
  const detailsForm = el("form", { novalidate: true, class: "panel" });
  const titleInput = el("input", { type: "text", id: "set-title" });
  titleInput.setAttribute("aria-label", "Title");
  const publicDesc = el("textarea", { id: "set-public" });
  publicDesc.setAttribute("aria-label", "Public description");
  const internalNote = el("textarea", { id: "set-note" });
  internalNote.setAttribute("aria-label", "Internal note");
  const saveDetails = el("button", { type: "submit", class: "btn btn-primary" }, "Save details");
  saveDetails.setAttribute("aria-label", "Save details");
  detailsForm.append(
    formField("Title", titleInput),
    formField("Public description", publicDesc),
    formField("Internal note", internalNote),
    el("div", {}, saveDetails)
  );
  const typed = { title: "", publicDescription: "", internalNote: "", comment: "" };
  function syncFieldsFromCluster() {
    if (document.activeElement !== titleInput && !typed.title) titleInput.value = cluster.title;
    if (document.activeElement !== publicDesc && !typed.publicDescription) publicDesc.value = cluster.publicDescription;
    if (document.activeElement !== internalNote && !typed.internalNote) internalNote.value = cluster.internalNote;
  }
  titleInput.addEventListener("input", () => {
    typed.title = titleInput.value;
  });
  publicDesc.addEventListener("input", () => {
    typed.publicDescription = publicDesc.value;
  });
  internalNote.addEventListener("input", () => {
    typed.internalNote = internalNote.value;
  });
  detailsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearInvalid(detailsForm);
    saveDetails.disabled = true;
    const patch = {};
    if (typed.title || titleInput.value !== cluster.title) patch.title = titleInput.value;
    if (typed.publicDescription || publicDesc.value !== cluster.publicDescription) patch.publicDescription = publicDesc.value;
    if (typed.internalNote || internalNote.value !== cluster.internalNote) patch.internalNote = internalNote.value;
    const r = await api("PATCH", `/api/clusters/${clusterId}`, patch);
    saveDetails.disabled = false;
    if (r.ok && r.data) {
      cluster = r.data;
      typed.title = "";
      typed.publicDescription = "";
      typed.internalNote = "";
      syncFieldsFromCluster();
      announce("cluster-status", "Details saved.");
      return;
    }
    const errors = r.error?.errors ?? {};
    if (Object.keys(errors).length > 0) {
      detailsForm.prepend(errorSummary(errors, { title: "set-title", publicDescription: "set-public", internalNote: "set-note" }));
      document.getElementById("error-summary")?.focus();
      for (const [field, message] of Object.entries(errors)) {
        if (field === "title") markInvalid(titleInput, message);
        if (field === "publicDescription") markInvalid(publicDesc, message);
        if (field === "internalNote") markInvalid(internalNote, message);
      }
    } else if (r.error?.error === "cluster_locked") {
      announce("cluster-status", `This cluster is locked while ${STATUS_LABELS[cluster.status]}.`);
    }
  });
  const entriesList = el("ul", { class: "stack" });
  const statusPanel = el("section", { class: "panel stack" });
  const actionsRow = el("div", { class: "row", role: "group", "aria-label": "Status actions" });
  const embargoForm = el("form", { class: "stack", hidden: true, novalidate: true });
  const liftDate = el("input", { type: "date", id: "lift-date" });
  liftDate.setAttribute("aria-label", "Lift date");
  const liftTime = el("input", { type: "time", id: "lift-time" });
  liftTime.setAttribute("aria-label", "Lift time");
  const setEmbargo = el("button", { type: "submit", class: "btn btn-primary" }, "Set embargo");
  const embargoSummary = el("p", { class: "muted small mono" });
  embargoForm.append(
    el("div", { class: "row" }, formField("Lift date", liftDate), formField("Lift time", liftTime)),
    el("p", { class: "muted small" }, `Times are in ${workspace.timeZone}`),
    el("div", {}, setEmbargo),
    embargoSummary
  );
  statusPanel.append(status, actionsRow, embargoForm);
  const withdrawDialog = el("dialog", { class: "dialog", "aria-label": "Withdraw cluster" });
  withdrawDialog.append(
    el("h2", {}, "Withdraw cluster"),
    el("p", {}, "Withdrawing removes the public page and feed entry now."),
    el(
      "div",
      { class: "row" },
      el("button", { class: "btn btn-primary", id: "withdraw-confirm" }, "Withdraw"),
      el("button", { class: "btn btn-ghost", id: "withdraw-cancel" }, "Cancel")
    )
  );
  const withdrawBtnHolder = { btn: null };
  document.body.append(withdrawDialog);
  const linksPanel = el("section", { class: "panel stack", "aria-label": "Review links" });
  const linkForm = el("form", { class: "stack", novalidate: true });
  const freelancerEmail = el("input", { type: "email", id: "rl-email" });
  freelancerEmail.setAttribute("aria-label", "Freelancer email");
  const expires = el("input", { type: "datetime-local", id: "rl-expires", step: "60" });
  expires.setAttribute("aria-label", "Expires");
  const allowComments = el("input", { type: "checkbox", id: "rl-comments" });
  const createLink = el("button", { type: "submit", class: "btn btn-primary" }, "Create review link");
  createLink.setAttribute("aria-label", "Create review link");
  linkForm.append(
    formField("Freelancer email", freelancerEmail),
    formField("Expires", expires),
    el("label", { for: "rl-comments", class: "row" }, allowComments, el("span", {}, "Allow comments")),
    el("div", {}, createLink),
    el("p", { class: "muted small" }, "Expiry times are in UTC")
  );
  const linksList = el("ul", { class: "stack" });
  linksPanel.append(el("h3", {}, "Review links"), linkForm, linksList);
  const commentsPanel = el("section", { class: "panel stack", "aria-label": "Comments" });
  const commentList = el("ul", { class: "stack" });
  const commentForm = el("form", { class: "stack", novalidate: true });
  const commentBox = el("textarea", { id: "cluster-comment" });
  commentBox.setAttribute("aria-label", "Comment");
  const postComment = el("button", { type: "submit", class: "btn btn-primary" }, "Post comment");
  postComment.setAttribute("aria-label", "Post comment");
  commentForm.append(formField("Comment", commentBox), el("div", {}, postComment));
  commentsPanel.append(el("h3", {}, "Comments"), commentList, commentForm);
  const downloadLink = el("a", { href: `/api/clusters/${clusterId}/export.csv`, class: "btn btn-ghost", download: "" }, "Download cluster sheet");
  downloadLink.setAttribute("aria-label", "Download cluster sheet");
  left.append(detailsForm, statusPanel, el("section", { class: "panel stack" }, el("h3", {}, "Entries"), entriesList), downloadLink);
  right.append(linksPanel, commentsPanel);
  main.append(left, right);
  page.append(main);
  const statusLive = el("div", { id: "cluster-status", role: "status", class: "visually-hidden" });
  statusLive.setAttribute("aria-live", "polite");
  document.body.append(statusLive);
  function statusActionsFor(c) {
    const acts = [];
    if (c.status === "draft") acts.push({ label: "Send to review", to: "in_review" });
    if (c.status === "in_review") {
      acts.push({ label: "Back to draft", to: "draft" });
      acts.push({ label: "Schedule embargo", to: "embargoed" });
    }
    if (c.status === "embargoed") acts.push({ label: "Cancel embargo", to: "in_review" });
    if (c.status === "public") acts.push({ label: "Withdraw cluster", to: "withdrawn" });
    return acts;
  }
  function clusterStatusHeader() {
    const wrap = el("div", { class: "spread" });
    const label = el("span", { class: "status-label", id: "cluster-status-label", tabindex: "-1", role: "status" });
    const icons = {
      draft: "icon-pencil",
      in_review: "icon-eye",
      embargoed: "icon-clock",
      public: "icon-globe",
      withdrawn: "icon-archived"
    };
    label.setAttribute("aria-label", "Status");
    wrap.append(label, el("span", { class: "visually-hidden" }, "Saving"));
    return wrap;
  }
  function renderStatus(showing, saving = false) {
    const label = status.querySelector("#cluster-status-label");
    label.replaceChildren();
    const icons = {
      draft: "icon-pencil",
      in_review: "icon-eye",
      embargoed: "icon-clock",
      public: "icon-globe",
      withdrawn: "icon-archived"
    };
    label.append(el("span", { class: `icon ${icons[showing] ?? ""}`, "aria-hidden": "true" }), STATUS_LABELS[showing] ?? showing);
    if (saving) label.append(el("span", { class: "saving-tag" }, "Saving"));
  }
  let lastRenderedStatus = "";
  function renderActions(c) {
    if (c.status === lastRenderedStatus && actionsRow.childElementCount > 0) {
      return;
    }
    lastRenderedStatus = c.status;
    actionsRow.replaceChildren();
    const acts = statusActionsFor(c);
    for (const act of acts) {
      const btn = el("button", { class: "btn", type: "button" }, act.label);
      if (act.to === "embargoed") {
        btn.addEventListener("click", () => {
          embargoForm.hidden = false;
          liftDate.focus();
        });
      } else if (act.to === "withdrawn") {
        btn.addEventListener("click", () => {
          withdrawBtnHolder.btn = btn;
          withdrawDialog.showModal();
        });
        btn.setAttribute("aria-label", "Withdraw cluster");
      } else {
        btn.addEventListener("click", () => void doStatusAction(act.to, act.label, btn, null));
      }
      actionsRow.append(btn);
    }
  }
  async function doStatusAction(to, label, btn, extra) {
    const before = cluster.status;
    renderStatus(to, true);
    if (btn) btn.disabled = true;
    const body = { status: to, ...extra ?? {} };
    const r = await api("POST", `/api/clusters/${clusterId}/status`, body);
    if (btn) btn.disabled = false;
    if (r.ok && r.data) {
      cluster = r.data;
      renderAll();
      if (to === "in_review") {
        if (before === "embargoed") announce("cluster-status", "Embargo cancelled. Back in review.");
        else announce("cluster-status", "Sent to review.");
      } else if (to === "draft") {
        announce("cluster-status", "Back to draft. Review links are no longer active.");
      } else if (to === "embargoed") {
        announce("cluster-status", `Embargo set. Goes public at ${cluster.liftLocal.replace("T", " ")} ${workspace.timeZone}.`);
      } else if (to === "withdrawn") {
        announce("cluster-status", "Withdrawn. The public page is gone.");
      }
      focusStatus();
      return;
    }
    const err = r.error;
    if (err?.error === "illegal_transition") {
      cluster = { ...cluster, status: err.from ?? before };
      renderAll();
      announce("cluster-status", `This cluster is now ${STATUS_LABELS[err.from ?? before]}. Refresh to see its current state.`);
      focusStatus();
      return;
    }
    if (err?.error === "validation") {
      const errors = err.errors ?? {};
      const form = to === "embargoed" ? embargoForm : detailsForm;
      form.prepend(errorSummary(errors, { liftLocal: "lift-date", liftTime: "lift-time" }));
      document.getElementById("error-summary")?.focus();
      if (errors.liftLocal) {
        markInvalid(liftDate, errors.liftLocal);
        markInvalid(liftTime, errors.liftLocal);
      }
      renderStatus(before);
      return;
    }
    renderStatus(before);
    renderAll();
    announce("cluster-status", "The status change could not be saved. Try again.");
    focusStatus();
  }
  function focusStatus() {
    status.querySelector("#cluster-status-label")?.setAttribute("tabindex", "-1");
    status.querySelector("#cluster-status-label").focus();
  }
  let lastEntriesKey = "";
  function renderEntries(c) {
    const key = c.entries.map((e) => `${e.id}:${e.isPrivate ? 1 : 0}`).join("|") + `#${c.version}`;
    if (key === lastEntriesKey) return;
    lastEntriesKey = key;
    entriesList.replaceChildren();
    c.entries.forEach((entry) => {
      const li = el("li", { class: "tray-item" });
      const slot = el("span", { class: "tray-slot mono" }, String(entry.position));
      const thumb = entry.reference.kind === "clip" ? el("span", { class: "tray-thumb" }, "\u25B6") : el("img", { class: "tray-thumb", src: entry.reference.mediaUrl, alt: "" });
      const title = el("div", { class: "tray-item-title" }, entry.reference.title);
      if (entry.reference.kind === "still" && entry.reference.sourceClipTitle) {
        title.append(el("div", { class: "tray-item-sub" }, `${entry.reference.sourceClipTitle} \xB7 ${entry.reference.timecode}`));
      }
      const check = el("input", { type: "checkbox", id: `private-${entry.id}` });
      check.checked = entry.isPrivate;
      check.setAttribute("aria-label", `Keep ${entry.reference.title} private`);
      check.addEventListener("change", async () => {
        const rr = await api(
          "PATCH",
          `/api/clusters/${clusterId}/entries/${entry.id}`,
          { isPrivate: check.checked }
        );
        if (rr.ok) {
          announce("cluster-status", check.checked ? "Entry is private." : "Entry is public.");
          void refresh();
        } else if (rr.error?.error === "cluster_locked") {
          announce("cluster-status", `This cluster is locked while ${STATUS_LABELS[cluster.status]}.`);
          check.checked = !check.checked;
        } else {
          check.checked = !check.checked;
        }
      });
      li.append(slot, thumb, title, el("label", { class: "row small", for: `private-${entry.id}` }, check, el("span", {}, "Private")));
      entriesList.append(li);
    });
  }
  function renderLinks(c) {
    return api("GET", `/api/clusters/${clusterId}/review-links`).then((r) => {
      if (!r.ok) return;
      linksList.replaceChildren();
      for (const l of r.data.links) {
        const li = el("li", { class: "tray-item" });
        li.append(
          el("div", { class: "tray-item-title" }, l.email),
          el("span", { class: "state-tag" }, el("span", { class: "icon icon-clock", "aria-hidden": "true" }), l.state === "live" ? "Live" : l.state === "expired" ? "Expired" : l.state === "revoked" ? "Revoked" : "Inactive")
        );
        const revoke = el("button", { class: "btn small" }, "Revoke");
        revoke.setAttribute("aria-label", `Revoke link for ${l.email}`);
        revoke.addEventListener("click", async () => {
          const rr = await api("DELETE", `/api/review-links/${l.id}`);
          if (rr.ok) {
            announce("cluster-status", `Link for ${l.email} revoked.`);
            void refresh();
          }
        });
        li.append(revoke);
        if (l.state === "live") {
          const regen = el("button", { class: "btn small" }, "Regenerate");
          regen.setAttribute("aria-label", `Regenerate link for ${l.email}`);
          regen.addEventListener("click", async () => {
            const rr = await api("POST", `/api/review-links/${l.id}/regenerate`);
            if (rr.ok) {
              announce("cluster-status", `New link sent to ${l.email}. The old link no longer works.`);
              void refresh();
            } else if (rr.error?.error === "mail_unavailable") {
              announce("cluster-status", "The new link could not be sent. The current link still works.");
            }
          });
          li.append(regen);
        }
        linksList.append(li);
      }
    });
  }
  async function renderComments() {
    const r = await api("GET", `/api/clusters/${clusterId}/comments`);
    if (!r.ok) return;
    commentList.replaceChildren();
    for (const c of r.data.comments) {
      const li = el("li", { class: "panel" });
      li.append(el("div", { class: "spread" }, el("strong", {}, c.authorName), el("span", { class: "muted small mono" }, c.createdAt.replace("T", " ").slice(0, 16))));
      li.append(el("p", { class: "mt" }, c.body));
      commentList.append(li);
    }
  }
  function renderEmbargoSummary() {
    if (cluster.status === "embargoed" && cluster.liftLocal && cluster.liftsAt) {
      embargoSummary.textContent = `Goes public at ${cluster.liftLocal.replace("T", " ")} ${workspace.timeZone} (${cluster.liftsAt.replace("T", " ").slice(0, 16)} UTC)`;
      embargoForm.hidden = false;
    } else if (cluster.status === "public" && cluster.liftLocal && cluster.liftsAt) {
      embargoSummary.textContent = `Goes public at ${cluster.liftLocal.replace("T", " ")} ${workspace.timeZone} (${cluster.liftsAt.replace("T", " ").slice(0, 16)} UTC)`;
    } else {
      embargoSummary.textContent = "";
    }
  }
  function renderAll() {
    renderStatus(cluster.status);
    renderActions(cluster);
    renderEntries(cluster);
    renderEmbargoSummary();
    syncFieldsFromCluster();
    void renderLinks(cluster);
  }
  embargoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearInvalid(embargoForm);
    const liftLocal = `${liftDate.value}T${liftTime.value}`;
    await doStatusAction("embargoed", "Schedule embargo", null, { liftLocal });
  });
  withdrawDialog.querySelector("#withdraw-confirm").addEventListener("click", async () => {
    withdrawDialog.close();
    await doStatusAction("withdrawn", "Withdraw cluster", null, null);
  });
  withdrawDialog.querySelector("#withdraw-cancel").addEventListener("click", () => {
    withdrawDialog.close();
    withdrawBtnHolder.btn?.focus();
  });
  withdrawDialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    withdrawDialog.close();
    withdrawBtnHolder.btn?.focus();
  });
  linkForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearInvalid(linkForm);
    createLink.disabled = true;
    const raw = expires.value;
    const expiresAt = raw ? `${raw}:00.000Z` : "";
    const r = await api("POST", `/api/clusters/${clusterId}/review-links`, {
      email: freelancerEmail.value,
      expiresAt,
      canComment: allowComments.checked
    });
    createLink.disabled = false;
    if (r.ok && r.data) {
      announce("cluster-status", `Review link sent to ${r.data.email}.`);
      freelancerEmail.value = "";
      void refresh();
      return;
    }
    const errors = r.error?.errors ?? {};
    if (Object.keys(errors).length > 0) {
      linkForm.prepend(errorSummary(errors, { email: "rl-email", expiresAt: "rl-expires" }));
      document.getElementById("error-summary")?.focus();
      if (errors.email) markInvalid(freelancerEmail, errors.email);
      if (errors.expiresAt) markInvalid(expires, errors.expiresAt);
    } else if (r.error?.error === "mail_unavailable") {
      announce("cluster-status", "The review email could not be sent. No link was created.");
    } else if (r.error?.error === "cluster_not_in_review") {
      announce("cluster-status", "Review links need a cluster in review.");
    }
  });
  commentForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearInvalid(commentForm);
    postComment.disabled = true;
    const r = await api("POST", `/api/clusters/${clusterId}/comments`, { body: commentBox.value });
    postComment.disabled = false;
    if (r.ok && r.data) {
      typed.comment = "";
      commentBox.value = "";
      announce("cluster-status", "Comment posted.");
      await renderComments();
      return;
    }
    const errors = r.error?.errors ?? {};
    if (Object.keys(errors).length > 0) {
      commentForm.prepend(errorSummary(errors, { body: "cluster-comment" }));
      document.getElementById("error-summary")?.focus();
      if (errors.body) markInvalid(commentBox, errors.body);
    }
  });
  let refreshTimer;
  async function refresh() {
    const r = await load();
    if (!r.ok) return;
    cluster = r.data;
    renderStatus(cluster.status);
    renderActions(cluster);
    renderEntries(cluster);
    renderEmbargoSummary();
    syncFieldsFromCluster();
    await renderLinks(cluster);
  }
  function scheduleRefresh() {
    window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      void refresh();
    }, REFRESH_MS);
  }
  scheduleRefresh();
  renderAll();
  await renderComments();
  if (wasJustCreated) {
    announce("cluster-status", `Created ${cluster.title} as a draft.`);
  }
  return page;
}

// src/client/screens/admin.ts
async function renderAdmin(slug, params) {
  const acc = session()?.account ?? null;
  if (!acc) {
    navigate(`/signin?next=${encodeURIComponent(`/w/${slug}/admin`)}`, true);
    return el("div");
  }
  if (acc.role !== "ops_lead") return notFoundPage();
  const page = el("div");
  page.append(topBar({ account: acc, currentSlug: slug }));
  const main = el("main", { class: "two-col" });
  const left = el("section", { class: "stack" });
  const right = el("section", { class: "stack" });
  const meter = el("p", { class: "seat-meter mono" });
  meter.setAttribute("aria-label", "Seats");
  const stateTag = el("span", { class: "state-tag" });
  const seatPanel = el("section", { class: "panel stack", "aria-label": "Seats" });
  seatPanel.append(el("h3", {}, "Seats"), meter, stateTag);
  const planPanel = el("section", { class: "panel stack", "aria-label": "Plan" });
  planPanel.append(el("h3", {}, "Plan"), el("p", { class: "plan-current" }));
  const currentPlan = planPanel.querySelector(".plan-current");
  const upgradeForm = el("form", { class: "stack", novalidate: true });
  const radios = el("div", { role: "radiogroup", "aria-label": "Plan", class: "stack" });
  const upgradeBtn = el("button", { type: "submit", class: "btn btn-primary" }, "Upgrade plan");
  upgradeBtn.setAttribute("aria-label", "Upgrade plan");
  upgradeForm.append(radios, el("div", {}, upgradeBtn));
  planPanel.append(upgradeForm);
  const rosterPanel = el("section", { class: "panel stack", "aria-label": "Member roster" });
  const controls = el("div", { class: "roster-controls" });
  const seatFilter = el("div", { role: "radiogroup", "aria-label": "Show members", class: "row" });
  const sortSel = el("select", { id: "sort-members", "aria-label": "Sort members" });
  for (const [value, label] of [["name", "Name"], ["seat", "Seat"]]) {
    sortSel.append(el("option", { value }, label));
  }
  controls.append(seatFilter, sortSel);
  const initialSeat = params.get("seat");
  const initialSort = params.get("sort");
  let seat = initialSeat === "seated" || initialSeat === "unseated" ? initialSeat : "all";
  let sort = initialSort === "seat" ? "seat" : "name";
  for (const [value, label] of [["all", "All"], ["seated", "Seated"], ["unseated", "Without seat"]]) {
    const id = `seat-${value}`;
    const radio = el("input", { type: "radio", name: "seat-filter", id, value });
    radio.checked = seat === value;
    radio.addEventListener("change", () => {
      seat = value;
      pushHistory();
      renderRoster();
    });
    seatFilter.append(el("label", { for: id }, radio, el("span", {}, label)));
  }
  sortSel.value = sort;
  sortSel.addEventListener("change", () => {
    sort = sortSel.value;
    pushHistory();
    renderRoster();
  });
  function pushHistory() {
    const q = new URLSearchParams();
    if (seat !== "all") q.set("seat", seat);
    if (sort !== "name") q.set("sort", sort);
    const url = `/w/${slug}/admin${q.toString() ? `?${q.toString()}` : ""}`;
    history.pushState(null, "", url);
  }
  const table = el("table", { class: "members-table", "aria-label": "Members" });
  const thead = el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", {}, "Email"), el("th", {}, "Handle"), el("th", {}, "Seat")));
  const tbody = el("tbody");
  table.append(thead, tbody);
  rosterPanel.append(controls, table);
  const invitePanel = el("section", { class: "panel stack", "aria-label": "Invite a designer" });
  const inviteForm = el("form", { class: "stack", novalidate: true });
  const inviteEmail = el("input", { type: "email", id: "invite-email" });
  inviteEmail.setAttribute("aria-label", "Email");
  const inviteName = el("input", { type: "text", id: "invite-name" });
  inviteName.setAttribute("aria-label", "Display name");
  const inviteBtn = el("button", { type: "submit", class: "btn btn-primary" }, "Send invite");
  inviteBtn.setAttribute("aria-label", "Send invite");
  inviteForm.append(formField("Email", inviteEmail), formField("Display name", inviteName), el("div", {}, inviteBtn));
  const offboardPanel = el("section", { class: "panel stack", "aria-label": "Offboard a collaborator" });
  const offboardForm = el("form", { class: "stack", novalidate: true });
  const collabEmail = el("input", { type: "email", id: "collab-email" });
  const offboardBtn = el("button", { type: "submit", class: "btn btn-danger" }, "Revoke all review links");
  offboardBtn.setAttribute("aria-label", "Revoke all review links");
  offboardForm.append(formField("Collaborator email", collabEmail), el("div", {}, offboardBtn));
  invitePanel.append(el("h3", {}, "Invite a designer"), inviteForm);
  offboardPanel.append(el("h3", {}, "Offboard a collaborator"), offboardForm);
  left.append(rosterPanel);
  right.append(seatPanel, planPanel, invitePanel, offboardPanel);
  main.append(left, right);
  page.append(main);
  const adminStatus = el("div", { id: "admin-status", role: "status", class: "visually-hidden" });
  adminStatus.setAttribute("aria-live", "polite");
  document.body.append(adminStatus);
  let seats = null;
  let plan = null;
  async function loadAll() {
    const s = await api("GET", `/api/workspaces/${slug}/seats`);
    if (s.ok) seats = s.data;
    const p = await api("GET", `/api/workspaces/${slug}/plan`);
    if (p.ok) plan = p.data;
    renderMeter();
    renderPlan();
    renderRoster();
  }
  function renderMeter() {
    if (!seats) return;
    meter.textContent = `${seats.seatsUsed} of ${seats.seatCap} seats in use`;
    const used = seats.seatsUsed;
    const cap = seats.seatCap;
    stateTag.replaceChildren();
    const [word, icon] = used > cap ? ["Over cap", "icon-over"] : used === cap ? ["Full", "icon-full"] : ["Seats free", "icon-check"];
    stateTag.append(el("span", { class: `icon ${icon}`, "aria-hidden": "true" }), word);
  }
  function renderPlan() {
    if (!plan) return;
    currentPlan.replaceChildren(el("span", { class: "icon icon-check", "aria-hidden": "true" }), `Current plan: ${plan.planName}`);
    radios.replaceChildren();
    for (const u of plan.upgrades ?? []) {
      const id = `plan-${u.plan}`;
      const radio = el("input", { type: "radio", name: "plan-choice", id, value: u.plan });
      radios.append(el("label", { for: id, class: "row" }, radio, el("span", {}, `${u.planName} \xB7 `), el("span", { class: "mono" }, `$${u.monthlyPrice} per month`)));
    }
    if (radios.children.length === 0) {
      radios.append(el("p", { class: "muted" }, "No upgrades offered."));
    }
  }
  function renderRoster() {
    if (!seats) return;
    tbody.replaceChildren();
    let members = [...seats.members];
    if (seat === "seated") members = members.filter((m) => m.hasSeat);
    if (seat === "unseated") members = members.filter((m) => !m.hasSeat);
    const byName = (a, b) => a.displayName.localeCompare(b.displayName, void 0, { sensitivity: "base" });
    if (sort === "seat") {
      members.sort((a, b) => a.hasSeat === b.hasSeat ? byName(a, b) : a.hasSeat ? -1 : 1);
    } else {
      members.sort(byName);
    }
    for (const m of members) {
      const tr = el("tr");
      tr.append(el("td", {}, m.displayName), el("td", {}, m.email), el("td", {}, m.handle));
      const actionCell = el("td");
      const btn = m.hasSeat ? el("button", { class: "btn small", type: "button" }, `Free seat from ${m.displayName}`) : el("button", { class: "btn small", type: "button" }, `Assign seat to ${m.displayName}`);
      btn.setAttribute("aria-label", m.hasSeat ? `Free seat from ${m.displayName}` : `Assign seat to ${m.displayName}`);
      btn.addEventListener("click", () => void seatAction(m, btn));
      actionCell.append(btn);
      tr.append(actionCell);
      tbody.append(tr);
    }
  }
  async function seatAction(member, btn) {
    const before = seats.members.map((m) => ({ ...m }));
    const beforeUsed = seats.seatsUsed;
    member.hasSeat = !member.hasSeat;
    seats.seatsUsed += member.hasSeat ? 1 : -1;
    renderRoster();
    renderMeter();
    btn.disabled = true;
    const r = member.hasSeat ? await api("POST", `/api/workspaces/${slug}/seats`, { memberId: member.id }) : await api("DELETE", `/api/workspaces/${slug}/seats/${member.id}`);
    btn.disabled = false;
    if (r.ok && r.data) {
      await loadAll();
      announce("admin-status", member.hasSeat ? `Seat assigned to ${member.displayName}. ${r.data.seatsUsed} of ${r.data.seatCap} seats in use.` : `Seat freed from ${member.displayName}. ${r.data.seatsUsed} of ${r.data.seatCap} seats in use.`);
      const row = tbody.querySelector(`tr td button[aria-label="${member.hasSeat ? `Free seat from ${member.displayName}` : `Assign seat to ${member.displayName}`}"]`);
      row?.focus();
      return;
    }
    const err = r.error;
    if (err?.error === "no_seats_left") {
      announce("admin-status", "No seats left on this plan. Upgrade the plan or free a seat.");
      await loadAll();
      const row = tbody.querySelector(`tr td button[aria-label="Assign seat to ${member.displayName}"]`);
      row?.focus();
      return;
    }
    seats.members = before;
    seats.seatsUsed = beforeUsed;
    renderRoster();
    renderMeter();
    announce("admin-status", `The seat change could not be saved. ${beforeUsed} of ${seats.seatCap} seats in use.`);
  }
  upgradeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearInvalid(upgradeForm);
    const chosen = upgradeForm.querySelector('input[name="plan-choice"]:checked')?.value ?? "";
    if (!chosen) {
      upgradeForm.prepend(errorSummary({ plan: "Choose a plan to upgrade to." }, { plan: "plan-rushes-pro-10" }));
      document.getElementById("error-summary")?.focus();
      return;
    }
    upgradeBtn.disabled = true;
    announce("admin-status", "Upgrading plan...");
    const key = `upgrade-${slug}-${Date.now()}`;
    const r = await fetch(`/api/workspaces/${slug}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ plan: chosen })
    });
    upgradeBtn.disabled = false;
    const data = await r.json().catch(() => null);
    if (r.ok && data && "planName" in data) {
      announce("admin-status", `Plan upgraded to ${data.planName}. ${data.seatCap} seats available. Receipt sent to ${data.receiptSentTo}.`);
      await loadAll();
      return;
    }
    const err = data;
    if (err?.error === "billing_unavailable") {
      announce("admin-status", "Billing is unreachable. Your plan is unchanged.");
    } else if (err?.error === "mail_unavailable") {
      announce("admin-status", "The receipt email could not be sent, so the upgrade was cancelled. Your plan is unchanged.");
    } else if (err?.error === "idempotency_in_progress") {
      announce("admin-status", "This upgrade is already in progress.");
    } else if (err?.error === "validation") {
      announce("admin-status", "Choose a larger plan than the current one.");
    } else {
      announce("admin-status", "The upgrade could not be saved. Try again.");
    }
  });
  inviteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearInvalid(invitePanel);
    inviteBtn.disabled = true;
    const r = await api("POST", `/api/workspaces/${slug}/invites`, { email: inviteEmail.value, displayName: inviteName.value });
    inviteBtn.disabled = false;
    if (r.ok) {
      announce("admin-status", `Invite sent to ${inviteEmail.value}.`);
      inviteEmail.value = "";
      inviteName.value = "";
      return;
    }
    const errors = r.error?.errors ?? {};
    if (Object.keys(errors).length > 0) {
      inviteForm.prepend(errorSummary(errors, { email: "invite-email", displayName: "invite-name" }));
      document.getElementById("error-summary")?.focus();
      if (errors.email) markInvalid(inviteEmail, errors.email);
      if (errors.displayName) markInvalid(inviteName, errors.displayName);
    } else if (r.error?.error === "mail_unavailable") {
      announce("admin-status", "The invite email could not be sent. No invite was created.");
    }
  });
  offboardForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearInvalid(offboardPanel);
    offboardBtn.disabled = true;
    const r = await api("POST", `/api/workspaces/${slug}/collaborators/offboard`, { email: collabEmail.value });
    offboardBtn.disabled = false;
    if (r.ok && r.data) {
      announce("admin-status", `Revoked ${r.data.revoked} review links for ${r.data.email}.`);
      collabEmail.value = "";
      return;
    }
    const errors = r.error?.errors ?? {};
    if (Object.keys(errors).length > 0) {
      offboardForm.prepend(errorSummary(errors, { email: "collab-email" }));
      document.getElementById("error-summary")?.focus();
      if (errors.email) markInvalid(collabEmail, errors.email);
    }
  });
  await loadAll();
  return page;
}

// src/client/screens/explore.ts
async function renderExplore(params) {
  const acc = session()?.account ?? null;
  const page = el("div");
  page.append(topBar({ account: acc }));
  const main = el("main");
  main.append(el("h1", {}, "Explore"));
  const pagesParam = params.get("pages");
  let targetPages = 1;
  if (pagesParam !== null) {
    const n = Number(pagesParam);
    if (Number.isInteger(n) && n >= 2) targetPages = Math.min(MAX_EXPLORE_PAGES, n);
  }
  const status = el("div", { id: "feed-status", role: "status", class: "visually-hidden" });
  status.setAttribute("aria-live", "polite");
  const grid = el("div", { class: "feed-grid" });
  const feed = el("div", { role: "feed", class: "feed", "aria-label": "Discovery feed" });
  grid.append(feed);
  const loadMore = el("button", { class: "btn", id: "load-more" }, "Load more");
  loadMore.setAttribute("aria-label", "Load more");
  main.append(grid, status, loadMore);
  page.append(main);
  let cursor = null;
  let loadedPages = 0;
  let done = false;
  let loading = false;
  async function loadPage() {
    if (done || loading) return;
    loading = true;
    status.textContent = "Loading more clusters...";
    const r = await api("GET", `/api/feed?limit=${FEED_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    loading = false;
    if (!r.ok) {
      status.textContent = "The feed could not load. Try again.";
      return;
    }
    const { items, nextCursor } = r.data;
    cursor = nextCursor;
    loadedPages += 1;
    for (const item of items) {
      feed.append(feedCard(item));
    }
    if (cursor === null) {
      done = true;
      status.textContent = "You're all caught up.";
      loadMore.hidden = true;
    } else {
      status.textContent = `Showing ${feed.children.length} clusters.`;
    }
    updateAddress();
    observeLast();
  }
  function updateAddress() {
    const url = loadedPages <= 1 ? "/explore" : `/explore?pages=${loadedPages}`;
    history.replaceState(null, "", url);
  }
  loadMore.addEventListener("click", () => void loadPage());
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && !done && !loading && loadedPages < MAX_EXPLORE_PAGES) {
        void loadPage();
      }
    }
  }, { rootMargin: "100px" });
  function observeLast() {
    const last = feed.lastElementChild;
    if (last) observer.observe(last);
  }
  for (let i = 0; i < targetPages; i++) {
    await loadPage();
    if (done) break;
  }
  return page;
}
function feedCard(item) {
  const article = el("article", { class: "feed-card", role: "article" });
  article.setAttribute("aria-label", item.title);
  const body = el("div", { class: "card-body" });
  body.append(el("h2", { class: "card-title" }, link(`/c/${item.id}`, item.title)));
  const meta = el("div", { class: "card-meta mono" });
  meta.append(link(`/@${item.curator.handle}`, `@${item.curator.handle}`), el("span", {}, `${item.publicItemCount} items`));
  body.append(meta);
  if (item.coverUrl) {
    const img = el("img", { src: item.coverUrl, alt: "", loading: "lazy" });
    img.addEventListener("error", () => img.remove());
    article.prepend(img);
  }
  article.append(body);
  return article;
}

// src/client/screens/profile.ts
async function renderProfile(handle) {
  const acc = session()?.account ?? null;
  const page = el("div");
  page.append(topBar({ account: acc }));
  const main = el("main");
  const r = await api("GET", `/api/curators/${handle}`);
  if (!r.ok) {
    main.append(notFoundPage().firstElementChild ?? el("div"));
    page.append(main);
    return page;
  }
  const profile = r.data;
  const header = el("header", { class: "panel stack" });
  header.append(el("h1", {}, profile.displayName));
  const meta = el("p", { class: "muted mono" });
  meta.append(el("span", {}, `@${profile.handle}`), el("span", {}, ` \xB7 `), el("span", { id: "follower-count" }, `${profile.followerCount} followers`));
  header.append(meta);
  const status = el("div", { id: "profile-status", role: "status", class: "visually-hidden" });
  status.setAttribute("aria-live", "polite");
  const isSelf = acc?.handle === profile.handle;
  if (!isSelf) {
    const followBtn = el("button", { class: "btn", id: "follow-btn", type: "button", "aria-pressed": "false" }, "Follow");
    followBtn.addEventListener("click", async () => {
      if (!acc) {
        navigate(`/signin?next=${encodeURIComponent(`/@${handle}`)}`);
        return;
      }
      const following = followBtn.getAttribute("aria-pressed") === "true";
      const method = following ? "DELETE" : "POST";
      const countEl = document.getElementById("follower-count");
      const beforeCount = Number(/(\d+)/.exec(countEl.textContent ?? "")?.[1] ?? 0);
      const nextCount = following ? beforeCount - 1 : beforeCount + 1;
      followBtn.setAttribute("aria-pressed", following ? "false" : "true");
      followBtn.textContent = following ? "Follow" : "Following";
      countEl.textContent = `${nextCount} followers`;
      const rr = await api(method, `/api/curators/${handle}/follow`);
      if (rr.ok && rr.data) {
        followBtn.setAttribute("aria-pressed", rr.data.following ? "true" : "false");
        followBtn.textContent = rr.data.following ? "Following" : "Follow";
        countEl.textContent = `${rr.data.followerCount} followers`;
        announce("profile-status", rr.data.following ? `Following ${profile.displayName}. ${rr.data.followerCount} followers.` : `Unfollowed ${profile.displayName}. ${rr.data.followerCount} followers.`);
        return;
      }
      followBtn.setAttribute("aria-pressed", following ? "true" : "false");
      followBtn.textContent = following ? "Following" : "Follow";
      countEl.textContent = `${beforeCount} followers`;
      announce("profile-status", `Could not update the follow. ${beforeCount} followers.`);
    });
    header.append(followBtn);
  }
  header.append(status);
  const grid = el("div", { class: "feed-grid" });
  const feed = el("div", { role: "feed", class: "feed", "aria-label": "Public clusters" });
  grid.append(feed);
  for (const c of profile.clusters) {
    const article = el("article", { class: "feed-card" });
    if (c.coverUrl) {
      const img = el("img", { src: c.coverUrl, alt: "", loading: "lazy" });
      img.addEventListener("error", () => img.remove());
      article.append(img);
    }
    const body = el("div", { class: "card-body" });
    body.append(el("h2", { class: "card-title" }, link(`/c/${c.id}`, c.title)));
    body.append(el("div", { class: "card-meta mono" }, `${c.publicItemCount} items`));
    article.append(body);
    feed.append(article);
  }
  if (profile.clusters.length === 0) {
    feed.append(el("p", { class: "muted" }, "No public clusters yet."));
  }
  main.append(header, grid);
  page.append(main);
  return page;
}
async function renderPublicCluster(clusterId) {
  const acc = session()?.account ?? null;
  const page = el("div");
  page.append(topBar({ account: acc }));
  const main = el("main");
  const r = await api("GET", `/api/public/clusters/${clusterId}`);
  if (!r.ok) {
    main.append(notFoundPage().firstElementChild ?? el("div"));
    page.append(main);
    return page;
  }
  const cluster = r.data;
  main.append(el("h1", {}, cluster.title));
  if (cluster.publicDescription) {
    main.append(el("p", { class: "muted" }, cluster.publicDescription));
  }
  const credits = el("ul", { id: "credits", class: "row", "aria-label": "Credits" });
  for (const credit of cluster.credits) {
    credits.append(el("li", {}, link(`/@${credit.handle}`, `${credit.displayName} (@${credit.handle})`)));
  }
  main.append(credits, el("p", { class: "mono", "aria-label": "Item count" }, `${cluster.publicItemCount} items`));
  const grid = el("div", { class: "masonry" });
  const list = el("ul", { id: "public-items", "aria-label": "Items", class: "masonry" });
  for (const item of cluster.items) {
    const li = el("li", {}, el("article", { class: "ref-card" }));
    const card = li.firstElementChild;
    const img = el("img", { src: item.mediaUrl, alt: "", loading: "lazy" });
    card.append(img, el("div", { class: "ref-title-full" }, `${item.position}. ${item.title}`));
    if (item.kind === "still" && item.sourceClipTitle && item.timecode) {
      card.append(el("div", { class: "still-meta" }, `${item.sourceClipTitle} \xB7 ${item.timecode}`));
    }
    list.append(li);
  }
  grid.append(list);
  main.append(grid);
  page.append(main);
  return page;
}

// src/client/screens/review.ts
async function renderReview(token) {
  const acc = session()?.account ?? null;
  const page = el("div");
  const main = el("main", { class: "page-narrow", style: "max-width: 720px" });
  const r = await api("GET", `/api/review/${token}`);
  if (!r.ok) {
    const err = r.error;
    const heading = err?.error === "link_expired" ? "This review link has expired." : err?.error === "link_revoked" ? "This review link was revoked." : err?.error === "link_inactive" ? "This cluster is no longer in review." : "This review link does not exist.";
    main.append(el("section", { class: "panel" }, el("h1", {}, heading)));
    page.append(main);
    return page;
  }
  const data = r.data;
  page.append(topBar({ account: acc, bare: true }));
  const banner = el("p", { class: "panel mono" }, `Review: ${data.cluster.title} \xB7 expires ${data.link.expiresAt.replace("T", " ").slice(0, 16)} UTC`);
  main.append(banner);
  const list = el("ol", { class: "stack", "aria-label": "Entries" });
  for (const entry of data.cluster.entries) {
    const li = el("li", { class: "panel" });
    if (entry.kind === "clip") {
      li.append(el("video", { src: entry.mediaUrl, controls: false, muted: true, preload: "metadata" }));
    } else {
      li.append(el("img", { src: entry.mediaUrl, alt: "", loading: "lazy" }));
    }
    const title = el("div", { class: "ref-title-full" }, `${entry.position}. ${entry.title}`);
    li.append(title);
    if (entry.kind === "still" && entry.sourceClipTitle && entry.timecode) {
      li.append(el("div", { class: "still-meta" }, `${entry.sourceClipTitle} \xB7 ${entry.timecode}`));
    }
    list.append(li);
  }
  main.append(list);
  const commentsPanel = el("section", { class: "panel stack", "aria-label": "Comments" });
  const commentsList = el("ul", { class: "stack" });
  for (const c of data.comments) {
    const li = el("li", {});
    li.append(el("strong", {}, c.authorName), el("p", {}, c.body));
    commentsList.append(li);
  }
  commentsPanel.append(commentsList);
  const status = el("div", { id: "review-status", role: "status", class: "visually-hidden" });
  status.setAttribute("aria-live", "polite");
  if (!data.link.canComment) {
    commentsPanel.append(el("p", { class: "muted" }, "This link is view-only."));
  } else {
    const form = el("form", { class: "stack", novalidate: true });
    const name = el("input", { type: "text", id: "review-name" });
    name.setAttribute("aria-label", "Your name");
    const body = el("textarea", { id: "review-comment" });
    body.setAttribute("aria-label", "Comment");
    const post = el("button", { type: "submit", class: "btn btn-primary", id: "review-post" }, "Post comment");
    post.setAttribute("aria-label", "Post comment");
    form.append(formField("Your name", name), formField("Comment", body), el("div", {}, post));
    let retryTimer;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearInvalid(form);
      post.disabled = true;
      const rr = await api("POST", `/api/review/${token}/comments`, { authorName: name.value, body: body.value });
      if (rr.ok && rr.data) {
        post.disabled = false;
        body.value = "";
        announceReview("Comment posted.");
        commentsList.append(el("li", {}, el("strong", {}, rr.data.authorName), el("p", {}, rr.data.body)));
        return;
      }
      const err = rr.error;
      if (err?.error === "rate_limited") {
        const seconds = err.retryAfter ?? 1;
        announceReview(`You're commenting too fast. Try again in ${seconds} seconds.`);
        post.disabled = true;
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
          post.disabled = false;
        }, seconds * 1e3);
        body.focus();
        return;
      }
      if (err?.error === "link_expired" || err?.error === "link_revoked" || err?.error === "link_inactive") {
        const heading = err.error === "link_expired" ? "This review link has expired." : err.error === "link_revoked" ? "This review link was revoked." : "This cluster is no longer in review.";
        const unsent = el("section", { class: "panel stack" });
        unsent.append(el("h1", {}, heading));
        const region = el("div", { role: "region", "aria-label": "Unsent comment" });
        const note = el("textarea", { readonly: true, "aria-label": "Unsent comment" });
        note.value = body.value;
        region.append(note);
        unsent.append(region);
        page.replaceChildren(topBar({ account: null, bare: true }), el("main", { class: "page-narrow", style: "max-width: 720px" }, unsent));
        return;
      }
      post.disabled = false;
      const errors = err?.errors ?? {};
      if (Object.keys(errors).length > 0) {
        form.prepend(errorSummary(errors, { authorName: "review-name", body: "review-comment" }));
        document.getElementById("error-summary")?.focus();
        if (errors.authorName) markInvalid(name, errors.authorName);
        if (errors.body) markInvalid(body, errors.body);
      }
    });
    commentsPanel.append(form);
  }
  commentsPanel.append(status);
  main.append(commentsPanel);
  page.append(main);
  return page;
}
function announceReview(message) {
  const region = document.getElementById("review-status");
  if (region) region.textContent = message;
}

// src/client/main.ts
route("/", async () => {
  window.location.replace("/explore");
  return el("div");
});
route("/signin", async (_m, params) => renderSignIn(params));
route("/signup", async (_m, params) => renderSignUp(params));
route("/invite/([^/]+)", async (m) => renderInvite(m[1]));
route("/explore", async (_m, params) => renderExplore(params));
route("/@([^/]+)", async (m) => renderProfile(m[1]));
route("/c/([^/]+)", async (m) => renderPublicCluster(m[1]));
route("/review/([^/]+)", async (m) => renderReview(m[1]));
route("/w/([^/]+)", async (m, params) => renderWall(m[1], params));
route("/w/([^/]+)/admin", async (m, params) => renderAdmin(m[1], params));
route("/w/([^/]+)/clusters/([^/]+)", async (m, params) => renderSettings(m[1], m[2]));
async function boot() {
  await loadSession();
  await mountApp();
}
window.addEventListener("popstate", () => {
  void mountApp();
});
void boot();
