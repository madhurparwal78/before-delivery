"use strict";
(() => {
  // src/client/formatting.ts
  function allowedHref(target) {
    const trimmed = target.replace(/^[\s\u0000-\u001F]+/, "");
    const lowered = trimmed.toLowerCase();
    if (lowered.startsWith("http:") || lowered.startsWith("https:") || lowered.startsWith("mailto:")) return trimmed;
    return null;
  }
  function bareAddressEnd(text, start2) {
    let end = start2;
    while (end < text.length) {
      const code = text.charCodeAt(end);
      if (code === 32 || code === 9 || code === 10 || code === 13 || code === 60 || code === 62 || code === 34 || code === 39 || code === 41 || code === 93) break;
      end += 1;
    }
    while (end > start2) {
      const tail = text[end - 1];
      if (tail === "." || tail === "," || tail === ";" || tail === ":" || tail === "!" || tail === "?") end -= 1;
      else break;
    }
    return end;
  }
  function parseDisplay(text) {
    const segments = [];
    let buffer = "";
    const flush = () => {
      if (buffer !== "") {
        segments.push({ kind: "text", text: buffer });
        buffer = "";
      }
    };
    let i = 0;
    while (i < text.length) {
      const character = text[i];
      if ((character === "*" || character === "_") && (text[i + 1] ?? "") !== character) {
        const closing = text.indexOf(character, i + 1);
        if (closing !== -1 && closing > i + 1) {
          flush();
          segments.push({ kind: "emphasis", text: text.slice(i + 1, closing) });
          i = closing + 1;
          continue;
        }
      }
      if (character === "`") {
        const closing = text.indexOf("`", i + 1);
        if (closing !== -1) {
          flush();
          segments.push({ kind: "code", text: text.slice(i + 1, closing) });
          i = closing + 1;
          continue;
        }
      }
      if (character === "[") {
        const close = text.indexOf("]", i + 1);
        if (close !== -1 && text[close + 1] === "(") {
          let depth = 0;
          let end = close + 1;
          for (let j = close + 1; j < text.length; j += 1) {
            if (text[j] === "(") depth += 1;
            else if (text[j] === ")") {
              depth -= 1;
              if (depth === 0) {
                end = j;
                break;
              }
            }
          }
          if (end > close + 1) {
            const target = text.slice(close + 2, end);
            const href = allowedHref(target);
            flush();
            if (href) {
              segments.push({ kind: "link", text: text.slice(i + 1, close), href });
            } else {
              segments.push({ kind: "text", text: text.slice(i + 1, close) });
            }
            i = end + 1;
            continue;
          }
        }
      }
      const lowered = text.slice(i).toLowerCase();
      if (lowered.startsWith("http://") || lowered.startsWith("https://")) {
        const end = bareAddressEnd(text, i);
        if (end > i) {
          flush();
          segments.push({ kind: "link", text: text.slice(i, end), href: text.slice(i, end) });
          i = end;
          continue;
        }
      }
      buffer += character;
      i += 1;
    }
    flush();
    return segments;
  }
  function renderFormatted(text) {
    const container = document.createElement("span");
    for (const segment of parseDisplay(text)) {
      if (segment.kind === "text") container.append(document.createTextNode(segment.text));
      else if (segment.kind === "emphasis") {
        const element = document.createElement("em");
        element.textContent = segment.text;
        container.append(element);
      } else if (segment.kind === "code") {
        const element = document.createElement("code");
        element.textContent = segment.text;
        container.append(element);
      } else {
        const element = document.createElement("a");
        element.href = segment.href;
        element.textContent = segment.text;
        element.target = "_blank";
        element.rel = "noreferrer noopener";
        container.append(element);
      }
    }
    return container;
  }

  // src/client/publicPage.ts
  function el(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === null || value === void 0) continue;
      element.setAttribute(name, String(value));
    }
    for (const child of children) {
      if (child === null || child === void 0) continue;
      element.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return element;
  }
  function wordmarkLink() {
    const link = el("a", { href: "/" }, "Hushline");
    return link;
  }
  function glassSlab() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "hero-slab");
    svg.setAttribute("viewBox", "0 0 400 200");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "20");
    rect.setAttribute("y", "20");
    rect.setAttribute("width", "380");
    rect.setAttribute("height", "160");
    rect.setAttribute("fill", "var(--accent)");
    rect.setAttribute("opacity", "0.28");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", "48");
    text.setAttribute("y", "78");
    text.setAttribute("fill", "var(--ink)");
    text.setAttribute("font-size", "24");
    text.setAttribute("font-style", "italic");
    text.textContent = "i never got the lantern pack";
    const lines = [
      ["signature valid", 112],
      ["7 of 8", 136],
      ["nothing removed", 160],
      ["no link", 184]
    ];
    for (const [line, y] of lines) {
      const element = document.createElementNS("http://www.w3.org/2000/svg", "text");
      element.setAttribute("x", "48");
      element.setAttribute("y", String(y));
      element.setAttribute("fill", "var(--ink)");
      element.setAttribute("font-size", "17");
      element.textContent = line;
      svg.append(element);
    }
    svg.append(rect, text);
    return svg;
  }
  function publicPage(root) {
    document.title = "Hushline";
    const panel = el("div", { class: "hero-panel" });
    const top = el("div", { class: "hero-top" });
    top.append(
      wordmarkLink(),
      el(
        "nav",
        {},
        el("a", { href: "#how-it-checks" }, "How it checks"),
        el("a", { href: "#the-widget" }, "The widget"),
        el("a", { href: "#security" }, "Security")
      ),
      el("a", { href: "/signin" }, "Sign in")
    );
    panel.append(top, glassSlab());
    const headline = el(
      "h1",
      { class: "hero-headline" },
      el("span", {}, "Every message,"),
      el("span", { class: "second" }, "already checked.")
    );
    panel.append(headline);
    panel.append(el("img", { class: "visually-hidden", alt: "A player message seen through Tamperglass", src: "/assets/slab.svg" }));
    const hero = el("div", { class: "hero-sub" });
    const container = el("div", { class: "column" });
    container.append(panel);
    hero.append(el("p", { class: "hero-sentence" }, "Answer your players from inside the game, with every purchase, match and pasted link checked before you read it."));
    hero.append(el("a", { href: "/inbox" }, "Open the inbox"));
    hero.append(
      el(
        "section",
        { id: "how-it-checks" },
        el("h2", {}, "How it checks"),
        el("p", {}, "Every message a player sends is checked before it reaches you. The signature, the send rate, the text and any link each get a verdict."),
        el("p", {}, "Verdicts are computed once, stored, and shown beside the thread in Tamperglass.")
      ),
      el(
        "section",
        { id: "the-widget" },
        el("h2", {}, "The widget"),
        el("p", {}, "Players write from inside the game launcher. A player sees only their own thread, with their own receipts and replies."),
        el("p", {}, "A retried send arrives once, and a slow connection changes nothing.")
      ),
      el(
        "section",
        { id: "security" },
        el("h2", {}, "Security"),
        el("p", {}, "Script tags, hostile links and forged receipts are shown as harmless words. The server keeps every record, and refuses anything that does not verify."),
        el("p", {}, "A player who guesses a thread id reads nothing.")
      )
    );
    container.append(hero);
    container.append(el("footer", { class: "contentinfo", role: "contentinfo" }, "Fernwick Software. Hushline answers players from inside the game."));
    root.append(container);
    void renderFormatted;
  }

  // src/client/api.ts
  var changeToken = "";
  var session = null;
  var refreshInFlight = null;
  var sessionEnded = /* @__PURE__ */ new Set();
  function setChangeToken(token) {
    changeToken = token;
  }
  function onChangeSession(listener) {
    sessionEnded.add(listener);
  }
  function failureFrom(response, body) {
    const parsed = body;
    return {
      status: response.status,
      code: parsed?.error?.code ?? "unknown",
      message: parsed?.error?.message ?? "",
      fields: parsed?.error?.fields,
      retryAfter: response.headers.get("retry-after") ? Number(response.headers.get("retry-after")) : null,
      replay: response.headers.get("idempotent-replay") === "true"
    };
  }
  async function rawRequest(method, path, body, headers = {}) {
    const init = { method, headers: { ...headers }, credentials: "same-origin" };
    if (body !== null) {
      init.body = JSON.stringify(body);
      init.headers["content-type"] = "application/json";
    }
    if (changeToken !== "") {
      init.headers["x-change-token"] = changeToken;
    }
    const response = await fetch(path, init);
    const text = await response.text();
    let json = null;
    if (text !== "") {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { response, json };
  }
  async function refreshSession() {
    const response = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin", body: "" });
    if (!response.ok) return false;
    const body = await response.json();
    changeToken = body.change_token;
    session = body;
    return true;
  }
  async function api(method, path, body, headers) {
    const attempt = await rawRequest(method, path, body ?? null, headers ?? {});
    if (attempt.response.status !== 401 || path === "/api/auth/refresh") {
      if (attempt.response.ok) {
        return { ok: true, body: attempt.json };
      }
      return { ok: false, failure: failureFrom(attempt.response, attempt.json) };
    }
    if (!refreshInFlight) {
      refreshInFlight = refreshSession().then((renewed2) => {
        refreshInFlight = null;
        return renewed2;
      });
    }
    const renewed = await refreshInFlight;
    if (!renewed) {
      for (const listener of sessionEnded) listener();
      return { ok: false, failure: failureFrom(attempt.response, attempt.json) };
    }
    const retry = await rawRequest(method, path, body ?? null, headers ?? {});
    if (retry.response.ok) return { ok: true, body: retry.json };
    return { ok: false, failure: failureFrom(retry.response, retry.json) };
  }
  async function apiStream(path, onEvent, onOpen, onClose) {
    const source = new EventSource(path);
    let renewing = false;
    source.onmessage = () => {
    };
    source.onerror = async () => {
      if (renewing) return;
      renewing = true;
      const response = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin", body: "" });
      if (!response.ok) {
        source.close();
        for (const listener of sessionEnded) listener();
        return;
      }
      const body = await response.json();
      changeToken = body.change_token;
      renewing = false;
    };
    const known = ["message", "thread_status", "attachment", "rules_changed"];
    for (const name of known) {
      source.addEventListener(name, (event) => {
        const data = event.data;
        onEvent(name, data ? JSON.parse(data) : {});
      });
    }
    return () => {
      source.close();
      if (onClose) onClose();
    };
  }

  // src/client/announce.ts
  var regions = /* @__PURE__ */ new Map();
  function registerLiveRegion(name, element, assertive = false) {
    regions.set(name, element);
    void assertive;
  }
  function announce(name, message) {
    const element = regions.get(name);
    if (!element) return;
    element.textContent = "";
    requestAnimationFrame(() => {
      element.textContent = message;
    });
  }

  // src/client/signIn.ts
  function signInPage(root, resume) {
    document.title = "Sign in to Hushline";
    const container = el("div", { class: "column" });
    const heading = el("h1", {}, "Sign in to Hushline");
    const liveRegion = el("div", { role: "status", "aria-live": "polite", class: "visually-hidden" });
    liveRegion.id = "sign-in-announcements";
    registerLiveRegion("sign-in", liveRegion);
    const form = el("form", { novalidate: "novalidate" });
    const summary = el("div", { class: "error" });
    const emailField = el(
      "div",
      {},
      el("label", { for: "email" }, "Email")
    );
    const emailInput = el("input", { id: "email", name: "email", type: "email", autocomplete: "username" });
    const emailError = el("span", { class: "field-error", role: "alert" });
    emailField.append(emailInput, emailError);
    const passwordField = el(
      "div",
      {},
      el("label", { for: "password" }, "Password")
    );
    const passwordInput = el("input", { id: "password", name: "password", type: "password", autocomplete: "current-password" });
    const passwordError = el("span", { class: "field-error", role: "alert" });
    passwordField.append(passwordInput, passwordError);
    const button = el("button", { type: "submit", class: "accent" }, "Sign in");
    form.append(summary, emailField, passwordField, button);
    container.append(heading, liveRegion, form);
    root.append(container);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      summary.textContent = "";
      emailError.textContent = "";
      passwordError.textContent = "";
      const email = emailInput.value;
      const password = passwordInput.value;
      const problems = [];
      if (email.trim() === "") problems.push({ field: "email", message: "Enter your email." });
      if (password === "") problems.push({ field: "password", message: "Enter your password." });
      if (problems.length > 0) {
        summary.textContent = "";
        const list = el("ul", { role: "alert" });
        for (const problem of problems) {
          const target = problem.field === "email" ? emailError : passwordError;
          target.textContent = problem.message;
          const link = el("a", { href: problem.field === "email" ? "#email" : "#password" }, problem.message);
          link.addEventListener("click", (clickEvent) => {
            clickEvent.preventDefault();
            (problem.field === "email" ? emailInput : passwordInput).focus();
          });
          list.append(el("li", {}, link));
        }
        summary.append(list);
        announce("sign-in", problems[0].message);
        return;
      }
      announce("sign-in", "Signing in...");
      const result = await api("POST", "/api/auth/login", { email, password });
      if (!result.ok) {
        announce("sign-in", "That email and password don't match.");
        summary.textContent = "That email and password don't match.";
        return;
      }
      const session2 = result.body;
      sessionStorage.setItem("hushline_change_token", session2.change_token);
      const stored = sessionStorage.getItem("hushline_return_thread");
      if (resume?.threadUrl || stored) {
        const target = resume?.threadUrl ?? stored ?? "/inbox";
        const query = new URLSearchParams(window.location.search);
        const notice = query.get("notice");
        sessionStorage.removeItem("hushline_return_thread");
        window.location.href = notice ? `${target}${target.includes("?") ? "&" : "?"}notice=${encodeURIComponent(notice)}` : target;
        return;
      }
      window.location.href = "/inbox";
    });
  }

  // src/client/format.ts
  var EXPONENTS = {
    JPY: 0,
    KRW: 0,
    CLP: 0,
    USD: 2,
    EUR: 2,
    GBP: 2,
    CAD: 2,
    AUD: 2,
    BRL: 2,
    KWD: 3,
    BHD: 3,
    JOD: 3
  };
  function formatAmount(minor, code) {
    const exponent = EXPONENTS[code] ?? 2;
    const absolute = Math.abs(minor);
    const whole = Math.floor(absolute / 10 ** exponent).toString();
    const text = exponent === 0 ? whole : `${whole}.${String(absolute % 10 ** exponent).padStart(exponent, "0")}`;
    return `${minor < 0 ? "-" : ""}${text} ${code}`;
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    const day = date.getDate();
    const month = MONTHS[date.getMonth()];
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day} ${month} ${hours}:${minutes}`;
  }
  function refundWords(purchase) {
    if (purchase.status === "paid") return "paid";
    if (purchase.status === "refunded") return "refunded";
    return `partly refunded: ${formatAmount(purchase.refunded_minor, purchase.currency)}`;
  }
  function receiptStatusWords(status) {
    if (status === "paid") return "paid";
    if (status === "refunded") return "refunded";
    return "partly refunded";
  }
  function comparisonWords(entry) {
    if (!entry || entry.on_game_server === null) return "";
    if (!entry.on_game_server) return "not on the game server";
    if (entry.differences.length === 0) return "on the game server";
    return `on the game server, differs: ${entry.differences.join(", ")}`;
  }

  // src/client/tamperglass.ts
  var STAGE_LABELS = {
    signature: "Signature",
    bucket: "Bucket",
    sanitiser: "Sanitiser",
    link: "Link"
  };
  function buildTamperglass(insideSheet) {
    const container = insideSheet ? el("div", { role: "dialog", "aria-modal": "true", "aria-label": "Tamperglass", class: "sheet", hidden: "hidden" }) : el("aside", { role: "complementary", "aria-label": "Tamperglass", class: "workspace-tamper" });
    const lines = {
      signature: el("li", { tabindex: "0" }),
      bucket: el("li", { tabindex: "0" }),
      sanitiser: el("li", { tabindex: "0" }),
      link: el("li", { tabindex: "0" })
    };
    for (const stage of ["signature", "bucket", "sanitiser", "link"]) {
      const line = lines[stage];
      line.append(el("span", { class: "stage" }, `${STAGE_LABELS[stage]}`), el("span", { class: "verdict" }, ""), el("span", { class: "before" }));
    }
    const list = el("ul", { class: "tamper-lines", "aria-label": "Checks" }, lines.signature, lines.bucket, lines.sanitiser, lines.link);
    const meter = el("meter", { min: "0", max: "8", value: "8", "aria-label": "Token bucket" });
    const verdicts = el("div", { role: "status", "aria-live": "polite", class: "visually-hidden", id: "verdicts-announcements" });
    const prompt = el("p", { class: "pane-prompt" }, "Select a message to see what was checked.");
    container.append(prompt, list, el("p", {}, meter), verdicts);
    return { pane: container, lines, meter, verdicts, container };
  }
  function showPrompt(pane, message) {
    const prompt = pane.container.querySelector(".pane-prompt");
    if (prompt) prompt.textContent = message;
    for (const stage of Object.keys(pane.lines)) {
      const verdict = pane.lines[stage].querySelector(".verdict");
      if (verdict) verdict.textContent = "";
      const before = pane.lines[stage].querySelector(".before");
      if (before) before.textContent = "";
    }
  }
  function setChecking(pane) {
    const prompt = pane.container.querySelector(".pane-prompt");
    if (prompt) prompt.textContent = "";
    for (const stage of Object.keys(pane.lines)) {
      const verdict = pane.lines[stage].querySelector(".verdict");
      if (verdict) {
        verdict.textContent = "checking";
        verdict.classList.remove("line-settle");
      }
      const before = pane.lines[stage].querySelector(".before");
      if (before) before.textContent = "";
    }
  }
  function verdictSentence(body) {
    const byStage = new Map(body.lines.map((line) => [line.stage, line.verdict]));
    return `Checked: ${byStage.get("signature")}; ${byStage.get("bucket")}; ${byStage.get("sanitiser")}; ${byStage.get("link")}.`;
  }

  // src/client/workspace.ts
  var state = {
    session: null,
    status: "waiting",
    query: "",
    rows: [],
    nextCursor: null,
    openThreadId: null,
    thread: null,
    selectedMessage: null,
    lookup: null,
    replyKey: null,
    replyPending: false,
    generation: 0,
    stream: null,
    overlayOpen: false
  };
  function inboxQueryParams() {
    const params = new URLSearchParams();
    if (state.status !== "waiting") params.set("status", state.status);
    if (state.query !== "") params.set("q", state.query);
    return params.toString();
  }
  function threadUrl(threadId) {
    const query = inboxQueryParams();
    const base = threadId === null ? "/inbox" : `/inbox/${threadId}`;
    return query === "" ? base : `${base}?${query}`;
  }
  function syncUrl(replace) {
    const url = threadUrl(state.openThreadId);
    if (replace) {
      window.history.replaceState({}, "", url);
    } else {
      window.history.pushState({}, "", url);
    }
  }
  var onThreadChosenFromList = () => {
  };
  async function workspacePage(root) {
    document.title = "Inbox \u2014 Hushline";
    const sessionResult = await api("GET", "/api/auth/session");
    if (!sessionResult.ok) {
      sessionStorage.setItem("hushline_return_thread", window.location.pathname + window.location.search);
      window.location.href = "/signin";
      return;
    }
    state.session = sessionResult.body;
    setChangeToken(state.session.change_token);
    const container = el("div", { class: "workspace-shell" });
    const wide = window.matchMedia("(min-width: 1100px)").matches;
    const mid = window.matchMedia("(min-width: 600px) and (max-width: 1099px)").matches;
    void wide;
    void mid;
    const banner = el("header", { role: "banner", class: "banner" });
    banner.append(el("a", { href: "/inbox" }, "Inbox"));
    if (state.session.user.role === "developer") {
      banner.append(el("a", { href: "/team" }, "Team"));
    }
    banner.append(el("span", { class: "spacer" }));
    const signOut = el("button", { type: "button" }, "Sign out");
    banner.append(signOut);
    const listPane = el("div", { class: "workspace-list" });
    const tabs = {
      waiting: el("button", { role: "tab", type: "button", class: "tab" }, "Waiting 0"),
      answered: el("button", { role: "tab", type: "button", class: "tab" }, "Answered 0"),
      closed: el("button", { role: "tab", type: "button", class: "tab" }, "Closed 0")
    };
    const tablist = el("div", { role: "tablist", "aria-label": "Thread status" }, tabs.waiting, tabs.answered, tabs.closed);
    const search = el("input", { type: "search", "aria-label": "Search threads", placeholder: "Search threads" });
    const rows = el("ul", { "aria-label": "Threads", class: "thread-rows" });
    const emptyLine = el("p", { class: "empty-copy" });
    listPane.append(tablist, search, rows, emptyLine);
    const threadPane = el("section", { class: "workspace-thread" });
    const announcements = el("div", { role: "status", "aria-live": "polite", class: "visually-hidden" });
    registerLiveRegion("inbox", announcements);
    const purchasesList = el("ul", { "aria-label": "Purchases", class: "purchases" });
    const recordList = el("div", { role: "region", "aria-label": "Game server record" });
    const gameServerStatus = el("div", { role: "status", "aria-live": "polite" });
    const messagesList = el("ul", { "aria-label": "Messages", class: "messages" });
    const reply = el("textarea", { "aria-label": "Reply", rows: "4", placeholder: "Reply" });
    const sendReply = el("button", { type: "button", class: "accent" }, "Send reply");
    const closeThread = el("button", { type: "button" }, "Close thread");
    const drawerButton = el("button", { type: "button", "aria-expanded": "false", "aria-haspopup": "dialog" }, "Threads");
    const sheetButton = el("button", { type: "button", "aria-expanded": "false", "aria-haspopup": "dialog" }, "Open Tamperglass");
    const tamper = buildTamperglass(false);
    registerLiveRegion("verdicts", tamper.verdicts);
    const sheetPane = el("div", { role: "dialog", "aria-modal": "true", "aria-label": "Tamperglass", class: "sheet", hidden: "hidden" });
    const sheet = { pane: sheetPane, lines: tamper.lines, meter: tamper.meter, verdicts: tamper.verdicts, container: sheetPane };
    const sheetBackdrop = el("div", { class: "sheet-backdrop", hidden: "hidden" });
    const drawerBackdrop = el("div", { class: "drawer-backdrop", hidden: "hidden" });
    const elements = {
      tabs,
      search,
      rows,
      moreButton: null,
      threadPane,
      tamper,
      reply,
      announcements,
      gameServerStatus,
      purchasesList,
      recordList,
      drawerButton,
      drawer: listPane,
      drawerBackdrop,
      sheetButton,
      sheetBackdrop,
      messagesList,
      closeThreadButton: closeThread,
      heading: null
    };
    const grid = el("div", { class: "workspace" });
    grid.append(listPane, threadPane, tamper.pane);
    container.append(banner, grid);
    root.textContent = "";
    root.append(container);
    root.append(announcements);
    root.classList.add("workspace-root");
    threadPane.append(drawerButton, sheetButton, purchasesList, recordList, gameServerStatus, messagesList, reply, sendReply, closeThread);
    document.body.append(sheetPane, sheetBackdrop, drawerBackdrop);
    parseCurrentUrl();
    await refreshInbox(elements, false);
    openThreadFromUrl(elements);
    wireEvents(elements, { sendReply, closeThread, signOut, drawerButton, sheetButton, sheet, sheetBackdrop });
    startStream(elements);
    window.addEventListener("popstate", () => {
      parseCurrentUrl();
      void refreshInbox(elements, true).then(() => openThreadFromUrl(elements));
    });
    onChangeSession(() => {
      const replyText = reply.value;
      sessionStorage.setItem("hushline_return_thread", window.location.pathname + window.location.search);
      sessionStorage.setItem("hushline_return_reply", replyText);
      window.location.href = "/signin?notice=session-ended";
    });
    const storedReply = sessionStorage.getItem("hushline_return_reply");
    if (storedReply !== null) {
      reply.value = storedReply;
      sessionStorage.removeItem("hushline_return_reply");
    }
    const notice = new URLSearchParams(window.location.search).get("notice");
    if (notice === "session-ended") {
      announce("inbox", "Your session ended. Sign in again.");
    }
  }
  function parseCurrentUrl() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (status === "answered" || status === "closed") {
      state.status = status;
    } else {
      state.status = "waiting";
    }
    state.query = params.get("q") ?? "";
    const match = window.location.pathname.match(/^\/inbox\/([^/]+)/);
    state.openThreadId = match ? decodeURIComponent(match[1]) : null;
  }
  function openThreadFromUrl(elements) {
    if (state.openThreadId) {
      void loadThread(elements, state.openThreadId, false);
    } else {
      renderNoThread(elements);
    }
  }
  async function refreshInbox(elements, keepRows) {
    const params = new URLSearchParams();
    if (state.status !== "waiting") params.set("status", state.status);
    if (state.query !== "") params.set("q", state.query);
    const query = params.toString();
    const result = await api("GET", `/api/inbox${query === "" ? "" : `?${query}`}`);
    if (!result.ok) return;
    const body = result.body;
    if (!keepRows) state.rows = body.threads;
    state.nextCursor = body.next_cursor;
    for (const status of ["waiting", "answered", "closed"]) {
      elements.tabs[status].textContent = `${status[0].toUpperCase()}${status.slice(1)} ${body.counts[status]}`;
      elements.tabs[status].setAttribute("aria-selected", state.status === status ? "true" : "false");
    }
    if (!keepRows) renderRows(elements);
    elements.search.value = state.query;
  }
  function renderRows(elements) {
    const focusedThreadId = document.activeElement?.closest("a")?.getAttribute("data-thread");
    const previousSelection = state.rows.find((row) => row.id === state.openThreadId);
    elements.rows.textContent = "";
    const emptyCopy = elements.rows.parentElement?.querySelector(".empty-copy");
    if (state.rows.length === 0) {
      const sentence = state.status === "waiting" && state.query === "" ? "No one is waiting. Back to the game." : "No threads here.";
      if (emptyCopy) emptyCopy.textContent = sentence;
      elements.rows.append(el("li", { class: "visually-hidden" }, sentence));
    } else {
      if (emptyCopy) emptyCopy.textContent = "";
    }
    for (const row of state.rows) {
      const link = el(
        "a",
        {
          href: threadUrl(row.id),
          class: "thread-row",
          "data-thread": row.id,
          "aria-current": state.openThreadId === row.id ? "page" : null
        },
        el("span", { class: "player-name" }, row.player.name),
        el("span", { class: "first-line" }, row.first_line),
        el("span", { class: `status-word ${row.status}` }, row.status)
      );
      elements.rows.append(el("li", {}, link));
    }
    const existingMore = elements.moreButton;
    if (existingMore && existingMore.parentElement) existingMore.remove();
    elements.moreButton = null;
    if (state.nextCursor !== null) {
      const more = el("button", { type: "button", class: "text-button" }, "Show more threads");
      more.addEventListener("click", () => void loadMore(elements));
      elements.rows.parentElement?.append(more);
      elements.moreButton = more;
    }
    void previousSelection;
    if (focusedThreadId) {
      const restored = elements.rows.querySelector(`a[data-thread="${focusedThreadId}"]`);
      restored?.focus();
    }
  }
  async function loadMore(elements) {
    if (state.nextCursor === null) return;
    announce("inbox", "Loading more threads...");
    const params = new URLSearchParams();
    params.set("cursor", state.nextCursor);
    if (state.status !== "waiting") params.set("status", state.status);
    if (state.query !== "") params.set("q", state.query);
    const result = await api("GET", `/api/inbox?${params.toString()}`);
    if (!result.ok) {
      announce("inbox", "More threads didn't load. Try again.");
      return;
    }
    const body = result.body;
    const known = new Set(state.rows.map((row) => row.id));
    const appended = body.threads.filter((row) => !known.has(row.id));
    state.rows = [...state.rows, ...appended];
    state.nextCursor = body.next_cursor;
    renderRows(elements);
    announce("inbox", `Showing ${state.rows.length} threads.`);
    const firstAppended = elements.rows.querySelector(`a[data-thread="${appended[0]?.id ?? ""}"]`);
    firstAppended?.focus();
  }
  function renderNoThread(elements) {
    elements.threadPane.setAttribute("aria-busy", "false");
    elements.heading?.remove();
    elements.heading = null;
    elements.messagesList.textContent = "";
    elements.purchasesList.textContent = "";
    elements.recordList.textContent = "";
    elements.gameServerStatus.textContent = "";
    showPrompt(elements.tamper, "Select a message to see what was checked.");
  }
  function messageEntry(message, selected, staffView) {
    const item = el("li", { tabindex: "0", "data-message": message.id, "aria-current": selected ? "true" : null });
    const meta = el("p", { class: "message-meta" }, `${message.author.name}, ${formatTime(message.created_at)}`);
    item.append(meta);
    if (message.kind === "player" || message.kind === "reply") {
      item.append(el("p", { class: "message-text" }, renderFormatted(message.body ?? "")));
    } else if (message.event) {
      const event = message.event;
      if (event.verdict === "refused") {
        if (!staffView) return el("li", { class: "visually-hidden" });
        item.append(el("p", { class: "message-text evidence" }, `Refused game-server event: ${event.type}`));
      } else if (event.type === "purchase.receipt") {
        item.append(el("p", { class: "message-text" }, `Purchase recorded: ${event.item}, ${formatAmount(Number(event.amount_minor), event.currency ?? "")}`));
      } else if (event.type === "purchase.refunded") {
        if (event.refund_applied === false) {
          item.append(el("p", { class: "message-text" }, `Refund not applied: ${event.receipt_id}, currency differs`));
        } else {
          item.append(el("p", { class: "message-text" }, `Refund recorded: ${event.refund_id}, ${formatAmount(Number(event.amount_minor), event.currency ?? "")}`));
        }
      } else if (event.type === "match.finished") {
        const minutes = Math.floor(Number(event.duration_seconds) / 60);
        item.append(el("p", { class: "message-text" }, `Match ${event.result}: ${event.mode}, ${minutes} min`));
      }
    }
    for (const attachment of message.attachments) {
      const line = el("p", { class: "attachment-line" }, `${attachment.filename} ${attachment.status}`);
      item.append(line);
    }
    if (message.unfurl) {
      const host = new URL(message.unfurl.url).host;
      item.append(el("p", { class: "preview" }, `${message.unfurl.title}${message.unfurl.description ? `. ${message.unfurl.description}.` : ""} ${host}`));
    }
    return item;
  }
  async function loadThread(elements, threadId, announceOpening) {
    const generation = ++state.generation;
    if (announceOpening) announce("inbox", "Opening thread...");
    const result = await api("GET", `/api/threads/${threadId}`);
    if (generation !== state.generation) return false;
    if (!result.ok) {
      if (result.failure?.status === 404) {
        if (state.openThreadId === threadId) {
          state.openThreadId = null;
          state.thread = null;
          syncUrl(true);
          renderNoThread(elements);
          announce("inbox", "That thread is no longer available.");
          await refreshInbox(elements, false);
        }
      }
      return false;
    }
    const thread = result.body;
    state.thread = thread;
    state.openThreadId = thread.id;
    state.selectedMessage = null;
    state.lookup = null;
    renderThread(elements, thread);
    void runLookup(elements, thread.id, false);
    announce("inbox", `${thread.player.name}`);
    return true;
  }
  function renderThread(elements, thread) {
    const pane = elements.threadPane;
    const existing = pane.querySelector("h2");
    if (existing) existing.remove();
    const heading = el("h2", { tabindex: "-1" }, thread.player.name);
    pane.prepend(heading);
    elements.heading = heading;
    const topicWords = el("span", { class: "status-word" }, `${thread.topic} ${thread.status}`);
    heading.append(document.createTextNode(" "), topicWords);
    elements.messagesList.textContent = "";
    for (const message of thread.messages) {
      elements.messagesList.append(messageEntry(message, false, true));
    }
    renderPurchases(elements, thread);
    renderRecord(elements, null);
    elements.reply.value = state.replyKey === null ? elements.reply.value : elements.reply.value;
    if (elements.closeThreadButton) {
      elements.closeThreadButton.disabled = false;
    }
    markSelected(elements);
  }
  function renderPurchases(elements, thread) {
    elements.purchasesList.textContent = "";
    if (thread.purchases.length === 0) return;
    for (const purchase of thread.purchases) {
      const entry = el(
        "li",
        {},
        el("span", {}, `${purchase.receipt_id} ${purchase.item} ${formatAmount(purchase.amount_minor, purchase.currency)} `),
        el("span", { class: "status-word" }, refundWords(purchase)),
        el("span", { class: "comparison", "data-receipt": purchase.receipt_id })
      );
      elements.purchasesList.append(entry);
    }
  }
  function renderRecord(elements, lookup) {
    const region = elements.recordList;
    region.textContent = "";
    const button = el("button", { type: "button", class: "text-button" }, "Look up receipts again");
    button.addEventListener("click", () => void runLookup(elements, state.openThreadId, true));
    region.append(button, el("ul", { class: "purchases", "data-record": "true" }));
    if (lookup && lookup.available) {
      const list = region.querySelector("ul");
      for (const receipt of lookup.receipts) {
        list.append(el("li", {}, `${receipt.receipt_id} ${receipt.item} ${formatAmount(receipt.amount_minor, receipt.currency)} ${receiptStatusWords(receipt.status)} ${formatTime(receipt.purchased_at)}`));
      }
      if (lookup.receipts.length === 0) {
        elements.gameServerStatus.textContent = "The game server lists no receipts for this player.";
      } else {
        elements.gameServerStatus.textContent = "";
      }
    } else if (lookup && !lookup.available) {
      elements.gameServerStatus.textContent = "The game server isn't answering receipt lookups right now. Signed receipts in this thread are still checked.";
    }
    if (lookup) {
      for (const entry of lookup.purchases) {
        const cell = elements.purchasesList.querySelector(`[data-receipt="${entry.receipt_id}"]`);
        if (cell) cell.textContent = comparisonWords(entry);
      }
    }
  }
  async function runLookup(elements, threadId, manual) {
    const generation = state.generation;
    elements.gameServerStatus.textContent = "Asking the game server...";
    const result = await api("GET", `/api/threads/${threadId}/receipt-lookup`);
    if (generation !== state.generation || state.openThreadId !== threadId) return;
    if (!result.ok) {
      if (result.failure?.status === 403) {
        elements.purchasesList.textContent = "";
        elements.recordList.textContent = "";
        elements.gameServerStatus.textContent = "";
        return;
      }
      state.lookup = { available: false, receipts: [], purchases: [] };
      elements.gameServerStatus.textContent = "The game server isn't answering receipt lookups right now. Signed receipts in this thread are still checked.";
      return;
    }
    state.lookup = result.body;
    renderRecord(elements, state.lookup);
    void manual;
  }
  function markSelected(elements) {
    const items = elements.messagesList.querySelectorAll("li[data-message]");
    for (const item of items) {
      if (item.getAttribute("data-message") === state.selectedMessage) {
        item.setAttribute("aria-current", "true");
      } else {
        item.removeAttribute("aria-current");
      }
    }
  }
  function stageOrder(stage) {
    return ["signature", "bucket", "sanitiser", "link"].indexOf(stage);
  }
  async function selectMessage(elements, messageId) {
    state.selectedMessage = messageId;
    markSelected(elements);
    if (messageId === null) {
      showPrompt(elements.tamper, "Select a message to see what was checked.");
      return;
    }
    const thread = state.thread;
    const message = thread?.messages.find((entry) => entry.id === messageId);
    if (!thread || !message) return;
    if (message.kind === "reply") {
      showPrompt(elements.tamper, "Replies are not checked.");
      return;
    }
    if (message.kind === "event" && message.event && message.event.verdict === "refused") {
      showPrompt(elements.tamper, "Select a message to see what was checked.");
      return;
    }
    setChecking(elements.tamper);
    const streamPath = `/api/messages/${messageId}/forensics/stream`;
    const source = new EventSource(streamPath);
    const stages = [];
    source.addEventListener("stage", (event) => {
      const line = JSON.parse(event.data);
      if (state.selectedMessage !== messageId) {
        source.close();
        return;
      }
      settle(elements, line);
      stages.push(line);
    });
    source.addEventListener("settled", (event) => {
      const body = JSON.parse(event.data);
      if (state.selectedMessage !== messageId) {
        source.close();
        return;
      }
      for (const line of body.lines) {
        if (!stages.some((seen) => seen.stage === line.stage)) settle(elements, line);
      }
      announce("verdicts", verdictSentence(body));
      source.close();
    });
    source.onerror = () => {
      source.close();
    };
  }
  function settle(elements, line) {
    const pane = elements.tamper;
    const element = pane.lines[line.stage];
    const verdict = element.querySelector(".verdict");
    if (verdict) {
      verdict.textContent = line.verdict;
      verdict.classList.remove("line-settle");
      void verdict.offsetWidth;
      verdict.classList.add("line-settle");
    }
    if (line.stage === "bucket") {
      pane.meter.value = line.level ?? 0;
    }
    if (line.stage === "sanitiser" && line.before && line.after && Array.isArray(line.removed)) {
      const before = element.querySelector(".before");
      if (before) {
        before.textContent = "";
        const beforeElement = document.createElement("blockquote");
        beforeElement.className = "evidence";
        beforeElement.textContent = line.before;
        const afterElement = document.createElement("blockquote");
        afterElement.className = "evidence";
        afterElement.textContent = line.after;
        before.append(beforeElement, afterElement);
        for (const span of line.removed) {
          const strike = document.createElement("s");
          strike.textContent = span.text;
          before.append(strike);
        }
      }
    }
    void stageOrder;
  }
  function focusSelected(elements) {
    const item = elements.messagesList.querySelector(`li[data-message="${state.selectedMessage ?? ""}"]`);
    item?.focus();
  }
  function moveSelection(elements, direction) {
    const messages = state.thread?.messages.filter((message) => message.kind === "player" || message.kind === "event" && message.event?.verdict === "accepted" || message.kind === "reply") ?? [];
    if (messages.length === 0) return;
    const ids = messages.map((message) => message.id);
    if (state.selectedMessage === null) {
      const target = direction === 1 ? ids[0] : ids[ids.length - 1];
      void selectMessage(elements, target).then(() => focusSelected(elements));
      return;
    }
    const current = ids.indexOf(state.selectedMessage);
    if (current === -1) {
      const target = direction === 1 ? ids[0] : ids[ids.length - 1];
      void selectMessage(elements, target).then(() => focusSelected(elements));
      return;
    }
    const next = current + direction;
    if (next < 0 || next >= ids.length) return;
    void selectMessage(elements, ids[next]).then(() => focusSelected(elements));
  }
  function moveThread(elements, direction) {
    const index = state.rows.findIndex((row) => row.id === state.openThreadId);
    if (index === -1) {
      if (state.rows.length === 0) return;
      const first = direction === 1 ? state.rows[0] : state.rows[state.rows.length - 1];
      state.openThreadId = first.id;
      syncUrl(false);
      void loadThread(elements, first.id, false).then(() => elements.heading?.focus());
      return;
    }
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= state.rows.length) return;
    const target = state.rows[nextIndex];
    state.openThreadId = target.id;
    syncUrl(false);
    void loadThread(elements, target.id, false).then(() => {
      elements.heading?.focus();
    });
  }
  function newReplyKey() {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 24).replace(/[^A-Za-z0-9_-]/g, "x");
  }
  async function sendReplyAction(elements) {
    const thread = state.thread;
    if (!thread || state.replyPending) return;
    const text = elements.reply.value;
    if (text.trim() === "") {
      announce("inbox", "Write a reply before sending.");
      return;
    }
    if (state.replyKey === null) state.replyKey = newReplyKey();
    const key = state.replyKey;
    state.replyPending = true;
    announce("inbox", "Sending reply...");
    const result = await api("POST", `/api/threads/${thread.id}/replies`, { body: text }, { "idempotency-key": key });
    state.replyPending = false;
    if (result.ok) {
      state.replyKey = null;
      announce("inbox", `Reply sent to ${thread.player.name}.`);
      elements.reply.value = "";
      await loadThread(elements, thread.id, false);
      return;
    }
    const failure = result.failure;
    if (failure.status === 409 && failure.code === "thread_closed") {
      announce("inbox", "This thread is closed. It reopens when the player writes again.");
      return;
    }
    if (failure.status === 409 && failure.code === "idempotency_in_progress") {
      return;
    }
    if (failure.status === 422 && failure.code === "idempotency_replay") {
      return;
    }
    announce("inbox", "Reply not sent. Try again.");
  }
  async function closeThreadAction(elements) {
    const thread = state.thread;
    if (!thread) return;
    announce("inbox", "Closing thread...");
    const result = await api("POST", `/api/threads/${thread.id}/close`, {});
    if (result.ok) {
      announce("inbox", "Thread closed.");
      const index = state.rows.findIndex((row) => row.id === thread.id);
      if (index !== -1) {
        state.rows[index] = { ...state.rows[index], status: "closed" };
      }
      const candidates = [...state.rows];
      const next = candidates[index + 1] ?? candidates[index - 1];
      if (next) {
        state.openThreadId = next.id;
        syncUrl(false);
        await loadThread(elements, next.id, false);
        elements.heading?.focus();
      } else {
        state.openThreadId = null;
        syncUrl(false);
        renderNoThread(elements);
        const firstRow = elements.rows.querySelector("a");
        firstRow?.focus();
      }
      void refreshInbox(elements, false);
      return;
    }
    const failure = result.failure;
    if (failure.code === "not_answered") {
      announce("inbox", "Answer the player before closing.");
    } else if (failure.code === "already_closed") {
      announce("inbox", "This thread is already closed.");
    } else {
      announce("inbox", "Thread not closed. Try again.");
    }
  }
  function startStream(elements) {
    const source = new EventSource("/api/stream");
    const handler = (data) => {
      const threadId = typeof data.thread_id === "string" ? data.thread_id : null;
      if (threadId && state.openThreadId === threadId && state.thread) {
        void loadThread(elements, threadId, false);
      }
      if (!threadId || threadId === state.openThreadId || true) {
        void refreshInbox(elements, false);
      }
    };
    source.addEventListener("message", (event) => handler(JSON.parse(event.data)));
    source.addEventListener("thread_status", (event) => handler(JSON.parse(event.data)));
    source.addEventListener("attachment", (event) => handler(JSON.parse(event.data)));
    source.addEventListener("rules_changed", () => {
      void refreshInbox(elements, false);
      if (state.openThreadId) {
        void loadThread(elements, state.openThreadId, false);
      }
    });
    source.onerror = () => {
      source.close();
    };
    void apiStream;
  }
  function wireEvents(elements, controls) {
    for (const status of ["waiting", "answered", "closed"]) {
      elements.tabs[status].addEventListener("click", () => {
        state.status = status;
        state.rows = [];
        syncUrl(false);
        void refreshInbox(elements, false);
      });
    }
    let searchTimer;
    elements.search.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        state.query = elements.search.value;
        state.rows = [];
        syncUrl(true);
        void refreshInbox(elements, false);
      }, 250);
    });
    elements.rows.addEventListener("click", (event) => {
      const target = event.target.closest("a[data-thread]");
      if (!target) return;
      event.preventDefault();
      const id = target.getAttribute("data-thread");
      state.openThreadId = id;
      syncUrl(false);
      onThreadChosenFromList();
      void loadThread(elements, id, false).then(() => elements.heading?.focus());
    });
    elements.messagesList.addEventListener("click", (event) => {
      const item = event.target.closest("li[data-message]");
      if (!item) return;
      void selectMessage(elements, item.getAttribute("data-message"));
    });
    elements.messagesList.addEventListener("keydown", (event) => {
      const item = event.target.closest("li[data-message]");
      if (!item) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void selectMessage(elements, item.getAttribute("data-message")).then(() => item.focus());
      }
    });
    controls.sendReply.addEventListener("click", () => void sendReplyAction(elements));
    controls.closeThread.addEventListener("click", () => void closeThreadAction(elements));
    elements.reply.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void sendReplyAction(elements);
      }
    });
    controls.signOut.addEventListener("click", async () => {
      await api("POST", "/api/auth/logout", {});
      window.location.href = "/signin?notice=signed-out";
    });
    const drawer = elements.drawer;
    const drawerIsOverlay = () => window.innerWidth < 1100;
    onThreadChosenFromList = () => {
      if (drawer?.classList.contains("open")) closeDrawer();
    };
    if (drawerIsOverlay()) drawer?.setAttribute("inert", "inert");
    window.addEventListener("resize", () => {
      if (!drawer?.classList.contains("open")) {
        if (drawerIsOverlay()) drawer?.setAttribute("inert", "inert");
        else drawer?.removeAttribute("inert");
      }
    });
    const openDrawer = () => {
      if (!drawer) return;
      state.overlayOpen = true;
      drawer.classList.add("open");
      drawer.removeAttribute("inert");
      controls.drawerButton.setAttribute("aria-expanded", "true");
      elements.drawerBackdrop?.removeAttribute("hidden");
      const first = drawer.querySelector("button, input, a");
      first?.focus();
    };
    const closeDrawer = () => {
      if (!drawer) return;
      state.overlayOpen = false;
      drawer.classList.remove("open");
      if (drawerIsOverlay()) drawer.setAttribute("inert", "inert");
      controls.drawerButton.setAttribute("aria-expanded", "false");
      elements.drawerBackdrop?.setAttribute("hidden", "hidden");
      controls.drawerButton.focus();
    };
    controls.drawerButton.addEventListener("click", () => {
      if (drawer?.classList.contains("open")) closeDrawer();
      else openDrawer();
    });
    elements.drawerBackdrop?.addEventListener("click", closeDrawer);
    const sheetPane = controls.sheet.pane;
    const openSheet = () => {
      state.overlayOpen = true;
      sheetPane.removeAttribute("hidden");
      controls.sheetButton.setAttribute("aria-expanded", "true");
      controls.sheetBackdrop.removeAttribute("hidden");
      sheetPane.append(...Array.from(elements.tamper.container.childNodes));
      const first = sheetPane.querySelector("button, [tabindex]");
      first?.focus();
    };
    const closeSheet = () => {
      state.overlayOpen = false;
      sheetPane.setAttribute("hidden", "hidden");
      controls.sheetButton.setAttribute("aria-expanded", "false");
      controls.sheetBackdrop.setAttribute("hidden", "hidden");
      elements.tamper.container.append(...Array.from(sheetPane.childNodes));
      controls.sheetButton.focus();
    };
    controls.sheetButton.addEventListener("click", () => {
      if (sheetPane.hasAttribute("hidden")) openSheet();
      else closeSheet();
    });
    controls.sheetBackdrop.addEventListener("click", closeSheet);
    sheetPane.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        const focusables = Array.from(sheetPane.querySelectorAll('button, [tabindex]:not([tabindex="-1"])'));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const focusables = Array.from(sheetPane.querySelectorAll('[tabindex]:not([tabindex="-1"])'));
        const index = focusables.indexOf(document.activeElement);
        const next = event.key === "ArrowDown" ? Math.min(focusables.length - 1, index + 1) : Math.max(0, index - 1);
        focusables[next]?.focus();
        event.preventDefault();
      }
    });
    elements.tamper.pane.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const focusables = Array.from(elements.tamper.pane.querySelectorAll('[tabindex]:not([tabindex="-1"])'));
        const index = focusables.indexOf(document.activeElement);
        const next = event.key === "ArrowDown" ? Math.min(focusables.length - 1, index + 1) : Math.max(0, index - 1);
        focusables[next]?.focus();
        event.preventDefault();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
      if (event.key === "Escape") {
        if (!sheetPane.hasAttribute("hidden")) {
          closeSheet();
          return;
        }
        if (drawer?.classList.contains("open")) {
          closeDrawer();
          return;
        }
      }
      if (state.overlayOpen) {
        if (event.key.toUpperCase() === "T" && !sheetPane.hasAttribute("hidden")) {
          closeSheet();
        }
        return;
      }
      switch (event.key.toUpperCase()) {
        case "J":
          moveSelection(elements, 1);
          break;
        case "K":
          moveSelection(elements, -1);
          break;
        case "N":
          moveThread(elements, 1);
          break;
        case "P":
          moveThread(elements, -1);
          break;
        case "R":
          elements.reply.focus();
          break;
        case "C":
          void closeThreadAction(elements);
          break;
        case "T":
          if (window.innerWidth < 600) openSheet();
          else elements.tamper.lines.signature.focus();
          break;
        default:
          break;
      }
    });
  }

  // src/client/rules.ts
  function ruleText(rule) {
    const topicWords = rule.topic === "*" ? "all topics" : `${rule.topic} threads`;
    return `${rule.effect} ${rule.action} on ${topicWords}`;
  }

  // src/client/team.ts
  var TOPIC_OPTIONS = [
    ["bug", "bug"],
    ["account", "account"],
    ["purchase", "purchase"],
    ["other", "other"],
    ["*", "all topics"]
  ];
  async function teamPage(root) {
    document.title = "Team \u2014 Hushline";
    const sessionResult = await api("GET", "/api/auth/session");
    if (!sessionResult.ok) {
      window.location.href = "/signin";
      return;
    }
    const session2 = sessionResult.body;
    if (session2.user.role !== "developer") {
      window.location.href = "/inbox";
      return;
    }
    setChangeToken(session2.change_token);
    const container = el("div", { class: "column" });
    container.append(el("h1", {}, "Team"));
    const announcements = el("div", { role: "status", "aria-live": "polite", class: "visually-hidden" });
    registerLiveRegion("team", announcements);
    container.append(announcements);
    const list = el("div", { class: "panel" });
    container.append(list);
    root.append(container);
    await renderTeam(list);
  }
  async function renderTeam(list) {
    const result = await api("GET", "/api/team");
    if (!result.ok) return;
    list.textContent = "";
    for (const moderator of result.body.moderators) {
      const region = el("section", { "aria-label": moderator.name });
      region.append(el("h2", {}, moderator.name), el("p", { class: "muted" }, moderator.email));
      const rulesList = el("ul", { "aria-label": "Rules", class: "rule-list" });
      for (const rule of moderator.rules) {
        const text = ruleText(rule);
        const revoke = el("button", { type: "button", "aria-label": `Revoke ${text}` }, "Revoke");
        revoke.addEventListener("click", () => void revokeRule(list, moderator.id, rule.id));
        rulesList.append(el("li", {}, el("span", {}, text), revoke));
      }
      region.append(rulesList);
      const form = el("form", { novalidate: "novalidate" });
      const effect = el("select", { "aria-label": "Effect" });
      effect.append(el("option", { value: "grant" }, "grant"), el("option", { value: "deny" }, "deny"));
      const action = el("select", { "aria-label": "Action" });
      for (const [value, label] of [["read", "read"], ["reply", "reply"], ["close", "close"], ["receipts", "receipts"]]) {
        action.append(el("option", { value }, label));
      }
      const topic = el("select", { "aria-label": "Topic" });
      for (const [value, label] of TOPIC_OPTIONS) {
        topic.append(el("option", { value }, label));
      }
      const add = el("button", { type: "submit", class: "accent" }, "Add rule");
      form.append(effect, action, topic, add);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void addRule(list, moderator.id, { effect: effect.value, action: action.value, topic: topic.value });
      });
      region.append(form);
      list.append(region);
    }
  }
  async function addRule(list, moderatorId, body) {
    announce("team", "Adding rule...");
    const result = await api("POST", `/api/team/${moderatorId}/rules`, body);
    if (result.ok) {
      announce("team", "Rule added.");
      await renderTeam(list);
    } else {
      announce("team", "Rule not saved. Try again.");
    }
  }
  async function revokeRule(list, moderatorId, ruleId) {
    announce("team", "Revoking rule...");
    const result = await api("DELETE", `/api/team/${moderatorId}/rules/${ruleId}`);
    if (result.ok) {
      announce("team", "Rule revoked.");
      await renderTeam(list);
    } else {
      announce("team", "Rule not revoked. Try again.");
    }
  }

  // src/client/widget.ts
  var PLAYER_HEADERS = new Headers();
  var widgetHeaders = {};
  function widgetParams() {
    const match = window.location.pathname.match(/^\/widget\/([^/]+)/);
    if (!match) return null;
    const params = new URLSearchParams(window.location.search);
    const player = params.get("player");
    const sig = params.get("sig");
    if (!player || !sig) return null;
    return { game: decodeURIComponent(match[1]), player, sig };
  }
  function request(path, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("x-hushline-player", widgetHeaders.player);
    headers.set("x-hushline-player-signature", widgetHeaders.sig);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    return fetch(path, { ...init, headers });
  }
  var state2 = {
    gameName: "",
    threadId: null,
    messages: [],
    bucket: { level: 8, capacity: 8, retry_after_seconds: null },
    retryAt: null,
    replyKey: null,
    pending: false,
    identityFailed: false
  };
  function newKey() {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 24).replace(/[^A-Za-z0-9_-]/g, "x");
  }
  async function readJson(response) {
    const text = await response.text();
    if (text === "") return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  async function widgetPage(root) {
    document.title = "Help \u2014 Hushline";
    const params = widgetParams();
    const container = el("div", { class: "widget" });
    const heading = el("h1", {}, "Help");
    const announcements = el("div", { role: "status", "aria-live": "polite", class: "visually-hidden" });
    registerLiveRegion("widget", announcements);
    const conversation = el("ul", { "aria-label": "Conversation", class: "conversation" });
    const topicPicker = el("select", { "aria-label": "Topic" });
    topicPicker.append(
      el("option", { value: "bug" }, "Bug"),
      el("option", { value: "account" }, "Account"),
      el("option", { value: "purchase" }, "Purchase"),
      el("option", { value: "other" }, "Something else")
    );
    const messageField = el("textarea", { "aria-label": "Message", rows: "4", placeholder: "Message" });
    const fileInput = el("input", { type: "file", "aria-label": "Attach a file", multiple: "multiple" });
    const pickedFiles = el("ul", { class: "rule-list" });
    const sendButton = el("button", { type: "button", class: "accent" }, "Send");
    container.append(heading, announcements, conversation, topicPicker, messageField, fileInput, pickedFiles, sendButton);
    root.append(container);
    if (!params) {
      announce("widget", "This help window couldn't confirm who you are. Reopen it from the game.");
      conversation.textContent = "This help window couldn't confirm who you are. Reopen it from the game.";
      return;
    }
    widgetHeaders = { player: params.player, sig: params.sig };
    void PLAYER_HEADERS;
    const meResponse = await request(`/api/widget/${params.game}/me`);
    if (meResponse.status === 401) {
      announce("widget", "This help window couldn't confirm who you are. Reopen it from the game.");
      conversation.textContent = "This help window couldn't confirm who you are. Reopen it from the game.";
      return;
    }
    const me = await readJson(meResponse);
    state2.bucket = me.bucket;
    state2.threadId = me.thread_id;
    if (me.thread_id) {
      await refreshThread();
    }
    if (state2.gameName === "" && me.game && typeof me.game.name === "string") {
      state2.gameName = me.game.name;
    }
    if (state2.gameName === "") {
      const gameThread = state2.messages.find((message) => message.author.role === "game_server");
      state2.gameName = gameThread ? gameThread.author.name : "the game";
    }
    heading.textContent = `Help with ${state2.gameName}`;
    applyBucket();
    const pollReplies = async () => {
      if (state2.threadId) {
        await refreshThread();
      }
      const meNow = await readJson(await request(`/api/widget/${params.game}/me`));
      if (meNow) {
        state2.bucket = meNow.bucket;
        applyBucket();
      }
    };
    window.setInterval(() => void pollReplies(), 4e3);
    fileInput.addEventListener("change", () => {
      pickedFiles.textContent = "";
      for (const file of Array.from(fileInput.files ?? [])) {
        pickedFiles.append(el("li", {}, `${file.name} ${file.size}`));
      }
    });
    sendButton.addEventListener("click", () => void send());
    async function send() {
      if (state2.pending) return;
      if (state2.retryAt !== null && Date.now() < state2.retryAt) return;
      const body = messageField.value;
      const topic = topicPicker.value;
      if (body.trim() === "") {
        announce("widget", "Write a message before sending.");
        return;
      }
      if (state2.threadId === null && topic === "") {
        announce("widget", "Choose what this is about.");
        return;
      }
      if (state2.replyKey === null) state2.replyKey = newKey();
      state2.pending = true;
      announce("widget", "Sending...");
      const payload = { body };
      if (state2.threadId === null) payload.topic = topic;
      const response = await request(`/api/widget/${params.game}/messages`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "idempotency-key": state2.replyKey }
      });
      if (response.status === 201) {
        const data = await readJson(response);
        state2.replyKey = null;
        messageField.value = "";
        state2.threadId = data.thread.id;
        announce("widget", "Sent. Replies appear here.");
        await refreshThread();
        const files = Array.from(fileInput.files ?? []);
        for (const file of files) {
          await uploadFile(file, data.message.id);
        }
        fileInput.value = "";
        pickedFiles.textContent = "";
        const meAfter = await readJson(await request(`/api/widget/${params.game}/me`));
        if (meAfter) {
          state2.bucket = meAfter.bucket;
          applyBucket();
        }
        state2.pending = false;
        return;
      }
      state2.pending = false;
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "1");
        state2.retryAt = Date.now() + retryAfter * 1e3;
        announce("widget", `You're writing faster than the inbox can read. Try again in ${retryAfter} seconds.`);
        applyBucket();
        return;
      }
      const failure = await readJson(response);
      if (response.status === 422 && failure?.error?.fields?.body) {
        announce("widget", failure.error.fields.body);
        return;
      }
      if (response.status === 422 && failure?.error?.fields?.topic) {
        announce("widget", failure.error.fields.topic);
        return;
      }
      announce("widget", "Message not sent. Try again.");
    }
    async function uploadFile(file, messageId) {
      announce("widget", `Uploading ${file.name}...`);
      const form = new FormData();
      form.append("file", file, file.name);
      const response = await fetch(`/api/widget/${params.game}/messages/${messageId}/attachments`, {
        method: "POST",
        body: form,
        headers: { "x-hushline-player": widgetHeaders.player, "x-hushline-player-signature": widgetHeaders.sig }
      });
      if (response.status === 202) {
        const data = await readJson(response);
        announce("widget", `Attached ${data.attachment.filename}.`);
        await refreshThread();
        return;
      }
      const failure = await readJson(response);
      const sentence = failure?.error?.fields?.file;
      if (sentence && sentence.includes("5,000,000")) {
        announce("widget", "Files can be up to 5,000,000 bytes.");
        return;
      }
      if (sentence) {
        announce("widget", sentence);
        return;
      }
      announce("widget", `${file.name} didn't upload. Send it again later.`);
    }
    async function refreshThread() {
      if (state2.threadId === null) return;
      const response = await request(`/api/widget/${params.game}/threads/${state2.threadId}`);
      if (response.status !== 200) return;
      const thread = await readJson(response);
      state2.messages = thread.messages;
      renderConversation(conversation, thread, heading, topicPicker);
    }
    function applyBucket() {
      const limited = state2.bucket.retry_after_seconds !== null && state2.bucket.retry_after_seconds !== void 0;
      if (limited) {
        sendButton.setAttribute("aria-disabled", "true");
        announce("widget", `You're writing faster than the inbox can read. Try again in ${state2.bucket.retry_after_seconds} seconds.`);
      } else {
        sendButton.removeAttribute("aria-disabled");
      }
    }
  }
  function renderConversation(container, thread, heading, topicPicker) {
    container.textContent = "";
    for (const message of thread.messages) {
      const item = el("li", { "data-message": message.id });
      const meta = el("p", { class: "message-meta" }, `${message.author.name}, ${formatTime(message.created_at)}`);
      item.append(meta);
      if (message.kind === "player" || message.kind === "reply") {
        item.append(el("p", { class: "message-text" }, renderFormatted(message.body ?? "")));
      } else if (message.event) {
        const event = message.event;
        if (event.type === "purchase.receipt") {
          item.append(el("p", { class: "message-text" }, `Purchase recorded: ${event.item}, ${formatAmount(Number(event.amount_minor), event.currency ?? "")}`));
        } else if (event.type === "purchase.refunded") {
          if (event.refund_applied === false) {
            item.append(el("p", { class: "message-text" }, `Refund not applied: ${event.receipt_id}, currency differs`));
          } else {
            item.append(el("p", { class: "message-text" }, `Refund recorded: ${event.refund_id}, ${formatAmount(Number(event.amount_minor), event.currency ?? "")}`));
          }
        } else if (event.type === "match.finished") {
          const minutes = Math.floor(Number(event.duration_seconds) / 60);
          item.append(el("p", { class: "message-text" }, `Match ${event.result}: ${event.mode}, ${minutes} min`));
        }
      }
      for (const attachment of message.attachments) {
        item.append(el("p", { class: "attachment-line" }, `${attachment.filename} ${attachment.status}`));
      }
      if (message.unfurl) {
        const host = new URL(message.unfurl.url).host;
        item.append(el("p", { class: "preview" }, `${message.unfurl.title}${message.unfurl.description ? `. ${message.unfurl.description}.` : ""} ${host}`));
      }
      container.append(item);
    }
    heading.textContent = `Help with ${state2.gameName}`;
    if (state2.threadId !== null) {
      topicPicker.setAttribute("hidden", "hidden");
    }
    void state2;
  }

  // src/client/app.ts
  function notFoundPage(root) {
    document.title = "There's no page here. \u2014 Hushline";
    const container = el("div", { class: "column not-found" });
    container.append(el("h1", {}, "There's no page here."));
    container.append(el("p", {}, el("a", { href: "/inbox" }, "Back to the inbox")));
    root.append(container);
  }
  async function start() {
    const root = document.getElementById("root");
    if (!root) return;
    const path = window.location.pathname;
    if (path === "/" || path === "") {
      publicPage(root);
      return;
    }
    if (path === "/signin") {
      signInPage(root, null);
      return;
    }
    if (path === "/team") {
      await teamPage(root);
      return;
    }
    if (path.startsWith("/inbox")) {
      await workspacePage(root);
      return;
    }
    if (path.startsWith("/widget/")) {
      await widgetPage(root);
      return;
    }
    notFoundPage(root);
  }
  void start();
})();
