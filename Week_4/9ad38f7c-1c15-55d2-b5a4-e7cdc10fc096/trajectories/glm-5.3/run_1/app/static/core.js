/* NightWard Downtime — Strange & Unusual Activity.
   One origin, one live stream, one session token. */

(function () {
  "use strict";

  const TOKEN_KEY = "downtime_session";
  const CONSENT_KEY = "downtime_consent";
  const SOUND_KEY = "downtime_sound";

  const state = {
    token: null,
    user: null,
    sound: false,
    boardPage: 1,
    boardLimit: 5,
    scenarios: [],
    slugList: [],
    teamId: null,
    stream: null,
    ambient: null,
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // --- api -----------------------------------------------------------------

  async function api(path, options) {
    const opts = Object.assign({ method: "GET", body: null }, options || {});
    const headers = {};
    if (state.token) headers["Authorization"] = "Bearer " + state.token;
    if (opts.body !== null) headers["Content-Type"] = "application/json";
    const response = await fetch(path, {
      method: opts.body !== null ? "POST" : opts.method,
      headers: headers,
      body: opts.body !== null ? JSON.stringify(opts.body) : undefined,
    });
    if (response.status === 204) return { ok: true, status: 204, data: null };
    let data = null;
    const text = await response.text();
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = null; }
    if (response.status === 401) forgetToken();
    return { ok: response.ok, status: response.status, data: data };
  }

  function region(name) {
    return document.getElementById(name);
  }

  function announce(name, text) {
    const node = region(name);
    if (node) node.textContent = text;
  }

  function outageIn(name) {
    announce(name, "The event server is not answering. Try again in a moment.");
  }

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* private mode */ }
  }

  function load(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }

  function forget(key) {
    try { localStorage.removeItem(key); } catch (err) { /* private mode */ }
  }

  function rememberToken(token) {
    state.token = token;
    store(TOKEN_KEY, token);
  }

  function forgetToken() {
    state.token = null;
    state.user = null;
    forget(TOKEN_KEY);
  }

  // --- session chrome ---------------------------------------------------------

  function applySession(signedIn) {
    const nameNode = $(".account-name");
    const logout = $(".logout-button");
    const login = $(".login-link");
    const join = $(".join-link");
    $$(".nav-auth").forEach(function (node) { node.hidden = true; });
    if (signedIn) {
      if (nameNode) {
        nameNode.textContent = state.user ? state.user.display_name : "";
        nameNode.hidden = false;
      }
      if (logout) logout.hidden = false;
    } else {
      if (login) login.hidden = false;
      if (join) join.hidden = false;
    }
    $$("[data-signed-in-show]").forEach(function (node) {
      node.hidden = !signedIn;
    });
    $$("[data-signed-out-show]").forEach(function (node) {
      node.hidden = signedIn;
    });
    const webinarForm = $("[data-webinar-form]");
    const webinarOut = $(".webinar-signedout");
    if (webinarForm) webinarForm.hidden = !signedIn;
    if (webinarOut) webinarOut.hidden = signedIn;
  }

  function signedIn() {
    return Boolean(state.token && state.user);
  }

  // --- dialogs ------------------------------------------------------------------

  let openDialogState = null;

  function openDialog(id, opener) {
    const backdrop = $("[data-dialog-for=\"" + id + "\"]");
    if (!backdrop) return null;
    backdrop.hidden = false;
    const dialog = $(".dialog", backdrop);
    const focusable = focusables(dialog);
    openDialogState = { id: id, backdrop: backdrop,
                        opener: opener || document.activeElement };
    const target = $("input", dialog) || focusable[0] || dialog;
    if (target) target.focus();
    return dialog;
  }

  function closeDialog() {
    if (!openDialogState) return;
    openDialogState.backdrop.hidden = true;
    if (openDialogState.opener && document.contains(openDialogState.opener)) {
      openDialogState.opener.focus();
    }
    openDialogState = null;
  }

  function focusables(root) {
    return $$("button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])",
              root).filter(function (node) {
      return !node.disabled && node.offsetParent !== null;
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      if (openDialogState) { closeDialog(); return; }
      const nav = $("#site-nav");
      if (nav && nav.classList.contains("open")) {
        nav.classList.remove("open");
        const toggle = $(".menu-toggle");
        if (toggle) {
          toggle.setAttribute("aria-expanded", "false");
          toggle.focus();
        }
      }
    }
    if (event.key === "Tab" && openDialogState) {
      const list = focusables(openDialogState.backdrop);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  document.addEventListener("click", function (event) {
    const closer = event.target.closest("[data-close-dialog]");
    if (closer && openDialogState) { closeDialog(); return; }
    // A click that opened this dialog must not close it again: the opener
    // sits outside the dialog.
    const isOpener = openDialogState &&
      openDialogState.opener && openDialogState.opener.contains(event.target);
    if (openDialogState && !event.target.closest(".dialog") && !isOpener) {
      closeDialog();
    }
  });

  // --- consent -------------------------------------------------------------------

  function consentChosen() {
    return load(CONSENT_KEY) !== null;
  }

  function hideConsentPanel() {
    const panel = $("[data-consent-panel]");
    if (panel) panel.hidden = true;
  }

  function initConsent() {
    const panel = $("[data-consent-panel]");
    if (!panel) return;
    panel.hidden = consentChosen();
    document.addEventListener("click", function (event) {
      if (event.target.closest("[data-allow-all]")) {
        store(CONSENT_KEY, "all");
        hideConsentPanel();
      } else if (event.target.closest("[data-cookie-settings]")) {
        openDialog("cookie-settings", event.target);
      } else if (event.target.closest("[data-essential-only]")) {
        store(CONSENT_KEY, "essential");
        closeDialog();
        hideConsentPanel();
      }
    });
  }

  // --- sound -----------------------------------------------------------------------

  function initSound() {
    $$(".sound-toggle").forEach(function (toggle) {
      const on = load(SOUND_KEY) === "on";
      state.sound = on;
      updateSoundToggles(on);
      toggle.addEventListener("click", function () {
        setSound(!state.sound);
      });
    });
    if (state.sound) {
      const resume = function () {
        playAmbient();
        document.removeEventListener("pointerdown", resume);
        document.removeEventListener("keydown", resume);
      };
      document.addEventListener("pointerdown", resume);
      document.addEventListener("keydown", resume);
    }
  }

  function setSound(on) {
    state.sound = on;
    store(SOUND_KEY, on ? "on" : "off");
    updateSoundToggles(on);
    if (on) playAmbient();
    else fadeOutAmbient();
  }

  function updateSoundToggles(on) {
    $$(".sound-toggle").forEach(function (toggle) {
      toggle.setAttribute("aria-pressed", on ? "true" : "false");
      toggle.setAttribute("aria-label", on ? "Sound on" : "Sound off");
    });
  }

  function playAmbient() {
    if (!state.ambient) {
      state.ambient = new Audio("/assets/john-bartmann-breathing-down-my-neck-master-90c3b95a.ogg");
      state.ambient.loop = true;
      state.ambient.volume = 0;
    }
    state.ambient.play().then(function () {
      fadeTo(state.ambient, 0.35, 0.9);
    }).catch(function () { /* blocked */ });
  }

  function fadeOutAmbient() {
    if (!state.ambient) return;
    fadeTo(state.ambient, 0, 0.9, function () {
      state.ambient.pause();
    });
  }

  function fadeTo(node, target, seconds, done) {
    const start = node.volume;
    const t0 = performance.now();
    function step(now) {
      const k = Math.min(1, (now - t0) / (seconds * 1000));
      node.volume = start + (target - start) * k;
      if (k < 1) requestAnimationFrame(step);
      else if (done) done();
    }
    requestAnimationFrame(step);
  }

  function cue(correct) {
    if (!state.sound) return;
    try {
      const context = cueContext();
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.connect(gain);
      gain.connect(context.destination);
      osc.type = correct ? "sine" : "square";
      if (correct) {
        osc.frequency.setValueAtTime(520, context.currentTime);
        osc.frequency.setValueAtTime(780, context.currentTime + 0.12);
        gain.gain.setValueAtTime(0.12, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
        osc.start();
        osc.stop(context.currentTime + 0.36);
      } else {
        osc.frequency.setValueAtTime(140, context.currentTime);
        gain.gain.setValueAtTime(0.12, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
        osc.start();
        osc.stop(context.currentTime + 0.26);
      }
    } catch (err) { /* audio blocked */ }
  }

  let cueCtx = null;
  function cueContext() {
    if (!cueCtx) cueCtx = new (window.AudioContext || window.webkitAudioContext)();
    return cueCtx;
  }

  // --- UTC text -----------------------------------------------------------------------

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                  "August", "September", "October", "November", "December"];

  function utcText(iso) {
    if (!iso) return "";
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(iso);
    if (!match) return iso;
    const day = parseInt(match[3], 10);
    const month = parseInt(match[2], 10) - 1;
    return day + " " + MONTHS[month] + " " + match[1] + ", " + match[4] + ":" +
      match[5] + " UTC";
  }

  // --- return addresses, in one place on the client -----------------------------------

  function safeRedirect(raw) {
    if (!raw || typeof raw !== "string") return "/downtime";
    if (raw.charAt(0) !== "/") return "/downtime";
    if (raw.charAt(1) === "/" || raw.charAt(1) === "\\") return "/downtime";
    if (raw.indexOf("\\") !== -1) return "/downtime";
    if (/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return "/downtime";
    for (let i = 0; i < raw.length; i += 1) {
      const code = raw.charCodeAt(i);
      if (code <= 0x20 || code === 0x7f) return "/downtime";
    }
    return raw;
  }

  function redirectParam() {
    const value = new URLSearchParams(window.location.search).get("redirect");
    return value === null ? null : decodeURIComponent(value);
  }

  function followRedirect() {
    window.location.assign(safeRedirect(redirectParam()));
  }

  // --- the leaderboard -----------------------------------------------------------------

  function boardPageFromAddress() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("board");
    if (raw === null) return null;
    if (!/^[1-9][0-9]*$/.test(raw)) return null;
    return parseInt(raw, 10);
  }

  function replaceBoardInAddress(page) {
    const url = new URL(window.location.href);
    if (page === null) url.searchParams.delete("board");
    else if (page === 1) url.searchParams.delete("board");
    else url.searchParams.set("board", String(page));
    window.history.replaceState({ board: page || 1 }, "", url);
  }

  function clearBoardInAddress() {
    const url = new URL(window.location.href);
    url.searchParams.delete("board");
    window.history.replaceState({ board: 1 }, "", url);
  }

  function pushBoardInAddress(page) {
    const url = new URL(window.location.href);
    if (page === 1) url.searchParams.delete("board");
    else url.searchParams.set("board", String(page));
    window.history.pushState({ board: page }, "", url);
  }

  async function loadBoard(page, options) {
    const opts = options || {};
    if (!opts.silent) announce("leaderboard-updates", "Loading leaderboard…");
    const result = await api("/api/leaderboard?include_feed=1" +
      "&page=" + encodeURIComponent(page) +
      "&limit=" + state.boardLimit);
    if (!result.ok) {
      if (result.status === 400) {
        boardGo(1, { silent: true });
        return;
      }
      outageIn("leaderboard-updates");
      return;
    }
    const data = result.data;
    let shown = page;
    if (page > data.pages && data.pages > 0) {
      // A valid value past the last page opens the last page, by replacement.
      shown = data.pages;
      replaceBoardInAddress(shown);
      return loadBoardData(shown, data.pages);
    }
    state.boardPage = shown;
    renderBoard(data);
    renderFeed(data.feed || []);
    announce("leaderboard-updates", "");
  }

  async function loadBoardData(page, pages) {
    const result = await api("/api/leaderboard?include_feed=1" +
      "&page=" + encodeURIComponent(page) +
      "&limit=" + state.boardLimit);
    if (!result.ok) {
      outageIn("leaderboard-updates");
      return;
    }
    state.boardPage = page;
    renderBoard(result.data);
    renderFeed(result.data.feed || []);
    announce("leaderboard-updates", "");
  }

  function renderBoard(data) {
    const body = $("[data-board-body]");
    if (!body) return;
    body.innerHTML = "";
    if (!data.entries.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 7;
      cell.textContent = "No teams on this page yet.";
      row.appendChild(cell);
      body.appendChild(row);
    }
    data.entries.forEach(function (entry) {
      const row = document.createElement("tr");
      row.appendChild(cellOf(entry.rank, ""));
      row.appendChild(cellOf(entry.team_name, "team-cell"));
      row.appendChild(cellOf(entry.soc_sim, statusClass(entry.soc_sim)));
      row.appendChild(cellOf(entry.th_sim, statusClass(entry.th_sim)));
      row.appendChild(cellOf(entry.tabletop, statusClass(entry.tabletop)));
      row.appendChild(cellOf(entry.challenges_solved + "/" + entry.challenges_total, ""));
      row.appendChild(cellOf(entry.points + " XP", "points-cell"));
      body.appendChild(row);
    });
    renderPager(data);
    const count = $("[data-board-count]");
    if (count) count.textContent = data.page + " of " + data.pages + " available pages";
  }

  function statusClass(word) {
    if (word === "Passed" || word === "Completed") return "status-solved";
    return "";
  }

  function cellOf(text, className) {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    if (className.indexOf("status-solved") !== -1) {
      const tick = document.createElement("span");
      tick.className = "status-tick";
      tick.setAttribute("aria-hidden", "true");
      tick.textContent = "✓ ";
      cell.appendChild(tick);
    }
    cell.appendChild(document.createTextNode(String(text)));
    return cell;
  }

  function renderPager(data) {
    const numbers = $("[data-page-numbers]");
    const prev = $("[data-prev]");
    const next = $("[data-next]");
    if (!numbers) return;
    numbers.innerHTML = "";
    pagerList(data.page, data.pages).forEach(function (item) {
      if (item === "…") {
        const span = document.createElement("span");
        span.className = "page-ellipsis";
        span.setAttribute("aria-hidden", "true");
        span.textContent = "…";
        numbers.appendChild(span);
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "page-btn";
      button.textContent = String(item);
      button.setAttribute("aria-label", "Page " + item);
      if (item === data.page) button.setAttribute("aria-current", "page");
      button.addEventListener("click", function () {
        boardGo(item, { push: true });
      });
      numbers.appendChild(button);
    });
    if (prev) {
      prev.disabled = data.page <= 1;
      prev.onclick = function () {
        if (!prev.disabled) boardGo(data.page - 1, { push: true });
      };
    }
    if (next) {
      next.disabled = data.page >= data.pages;
      next.onclick = function () {
        if (!next.disabled) boardGo(data.page + 1, { push: true });
      };
    }
  }

  function pagerList(page, pages) {
    const out = [];
    if (pages <= 7) {
      for (let i = 1; i <= pages; i += 1) out.push(i);
      return out;
    }
    const keep = new Set();
    keep.add(1);
    keep.add(pages);
    for (let i = page - 1; i <= page + 1; i += 1) {
      if (i >= 1 && i <= pages) keep.add(i);
    }
    let previous = null;
    Array.from(keep).sort(function (a, b) { return a - b; }).forEach(function (n) {
      if (previous !== null && n - previous > 1) {
        out.push(n - previous === 2 ? n - 1 : "…");
      }
      out.push(n);
      previous = n;
    });
    return out;
  }

  function boardGo(page, options) {
    const push = options && options.push;
    if (push) pushBoardInAddress(page);
    loadBoard(page, { silent: options && options.silent });
  }

  function renderFeed(items) {
    const list = $("[data-feed-list]");
    if (!list) return;
    list.innerHTML = "";
    items.forEach(function (item) {
      const li = document.createElement("li");
      const team = document.createElement("span");
      team.className = "feed-team";
      team.textContent = item.team_name;
      li.appendChild(team);
      li.appendChild(document.createTextNode(" solved " + item.scenario_title));
      list.appendChild(li);
    });
  }

  // --- the live stream ------------------------------------------------------------------

  function connectStream(reconnecting) {
    if (!window.EventSource) return;
    const source = new EventSource("/api/stream");
    state.stream = source;
    source.addEventListener("open", function () {
      // A reconnect of the live stream reloads the page currently shown.
      if (reconnecting) onStreamReconnected();
    });
    source.addEventListener("score", function (event) {
      onScoreEvent(event);
    });
    source.addEventListener("team", function (event) {
      onTeamEvent(event);
    });
    source.addEventListener("error", function () {
      source.close();
      state.stream = null;
      setTimeout(function () { connectStream(true); }, 2000);
    });
  }

  function onStreamReconnected() {
    const page = document.querySelector("[data-page]");
    if (!page) return;
    if (page.dataset.page === "event") {
      loadBoard(state.boardPage, { silent: true });
    } else if (page.dataset.page === "team") {
      loadTeamRoom();
    } else if (page.dataset.page === "certificate") {
      readCertificate();
    } else if (page.dataset.page === "scenario") {
      loadScenarioState(page.dataset.scenarioSlug);
    }
  }

  function onScoreEvent(event) {
    let words = "";
    try {
      const data = JSON.parse(event.data);
      const scenario = state.scenarios.filter(function (s) {
        return s.slug === data.scenario_slug;
      })[0];
      if (scenario) words = data.team_name + " solved " + scenario.title;
    } catch (err) { words = ""; }
    loadBoard(state.boardPage, { silent: true }).then(function () {
      if (words) announce("leaderboard-updates", words);
    });
    refreshTrailStates();
    const page = document.querySelector("[data-page]");
    if (page && page.dataset.page === "certificate") readCertificate();
  }

  function onTeamEvent(event) {
    let teamId = null;
    try { teamId = JSON.parse(event.data).team_id; } catch (err) { teamId = null; }
    const page = document.querySelector("[data-page]");
    if (page && page.dataset.page === "team" && state.teamId &&
        teamId === state.teamId) {
      loadTeamRoom();
    }
    if (page && page.dataset.page === "certificate" && state.teamId &&
        teamId === state.teamId) {
      readCertificate();
    }
  }

  // --- the team room -----------------------------------------------------------------------

  async function loadTeamRoom() {
    const result = await api("/api/teams/mine");
    const room = $("[data-team-room]");
    const teamless = $("[data-teamless]");
    if (!room || !teamless) return;
    if (result.status === 404) {
      announce("team-messages", "You are no longer in this team");
      room.hidden = true;
      teamless.hidden = false;
      state.teamId = null;
      return;
    }
    if (!result.ok) {
      if (result.status === 401) return;
      outageIn("team-messages");
      return;
    }
    const data = result.data;
    state.teamId = data.team.id;
    room.hidden = false;
    teamless.hidden = true;
    const nameNode = $("[data-team-name]");
    if (nameNode) { nameNode.textContent = data.team.name; nameNode.hidden = false; }
    const codeNode = $("[data-invite-code]");
    if (codeNode) codeNode.textContent = data.team.invite_code;
    const scoreNode = $("[data-team-score]");
    if (scoreNode) scoreNode.textContent = data.score;
    const list = $("[data-member-list]");
    if (list) {
      list.innerHTML = "";
      data.members.forEach(function (member) {
        list.appendChild(memberRow(member, data.team.captain_id));
      });
    }
    const isCaptain = data.team.captain_id === (state.user && state.user.id);
    const newCode = $("[data-new-invite-code]");
    if (newCode) newCode.hidden = !isCaptain;
    const certRow = $("[data-certificate-row]");
    if (certRow) {
      certRow.hidden = !data.scenarios.every(function (s) { return s.team_solved; });
    }
    renderRoomStates(data.scenarios);
  }

  function memberRow(member, captainId) {
    const row = document.createElement("li");
    row.className = "member-row";
    const name = document.createElement("span");
    name.className = "member-name";
    name.textContent = member.display_name;
    row.appendChild(name);
    if (member.user_id === captainId) {
      const marker = document.createElement("span");
      marker.className = "captain-marker";
      marker.textContent = "Captain";
      row.appendChild(marker);
    }
    const joined = document.createElement("span");
    joined.className = "member-meta";
    joined.textContent = "Joined " + utcText(member.joined_at);
    row.appendChild(joined);
    const tickets = document.createElement("span");
    tickets.className = "member-tickets";
    tickets.textContent = member.tickets + " tickets";
    row.appendChild(tickets);
    if (state.user && member.user_id !== state.user.id &&
        captainId === state.user.id) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-outline remove-btn";
      remove.textContent = "Remove " + member.display_name;
      remove.addEventListener("click", function () {
        openRemoveDialog(member, remove);
      });
      row.appendChild(remove);
    }
    return row;
  }

  function renderRoomStates(states) {
    states.forEach(function (item) {
      const node = $("[data-room-state=\"" + item.slug + "\"]");
      if (!node) return;
      const label = $("[data-state-label]", node);
      const word = stateWord(item);
      if (label) {
        label.textContent = word;
        label.className = "room-state-label " + stateClass(item, word);
      }
    });
  }

  function stateWord(item) {
    if (item.solved_by_me) return "Solved by me";
    if (item.team_solved) return "Solved by the team";
    if (item.attempted_by_me) return "Attempted";
    return "Not attempted";
  }

  function stateClass(item, word) {
    if (word === "Solved by me" || word === "Solved by the team") return "state-solved";
    if (word === "Attempted") return "state-attempted";
    return "state-not";
  }

  async function refreshTrailStates() {
    if (!signedIn()) return;
    const result = await api("/api/teams/mine");
    if (!result.ok) return;
    const states = result.data.scenarios;
    states.forEach(function (item) {
      const node = $("[data-state-for=\"" + item.slug + "\"]");
      if (!node) return;
      const word = stateWord(item);
      node.textContent = word;
      node.className = "state " + stateClass(item, word);
      node.hidden = false;
    });
  }

  // --- team forms ---------------------------------------------------------------------------

  function initTeamForms() {
    document.addEventListener("click", function (event) {
      const creator = event.target.closest("[data-open-team-create]");
      if (creator) {
        if (!signedIn()) {
          window.location.assign("/login?redirect=%2Fdowntime%23registration");
          return;
        }
        openDialog("create-team", creator);
        return;
      }
      const joiner = event.target.closest("[data-open-team-join]");
      if (joiner) {
        if (!signedIn()) {
          window.location.assign("/login?redirect=%2Fdowntime%23registration");
          return;
        }
        openDialog("join-team", joiner);
        return;
      }
      const prizes = event.target.closest("[data-open-prizes]");
      if (prizes) { openDialog("prizes", prizes); return; }
      const leaver = event.target.closest("[data-open-leave]");
      if (leaver) { openDialog("leave-team", leaver); return; }
    });

    const createForm = $("[data-team-create-form]");
    if (createForm) {
      createForm.addEventListener("submit", function (event) {
        event.preventDefault();
        submitTeamCreate(createForm);
      });
    }
    const joinForm = $("[data-team-join-form]");
    if (joinForm) {
      joinForm.addEventListener("submit", function (event) {
        event.preventDefault();
        submitTeamJoin(joinForm);
      });
    }
    const confirmLeave = $("[data-confirm-leave]");
    if (confirmLeave) confirmLeave.addEventListener("click", leaveTeam);
    const confirmRemove = $("[data-confirm-remove]");
    if (confirmRemove) confirmRemove.addEventListener("click", confirmRemoveMember);
    const newCode = $("[data-new-invite-code]");
    if (newCode) newCode.addEventListener("click", issueNewCode);
    const copyCode = $("[data-copy-code]");
    if (copyCode) copyCode.addEventListener("click", function () {
      copyText($("[data-invite-code]").textContent, "Code copied");
    });
    const copyInvite = $("[data-copy-invite-link]");
    if (copyInvite) copyInvite.addEventListener("click", function () {
      const code = $("[data-invite-code]").textContent;
      copyText(window.location.origin + "/downtime?join=" + code + "#registration",
               "Invite link copied");
    });
  }

  async function submitTeamCreate(form) {
    const input = $("input", form);
    const button = $("button[type=submit]", form);
    const name = input.value.trim();
    if (!name) {
      showFieldError(input, "Enter a team name");
      return;
    }
    button.disabled = true;
    announce("team-messages", "Creating team…");
    const result = await api("/api/teams", { body: { name: name } });
    button.disabled = false;
    if (result.status === 201) {
      closeDialog();
      window.location.assign("/downtime/team");
      return;
    }
    handleTeamError(result, input);
  }

  async function submitTeamJoin(form) {
    const input = $("input", form);
    const button = $("button[type=submit]", form);
    const code = input.value.trim();
    if (!code) {
      showFieldError(input, "Enter an invite code");
      return;
    }
    button.disabled = true;
    announce("team-messages", "Joining team…");
    const result = await api("/api/teams/join", { body: { invite_code: code } });
    button.disabled = false;
    if (result.status === 200) {
      closeDialog();
      window.location.assign("/downtime/team");
      return;
    }
    handleTeamError(result, input);
  }

  function handleTeamError(result, input) {
    const code = result.data && result.data.error;
    const messages = {
      name_taken: "That team name is taken",
      already_in_team: "One team at a time",
      validation: "Team names are 3 to 24 letters, digits, spaces, hyphens or underscores",
      unknown_invite_code: "That invite code does not match a team",
      team_full: "This team is full",
    };
    if (result.status === 503 || result.status === 0) {
      outageIn("team-messages");
      return;
    }
    if (input && (code === "name_taken" || code === "validation" ||
                  code === "unknown_invite_code")) {
      const text = code === "unknown_invite_code" ? messages.unknown_invite_code :
        (code === "name_taken" ? messages.name_taken :
         (input.name === "invite_code" ? "Enter an invite code" : messages.validation));
      showFieldError(input, text);
      input.focus();
      return;
    }
    announce("team-messages", messages[code] || "That did not work. Try again.");
    if (input) input.focus();
  }

  function showFieldError(input, text) {
    const error = document.getElementById(input.id + "-error") ||
      input.closest("form").querySelector(".field-error");
    if (error) { error.textContent = text; error.hidden = false; }
    input.setAttribute("aria-invalid", "true");
  }

  async function leaveTeam() {
    const button = $("[data-confirm-leave]");
    button.disabled = true;
    announce("team-messages", "Leaving team…");
    const result = await api("/api/teams/leave", { body: {} });
    button.disabled = false;
    if (result.status === 204) {
      closeDialog();
      window.location.assign("/downtime#registration");
      return;
    }
    if (result.status === 503 || result.status === 0) outageIn("team-messages");
    else announce("team-messages", "You are no longer in this team");
  }

  let removeTarget = null;

  function openRemoveDialog(member, opener) {
    removeTarget = member;
    const dialog = openDialog("remove-member", opener);
    const text = $("[data-remove-target-text]", dialog);
    if (text) text.textContent = "Remove " + member.display_name +
      " from the team? A new invite code will be issued.";
  }

  async function confirmRemoveMember() {
    if (!removeTarget) return;
    const button = $("[data-confirm-remove]");
    button.disabled = true;
    announce("team-messages", "Removing…");
    const result = await api("/api/teams/mine/members/" + removeTarget.user_id +
      "/remove", { body: {} });
    button.disabled = false;
    if (result.status === 204) {
      closeDialog();
      announce("team-messages", removeTarget.display_name + " was removed");
      const newCode = $("[data-new-invite-code]");
      if (newCode) newCode.focus();
      loadTeamRoom();
      return;
    }
    closeDialog();
    if (result.status === 503 || result.status === 0) outageIn("team-messages");
    else if (result.data && result.data.error === "not_captain") {
      announce("team-messages", "Only the captain can do that");
    } else {
      announce("team-messages", "That player is no longer in the team");
    }
  }

  async function issueNewCode() {
    const button = $("[data-new-invite-code]");
    button.disabled = true;
    announce("team-messages", "Issuing new code…");
    const result = await api("/api/teams/mine/invite-code", { body: {} });
    button.disabled = false;
    if (result.status === 200) {
      $("[data-invite-code]").textContent = result.data.invite_code;
      announce("team-messages", "New invite code issued");
      return;
    }
    if (result.status === 503 || result.status === 0) outageIn("team-messages");
    else announce("team-messages", "Only the captain can do that");
  }

  function copyText(text, message, regionName) {
    const target = regionName || "team-messages";
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        announce(target, message);
      }).catch(function () {
        announce(target, message);
      });
    } else {
      announce(target, message);
    }
  }

  // --- the scenario page ---------------------------------------------------------------------

  async function loadScenarioState(slug) {
    const result = await api("/api/scenarios/" + encodeURIComponent(slug));
    if (!result.ok) return null;
    const data = result.data;
    const badge = $("[data-solved-badge]");
    if (badge) {
      const solved = data.team_solved;
      badge.hidden = !solved;
      if (solved && !badge.classList.contains("pop")) {
        badge.classList.add("pop");
      }
    }
    const mine = $("[data-my-state]");
    if (mine) {
      if (data.solved_by_me) {
        mine.textContent = "✓ Solved by me";
        mine.className = "my-state state-solved";
      } else if (data.team_solved) {
        mine.textContent = "✓ Solved by the team";
        mine.className = "my-state state-solved";
      } else if (data.attempted_by_me) {
        mine.textContent = "Attempted";
        mine.className = "my-state state-attempted";
      } else {
        mine.textContent = "Not attempted";
        mine.className = "my-state state-not";
      }
    }
    return data;
  }

  function initScenarioPage() {
    const main = $("[data-page=\"scenario\"]");
    if (!main) return;
    const slug = main.dataset.scenarioSlug;
    loadScenarioState(slug);
    const form = $("[data-flag-form]");
    if (form) {
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        const input = $("#flag");
        const button = $("button[type=submit]", form);
        const value = input.value;
        if (!value.trim()) {
          announce("flag-result", "Enter a flag");
          input.focus();
          return;
        }
        button.disabled = true;
        announce("flag-result", "Checking flag…");
        const result = await api("/api/scenarios/" +
          encodeURIComponent(main.dataset.scenarioSlug) + "/flag",
          { body: { flag: value } });
        button.disabled = false;
        if (result.status === 503 || result.status === 0) {
          outageIn("flag-result");
          return;
        }
        const data = result.data || {};
        if (result.status === 429) {
          announce("flag-result", "Too many wrong flags. Try again in a minute.");
          return;
        }
        if (result.status === 409 && data.error === "no_team") {
          announce("flag-result", "Join or create a team first");
          return;
        }
        if (result.status === 400) {
          announce("flag-result", "Enter a flag");
          return;
        }
        if (result.status === 404) {
          announce("flag-result", "That scenario does not exist");
          return;
        }
        if (result.ok && data.correct && data.already_completed) {
          announce("flag-result", "Already completed");
          cue(true);
          return;
        }
        if (result.ok && data.correct) {
          announce("flag-result", "Solved! +" + data.team_points_awarded +
            " for your team and +1 raffle ticket");
          cue(true);
          loadScenarioState(main.dataset.scenarioSlug);
          return;
        }
        announce("flag-result", "That flag is not right");
        input.classList.add("flag-wrong");
        input.focus();
        cue(false);
      });
    }
    const prevButton = $("[data-prev-scenario]");
    const nextButton = $("[data-next-scenario]");
    if (prevButton) prevButton.addEventListener("click", function () {
      stepScenario(prevButton, prevButton.dataset.prevSlug);
    });
    if (nextButton) nextButton.addEventListener("click", function () {
      stepScenario(nextButton, nextButton.dataset.nextSlug);
    });
  }

  async function stepScenario(button, slug) {
    if (!slug || button.disabled) return;
    const result = await api("/api/scenarios/" + encodeURIComponent(slug));
    if (!result.ok) return;
    const scenario = result.data.scenario;
    const main = $("[data-page=\"scenario\"]");
    main.dataset.scenarioSlug = scenario.slug;
    document.title = scenario.title + " — Downtime";
    $(".scenario-number").textContent = String(scenario.number).padStart(2, "0");
    $(".page-title").textContent = scenario.title;
    $(".kind-label").textContent = kindLabel(scenario.kind);
    $(".scenario-points").textContent = scenario.points + " XP";
    $(".scenario-desc").textContent = scenario.description;
    const prevButton = $("[data-prev-scenario]");
    const nextButton = $("[data-next-scenario]");
    const index = state.slugList.indexOf(scenario.slug);
    prevButton.dataset.prevSlug = index > 0 ? state.slugList[index - 1] : "";
    prevButton.disabled = index <= 0;
    nextButton.dataset.nextSlug = index < state.slugList.length - 1 ?
      state.slugList[index + 1] : "";
    nextButton.disabled = index >= state.slugList.length - 1;
    const input = $("#flag");
    if (input) { input.value = ""; input.classList.remove("flag-wrong"); }
    const badge = $("[data-solved-badge]");
    if (badge) { badge.hidden = true; badge.classList.remove("pop"); }
    announce("flag-result", "");
    window.history.pushState({ scenario: scenario.slug },
                             "", "/downtime/scenarios/" + scenario.slug);
    loadScenarioState(scenario.slug);
  }

  function kindLabel(kind) {
    return {
      "soc-sim": "SOC Sim Scenario",
      "th-sim": "Threat Hunting Sim Scenario",
      "tabletop": "Tabletop Exercise",
      "challenge": "Challenge",
    }[kind] || kind;
  }

  // --- the certificate page -------------------------------------------------------------------

  async function readCertificate() {
    const body = $("[data-certificate-body]");
    const notComplete = $("[data-not-complete]");
    if (!body || !notComplete) return;
    announce("certificate-status", "Preparing certificate…");
    const result = await api("/api/me/certificate");
    if (result.status === 503 || result.status === 0) {
      outageIn("certificate-status");
      return;
    }
    if (!result.ok) {
      body.hidden = true;
      notComplete.hidden = false;
      const room = await api("/api/teams/mine");
      let remaining = 8;
      if (room.ok) {
        const solved = room.data.scenarios.filter(function (s) {
          return s.team_solved;
        }).length;
        remaining = 8 - solved;
      }
      $("[data-remaining]").textContent = remaining === 1 ?
        "1 scenario to go" : remaining + " scenarios to go";
      announce("certificate-status", "Your team has not completed the event yet, " +
        (remaining === 1 ? "1 scenario to go" : remaining + " scenarios to go"));
      return;
    }
    const record = result.data;
    body.hidden = false;
    notComplete.hidden = true;
    $("[data-cert-name]").textContent = record.display_name;
    $("[data-cert-team]").textContent = record.team_name;
    $("[data-cert-issued]").textContent = utcText(record.issued_on);
    announce("certificate-status", "");
    const download = $("[data-download-certificate]");
    if (download) {
      download.onclick = async function () {
        const response = await fetch("/api/me/certificate/image", {
          headers: state.token ? { "Authorization": "Bearer " + state.token } : {},
        });
        if (!response.ok) {
          outageIn("certificate-status");
          return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "nightward-certificate.svg";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      };
    }
  }

  // --- the account forms ------------------------------------------------------------------------

  function initAccountPage() {
    const main = $("[data-page=\"account\"]");
    if (!main) return;
    const kind = main.dataset.accountKind;
    const cross = $("[data-cross-link]");
    if (cross) {
      const redirect = redirectParam();
      const url = new URL(cross.href, window.location.origin);
      if (redirect !== null) {
        url.searchParams.set("redirect", redirect);
      } else {
        url.searchParams.delete("redirect");
      }
      cross.href = url.pathname + (url.search || "");
    }
    const form = $("[data-account-form]");
    if (form) {
      form.addEventListener("submit", async function (event) {
        event.preventDefault();
        submitAccount(form, kind);
      });
    }
  }

  async function submitAccount(form, kind) {
    const fields = ["email", "display_name", "password"];
    const errors = {};
    const values = {};
    fields.forEach(function (name) {
      const input = form.elements[name];
      if (!input) return;
      values[name] = input.value;
      const errorNode = $("[data-field-error=\"" + name + "\"]");
      if (errorNode) { errorNode.hidden = true; }
      input.setAttribute("aria-invalid", "false");
    });
    if (!values.email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email.trim())) {
      errors.email = "Enter a valid email";
    }
    if (kind === "signup" && !values.display_name.trim()) {
      errors.display_name = "Display name must be 1 to 40 characters";
    }
    if (!values.password || values.password.length < 8) {
      errors.password = "Password must be 8 to 128 characters";
    }
    if (Object.keys(errors).length) {
      showSummary(form, errors);
      return;
    }
    const button = $("button[type=submit]", form);
    button.disabled = true;
    announce("account-messages", kind === "signup" ? "Creating account…" : "Signing in…");
    const body = kind === "signup" ?
      { email: values.email, display_name: values.display_name, password: values.password } :
      { email: values.email, password: values.password };
    const path = kind === "signup" ? "/api/auth/signup" : "/api/auth/login";
    const result = await api(path, { body: body });
    button.disabled = false;
    if (result.status === 503 || result.status === 0) {
      outageIn("account-messages");
      return;
    }
    if (result.ok && result.data && result.data.token) {
      rememberToken(result.data.token);
      followRedirect();
      return;
    }
    const code = result.data && result.data.error;
    if (code === "email_taken") {
      showSummary(form, { email: "An account with this email already exists" });
    } else if (code === "validation" && result.data.fields) {
      showSummary(form, result.data.fields);
    } else if (code === "too_many_attempts") {
      announce("account-messages", "Too many sign-in attempts. Try again later.");
    } else if (code === "invalid_credentials") {
      announce("account-messages", "Email or password is incorrect.");
    } else {
      showSummary(form, { email: "Enter a valid email" });
    }
  }

  function showSummary(form, fields) {
    const summary = $("[data-error-summary]");
    const list = $("[data-error-summary-links]");
    if (!summary || !list) return;
    list.innerHTML = "";
    Object.keys(fields).forEach(function (name) {
      const input = form.elements[name];
      const errorNode = $("[data-field-error=\"" + name + "\"]");
      if (errorNode) {
        errorNode.textContent = fields[name];
        errorNode.hidden = false;
      }
      if (input) input.setAttribute("aria-invalid", "true");
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#" + name;
      link.textContent = fields[name];
      link.addEventListener("click", function (event) {
        event.preventDefault();
        if (input) input.focus();
      });
      item.appendChild(link);
      list.appendChild(item);
    });
    summary.hidden = false;
    announce("account-messages", "Fix the highlighted fields:");
  }

  // --- effects -------------------------------------------------------------------------------------

  function reducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function initReveal() {
    const nodes = $$(".reveal");
    if (!nodes.length) return;
    if (reducedMotion() || !window.IntersectionObserver) {
      nodes.forEach(function (node) { node.classList.add("is-in"); });
      return;
    }
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry, index) {
        if (entry.isIntersecting) {
          setTimeout(function () { entry.target.classList.add("is-in"); },
                     index * 100);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    nodes.forEach(function (node) { observer.observe(node); });
  }

  function initEventBar() {
    const bar = $("#event-bar");
    const hero = $("[data-hero]");
    if (!bar || !hero) return;
    const update = function () {
      const gone = hero.getBoundingClientRect().bottom <= 0;
      bar.hidden = !gone;
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
  }

  function initBriefingFilm() {
    const film = $("[data-briefing-film]");
    const toggle = $("[data-briefing-toggle]");
    if (!film || !toggle) return;
    let wanted = true;
    const apply = function () {
      if (reducedMotion()) { film.pause(); return; }
      const onScreen = film.getBoundingClientRect().top < window.innerHeight &&
        film.getBoundingClientRect().bottom > 0;
      if (wanted && onScreen) film.play().catch(function () { /* blocked */ });
      else film.pause();
    };
    toggle.addEventListener("click", function () {
      wanted = !wanted;
      toggle.textContent = wanted ? "Pause briefing" : "Play briefing";
      toggle.setAttribute("aria-label", wanted ? "Pause briefing" : "Play briefing");
      apply();
    });
    window.addEventListener("scroll", apply, { passive: true });
    apply();
  }

  function initTrail() {
    const section = $(".scenario-trail");
    const path = $("[data-trail-path]");
    if (!section || !path) return;
    const orbs = $$(".trail-orb");
    if (reducedMotion()) {
      orbs.forEach(function (orb) { orb.classList.add("is-lit"); });
      drawTrail(1);
      return;
    }
    const update = function () {
      const rect = section.getBoundingClientRect();
      const total = rect.height - window.innerHeight * 0.5;
      const seen = Math.min(1, Math.max(0,
        (window.innerHeight * 0.75 - rect.top) / Math.max(1, total)));
      drawTrail(seen);
      orbs.forEach(function (orb) {
        const orbTop = orb.getBoundingClientRect().top;
        orb.classList.toggle("is-lit", orbTop < window.innerHeight * 0.75);
      });
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  function drawTrail(progress) {
    const path = $("[data-trail-path]");
    const wrap = $(".trail-wrap");
    if (!path || !wrap) return;
    const width = wrap.clientWidth;
    const height = wrap.scrollHeight;
    const blocks = $$(".trail-block");
    const points = ["M 24 30"];
    blocks.forEach(function (block, index) {
      const left = block.classList.contains("left");
      const bx = left ? block.offsetLeft + block.offsetWidth * 0.5 :
        block.offsetLeft + block.offsetWidth * 0.5;
      const by = block.offsetTop + 40;
      points.push("C " + (width / 2) + " " + (by - 90) + " " + bx + " " +
        (by - 40) + " " + bx + " " + by);
    });
    const full = points.join(" ");
    const length = path.getTotalLength ? path.getTotalLength() : 0;
    if (path.setAttribute) {
      path.setAttribute("d", full);
      if (length) {
        path.setAttribute("stroke-dasharray", String(length));
        path.setAttribute("stroke-dashoffset", String(length * (1 - progress)));
      }
    }
  }

  function initHeroTail() {
    const canvas = $("[data-hero-tail]");
    const hero = $("[data-hero]");
    if (!canvas || !hero) return;
    const context = canvas.getContext("2d");
    canvas.width = 240;
    canvas.height = 150;
    let pointer = { x: 0, y: 0 };
    let lean = 0;
    hero.addEventListener("pointermove", function (event) {
      const rect = canvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    });
    function frame() {
      if (!reducedMotion()) {
        const target = Math.max(-1, Math.min(1, (pointer.x - 120) / 120));
        lean += (target - lean) * 0.2;
        context.clearRect(0, 0, 240, 150);
        context.lineCap = "round";
        for (let i = 0; i < 9; i += 1) {
          const t = i / 8;
          const x = 10 + t * 200;
          const y = 130 - Math.sin(t * 2.4) * (36 + lean * 22) - t * 30;
          context.fillStyle = i % 2 === 0 ? "#e9eefb" : "#10162a";
          context.beginPath();
          context.arc(x, y, 9 - t * 3, 0, Math.PI * 2);
          context.fill();
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function initFaq() {
    $$(".faq-btn").forEach(function (button) {
      button.addEventListener("click", function () {
        const expanded = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", expanded ? "false" : "true");
        const answer = document.getElementById(button.getAttribute("aria-controls"));
        if (answer) answer.hidden = expanded;
      });
    });
  }

  function initMenu() {
    const toggle = $(".menu-toggle");
    const nav = $("#site-nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function () {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  function initSearch() {
    const search = $(".search-button");
    if (!search) return;
    search.addEventListener("click", function () {
      search.setAttribute("title", "Search is not part of this event");
      const existing = $(".search-tooltip");
      if (existing) existing.remove();
      const tip = document.createElement("span");
      tip.className = "search-tooltip";
      tip.setAttribute("role", "tooltip");
      tip.textContent = "Search is not part of this event";
      search.appendChild(tip);
      setTimeout(function () { tip.remove(); }, 2600);
    });
  }

  function initLogout() {
    $$(".logout-button").forEach(function (button) {
      button.addEventListener("click", async function () {
        await api("/api/auth/logout", { body: {} });
        forgetToken();
        window.location.assign("/downtime");
      });
    });
  }

  function initWebinar() {
    const form = $("[data-webinar-form]");
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const input = $("input", form);
      const button = $("button[type=submit]", form);
      if (!input.value.trim()) {
        announce("webinar-messages", "Enter a flag");
        return;
      }
      button.disabled = true;
      announce("webinar-messages", "Claiming…");
      const result = await api("/api/webinar/flag", { body: { flag: input.value } });
      button.disabled = false;
      if (result.status === 503 || result.status === 0) {
        outageIn("webinar-messages");
        return;
      }
      if (result.ok) {
        announce("webinar-messages", "+2 raffle tickets claimed");
        input.value = "";
        return;
      }
      const code = result.data && result.data.error;
      announce("webinar-messages", code === "already_claimed" ?
        "Already claimed" : "That flag is not right");
    });
    const copyLink = $("[data-copy-link]");
    if (copyLink) {
      copyLink.addEventListener("click", function () {
        copyText(window.location.origin + "/downtime#webinar", "Link copied",
                 "webinar-messages");
      });
    }
  }

  // --- invite links -------------------------------------------------------------------------------

  function handleJoinParam() {
    const url = new URL(window.location.href);
    const join = url.searchParams.get("join");
    if (join === null) return;
    url.searchParams.delete("join");
    window.history.replaceState({}, "", url);
    if (!/^[A-Za-z0-9]{8}$/.test(join)) return;
    const upper = join.toUpperCase();
    if (!signedIn()) {
      window.location.assign("/login?redirect=" +
        encodeURIComponent("/downtime?join=" + upper + "#registration"));
      return;
    }
    const dialog = openDialog("join-team");
    if (dialog) {
      const input = $("input", dialog);
      if (input) { input.value = upper; input.focus(); }
    }
  }

  // --- page init -----------------------------------------------------------------------------------

  async function init() {
    state.token = load(TOKEN_KEY);
    initConsent();
    initSound();
    initMenu();
    initSearch();
    initLogout();
    initTeamForms();
    initAccountPage();
    initFaq();
    initWebinar();
    initScenarioPage();
    initReveal();
    initEventBar();
    initBriefingFilm();
    initTrail();
    initHeroTail();

    const scenarioList = await api("/api/scenarios");
    if (scenarioList.ok) {
      state.scenarios = scenarioList.data.scenarios;
      state.slugList = scenarioList.data.scenarios.map(function (s) { return s.slug; });
    }

    if (state.token) {
      const result = await api("/api/me");
      if (result.ok) {
        state.user = result.data.user;
        applySession(true);
      } else {
        forgetToken();
        applySession(false);
      }
    } else {
      applySession(false);
    }

    const page = document.querySelector("[data-page]");
    if (page && page.dataset.page === "account") {
      if (state.token) {
        const result = await api("/api/me");
        if (result.ok) {
          window.history.replaceState({}, "", safeRedirect(redirectParam()));
          return;
        }
        forgetToken();
      }
    }

    if (page && page.dataset.page === "event") {
      const raw = boardPageFromAddress();
      const hadParam = new URLSearchParams(window.location.search).has("board");
      if (hadParam) {
        // A present value, valid or not, is rewritten without it: a
        // replacement that adds no history entry.
        clearBoardInAddress();
      }
      if (raw !== null && raw > 1) {
        await loadBoard(raw, { silent: false });
      } else {
        await loadBoard(1, { silent: true });
      }
      handleJoinParam();
      refreshTrailStates();
    }
    if (page && page.dataset.page === "team") {
      await loadTeamRoom();
    }
    if (page && page.dataset.page === "scenario") {
      await loadScenarioState(page.dataset.scenarioSlug);
    }
    if (page && page.dataset.page === "certificate") {
      await readCertificate();
    }
    connectStream();
  }

  window.addEventListener("popstate", function () {
    const page = document.querySelector("[data-page]");
    if (page && page.dataset.page === "event") {
      const raw = boardPageFromAddress();
      loadBoard(raw === null ? 1 : raw, { silent: true });
    }
    if (page && page.dataset.page === "scenario") {
      const slug = window.location.pathname.split("/").pop();
      if (state.slugList.indexOf(slug) !== -1) {
        stepScenarioFromHistory(slug);
      }
    }
  });

  function stepScenarioFromHistory(slug) {
    const main = $("[data-page=\"scenario\"]");
    if (!main || main.dataset.scenarioSlug === slug) return;
    const index = state.slugList.indexOf(slug);
    const prevButton = $("[data-prev-scenario]");
    const nextButton = $("[data-next-scenario]");
    main.dataset.scenarioSlug = slug;
    loadScenarioState(slug).then(function (data) {
      if (!data) return;
      const scenario = data.scenario;
      document.title = scenario.title + " — Downtime";
      $(".scenario-number").textContent = String(scenario.number).padStart(2, "0");
      $(".page-title").textContent = scenario.title;
      $(".kind-label").textContent = kindLabel(scenario.kind);
      $(".scenario-points").textContent = scenario.points + " XP";
      $(".scenario-desc").textContent = scenario.description;
      prevButton.dataset.prevSlug = index > 0 ? state.slugList[index - 1] : "";
      prevButton.disabled = index <= 0;
      nextButton.dataset.nextSlug = index < state.slugList.length - 1 ?
        state.slugList[index + 1] : "";
      nextButton.disabled = index >= state.slugList.length - 1;
      const input = $("#flag");
      if (input) { input.value = ""; input.classList.remove("flag-wrong"); }
      announce("flag-result", "");
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();

