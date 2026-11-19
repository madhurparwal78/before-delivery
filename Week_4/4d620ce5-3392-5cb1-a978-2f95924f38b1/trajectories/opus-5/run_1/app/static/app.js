// Tailboard: sign-in, the board frame, routing and the live feed.

import { announceError, announceLive, announceStatus, clearAnnouncements, closeKind, element,
  focusFirst, narrow } from "./a11y.js";
import * as api from "./client.js";
import { boardRegion, playSplice, railElement, renderBoard, showBanner,
  toggleRail } from "./board.js";
import { BAD_CREDENTIALS, LIVE_DROPPED, LIVE_RESUMED, PENDING, ROLE_LABELS, SESSION_ENDED }
  from "./copy.js";
import { closeDrawer, openDrawer, refreshDrawer, syncModality } from "./drawer.js";
import { openImport, openNewDirective, openTail } from "./dialogs.js";
import { auditScreen, packsScreen, peopleScreen } from "./screens.js";
import { directiveLabel, hooks, isClerk, isPlanner, state } from "./store.js";

const REFRESH_MS = 60_000;
const SEARCH_DEBOUNCE = 250;
let feed = null;
let timer = null;
let screenNode = null;
let mainNode = null;

// ------------------------------------------------------------------ sign in

function signInScreen(message) {
  const username = element("input", { type: "text", "aria-label": "Username", autocomplete: "off" });
  const passcode = element("input", { type: "password", "aria-label": "Passcode" });
  const form = element("form", { "aria-label": "Sign in", onsubmit: submit }, [
    element("h1", { text: "Tailboard" }),
    element("label", {}, ["Username", username]),
    element("label", {}, ["Passcode", passcode]),
    element("button", { type: "submit", class: "primary", text: "Sign in",
      "aria-label": "Sign in" }),
  ]);

  async function submit(event) {
    event.preventDefault();
    announceError("");
    announceStatus(PENDING.signin);
    const response = await api.post("/api/session", {
      username: username.value.trim(),
      passcode: passcode.value,
    });
    announceStatus("");
    if (!response.ok) {
      announceError(BAD_CREDENTIALS);
      username.focus();
      return;
    }
    state.user = response.body.user;
    await startBoard();
  }

  const screen = element("div", { class: "signin" }, [form]);
  mount(screen);
  if (message) announceError(message);
  focusFirst(form);
}

function mount(node) {
  screenNode = document.getElementById("screen");
  screenNode.textContent = "";
  screenNode.append(node);
}

// ------------------------------------------------------------------ frame

function frame() {
  const search = element("input", {
    type: "search",
    role: "searchbox",
    "aria-label": "Search fleet",
    placeholder: "Tail, directive, person or licence",
    autocomplete: "off",
  });
  const results = element("ul", { class: "results", "aria-label": "Search results", hidden: true });
  let debounce = null;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => runSearch(search.value.trim(), results), SEARCH_DEBOUNCE);
  });

  const sections = element("nav", { class: "sections", "aria-label": "Sections" },
    [
      ["Board", "board"],
      ["Packs", "packs"],
      ["People", "people"],
      ["Audit", "audit"],
    ].map(([label, route]) =>
      element("a", {
        href: `#${route}`,
        text: label,
        "aria-label": label,
        onclick: (event) => {
          event.preventDefault();
          show(route);
          sections.classList.remove("open");
        },
      })
    ));

  const topbar = element("header", { class: "topbar", role: "banner" }, [
    element("span", { class: "product", text: "Tailboard" }),
    element("button", {
      class: "railbutton",
      text: "Directives",
      "aria-label": "Directives",
      onclick: () => toggleRail(),
    }),
    element("div", { class: "searchwrap" }, [search, results]),
    element("button", {
      class: "menubutton",
      text: "Menu",
      "aria-label": "Menu",
      onclick: () => sections.classList.toggle("open"),
    }),
    sections,
    narrow() ? directivePicker() : null,
    isPlanner()
      ? element("button", {
          text: "New directive",
          "aria-label": "New directive",
          onclick: () => openNewDirective(),
        })
      : null,
    isClerk()
      ? element("button", {
          text: "Import history",
          "aria-label": "Import history",
          onclick: () => openImport(),
        })
      : null,
    element("span", { class: "spacer" }),
    element("span", { class: "who", text: `${state.user.display_name} · ${
      ROLE_LABELS[state.user.role]}` }),
    element("button", { text: "Sign out", "aria-label": "Sign out", onclick: signOut }),
  ]);

  mainNode = element("main", { class: "main" });
  const body = element("div", { class: "body" }, [railElement(), mainNode]);
  return element("div", { class: "frame" }, [topbar, body]);
}

function directivePicker() {
  const picker = element("select", { class: "directivepicker", "aria-label": "Directive" });
  picker.addEventListener("change", () => {
    state.pickedDirectiveId = picker.value;
    renderBoard();
  });
  return picker;
}

