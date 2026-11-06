// src/client/lib/state.ts
var ClientStore = class {
  drafts = /* @__PURE__ */ new Map();
  draftOf(key) {
    const held = this.drafts.get(key);
    if (held !== void 0) return held;
    const fresh = {};
    this.drafts.set(key, fresh);
    return fresh;
  }
  setDraft(key, patch) {
    const held = this.drafts.get(key) ?? {};
    this.drafts.set(key, { ...held, ...patch });
  }
  clearDraft(key) {
    this.drafts.delete(key);
  }
};
var Api = class {
  async get(path) {
    return await this.call("GET", path, void 0);
  }
  async post(path, body) {
    return await this.call("POST", path, body ?? {});
  }
  async patch(path, body) {
    return await this.call("PATCH", path, body);
  }
  async delete(path) {
    return await this.call("DELETE", path, void 0);
  }
  async call(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: body === void 0 ? {} : { "content-type": "application/json" },
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    if (response.status === 204) return {};
    const text = await response.text();
    const parsed = text.length === 0 ? {} : JSON.parse(text);
    if (!response.ok) {
      const error = parsed.error;
      throw new ApiError(response.status, error?.code ?? "error", error?.message ?? "", error?.fields ?? {});
    }
    return parsed;
  }
};
var ApiError = class extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
};

// src/client/lib/ui.ts
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") {
      node.className = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child === null || child === void 0) continue;
    node.append(child);
  }
  return node;
}
function heading(lines, announcer2) {
  const node = el("h1", { "data-part": "heading" });
  for (const line of lines) {
    const span = el("span", { "data-part": "heading-line" }, line);
    node.append(span);
  }
  return node;
}
function link(href, label, attrs = {}) {
  return el("a", { href, ...attrs }, label);
}
function problems() {
  const region = el("div", { role: "region", "aria-label": "Problems", class: "problems", hidden: "" });
  return {
    region,
    show(messages) {
      region.replaceChildren();
      for (const message of messages) {
        region.append(el("p", { class: "problem" }, message.text));
      }
      region.hidden = messages.length === 0;
    },
    clear() {
      region.replaceChildren();
      region.hidden = true;
    }
  };
}
var api = new Api();
function field(tag, attrs = {}) {
  return el(tag, attrs);
}
function fileField(attrs = {}) {
  return el("input", { type: "file", ...attrs });
}
function workingButton(label, run, workingText) {
  const node = el("button", { type: "button" }, label);
  node.addEventListener("click", async () => {
    if (node.getAttribute("aria-disabled") === "true") return;
    const original = node.textContent ?? "";
    node.textContent = workingText;
    node.setAttribute("aria-disabled", "true");
    try {
      await run();
    } finally {
      node.textContent = original;
      node.removeAttribute("aria-disabled");
    }
  });
  return node;
}

// src/client/screens/home.ts
async function buildHome(ctx2) {
  const h = heading(["Boards drawn to the frame"], ctx2.announcer);
  const frame = el("div", { class: "hero-frame", "aria-hidden": "true" });
  const card = el("section", { class: "hero-card" });
  const band = el("div", { class: "clapband", "aria-hidden": "true" });
  card.append(
    band,
    el("p", { class: "wordmark" }, "Noor Bakker Boards"),
    h.cloneNode(true),
    el("p", { class: "hero-copy" }, "One desk from script file to signed-off delivery and fee letter."),
    link("/reel", "See the reel", { class: "action" }),
    el("p", { class: "hero-foot" }, "See the reel")
  );
  const hero = el("section", { class: "hero" }, frame, card);
  const kinds = el(
    "ul",
    { class: "kinds" },
    el("li", {}, "Boards for a :30 that hold on a beat."),
    el("li", {}, "Story reels that land the timing."),
    el("li", {}, "Pitch frames that carry a whole room.")
  );
  const foot = el(
    "p",
    { class: "home-foot" },
    link("/how-it-works", "How it works"),
    " \xB7 ",
    link("/how-it-works#amsterdam", "Contact"),
    " \xB7 ",
    link("/sign-in", "Sign in")
  );
  const body = el("main", { class: "home" }, hero, kinds, foot);
  return { heading: h, body };
}

// src/client/screens/reel.ts
var KINDS = [
  { value: null, label: "All" },
  { value: "boards", label: "Boards" },
  { value: "reels", label: "Reels" },
  { value: "pitchFrames", label: "Pitch frames" }
];
var WORK = {
  boards: [
    { title: "Ferry at First Light", kind: "boards" },
    { title: "The Long Bakery Shift", kind: "boards" },
    { title: "Cold Snap Cola", kind: "boards" }
  ],
  reels: [
    { title: "Night Tram", kind: "reels" },
    { title: "Harbour Swimmers", kind: "reels" },
    { title: "Paper Kites", kind: "reels" }
  ],
  pitchFrames: [
    { title: "Rainline Coats", kind: "pitchFrames" },
    { title: "Orchard Bank", kind: "pitchFrames" },
    { title: "Salt and Thyme", kind: "pitchFrames" }
  ]
};
var CLIENTS = [
  "Tidewater Soda",
  "Kestrel Air",
  "Oak & Ember Bakers",
  "Northquay Bank",
  "Lumen Bicycles",
  "Saffron Street Foods"
];
async function buildReel(ctx2, query) {
  const h = heading(["Work on the reel"], ctx2.announcer);
  const kind = query.get("kind");
  const group = el("div", { role: "radiogroup", "aria-label": "Kind of work", class: "kind-filter" });
  const grid = el("div", { class: "work-grid", id: "work-grid" });
  const items = {};
  const renderGrid = () => {
    const kept = WORK[kind ?? ""] ?? [];
    const all = kind === null;
    const list = all ? [...WORK.boards, ...WORK.reels, ...WORK.pitchFrames] : kept;
    for (const work of list) {
      const node = items[work.title];
      if (node === void 0) {
        const item = el("div", { class: "work-item", "data-part": "work" }, el("p", {}, work.title));
        items[work.title] = item;
      }
      if (!grid.contains(items[work.title])) {
        grid.append(items[work.title]);
      }
    }
    for (const child of Array.from(grid.children)) {
      const title = child.textContent ?? "";
      if (!list.some((w) => w.title === title)) {
        grid.removeChild(child);
      }
    }
  };
  for (const option of KINDS) {
    const radio = field("input", { type: "radio", name: "kind", ...option.value === null ? {} : { value: option.value } });
    radio.setAttribute("role", "radio");
    radio.id = `kind-${option.value ?? "all"}`;
    if (option.value === null && kind === null || option.value !== null && option.value === kind) {
      radio.checked = true;
    }
    radio.addEventListener("change", () => {
      const next = option.value === null ? "/reel" : `/reel?kind=${option.value}`;
      void ctx2.router.go(next);
    });
    const label = el("label", { for: radio.id }, option.label);
    label.style.minHeight = "44px";
    label.style.minWidth = "44px";
    label.style.display = "inline-flex";
    label.style.alignItems = "center";
    group.append(el("div", { class: "kind-option" }, radio, label));
  }
  renderGrid();
  const strip = el("div", { class: "client-strip", "data-part": "client-strip" });
  const inner = el("div", { class: "client-strip-inner" });
  for (const name of CLIENTS) {
    inner.append(el("span", { class: "client-name" }, name));
  }
  strip.append(inner);
  const clients = el("section", { class: "clients", "aria-label": "Clients", role: "region", "data-part": "client-strip" }, strip);
  const body = el("main", { class: "reel" }, h, group, grid, clients);
  return { heading: h, body };
}

