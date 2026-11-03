"use strict";
(() => {

  var BREAKPOINTS = ["desktop", "tablet", "phone"];
  var NODE_TYPE_LABELS = {
    page: "Page",
    section: "Section",
    stack: "Stack",
    heading: "Heading",
    text: "Text",
    image: "Image",
    button: "Button",
    nav: "Nav",
    collection_list: "Collection list"
  };
  var INSERTABLE_TYPES = [
    "section",
    "stack",
    "heading",
    "text",
    "image",
    "button",
    "nav",
    "collection_list"
  ];
  function breakpointLabel(bp) {
    return bp === "desktop" ? "Desktop" : bp === "tablet" ? "Tablet" : "Phone";
  }
  var FRAME_WIDTH = { desktop: 1280, tablet: 768, phone: 375 };

  function bpList(list) {
    if (list.length === 0) return "no other breakpoint";
    return list.map(breakpointLabel).join(" and ");
  }
  var notices = {
    inserted: (name) => `Added ${name}.`,
    moved: (name, position, total, parentName) => `Moved ${name} to position ${position} of ${total} in ${parentName}.`,
    refusedMove: (name) => `Can't move ${name} there.`,
    deleted: (name) => `Deleted ${name}.`,
    cascade: (property, bp, inherited, kept) => `${property} changed on ${breakpointLabel(bp)}. Inherited by ${bpList(inherited)}. Kept override on ${bpList(kept)}.`,
    overrideCleared: (property, bp, value) => `${property} on ${breakpointLabel(bp)} now inherits ${value}.`,
    token: (name, value, uses) => `Token ${name} is now ${value}. ${uses} uses updated.`,
    tokenInUse: (name, uses) => `Can't delete ${name}: it is used ${uses} times.`,
    sharedEdit: (count, componentName) => `Updated ${count} instances of ${componentName}.`,
    componentInUse: (name, count) => `Can't delete ${name}: ${count} instances still link to it.`,
    fieldInUse: (name, count) => `Can't remove ${name}: it is bound ${count} times.`,
    emptyList: "Nothing here yet.",
    uploadProgress: (fileName) => `Uploading ${fileName}.`,
    uploadSuccess: (fileName) => `Uploaded ${fileName}.`,
    uploadWrongType: "Only PNG, JPEG or WebP images can be uploaded.",
    uploadTooBig: "That image is over 5,000,000 bytes.",
    uploadOutage: (fileName) => `Couldn't upload ${fileName}. File storage is unavailable.`,
    storageBanner: "File storage is unavailable. Your edits are safe; uploads and publishing are paused.",
    publishProgress: (pageName2) => `Publishing ${pageName2}.`,
    publishSuccess: (pageName2, url) => `Published ${pageName2} at ${url}.`,
    publishFailed: (pageName2) => `Couldn't publish ${pageName2}. Nothing changed on the live page.`,
    unpublished: (pageName2) => `Unpublished ${pageName2}.`,
    joined: (name) => `${name} joined.`,
    conflict: (name, property, value) => `${name} set ${property} to ${value} at the same time. Their value was kept.`,
    deletedBy: (nodeName, name) => `${nodeName} was deleted by ${name}. Your change was not saved.`,
    roleChanged: (role) => `Your role is now ${role}.`,
    roleRefused: "You're now a viewer. Your last change was not saved.",
    cantUndo: (name, nodeName) => `Can't undo: ${name} changed ${nodeName} after you.`,
    nothingToUndo: "Nothing to undo.",
    nothingToRedo: "Nothing to redo.",
    versionSaved: (versionName) => `Saved ${versionName}.`,
    restoreProgress: (versionName) => `Restoring ${versionName}.`,
    restored: (name, versionName) => `${name} restored ${versionName}.`,
    commentMode: (ownerName) => `Comment mode. Ask ${ownerName} for edit access.`,
    previewBanner: (versionName) => `Previewing ${versionName}. Restore it or go back to the latest.`,
    commentPosted: (nodeName) => `Comment posted on ${nodeName}.`,
    mentionMailFailed: (email) => `Couldn't email ${email}.`,
    inviteSent: (email) => `Invitation sent to ${email}.`,
    inviteFailed: "Couldn't send the invitation. Try again in a moment."
  };
  var fieldErrors = {
    nameEmpty: "Enter a name.",
    emailInvalid: "Enter an email address like name@example.org.",
    passwordShort: "Use 10 or more characters.",
    emailTaken: "An account with this email already exists.",
    signInFailed: "Email or password is wrong.",
    altEmpty: "Alt text is required.",
    alreadyMember: (email) => `${email} is already a member.`,
    alreadyInvited: (email) => `${email} already has an invitation.`
  };
  var PUBLISH_STATE_TEXT = {
    not_published: "Not published",
    live: "Live",
    live_changed: "Live, with unpublished changes",
    unpublished: "Unpublished"
  };

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    setAttrs(node, attrs);
    for (const child of children) {
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return node;
  }
  function setAttrs(node, attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === void 0 || value === false) {
        node.removeAttribute(name);
        continue;
      }
      if (value === true) {
        node.setAttribute(name, "");
        continue;
      }
      if (name === "class") node.className = String(value);
      else node.setAttribute(name, String(value));
    }
  }
  function setAttr(node, name, value) {
    if (value === void 0) node.removeAttribute(name);
    else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }
  function button(label, attrs = {}) {
    return el("button", { type: "button", ...attrs }, [label]);
  }
  function patchChildren(parent, items2, key, create, update) {
    const existing = new Map();
    for (const child of [...parent.children]) {
      const childKey = child.dataset["key"];
      if (childKey !== void 0) existing.set(childKey, child);
    }
    const wanted = [];
    for (const item of items2) {
      const itemKey = key(item);
      let node = existing.get(itemKey);
      if (node === void 0) {
        node = create(item);
        node.dataset["key"] = itemKey;
      } else {
        existing.delete(itemKey);
      }
      update(node, item);
      wanted.push(node);
    }
    for (const stale of existing.values()) stale.remove();
    for (let i = 0; i < wanted.length; i += 1) {
      const node = wanted[i];
      if (parent.children[i] !== node) parent.insertBefore(node, parent.children[i] ?? null);
    }
    return wanted;
  }
  var ICONS = {
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m6.08 11-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83L17.9 11"/>',
    palette: '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 10 10 0 0 0-9-11Z"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
    message: '<path d="M8 9h8"/><path d="M8 13h6"/><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"/>',
    share: '<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
    fan: '<path d="M12 12 4 6"/><path d="M12 12v10"/><path d="m12 12 8-6"/><path d="M12 2a10 10 0 0 1 10 10"/>',
    panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    pencil: '<path d="M21.2 6.2 17.8 2.8a2 2 0 0 0-2.8 0L3 14.8V21h6.2L21.2 9a2 2 0 0 0 0-2.8Z"/>'
  };
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.75");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "icon");
    svg.innerHTML = ICONS[name] ?? ICONS["panel"];
    return svg;
  }
  function focusables(root2) {
    return [
      ...root2.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ].filter((node) => node.offsetParent !== null || node === document.activeElement);
  }
  function trapTab(container2, event) {
    if (event.key !== "Tab") return;
    const items2 = focusables(container2);
    if (items2.length === 0) return;
    const first = items2[0];
    const last = items2[items2.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !container2.contains(active))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
  function isTextEntry(node) {
    if (!node) return false;
    const tag = node.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag !== "INPUT") return node.isContentEditable;
    const type = node.type;
    return type === "text" || type === "email" || type === "password" || type === "search";
  }

  var RequestFailed = class extends Error {
    failure;
    constructor(failure) {
      super(failure.message);
      this.failure = failure;
    }
  };
  async function request(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: body === void 0 ? {} : { "content-type": "application/json" },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    if (response.status === 204) return void 0;
    const text = await response.text();
    const parsed = text === "" ? {} : JSON.parse(text);
    if (!response.ok) {
      const error = parsed["error"] ?? {};
      throw new RequestFailed({
        status: response.status,
        code: String(error["code"] ?? "error"),
        message: String(error["message"] ?? "Something went wrong."),
        fields: error["fields"] ?? {}
      });
    }
    return parsed;
  }
  var api = {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    patch: (path, body) => request("PATCH", path, body),
    del: (path) => request("DELETE", path)
  };
  async function postPublish(path, idempotencyKey) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey }
    });
    const text = await response.text();
    const parsed = text === "" ? {} : JSON.parse(text);
    if (!response.ok) {
      const error = parsed["error"] ?? {};
      throw new RequestFailed({
        status: response.status,
        code: String(error["code"] ?? "error"),
        message: String(error["message"] ?? "Something went wrong."),
        fields: error["fields"] ?? {}
      });
    }
    return parsed;
  }
  async function uploadImage(workspaceId, file) {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/workspaces/${workspaceId}/images`, {
      method: "POST",
      body: form
    });
    const text = await response.text();
    const parsed = text === "" ? {} : JSON.parse(text);
    if (!response.ok) {
      const error = parsed["error"] ?? {};
      throw new RequestFailed({
        status: response.status,
        code: String(error["code"] ?? "error"),
        message: String(error["message"] ?? "Something went wrong."),
        fields: error["fields"] ?? {}
      });
    }
    return parsed;
  }

  function withNext(path) {
    const next = new URL(window.location.href).searchParams.get("next");
    return next === null ? path : `${path}?next=${encodeURIComponent(next)}`;
  }
  function nextPath() {
    const next = new URL(window.location.href).searchParams.get("next");
    if (next === null || !next.startsWith("/") || next.startsWith("//")) return "/";
    return next;
  }
  function accountForm(title, fields, submitLabel, otherLink, submit) {
    const summary = el("div", { class: "error-summary", hidden: true });
    const inputs = new Map();
    const messages = new Map();
    const form = el("form", { class: "account-form", novalidate: true });
    const card = el("main", { class: "account-card" }, [
      el("h1", {}, [title]),
      summary,
      form,
      el("p", { class: "account-other" }, [el("a", { href: otherLink.href }, [otherLink.text])])
    ]);
    for (const field of fields) {
      const id = `field-${field.name}`;
      const message = el("p", { class: "field-error", id: `${id}-error` });
      const input = el("input", {
        id,
        type: field.type,
        name: field.name,
        "aria-label": field.label,
        autocomplete: field.type === "password" ? "current-password" : "on"
      });
      inputs.set(field.name, input);
      messages.set(field.name, message);
      form.append(
        el("div", { class: "field-row" }, [
          el("label", { for: id }, [field.label]),
          input,
          message
        ])
      );
    }
    const action = el("button", { type: "submit", class: "primary" }, [submitLabel]);
    form.append(action);
    const showErrors = (errors) => {
      summary.replaceChildren(
        el("h2", {}, ["There is a problem"]),
        el(
          "ul",
          {},
          Object.entries(errors).map(
            ([name, text]) => el("li", {}, [
              el(
                "a",
                { href: `#field-${name}` },
                [text]
              )
            ])
          )
        )
      );
      summary.setAttribute("role", "alert");
      summary.hidden = false;
      for (const [name, message] of messages) {
        const text = errors[name];
        setText(message, text ?? "");
        const input = inputs.get(name);
        if (text === void 0) {
          input.removeAttribute("aria-describedby");
          input.removeAttribute("aria-invalid");
        } else {
          input.setAttribute("aria-describedby", `field-${name}-error`);
          input.setAttribute("aria-invalid", "true");
        }
      }
      const firstLink = summary.querySelector("a");
      firstLink?.focus();
    };
    summary.addEventListener("click", (event) => {
      const link = event.target.closest("a");
      if (!link) return;
      event.preventDefault();
      const id = link.getAttribute("href").slice(1);
      document.getElementById(id)?.focus();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = {};
      for (const [name, input] of inputs) values[name] = input.value;
      void submit(values).catch((error) => {
        if (!(error instanceof RequestFailed)) throw error;
        const failure = error.failure;
        if (failure.status === 422) {
          showErrors(failure.fields);
          return;
        }
        if (failure.code === "email_taken") {
          showErrors({ email: fieldErrors.emailTaken });
          return;
        }
        if (failure.code === "invalid_credentials") {
          showErrors({ email: fieldErrors.signInFailed });
          return;
        }
        showErrors({ email: failure.message });
      });
    });
    return card;
  }
  function mountSignup(root2) {
    root2.replaceChildren(
      accountForm(
        "Sign up",
        [
          { name: "name", label: "Name", type: "text" },
          { name: "email", label: "Email", type: "email" },
          { name: "password", label: "Password", type: "password" }
        ],
        "Sign up",
        { href: withNext("/signin"), text: "Already have an account? Sign in" },
        async (values) => {
          await api.post("/api/auth/signup", values);
          window.location.assign(nextPath());
        }
      )
    );
  }
  function mountSignin(root2) {
    root2.replaceChildren(
      accountForm(
        "Sign in",
        [
          { name: "email", label: "Email", type: "email" },
          { name: "password", label: "Password", type: "password" }
        ],
        "Sign in",
        { href: withNext("/signup"), text: "Need an account? Sign up" },
        async (values) => {
          await api.post("/api/auth/signin", values);
          window.location.assign(nextPath());
        }
      )
    );
  }
  async function mountWorkspaces(root2) {
    const me = await api.get("/api/me");
    const list = el(
      "ul",
      { class: "workspace-list" },
      me.workspaces.map(
        (workspace) => el("li", {}, [
          el("a", { href: `/w/${workspace.id}/edit` }, [workspace.name]),
          el("span", { class: "mono role" }, [workspace.role])
        ])
      )
    );
    const input = el("input", { type: "text", id: "workspace-name", "aria-label": "Workspace name" });
    const form = el("form", { class: "create-workspace" }, [
      el("label", { for: "workspace-name" }, ["Workspace name"]),
      input,
      el("button", { type: "submit", class: "primary" }, ["Create workspace"])
    ]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void api.post("/api/workspaces", { name: input.value }).then((created) => {
        window.location.assign(`/w/${created.id}/edit`);
      });
    });
    root2.replaceChildren(
      el("main", { class: "workspaces-page" }, [el("h1", {}, ["Workspaces"]), list, form])
    );
  }

  var CHAIN = ["desktop", "tablet", "phone"];
  function chainAtOrAbove(bp) {
    const i = CHAIN.indexOf(bp);
    return CHAIN.slice(0, i + 1).reverse();
  }
  function belowBreakpoints(bp) {
    return CHAIN.slice(CHAIN.indexOf(bp) + 1);
  }
  function ownStyle(node, bp, key) {
    return node.styles[bp]?.[key];
  }
  function sourceBreakpoint(node, bp, key) {
    for (const candidate of chainAtOrAbove(bp)) {
      if (ownStyle(node, candidate, key) !== void 0) return candidate;
    }
    return void 0;
  }
  function resolveStyle(node, bp, key) {
    const from = sourceBreakpoint(node, bp, key);
    return from === void 0 ? void 0 : ownStyle(node, from, key);
  }
  function styleSource(node, bp, key) {
    if (ownStyle(node, bp, key) !== void 0) return "set";
    return sourceBreakpoint(node, bp, key) === void 0 ? "unset" : "inherited";
  }
  function pipState(node, bp, key) {
    const own = ownStyle(node, bp, key) !== void 0;
    if (bp === "desktop") return own ? "set" : "unset";
    if (own) return "overridden";
    return sourceBreakpoint(node, bp, key) === void 0 ? "unset" : "inherited";
  }
  function canClearOverride(node, bp, key) {
    return bp !== "desktop" && ownStyle(node, bp, key) !== void 0;
  }
  function reachOfChange(node, changed, key) {
    const groups2 = { inherited: [], kept: [], shielded: [] };
    let blocked = false;
    for (const bp of belowBreakpoints(changed)) {
      if (ownStyle(node, bp, key) !== void 0) {
        groups2.kept.push(bp);
        blocked = true;
      } else if (blocked) {
        groups2.shielded.push(bp);
      } else {
        groups2.inherited.push(bp);
      }
    }
    return groups2;
  }
  function reachOfClear(node, cleared, key) {
    const frames2 = [cleared];
    for (const bp of belowBreakpoints(cleared)) {
      if (ownStyle(node, bp, key) !== void 0) break;
      frames2.push(bp);
    }
    return frames2;
  }

  var STYLE_KEYS = [
    "color",
    "background-color",
    "font-size",
    "padding",
    "gap",
    "width",
    "text-align",
    "display",
    "flex-direction"
  ];
  var STYLE_TOKEN_KIND = {
    color: "color",
    "background-color": "color",
    "font-size": "size",
    padding: "size",
    gap: "size",
    width: "size",
    "text-align": null,
    display: null,
    "flex-direction": null
  };
  function tokenCssValue(token) {
    return token.kind === "size" ? `${token.value}${token.unit ?? "px"}` : String(token.value);
  }
  function findToken(tokens, name) {
    return tokens.find((t) => t.name === name);
  }
  function styleValueText(value) {
    if (value === void 0) return "nothing";
    return typeof value === "string" ? value : value.token;
  }
  function cssOf(value, tokens) {
    if (typeof value === "string") return value;
    const token = findToken(tokens, value.token);
    return token === void 0 ? void 0 : tokenCssValue(token);
  }
  var BASE_DEFAULTS = {
    color: "#1b1a17",
    "background-color": "transparent",
    "font-size": "16px",
    padding: "0px",
    gap: "0px",
    width: "auto",
    "text-align": "left",
    display: "block",
    "flex-direction": "row"
  };
  var TYPE_DEFAULTS = {
    page: { padding: "24px" },
    section: { padding: "24px" },
    stack: { display: "flex", "flex-direction": "column", gap: "16px" },
    heading: {},
    text: {},
    image: { display: "block", width: "100%" },
    button: { display: "flex", padding: "12px" },
    nav: { display: "flex", gap: "16px" },
    collection_list: {}
  };
  var HEADING_SIZES = { 1: "40px", 2: "33px", 3: "28px" };
  function defaultStyleFor(node, key) {
    if (node.type === "heading" && key === "font-size") {
      const level = Number(node.props["level"] ?? 1);
      return HEADING_SIZES[level] ?? HEADING_SIZES[1];
    }
    return TYPE_DEFAULTS[node.type][key] ?? BASE_DEFAULTS[key];
  }
  function nodeDeclarations(node, bp, tokens) {
    const out = {};
    for (const key of STYLE_KEYS) {
      const stored = resolveStyle(node, bp, key);
      const css = stored === void 0 ? void 0 : cssOf(stored, tokens);
      out[key] = css ?? defaultStyleFor(node, key);
    }
    return out;
  }
  function declarationText(decls) {
    return STYLE_KEYS.map((key) => `${key}:${decls[key]}`).join(";");
  }
  var BASE_NODE_CSS = `
.pl-node{box-sizing:border-box;margin:0;max-width:100%;overflow-wrap:anywhere;font-family:'IBM Plex Sans',system-ui,sans-serif;line-height:1.45;border:0}
.pl-heading{font-family:'Space Grotesk','IBM Plex Sans',system-ui,sans-serif;font-weight:700;line-height:1.2}
.pl-image{object-fit:cover;aspect-ratio:16/10}
.pl-collection_list{list-style:none}
.pl-collection_list>li{list-style:none;max-width:100%}
.pl-button{text-decoration:none;border:1px solid currentColor;border-radius:2px;align-items:center;justify-content:center;min-height:44px;min-width:44px;cursor:pointer}
.pl-nav{flex-wrap:wrap;align-items:center}
.pl-empty-list{font-family:'IBM Plex Sans',system-ui,sans-serif;color:#6b6760}
`;

  var CONTAINER_TYPES = [
    "page",
    "section",
    "stack",
    "nav",
    "collection_list"
  ];
  function takesChildren(type) {
    return CONTAINER_TYPES.includes(type);
  }
  function accepts(parent, childType) {
    if (!takesChildren(parent.type)) return false;
    if (parent.type === "nav") return childType === "button";
    if (parent.type === "collection_list") return false;
    return true;
  }
  function walk(node, parent, index, visit) {
    if (visit(node, parent, index)) return true;
    for (let i = 0; i < node.children.length; i += 1) {
      if (walk(node.children[i], node, i, visit)) return true;
    }
    return false;
  }
  function findNode(doc, nodeId2) {
    let hit;
    for (const page of doc.pages) {
      walk(page.root, null, 0, (node, parent, index) => {
        if (node.id !== nodeId2) return false;
        hit = { node, parent, index, page, component: null };
        return true;
      });
      if (hit) return hit;
    }
    for (const component of doc.components) {
      walk(component.root, null, 0, (node, parent, index) => {
        if (node.id !== nodeId2) return false;
        hit = { node, parent, index, page: null, component };
        return true;
      });
      if (hit) return hit;
    }
    return void 0;
  }
  function allNodes(root2) {
    const out = [];
    walk(root2, null, 0, (node) => {
      out.push(node);
      return false;
    });
    return out;
  }
  function pageOf(doc, nodeId2) {
    for (const page of doc.pages) {
      if (allNodes(page.root).some((n) => n.id === nodeId2)) return page;
    }
    return void 0;
  }
  function findPage(doc, pageId) {
    return doc.pages.find((p) => p.id === pageId);
  }
  function findComponent(doc, id) {
    return doc.components.find((c) => c.id === id);
  }
  function pathTo(root2, nodeId2) {
    if (root2.id === nodeId2) return [];
    for (let i = 0; i < root2.children.length; i += 1) {
      const sub = pathTo(root2.children[i], nodeId2);
      if (sub) return [i, ...sub];
    }
    return void 0;
  }
  function nodeAtPath(root2, path) {
    let node = root2;
    for (const index of path) {
      node = node?.children[index];
      if (!node) return void 0;
    }
    return node;
  }
  function isInSubtree(root2, nodeId2) {
    return pathTo(root2, nodeId2) !== void 0;
  }
  function linkedInstances(doc, componentId) {
    return doc.pages.flatMap((page) => allNodes(page.root)).filter((node) => node.shared?.componentId === componentId);
  }
  function instanceContextOf(doc, nodeId2) {
    for (const page of doc.pages) {
      for (const node of allNodes(page.root)) {
        if (node.shared === void 0) continue;
        const path = pathTo(node, nodeId2);
        if (path) return { componentId: node.shared.componentId, instanceRoot: node, path };
      }
    }
    return void 0;
  }
  function mirrorsOf(doc, nodeId2) {
    const context = instanceContextOf(doc, nodeId2);
    if (!context) return [nodeId2];
    const component = findComponent(doc, context.componentId);
    if (!component) return [nodeId2];
    const ids = [nodeId2];
    const inComponent = nodeAtPath(component.root, context.path);
    if (inComponent) ids.push(inComponent.id);
    for (const instance of linkedInstances(doc, context.componentId)) {
      if (instance.id === context.instanceRoot.id) continue;
      const mirror = nodeAtPath(instance, context.path);
      if (mirror) ids.push(mirror.id);
    }
    return ids;
  }
  function componentOfNode(doc, nodeId2) {
    const context = instanceContextOf(doc, nodeId2);
    return context ? findComponent(doc, context.componentId) : void 0;
  }
  function cloneNode(node, newId) {
    const copy = {
      id: newId(),
      type: node.type,
      name: node.name,
      props: { ...node.props },
      styles: {
        desktop: { ...node.styles.desktop },
        tablet: { ...node.styles.tablet },
        phone: { ...node.styles.phone }
      },
      children: node.children.map((child) => cloneNode(child, newId))
    };
    if (node.bind) copy.bind = { ...node.bind };
    return copy;
  }
  function emptyStyles() {
    return { desktop: {}, tablet: {}, phone: {} };
  }
  function countOfType(page, type) {
    return allNodes(page.root).filter((n) => n.type === type).length;
  }

  function nodeTokenUses(node, name) {
    let uses = 0;
    for (const bp of BREAKPOINTS) {
      for (const value of Object.values(node.styles[bp])) {
        if (value !== void 0 && typeof value !== "string" && value.token === name) uses += 1;
      }
    }
    return uses;
  }
  function countTokenUses(doc, name) {
    let uses = 0;
    const instanceIds = new Set();
    for (const component of doc.components) {
      for (const node of allNodes(component.root)) uses += nodeTokenUses(node, name);
      for (const instance of linkedInstances(doc, component.id)) {
        for (const node of allNodes(instance)) instanceIds.add(node.id);
      }
    }
    for (const page of doc.pages) {
      for (const node of allNodes(page.root)) {
        if (instanceIds.has(node.id)) continue;
        uses += nodeTokenUses(node, name);
      }
    }
    return uses;
  }
  function countFieldBindings(doc, field) {
    let count = 0;
    for (const page of doc.pages) {
      for (const node of allNodes(page.root)) {
        for (const bound of Object.values(node.bind ?? {})) if (bound === field) count += 1;
      }
    }
    for (const component of doc.components) {
      for (const node of allNodes(component.root)) {
        for (const bound of Object.values(node.bind ?? {})) if (bound === field) count += 1;
      }
    }
    return count;
  }

  function focalPosition(node) {
    const x = Number(node.props["focalX"] ?? 50);
    const y = Number(node.props["focalY"] ?? 50);
    return `${x}% ${y}%`;
  }
  function boundPropValue(node, prop, entry, fields) {
    const fieldName = node.bind?.[prop];
    if (fieldName === void 0 || entry === void 0) {
      return { value: String(node.props[prop] ?? ""), field: void 0 };
    }
    const field = fields.find((f) => f.name === fieldName);
    return { value: entry.values[fieldName] ?? "", field };
  }
  function rulesFor(page, tokens, bp, selector) {
    return allNodes(page.root).map((node) => `${selector(node)}{${declarationText(nodeDeclarations(node, bp, tokens))}}`).join("\n");
  }
  function editorFrameCss(page, tokens) {
    const frames2 = BREAKPOINTS.map(
      (bp) => rulesFor(page, tokens, bp, (node) => `[data-frame="${bp}"] [data-node-id="${node.id}"]`)
    );
    return `${BASE_NODE_CSS}
${frames2.join("\n")}`;
  }

  var OpFailure = class extends Error {
    status;
    code;
    fields;
    constructor(status, code, message, fields) {
      super(message);
      this.status = status;
      this.code = code;
      this.fields = fields;
    }
  };
  function invalid(fields, message = "Some values are not valid.") {
    return new OpFailure(422, "invalid", message, fields);
  }
  function invalidMove(fields) {
    return new OpFailure(422, "invalid_move", "That move isn't allowed.", fields);
  }
  function notFound() {
    return new OpFailure(404, "not_found", "Not found.");
  }
  var PROPS_BY_TYPE = {
    page: [],
    section: [],
    stack: [],
    nav: [],
    collection_list: [],
    heading: ["text", "level"],
    text: ["text"],
    button: ["text", "href"],
    image: ["imageId", "alt", "focalX", "focalY"]
  };
  function propsOfType(type) {
    return PROPS_BY_TYPE[type];
  }
  function mainPropOf(type) {
    if (type === "heading" || type === "text" || type === "button") return "text";
    if (type === "image") return "imageId";
    return void 0;
  }
  function bindableFieldKinds(type, prop) {
    if (prop !== mainPropOf(type)) return [];
    if (type === "text") return ["text", "rich_text"];
    if (type === "heading" || type === "button") return ["text"];
    if (type === "image") return ["image"];
    return [];
  }
  var HREF_RE = /^(https?:\/\/|mailto:|\/)/;
  function isValidHref(value) {
    return HREF_RE.test(value);
  }
  function defaultPropsFor(type, name) {
    switch (type) {
      case "heading":
        return { text: name, level: 1 };
      case "text":
        return { text: "Text" };
      case "button":
        return { text: name, href: "/" };
      case "image":
        return { imageId: "", alt: "", focalX: 50, focalY: 50 };
      default:
        return {};
    }
  }
  function defaultNodeName(type, countOnPage) {
    return `${NODE_TYPE_LABELS[type]} ${countOnPage + 1}`;
  }
  function parsePropValue(type, prop, value) {
    if (!PROPS_BY_TYPE[type].includes(prop)) {
      throw invalid({ prop: "Unknown prop for this type." });
    }
    if (prop === "level") {
      if (value !== 1 && value !== 2 && value !== 3) {
        throw invalid({ value: "Heading level is 1, 2 or 3." });
      }
      return value;
    }
    if (prop === "focalX" || prop === "focalY") {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
        throw invalid({ value: "Focal values are whole numbers from 0 to 100." });
      }
      return value;
    }
    if (typeof value !== "string") throw invalid({ value: "Expected text." });
    if (value.length > 2e3) throw invalid({ value: "Use 2,000 characters or fewer." });
    if (prop === "href" && value !== "" && !isValidHref(value)) {
      throw invalid({ value: "Links start with http:, https:, mailto: or /." });
    }
    if (prop === "alt" && value.trim() === "") {
      throw invalid({ value: "Alt text is required." });
    }
    return value;
  }

  var ALLOWED = new Set(["p", "strong", "em", "ul", "ol", "li", "a"]);
  var SAFE_HREF = /^(https?:|mailto:)/i;
  function escapeText(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeHtml(text) {
    return escapeText(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function decodeEntities(text) {
    return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  }
  function hrefOf(attrs) {
    const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
    if (!m) return void 0;
    const raw = decodeEntities((m[2] ?? m[3] ?? m[4] ?? "").trim());
    return SAFE_HREF.test(raw) ? raw : void 0;
  }
  function filterRichText(input) {
    const open = [];
    let out = "";
    let i = 0;
    while (i < input.length) {
      const lt = input.indexOf("<", i);
      if (lt === -1) {
        out += escapeText(decodeEntities(input.slice(i)));
        break;
      }
      out += escapeText(decodeEntities(input.slice(i, lt)));
      const gt = input.indexOf(">", lt);
      if (gt === -1) {
        out += escapeText(decodeEntities(input.slice(lt)));
        break;
      }
      const inner = input.slice(lt + 1, gt);
      i = gt + 1;
      if (inner.startsWith("!")) continue;
      const closing = inner.startsWith("/");
      const body = closing ? inner.slice(1) : inner;
      const nameMatch = /^([a-zA-Z][a-zA-Z0-9]*)/.exec(body.trim());
      if (!nameMatch) continue;
      const tag = nameMatch[1].toLowerCase();
      if (!ALLOWED.has(tag)) continue;
      if (closing) {
        const at = open.lastIndexOf(tag);
        if (at === -1) continue;
        while (open.length > at) out += `</${open.pop()}>`;
        continue;
      }
      if (tag === "a") {
        const href = hrefOf(body.slice(nameMatch[1].length));
        if (href === void 0) continue;
        out += `<a href="${escapeHtml(href)}">`;
      } else {
        out += `<${tag}>`;
      }
      open.push(tag);
    }
    while (open.length > 0) out += `</${open.pop()}>`;
    return out;
  }
  function richTextToPlain(html) {
    return decodeEntities(html.replace(/<[^>]*>/g, ""));
  }

  function slugify(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }
  function uniqueSlug(name, taken) {
    const base = slugify(name) || "untitled";
    if (!taken.includes(base)) return base;
    for (let n = 2; ; n += 1) {
      const candidate = `${base}-${n}`;
      if (!taken.includes(candidate)) return candidate;
    }
  }

  var MAX_NODES_PER_PAGE = 500;
  var MAX_PAGES = 20;
  var MAX_TOKENS = 40;
  var MAX_ENTRIES = 200;
  function needNode(doc, nodeId2) {
    const hit = findNode(doc, nodeId2);
    if (!hit) throw notFound();
    return hit.node;
  }
  function parentOf(doc, nodeId2) {
    const hit = findNode(doc, nodeId2);
    if (!hit) throw notFound();
    if (!hit.parent) throw invalid({ nodeId: "The page root cannot be changed that way." });
    return { parent: hit.parent, index: hit.index };
  }
  function needPage(doc, pageId) {
    const page = findPage(doc, pageId);
    if (!page) throw notFound();
    return page;
  }
  function checkImageRef(ctx, imageId, path) {
    if (imageId === "" || ctx.images === void 0) return;
    if (!ctx.images.known.has(imageId)) throw notFound();
    if (!ctx.images.confirmed.has(imageId)) {
      throw new OpFailure(422, "image_not_confirmed", "That image is not confirmed yet.", {
        [path]: "That image is not confirmed yet."
      });
    }
  }
  function checkPageSize(doc, nodeId2) {
    const page = pageOf(doc, nodeId2);
    if (page && allNodes(page.root).length > MAX_NODES_PER_PAGE) {
      throw invalid({ parentId: "A page holds at most 500 nodes." });
    }
  }
  function mirrorNodes(doc, nodeId2) {
    return mirrorsOf(doc, nodeId2).map((id) => needNode(doc, id));
  }
  function nodeIsInstanceRoot(node) {
    return node.shared !== void 0;
  }
  function validateMove(parent, index, childType) {
    if (!accepts(parent, childType)) throw invalidMove({ parentId: "That parent can't take it." });
    if (index > parent.children.length) throw invalidMove({ index: "That index is out of range." });
  }
  function makeNode(ctx, type, name, props) {
    return { id: ctx.newId("n"), type, name, props, styles: emptyStyles(), children: [] };
  }
  function validatedProps(ctx, type, given, name) {
    const props = { ...defaultPropsFor(type, name), ...given };
    for (const key of Object.keys(props)) {
      if (!propsOfType(type).includes(key)) throw invalid({ [`props.${key}`]: "Unknown prop." });
    }
    if (type === "image") {
      const imageId = String(props["imageId"] ?? "");
      checkImageRef(ctx, imageId, "props.imageId");
      if (String(props["alt"] ?? "").trim() === "") {
        throw invalid({ "props.alt": "Alt text is required." });
      }
    }
    return props;
  }
  function orderEntries(collection) {
    collection.entries.forEach((entry, i) => {
      entry.order = i;
    });
  }
  function entryValues(doc, ctx, values) {
    const out = {};
    for (const [key, raw] of Object.entries(values)) {
      const field = doc.collection.fields.find((f) => f.name === key);
      if (!field) throw invalid({ [`values.${key}`]: "Unknown field." });
      if (field.kind === "image") {
        checkImageRef(ctx, raw, `values.${key}`);
        out[key] = raw;
        continue;
      }
      if (field.kind === "rich_text") {
        const filtered = filterRichText(raw);
        if (filtered.length > 2e3) {
          throw invalid({ [`values.${key}`]: "Use 2,000 characters or fewer." });
        }
        out[key] = filtered;
        continue;
      }
      if (raw.length > 2e3) throw invalid({ [`values.${key}`]: "Use 2,000 characters or fewer." });
      out[key] = raw;
    }
    return out;
  }
  function insertAt(parent, index, node) {
    parent.children.splice(index, 0, node);
  }
  function detachNode(doc, nodeId2) {
    const { parent, index } = parentOf(doc, nodeId2);
    parent.children.splice(index, 1);
    return { parent, index };
  }
  function sameInstance(doc, nodeId2, parentId) {
    const a = instanceContextOf(doc, nodeId2);
    const b = instanceContextOf(doc, parentId);
    return a !== void 0 && b !== void 0 && a.instanceRoot.id === b.instanceRoot.id;
  }
  function tokenOf(doc, name) {
    return findToken(doc.tokens, name);
  }
  function rewriteTokenName(doc, from, to) {
    for (const node of [
      ...doc.pages.flatMap((page) => allNodes(page.root)),
      ...doc.components.flatMap((component) => allNodes(component.root))
    ]) {
      for (const bp of ["desktop", "tablet", "phone"]) {
        for (const [key, value] of Object.entries(node.styles[bp])) {
          if (value !== void 0 && typeof value !== "string" && value.token === from) {
            node.styles[bp][key] = { token: to };
          }
        }
      }
    }
  }
  function applyOp(doc, op, ctx) {
    switch (op.kind) {
      case "insert_node": {
        const page = needPage(doc, op.pageId);
        const parent = needNode(doc, op.parentId);
        validateMove(parent, op.index, op.type);
        const name = op.name ?? defaultNodeName(op.type, countOfType(page, op.type));
        const props = validatedProps(ctx, op.type, op.props ?? {}, name);
        let createdId = "";
        for (const mirror of mirrorNodes(doc, op.parentId)) {
          const node = makeNode(ctx, op.type, name, { ...props });
          if (op.type === "collection_list") {
            node.children.push(makeNode(ctx, "stack", "Template", {}));
          }
          insertAt(mirror, Math.min(op.index, mirror.children.length), node);
          if (createdId === "") createdId = node.id;
        }
        checkPageSize(doc, createdId);
        return { created: { nodeId: createdId }, inverse: [{ kind: "delete_node", nodeId: createdId }] };
      }
      case "insert_instance": {
        needPage(doc, op.pageId);
        const component = findComponent(doc, op.componentId);
        if (!component) throw notFound();
        const parent = needNode(doc, op.parentId);
        validateMove(parent, op.index, component.root.type);
        const node = cloneNode(component.root, () => ctx.newId("n"));
        node.shared = { componentId: component.id };
        insertAt(parent, op.index, node);
        checkPageSize(doc, node.id);
        return { created: { nodeId: node.id }, inverse: [{ kind: "delete_node", nodeId: node.id }] };
      }
      case "move_node": {
        const node = needNode(doc, op.nodeId);
        const here = findNode(doc, op.nodeId);
        if (!here.parent) throw invalidMove({ parentId: "The page root cannot be moved." });
        const newParent = needNode(doc, op.parentId);
        if (isInSubtree(node, op.parentId)) {
          throw invalidMove({ parentId: "A node can't move into itself." });
        }
        validateMove(newParent, op.index, node.type);
        const oldParentId = here.parent.id;
        const oldIndex = here.index;
        const propagate = !nodeIsInstanceRoot(node) && sameInstance(doc, op.nodeId, op.parentId);
        if (propagate) {
          const nodes = mirrorsOf(doc, op.nodeId);
          const parents = mirrorsOf(doc, op.parentId);
          for (let i = 0; i < nodes.length; i += 1) {
            const target2 = needNode(doc, nodes[i]);
            const parentNode = needNode(doc, parents[i] ?? parents[0]);
            detachNode(doc, target2.id);
            insertAt(parentNode, Math.min(op.index, parentNode.children.length), target2);
          }
        } else {
          detachNode(doc, op.nodeId);
          insertAt(newParent, Math.min(op.index, newParent.children.length), node);
        }
        checkPageSize(doc, op.nodeId);
        return {
          inverse: [
            { kind: "move_node", nodeId: op.nodeId, parentId: oldParentId, index: oldIndex }
          ]
        };
      }
      case "delete_node": {
        const node = needNode(doc, op.nodeId);
        const hit = findNode(doc, op.nodeId);
        if (!hit.parent) throw invalid({ nodeId: "The page root cannot be deleted." });
        const inverse = [];
        const targets = nodeIsInstanceRoot(node) ? [op.nodeId] : mirrorsOf(doc, op.nodeId);
        for (const id of targets) {
          const target2 = findNode(doc, id);
          if (!target2 || !target2.parent) continue;
          const snapshot = JSON.parse(JSON.stringify(target2.node));
          inverse.push({
            kind: "restore_subtree",
            parentId: target2.parent.id,
            index: target2.index,
            node: snapshot
          });
          target2.parent.children.splice(target2.index, 1);
        }
        return { inverse };
      }
      case "restore_subtree": {
        needNode(doc, op.parentId);
        const mirrors = mirrorsOf(doc, op.parentId);
        let first = "";
        for (const [i, parentId] of mirrors.entries()) {
          const mirrorParent = needNode(doc, parentId);
          const node = i === 0 ? JSON.parse(JSON.stringify(op.node)) : cloneNode(op.node, () => ctx.newId("n"));
          insertAt(mirrorParent, Math.min(op.index, mirrorParent.children.length), node);
          if (first === "") first = node.id;
        }
        return { inverse: [{ kind: "delete_node", nodeId: first }] };
      }
      case "duplicate_node": {
        const node = needNode(doc, op.nodeId);
        const hit = findNode(doc, op.nodeId);
        if (!hit.parent) throw invalid({ nodeId: "The page root cannot be duplicated." });
        let createdId = "";
        const targets = nodeIsInstanceRoot(node) ? [op.nodeId] : mirrorsOf(doc, op.nodeId);
        for (const id of targets) {
          const target2 = findNode(doc, id);
          if (!target2 || !target2.parent) continue;
          const copy = cloneNode(target2.node, () => ctx.newId("n"));
          if (target2.node.shared) copy.shared = { ...target2.node.shared };
          insertAt(target2.parent, target2.index + 1, copy);
          if (createdId === "") createdId = copy.id;
        }
        checkPageSize(doc, createdId);
        return {
          created: { nodeId: createdId },
          inverse: [{ kind: "delete_node", nodeId: createdId }]
        };
      }
      case "rename_node": {
        const node = needNode(doc, op.nodeId);
        const before = node.name;
        for (const mirror of mirrorNodes(doc, op.nodeId)) mirror.name = op.name;
        return { inverse: [{ kind: "rename_node", nodeId: op.nodeId, name: before }] };
      }
      case "set_prop": {
        const node = needNode(doc, op.nodeId);
        const value = parsePropValue(node.type, op.prop, op.value);
        if (op.prop === "imageId") checkImageRef(ctx, String(value), "value");
        const before = node.props[op.prop];
        for (const mirror of mirrorNodes(doc, op.nodeId)) mirror.props[op.prop] = value;
        return {
          inverse: [
            {
              kind: "set_prop",
              nodeId: op.nodeId,
              prop: op.prop,
              value: before ?? defaultPropsFor(node.type, node.name)[op.prop] ?? ""
            }
          ]
        };
      }
      case "set_style": {
        const node = needNode(doc, op.nodeId);
        if (typeof op.value !== "string") {
          const token = tokenOf(doc, op.value.token);
          if (!token || token.kind !== STYLE_TOKEN_KIND[op.property]) {
            throw invalid({ value: "That token does not fit this property." });
          }
        }
        const before = node.styles[op.breakpoint][op.property];
        for (const mirror of mirrorNodes(doc, op.nodeId)) {
          mirror.styles[op.breakpoint][op.property] = op.value;
        }
        return {
          inverse: [
            before === void 0 ? { kind: "clear_style", nodeId: op.nodeId, breakpoint: op.breakpoint, property: op.property } : {
              kind: "set_style",
              nodeId: op.nodeId,
              breakpoint: op.breakpoint,
              property: op.property,
              value: before
            }
          ]
        };
      }
      case "clear_style": {
        const node = needNode(doc, op.nodeId);
        const before = node.styles[op.breakpoint][op.property];
        for (const mirror of mirrorNodes(doc, op.nodeId)) {
          delete mirror.styles[op.breakpoint][op.property];
        }
        return {
          inverse: [
            before === void 0 ? { kind: "clear_style", nodeId: op.nodeId, breakpoint: op.breakpoint, property: op.property } : {
              kind: "set_style",
              nodeId: op.nodeId,
              breakpoint: op.breakpoint,
              property: op.property,
              value: before
            }
          ]
        };
      }
      case "set_token": {
        const existing = tokenOf(doc, op.name);
        const token = op.tokenKind === "size" || op.tokenKind === void 0 && typeof op.value === "number" ? { name: op.name, kind: "size", value: op.value, unit: op.unit ?? "px" } : { name: op.name, kind: "color", value: op.value };
        if (existing) {
          const before = { ...existing };
          Object.assign(existing, token);
          if (token.kind === "color") delete existing.unit;
          return {
            inverse: [
              before.kind === "size" ? {
                kind: "set_token",
                name: before.name,
                tokenKind: "size",
                value: before.value,
                unit: before.unit ?? "px"
              } : { kind: "set_token", name: before.name, tokenKind: "color", value: before.value }
            ]
          };
        }
        if (doc.tokens.length >= MAX_TOKENS) {
          throw invalid({ name: "A workspace holds at most 40 tokens." });
        }
        doc.tokens.push(token);
        return { inverse: [{ kind: "delete_token", name: op.name }] };
      }
      case "rename_token": {
        const token = tokenOf(doc, op.name);
        if (!token) throw notFound();
        if (tokenOf(doc, op.newName)) throw invalid({ newName: "That token name is taken." });
        token.name = op.newName;
        rewriteTokenName(doc, op.name, op.newName);
        return { inverse: [{ kind: "rename_token", name: op.newName, newName: op.name }] };
      }
      case "delete_token": {
        const token = tokenOf(doc, op.name);
        if (!token) throw notFound();
        const uses = countTokenUses(doc, op.name);
        if (uses > 0) {
          throw new OpFailure(
            409,
            "token_in_use",
            `Can't delete ${op.name}: it is used ${uses} times.`
          );
        }
        doc.tokens = doc.tokens.filter((t) => t.name !== op.name);
        return {
          inverse: [
            token.kind === "size" ? {
              kind: "set_token",
              name: token.name,
              tokenKind: "size",
              value: token.value,
              unit: token.unit ?? "px"
            } : { kind: "set_token", name: token.name, tokenKind: "color", value: token.value }
          ]
        };
      }
      case "create_component": {
        const node = needNode(doc, op.nodeId);
        const hit = findNode(doc, op.nodeId);
        if (!hit.parent) throw invalid({ nodeId: "A page root cannot become a component." });
        if (node.shared) throw invalid({ nodeId: "That node is already a linked instance." });
        if (instanceContextOf(doc, op.nodeId)) {
          throw invalid({ nodeId: "That node is already inside a linked instance." });
        }
        const component = {
          id: ctx.newId("cp"),
          name: op.name,
          root: cloneNode(node, () => ctx.newId("n"))
        };
        doc.components.push(component);
        node.shared = { componentId: component.id };
        return {
          created: { componentId: component.id },
          inverse: [
            { kind: "detach_instance", nodeId: op.nodeId },
            { kind: "remove_component", componentId: component.id }
          ]
        };
      }
      case "detach_instance": {
        const node = needNode(doc, op.nodeId);
        if (!node.shared) throw invalid({ nodeId: "That node is not a linked instance." });
        const componentId = node.shared.componentId;
        delete node.shared;
        return { inverse: [{ kind: "attach_instance", nodeId: op.nodeId, componentId }] };
      }
      case "attach_instance": {
        const node = needNode(doc, op.nodeId);
        node.shared = { componentId: op.componentId };
        return { inverse: [{ kind: "detach_instance", nodeId: op.nodeId }] };
      }
      case "delete_component": {
        const component = findComponent(doc, op.componentId);
        if (!component) throw notFound();
        const instances = linkedInstances(doc, op.componentId);
        if (instances.length > 0) {
          throw new OpFailure(
            409,
            "component_in_use",
            `Can't delete ${component.name}: ${instances.length} instances still link to it.`
          );
        }
        doc.components = doc.components.filter((c) => c.id !== op.componentId);
        return { inverse: [{ kind: "restore_component", component }] };
      }
      case "remove_component": {
        const component = findComponent(doc, op.componentId);
        if (!component) throw notFound();
        doc.components = doc.components.filter((c) => c.id !== op.componentId);
        return { inverse: [{ kind: "restore_component", component }] };
      }
      case "restore_component": {
        doc.components.push(JSON.parse(JSON.stringify(op.component)));
        return { inverse: [{ kind: "remove_component", componentId: op.component.id }] };
      }
      case "set_fields": {
        const before = JSON.parse(JSON.stringify(doc.collection));
        const kept = new Set(op.fields.map((f) => f.name));
        for (const field of doc.collection.fields) {
          if (kept.has(field.name)) continue;
          const bound = countFieldBindings(doc, field.name);
          if (bound > 0) {
            throw new OpFailure(
              409,
              "field_in_use",
              `Can't remove ${field.name}: it is bound ${bound} times.`
            );
          }
        }
        doc.collection.fields = op.fields.map((f) => ({ ...f }));
        for (const entry of doc.collection.entries) {
          for (const key of Object.keys(entry.values)) {
            if (!kept.has(key)) delete entry.values[key];
          }
        }
        return { inverse: [{ kind: "restore_collection", collection: before }] };
      }
      case "restore_collection": {
        const before = JSON.parse(JSON.stringify(doc.collection));
        doc.collection = JSON.parse(JSON.stringify(op.collection));
        return { inverse: [{ kind: "restore_collection", collection: before }] };
      }
      case "put_entry": {
        const values = entryValues(doc, ctx, op.values);
        if (op.entryId !== void 0) {
          const entry2 = doc.collection.entries.find((e) => e.id === op.entryId);
          if (!entry2) throw notFound();
          const before = { ...entry2.values };
          entry2.values = { ...entry2.values, ...values };
          return { inverse: [{ kind: "put_entry", entryId: entry2.id, values: before }] };
        }
        if (doc.collection.entries.length >= MAX_ENTRIES) {
          throw invalid({ values: "A collection holds at most 200 entries." });
        }
        const entry = {
          id: ctx.newId("e"),
          order: doc.collection.entries.length,
          values
        };
        doc.collection.entries.push(entry);
        return {
          created: { entryId: entry.id },
          inverse: [{ kind: "delete_entry", entryId: entry.id }]
        };
      }
      case "move_entry": {
        const entries = doc.collection.entries;
        const from = entries.findIndex((e) => e.id === op.entryId);
        if (from === -1) throw notFound();
        if (op.index >= entries.length) throw invalid({ index: "That index is out of range." });
        const [entry] = entries.splice(from, 1);
        entries.splice(op.index, 0, entry);
        orderEntries(doc.collection);
        return { inverse: [{ kind: "move_entry", entryId: op.entryId, index: from }] };
      }
      case "delete_entry": {
        const entries = doc.collection.entries;
        const at = entries.findIndex((e) => e.id === op.entryId);
        if (at === -1) throw notFound();
        const [entry] = entries.splice(at, 1);
        orderEntries(doc.collection);
        return { inverse: [{ kind: "restore_entry", entry, index: at }] };
      }
      case "restore_entry": {
        doc.collection.entries.splice(op.index, 0, JSON.parse(JSON.stringify(op.entry)));
        orderEntries(doc.collection);
        return { inverse: [{ kind: "delete_entry", entryId: op.entry.id }] };
      }
      case "bind_prop": {
        const node = needNode(doc, op.nodeId);
        if (op.prop !== mainPropOf(node.type)) {
          throw invalid({ prop: "Only a node s main prop can be bound." });
        }
        if (!insideCollectionList(doc, op.nodeId)) {
          throw invalid({ nodeId: "Only nodes inside a collection list template can be bound." });
        }
        const before = node.bind?.[op.prop] ?? null;
        if (op.field !== null) {
          const field = doc.collection.fields.find((f) => f.name === op.field);
          if (!field) throw invalid({ field: "Unknown field." });
          if (!bindableFieldKinds(node.type, op.prop).includes(field.kind)) {
            throw invalid({ field: "That field kind does not fit this prop." });
          }
        }
        for (const mirror of mirrorNodes(doc, op.nodeId)) {
          if (op.field === null) {
            if (mirror.bind) {
              delete mirror.bind[op.prop];
              if (Object.keys(mirror.bind).length === 0) delete mirror.bind;
            }
          } else {
            mirror.bind = { ...mirror.bind ?? {}, [op.prop]: op.field };
          }
        }
        return { inverse: [{ kind: "bind_prop", nodeId: op.nodeId, prop: op.prop, field: before }] };
      }
      case "add_page": {
        if (doc.pages.length >= MAX_PAGES) {
          throw invalid({ name: "A workspace holds at most 20 pages." });
        }
        const pageId = ctx.newId("pg");
        const root2 = {
          id: ctx.newId("n"),
          type: "page",
          name: op.name,
          props: {},
          styles: emptyStyles(),
          children: []
        };
        const page = {
          id: pageId,
          name: op.name,
          slug: uniquePageSlug(doc, op.name),
          order: doc.pages.length,
          root: root2
        };
        doc.pages.push(page);
        return {
          created: { pageId, nodeId: root2.id },
          inverse: [{ kind: "remove_page", pageId }]
        };
      }
      case "remove_page": {
        const index = doc.pages.findIndex((p) => p.id === op.pageId);
        if (index === -1) throw notFound();
        const [page] = doc.pages.splice(index, 1);
        doc.pages.forEach((p, i) => {
          p.order = i;
        });
        return { inverse: [{ kind: "restore_page", page, index }] };
      }
      case "restore_page": {
        doc.pages.splice(op.index, 0, JSON.parse(JSON.stringify(op.page)));
        doc.pages.forEach((p, i) => {
          p.order = i;
        });
        return { inverse: [{ kind: "remove_page", pageId: op.page.id }] };
      }
      case "rename_page": {
        const page = needPage(doc, op.pageId);
        const before = page.name;
        page.name = op.name;
        page.root.name = op.name;
        return { inverse: [{ kind: "rename_page", pageId: op.pageId, name: before }] };
      }
      case "restore_doc": {
        const before = documentSnapshot(doc);
        const next = JSON.parse(JSON.stringify(op.document));
        doc.name = next.name;
        doc.slug = next.slug;
        doc.tokens = next.tokens;
        doc.pages = next.pages;
        doc.components = next.components;
        doc.collection = next.collection;
        return { inverse: [{ kind: "restore_doc", document: before }] };
      }
      case "undo":
      case "redo":
      case "restore":
        throw invalid({ kind: "That operation is handled by the server." });
    }
  }
  function documentSnapshot(doc) {
    const { seq, ...rest } = doc;
    void seq;
    return JSON.parse(JSON.stringify(rest));
  }
  function insideCollectionList(doc, nodeId2) {
    const lists = [
      ...doc.pages.flatMap((page) => allNodes(page.root)),
      ...doc.components.flatMap((component) => allNodes(component.root))
    ].filter((node) => node.type === "collection_list");
    return lists.some((list) => list.id !== nodeId2 && isInSubtree(list, nodeId2));
  }
  function uniquePageSlug(doc, name) {
    return uniqueSlug(name, doc.pages.map((p) => p.slug));
  }

  var TOAST_MS = 4e3;
  var toast;
  var toastTimer;
  function announcer() {
    const node = document.getElementById("announcer");
    if (node) return node;
    const made = document.createElement("div");
    made.id = "announcer";
    made.setAttribute("role", "status");
    made.setAttribute("aria-live", "polite");
    made.setAttribute("data-announcement-count", "0");
    document.body.append(made);
    return made;
  }
  function announce(text) {
    const node = announcer();
    node.textContent = "";
    node.textContent = text;
    const count = Number(node.getAttribute("data-announcement-count") ?? "0") + 1;
    node.setAttribute("data-announcement-count", String(count));
  }
  function announceWithToast(text) {
    announce(text);
    showToast(text);
  }
  function showToast(text) {
    if (!toast) {
      toast = document.createElement("div");
      toast.setAttribute("data-toast", "");
      toast.setAttribute("aria-hidden", "true");
      document.body.append(toast);
    }
    toast.textContent = text;
    toast.hidden = false;
    if (toastTimer !== void 0) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      if (toast) toast.hidden = true;
    }, TOAST_MS);
  }

  var state = {
    workspaceId: "",
    workspaceName: "",
    user: { id: "", name: "" },
    role: "viewer",
    doc: {
      id: "",
      name: "",
      slug: "",
      seq: 0,
      tokens: [],
      pages: [],
      components: [],
      collection: { name: "Entries", fields: [], entries: [] }
    },
    previewDoc: null,
    previewVersion: null,
    pageId: "",
    bp: "desktop",
    panel: "none",
    selectedId: null,
    collapsed: new Set(),
    seq: 0,
    presence: [],
    remoteSelections: new Map(),
    images: [],
    versions: [],
    threads: [],
    members: [],
    publish: { state: "not_published", publishId: null, publishedSeq: null, url: null },
    storageDown: false,
    fan: { motion: "closed", progress: 0 },
    stylePanel: { motion: "open", progress: 1 },
    navigatorOpen: false,
    layout: "desktop",
    updatedFrames: new Set(),
    busy: { upload: false, publish: false, restore: false },
    publishFailed: false
  };
  var renderHook = () => void 0;
  function setRenderHook(hook) {
    renderHook = hook;
  }
  function render() {
    renderHook();
  }
  function canEdit() {
    return (state.role === "owner" || state.role === "editor") && state.previewDoc === null;
  }
  function activeDoc() {
    return state.previewDoc ?? state.doc;
  }
  function currentPage() {
    const doc = activeDoc();
    return findPage(doc, state.pageId) ?? doc.pages[0];
  }
  function nodeById(nodeId2) {
    if (nodeId2 === null) return void 0;
    return findNode(activeDoc(), nodeId2)?.node;
  }
  function selectedNode() {
    return nodeById(state.selectedId);
  }
  function orderedEntries() {
    return [...activeDoc().collection.entries].sort((a, b) => a.order - b.order);
  }
  function syncUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("page", state.pageId);
    url.searchParams.set("bp", state.bp);
    if (state.panel === "publish") url.searchParams.set("panel", "publish");
    else url.searchParams.delete("panel");
    if (state.previewVersion) url.searchParams.set("version", state.previewVersion.id);
    else url.searchParams.delete("version");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }
  var socket;
  var opCounter = 0;
  var clientId = Math.random().toString(36).slice(2, 10);
  var waiting = new Map();
  var OpRejected = class extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  };
  function replayIds(ids) {
    let index = 0;
    return {
      newId: () => {
        const id = ids[index];
        index += 1;
        if (id === void 0) throw new Error("The server issued no id for this change.");
        return id;
      }
    };
  }
  function localContext() {
    return {
      newId: () => {
        throw new Error("Ids come from the server.");
      }
    };
  }
  var ID_CREATING = new Set([
    "insert_node",
    "insert_instance",
    "duplicate_node",
    "add_page",
    "create_component"
  ]);
  function createsIds(body) {
    if (body.kind === "put_entry") return body.entryId === void 0;
    return ID_CREATING.has(body.kind);
  }
  async function reloadDocument() {
    const doc = await api.get(`/api/workspaces/${state.workspaceId}/document`);
    state.doc = doc;
    state.seq = doc.seq;
    if (!findPage(doc, state.pageId)) state.pageId = doc.pages[0]?.id ?? "";
    render();
  }
  function announceRejection(code, message, body) {
    if (code === "invalid_move") {
      const nodeId2 = "nodeId" in body ? body.nodeId : void 0;
      const node = nodeId2 === void 0 ? void 0 : nodeById(nodeId2);
      announceWithToast(notices.refusedMove(node?.name ?? "that node"));
      return;
    }
    announceWithToast(message);
  }
  async function send(body) {
    opCounter += 1;
    const opId = `${clientId}-${opCounter}`;
    const baseSeq = state.seq;
    const optimistic = !createsIds(body) && body.kind !== "undo" && body.kind !== "redo";
    if (optimistic) {
      applyOp(state.doc, body, localContext());
      render();
    }
    const envelope = { opId, baseSeq, ...body };
    try {
      const ack = await new Promise((resolve, reject) => {
        if (socket !== void 0 && socket.readyState === WebSocket.OPEN) {
          waiting.set(opId, { resolve, reject });
          socket.send(JSON.stringify({ type: "op", op: envelope }));
          return;
        }
        api.post(
          `/api/workspaces/${state.workspaceId}/operations`,
          envelope
        ).then((result) => {
          resolve({ seq: result.seq, created: result.created ?? null, ids: [], effects: null });
        }).catch(reject);
      });
      state.seq = Math.max(state.seq, ack.seq);
      state.doc.seq = state.seq;
      operationAccepted();
      if (!optimistic) {
        const ctx = replayIds(ack.ids);
        for (const effect of ack.effects ?? [body]) applyOp(state.doc, effect, ctx);
        repairSelection();
        render();
      }
      return ack;
    } catch (error) {
      const code = error instanceof OpRejected ? error.code : "error";
      const message = error instanceof Error ? error.message : "Something went wrong.";
      await reloadDocument();
      announceRejection(code, message, body);
      throw error;
    }
  }
  function repairSelection() {
    if (state.selectedId !== null && !findNode(state.doc, state.selectedId)) {
      state.selectedId = currentPage()?.root.id ?? null;
    }
  }
  function applyRemote(message) {
    const seq = Number(message["seq"] ?? 0);
    const ids = message["ids"] ?? [];
    const effects = message["effects"] ?? null;
    const op = message["op"];
    const ctx = replayIds(ids);
    for (const effect of effects ?? [op]) applyOp(state.doc, effect, ctx);
    state.seq = Math.max(state.seq, seq);
    state.doc.seq = state.seq;
    repairSelection();
    operationAccepted();
  }
  var acceptedHooks = [];
  function onAccepted(hook) {
    acceptedHooks.push(hook);
  }
  function operationAccepted() {
    for (const hook of acceptedHooks) hook();
  }
  var liveHandlers = [];
  function onLive(handler) {
    liveHandlers.push(handler);
  }
  function handleMessage(message) {
    const type = message["type"];
    if (type === "ack") {
      const opId = String(message["opId"]);
      const pending = waiting.get(opId);
      waiting.delete(opId);
      pending?.resolve({
        seq: Number(message["seq"]),
        created: message["created"] ?? null,
        ids: message["ids"] ?? [],
        effects: message["effects"] ?? null
      });
      return;
    }
    if (type === "reject") {
      const opId = String(message["opId"]);
      const pending = waiting.get(opId);
      waiting.delete(opId);
      const error = message["error"] ?? {};
      pending?.reject(
        new OpRejected(String(error.code ?? "error"), String(error.message ?? "Refused."))
      );
      return;
    }
    if (type === "op") {
      const author = message["author"] ?? {};
      if (author.id !== state.user.id) {
        applyRemote(message);
        for (const handler of liveHandlers) handler(message);
        render();
      }
      return;
    }
    for (const handler of liveHandlers) handler(message);
  }
  function connectLive() {
    const url = new URL(window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = `?workspace=${state.workspaceId}`;
    const connection = new WebSocket(url);
    socket = connection;
    connection.addEventListener("message", (event) => {
      let parsed;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      handleMessage(parsed);
    });
    connection.addEventListener("close", (event) => {
      socket = void 0;
      if (event.code === 4404) window.location.assign("/");
    });
  }
  function sendLive(message) {
    if (socket !== void 0 && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
  function sayWithToast(text) {
    announceWithToast(text);
  }

  var GAP = 24;
  var canvasEl;
  var stageEl;
  var styleEl;
  var frames = new Map();
  var TAGS = {
    page: "div",
    section: "section",
    stack: "div",
    heading: "h1",
    text: "p",
    image: "img",
    button: "a",
    nav: "nav",
    collection_list: "ul"
  };
  function canvasElement() {
    if (canvasEl) return canvasEl;
    styleEl = document.createElement("style");
    styleEl.id = "canvas-styles";
    stageEl = el("div", { id: "canvas-stage" });
    const line = el("div", { id: "cascade-line", "aria-hidden": "true", hidden: true });
    for (const bp of BREAKPOINTS) {
      const frame2 = el("div", {
        "data-frame": bp,
        tabindex: "-1",
        role: "group",
        "aria-label": `${breakpointLabel(bp)} ${FRAME_WIDTH[bp]} frame`,
        class: "frame"
      });
      frame2.style.width = `${FRAME_WIDTH[bp]}px`;
      frames.set(bp, frame2);
      stageEl.append(frame2);
    }
    canvasEl = el("div", {
      id: "canvas",
      role: "region",
      "aria-label": "Canvas",
      tabindex: "0",
      "data-fan": "closed",
      "data-fan-progress": "0.00"
    }, [styleEl, stageEl, line]);
    return canvasEl;
  }
  function frameElement(bp) {
    canvasElement();
    return frames.get(bp);
  }
  function cascadeLine() {
    return canvasElement().querySelector("#cascade-line");
  }
  function headingTag(node) {
    const level = Math.min(3, Math.max(1, Number(node.props["level"] ?? 1)));
    return level === 1 ? "h1" : level === 2 ? "h2" : "h3";
  }
  function tagFor(node) {
    return node.type === "heading" ? headingTag(node) : TAGS[node.type];
  }
  function keyOf(item) {
    return item.entry === void 0 ? item.node.id : `${item.node.id}:${item.entry.id}`;
  }
  function createNodeElement(item) {
    const element = document.createElement(tagFor(item.node));
    element.dataset["wantTag"] = tagFor(item.node);
    return element;
  }
  function updateNodeElement(element, item) {
    const node = item.node;
    if (element.dataset["wantTag"] !== tagFor(node)) {
      const replacement = createNodeElement(item);
      replacement.dataset["key"] = element.dataset["key"] ?? keyOf(item);
      element.replaceWith(replacement);
      element = replacement;
    }
    setAttr(element, "data-node-id", node.id);
    setAttr(element, "data-node-type", node.type);
    setAttr(element, "role", "group");
    setAttr(element, "aria-roledescription", node.type);
    setAttr(element, "aria-label", node.name);
    setAttr(element, "class", `pl-node pl-${node.type} n-${node.id}`);
    if (item.entry !== void 0) setAttr(element, "data-entry-id", item.entry.id);
    else element.removeAttribute("data-entry-id");
    setAttr(element, "data-selected", state.selectedId === node.id ? "true" : void 0);
    const selectedBy = [...state.remoteSelections.entries()].find(([, id]) => id === node.id);
    setAttr(element, "data-selected-by", selectedBy ? selectedBy[0] : void 0);
    const doc = activeDoc();
    if (node.type === "heading" || node.type === "text" || node.type === "button") {
      const bound = boundPropValue(node, "text", item.entry, doc.collection.fields);
      if (node.type === "text" && bound.field?.kind === "rich_text") {
        if (element.innerHTML !== bound.value) element.innerHTML = bound.value;
      } else {
        setText(element, bound.value);
      }
      if (node.type === "button") {
        setAttr(element, "href", String(node.props["href"] ?? "/"));
      }
      return element;
    }
    if (node.type === "image") {
      const bound = boundPropValue(node, "imageId", item.entry, doc.collection.fields);
      const src = bound.value === "" ? "" : `/api/images/${bound.value}`;
      setAttr(element, "src", src);
      setAttr(element, "alt", String(node.props["alt"] ?? ""));
      element.style.objectPosition = focalPosition(node);
      return element;
    }
    if (node.type === "collection_list") {
      renderListRows(element, node);
      return element;
    }
    renderChildren(element, node, item.entry);
    return element;
  }
  function renderChildren(element, node, entry) {
    patchChildren(
      element,
      node.children.map((child) => ({ node: child, entry })),
      keyOf,
      createNodeElement,
      (child, item) => {
        updateNodeElement(child, item);
      }
    );
  }
  function renderListRows(element, node) {
    const template = node.children[0];
    const entries = [...activeDoc().collection.entries].sort((a, b) => a.order - b.order);
    if (template === void 0 || entries.length === 0) {
      const empty = el("li", { class: "pl-empty-list", "data-key": "empty" }, [notices.emptyList]);
      patchChildren(
        element,
        [empty],
        () => "empty",
        () => empty,
        () => void 0
      );
      return;
    }
    patchChildren(
      element,
      entries,
      (entry) => entry.id,
      () => el("li"),
      (row2, entry) => {
        setAttr(row2, "data-collection-row", entry.id);
        patchChildren(
          row2,
          [{ node: template, entry }],
          keyOf,
          createNodeElement,
          (child, item) => {
            updateNodeElement(child, item);
          }
        );
      }
    );
  }
  function visibleFrames() {
    if (state.layout === "phone") return ["phone"];
    if (state.fan.motion === "closed") return [state.bp];
    return [...BREAKPOINTS];
  }
  function clamp(value) {
    return Math.min(1, Math.max(0, value));
  }
  function layoutFrames() {
    const canvas = canvasElement();
    const stage = stageEl;
    const shown = visibleFrames();
    const progress = state.fan.progress;
    const available = Math.max(canvas.clientWidth - 32, 320);
    const openScale = Math.min(
      1,
      available / (FRAME_WIDTH.desktop + FRAME_WIDTH.tablet + FRAME_WIDTH.phone + GAP * 2)
    );
    const soloScale = Math.min(1, available / FRAME_WIDTH[state.bp]);
    const scale = soloScale + (openScale - soloScale) * progress;
    stage.style.transform = `scale(${scale})`;
    const shares = {
      desktop: 1,
      tablet: progress,
      phone: clamp((progress * 420 - 90) / 330)
    };
    const offsets = {
      desktop: 0,
      tablet: FRAME_WIDTH.desktop + GAP,
      phone: FRAME_WIDTH.desktop + GAP + FRAME_WIDTH.tablet + GAP
    };
    for (const bp of BREAKPOINTS) {
      const frame2 = frameElement(bp);
      const visible = shown.includes(bp);
      frame2.hidden = !visible;
      if (!visible) continue;
      const slide = shown.length === 1 ? 0 : -offsets[bp] * (1 - shares[bp]);
      frame2.style.transform = `translateX(${slide}px)`;
      frame2.style.opacity = String(shown.length === 1 ? 1 : Math.max(shares[bp], 0.15));
    }
    const line = cascadeLine();
    line.hidden = state.fan.motion === "closed";
  }
  function renderCanvas() {
    const canvas = canvasElement();
    const page = currentPage();
    if (!page) return;
    styleEl.textContent = editorFrameCss(page, activeDoc().tokens);
    setAttr(canvas, "data-fan", state.fan.motion);
    setAttr(canvas, "data-fan-progress", state.fan.progress.toFixed(2));
    for (const bp of BREAKPOINTS) {
      const frame2 = frameElement(bp);
      if (!visibleFrames().includes(bp)) continue;
      patchChildren(
        frame2,
        [{ node: page.root, entry: void 0 }],
        keyOf,
        createNodeElement,
        (element, item) => {
          updateNodeElement(element, item);
        }
      );
    }
    layoutFrames();
  }
  function scrollNodeIntoView(nodeId2) {
    const element = frameElement(state.bp).querySelector(`[data-node-id="${nodeId2}"]`);
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function pageNodeIds() {
    const page = currentPage();
    return page ? allNodes(page.root).map((node) => node.id) : [];
  }

  var container;
  var treeEl;
  function rowName(node) {
    let name = `${node.name}, ${node.type}`;
    if (node.shared !== void 0) name += ", shared";
    if (node.bind !== void 0 && Object.keys(node.bind).length > 0) name += ", bound";
    return name;
  }
  function navigatorElement() {
    if (container) return container;
    treeEl = el("div", { role: "tree", "aria-label": "Navigator", id: "navigator-tree" });
    const add = button("Add page", { class: "ghost", id: "add-page" });
    add.prepend(icon("plus"));
    add.addEventListener("click", () => {
      void addPage();
    });
    container = el("div", { id: "navigator", class: "panel-column" }, [
      el("div", { class: "panel-head" }, [el("h2", {}, ["Navigator"])]),
      treeEl,
      add
    ]);
    return container;
  }
  function rows() {
    const page = currentPage();
    if (!page) return [];
    const out = [];
    const walk2 = (node, level, position, setSize, parentId) => {
      out.push({ node, level, position, setSize, parentId });
      if (state.collapsed.has(node.id)) return;
      node.children.forEach((child, index) => {
        walk2(child, level + 1, index + 1, node.children.length, node.id);
      });
    };
    walk2(page.root, 1, 1, 1, null);
    return out;
  }
  function rowElement(nodeId2) {
    return treeEl?.querySelector(`[role="treeitem"][data-node-id="${nodeId2}"]`) ?? void 0;
  }
  function navigatorVisible() {
    if (state.layout === "desktop") return true;
    if (state.layout === "phone") return false;
    return state.navigatorOpen;
  }
  function focusNodeRow(nodeId2) {
    if (!navigatorVisible()) {
      canvasElement().focus();
      return;
    }
    const row2 = rowElement(nodeId2);
    if (row2) {
      setRoving(nodeId2);
      row2.focus();
      return;
    }
    canvasElement().focus();
  }
  function setRoving(nodeId2) {
    for (const row2 of treeEl?.querySelectorAll('[role="treeitem"]') ?? []) {
      row2.tabIndex = row2.dataset["nodeId"] === nodeId2 ? 0 : -1;
    }
  }
  function startRename(row2, node) {
    if (!canEdit()) return;
    const label = row2.querySelector(".row-name");
    if (!label) return;
    const input = el("input", { type: "text", "aria-label": "Name", class: "rename" });
    input.value = node.name;
    label.hidden = true;
    row2.append(input);
    input.focus();
    input.select();
    let done = false;
    const finishRename = (commit) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (input.parentNode !== null) input.parentNode.removeChild(input);
      label.hidden = false;
      row2.focus();
      if (commit && value !== "" && value !== node.name) void renameNode(node.id, value);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finishRename(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finishRename(false);
      }
    });
    input.addEventListener("blur", () => {
      finishRename(true);
    });
  }
  function renameFocusedRow() {
    const nodeId2 = state.selectedId;
    if (nodeId2 === null) return;
    const row2 = rowElement(nodeId2);
    const node = currentPage() ? rowOf(nodeId2) : void 0;
    if (row2 && node) startRename(row2, node);
  }
  function rowOf(nodeId2) {
    return rows().find((row2) => row2.node.id === nodeId2)?.node;
  }
  function renderNavigator() {
    navigatorElement();
    const list = rows();
    patchChildren(
      treeEl,
      list,
      (row2) => row2.node.id,
      () => {
        const row2 = el("div", { role: "treeitem", tabindex: "-1", class: "nav-row" }, [
          el("span", { class: "twisty", "aria-hidden": "true" }),
          el("span", { class: "row-name" })
        ]);
        row2.addEventListener("click", () => {
          const nodeId2 = row2.dataset["nodeId"];
          if (nodeId2 !== void 0) {
            setRoving(nodeId2);
            row2.focus();
            selectNode(nodeId2);
          }
        });
        row2.addEventListener("dblclick", () => {
          const node = rowOf(row2.dataset["nodeId"] ?? "");
          if (node) startRename(row2, node);
        });
        return row2;
      },
      (element, row2) => {
        setAttr(element, "data-node-id", row2.node.id);
        setAttr(element, "aria-level", String(row2.level));
        setAttr(element, "aria-posinset", String(row2.position));
        setAttr(element, "aria-setsize", String(row2.setSize));
        setAttr(element, "aria-selected", state.selectedId === row2.node.id ? "true" : "false");
        setAttr(element, "aria-label", rowName(row2.node));
        element.style.setProperty("--level", String(row2.level));
        const hasChildren = takesChildren(row2.node.type) && row2.node.children.length > 0;
        if (hasChildren) {
          setAttr(element, "aria-expanded", state.collapsed.has(row2.node.id) ? "false" : "true");
        } else {
          element.removeAttribute("aria-expanded");
        }
        const twisty = element.querySelector(".twisty");
        setText(twisty, hasChildren ? state.collapsed.has(row2.node.id) ? ">" : "v" : "");
        setText(element.querySelector(".row-name"), rowName(row2.node));
        element.classList.toggle("selected", state.selectedId === row2.node.id);
      }
    );
    const rovingId = state.selectedId !== null && list.some((row2) => row2.node.id === state.selectedId) ? state.selectedId : list[0]?.node.id;
    if (rovingId !== void 0) setRoving(rovingId);
    const addButton = container.querySelector("#add-page");
    addButton.hidden = !canEdit();
    const visible = navigatorVisible();
    container.hidden = !visible;
    if (visible) container.removeAttribute("inert");
    else container.setAttribute("inert", "");
    container.classList.toggle("drawer", state.layout === "tablet");
  }

  var FAN_MS = 420;
  var EFFECT_MS = 160;
  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function fanAvailable() {
    return state.layout !== "phone" && state.selectedId !== null;
  }
  var frame = 0;
  var timer = 0;
  var direction = 0;
  var anchorTime = 0;
  var anchorProgress = 0;
  function paint() {
    const canvas = canvasElement();
    setAttr(canvas, "data-fan", state.fan.motion);
    setAttr(canvas, "data-fan-progress", state.fan.progress.toFixed(2));
    layoutFrames();
  }
  function stop() {
    if (frame !== 0) window.cancelAnimationFrame(frame);
    if (timer !== 0) window.clearTimeout(timer);
    frame = 0;
    timer = 0;
    direction = 0;
  }
  function finish() {
    stop();
    render();
    if (state.fan.motion === "closed" && state.selectedId !== null) focusNodeRow(state.selectedId);
  }
  function settle() {
    const open = direction > 0;
    state.fan.progress = open ? 1 : 0;
    state.fan.motion = open ? "open" : "closed";
    paint();
    finish();
  }
  function step(now) {
    const next = anchorProgress + direction * (now - anchorTime) / FAN_MS;
    state.fan.progress = Math.min(1, Math.max(0, next));
    if (direction > 0 && state.fan.progress >= 1 || direction < 0 && state.fan.progress <= 0) {
      settle();
      return;
    }
    state.fan.motion = direction > 0 ? "opening" : "closing";
    paint();
    frame = window.requestAnimationFrame(step);
  }
  function run(towards) {
    direction = towards;
    state.fan.motion = towards > 0 ? "opening" : "closing";
    if (reducedMotion()) {
      state.fan.progress = towards > 0 ? 1 : 0;
      state.fan.motion = towards > 0 ? "open" : "closed";
      stop();
      direction = 0;
      paint();
      render();
      if (state.fan.motion === "closed" && state.selectedId !== null) focusNodeRow(state.selectedId);
      return;
    }
    render();
    paint();
    anchorProgress = state.fan.progress;
    anchorTime = performance.now();
    const remaining = (towards > 0 ? 1 - anchorProgress : anchorProgress) * FAN_MS;
    if (timer !== 0) window.clearTimeout(timer);
    timer = window.setTimeout(settle, remaining);
    if (frame === 0) frame = window.requestAnimationFrame(step);
  }
  function openFan() {
    if (!fanAvailable()) return;
    if (state.fan.motion === "open") return;
    run(1);
  }
  function closeFan() {
    if (state.fan.motion === "closed") return;
    run(-1);
  }
  function toggleFan() {
    if (state.fan.motion === "open" || state.fan.motion === "opening") {
      closeFan();
      return;
    }
    openFan();
  }
  function fanShowing() {
    return state.fan.motion !== "closed";
  }
  function clearUpdatedTags() {
    for (const tag of document.querySelectorAll("[data-updated-tag]")) tag.remove();
  }
  function rippleFrames(breakpoints) {
    clearUpdatedTags();
    if (reducedMotion()) {
      for (const bp of breakpoints) {
        const tag = document.createElement("span");
        tag.setAttribute("data-updated-tag", "");
        tag.className = "updated-tag";
        tag.textContent = "Updated";
        frameElement(bp).append(tag);
      }
      return;
    }
    for (const bp of breakpoints) {
      const element = frameElement(bp);
      element.setAttribute("data-ripple", "true");
      window.setTimeout(() => element.removeAttribute("data-ripple"), EFFECT_MS);
    }
  }
  function pulsePips(breakpoints, property) {
    if (reducedMotion()) return;
    for (const bp of breakpoints) {
      const pip = document.querySelector(
        `[data-property="${property}"] [data-pip="${bp}"]`
      );
      if (!pip) continue;
      pip.setAttribute("data-pulse", "true");
      window.setTimeout(() => pip.removeAttribute("data-pulse"), EFFECT_MS);
    }
  }
  function focusFrame(bp) {
    frameElement(bp).focus();
  }

  function fire(body) {
    void send(body).catch(() => void 0);
  }
  function instanceNotice(nodeId2) {
    const component = componentOfNode(state.doc, nodeId2);
    if (!component) return;
    const count = linkedInstances(state.doc, component.id).length;
    sayWithToast(notices.sharedEdit(count, component.name));
  }
  function selectNode(nodeId2) {
    state.selectedId = nodeId2;
    sendLive({ type: "select", nodeId: nodeId2 });
    render();
    scrollNodeIntoView(nodeId2);
  }
  function insertTarget(type) {
    const page = currentPage();
    if (!page) return { parentId: "", index: 0 };
    const selected = selectedNode();
    if (!selected) return { parentId: page.root.id, index: page.root.children.length };
    if (accepts(selected, type)) {
      return { parentId: selected.id, index: selected.children.length };
    }
    let candidate = selected;
    while (candidate !== void 0) {
      const hit = findNode(state.doc, candidate.id);
      if (!hit?.parent) break;
      if (accepts(hit.parent, type)) return { parentId: hit.parent.id, index: hit.index + 1 };
      candidate = hit.parent;
    }
    return { parentId: page.root.id, index: page.root.children.length };
  }
  async function insertNodeAt(type, parentId, index, props) {
    const page = currentPage();
    if (!page || !canEdit()) return;
    const ack = await send({
      kind: "insert_node",
      pageId: page.id,
      parentId,
      index,
      type,
      ...props === void 0 ? {} : { props }
    });
    const nodeId2 = ack.created?.["nodeId"];
    if (nodeId2 === void 0) return;
    state.selectedId = nodeId2;
    sendLive({ type: "select", nodeId: nodeId2 });
    render();
    const node = nodeById(nodeId2);
    if (node) sayWithToast(notices.inserted(node.name));
    instanceNotice(nodeId2);
    focusNodeRow(nodeId2);
  }
  async function insertNode(type, props) {
    const target2 = insertTarget(type);
    await insertNodeAt(type, target2.parentId, target2.index, props);
  }
  async function insertInstance(componentId) {
    const page = currentPage();
    if (!page || !canEdit()) return;
    const component = state.doc.components.find((item) => item.id === componentId);
    if (!component) return;
    const target2 = insertTarget(component.root.type);
    const ack = await send({
      kind: "insert_instance",
      pageId: page.id,
      parentId: target2.parentId,
      index: target2.index,
      componentId
    });
    const nodeId2 = ack.created?.["nodeId"];
    if (nodeId2 === void 0) return;
    state.selectedId = nodeId2;
    render();
    const node = nodeById(nodeId2);
    if (node) sayWithToast(notices.inserted(node.name));
    focusNodeRow(nodeId2);
  }
  function refuse(node) {
    sayWithToast(notices.refusedMove(node.name));
  }
  function moveAllowed(nodeId2, parentId, index) {
    const node = nodeById(nodeId2);
    const parent = nodeById(parentId);
    if (!node || !parent) return false;
    if (!accepts(parent, node.type)) return false;
    if (findNode(state.doc, parentId) === void 0) return false;
    if (nodeId2 === parentId) return false;
    if (findNode(state.doc, nodeId2)?.parent === null) return false;
    if (isInSubtree(node, parentId)) return false;
    const here = findNode(state.doc, nodeId2);
    const siblings = here.parent?.id === parentId ? parent.children.length - 1 : parent.children.length;
    return index >= 0 && index <= siblings;
  }
  function moveNodeTo(nodeId2, parentId, index) {
    const node = nodeById(nodeId2);
    if (!node || !canEdit()) return;
    if (!moveAllowed(nodeId2, parentId, index)) {
      refuse(node);
      return;
    }
    fire({ kind: "move_node", nodeId: nodeId2, parentId, index });
    const parent = nodeById(parentId);
    const position = (parent?.children.findIndex((child) => child.id === nodeId2) ?? 0) + 1;
    sayWithToast(
      notices.moved(node.name, position, parent?.children.length ?? 1, parent?.name ?? "")
    );
    instanceNotice(nodeId2);
    focusNodeRow(nodeId2);
  }
  function moveByKeyboard(nodeId2, direction2) {
    const node = nodeById(nodeId2);
    if (!node || !canEdit()) return;
    const hit = findNode(state.doc, nodeId2);
    if (!hit || !hit.parent) {
      refuse(node);
      return;
    }
    const parent = hit.parent;
    if (direction2 === "up" || direction2 === "down") {
      const index = direction2 === "up" ? hit.index - 1 : hit.index + 1;
      if (index < 0 || index > parent.children.length - 1) {
        refuse(node);
        return;
      }
      moveNodeTo(nodeId2, parent.id, index);
      return;
    }
    if (direction2 === "indent") {
      const previous = parent.children[hit.index - 1];
      if (!previous || !accepts(previous, node.type)) {
        refuse(node);
        return;
      }
      moveNodeTo(nodeId2, previous.id, previous.children.length);
      return;
    }
    const grandparent = findNode(state.doc, parent.id)?.parent;
    if (!grandparent) {
      refuse(node);
      return;
    }
    const parentIndex = grandparent.children.findIndex((child) => child.id === parent.id);
    moveNodeTo(nodeId2, grandparent.id, parentIndex + 1);
  }
  function deleteNode(nodeId2) {
    const node = nodeById(nodeId2);
    if (!node || !canEdit()) return;
    const hit = findNode(state.doc, nodeId2);
    if (!hit || !hit.parent) return;
    const parentId = hit.parent.id;
    const index = hit.index;
    fire({ kind: "delete_node", nodeId: nodeId2 });
    sayWithToast(notices.deleted(node.name));
    const parent = nodeById(parentId);
    const successor = parent?.children[index] ?? parent?.children[index - 1];
    state.selectedId = successor?.id ?? parentId;
    render();
    focusNodeRow(state.selectedId);
  }
  async function duplicateNode(nodeId2) {
    if (!canEdit()) return;
    const ack = await send({ kind: "duplicate_node", nodeId: nodeId2 });
    const copyId = ack.created?.["nodeId"];
    if (copyId === void 0) return;
    state.selectedId = copyId;
    render();
    instanceNotice(copyId);
    focusNodeRow(copyId);
  }
  async function renameNode(nodeId2, name) {
    if (!canEdit()) return;
    await send({ kind: "rename_node", nodeId: nodeId2, name });
    instanceNotice(nodeId2);
  }
  function setStyleValue(nodeId2, property, value) {
    const node = nodeById(nodeId2);
    if (!node || !canEdit()) return;
    const bp = state.bp;
    fire({ kind: "set_style", nodeId: nodeId2, breakpoint: bp, property, value });
    const updated = nodeById(nodeId2);
    if (!updated) return;
    const groups2 = reachOfChange(updated, bp, property);
    if (fanShowing()) {
      rippleFrames(groups2.inherited);
      pulsePips(groups2.kept, property);
      sayWithToast(notices.cascade(property, bp, groups2.inherited, groups2.kept));
    }
    instanceNotice(nodeId2);
  }
  function clearStyleValue(nodeId2, property) {
    const node = nodeById(nodeId2);
    if (!node || !canEdit()) return;
    const bp = state.bp;
    if (!canClearOverride(node, bp, property)) return;
    fire({ kind: "clear_style", nodeId: nodeId2, breakpoint: bp, property });
    const updated = nodeById(nodeId2);
    if (!updated) return;
    const frames2 = reachOfClear(updated, bp, property);
    if (fanShowing()) rippleFrames(frames2);
    sayWithToast(
      notices.overrideCleared(property, bp, styleValueText(resolveStyle(updated, bp, property)))
    );
    instanceNotice(nodeId2);
  }
  function setPropValue(nodeId2, prop, value) {
    if (!canEdit()) return;
    fire({ kind: "set_prop", nodeId: nodeId2, prop, value });
    instanceNotice(nodeId2);
  }
  function bindProp(nodeId2, prop, field) {
    if (!canEdit()) return;
    fire({ kind: "bind_prop", nodeId: nodeId2, prop, field });
    instanceNotice(nodeId2);
  }
  function setToken(name, tokenKind, value, unit) {
    if (!canEdit()) return;
    fire(
      tokenKind === "size" ? { kind: "set_token", name, tokenKind, value, unit: unit ?? "px" } : { kind: "set_token", name, tokenKind, value }
    );
    const token = state.doc.tokens.find((item) => item.name === name);
    if (!token) return;
    sayWithToast(notices.token(name, tokenCssValue(token), countTokenUses(state.doc, name)));
  }
  function renameToken(name, newName) {
    if (!canEdit()) return;
    fire({ kind: "rename_token", name, newName });
  }
  function deleteToken(name) {
    if (!canEdit()) return;
    const uses = countTokenUses(state.doc, name);
    if (uses > 0) {
      sayWithToast(notices.tokenInUse(name, uses));
      return;
    }
    fire({ kind: "delete_token", name });
  }
  async function createComponent(nodeId2, name) {
    if (!canEdit()) return;
    await send({ kind: "create_component", nodeId: nodeId2, name });
    instanceNotice(nodeId2);
    render();
  }
  function detachInstance(nodeId2) {
    if (!canEdit()) return;
    fire({ kind: "detach_instance", nodeId: nodeId2 });
    render();
  }
  function setFields(fields) {
    if (!canEdit()) return;
    fire({ kind: "set_fields", fields });
  }
  async function putEntry(entryId, values) {
    if (!canEdit()) return;
    await send(entryId === void 0 ? { kind: "put_entry", values } : { kind: "put_entry", entryId, values });
  }
  function moveEntry(entryId, index) {
    if (!canEdit()) return;
    fire({ kind: "move_entry", entryId, index });
  }
  function deleteEntry(entryId) {
    if (!canEdit()) return;
    fire({ kind: "delete_entry", entryId });
  }
  async function addPage() {
    if (!canEdit()) return;
    const count = state.doc.pages.length + 1;
    const ack = await send({ kind: "add_page", name: `Page ${count}` });
    const pageId = ack.created?.["pageId"];
    if (pageId === void 0) return;
    state.pageId = pageId;
    state.selectedId = ack.created?.["nodeId"] ?? null;
    render();
  }
  async function undo() {
    if (!canEdit()) return;
    await send({ kind: "undo" }).catch(() => void 0);
    render();
  }
  async function redo() {
    if (!canEdit()) return;
    await send({ kind: "redo" }).catch(() => void 0);
    render();
  }
  function chooseBreakpoint(bp) {
    state.bp = bp;
    syncUrl();
    render();
  }

  function pageName() {
    return currentPage()?.name ?? "";
  }
  async function loadPublish() {
    const page = currentPage();
    if (!page) return;
    state.publish = await api.get(`/api/pages/${page.id}/publish`);
    render();
  }
  async function checkStorage() {
    const result = await api.get(
      `/api/workspaces/${state.workspaceId}/storage`
    );
    state.storageDown = result.status !== "ok";
    render();
  }
  async function publishNow() {
    const page = currentPage();
    if (!page || state.busy.publish) return;
    state.busy.publish = true;
    state.panel = "publish";
    syncUrl();
    render();
    sayWithToast(notices.publishProgress(page.name));
    const key = `${page.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const status = await postPublish(`/api/pages/${page.id}/publish`, key);
      state.publish = status;
      state.publishFailed = false;
      state.storageDown = false;
      sayWithToast(notices.publishSuccess(page.name, status.url ?? ""));
    } catch (error) {
      state.publishFailed = true;
      if (error instanceof RequestFailed && error.failure.code === "storage_unavailable") {
        state.storageDown = true;
      }
      sayWithToast(notices.publishFailed(page.name));
    } finally {
      state.busy.publish = false;
      render();
      document.getElementById("publish-state")?.focus();
    }
  }
  async function unpublish() {
    const page = currentPage();
    if (!page) return;
    try {
      state.publish = await api.post(`/api/pages/${page.id}/unpublish`);
      sayWithToast(notices.unpublished(pageName()));
    } catch (error) {
      if (error instanceof RequestFailed) sayWithToast(error.failure.message);
    }
    render();
  }

  function versionLine(version) {
    const at = new Date(version.createdAt);
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec"
    ];
    const stamp = `${at.getUTCDate()} ${months[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")} UTC`;
    return `${version.name} \xB7 ${version.author.name} \xB7 ${stamp}`;
  }
  async function loadVersions() {
    const result = await api.get(
      `/api/workspaces/${state.workspaceId}/versions`
    );
    state.versions = result.versions;
    render();
  }
  async function saveVersion(name) {
    const created = await api.post(
      `/api/workspaces/${state.workspaceId}/versions`,
      name === void 0 || name === "" ? {} : { name }
    );
    await loadVersions();
    sayWithToast(notices.versionSaved(created.name));
  }
  async function openPreview(versionId) {
    const version = await api.get(`/api/versions/${versionId}`);
    state.previewDoc = version.document;
    state.previewVersion = {
      id: version.id,
      name: version.name,
      author: version.author,
      createdAt: version.createdAt,
      seq: version.seq
    };
    if (!version.document.pages.some((page) => page.id === state.pageId)) {
      state.pageId = version.document.pages[0]?.id ?? state.pageId;
    }
    state.selectedId = null;
    const url = new URL(window.location.href);
    url.searchParams.set("version", version.id);
    url.searchParams.set("page", state.pageId);
    window.history.pushState({}, "", `${url.pathname}${url.search}`);
    render();
  }
  function backToLatest() {
    const wasPreviewing = state.previewVersion !== null;
    state.previewDoc = null;
    state.previewVersion = null;
    if (!state.doc.pages.some((page) => page.id === state.pageId)) {
      state.pageId = state.doc.pages[0]?.id ?? "";
    }
    if (wasPreviewing) {
      const url = new URL(window.location.href);
      url.searchParams.delete("version");
      window.history.pushState({}, "", `${url.pathname}${url.search}`);
    } else {
      syncUrl();
    }
    render();
  }
  async function applyUrlVersion() {
    const wanted = new URL(window.location.href).searchParams.get("version");
    if (wanted === null) {
      if (state.previewVersion !== null) {
        state.previewDoc = null;
        state.previewVersion = null;
        render();
      }
      return;
    }
    if (state.previewVersion?.id === wanted) return;
    await openPreview(wanted);
  }
  async function restoreVersion(versionId) {
    const version = state.versions.find((item) => item.id === versionId);
    state.busy.restore = true;
    render();
    sayWithToast(notices.restoreProgress(version?.name ?? ""));
    try {
      await api.post(`/api/versions/${versionId}/restore`);
      await reloadDocument();
      await loadVersions();
      backToLatest();
    } finally {
      state.busy.restore = false;
      render();
    }
  }

  var openDialogEl;
  var opener;
  function dialogOpen() {
    return openDialogEl !== void 0;
  }
  function closeDialog(restoreFocus = true) {
    if (!openDialogEl) return;
    openDialogEl.remove();
    openDialogEl = void 0;
    if (restoreFocus) opener?.focus();
    opener = void 0;
  }
  function openDialog(name, body) {
    closeDialog(false);
    opener = document.activeElement ?? void 0;
    const close = (restore = true) => closeDialog(restore);
    const dialog = el(
      "div",
      { role: "dialog", "aria-modal": "true", "aria-label": name, class: "dialog" },
      [el("h2", {}, [name]), ...body(close)]
    );
    const shade = el("div", { class: "dialog-shade" }, [dialog]);
    document.body.append(shade);
    openDialogEl = shade;
    dialog.addEventListener("keydown", (event) => {
      trapTab(dialog, event);
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    });
    focusables(dialog)[0]?.focus();
    return dialog;
  }
  function openDeleteDialog(nodeId2) {
    const node = nodeById(nodeId2);
    if (!node) return;
    openDialog(`Delete ${node.name}?`, (close) => {
      const remove = button("Delete", { class: "primary" });
      remove.addEventListener("click", () => {
        close(false);
        deleteNode(nodeId2);
      });
      const cancel = button("Cancel", { class: "ghost" });
      cancel.addEventListener("click", () => close());
      return [el("p", {}, [`${node.name} and everything inside it will go.`]), remove, cancel];
    });
  }
  function openCreateComponentDialog() {
    const nodeId2 = state.selectedId;
    if (nodeId2 === null) return;
    const node = nodeById(nodeId2);
    if (!node) return;
    openDialog("Create shared component", (close) => {
      const input = el("input", { type: "text", "aria-label": "Component name" });
      input.value = node.name;
      const create = button("Create", { class: "primary" });
      create.addEventListener("click", () => {
        const name = input.value.trim();
        if (name === "") return;
        close();
        void createComponent(nodeId2, name);
      });
      const cancel = button("Cancel", { class: "ghost" });
      cancel.addEventListener("click", () => close());
      return [input, create, cancel];
    });
  }
  function openSaveVersionDialog() {
    openDialog("Save version", (close) => {
      const input = el("input", { type: "text", "aria-label": "Version name" });
      const save = button("Save", { class: "primary" });
      save.addEventListener("click", () => {
        const name = input.value.trim();
        close();
        void saveVersion(name === "" ? void 0 : name);
      });
      const cancel = button("Cancel", { class: "ghost" });
      cancel.addEventListener("click", () => close());
      return [input, save, cancel];
    });
  }
  function openRestoreDialog(versionId) {
    openDialog("Restore version", (close) => {
      const restore = button("Restore", { class: "primary" });
      restore.addEventListener("click", () => {
        close();
        void restoreVersion(versionId);
      });
      const cancel = button("Cancel", { class: "ghost" });
      cancel.addEventListener("click", () => close());
      return [el("p", {}, ["The page goes back to this version. You can undo it."]), restore, cancel];
    });
  }
  function openPublishDialog() {
    openDialog("Publish page", (close) => {
      const publish = button("Publish now", { class: "primary" });
      publish.addEventListener("click", () => {
        close(false);
        void publishNow();
      });
      const cancel = button("Cancel", { class: "ghost" });
      cancel.addEventListener("click", () => close());
      return [el("p", {}, ["The live page is replaced with a new snapshot."]), publish, cancel];
    });
  }
  function openPlaceImageDialog() {
    openDialog("Place image", (close) => {
      const picker = el("select", { "aria-label": "Image" });
      for (const image of state.images) {
        const option = el("option", { value: image.id }, [image.fileName]);
        picker.append(option);
      }
      const alt = el("input", { type: "text", "aria-label": "Alt text", id: "place-alt" });
      const error = el("p", { class: "field-error", id: "place-alt-error" });
      const place = button("Place", { class: "primary" });
      place.addEventListener("click", () => {
        if (alt.value.trim() === "") {
          setText(error, fieldErrors.altEmpty);
          alt.setAttribute("aria-describedby", "place-alt-error");
          alt.setAttribute("aria-invalid", "true");
          alt.focus();
          return;
        }
        close(false);
        void insertNode("image", {
          imageId: picker.value,
          alt: alt.value.trim(),
          focalX: 50,
          focalY: 50
        });
      });
      const cancel = button("Cancel", { class: "ghost" });
      cancel.addEventListener("click", () => close());
      return [picker, alt, error, place, cancel];
    });
  }
  async function loadMembers() {
    const result = await api.get(
      `/api/workspaces/${state.workspaceId}/members`
    );
    state.members = result.members;
    render();
  }
  function openShareDialog() {
    const dialog = openDialog(`Share ${state.workspaceName}`, (close) => {
      const email = el("input", { type: "text", "aria-label": "Email" });
      const role = el("select", { "aria-label": "Role" }, [
        el("option", { value: "editor" }, ["Editor"]),
        el("option", { value: "viewer" }, ["Viewer"])
      ]);
      const error = el("p", { class: "field-error" });
      const invite = button("Send invite", { class: "primary" });
      const list = el("ul", { "aria-label": "Members", class: "member-list" });
      invite.addEventListener("click", () => {
        void api.post(`/api/workspaces/${state.workspaceId}/invites`, {
          email: email.value.trim(),
          role: role.value
        }).then(async () => {
          sayWithToast(notices.inviteSent(email.value.trim().toLowerCase()));
          setText(error, "");
          email.value = "";
          await loadMembers();
          renderMembers(list);
        }).catch((failure) => {
          if (!(failure instanceof RequestFailed)) throw failure;
          const text = failure.failure.code === "mail_unavailable" ? notices.inviteFailed : failure.failure.code === "invalid" ? failure.failure.fields["email"] ?? failure.failure.message : failure.failure.message;
          setText(error, text);
          sayWithToast(text);
        });
      });
      const cancel = button("Close", { class: "ghost" });
      cancel.addEventListener("click", () => close());
      void loadMembers().then(() => renderMembers(list));
      return [email, role, invite, error, list, cancel];
    });
    void dialog;
  }
  function renderMembers(list) {
    patchChildren(
      list,
      state.members,
      (member) => member.userId ?? member.inviteId ?? member.email,
      () => el("li", { class: "member-row" }),
      (element, member) => {
        const roleSelect = el("select", { "aria-label": `Role for ${member.email}` }, [
          el("option", { value: "editor" }, ["Editor"]),
          el("option", { value: "viewer" }, ["Viewer"])
        ]);
        roleSelect.value = member.role === "viewer" ? "viewer" : "editor";
        roleSelect.disabled = member.role === "owner";
        roleSelect.addEventListener("change", () => {
          if (member.userId === void 0) return;
          void api.patch(`/api/workspaces/${state.workspaceId}/members/${member.userId}`, {
            role: roleSelect.value
          }).then(() => loadMembers()).then(() => renderMembers(list));
        });
        const action = member.status === "invited" ? button("Revoke", { "aria-label": `Revoke ${member.email}`, class: "ghost" }) : button("Remove", { "aria-label": `Remove ${member.email}`, class: "ghost" });
        action.addEventListener("click", () => {
          const path = member.status === "invited" ? `/api/invites/${member.inviteId}` : `/api/workspaces/${state.workspaceId}/members/${member.userId}`;
          void api.del(path).then(() => loadMembers()).then(() => renderMembers(list));
        });
        element.replaceChildren(
          el("span", { class: "member-email" }, [member.email]),
          el("span", { class: "member-status" }, [
            member.status === "invited" ? "Invited" : "Active"
          ]),
          roleSelect,
          action
        );
        if (member.role === "owner") action.hidden = true;
      }
    );
  }

  var source;
  var target;
  function indicator() {
    const existing = document.getElementById("drop-indicator");
    if (existing) return existing;
    const made = el("div", { id: "drop-indicator", "aria-hidden": "true", hidden: true });
    canvasElement().append(made);
    return made;
  }
  function nodeIdFromPoint(x, y) {
    for (const element of document.elementsFromPoint(x, y)) {
      const holder = element.closest("[data-node-id]");
      if (holder && !holder.closest("#add-menu")) {
        return { nodeId: holder.dataset["nodeId"], rect: holder.getBoundingClientRect() };
      }
    }
    return void 0;
  }
  function computeTarget(x, y, type) {
    const page = currentPage();
    if (!page) return void 0;
    const hit = nodeIdFromPoint(x, y);
    if (!hit) return { parentId: page.root.id, index: page.root.children.length };
    const node = nodeById(hit.nodeId);
    if (!node) return void 0;
    const middle = hit.rect.top + hit.rect.height / 2;
    if (accepts(node, type)) return { parentId: node.id, index: node.children.length };
    const parent = findParentOf(hit.nodeId);
    if (!parent) return { parentId: page.root.id, index: page.root.children.length };
    const index = parent.children.findIndex((child) => child.id === hit.nodeId);
    return { parentId: parent.id, index: y > middle ? index + 1 : index };
  }
  function findParentOf(nodeId2) {
    const page = currentPage();
    if (!page) return void 0;
    const walk2 = (candidate) => {
      if (!candidate) return void 0;
      if (candidate.children.some((child) => child.id === nodeId2)) return candidate;
      for (const child of candidate.children) {
        const found = walk2(child);
        if (found) return found;
      }
      return void 0;
    };
    return walk2(page.root);
  }
  function showIndicator(x, y) {
    const element = indicator();
    if (!target) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    setAttr(element, "data-parent", target.parentId);
    setAttr(element, "data-index", String(target.index));
    const canvasRect = canvasElement().getBoundingClientRect();
    element.style.left = `${x - canvasRect.left + canvasElement().scrollLeft}px`;
    element.style.top = `${y - canvasRect.top + canvasElement().scrollTop}px`;
  }
  function dragMove(x, y) {
    if (!source) return;
    target = computeTarget(x, y, source.type);
    showIndicator(x, y);
  }
  function dragStart(next) {
    if (!canEdit()) return;
    source = next;
    target = void 0;
  }
  function dragEnd() {
    const current = source;
    const slot = target;
    source = void 0;
    target = void 0;
    indicator().hidden = true;
    if (!current || !slot) return;
    if (current.kind === "palette") {
      if (!acceptsHere(slot, current.type)) {
        sayWithToast(notices.refusedMove(current.type));
        return;
      }
      void insertNodeAt(current.type, slot.parentId, slot.index);
      return;
    }
    const nodeId2 = current.nodeId;
    if (!moveAllowed(nodeId2, slot.parentId, slot.index)) {
      sayWithToast(notices.refusedMove(nodeById(nodeId2)?.name ?? "that node"));
      return;
    }
    moveNodeTo(nodeId2, slot.parentId, slot.index);
  }
  function acceptsHere(slot, type) {
    const parent = nodeById(slot.parentId);
    return parent !== void 0 && accepts(parent, type);
  }
  function dragging() {
    return source !== void 0;
  }

  var menu;
  var opener2;
  function addMenuOpen() {
    return menu !== void 0;
  }
  function closeAddMenu(restoreFocus = true) {
    if (!menu) return;
    menu.remove();
    menu = void 0;
    if (restoreFocus) opener2?.focus();
    opener2 = void 0;
  }
  function items() {
    return menu === void 0 ? [] : [...menu.querySelectorAll('[role="menuitem"]')];
  }
  function moveFocus(delta) {
    const all = items();
    const index = all.indexOf(document.activeElement);
    const next = all[(index + delta + all.length) % all.length];
    next?.focus();
  }
  function menuItem(label, choose, type) {
    const item = el("button", { type: "button", role: "menuitem", tabindex: "-1" }, [label]);
    item.addEventListener("click", () => {
      closeAddMenu(false);
      choose();
    });
    if (type !== void 0) {
      item.addEventListener("mousedown", (event) => {
        const from = { x: event.clientX, y: event.clientY };
        let started = false;
        const move = (moveEvent) => {
          if (!started) {
            if (Math.abs(moveEvent.clientX - from.x) + Math.abs(moveEvent.clientY - from.y) < 5) {
              return;
            }
            started = true;
            dragStart({ kind: "palette", type });
          }
          dragMove(moveEvent.clientX, moveEvent.clientY);
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          if (!started) return;
          closeAddMenu(false);
          dragEnd();
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      });
      item.draggable = true;
      item.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", type);
        dragStart({ kind: "palette", type });
      });
      item.addEventListener("dragend", () => {
        closeAddMenu(false);
        dragEnd();
      });
    }
    return item;
  }
  function openAddMenu() {
    if (!canEdit()) return;
    if (menu) {
      closeAddMenu(false);
      return;
    }
    opener2 = document.activeElement ?? void 0;
    const typeItems = INSERTABLE_TYPES.map(
      (type) => menuItem(
        NODE_TYPE_LABELS[type],
        () => {
          if (type === "image") openPlaceImageDialog();
          else void insertNode(type);
        },
        type
      )
    );
    const group = el(
      "div",
      { role: "group", "aria-label": "Insert shared component" },
      state.doc.components.map(
        (component) => menuItem(component.name, () => void insertInstance(component.id))
      )
    );
    menu = el("div", { role: "menu", "aria-label": "Add component", id: "add-menu" }, [
      ...typeItems,
      group
    ]);
    menu.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveFocus(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveFocus(-1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeAddMenu();
      } else if (event.key === "Tab") {
        event.preventDefault();
        moveFocus(event.shiftKey ? -1 : 1);
      }
    });
    const anchor = document.getElementById("add-button");
    const rect = anchor?.getBoundingClientRect();
    if (rect) {
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 4}px`;
    }
    document.body.append(menu);
    items()[0]?.focus();
  }

  async function loadThreads() {
    const result = await api.get(
      `/api/workspaces/${state.workspaceId}/comments?pageId=${state.pageId}`
    );
    state.threads = result.threads;
    render();
  }
  function mergeThread(thread) {
    const index = state.threads.findIndex((item) => item.id === thread.id);
    if (index === -1) state.threads = [...state.threads, thread];
    else state.threads[index] = thread;
  }
  async function postComment(body) {
    const nodeId2 = state.selectedId;
    if (nodeId2 === null || body.trim() === "") return void 0;
    const thread = await api.post(`/api/workspaces/${state.workspaceId}/comments`, {
      pageId: state.pageId,
      nodeId: nodeId2,
      body
    });
    mergeThread(thread);
    render();
    sayWithToast(notices.commentPosted(nodeById(nodeId2)?.name ?? thread.nodeName));
    for (const email of thread.mailFailed ?? []) sayWithToast(notices.mentionMailFailed(email));
    return thread;
  }
  async function replyToThread(threadId, body) {
    if (body.trim() === "") return;
    const reply = await api.post(
      `/api/comments/${threadId}/replies`,
      { body }
    );
    await loadThreads();
    for (const email of reply.mailFailed ?? []) sayWithToast(notices.mentionMailFailed(email));
  }
  async function setThreadStatus(threadId, resolved) {
    try {
      const thread = await api.post(
        `/api/comments/${threadId}/${resolved ? "resolve" : "reopen"}`
      );
      mergeThread(thread);
      render();
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      sayWithToast(error.failure.message);
    }
  }

  var sheet;
  var sections = new Map();
  var tokenTableBody;
  var newTokenName;
  var newTokenKind;
  var fieldNameInput;
  var fieldKindSelect;
  var fieldList;
  var entryTableBody;
  var entryEditor;
  var entryEditorFields;
  var editingEntryId;
  var imageList;
  var imageInput;
  var versionList;
  var commentBox;
  var threadList;
  var resolvedHeading;
  var resolvedList;
  var publishState;
  var publishLink;
  var publishButton;
  var unpublishButton;
  var retryButton;
  function section(name, label, children) {
    const element = el(
      "section",
      { role: "region", "aria-label": label, id: `panel-${name}`, class: "sheet-panel" },
      [el("h2", {}, [label]), ...children]
    );
    sections.set(name, element);
    return element;
  }
  function openPanel(name) {
    state.panel = state.panel === name ? "none" : name;
    syncUrl();
    render();
    if (state.panel !== "none") {
      const element = sections.get(state.panel);
      if (element) focusables(element)[0]?.focus();
    }
  }
  function closePanel() {
    state.panel = "none";
    syncUrl();
    render();
  }
  function sheetElement() {
    if (sheet) return sheet;
    tokenTableBody = el("tbody");
    newTokenName = el("input", { type: "text", "aria-label": "New token name" });
    newTokenKind = el("select", { "aria-label": "New token kind" }, [
      el("option", { value: "color" }, ["Color"]),
      el("option", { value: "size" }, ["Size"])
    ]);
    const addToken = button("Add token", { class: "primary" });
    addToken.addEventListener("click", () => {
      const name = newTokenName.value.trim();
      if (name === "") return;
      if (newTokenKind.value === "size") setToken(name, "size", 16, "px");
      else setToken(name, "color", "black");
      newTokenName.value = "";
    });
    const tokens = section("tokens", "Tokens", [
      el("table", { "aria-label": "Tokens" }, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", {}, ["Name"]),
            el("th", {}, ["Value"]),
            el("th", {}, ["Unit"]),
            el("th", {}, ["Delete"])
          ])
        ]),
        tokenTableBody
      ]),
      el("div", { class: "row" }, [newTokenName, newTokenKind, addToken])
    ]);
    fieldNameInput = el("input", { type: "text", "aria-label": "Field name" });
    fieldKindSelect = el("select", { "aria-label": "Field kind" }, [
      el("option", { value: "text" }, ["Text"]),
      el("option", { value: "rich_text" }, ["Rich text"]),
      el("option", { value: "image" }, ["Image"])
    ]);
    const addField = button("Add field", { class: "primary" });
    addField.addEventListener("click", () => {
      const name = fieldNameInput.value.trim();
      if (name === "") return;
      setFields([
        ...activeDoc().collection.fields,
        { name, kind: fieldKindSelect.value }
      ]);
      fieldNameInput.value = "";
    });
    fieldList = el("ul", { class: "field-list" });
    entryTableBody = el("tbody");
    const addEntry = button("Add entry", { class: "primary" });
    addEntry.addEventListener("click", () => {
      void putEntry(void 0, {});
    });
    entryEditorFields = el("div", { class: "entry-fields" });
    const saveEntry = button("Save entry", { class: "primary" });
    saveEntry.addEventListener("click", () => {
      const values = {};
      for (const input of entryEditorFields.querySelectorAll("[data-field]")) {
        values[input.dataset["field"]] = input.value;
      }
      void putEntry(editingEntryId, values).then(() => {
        editingEntryId = void 0;
        render();
      });
    });
    entryEditor = el("div", { class: "entry-editor", hidden: true }, [entryEditorFields, saveEntry]);
    const collection = section("collection", "Collection", [
      el("div", { class: "row" }, [fieldNameInput, fieldKindSelect, addField]),
      fieldList,
      el("table", { "aria-label": "Entries" }, [
        el("thead", {}, [el("tr", {}, [el("th", {}, ["Entry"]), el("th", {}, ["Actions"])])]),
        entryTableBody
      ]),
      addEntry,
      entryEditor
    ]);
    imageInput = el("input", { type: "file", id: "image-file", accept: "image/*" });
    imageInput.addEventListener("change", () => {
      const file = imageInput.files?.[0];
      if (file) void upload(file);
    });
    imageList = el("ul", { "aria-label": "Images", class: "image-list" });
    const images = section("images", "Images", [
      el("div", { class: "row" }, [el("label", { for: "image-file" }, ["Image file"]), imageInput]),
      imageList
    ]);
    versionList = el("ul", { "aria-label": "Versions", class: "version-list" });
    const history = section("history", "History", [versionList]);
    commentBox = el("textarea", { "aria-label": "Comment", rows: "3" });
    const post = button("Post comment", { class: "primary" });
    post.addEventListener("click", () => {
      void postComment(commentBox.value).then((thread) => {
        if (!thread) return;
        commentBox.value = "";
        render();
        document.querySelector(`[data-thread="${thread.id}"] [data-reply-button]`)?.focus();
      });
    });
    threadList = el("div", { class: "threads" });
    resolvedHeading = el("h3", {}, ["Resolved (0)"]);
    resolvedList = el("div", { class: "threads resolved" });
    const comments = section("comments", "Comments", [
      commentBox,
      post,
      threadList,
      resolvedHeading,
      resolvedList
    ]);
    publishState = el("p", { id: "publish-state", tabindex: "-1", class: "mono" }, ["Not published"]);
    publishLink = el("a", { href: "#", class: "mono" }, [""]);
    publishButton = button("Publish", { class: "primary" });
    publishButton.addEventListener("click", () => openPublishDialog());
    unpublishButton = button("Unpublish", { class: "ghost" });
    unpublishButton.addEventListener("click", () => {
      void unpublish();
    });
    retryButton = button("Try publishing again", { class: "primary" });
    retryButton.addEventListener("click", () => {
      void publishNow();
    });
    const publish = section("publish", "Publish", [
      publishState,
      publishLink,
      publishButton,
      unpublishButton,
      retryButton
    ]);
    sheet = el("div", { id: "sheet" }, [tokens, collection, images, history, comments, publish]);
    sheet.addEventListener("keydown", (event) => {
      if (state.panel === "none") return;
      const element = sections.get(state.panel);
      if (element) trapTab(element, event);
    });
    return sheet;
  }
  async function upload(file) {
    state.busy.upload = true;
    imageInput.disabled = true;
    imageInput.setAttribute("aria-busy", "true");
    render();
    sayWithToast(notices.uploadProgress(file.name));
    try {
      await uploadImage(state.workspaceId, file);
      sayWithToast(notices.uploadSuccess(file.name));
      state.storageDown = false;
      await loadImages();
    } catch (error) {
      if (error instanceof RequestFailed) {
        const code = error.failure.code;
        if (code === "unsupported_image") sayWithToast(notices.uploadWrongType);
        else if (code === "image_too_large") sayWithToast(notices.uploadTooBig);
        else if (code === "storage_unavailable") {
          state.storageDown = true;
          sayWithToast(notices.uploadOutage(file.name));
        } else sayWithToast(error.failure.message);
      }
    } finally {
      state.busy.upload = false;
      imageInput.disabled = false;
      imageInput.removeAttribute("aria-busy");
      imageInput.value = "";
      render();
    }
  }
  async function loadImages() {
    const result = await api.get(
      `/api/workspaces/${state.workspaceId}/images`
    );
    state.images = result.images;
    render();
  }
  function renderTokens() {
    patchChildren(
      tokenTableBody,
      activeDoc().tokens,
      (token) => token.name,
      () => {
        const row2 = el("tr", {}, [el("td"), el("td"), el("td"), el("td")]);
        return row2;
      },
      (row2, token) => {
        const cells = [...row2.children];
        const nameInput = cells[0].querySelector("input") ?? el("input", { type: "text", class: "mono" });
        if (!nameInput.isConnected) {
          cells[0].append(nameInput);
          nameInput.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const before = nameInput.dataset["token"];
            const after = nameInput.value.trim();
            if (after !== "" && after !== before) renameToken(before, after);
          });
        }
        nameInput.dataset["token"] = token.name;
        setAttr(nameInput, "aria-label", `${token.name} name`);
        if (document.activeElement !== nameInput) nameInput.value = token.name;
        const valueInput = cells[1].querySelector("input") ?? el("input", { type: "text", class: "mono" });
        if (!valueInput.isConnected) {
          cells[1].append(valueInput);
          valueInput.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commitTokenValue(valueInput);
          });
          valueInput.addEventListener("blur", () => commitTokenValue(valueInput));
        }
        valueInput.dataset["token"] = token.name;
        setAttr(valueInput, "aria-label", `${token.name} value`);
        if (document.activeElement !== valueInput) valueInput.value = String(token.value);
        cells[2].replaceChildren();
        if (token.kind === "size") {
          const unit = el("select", { "aria-label": `${token.name} unit`, class: "mono" }, [
            el("option", { value: "px" }, ["px"]),
            el("option", { value: "rem" }, ["rem"])
          ]);
          unit.value = token.unit ?? "px";
          unit.addEventListener("change", () => {
            const current = activeDoc().tokens.find((item) => item.name === token.name);
            if (!current || current.kind !== "size") return;
            const number = Number(current.value);
            const converted = unit.value === "rem" ? Math.round(number / 16 * 1e4) / 1e4 : Math.round(number * 16 * 1e4) / 1e4;
            setToken(token.name, "size", converted, unit.value);
          });
          cells[2].append(unit);
        }
        cells[3].replaceChildren();
        const remove = button("Delete", { "aria-label": `Delete ${token.name}`, class: "ghost" });
        remove.addEventListener("click", () => deleteToken(token.name));
        cells[3].append(remove);
        row2.hidden = !canEdit() && false;
      }
    );
  }
  function commitTokenValue(input) {
    const name = input.dataset["token"];
    const token = activeDoc().tokens.find((item) => item.name === name);
    if (!token) return;
    if (token.kind === "size") {
      const number = Number(input.value);
      if (!Number.isFinite(number)) return;
      if (number === Number(token.value)) return;
      setToken(name, "size", number, token.unit ?? "px");
      return;
    }
    const value = input.value.trim();
    if (value === "" || value === token.value) return;
    setToken(name, "color", value);
  }
  function renderFields() {
    const fields = activeDoc().collection.fields;
    patchChildren(
      fieldList,
      fields,
      (field) => field.name,
      () => el("li"),
      (row2, field) => {
        const remove = button("Remove", {
          "aria-label": `Remove field ${field.name}`,
          class: "ghost"
        });
        remove.addEventListener("click", () => {
          setFields(fields.filter((item) => item.name !== field.name));
        });
        row2.replaceChildren(
          el("span", {}, [field.name]),
          el("span", { class: "mono" }, [field.kind]),
          remove
        );
      }
    );
  }
  function renderEntries() {
    const entries = orderedEntries();
    const fields = activeDoc().collection.fields;
    patchChildren(
      entryTableBody,
      entries,
      (entry2) => entry2.id,
      () => el("tr", {}, [el("td"), el("td")]),
      (row2, entry2) => {
        const position = entry2.order + 1;
        const cells = [...row2.children];
        const summary = fields.map((field) => richTextToPlain(entry2.values[field.name] ?? "")).join(" ").slice(0, 60);
        setText(cells[0], summary === "" ? `Entry ${position}` : summary);
        const up = button("Up", { "aria-label": `Move entry ${position} up`, class: "ghost" });
        up.addEventListener("click", () => moveEntry(entry2.id, Math.max(0, entry2.order - 1)));
        const down = button("Down", { "aria-label": `Move entry ${position} down`, class: "ghost" });
        down.addEventListener(
          "click",
          () => moveEntry(entry2.id, Math.min(entries.length - 1, entry2.order + 1))
        );
        const edit = button("Edit", { "aria-label": `Edit entry ${position}`, class: "ghost" });
        edit.addEventListener("click", () => {
          editingEntryId = entry2.id;
          render();
          focusables(entryEditor)[0]?.focus();
        });
        const remove = button("Delete", {
          "aria-label": `Delete entry ${position}`,
          class: "ghost"
        });
        remove.addEventListener("click", () => deleteEntry(entry2.id));
        cells[1].replaceChildren(up, down, edit, remove);
      }
    );
    const entry = entries.find((item) => item.id === editingEntryId);
    entryEditor.hidden = entry === void 0;
    if (entry === void 0) return;
    entryEditorFields.replaceChildren(
      ...fields.map((field) => {
        if (field.kind === "image") {
          const select = el("select", { "aria-label": field.name });
          select.dataset["field"] = field.name;
          select.append(el("option", { value: "" }, ["No image"]));
          for (const image of state.images) {
            select.append(el("option", { value: image.id }, [image.fileName]));
          }
          select.value = entry.values[field.name] ?? "";
          return el("div", { class: "row" }, [el("label", {}, [field.name]), select]);
        }
        const input = el("textarea", { "aria-label": field.name, rows: "2" });
        input.dataset["field"] = field.name;
        input.value = entry.values[field.name] ?? "";
        return el("div", { class: "row" }, [input]);
      })
    );
  }
  function renderImages() {
    patchChildren(
      imageList,
      state.images,
      (image) => image.id,
      () => el("li"),
      (row2, image) => {
        setText(row2, image.fileName);
      }
    );
  }
  function renderVersions() {
    patchChildren(
      versionList,
      state.versions,
      (version) => version.id,
      () => el("li"),
      (row2, version) => {
        const link = row2.querySelector("a") ?? el("a", { href: "#" });
        if (!link.isConnected) {
          row2.append(link);
          link.addEventListener("click", (event) => {
            event.preventDefault();
            void openPreview(link.dataset["version"]);
          });
        }
        link.dataset["version"] = version.id;
        link.href = `/w/${state.workspaceId}/edit?page=${state.pageId}&version=${version.id}`;
        setText(link, versionLine(version));
      }
    );
  }
  function threadArticle(thread) {
    const article = el("article", {
      "aria-label": `Comment by ${thread.author.name} on ${thread.nodeName}`
    });
    article.dataset["thread"] = thread.id;
    return article;
  }
  function updateThread(article, thread) {
    setAttr(article, "aria-label", `Comment by ${thread.author.name} on ${thread.nodeName}`);
    const reply = button("Reply", { class: "ghost" });
    reply.dataset["replyButton"] = "true";
    const replyBox = el("textarea", { "aria-label": `Reply to ${thread.author.name}`, rows: "2", hidden: true });
    const sendReply = button("Send reply", { class: "ghost", hidden: true });
    reply.addEventListener("click", () => {
      replyBox.hidden = false;
      sendReply.hidden = false;
      replyBox.focus();
    });
    sendReply.addEventListener("click", () => {
      void replyToThread(thread.id, replyBox.value).then(() => {
        replyBox.value = "";
      });
    });
    const toggle = thread.status === "open" ? button("Resolve", { class: "ghost" }) : button("Reopen", { class: "ghost" });
    toggle.addEventListener("click", () => {
      void setThreadStatus(thread.id, thread.status === "open");
    });
    article.replaceChildren(
      el("p", { class: "comment-author" }, [thread.author.name]),
      el("p", { class: "comment-body" }, [thread.body]),
      ...thread.replies.map(
        (item) => el("p", { class: "comment-reply" }, [`${item.author.name}: ${item.body}`])
      ),
      reply,
      toggle,
      replyBox,
      sendReply
    );
  }
  function renderComments() {
    const threads = state.threads.filter((thread) => thread.pageId === state.pageId);
    const open = threads.filter((thread) => thread.status === "open");
    const resolved = threads.filter((thread) => thread.status === "resolved");
    patchChildren(threadList, open, (thread) => thread.id, threadArticle, updateThread);
    patchChildren(resolvedList, resolved, (thread) => thread.id, threadArticle, updateThread);
    setText(resolvedHeading, `Resolved (${resolved.length})`);
    const comments = sections.get("comments");
    if (state.layout === "phone") {
      setAttr(comments, "role", "dialog");
      setAttr(comments, "aria-modal", "true");
    } else {
      setAttr(comments, "role", "region");
      comments.removeAttribute("aria-modal");
    }
    commentBox.disabled = state.selectedId === null;
    renderPins();
  }
  function pinsLayer() {
    const existing = document.getElementById("pins");
    if (existing) return existing;
    const made = el("div", { id: "pins" });
    canvasElement().append(made);
    return made;
  }
  function renderPins() {
    const layer = pinsLayer();
    const threads = state.threads.filter(
      (thread) => thread.pageId === state.pageId && thread.status === "open" && nodeById(thread.nodeId) !== void 0
    );
    const canvasRect = canvasElement().getBoundingClientRect();
    patchChildren(
      layer,
      threads,
      (thread) => thread.id,
      (thread) => {
        const pin = button("1", {
          id: `pin-${thread.id}`,
          "aria-label": `Comment by ${thread.author.name} on ${thread.nodeName}`,
          class: "pin"
        });
        pin.addEventListener("click", () => {
          selectNode(thread.nodeId);
          openPanel("comments");
        });
        return pin;
      },
      (pin, thread) => {
        setAttr(pin, "aria-label", `Comment by ${thread.author.name} on ${thread.nodeName}`);
        const node = frameElement(state.bp).querySelector(
          `[data-node-id="${thread.nodeId}"]`
        );
        if (!node) {
          pin.hidden = true;
          return;
        }
        pin.hidden = false;
        const rect = node.getBoundingClientRect();
        pin.style.left = `${rect.right - canvasRect.left + canvasElement().scrollLeft - 14}px`;
        pin.style.top = `${rect.top - canvasRect.top + canvasElement().scrollTop - 14}px`;
      }
    );
  }
  function renderPublish() {
    const page = currentPage();
    setText(publishState, PUBLISH_STATE_TEXT[state.publish.state]);
    const url = state.publish.url ?? "";
    publishLink.hidden = url === "";
    publishLink.href = url === "" ? "#" : url;
    setText(publishLink, url);
    const readOnlyPublish = state.layout === "phone";
    publishButton.hidden = !canEdit() || readOnlyPublish;
    publishButton.disabled = state.busy.publish;
    if (state.busy.publish) publishButton.setAttribute("aria-busy", "true");
    else publishButton.removeAttribute("aria-busy");
    unpublishButton.hidden = readOnlyPublish || state.role !== "owner" || state.publish.state !== "live" && state.publish.state !== "live_changed";
    retryButton.hidden = !state.publishFailed || !canEdit() || readOnlyPublish;
    retryButton.disabled = state.busy.publish;
    if (state.busy.publish) retryButton.setAttribute("aria-busy", "true");
    else retryButton.removeAttribute("aria-busy");
    void page;
  }
  function renderSheet() {
    sheetElement();
    renderTokens();
    renderFields();
    renderEntries();
    renderImages();
    renderVersions();
    renderComments();
    renderPublish();
    for (const [name, element] of sections) {
      const visible = state.panel === name;
      element.hidden = !visible;
      if (visible) element.removeAttribute("inert");
      else element.setAttribute("inert", "");
    }
    sheet.hidden = state.panel === "none";
    sheet.classList.toggle("phone", state.layout === "phone");
  }

  function placeOf(target2) {
    if (!target2) return "elsewhere";
    if (target2.closest('[role="treeitem"]')) return "row";
    if (target2.id === "canvas" || target2.closest("[data-frame]")) return "canvas";
    const tag = target2.tagName;
    if (tag === "BUTTON" || tag === "A") return "controls";
    if (tag === "INPUT") {
      const type = target2.type;
      if (type === "radio" || type === "range" || type === "checkbox" || type === "file") {
        return "controls";
      }
    }
    return "elsewhere";
  }
  function rowIds() {
    return rows().map((row2) => row2.node.id);
  }
  function focusedRowId() {
    const active = document.activeElement;
    const row2 = active?.closest('[role="treeitem"]');
    return row2?.dataset["nodeId"];
  }
  function moveRowFocus(delta) {
    const ids = rowIds();
    const current = focusedRowId();
    const index = current === void 0 ? -1 : ids.indexOf(current);
    const next = ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
    if (next === void 0) return;
    setRoving(next);
    rowElement(next)?.focus();
  }
  function moveCanvasSelection(delta) {
    const ids = pageNodeIds();
    const index = state.selectedId === null ? -1 : ids.indexOf(state.selectedId);
    const next = ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
    if (next !== void 0) selectNode(next);
  }
  function expandOrEnter() {
    const id = focusedRowId();
    if (id === void 0) return;
    const node = nodeById(id);
    if (!node) return;
    if (node.children.length > 0 && state.collapsed.has(id)) {
      state.collapsed.delete(id);
      render();
      focusNodeRow(id);
      return;
    }
    const child = node.children[0];
    if (child) {
      setRoving(child.id);
      rowElement(child.id)?.focus();
    }
  }
  function collapseOrLeave() {
    const id = focusedRowId();
    if (id === void 0) return;
    const node = nodeById(id);
    if (!node) return;
    if (node.children.length > 0 && !state.collapsed.has(id)) {
      state.collapsed.add(id);
      render();
      focusNodeRow(id);
      return;
    }
    const parent = rows().find((row2) => row2.node.id === id)?.parentId;
    if (parent) {
      setRoving(parent);
      rowElement(parent)?.focus();
    }
  }
  function escapePressed(event) {
    if (state.panel !== "none") {
      const opener3 = document.getElementById(`${state.panel}-button`);
      closePanel();
      opener3?.focus();
      event.preventDefault();
      return;
    }
    if (state.layout === "tablet" && state.navigatorOpen) {
      state.navigatorOpen = false;
      render();
      document.getElementById("navigator-button")?.focus();
      event.preventDefault();
      return;
    }
    if (fanShowing()) {
      closeFan();
      event.preventDefault();
    }
  }
  function installKeys() {
    document.addEventListener("keydown", (event) => {
      const target2 = event.target;
      if (dialogOpen() || addMenuOpen()) {
        if (event.key === "Escape" && !event.defaultPrevented) {
          if (addMenuOpen()) closeAddMenu();
          else closeDialog();
          event.preventDefault();
        }
        return;
      }
      if (event.key === "Escape") {
        escapePressed(event);
        return;
      }
      if (isTextEntry(target2)) return;
      const place = placeOf(target2);
      const selected = state.selectedId;
      const inEditor = place !== "elsewhere";
      if (event.altKey && !event.ctrlKey && !event.metaKey && /^[123]$/.test(event.key) && inEditor) {
        const map = { "1": "desktop", "2": "tablet", "3": "phone" };
        const bp = map[event.key];
        event.preventDefault();
        chooseBreakpoint(bp);
        if (fanShowing()) focusFrame(bp);
        return;
      }
      if (event.ctrlKey && event.altKey && inEditor) {
        const key2 = event.key.toLowerCase();
        if (key2 === "h") {
          event.preventDefault();
          openPanel("history");
          return;
        }
        if (key2 === "p") {
          event.preventDefault();
          openPanel("publish");
          return;
        }
        if (key2 === "k") {
          event.preventDefault();
          if (selected !== null) openCreateComponentDialog();
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && inEditor) {
        const key2 = event.key.toLowerCase();
        if (key2 === "z") {
          event.preventDefault();
          if (event.shiftKey) void redo();
          else void undo();
          return;
        }
        if (key2 === "d") {
          event.preventDefault();
          if (selected !== null && canEdit() && (place === "row" || place === "canvas")) {
            void duplicateNode(selected);
          }
          return;
        }
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (place === "row") {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveRowFocus(1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          moveRowFocus(-1);
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          expandOrEnter();
          return;
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          collapseOrLeave();
          return;
        }
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          const ids = rowIds();
          const id = event.key === "Home" ? ids[0] : ids[ids.length - 1];
          if (id !== void 0) {
            setRoving(id);
            rowElement(id)?.focus();
          }
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const id = focusedRowId();
          if (id !== void 0) {
            selectNode(id);
            if (state.layout === "tablet" && state.navigatorOpen) {
              state.navigatorOpen = false;
              render();
              canvasElement().focus();
            }
          }
          return;
        }
        if (event.key === "F2") {
          event.preventDefault();
          const id = focusedRowId();
          if (id !== void 0) {
            state.selectedId = id;
            renameFocusedRow();
          }
          return;
        }
      }
      if (place === "canvas") {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          moveCanvasSelection(1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          moveCanvasSelection(-1);
          return;
        }
      }
      if ((place === "row" || place === "canvas") && event.key === "Delete") {
        event.preventDefault();
        const id = place === "row" ? focusedRowId() : selected ?? void 0;
        const page = currentPage();
        if (id !== void 0 && canEdit() && id !== page?.root.id) openDeleteDialog(id);
        return;
      }
      if (place === "row" && event.altKey) return;
      if (!inEditor) return;
      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        openAddMenu();
        return;
      }
      if (key === "f") {
        event.preventDefault();
        toggleFan();
        return;
      }
      if (key === "m") {
        event.preventDefault();
        openPanel("comments");
        document.querySelector('[aria-label="Comment"]')?.focus();
      }
    });
    document.addEventListener(
      "keydown",
      (event) => {
        if (!event.altKey || event.ctrlKey || event.metaKey) return;
        const target2 = event.target;
        if (isTextEntry(target2)) return;
        const row2 = target2?.closest('[role="treeitem"]');
        if (!row2) return;
        const nodeId2 = row2.dataset["nodeId"];
        if (nodeId2 === void 0 || !navigatorVisible()) return;
        const directions = {
          ArrowUp: "up",
          ArrowDown: "down",
          ArrowRight: "indent",
          ArrowLeft: "outdent"
        };
        const direction2 = directions[event.key];
        if (direction2 === void 0) return;
        event.preventDefault();
        event.stopPropagation();
        moveByKeyboard(nodeId2, direction2);
      },
      true
    );
  }

  var panel;
  var valueInputs = new Map();
  var tokenSelects = new Map();
  var clearButtons = new Map();
  var groups = new Map();
  var pipHolders = new Map();
  var textInput;
  var levelSelect;
  var linkInput;
  var altInput;
  var focalX;
  var focalY;
  var bindSelect;
  var createComponentButton;
  var detachButton;
  var rows2 = new Map();
  function row(label, control, key) {
    const wrapper = el("div", { class: "style-row" }, [el("span", { class: "prop-label" }, [label]), control]);
    rows2.set(key, wrapper);
    return wrapper;
  }
  function textRow(label, commit) {
    const input = el("input", { type: "text", "aria-label": label, class: "value-input" });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        delete input.dataset["dirty"];
        commit(input.value);
      }
      if (event.key === "Escape" && input.dataset["dirty"] === "true") {
        event.stopPropagation();
        delete input.dataset["dirty"];
        renderStylePanel();
      }
    });
    input.addEventListener("input", () => {
      input.dataset["dirty"] = "true";
    });
    input.addEventListener("blur", () => {
      if (input.dataset["dirty"] === "true") {
        delete input.dataset["dirty"];
        commit(input.value);
      }
    });
    return input;
  }
  function nodeId() {
    return state.selectedId ?? "";
  }
  function stylePanelElement() {
    if (panel) return panel;
    const content = el("div", { class: "style-content" });
    textInput = textRow("Text", (value) => setPropValue(nodeId(), "text", value));
    levelSelect = el("select", { "aria-label": "Heading level" }, [
      el("option", { value: "1" }, ["Level 1"]),
      el("option", { value: "2" }, ["Level 2"]),
      el("option", { value: "3" }, ["Level 3"])
    ]);
    levelSelect.addEventListener("change", () => {
      setPropValue(nodeId(), "level", Number(levelSelect.value));
    });
    linkInput = textRow("Link", (value) => setPropValue(nodeId(), "href", value));
    altInput = textRow("Alt text", (value) => setPropValue(nodeId(), "alt", value));
    focalX = focalSlider("Focal point horizontal", "focalX");
    focalY = focalSlider("Focal point vertical", "focalY");
    bindSelect = el("select", { "aria-label": "Bind to field" });
    bindSelect.addEventListener("change", () => {
      const node = selectedNode();
      if (!node) return;
      const prop = mainPropOf(node.type);
      if (prop === void 0) return;
      bindProp(node.id, prop, bindSelect.value === "" ? null : bindSelect.value);
    });
    createComponentButton = button("Create shared component", { class: "ghost" });
    createComponentButton.addEventListener("click", () => openCreateComponentDialog());
    detachButton = button("Detach instance", { class: "ghost" });
    detachButton.addEventListener("click", () => detachInstance(nodeId()));
    content.append(
      row("Text", textInput, "text"),
      row("Heading level", levelSelect, "level"),
      row("Link", linkInput, "href"),
      row("Alt text", altInput, "alt"),
      row("Focal point horizontal", focalX, "focalX"),
      row("Focal point vertical", focalY, "focalY"),
      row("Bind to field", bindSelect, "bind"),
      createComponentButton,
      detachButton
    );
    const styleRows = el("div", { class: "style-rows" });
    for (const key of STYLE_KEYS) {
      const value = textRow(`${key} value`, (text) => {
        if (text.trim() === "") return;
        setStyleValue(nodeId(), key, text.trim());
      });
      const token = el("select", { "aria-label": `${key} token` });
      token.addEventListener("change", () => {
        if (token.value === "") clearStyleValue(nodeId(), key);
        else setStyleValue(nodeId(), key, { token: token.value });
      });
      const clear = button("Clear", { "aria-label": `Clear ${key} override`, class: "clear-override" });
      clear.addEventListener("click", () => {
        clearStyleValue(nodeId(), key);
        value.focus();
      });
      const pips = el("span", { class: "pips" });
      const group = el("div", { role: "group", "aria-label": key, "data-property": key }, [
        el("span", { class: "prop-label mono" }, [key]),
        value,
        token,
        clear,
        pips
      ]);
      valueInputs.set(key, value);
      tokenSelects.set(key, token);
      clearButtons.set(key, clear);
      pipHolders.set(key, pips);
      groups.set(key, group);
      styleRows.append(group);
    }
    panel = el(
      "aside",
      {
        id: "style-panel",
        role: "complementary",
        "aria-label": "Style",
        "data-motion": "open",
        "data-progress": "1.00"
      },
      [el("div", { class: "panel-head" }, [el("h2", {}, ["Style"])]), content, styleRows]
    );
    return panel;
  }
  function focalSlider(label, prop) {
    const slider = el("input", {
      type: "range",
      min: "0",
      max: "100",
      step: "5",
      "aria-label": label,
      class: "focal"
    });
    slider.addEventListener("keydown", (event) => {
      if (!event.shiftKey) return;
      const delta = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      const next = Math.min(100, Math.max(0, Number(slider.value) + delta));
      slider.value = String(next);
      setPropValue(nodeId(), prop, next);
    });
    slider.addEventListener("change", () => {
      setPropValue(nodeId(), prop, Number(slider.value));
    });
    return slider;
  }
  function pipLabel(node, bp, key) {
    const pip = pipState(node, bp, key);
    if (pip === "unset") return `${breakpointLabel(bp)}: unset`;
    const value = styleValueText(resolveStyle(node, bp, key));
    return `${breakpointLabel(bp)}: ${pip}, ${value}`;
  }
  function updatePips(node, key) {
    const holder = pipHolders.get(key);
    if (!fanShowing()) {
      holder.replaceChildren();
      return;
    }
    patchChildren(
      holder,
      [...BREAKPOINTS],
      (bp) => bp,
      (bp) => el("span", { "data-pip": bp, role: "img" }),
      (element, bp) => {
        setAttr(element, "data-state", pipState(node, bp, key));
        setAttr(element, "aria-label", pipLabel(node, bp, key));
      }
    );
  }
  function showRow(key, visible) {
    const element = rows2.get(key);
    if (element) element.hidden = !visible;
  }
  function renderStylePanel() {
    stylePanelElement();
    const node = selectedNode();
    const editing = canEdit();
    setAttr(panel, "data-motion", state.stylePanel.motion);
    setAttr(panel, "data-progress", state.stylePanel.progress.toFixed(2));
    if (state.stylePanel.motion === "closed") {
      panel.setAttribute("inert", "");
    } else {
      panel.removeAttribute("inert");
    }
    const doc = activeDoc();
    const hasText = node !== void 0 && ["heading", "text", "button"].includes(node.type);
    showRow("text", editing && hasText);
    showRow("level", editing && node?.type === "heading");
    showRow("href", editing && node?.type === "button");
    showRow("alt", editing && node?.type === "image");
    showRow("focalX", editing && node?.type === "image");
    showRow("focalY", editing && node?.type === "image");
    const bindable = node !== void 0 && insideTemplate(node.id);
    showRow("bind", editing && bindable);
    createComponentButton.hidden = !editing || node === void 0 || node.shared !== void 0;
    detachButton.hidden = !editing || node?.shared === void 0;
    if (node !== void 0) {
      if (textInput.dataset["dirty"] !== "true") textInput.value = String(node.props["text"] ?? "");
      levelSelect.value = String(node.props["level"] ?? 1);
      if (linkInput.dataset["dirty"] !== "true") linkInput.value = String(node.props["href"] ?? "");
      if (altInput.dataset["dirty"] !== "true") altInput.value = String(node.props["alt"] ?? "");
      focalX.value = String(node.props["focalX"] ?? 50);
      focalY.value = String(node.props["focalY"] ?? 50);
      const prop = mainPropOf(node.type);
      if (prop !== void 0) {
        const kinds = bindableFieldKinds(node.type, prop);
        const options = [
          { value: "", label: "Not bound" },
          ...doc.collection.fields.filter((field) => kinds.includes(field.kind)).map((field) => ({ value: field.name, label: field.name }))
        ];
        patchChildren(
          bindSelect,
          options,
          (option) => option.value,
          () => el("option"),
          (element, option) => {
            element.value = option.value;
            setText(element, option.label);
          }
        );
        bindSelect.value = node.bind?.[prop] ?? "";
      }
    }
    for (const key of STYLE_KEYS) {
      const group = groups.get(key);
      const valueInput = valueInputs.get(key);
      const token = tokenSelects.get(key);
      const clear = clearButtons.get(key);
      if (node === void 0) {
        group.hidden = true;
        continue;
      }
      group.hidden = false;
      const source2 = styleSource(node, state.bp, key);
      setAttr(group, "data-source", source2);
      const resolved = resolveStyle(node, state.bp, key);
      if (valueInput.dataset["dirty"] !== "true") {
        valueInput.value = resolved === void 0 ? "" : styleValueText(resolved);
      }
      valueInput.hidden = !editing;
      const kind = STYLE_TOKEN_KIND[key];
      token.hidden = kind === null || !editing;
      if (kind !== null) {
        const options = [
          { value: "", label: "No token" },
          ...doc.tokens.filter((item) => item.kind === kind).map((item) => ({ value: item.name, label: item.name }))
        ];
        patchChildren(
          token,
          options,
          (option) => option.value,
          () => el("option"),
          (element, option) => {
            element.value = option.value;
            setText(element, option.label);
          }
        );
        const own = node.styles[state.bp][key];
        token.value = own !== void 0 && typeof own !== "string" ? own.token : "";
      }
      clear.hidden = !editing || state.bp === "desktop" || source2 !== "set";
      group.classList.toggle("overridden", state.bp !== "desktop" && source2 === "set");
      updatePips(node, key);
    }
  }
  var motionFrame = 0;
  var motionTimer = 0;
  var motionDirection = 0;
  var motionAnchorTime = 0;
  var motionAnchorProgress = 0;
  function paintPanelMotion() {
    setAttr(panel, "data-motion", state.stylePanel.motion);
    setAttr(panel, "data-progress", state.stylePanel.progress.toFixed(2));
    panel.style.setProperty("--progress", String(state.stylePanel.progress));
    if (state.stylePanel.motion === "closed") panel.setAttribute("inert", "");
    else panel.removeAttribute("inert");
    const toggle = document.getElementById("style-panel-button");
    toggle?.setAttribute("aria-expanded", state.stylePanel.motion === "closed" ? "false" : "true");
  }
  function settlePanel() {
    const opening = motionDirection > 0;
    state.stylePanel.progress = opening ? 1 : 0;
    state.stylePanel.motion = opening ? "open" : "closed";
    if (motionFrame !== 0) window.cancelAnimationFrame(motionFrame);
    if (motionTimer !== 0) window.clearTimeout(motionTimer);
    motionFrame = 0;
    motionTimer = 0;
    motionDirection = 0;
    paintPanelMotion();
  }
  function panelStep(now) {
    const next = motionAnchorProgress + motionDirection * (now - motionAnchorTime) / 200;
    state.stylePanel.progress = Math.min(1, Math.max(0, next));
    if (motionDirection > 0 && state.stylePanel.progress >= 1 || motionDirection < 0 && state.stylePanel.progress <= 0) {
      settlePanel();
      return;
    }
    state.stylePanel.motion = motionDirection > 0 ? "opening" : "closing";
    paintPanelMotion();
    motionFrame = window.requestAnimationFrame(panelStep);
  }
  function toggleStylePanel() {
    stylePanelElement();
    const opening = state.stylePanel.motion === "closed" || state.stylePanel.motion === "closing";
    motionDirection = opening ? 1 : -1;
    state.stylePanel.motion = opening ? "opening" : "closing";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      settlePanel();
      return;
    }
    paintPanelMotion();
    motionAnchorProgress = state.stylePanel.progress;
    motionAnchorTime = performance.now();
    const remaining = (opening ? 1 - motionAnchorProgress : motionAnchorProgress) * 200;
    if (motionTimer !== 0) window.clearTimeout(motionTimer);
    motionTimer = window.setTimeout(settlePanel, remaining);
    if (motionFrame === 0) motionFrame = window.requestAnimationFrame(panelStep);
  }
  function insideTemplate(id) {
    const doc = activeDoc();
    const lists = doc.pages.flatMap((page) => collectLists(page.root));
    return lists.some((list) => list.id !== id && isInSubtree(list, id));
  }
  function collectLists(node) {
    const out = node.type === "collection_list" ? [node] : [];
    for (const child of node.children) out.push(...collectLists(child));
    return out;
  }

  var pageSelect;
  var breakpointRadios;
  var presenceBar;
  var storageBanner;
  var modeBanner;
  var previewBanner;
  var phoneToolbar;
  var topButtons = new Map();
  function panelButton(label, panel2, iconName) {
    const control = button(label, { id: `${panel2}-button`, class: "ghost" });
    control.prepend(icon(iconName));
    control.addEventListener("click", () => openPanel(panel2));
    topButtons.set(label, control);
    return control;
  }
  function buildTopbar() {
    pageSelect = el("select", { "aria-label": "Page", id: "page-select" });
    pageSelect.addEventListener("change", () => {
      state.pageId = pageSelect.value;
      state.selectedId = null;
      syncUrl();
      render();
      void Promise.all([loadPublish(), loadThreads()]);
    });
    breakpointRadios = new Map();
    const group = el("div", { role: "radiogroup", "aria-label": "Breakpoint", id: "breakpoints" });
    for (const bp of BREAKPOINTS) {
      const radio = el("input", {
        type: "radio",
        name: "breakpoint",
        "aria-label": `${breakpointLabel(bp)} ${FRAME_WIDTH[bp]}`,
        id: `bp-${bp}`
      });
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        state.bp = bp;
        syncUrl();
        render();
      });
      breakpointRadios.set(bp, radio);
      group.append(
        el("label", { class: "bp-label", for: `bp-${bp}` }, [
          radio,
          el("span", { class: "mono" }, [`${breakpointLabel(bp)} ${FRAME_WIDTH[bp]}`])
        ])
      );
    }
    const add = button("Add", { id: "add-button", class: "primary" });
    add.prepend(icon("plus"));
    add.addEventListener("click", () => openAddMenu());
    topButtons.set("Add", add);
    const saveVersion2 = button("Save version", { id: "save-version-button", class: "ghost" });
    saveVersion2.prepend(icon("save"));
    saveVersion2.addEventListener("click", () => openSaveVersionDialog());
    topButtons.set("Save version", saveVersion2);
    const share = button("Share", { id: "share-button", class: "ghost" });
    share.prepend(icon("share"));
    share.addEventListener("click", () => openShareDialog());
    topButtons.set("Share", share);
    const fan = button("Fan", { id: "fan-button", class: "ghost" });
    fan.prepend(icon("fan"));
    fan.addEventListener("click", () => toggleFan());
    topButtons.set("Fan", fan);
    const stylePanelToggle = button("Style panel", {
      id: "style-panel-button",
      class: "ghost",
      "aria-expanded": "true",
      "aria-controls": "style-panel"
    });
    stylePanelToggle.prepend(icon("panel"));
    stylePanelToggle.addEventListener("click", () => toggleStylePanel());
    topButtons.set("Style panel", stylePanelToggle);
    const navigatorToggle = button("Navigator", {
      id: "navigator-button",
      class: "ghost",
      "aria-expanded": "false",
      "aria-controls": "navigator"
    });
    navigatorToggle.prepend(icon("layers"));
    navigatorToggle.addEventListener("click", () => {
      state.navigatorOpen = !state.navigatorOpen;
      render();
      if (state.navigatorOpen) {
        const page = currentPage();
        const id = state.selectedId ?? page?.root.id;
        if (id !== void 0) {
          document.querySelector(`[role="treeitem"][data-node-id="${id}"]`)?.focus();
        }
      }
    });
    topButtons.set("Navigator", navigatorToggle);
    presenceBar = el("div", { id: "presence", class: "presence" });
    return el("header", { role: "banner", id: "topbar" }, [
      el("span", { class: "brand" }, [state.workspaceName]),
      pageSelect,
      group,
      add,
      panelButton("Tokens", "tokens", "palette"),
      panelButton("Collection", "collection", "database"),
      panelButton("Images", "images", "image"),
      panelButton("History", "history", "history"),
      saveVersion2,
      panelButton("Comments", "comments", "message"),
      share,
      panelButton("Publish", "publish", "globe"),
      fan,
      stylePanelToggle,
      navigatorToggle,
      presenceBar
    ]);
  }
  function buildBanners() {
    storageBanner = el("div", { id: "storage-banner", role: "alert", hidden: true }, [
      notices.storageBanner
    ]);
    modeBanner = el("div", { id: "mode-banner", hidden: true });
    const restore = button("Restore this version", { class: "primary" });
    restore.addEventListener("click", () => {
      const versionId = state.previewVersion?.id;
      if (versionId !== void 0) openRestoreDialog(versionId);
    });
    const back = button("Back to latest", { class: "ghost" });
    back.addEventListener("click", () => backToLatest());
    previewBanner = el("div", { id: "preview-banner", hidden: true }, [
      el("span", { class: "preview-text" }),
      restore,
      back
    ]);
    return el("div", { id: "banners" }, [storageBanner, modeBanner, previewBanner]);
  }
  function buildPhoneToolbar() {
    const comments = button("Comments", { class: "ghost" });
    comments.addEventListener("click", () => openPanel("comments"));
    const pages = button("Pages", { class: "ghost" });
    pages.addEventListener("click", () => openPagesSheet());
    const publishStatus = button("Publish status", { class: "ghost" });
    publishStatus.addEventListener("click", () => openPanel("publish"));
    phoneToolbar = el("div", { role: "toolbar", "aria-label": "Preview tools", id: "phone-toolbar" }, [
      comments,
      pages,
      publishStatus
    ]);
    return phoneToolbar;
  }
  function openPagesSheet() {
    const existing = document.getElementById("pages-sheet");
    existing?.remove();
    const list = el(
      "ul",
      {},
      activeDoc().pages.map(
        (page) => el("li", {}, [
          el("a", { href: `/w/${state.workspaceId}/edit?page=${page.id}` }, [page.name])
        ])
      )
    );
    const close = button("Close", { class: "ghost" });
    const sheet2 = el("div", { role: "dialog", "aria-label": "Pages", id: "pages-sheet" }, [
      el("h2", {}, ["Pages"]),
      list,
      close
    ]);
    close.addEventListener("click", () => sheet2.remove());
    sheet2.addEventListener("keydown", (event) => {
      if (event.key === "Escape") sheet2.remove();
    });
    document.body.append(sheet2);
    close.focus();
  }
  function layoutOf(width) {
    if (width >= 1280) return "desktop";
    if (width >= 768) return "tablet";
    return "phone";
  }
  function renderTopbar() {
    patchChildren(
      pageSelect,
      activeDoc().pages,
      (page) => page.id,
      () => el("option"),
      (option, page) => {
        option.value = page.id;
        setText(option, page.name);
      }
    );
    pageSelect.value = state.pageId;
    for (const [bp, radio] of breakpointRadios) radio.checked = state.bp === bp;
    const editing = canEdit();
    const phone = state.layout === "phone";
    const show = (label, visible) => {
      const control = topButtons.get(label);
      if (control) control.hidden = !visible;
    };
    show("Add", editing && !phone);
    show("Tokens", editing && !phone);
    show("Collection", editing && !phone);
    show("Images", editing && !phone);
    show("Save version", editing && !phone);
    show("Share", state.role === "owner" && !phone);
    show("Publish", editing && !phone);
    show("History", !phone);
    show("Comments", !phone);
    show("Fan", !phone);
    show("Style panel", editing && !phone);
    show("Navigator", state.layout === "tablet");
    const fan = topButtons.get("Fan");
    if (fan) fan.disabled = !fanAvailable();
    const navigatorToggle = topButtons.get("Navigator");
    if (navigatorToggle) {
      navigatorToggle.setAttribute("aria-expanded", state.navigatorOpen ? "true" : "false");
    }
    const styleToggle = topButtons.get("Style panel");
    if (styleToggle) {
      styleToggle.setAttribute(
        "aria-expanded",
        state.stylePanel.motion === "closed" ? "false" : "true"
      );
    }
    document.getElementById("breakpoints").hidden = phone;
    patchChildren(
      presenceBar,
      orderedPresence(),
      (person) => person.id,
      () => button("", { class: "avatar" }),
      (element, person) => {
        const label = `${person.name}, ${person.role === "viewer" ? "viewing" : "editing"}`;
        setAttr(element, "aria-label", label);
        setText(element, person.name.slice(0, 1).toUpperCase());
      }
    );
  }
  function orderedPresence() {
    const me = state.presence.find((person) => person.id === state.user.id);
    const others = state.presence.filter((person) => person.id !== state.user.id);
    return me ? [me, ...others] : others;
  }
  function renderBanners() {
    storageBanner.hidden = !state.storageDown;
    const viewer = state.role === "viewer";
    modeBanner.hidden = !viewer;
    if (viewer) {
      const owner = state.members.find((member) => member.role === "owner");
      setText(modeBanner, notices.commentMode(owner?.name ?? owner?.email ?? "the owner"));
    }
    previewBanner.hidden = state.previewVersion === null;
    if (state.previewVersion) {
      setText(
        previewBanner.querySelector(".preview-text"),
        notices.previewBanner(state.previewVersion.name)
      );
      const restore = previewBanner.querySelector("button");
      restore.hidden = state.role === "viewer";
      restore.disabled = state.busy.restore;
      if (state.busy.restore) restore.setAttribute("aria-busy", "true");
      else restore.removeAttribute("aria-busy");
    }
    phoneToolbar.hidden = state.layout !== "phone";
  }
  function renderAll() {
    state.layout = layoutOf(window.innerWidth);
    if (state.layout === "phone") state.bp = "phone";
    document.body.dataset["layout"] = state.layout;
    renderTopbar();
    renderBanners();
    renderNavigator();
    renderCanvas();
    renderStylePanel();
    renderSheet();
    keepFocusInEditor();
  }
  function keepFocusInEditor() {
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    if (state.selectedId !== null && navigatorVisible()) {
      const row2 = document.querySelector(
        `[role="treeitem"][data-node-id="${state.selectedId}"]`
      );
      if (row2) {
        row2.focus();
        return;
      }
    }
    canvasElement().focus();
  }
  function installPointer() {
    const canvas = canvasElement();
    canvas.addEventListener("click", (event) => {
      const target2 = event.target.closest("[data-node-id]");
      if (event.target.closest("a")) event.preventDefault();
      if (!target2) return;
      const nodeId2 = target2.dataset["nodeId"];
      if (nodeId2 !== void 0) selectNode(nodeId2);
    });
    canvas.addEventListener("mousedown", (event) => {
      if (!canEdit()) return;
      const target2 = event.target.closest("[data-node-id]");
      const nodeId2 = target2?.dataset["nodeId"];
      if (nodeId2 === void 0 || nodeId2 !== state.selectedId) return;
      const page = currentPage();
      if (page && nodeId2 === page.root.id) return;
      const node = nodeById(nodeId2);
      if (!node) return;
      const from = { x: event.clientX, y: event.clientY };
      let started = false;
      const move = (moveEvent) => {
        if (!started) {
          if (Math.abs(moveEvent.clientX - from.x) + Math.abs(moveEvent.clientY - from.y) < 5) return;
          started = true;
          dragStart({ kind: "node", type: node.type, nodeId: nodeId2 });
        }
        dragMove(moveEvent.clientX, moveEvent.clientY);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        if (started) dragEnd();
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
    canvas.addEventListener("dragover", (event) => {
      if (!dragging()) return;
      event.preventDefault();
      dragMove(event.clientX, event.clientY);
    });
    canvas.addEventListener("drop", (event) => {
      if (!dragging()) return;
      event.preventDefault();
      dragEnd();
    });
    document.getElementById("navigator")?.addEventListener("dragover", (event) => {
      if (!dragging()) return;
      event.preventDefault();
      dragMove(event.clientX, event.clientY);
    });
    let lastCursor = 0;
    canvas.addEventListener("mousemove", (event) => {
      const now = performance.now();
      if (now - lastCursor < 50) return;
      lastCursor = now;
      const frame2 = frameElement(state.bp);
      const rect = frame2.getBoundingClientRect();
      const scale = rect.width / FRAME_WIDTH[state.bp] || 1;
      sendCursor((event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
    });
  }
  function sendCursor(x, y) {
    const page = currentPage();
    if (!page) return;
    sendLive({ type: "cursor", pageId: page.id, x, y });
  }
  function cursorElement(userId, name) {
    const existing = document.getElementById(`cursor-${userId}`);
    if (existing) return existing;
    const made = el("div", { id: `cursor-${userId}`, "aria-hidden": "true", class: "cursor" }, [
      name
    ]);
    canvasElement().append(made);
    return made;
  }
  function handleLive(message) {
    const type = message["type"];
    if (type === "hello") {
      const you = message["you"];
      state.role = you.role;
      state.seq = Number(message["seq"] ?? 0);
      render();
      return;
    }
    if (type === "presence") {
      const people = message["people"];
      const before = new Set(state.presence.map((person) => person.id));
      state.presence = people;
      for (const person of people) {
        if (person.id !== state.user.id && !before.has(person.id)) {
          sayWithToast(notices.joined(person.name));
        }
      }
      for (const id of before) {
        if (!people.some((person) => person.id === id)) {
          document.getElementById(`cursor-${id}`)?.remove();
          state.remoteSelections.delete(id);
        }
      }
      render();
      return;
    }
    if (type === "cursor") {
      const userId = String(message["userId"]);
      const pageId = String(message["pageId"] ?? "");
      if (pageId !== state.pageId) {
        document.getElementById(`cursor-${userId}`)?.remove();
        return;
      }
      const cursor = cursorElement(userId, String(message["name"] ?? ""));
      const frame2 = frameElement(state.bp);
      const frameRect = frame2.getBoundingClientRect();
      const canvasRect = canvasElement().getBoundingClientRect();
      const scale = frameRect.width / FRAME_WIDTH[state.bp] || 1;
      cursor.style.left = `${frameRect.left - canvasRect.left + Number(message["x"]) * scale + canvasElement().scrollLeft}px`;
      cursor.style.top = `${frameRect.top - canvasRect.top + Number(message["y"]) * scale + canvasElement().scrollTop}px`;
      return;
    }
    if (type === "selection") {
      const userId = String(message["userId"]);
      const nodeId2 = message["nodeId"];
      if (typeof nodeId2 === "string") state.remoteSelections.set(userId, nodeId2);
      else state.remoteSelections.delete(userId);
      render();
      return;
    }
    if (type === "conflict") {
      const winner = message["winner"];
      sayWithToast(
        notices.conflict(winner.name, String(message["property"]), String(message["value"]))
      );
      return;
    }
    if (type === "role") {
      const role = message["role"];
      state.role = role;
      sayWithToast(notices.roleChanged(role === "viewer" ? "viewer" : "editor"));
      const active = document.activeElement;
      render();
      if (active === null || !active.isConnected || active.hidden) canvasElement().focus();
      return;
    }
    if (type === "comment") {
      mergeThread(message["thread"]);
      render();
      return;
    }
    if (type === "restored") {
      const by = message["by"];
      sayWithToast(notices.restored(by.name, String(message["versionName"])));
      void reloadDocument().then(() => loadVersions());
      return;
    }
  }
  async function mountEditor(root2, boot2) {
    state.workspaceId = boot2.workspaceId;
    state.workspaceName = boot2.workspaceName;
    state.user = boot2.user;
    state.role = boot2.role;
    const url = new URL(window.location.href);
    const doc = await api.get(`/api/workspaces/${boot2.workspaceId}/document`);
    state.doc = doc;
    state.seq = doc.seq;
    const wantedPage = url.searchParams.get("page");
    state.pageId = wantedPage !== null && doc.pages.some((page) => page.id === wantedPage) ? wantedPage : doc.pages[0]?.id ?? "";
    const wantedBp = url.searchParams.get("bp");
    if (wantedBp === "tablet" || wantedBp === "phone" || wantedBp === "desktop") state.bp = wantedBp;
    if (url.searchParams.get("panel") === "publish") state.panel = "publish";
    state.layout = layoutOf(window.innerWidth);
    setRenderHook(renderAll);
    onLive(handleLive);
    root2.replaceChildren(
      buildTopbar(),
      buildBanners(),
      el("div", { id: "workbench" }, [
        navigatorElement(),
        canvasElement(),
        stylePanelElement(),
        sheetElement()
      ]),
      buildPhoneToolbar()
    );
    installKeys();
    installPointer();
    window.addEventListener("resize", () => render());
    window.addEventListener("popstate", () => {
      void applyUrlVersion();
    });
    onAccepted(() => {
      void loadPublish();
    });
    render();
    connectLive();
    const members = await api.get(
      `/api/workspaces/${boot2.workspaceId}/members`
    );
    state.members = members.members;
    await Promise.all([loadPublish(), loadImages(), loadVersions(), loadThreads()]);
    void checkStorage();
    const versionId = url.searchParams.get("version");
    if (versionId !== null) await openPreview(versionId);
    syncUrl();
    render();
    if (document.activeElement === null || document.activeElement === document.body) {
      canvasElement().focus();
    }
  }

  var boot = window.__BOOT__;
  var root = document.getElementById("app");
  if (boot !== void 0 && root !== null) {
    if (boot.route === "signup") mountSignup(root);
    else if (boot.route === "signin") mountSignin(root);
    else if (boot.route === "workspaces") void mountWorkspaces(root);
    else if (boot.route === "editor") {
      void mountEditor(root, {
        workspaceId: boot.workspaceId ?? "",
        workspaceName: boot.workspaceName ?? "",
        user: { id: boot.user?.id ?? "", name: boot.user?.name ?? "" },
        role: boot.role ?? "viewer"
      });
    }
  }
})();