function fillDirectivePicker() {
  const picker = document.querySelector(".directivepicker");
  if (!picker || !state.board) return;
  const chosen = state.pickedDirectiveId || (state.board.directives[0] || {}).id;
  picker.textContent = "";
  for (const directive of state.board.directives) {
    picker.append(
      element("option", {
        value: directive.id,
        text: `${directiveLabel(directive)} ${directive.revision}`,
        selected: directive.id === chosen,
      })
    );
  }
  state.pickedDirectiveId = chosen;
  picker.value = chosen;
}

function show(route) {
  state.route = route;
  closeKind("menu");
  if (route !== "board") closeDrawer();
  mainNode.textContent = "";
  if (route === "board") mainNode.append(boardRegion());
  else if (route === "packs") mainNode.append(packsScreen());
  else if (route === "people") mainNode.append(peopleScreen());
  else if (route === "audit") mainNode.append(auditScreen());
  if (route === "board") renderBoard();
}

// ------------------------------------------------------------------ board data

async function refreshBoard() {
  const response = await api.get("/api/board");
  if (!response.ok) return null;
  state.board = response.body;
  if (state.route === "board") {
    fillDirectivePicker();
    renderBoard();
  }
  return response.body;
}

async function applySplice(directiveId, splice) {
  await refreshBoard();
  if (state.route !== "board") {
    showBanner(directiveId, splice);
    return;
  }
  await playSplice(directiveId, splice);
}

async function startBoard() {
  mount(frame());
  state.route = "board";
  show("board");
  await refreshBoard();
  openFeed();
  clearInterval(timer);
  timer = setInterval(() => {
    refreshBoard();
    if (state.openThreadId) refreshDrawer();
  }, REFRESH_MS);
}

async function signOut() {
  clearInterval(timer);
  if (feed) feed.close();
  await api.del("/api/session");
  state.user = null;
  state.board = null;
  state.playedSplices = new Set();
  clearAnnouncements();
  signInScreen();
}

// ------------------------------------------------------------------ live feed

function openFeed() {
  if (feed) feed.close();
  feed = new EventSource("/api/events");
  feed.addEventListener("open", () => announceLive(LIVE_RESUMED));
  feed.addEventListener("error", () => announceLive(LIVE_DROPPED));
  feed.addEventListener("threads", async (event) => {
    const data = JSON.parse(event.data);
    await refreshBoard();
    if (state.openThreadId && data.thread_ids.includes(state.openThreadId)) {
      await refreshDrawer();
    } else if (state.openThreadId) {
      await refreshDrawer();
    }
  });
  feed.addEventListener("revision", async (event) => {
    const data = JSON.parse(event.data);
    await applySplice(data.directive_id, data.splice);
    if (state.openThreadId) await refreshDrawer();
  });
}

// ------------------------------------------------------------------ search

async function runSearch(query, results) {
  if (query.length < 2) {
    results.textContent = "";
    results.setAttribute("hidden", "");
    return;
  }
  const response = await api.get(`/api/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) return;
  results.textContent = "";
  for (const result of response.body.results) {
    results.append(
      element("li", {}, [
        element("a", {
          href: "#result",
          text: result.label,
          "aria-label": result.label,
          onclick: (event) => {
            event.preventDefault();
            results.setAttribute("hidden", "");
            chooseResult(result);
          },
        }),
      ])
    );
  }
  if (!response.body.results.length) {
    results.append(element("li", { text: "No matches." }));
  }
  results.removeAttribute("hidden");
}

function chooseResult(result) {
  if (result.type === "thread") {
    if (state.route !== "board") show("board");
    openDrawer(result.id);
  } else if (result.type === "directive") {
    if (state.route !== "board") show("board");
    state.pickedDirectiveId = result.id;
    fillDirectivePicker();
    renderBoard();
  } else {
    show("people");
  }
}

// ------------------------------------------------------------------ boot

hooks.refreshBoard = refreshBoard;
hooks.refreshDrawer = refreshDrawer;
hooks.applySplice = applySplice;
hooks.openTail = openTail;
hooks.renderFrame = fillDirectivePicker;
hooks.signOut = signOut;

api.whenSessionEnds((message) => {
  clearInterval(timer);
  if (feed) feed.close();
  state.user = null;
  state.board = null;
  signInScreen(message || SESSION_ENDED);
});

window.addEventListener("resize", () => {
  syncModality();
  if (state.user && state.route === "board") {
    fillDirectivePicker();
    renderBoard();
  }
});

(async function boot() {
  if (!document.cookie.includes("tb_signed_in=1")) {
    signInScreen();
    return;
  }
  const response = await api.get("/api/session");
  if (response.ok && response.body.user) {
    state.user = response.body.user;
    await startBoard();
  } else {
    signInScreen();
  }
})();