// src/client/screens/how-it-works.ts
var SECTIONS = [
  { key: "script", label: "From script to frames", text: "A script file comes in as it was written, and every row becomes a frame with its own timing." },
  { key: "timing", label: "Timing the reel", text: "The Slate strip carries each clip at 2 pixels a frame, so the sum reads exact against the job's target." },
  { key: "review", label: "Review and notes", text: "A private page reaches the producer in their own language, and every pin comes back with its frame attached." },
  { key: "delivery", label: "Delivery and fee letter", text: "Boards PDF, edit decision list and shot list ship together, and the fee letter locks when it is accepted." }
];
var CITIES = [
  { key: "amsterdam", label: "Amsterdam", text: "Prinsengracht 100, 1015 EA Amsterdam" },
  { key: "new-york", label: "New York", text: "Visits by appointment, Manhattan" },
  { key: "toronto", label: "Toronto", text: "Visits by appointment, Toronto" }
];
async function buildHowItWorks(ctx2, query) {
  const h = heading(["How the work runs"], ctx2.announcer);
  const openKey = query.get("open") ?? null;
  const accordions = el("div", { class: "accordions" });
  const contact = el("section", { class: "contact" });
  const cities = el("div", { class: "cities" });
  for (const section of SECTIONS) {
    const button = el("button", { type: "button", class: "accordion-button", "aria-expanded": openKey === section.key ? "true" : "false" }, section.label);
    button.style.minHeight = "44px";
    const panel = el("div", { class: "accordion-panel", hidden: openKey === section.key ? "" : "true" });
    panel.append(el("p", {}, section.text));
    button.addEventListener("click", () => {
      const isOpen = button.getAttribute("aria-expanded") === "true";
      void ctx2.router.go(isOpen ? "/how-it-works" : `/how-it-works?open=${section.key}`);
    });
    if (openKey === section.key) {
      button.setAttribute("aria-expanded", "true");
      panel.hidden = false;
    }
    accordions.append(button, panel);
  }
  for (const city of CITIES) {
    const headingNode = el("h2", { id: city.key, tabindex: "-1" }, city.label);
    const text = el("p", {}, city.text);
    const cityBlock = el("div", { class: "city" }, headingNode, text);
    cities.append(cityBlock);
  }
  const address = el("p", { class: "address", id: "the-address" }, "desk@noorbakkerboards.example");
  const copyButton = el("button", { type: "button", class: "copy-address" }, "Copy address");
  copyButton.style.minHeight = "44px";
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText("desk@noorbakkerboards.example");
      ctx2.announcer.announce("Address copied.");
    } catch {
      const range = document.createRange();
      range.selectNodeContents(address);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      ctx2.announcer.announce("Press Ctrl+C to copy the address.");
    }
  });
  const problem = problems();
  const name = field("input", { type: "text", autocomplete: "name" });
  const email = field("input", { type: "email", autocomplete: "email" });
  const phone = field("input", { type: "tel", autocomplete: "tel" });
  const message = field("textarea", {});
  const form = el("form", { "aria-label": "Enquiry", novalidate: "" });
  form.append(
    el("label", { for: "enq-name" }, "Name"),
    name,
    el("label", { for: "enq-email" }, "Email"),
    email,
    el("label", { for: "enq-phone" }, "Phone"),
    phone,
    el("label", { for: "enq-message" }, "Message"),
    message,
    workingButton("Send enquiry", async () => {
      const fields = [];
      if (name.value.trim().length === 0) fields.push({ field: "name", text: "Type a name." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
        fields.push({ field: "email", text: "Type a mail address such as name@example.test." });
      }
      if (message.value.trim().length === 0) fields.push({ field: "message", text: "Type your message." });
      problem.show(fields);
      if (fields.length > 0) return;
      try {
        const answer = await api.post("/api/enquiries", {
          name: name.value.trim(),
          email: email.value.trim(),
          phone: phone.value.trim().length === 0 ? void 0 : phone.value.trim(),
          message: message.value
        });
        ctx2.announcer.announce(String(answer.message ?? ""));
        form.reset();
      } catch (e) {
        if (e instanceof ApiError) {
          ctx2.announcer.announce(e.message);
        }
      }
    }, "Working\u2026")
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
  });
  contact.append(
    cities,
    address,
    copyButton,
    problem.region,
    form
  );
  const body = el("main", { class: "how-it-works" }, h, accordions, contact);
  return { heading: h, body };
}

// src/client/screens/auth.ts
async function buildSignIn(ctx2, query) {
  const h = heading(["Sign in"], ctx2.announcer);
  const email = field("input", { type: "email", autocomplete: "email" });
  const password = field("input", { type: "password", autocomplete: "current-password" });
  const problem = problems();
  const next = query.get("next") ?? "/desk/jobs";
  const form = el("form", { "aria-label": "Sign in", novalidate: "" });
  form.append(
    el("label", { for: "si-email" }, "Email"),
    email,
    el("label", { for: "si-password" }, "Password"),
    password,
    problem.region,
    workingButton("Sign in", async () => {
      try {
        await api.post("/api/sign-in", { email: email.value.trim(), password: password.value });
        await ctx2.router.go(next);
      } catch (e) {
        if (e instanceof ApiError) {
          problem.show([{ field: "email", text: e.message }]);
          ctx2.announcer.announce(e.message);
        }
      }
    }, "Working\u2026")
  );
  const body = el("main", { class: "auth" }, h, form, el("p", {}, link("/sign-up", "Start a desk")));
  return { heading: h, body, refresh: null };
}
async function buildSignUp(ctx2) {
  const h = heading(["Start a desk"], ctx2.announcer);
  const name = field("input", { type: "text", autocomplete: "name" });
  const email = field("input", { type: "email", autocomplete: "email" });
  const password = field("input", { type: "password", autocomplete: "new-password" });
  const problem = problems();
  const form = el("form", { "aria-label": "Start a desk", novalidate: "" });
  form.append(
    el("label", { for: "su-name" }, "Name"),
    name,
    el("label", { for: "su-email" }, "Email"),
    email,
    el("label", { for: "su-password" }, "Password"),
    password,
    problem.region,
    workingButton("Start a desk", async () => {
      const fields = [];
      if (name.value.trim().length === 0) fields.push({ field: "name", text: "Type a name." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
        fields.push({ field: "email", text: "Type a mail address such as name@example.test." });
      }
      if (password.value.length < 10) fields.push({ field: "password", text: "A password has at least 10 characters." });
      problem.show(fields);
      if (fields.length > 0) return;
      try {
        await api.post("/api/sign-up", { name: name.value.trim(), email: email.value.trim(), password: password.value });
        await ctx2.router.go("/desk/jobs");
      } catch (e) {
        if (e instanceof ApiError) {
          problem.show([{ field: "email", text: e.message }]);
          ctx2.announcer.announce(e.message);
        }
      }
    }, "Working\u2026")
  );
  const body = el("main", { class: "auth" }, h, form, el("p", {}, link("/sign-in", "Sign in")));
  return { heading: h, body, refresh: null };
}

// src/client/screens/jobs.ts
async function buildJobs(ctx2, query) {
  const h = heading(["Jobs"], ctx2.announcer);
  const search = field("input", { type: "search", "aria-label": "Search jobs and clients", role: "searchbox", autocomplete: "off" });
  const results = el("ul", { role: "list", "aria-label": "Search results", class: "search-results", hidden: "true" });
  const clientFilter = query.get("client") ?? "";
  const stateFilter = query.get("state") ?? "";
  const rateFilter = query.get("frameRate") ?? "";
  const sort = query.get("sort") ?? "dueDate";
  const cursor = query.get("cursor");
  const table = el("div", { class: "table-frame", role: "region", "aria-label": "Jobs table", tabindex: "0" });
  const rowsEl = el("tbody", {});
  const tableEl = el("table", { class: "jobs-table" }, el("thead", {}, el("tr", {}, el("th", {}, "Title"), el("th", {}, "Client"), el("th", {}, "State"), el("th", {}, "Frame rate"), el("th", {}, "Due date"))), rowsEl);
  table.append(tableEl);
  const newJobButton = el("button", { type: "button", class: "primary" }, "New job");
  newJobButton.style.minHeight = "44px";
  let searchTimer = null;
  let searchSeq = 0;
  search.addEventListener("input", () => {
    if (searchTimer !== null) window.clearTimeout(searchTimer);
    const text = search.value.trim();
    if (text.length === 0) {
      results.hidden = true;
      results.replaceChildren();
      return;
    }
    searchTimer = window.setTimeout(async () => {
      const seq = ++searchSeq;
      try {
        const answer = await api.get(`/api/search?q=${encodeURIComponent(text)}`);
        if (seq !== searchSeq) return;
        const jobs = answer.jobs ?? [];
        const clients = answer.clients ?? [];
        const producers = answer.producers ?? [];
        const total = Number(answer.total ?? 0);
        results.replaceChildren();
        for (const job of jobs) {
          results.append(el("li", {}, link(`/desk/jobs/${String(job.id)}`, String(job.title))));
        }
        for (const client of clients) {
          results.append(el("li", {}, link(`/desk/clients/${String(client.id)}`, String(client.name))));
        }
        for (const producer of producers) {
          results.append(el("li", {}, String(producer.name)));
        }
        results.hidden = false;
        ctx2.announcer.announce(total === 0 ? "No results." : total === 1 ? "1 result." : `${total} results.`);
      } catch {
      }
    }, 300);
  });
  async function load() {
    const params = new URLSearchParams();
    if (clientFilter.length > 0) params.set("client", clientFilter);
    if (stateFilter.length > 0) params.set("state", stateFilter);
    if (rateFilter.length > 0) params.set("frameRate", rateFilter);
    params.set("sort", sort);
    if (cursor !== null && cursor.length > 0) params.set("cursor", cursor);
    const answer = await api.get(`/api/jobs?${params.toString()}`);
    const jobs = answer.jobs ?? [];
    rowsEl.replaceChildren();
    for (const job of jobs) {
      const title = String(job.title);
      const row = el(
        "tr",
        {},
        el("td", {}, link(`/desk/jobs/${String(job.id)}`, title)),
        el("td", {}, String(job.clientName ?? "")),
        el("td", {}, jobStateText(String(job.state))),
        el("td", {}, String(job.frameRate)),
        el("td", {}, String(job.dueDate))
      );
      const menuButton = el("button", { type: "button", "aria-label": `Actions for ${title}` }, "Actions");
      menuButton.style.minHeight = "44px";
      menuButton.addEventListener("click", () => {
        const menu = el("div", { role: "menu", class: "menu" });
        const open = el("button", { role: "menuitem", type: "button" }, "Open");
        const duplicate = el("button", { role: "menuitem", type: "button" }, "Duplicate");
        const archive = el("button", { role: "menuitem", type: "button" }, "Archive");
        open.addEventListener("click", () => {
          void ctx2.router.go(`/desk/jobs/${String(job.id)}`);
        });
        duplicate.addEventListener("click", async () => {
          try {
            const copy = await api.post(`/api/jobs/${String(job.id)}/duplicate`, {});
            ctx2.announcer.announce("Job duplicated.");
            await ctx2.router.go(`/desk/jobs/${String(copy.id)}`);
          } catch (e) {
            if (e instanceof ApiError) ctx2.announcer.announce(e.message);
          }
        });
        archive.addEventListener("click", async () => {
          try {
            await api.post(`/api/jobs/${String(job.id)}/archive`, {});
            ctx2.announcer.announce(`${title} archived.`);
            h.setAttribute("tabindex", "-1");
            h.focus();
            await load();
          } catch (e) {
            if (e instanceof ApiError) ctx2.announcer.announce(e.message);
          }
        });
        menu.append(open, duplicate, archive);
        menu.style.position = "absolute";
        menu.append();
        const rect = menuButton.getBoundingClientRect();
        const menuWrap = el("div", { class: "menu-wrap", style: `position:absolute; top:${rect.bottom}px; right:12px;` }, menu);
        document.body.append(menuWrap);
        const close = () => {
          menuWrap.remove();
          document.removeEventListener("click", close);
        };
        document.addEventListener("click", close);
      });
      row.append(el("td", {}, menuButton));
      rowsEl.append(row);
    }
  }
  await load();
  const body = el("main", { class: "jobs" }, h, search, results, table, newJobButton);
  return { heading: h, body, refresh: load };
}
function jobStateText(state) {
  switch (state) {
    case "draft":
      return "Draft";
    case "inReview":
      return "In review";
    case "signedOff":
      return "Signed off";
    case "delivered":
      return "Delivered";
    case "archived":
      return "Archived";
    default:
      return state;
  }
}

// src/client/screens/clients.ts
async function buildClients(ctx2) {
  const h = heading(["Clients"], ctx2.announcer);
  const rowsEl = el("tbody", {});
  const table = el(
    "div",
    { class: "table-frame", role: "region", "aria-label": "Clients", tabindex: "0" },
    el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", {}, "Place"), el("th", {}, "State"))), rowsEl)
  );
  const erasedList = el("ul", { class: "erased-list" });
  async function load() {
    const answer = await api.get("/api/clients");
    const clients = answer.clients ?? [];
    rowsEl.replaceChildren();
    for (const client of clients) {
      rowsEl.append(el(
        "tr",
        {},
        el("td", {}, link(`/desk/clients/${String(client.id)}`, String(client.name))),
        el("td", {}, placeText(String(client.place))),
        el("td", {}, clientStateText(String(client.state)))
      ));
    }
    const erased = answer.erasedClients ?? [];
    erasedList.replaceChildren();
    for (const client of erased) {
      erasedList.append(el("li", {}, `${String(client.name)} \u2014 Erased`));
    }
  }
  await load();
  const newClient = workingButton("New client", async () => {
    const name = window.prompt("Name") ?? "";
    if (name.trim().length === 0) {
      ctx2.announcer.announce("Type a name.");
      return;
    }
    try {
      const client = await api.post("/api/clients", { name: name.trim(), place: "netherlands" });
      ctx2.announcer.announce("Client added.");
      await ctx2.router.go(`/desk/clients/${String(client.id)}`);
    } catch (e) {
      if (e instanceof ApiError) ctx2.announcer.announce(e.message);
    }
  }, "Working\u2026");
  const body = el("main", { class: "clients" }, h, table, el("h2", {}, "Erased"), erasedList, newClient);
  return { heading: h, body, refresh: load };
}
async function buildClient(ctx2, clientId) {
  let headingText = "Client";
  const h = el("h1", {});
  const jobsEl = el("ul", { class: "client-jobs" });
  const producersEl = el("ul", { class: "client-producers" });
  const state = el("p", { class: "client-state" });
  let closeButton = null;
  async function load() {
    const client = await api.get(`/api/clients/${clientId}`);
    headingText = String(client.name);
    h.textContent = headingText;
    state.textContent = clientStateText(String(client.state));
    producersEl.replaceChildren();
    for (const producer of client.producers ?? []) {
      producersEl.append(el("li", {}, `${String(producer.name)} \u2014 ${String(producer.email)}`));
    }
    jobsEl.replaceChildren();
    for (const job of client.jobs ?? []) {
      jobsEl.append(el("li", {}, link(`/desk/jobs/${String(job.id)}`, String(job.title))));
    }
  }
  await load();
  const newProducer = workingButton("New producer", async () => {
    const name = window.prompt("Name") ?? "";
    const email = window.prompt("Email") ?? "";
    if (name.trim().length === 0 || email.trim().length === 0) {
      ctx2.announcer.announce("Type a name.");
      return;
    }
    try {
      await api.post(`/api/clients/${clientId}/producers`, { name: name.trim(), email: email.trim(), town: "amsterdam", language: "en" });
      ctx2.announcer.announce("Producer added.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx2.announcer.announce(e.message);
    }
  }, "Working\u2026");
  closeButton = workingButton("Close client", async () => {
    try {
      await api.post(`/api/clients/${clientId}/close`, {});
      ctx2.announcer.announce("Closing. You can bring it back until the date shown.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx2.announcer.announce(e.message);
    }
  }, "Working\u2026");
  const body = el("main", { class: "client" }, h, state, el("h2", {}, "Producers"), producersEl, newProducer, el("h2", {}, "Jobs"), jobsEl, closeButton);
  return { heading: h, body, refresh: load };
}
function placeText(place) {
  switch (place) {
    case "netherlands":
      return "Netherlands";
    case "ontario":
      return "Ontario";
    case "newYork":
      return "New York";
    case "dubai":
      return "Dubai";
    default:
      return place;
  }
}
function clientStateText(state) {
  switch (state) {
    case "active":
      return "Active";
    case "closing":
      return "Closing";
    case "erasing":
      return "Erasing";
    case "erased":
      return "Erased";
    default:
      return state;
  }
}

// src/client/screens/calls.ts
async function buildCalls(ctx2, query) {
  const h = heading(["Calls"], ctx2.announcer);
  const weekStart = query.get("week");
  const list = el("ul", { class: "call-list" });
  const today = await api.get("/api/today");
  const week = weekStart ?? String(today.weekStart);
  async function load() {
    const from = week;
    const answer = await api.get(`/api/calls?from=${from}`);
    const calls = (answer.calls ?? []).filter((c) => String(c.state) === "booked");
    list.replaceChildren();
    for (const call of calls) {
      const row = el(
        "li",
        { class: "call-row" },
        el("p", { class: "call-text" }, String(call.text))
      );
      const move = workingButton("Move call", async () => {
        const date = window.prompt("Date (2027-03-15)", String(call.date));
        const time = window.prompt("Time (09:00)", String(call.time));
        if (date === null || time === null) return;
        try {
          await api.patch(`/api/calls/${String(call.id)}`, { date, time, minutes: Number(call.minutes) });
          ctx2.announcer.announce("Call moved.");
          await load();
        } catch (e) {
          if (e instanceof ApiError) ctx2.announcer.announce(e.message);
        }
      }, "Working\u2026");
      const cancel = workingButton("Cancel call", async () => {
        try {
          await api.post(`/api/calls/${String(call.id)}/cancel`, {});
          ctx2.announcer.announce("Call cancelled.");
          await load();
        } catch (e) {
          if (e instanceof ApiError) ctx2.announcer.announce(e.message);
        }
      }, "Working\u2026");
      row.append(move, cancel);
      list.append(row);
    }
  }
  await load();
  const book = workingButton("Book a call", async () => {
    ctx2.announcer.announce("Book a call.");
  }, "Working\u2026");
  const earlier = el("a", { href: `/desk/calls?week=${addDays(week, -7)}`, class: "earlier-week" }, "Earlier week");
  const later = el("a", { href: `/desk/calls?week=${addDays(week, 7)}`, class: "later-week" }, "Later week");
  const body = el("main", { class: "calls" }, h, earlier, list, later, book);
  return { heading: h, body, refresh: load };
}
function addDays(date, days) {
  const d = /* @__PURE__ */ new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// src/client/screens/job.ts
async function buildBoard(ctx2, jobId) {
  const h = el("h1", {});
  const boardEl = el("div", { role: "listbox", "aria-label": "Board", class: "board-grid" });
  const uploads = el("ul", { "aria-label": "Uploads", class: "uploads" });
  const tools = el("div", { role: "group", "aria-label": "Frame tools", class: "frame-tools" });
  const framesField = fileField({ name: "Frame files", multiple: "" });
  let job = {};
  async function load() {
    job = await api.get(`/api/jobs/${jobId}`);
    h.textContent = String(job.title);
    const board = await api.get(`/api/jobs/${jobId}/board`);
    boardEl.replaceChildren();
    for (const frame of board.frames ?? []) {
      const option = el("div", {
        role: "option",
        "aria-label": `Frame ${String(frame.number)}`,
        "data-part": "board-frame",
        "data-frame": String(frame.number),
        "data-position": String(frame.position),
        class: "board-frame",
        tabindex: "0"
      }, el("p", {}, `Frame ${String(frame.number)}`));
      boardEl.append(option);
    }
  }
  await load();
  framesField.addEventListener("change", async () => {
    const files = Array.from(framesField.files ?? []);
    for (const file of files) {
      const row = el("li", { class: "upload-row" }, el("span", { class: "upload-state" }, "Working\u2026"));
      uploads.append(row);
      const body2 = new FormData();
      body2.append("file", file);
      try {
        const answer = await fetch(`/api/jobs/${jobId}/frames`, { method: "POST", body: body2 });
        if (answer.ok) {
          row.textContent = `${file.name}: Stored.`;
          ctx2.announcer.announce(`${file.name}: Stored.`);
        } else {
          const error = await answer.json();
          row.textContent = `${file.name}: ${error.error?.message ?? ""}`;
          ctx2.announcer.announce(`${file.name}: ${error.error?.message ?? ""}`);
        }
      } catch {
        row.textContent = `${file.name}: The file store is unavailable right now. Nothing was saved.`;
      }
    }
    await load();
  });
  const uploadButton = el("button", { type: "button", class: "primary" }, "Upload frames");
  uploadButton.addEventListener("click", () => framesField.click());
  const navigation = el(
    "nav",
    { "aria-label": "This job", class: "job-nav" },
    link(`/desk/jobs/${jobId}`, "Board"),
    link(`/desk/jobs/${jobId}/script`, "Script"),
    link(`/desk/jobs/${jobId}/reel`, "Reel"),
    link(`/desk/jobs/${jobId}/lines`, "Lines"),
    link(`/desk/jobs/${jobId}/cues`, "Cues"),
    link(`/desk/jobs/${jobId}/cuts`, "Cuts"),
    link(`/desk/jobs/${jobId}/notes`, "Notes"),
    link(`/desk/jobs/${jobId}/delivery`, "Delivery"),
    link(`/desk/jobs/${jobId}/letter`, "Fee letter")
  );
  const body = el("main", { class: "board" }, h, navigation, uploads, framesField, uploadButton, boardEl, tools);
  return { heading: h, body, refresh: load };
}
async function buildScript(ctx2, jobId) {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Script for ${String(job.title)}`], ctx2.announcer);
  const scriptField = fileField({ name: "Script file" });
  const preview = el("div", { role: "region", "aria-label": "Script preview", class: "table-frame", tabindex: "0" });
  const previewTable = el("table", {});
  preview.append(previewTable);
  scriptField.addEventListener("change", async () => {
    const file = scriptField.files?.[0];
    if (file === void 0) return;
    const body2 = new FormData();
    body2.append("file", file);
    const answer = await fetch(`/api/jobs/${jobId}/script/preview`, { method: "POST", body: body2 });
    if (!answer.ok) {
      const error = await answer.json();
      ctx2.announcer.announce(error.error?.message ?? "");
      return;
    }
    const parsed = await answer.json();
    previewTable.replaceChildren(el("thead", {}, el("tr", {}, el("th", {}, "Row"), el("th", {}, "Shot"), el("th", {}, "Result"))));
    const tbody = el("tbody", {});
    for (const row of parsed.rows ?? []) {
      tbody.append(el("tr", {}, el("td", {}, String(row.row)), el("td", {}, row.shot), el("td", {}, row.reason ?? row.result)));
    }
    previewTable.append(tbody);
    const refused = (parsed.rows ?? []).filter((r) => r.result === "refused").length;
    const matched = (parsed.rows ?? []).filter((r) => r.result === "matched").length;
    const fresh = (parsed.rows ?? []).length - refused - matched;
    ctx2.announcer.announce(`Preview ready: ${fresh} new, ${matched} matched, ${refused} refused.`);
  });
  const save = workingButton("Save", async () => {
    const file = scriptField.files?.[0];
    if (file === void 0) {
      ctx2.announcer.announce("Choose a script file first.");
      return;
    }
    const body2 = new FormData();
    body2.append("file", file);
    const answer = await fetch(`/api/jobs/${jobId}/script`, { method: "POST", body: body2 });
    if (!answer.ok) {
      const error = await answer.json();
      ctx2.announcer.announce(error.error?.message ?? "");
      return;
    }
    const parsed = await answer.json();
    ctx2.announcer.announce(`Script saved: ${parsed.created ?? 0} new, ${parsed.updated ?? 0} changed.`);
  }, "Working\u2026");
  const body = el("main", { class: "script" }, h, scriptField, preview, save);
  return { heading: h, body, refresh: null };
}
async function buildReelScreen(ctx2, jobId) {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Reel for ${String(job.title)}`], ctx2.announcer);
  const strip = el("div", { role: "group", "aria-label": "Slate strip", "data-part": "slate-strip", class: "slate-strip" });
  const numerals = el("p", { "data-part": "timecode", class: "timecode" }, "00:00:00:00");
  const seconds = el("p", { "data-part": "seconds", class: "seconds" }, "0.00 s");
  const target = el("p", { "data-part": "target", class: "target" }, "");
  let board = {};
  async function load() {
    board = await api.get(`/api/jobs/${jobId}/board`);
    strip.replaceChildren();
    let position = 0;
    for (const frame of board.frames ?? []) {
      const clip = el("button", {
        type: "button",
        "data-part": "clip",
        "data-frame": String(frame.number),
        "data-duration": String(frame.durationFrames),
        "aria-label": `Frame ${String(frame.number)}`,
        class: "clip"
      });
      clip.style.width = `${Number(frame.durationFrames) * 2}px`;
      strip.append(clip);
      position += Number(frame.durationFrames);
    }
    target.textContent = String(board.targetText ?? "");
    seconds.textContent = String(board.secondsText ?? "");
  }
  await load();
  const body = el("main", { class: "reel-screen" }, h, strip, numerals, seconds, target);
  return { heading: h, body, refresh: load };
}
async function buildLines(ctx2, jobId, query) {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Lines for ${String(job.title)}`], ctx2.announcer);
  const listEl = el("ul", { class: "lines-list" });
  const text = field("input", { type: "text" });
  const save = workingButton("Save", async () => {
    try {
      await api.post(`/api/jobs/${jobId}/lines`, { frame: 1, market: query.get("market") ?? "en", text: text.value, x: 10, y: 10, width: 60, height: 10, clips: 1 });
      ctx2.announcer.announce("Line saved.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx2.announcer.announce(e.message);
    }
  }, "Working\u2026");
  async function load() {
    const answer = await api.get(`/api/jobs/${jobId}/lines`);
    listEl.replaceChildren();
    for (const line of answer.lines ?? []) {
      listEl.append(el("li", { "data-part": "line", "data-x": String(line.x), "data-y": String(line.y) }, String(line.text)));
    }
  }
  await load();
  const body = el("main", { class: "lines" }, h, listEl, el("label", {}, "Line text"), text, save);
  return { heading: h, body, refresh: load };
}
async function buildCues(ctx2, jobId) {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Cues for ${String(job.title)}`], ctx2.announcer);
  const listEl = el("ul", { class: "cue-list" });
  async function load() {
    const answer = await api.get(`/api/jobs/${jobId}/cues`);
    listEl.replaceChildren();
    for (const cue of answer.cues ?? []) {
      listEl.append(el("li", { class: "cue" }, `${String(cue.title)} \u2014 ${String(cue.licenceText)}`));
    }
  }
  await load();
  const add = workingButton("Add cue", async () => {
    try {
      await api.post(`/api/jobs/${jobId}/cues`, { trackId: "hr-1001", market: "NL", from: "2027-03-01", until: "2027-03-31" });
      ctx2.announcer.announce("Cue added.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx2.announcer.announce(e.message);
    }
  }, "Working\u2026");
  const body = el("main", { class: "cues" }, h, listEl, add);
  return { heading: h, body, refresh: load };
}
async function buildCuts(ctx2, jobId) {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Cuts for ${String(job.title)}`], ctx2.announcer);
  const listEl = el("ul", { class: "cut-list" });
  const history2 = el("section", { role: "region", "aria-label": "Job history", class: "history" });
  const pages = el("section", { role: "region", "aria-label": "Private pages", class: "pages" });
  const films = el("section", { role: "region", "aria-label": "Preview films", class: "films" });
  async function load() {
    const answer = await api.get(`/api/jobs/${jobId}/cuts`);
    listEl.replaceChildren();
    for (const cut of answer.cuts ?? []) {
      listEl.append(el("li", { class: "cut" }, `Cut ${String(cut.number)} \u2014 ${String(cut.name)}`));
    }
    const events = await api.get(`/api/jobs/${jobId}/history`);
    history2.replaceChildren();
    for (const event of events.events ?? []) {
      history2.append(el("p", {}, `${String(event.text)}`));
    }
    const renders = await api.get(`/api/jobs/${jobId}/renders`);
    films.replaceChildren();
    for (const render of renders.renders ?? []) {
      films.append(el("p", {}, `Cut ${String(render.cut)} \u2014 ${renderStateText(String(render.state))}`));
    }
  }
  await load();
  const make = workingButton("Make cut", async () => {
    const name = window.prompt("Name") ?? "";
    if (name.trim().length === 0) {
      ctx2.announcer.announce("Type a name.");
      return;
    }
    try {
      await api.post(`/api/jobs/${jobId}/cuts`, { name: name.trim() });
      ctx2.announcer.announce("Cut made.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx2.announcer.announce(e.message);
    }
  }, "Working\u2026");
  const body = el("main", { class: "cuts" }, h, listEl, make, films, pages, history2);
  return { heading: h, body, refresh: load };
}
function renderStateText(state) {
  switch (state) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "ready":
      return "Ready";
    case "outdated":
      return "Outdated";
    case "failed":
      return "Failed";
    case "done":
      return "Done";
    default:
      return state;
  }
}
async function buildCompare(ctx2, jobId, query) {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Compare cuts for ${String(job.title)}`], ctx2.announcer);
  const differences = el("ul", { role: "list", "aria-label": "Differences", class: "differences" });
  const slider = field("input", { type: "range", "aria-label": "Wipe", min: "0", max: "100", value: query.get("wipe") ?? "50" });
  slider.setAttribute("aria-valuetext", `${slider.value}%`);
  slider.addEventListener("change", () => {
    void ctx2.router.go(`/desk/jobs/${jobId}/compare?a=1&b=2&wipe=${slider.value}`);
  });
  const a = Number(query.get("a") ?? "1");
  const b = Number(query.get("b") ?? "2");
  async function load() {
    const answer = await api.get(`/api/jobs/${jobId}/compare?a=${a}&b=${b}`);
    differences.replaceChildren();
    for (const difference of answer.differences ?? []) {
      differences.append(el("li", {}, difference));
    }
  }
  await load();
  const body = el("main", { class: "compare" }, h, slider, differences);
  return { heading: h, body, refresh: load };
}
async function buildNotes(ctx2, jobId, query) {
  const job = await api.get(`/desk/jobs/${jobId}`);
  const h = heading([`Notes for ${String(job.title)}`], ctx2.announcer);
  const rowsEl = el("tbody", {});
  const table = el(
    "div",
    { class: "table-frame", role: "region", "aria-label": "Notes table", tabindex: "0" },
    el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Frame"), el("th", {}, "Text"), el("th", {}, "Producer"), el("th", {}, "State"))), rowsEl)
  );
  async function load() {
    const params = new URLSearchParams();
    const state = query.get("state");
    if (state !== null) params.set("state", state);
    const answer = await api.get(`/api/jobs/${jobId}/notes?${params.toString()}`);
    rowsEl.replaceChildren();
    for (const note of answer.notes ?? []) {
      rowsEl.append(el(
        "tr",
        {},
        el("td", {}, String(note.frame)),
        el("td", {}, String(note.text)),
        el("td", {}, String(note.producerName)),
        el("td", {}, noteStateText(String(note.state)))
      ));
    }
  }
  await load();
  const body = el("main", { class: "notes" }, h, table);
  return { heading: h, body, refresh: load };
}
function noteStateText(state) {
  switch (state) {
    case "open":
      return "Open";
    case "done":
      return "Done";
    case "wontDo":
      return "Won't do";
    default:
      return state;
  }
}
async function buildDelivery(ctx2, jobId) {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Delivery for ${String(job.title)}`], ctx2.announcer);
  const listEl = el("ul", { class: "package-list" });
  async function load() {
    const answer = await api.get(`/api/jobs/${jobId}/packages`);
    listEl.replaceChildren();
    for (const pkg of answer.packages ?? []) {
      const item = el("li", {}, `Cut ${String(pkg.cut)} \u2014 ${String(pkg.state)}`);
      for (const file of pkg.files ?? []) {
        item.append(el("p", {}, el("a", { href: String(file.url) }, `Download ${fileKindText(String(file.kind))}`)));
      }
      listEl.append(item);
    }
  }
  await load();
  const make = workingButton("Make package", async () => {
    try {
      await api.post(`/api/jobs/${jobId}/packages`, { cut: 1 });
      ctx2.announcer.announce("Package ready.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx2.announcer.announce(e.message);
    }
  }, "Working\u2026");
  const body = el("main", { class: "delivery" }, h, listEl, make);
  return { heading: h, body, refresh: load };
}
function fileKindText(kind) {
  switch (kind) {
    case "boards":
      return "boards PDF";
    case "editDecisionList":
      return "edit decision list";
    case "shotList":
      return "shot list";
    default:
      return kind;
  }
}
async function buildLetter(ctx2, jobId) {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Fee letter for ${String(job.title)}`], ctx2.announcer);
  const currency = field("select", {});
  for (const code of ["EUR", "CAD", "USD"]) {
    currency.append(el("option", { value: code }, code));
  }
  const fee = field("input", { type: "text" });
  const scope = field("input", { type: "text" });
  const stateText = el("p", { class: "letter-state" });
  async function load() {
    try {
      const letter = await api.get(`/api/jobs/${jobId}/letter`);
      stateText.textContent = String(letter.state);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        stateText.textContent = "";
      }
    }
  }
  await load();
  const save = workingButton("Save letter", async () => {
    try {
      await api.post(`/api/jobs/${jobId}/letter`, { currency: currency.value, fee: fee.value, scope: scope.value });
      ctx2.announcer.announce("Letter saved.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx2.announcer.announce(e.message);
    }
  }, "Working\u2026");
  const send = workingButton("Send letter", async () => {
    try {
      const letter = await api.get(`/api/jobs/${jobId}/letter`);
      await api.post(`/api/letters/${String(letter.id)}/send`, { producerId: "" });
      ctx2.announcer.announce("Fee page ready.");
    } catch (e) {
      if (e instanceof ApiError) ctx2.announcer.announce(e.message);
    }
  }, "Working\u2026");
  const body = el(
    "main",
    { class: "letter" },
    h,
    el("label", {}, "Currency"),
    currency,
    el("label", {}, "Fee"),
    fee,
    el("label", {}, "Scope"),
    scope,
    stateText,
    save,
    send
  );
  return { heading: h, body, refresh: load };
}

// src/client/screens/notfound.ts
async function buildNotFound(ctx2) {
  const h = heading(["Page not found"], ctx2.announcer);
  const body = el("main", { class: "notfound" }, h, el("p", {}, "There is nothing at this address."), el("p", {}, link("/", "Back to the reel")));
  return { heading: h, body };
}

// src/shared/copy.ts
var PRIVATE_COPY = {
  en: {
    reviewHeading: "Review of <title>",
    stepsGroup: "Steps",
    stepFrames: "Frames",
    stepNotes: "Notes",
    stepSend: "Send",
    next: "Next",
    back: "Back",
    openSheet: "Open notes",
    close: "Close",
    filmStrip: "Film strip",
    clip: "Frame <number>",
    earlier: "Earlier",
    later: "Later",
    play: "Play",
    pause: "Pause",
    placePin: "Place a pin",
    noteField: "Your note",
    lengthField: "Suggested length in seconds",
    lengthInFrames: "<count> frames",
    attachment: "Attach a drawing",
    addNote: "Add note",
    nameField: "Your full name",
    sendNotes: "Send notes",
    notesSent: "Your notes were sent.",
    draftRefused: "This draft is not kept on this device.",
    numberCopy: "Type a length such as 1.5.",
    emptyNote: "Type your note.",
    emptyName: "Type your full name.",
    badAttachment: "This file is not a PNG or JPEG.",
    bigAttachment: "This file is over 5,000,000 bytes.",
    problems: "Problems",
    working: "Working\u2026",
    refreshLine: "Couldn't refresh. Trying again.",
    ended: "This page has ended.",
    askLink: "Ask for a new link",
    mailField: "Mail address",
    linkAnswer: "If that address belongs to this page, a new link is on its way.",
    linkLimit: "Too many requests for now. Try again later.",
    signOffHeading: "Sign-off for <title>",
    signOffButton: "Sign off",
    signed: "Signed off at <when>.",
    alreadySigned: "Already signed off at <when>.",
    newerCut: "A newer cut was made at <when>. Read it first.",
    wrongName: "That name doesn't match. Type your full name as it was given.",
    mailReviewSubject: "Your review page for <title>",
    mailReminderSubject: "Reminder: your review page for <title>",
    mailNewLinkSubject: "Your new link",
    mailDueLine: "Due <date>",
    mailCallSubject: "Call on <date>",
    mailCancelledCallSubject: "Call cancelled: <date>"
  },
  nl: {
    reviewHeading: "Beoordeling van <title>",
    stepsGroup: "Stappen",
    stepFrames: "Beelden",
    stepNotes: "Notities",
    stepSend: "Versturen",
    next: "Volgende",
    back: "Terug",
    openSheet: "Notities openen",
    close: "Sluiten",
    filmStrip: "Filmstrook",
    clip: "Beeld <number>",
    earlier: "Eerder",
    later: "Later",
    play: "Afspelen",
    pause: "Pauzeren",
    placePin: "Speld plaatsen",
    noteField: "Je notitie",
    lengthField: "Voorgestelde lengte in seconden",
    lengthInFrames: "<count> beelden",
    attachment: "Tekening toevoegen",
    addNote: "Notitie toevoegen",
    nameField: "Je volledige naam",
    sendNotes: "Notities versturen",
    notesSent: "Je notities zijn verstuurd.",
    draftRefused: "Dit concept wordt niet op dit apparaat bewaard.",
    numberCopy: "Typ een lengte zoals 1,5.",
    emptyNote: "Typ je notitie.",
    emptyName: "Typ je volledige naam.",
    badAttachment: "Dit bestand is geen PNG of JPEG.",
    bigAttachment: "Dit bestand is groter dan 5.000.000 bytes.",
    problems: "Problemen",
    working: "Bezig\u2026",
    refreshLine: "Vernieuwen is niet gelukt. We proberen het opnieuw.",
    ended: "Deze pagina is verlopen.",
    askLink: "Vraag een nieuwe link aan",
    mailField: "E-mailadres",
    linkAnswer: "Als dit adres bij deze pagina hoort, is er een nieuwe link onderweg.",
    linkLimit: "Te veel verzoeken. Probeer het later opnieuw.",
    signOffHeading: "Akkoord voor <title>",
    signOffButton: "Akkoord geven",
    signed: "Akkoord gegeven om <when>.",
    alreadySigned: "Al akkoord gegeven om <when>.",
    newerCut: "Er is om <when> een nieuwere versie gemaakt. Lees die eerst.",
    wrongName: "Die naam komt niet overeen. Typ je volledige naam zoals die is doorgegeven.",
    mailReviewSubject: "Je beoordelingspagina voor <title>",
    mailReminderSubject: "Herinnering: je beoordelingspagina voor <title>",
    mailNewLinkSubject: "Je nieuwe link",
    mailDueLine: "Uiterlijk <date>",
    mailCallSubject: "Gesprek op <date>",
    mailCancelledCallSubject: "Gesprek geannuleerd: <date>"
  },
  fr: {
    reviewHeading: "Relecture de <title>",
    stepsGroup: "\xC9tapes",
    stepFrames: "Images",
    stepNotes: "Notes",
    stepSend: "Envoyer",
    next: "Volgende",
    back: "Retour",
    openSheet: "Ouvrir les notes",
    close: "Fermer",
    filmStrip: "Bande de film",
    clip: "Image <number>",
    earlier: "Plus t\xF4t",
    later: "Plus tard",
    play: "Lire",
    pause: "Pause",
    placePin: "Placer une \xE9pingle",
    noteField: "Votre note",
    lengthField: "Dur\xE9e sugg\xE9r\xE9e en secondes",
    lengthInFrames: "<count> images",
    attachment: "Joindre un dessin",
    addNote: "Ajouter la note",
    nameField: "Votre nom complet",
    sendNotes: "Envoyer les notes",
    notesSent: "Vos notes ont \xE9t\xE9 envoy\xE9es.",
    draftRefused: "Ce brouillon n'est pas conserv\xE9 sur cet appareil.",
    numberCopy: "Saisissez une dur\xE9e comme 1,5.",
    emptyNote: "Saisissez votre note.",
    emptyName: "Saisissez votre nom complet.",
    badAttachment: "Ce fichier n'est ni un PNG ni un JPEG.",
    bigAttachment: "Ce fichier d\xE9passe 5 000 000 octets.",
    problems: "Probl\xE8mes",
    working: "En cours\u2026",
    refreshLine: "Actualisation impossible. Nouvel essai en cours.",
    ended: "Cette page est termin\xE9e.",
    askLink: "Demander un nouveau lien",
    mailField: "Adresse e-mail",
    linkAnswer: "Si cette adresse correspond \xE0 cette page, un nouveau lien est en route.",
    linkLimit: "Trop de demandes pour le moment. R\xE9essayez plus tard.",
    signOffHeading: "Validation de <title>",
    signOffButton: "Valider",
    signed: "Valid\xE9 \xE0 <when>.",
    alreadySigned: "D\xE9j\xE0 valid\xE9 \xE0 <when>.",
    newerCut: "Une version plus r\xE9cente a \xE9t\xE9 faite \xE0 <when>. Lisez-la d'abord.",
    wrongName: "Ce nom ne correspond pas. Saisissez votre nom complet tel qu'il a \xE9t\xE9 donn\xE9.",
    mailReviewSubject: "Votre page de relecture pour <title>",
    mailReminderSubject: "Rappel : votre page de relecture pour <title>",
    mailNewLinkSubject: "Votre nouveau lien",
    mailDueLine: "\xC0 rendre le <date>",
    mailCallSubject: "Appel le <date>",
    mailCancelledCallSubject: "Appel annul\xE9 : <date>"
  },
  ar: {
    reviewHeading: "\u0645\u0631\u0627\u062C\u0639\u0629 <title>",
    stepsGroup: "\u0627\u0644\u062E\u0637\u0648\u0627\u062A",
    stepFrames: "\u0627\u0644\u0625\u0637\u0627\u0631\u0627\u062A",
    stepNotes: "\u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A",
    stepSend: "\u0625\u0631\u0633\u0627\u0644",
    next: "\u0627\u0644\u062A\u0627\u0644\u064A",
    back: "\u0627\u0644\u0633\u0627\u0628\u0642",
    openSheet: "\u0641\u062A\u062D \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A",
    close: "\u0625\u063A\u0644\u0627\u0642",
    filmStrip: "\u0634\u0631\u064A\u0637 \u0627\u0644\u0641\u064A\u0644\u0645",
    clip: "\u0627\u0644\u0625\u0637\u0627\u0631 <number>",
    earlier: "\u0623\u0628\u0643\u0631",
    later: "\u0644\u0627\u062D\u0642\u064B\u0627",
    play: "\u062A\u0634\u063A\u064A\u0644",
    pause: "\u0625\u064A\u0642\u0627\u0641 \u0645\u0624\u0642\u062A",
    placePin: "\u0648\u0636\u0639 \u062F\u0628\u0648\u0633",
    noteField: "\u0645\u0644\u0627\u062D\u0638\u062A\u0643",
    lengthField: "\u0627\u0644\u0645\u062F\u0629 \u0627\u0644\u0645\u0642\u062A\u0631\u062D\u0629 \u0628\u0627\u0644\u062B\u0648\u0627\u0646\u064A",
    lengthInFrames: "<count> \u0625\u0637\u0627\u0631\u064B\u0627",
    attachment: "\u0625\u0631\u0641\u0627\u0642 \u0631\u0633\u0645",
    addNote: "\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0629",
    nameField: "\u0627\u0633\u0645\u0643 \u0627\u0644\u0643\u0627\u0645\u0644",
    sendNotes: "\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A",
    notesSent: "\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0645\u0644\u0627\u062D\u0638\u0627\u062A\u0643.",
    draftRefused: "\u0644\u0627 \u064A\u062A\u0645 \u062D\u0641\u0638 \u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0648\u062F\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632.",
    numberCopy: "\u0627\u0643\u062A\u0628 \u0645\u062F\u0629 \u0645\u062B\u0644 \u0661\u066B\u0665.",
    emptyNote: "\u0627\u0643\u062A\u0628 \u0645\u0644\u0627\u062D\u0638\u062A\u0643.",
    emptyName: "\u0627\u0643\u062A\u0628 \u0627\u0633\u0645\u0643 \u0627\u0644\u0643\u0627\u0645\u0644.",
    badAttachment: "\u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u0644\u064A\u0633 PNG \u0623\u0648 JPEG.",
    bigAttachment: "\u062D\u062C\u0645 \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u064A\u062A\u062C\u0627\u0648\u0632 5,000,000 \u0628\u0627\u064A\u062A.",
    problems: "\u0627\u0644\u0645\u0634\u0643\u0644\u0627\u062A",
    working: "\u062C\u0627\u0631\u064D \u0627\u0644\u0639\u0645\u0644\u2026",
    refreshLine: "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u062F\u064A\u062B. \u062C\u0627\u0631\u064D \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.",
    ended: "\u0627\u0646\u062A\u0647\u062A \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629.",
    askLink: "\u0637\u0644\u0628 \u0631\u0627\u0628\u0637 \u062C\u062F\u064A\u062F",
    mailField: "\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A",
    linkAnswer: "\u0625\u0630\u0627 \u0643\u0627\u0646 \u0647\u0630\u0627 \u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0645\u0631\u062A\u0628\u0637\u064B\u0627 \u0628\u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629\u060C \u0641\u0633\u064A\u0635\u0644\u0643 \u0631\u0627\u0628\u0637 \u062C\u062F\u064A\u062F \u0642\u0631\u064A\u0628\u064B\u0627.",
    linkLimit: "\u0637\u0644\u0628\u0627\u062A \u0643\u062B\u064A\u0631\u0629 \u062C\u062F\u064B\u0627 \u0627\u0644\u0622\u0646. \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0644\u0627\u062D\u0642\u064B\u0627.",
    signOffHeading: "\u0627\u0639\u062A\u0645\u0627\u062F <title>",
    signOffButton: "\u0627\u0639\u062A\u0645\u0627\u062F",
    signed: "\u062A\u0645 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F \u0641\u064A <when>.",
    alreadySigned: "\u062A\u0645 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064A <when>.",
    newerCut: "\u062A\u0645 \u0625\u0639\u062F\u0627\u062F \u0646\u0633\u062E\u0629 \u0623\u062D\u062F\u062B \u0641\u064A <when>. \u0627\u0642\u0631\u0623\u0647\u0627 \u0623\u0648\u0644\u0627\u064B.",
    wrongName: "\u0647\u0630\u0627 \u0627\u0644\u0627\u0633\u0645 \u063A\u064A\u0631 \u0645\u0637\u0627\u0628\u0642. \u0627\u0643\u062A\u0628 \u0627\u0633\u0645\u0643 \u0627\u0644\u0643\u0627\u0645\u0644 \u0643\u0645\u0627 \u0647\u0648 \u0645\u0633\u062C\u0644.",
    mailReviewSubject: "\u0635\u0641\u062D\u0629 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u062E\u0627\u0635\u0629 \u0628\u0643 \u0644\u0640 <title>",
    mailReminderSubject: "\u062A\u0630\u0643\u064A\u0631: \u0635\u0641\u062D\u0629 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u062E\u0627\u0635\u0629 \u0628\u0643 \u0644\u0640 <title>",
    mailNewLinkSubject: "\u0631\u0627\u0628\u0637\u0643 \u0627\u0644\u062C\u062F\u064A\u062F",
    mailDueLine: "\u0627\u0644\u0645\u0648\u0639\u062F \u0627\u0644\u0646\u0647\u0627\u0626\u064A <date>",
    mailCallSubject: "\u0645\u0643\u0627\u0644\u0645\u0629 \u0641\u064A <date>",
    mailCancelledCallSubject: "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0645\u0643\u0627\u0644\u0645\u0629: <date>"
  }
};
var FEE_COPY = {
  heading: (title) => `Fee letter for ${title}`,
  acceptLetter: "Accept letter",
  openTheLetter: "Open the letter",
  yourFullName: "Your full name",
  acceptedLine: "Letter accepted.",
  mailSubject: (title) => `Your fee letter for ${title}`
};

// src/client/screens/review.ts
async function buildReview(_ctx, token) {
  let page = {};
  let language = "en";
  let title = "Review";
  const h = el("h1", {});
  const steps = el("div", { role: "group", class: "steps" });
  const strip = el("div", { class: "film-strip", "aria-label": "Film strip" });
  const frameView = el("div", { "data-part": "frame-view", class: "frame-view" });
  const notesSheet = el("div", { class: "notes-sheet" });
  let step = 0;
  async function load() {
    try {
      page = await api.get(`/api/r/${token}`);
    } catch {
      h.textContent = "This page has ended.";
      return;
    }
    language = String(page.language);
    const copy = PRIVATE_COPY[language];
    title = copy.reviewHeading.replace("<title>", String(page.jobTitle));
    h.textContent = title;
    steps.replaceChildren();
    const labels = ["stepFrames", "stepNotes", "stepSend"];
    labels.forEach((key, index) => {
      const name = copy[key];
      const stepButton = el("button", { type: "button", class: "step" }, name);
      if (index === step) stepButton.setAttribute("aria-current", "step");
      stepButton.addEventListener("click", () => {
        step = index;
        void load();
      });
      steps.append(stepButton);
    });
    strip.replaceChildren();
    for (const frame of page.frames ?? []) {
      const clip = el("button", {
        type: "button",
        "data-part": "clip",
        "data-frame": String(frame.number),
        "data-duration": String(frame.durationFrames),
        class: "clip"
      }, copy.clip.replace("<number>", String(frame.number)));
      clip.style.width = `${Number(frame.durationFrames) * 2}px`;
      strip.append(clip);
    }
  }
  await load();
  const body = el("main", { class: "review", lang: language, dir: language === "ar" ? "rtl" : "ltr" }, h, steps, strip, frameView);
  return { heading: h, body, refresh: load };
}

// src/client/screens/signoff.ts
async function buildSignOff(ctx2, token) {
  const h = el("h1", {});
  const list = el("ul", { class: "frames-list" });
  const name = field("input", { type: "text", autocomplete: "name" });
  const result = el("p", { class: "signed-text" });
  let language = "en";
  async function load() {
    let page;
    try {
      page = await api.get(`/api/s/${token}`);
    } catch {
      h.textContent = "This page has ended.";
      return;
    }
    language = String(page.language);
    const copy = PRIVATE_COPY[language];
    h.textContent = copy.signOffHeading.replace("<title>", String(page.jobTitle));
    list.replaceChildren();
    for (const frame of page.frames ?? []) {
      list.append(el("li", {}, `Frame ${String(frame.number)} \xB7 ${String(frame.timecodeIn)} \xB7 ${String(frame.actionNote)}`));
    }
    if (page.signedOffText !== null && page.signedOffText !== void 0) {
      result.textContent = String(page.signedOffText);
    }
  }
  await load();
  const sign = el("button", { type: "button", class: "primary" }, PRIVATE_COPY[language].signOffButton);
  sign.style.minHeight = "44px";
  sign.addEventListener("click", async () => {
    try {
      const answer = await api.post(`/api/s/${token}/sign`, { name: name.value });
      ctx2.announcer.announce(String(answer.signedOffText ?? ""));
      await load();
    } catch (e) {
      if (e instanceof ApiError) {
        ctx2.announcer.announce(e.message);
        result.textContent = e.message;
      }
    }
  });
  const body = el("main", { class: "signoff", lang: language, dir: language === "ar" ? "rtl" : "ltr" }, h, list, el("label", {}, PRIVATE_COPY[language].nameField), name, sign, result);
  return { heading: h, body, refresh: load };
}

// src/client/screens/fee.ts
async function buildFee(ctx2, token) {
  const h = el("h1", {});
  const amounts = el("dl", { class: "amounts" });
  const name = field("input", { type: "text", autocomplete: "name" });
  const pdf = el("a", { href: `/api/f/${token}/pdf` }, FEE_COPY.openTheLetter);
  let jobTitle = "";
  async function load() {
    let page;
    try {
      page = await api.get(`/api/f/${token}`);
    } catch {
      h.textContent = "This page has ended.";
      return;
    }
    jobTitle = String(page.jobTitle);
    h.textContent = FEE_COPY.heading(jobTitle);
    amounts.replaceChildren(
      el("div", {}, el("dt", {}, "Fee"), el("dd", {}, String(page.feeText))),
      el("div", {}, el("dt", {}, "Tax"), el("dd", {}, String(page.taxText))),
      el("div", {}, el("dt", {}, "Total"), el("dd", {}, String(page.totalText)))
    );
    for (const milestone of page.milestones ?? []) {
      amounts.append(el("div", {}, el("dt", {}, `Milestone ${String(milestone.number)}`), el("dd", {}, String(milestone.amountText))));
    }
  }
  await load();
  const accept = el("button", { type: "button", class: "primary" }, FEE_COPY.acceptLetter);
  accept.style.minHeight = "44px";
  accept.addEventListener("click", async () => {
    try {
      await api.post(`/api/f/${token}/accept`, { name: name.value, stamp: "stamp" });
      ctx2.announcer.announce(FEE_COPY.acceptedLine);
    } catch (e) {
      if (e instanceof ApiError) ctx2.announcer.announce(e.message);
    }
  });
  const body = el("main", { class: "fee" }, h, amounts, pdf, el("label", {}, FEE_COPY.yourFullName), name, accept);
  return { heading: h, body, refresh: load };
}

// src/client/screens/index.ts
async function renderScreen(ctx2, path) {
  const url = new URL(path, location.origin);
  const query = url.searchParams;
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  let build;
  if (segments.length === 0) {
    build = await wrap(ctx2, "Boards drawn to the frame", await buildHome(ctx2));
  } else if (segments[0] === "reel" && segments.length === 1) {
    build = await wrap(ctx2, "Work on the reel", await buildReel(ctx2, query));
  } else if (segments[0] === "how-it-works" && segments.length === 1) {
    build = await wrap(ctx2, "How the work runs", await buildHowItWorks(ctx2, query));
  } else if (segments[0] === "sign-in" && segments.length === 1) {
    build = await wrap(ctx2, "Sign in", await buildSignIn(ctx2, query));
  } else if (segments[0] === "sign-up" && segments.length === 1) {
    build = await wrap(ctx2, "Start a desk", await buildSignUp(ctx2));
  } else if (segments[0] === "desk") {
    build = await deskRoute(ctx2, segments, query);
  } else if (segments[0] === "r" && segments.length === 2) {
    build = await wrap(ctx2, "Review", await buildReview(ctx2, segments[1]));
  } else if (segments[0] === "s" && segments.length === 2) {
    build = await wrap(ctx2, "Sign-off", await buildSignOff(ctx2, segments[1]));
  } else if (segments[0] === "f" && segments.length === 2) {
    build = await wrap(ctx2, "Fee letter", await buildFee(ctx2, segments[1]));
  } else {
    build = await wrap(ctx2, "Page not found", await buildNotFound(ctx2));
  }
  return {
    title: build.title,
    heading: build.heading,
    doc: build.doc,
    refresh: build.refresh
  };
}
async function deskRoute(ctx2, segments, query) {
  if (segments.length === 1 && segments[0] === "jobs") {
    return await wrap(ctx2, "Jobs", await buildJobs(ctx2, query));
  }
  if (segments.length === 1 && segments[0] === "clients") {
    return await wrap(ctx2, "Clients", await buildClients(ctx2));
  }
  if (segments[0] === "clients" && segments.length === 2) {
    return await wrap(ctx2, "Client", await buildClient(ctx2, segments[1]));
  }
  if (segments.length === 1 && segments[0] === "calls") {
    return await wrap(ctx2, "Calls", await buildCalls(ctx2, query));
  }
  if (segments[0] === "jobs" && segments.length === 2) {
    return await wrap(ctx2, "Job", await buildBoard(ctx2, segments[1]));
  }
  if (segments[0] === "jobs" && segments.length === 3) {
    const jobId = segments[1];
    if (segments[2] === "script") return await wrap(ctx2, "Script", await buildScript(ctx2, jobId));
    if (segments[2] === "reel") return await wrap(ctx2, "Reel", await buildReelScreen(ctx2, jobId));
    if (segments[2] === "lines") return await wrap(ctx2, "Lines", await buildLines(ctx2, jobId, query));
    if (segments[2] === "cues") return await wrap(ctx2, "Cues", await buildCues(ctx2, jobId));
    if (segments[2] === "cuts") return await wrap(ctx2, "Cuts", await buildCuts(ctx2, jobId));
    if (segments[2] === "notes") return await wrap(ctx2, "Notes", await buildNotes(ctx2, jobId, query));
    if (segments[2] === "delivery") return await wrap(ctx2, "Delivery", await buildDelivery(ctx2, jobId));
    if (segments[2] === "letter") return await wrap(ctx2, "Fee letter", await buildLetter(ctx2, jobId));
  }
  if (segments[0] === "jobs" && segments.length === 4 && segments[2] === "compare") {
    return await wrap(ctx2, "Compare cuts", await buildCompare(ctx2, segments[1], query));
  }
  return await wrap(ctx2, "Page not found", await buildNotFound(ctx2));
}
async function wrap(_ctx, fallbackTitle, build) {
  const doc = el("div", {});
  const headingText = build.heading.textContent ?? fallbackTitle;
  const page = el("div", { class: "page" });
  page.append(build.heading, build.body);
  doc.append(page);
  return {
    title: `${headingText} \u2014 Clapstick`,
    heading: build.heading,
    doc,
    refresh: build.refresh ?? null
  };
}

// src/client/lib/router.ts
var Router = class {
  onChangeHandler = null;
  onPublicChangeHandler = null;
  onChange(handler) {
    this.onChangeHandler = handler;
  }
  onPublicChange(handler) {
    this.onPublicChangeHandler = handler;
  }
  // A committed navigation: pushes one history entry and renders.
  async go(path) {
    const isPublic = isPublicPath(path);
    history.pushState({}, "", path);
    await this.render(path, isPublic);
  }
  // A committed change that replaces the current entry (a wipe's inner step).
  async replace(path) {
    history.replaceState({}, "", path);
    await this.render(path, isPublicPath(path));
  }
  async start() {
    await this.render(location.pathname + location.search, isPublicPath(location.pathname));
    window.addEventListener("popstate", () => {
      const path = location.pathname + location.search;
      const scroll = history.state?.scroll;
      void this.render(path, isPublicPath(path)).then(() => {
        if (scroll !== void 0) window.scrollTo(0, scroll);
      });
    });
    document.addEventListener("click", (event) => {
      const target = event.target;
      const link2 = target?.closest("a");
      if (link2 === null || link2 === void 0) return;
      const href = link2.getAttribute("href");
      if (href === null || href.startsWith("http") || href.startsWith("#")) return;
      event.preventDefault();
      const scroll = history.state;
      history.replaceState({ ...scroll ?? {}, scroll: window.scrollY }, "", location.href);
      void this.go(href);
    });
  }
  async render(path, isPublic) {
    const handler = isPublic ? this.onPublicChangeHandler : this.onChangeHandler;
    await handler?.(path);
  }
};
function isPublicPath(path) {
  if (path.startsWith("/desk") || path.startsWith("/r/") || path.startsWith("/s/") || path.startsWith("/f/")) {
    return false;
  }
  return true;
}

// src/client/lib/announce.ts
var Announcer = class {
  region;
  last = "";
  constructor() {
    this.region = document.createElement("div");
    this.region.setAttribute("role", "status");
    this.region.setAttribute("aria-live", "polite");
    this.region.id = "announcements";
    this.region.style.position = "absolute";
    this.region.style.width = "1px";
    this.region.style.height = "1px";
    this.region.style.overflow = "hidden";
    this.region.style.clip = "rect(0 0 0 0)";
    document.body.appendChild(this.region);
  }
  element() {
    return this.region;
  }
  announce(text) {
    const marker = this.last === text ? `\u200B${text}` : text;
    this.last = text;
    this.region.textContent = marker;
  }
};

// src/client/lib/session.ts
var Session = class {
  api = new Api();
  signedIn = false;
  endedHandler = null;
  async load() {
    try {
      await this.api.get("/api/session");
      this.signedIn = true;
    } catch (e) {
      this.signedIn = false;
      if (e instanceof ApiError && e.code === "session_ended") {
        this.endedHandler?.(true);
      }
    }
  }
  async signOut() {
    await this.api.post("/api/sign-out", {});
    this.signedIn = false;
  }
};

// src/client/lib/motion.ts
function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// src/client/main.ts
var root = document.getElementById("root");
var announcer = new Announcer();
var router = new Router();
var store = new ClientStore();
var session = new Session();
var ctx = {
  router,
  announcer,
  store,
  session,
  reload
};
var refreshTimer = null;
async function reload() {
  const path = location.pathname + location.search;
  const { title, heading: heading2, doc, refresh } = await renderScreen(ctx, path);
  document.title = title;
  root.replaceChildren(doc);
  heading2.setAttribute("tabindex", "-1");
  if (prefersReducedMotion()) {
    heading2.focus();
  } else {
    heading2.focus();
  }
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = null;
  if (refresh !== null) {
    refreshTimer = window.setInterval(() => {
      void refresh();
    }, 5e3);
  }
}
router.onChange(async () => {
  await reload();
});
router.onPublicChange(async () => {
  await reload();
});
router.start();
