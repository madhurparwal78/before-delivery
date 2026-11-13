// The browser client, served as one script. It renders only what the server sends.

const CSS = `
@font-face {
  font-family: "Dela Gothic One";
  font-style: normal;
  font-weight: 400;
  src: url(/fonts/dela-gothic-one.woff2) format("woff2");
  font-display: swap;
}
@font-face {
  font-family: "DM Sans";
  font-style: normal;
  font-weight: 400;
  src: url(/fonts/dm-sans-400.woff2) format("woff2");
  font-display: swap;
}
@font-face {
  font-family: "DM Sans";
  font-style: normal;
  font-weight: 700;
  src: url(/fonts/dm-sans-700.woff2) format("woff2");
  font-display: swap;
}
:root {
  --ground: #16121f;
  --surface: #221a33;
  --ink: #efeaff;
  --fact: #a99fc0;
  --lime: #c7f94b;
  --violet: #4b1ec7;
  --violet-deep: #2a0f78;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--ground);
  color: var(--ink);
  font-family: "DM Sans", system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  overflow-x: hidden;
}
.visually-hidden {
  position: absolute; width: 1px; height: 1px; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
}
.topbar {
  display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
  padding: 0.75rem 1rem; background: var(--surface);
  position: sticky; top: 0; z-index: 30;
}
.brand {
  font-family: "Dela Gothic One", sans-serif; font-size: 1.25rem;
  color: var(--ink); text-decoration: none; letter-spacing: 0.02em;
}
.brand span { color: var(--lime); }
#main-nav { display: flex; gap: 1rem; margin-left: auto; }
#main-nav a, #main-nav button { color: var(--ink); }
#menu-button { display: none; }
main { padding: 0 1rem 3rem; max-width: 60rem; margin: 0 auto; }
h1 { font-family: "Dela Gothic One", sans-serif; font-size: 1.75rem; margin: 1rem 0; }
h2 { font-family: "Dela Gothic One", sans-serif; font-size: 1.4rem; margin: 1.2rem 0 0.6rem; }
a { color: var(--lime); }
.fact { color: var(--fact); }
.violet-band {
  background: var(--violet); color: #fff; padding: 0.75rem 1rem; margin: 1rem 0;
}
.empty { font-family: "Dela Gothic One", sans-serif; font-size: 1.25rem; }
.form { display: flex; flex-direction: column; gap: 0.4rem; max-width: 34ch; }
.form label { color: var(--fact); }
.form input, .form select {
  background: var(--surface); color: var(--ink); border: 1px solid var(--fact);
  padding: 0.6rem; font: inherit; border-radius: 0;
}
button {
  font: inherit; background: var(--surface); color: var(--ink);
  border: 1px solid var(--fact); padding: 0.6rem 0.9rem; min-height: 44px;
  min-width: 44px; border-radius: 0; cursor: pointer;
}
button:active { filter: brightness(0.85); }
button[disabled] { opacity: 0.5; cursor: default; }
.list { list-style: none; padding: 0; }
.list-item { padding: 0.5rem 0; }
.name { font-family: "Dela Gothic One", sans-serif; font-size: 1.4rem; color: var(--ink); }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
caption { text-align: left; font-family: "Dela Gothic One", sans-serif; padding: 0.4rem 0; }
th, td { text-align: left; padding: 0.45rem 0.6rem; }
thead th { color: var(--fact); font-weight: 500; }
tbody tr:nth-child(odd) { background: var(--ground); }
tbody tr:nth-child(even) { background: var(--surface); }
.innings-section { margin-bottom: 2rem; overflow-x: auto; }
.scoreboard {
  background: var(--surface); padding: 1rem; margin: 0.5rem 0;
  display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; align-items: baseline;
}
.scoreboard .team-name { font-family: "Dela Gothic One", sans-serif; font-size: 1.5rem; }
.scoreboard .score { font-family: "Dela Gothic One", sans-serif; font-size: clamp(3rem, 16vw, 7rem); line-height: 1; }
.scoreboard .score .slash, .scoreboard .overs { color: var(--fact); }
.scoreboard .overs { font-size: 1rem; font-family: "DM Sans", sans-serif; }
.digit { display: inline-block; }
.digit[data-ticking="true"] { color: var(--lime); }
.logo, .team-logo { height: 3rem; width: auto; }
.batters { display: flex; gap: 2rem; font-variant-numeric: tabular-nums; }
#free-hit, .free-hit {
  font-family: "Dela Gothic One", sans-serif; color: var(--lime);
  letter-spacing: 0.1em; margin: 0.4rem 0;
}
#this-over { list-style: none; display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0; }
#this-over .chip {
  background: var(--surface); border: 1px solid var(--fact);
  padding: 0.3rem 0.6rem; font-variant-numeric: tabular-nums;
}
#commentary { list-style: none; padding: 0; margin: 0; }
#commentary li { padding: 0.35rem 0.6rem; }
#commentary li[data-kind="over-end"] { background: var(--surface); font-family: "Dela Gothic One", sans-serif; margin: 0.4rem 0; }
#commentary .line { display: inline-block; }
.pad {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem;
  margin: 1rem 0;
}
.pad .key {
  min-height: 48px; min-width: 48px; font-size: 1.1rem; position: relative;
  background: var(--surface); color: var(--ink);
}
.pad .key .hint { position: absolute; top: 2px; right: 4px; font-size: 0.6rem; color: var(--fact); }
.pad .key[aria-pressed="true"] {
  outline: 3px solid var(--lime); outline-offset: 2px; color: var(--lime);
}
.pad .key[aria-pressed="true"]::after { content: " armed"; }
.pad .key.wicket, .pad .key.undo { grid-column: span 2; }
dialog {
  background: var(--surface); color: var(--ink); border: 1px solid var(--fact);
  padding: 1rem; max-width: 30rem; width: min(92vw, 30rem); border-radius: 0;
}
dialog::backdrop { background: rgba(10, 8, 16, 0.7); }
dialog h2 { margin-top: 0; }
dialog .fields { display: flex; flex-direction: column; gap: 0.5rem; }
dialog label { color: var(--fact); }
dialog input, dialog select {
  background: var(--ground); color: var(--ink); border: 1px solid var(--fact);
  padding: 0.5rem; font: inherit; border-radius: 0;
}
dialog .primary { background: var(--lime); color: var(--ground); border-color: var(--lime); font-weight: 600; }
dialog .error { color: var(--ink); background: var(--violet); padding: 0.4rem 0.6rem; }
.radios { display: flex; flex-wrap: wrap; gap: 0.6rem; }
.radios label { display: flex; gap: 0.3rem; align-items: center; color: var(--ink); }
.viewer #scoreboard { position: sticky; top: 0; z-index: 20; background: var(--surface); }
.viewer main { overflow: visible; }
.topbar { position: static; }
.viewer .topbar { position: static; }
.viewer main { padding-top: 0.5rem; }
.hero { position: relative; min-height: 100vh; overflow: hidden; }
.hero-corner {
  position: fixed; font-family: "Dela Gothic One", sans-serif; font-size: clamp(3rem, 10vw, 9rem);
  z-index: 2; color: #fff;
}
.hero-corner.over { top: 0.5rem; left: 0.5rem; }
.hero-corner.call { bottom: 0.5rem; right: 0.5rem; }
.hero-panel {
  position: absolute; top: 0; left: 0; width: 75%; height: 100%;
  background: #efeaff; color: #16121f; display: flex; flex-direction: column;
  justify-content: center; padding: 0 4rem 0 2rem; z-index: 1;
}
.hero-sentence { font-family: "Dela Gothic One", sans-serif; font-size: clamp(1.4rem, 4vw, 2.6rem); margin: 0 0 1rem; }
.hero-link { font-size: 1.2rem; color: #2a0f78; }
.hero-links { position: absolute; right: 1.5rem; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 0.7rem; }
.hero-links a { color: #2a0f78; }
.hero-pitch { position: absolute; right: 0; top: 0; width: 25%; height: 100%; }
.hero-pitch svg { width: 100%; height: 100%; display: block; }
.panels { display: flex; flex-direction: column; gap: 0.5rem; }
.panel { background: var(--surface); padding: 1.5rem 1rem; position: relative; overflow: hidden; }
.panel.violet { background: var(--violet); color: #fff; }
.panel svg { width: min(100%, 18rem); height: auto; display: block; margin: 0 auto; }
@media (max-width: 767px) {
  #main-nav { position: absolute; top: 100%; left: 0; right: 0; background: var(--surface); display: none; flex-direction: column; padding: 0.5rem 1rem; }
  #main-nav.open { display: flex; }
  #menu-button { display: block; margin-left: auto; }
  main { padding: 0 0.75rem 2rem; }
  .hero-panel { width: 100%; padding: 0 1.25rem; }
  .hero-pitch { display: none; }
  .hero-links { position: static; transform: none; flex-direction: row; flex-wrap: wrap; gap: 0.8rem; margin-top: 1rem; }
}
@media (min-width: 768px) {
  .scoring #pad-section { float: right; width: 18rem; margin-left: 1rem; }
  .pad .key { min-height: 44px; min-width: 44px; }
}
`;

const CLIENT_JS = `
"use strict";
(() => {
  const $ = (sel) => document.querySelector(sel);
  const announcer = () => document.getElementById("announcer");
  const alertBox = () => document.getElementById("alert");
  let lastAnnounced = "";
  const announce = (text) => {
    const el = announcer();
    if (!el) return;
    if (text === lastAnnounced) {
      el.textContent = "";
      requestAnimationFrame(() => { el.textContent = text; });
    } else {
      el.textContent = text;
    }
    lastAnnounced = text;
  };
  const alertMsg = (text) => {
    const el = alertBox();
    if (!el) return;
    el.textContent = text;
  };
  window.addEventListener("error", () => {});

  // Menu
  const menu = document.getElementById("menu-button");
  if (menu) {
    menu.addEventListener("click", () => {
      const nav = document.getElementById("main-nav");
      const open = nav.classList.toggle("open");
      menu.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  const body = document.body;
  const page = body.dataset.page;

  // ---- live connection ----
  const proto = location.protocol === "https:" ? "wss" : "ws";
  let socket = null;
  const connect = (onMessage, watch) => {
    try {
      socket = new WebSocket(proto + "://" + location.host + "/ws");
      socket.addEventListener("message", (event) => {
        try { onMessage(JSON.parse(event.data)); } catch {}
      });
      socket.addEventListener("close", () => { liveStatus(true); });
      socket.addEventListener("error", () => { liveStatus(true); });
      const sendWatch = () => { if (watch) socket.send(JSON.stringify(watch)); };
      if (socket.readyState === 1) sendWatch();
      socket.addEventListener("open", sendWatch);
      return socket;
    } catch { liveStatus(true); return null; }
  };
  const liveStatus = (down) => {
    const el = document.getElementById("live-status");
    if (!el) return;
    const viewerText = "Live updates are paused. Reload for the latest score.";
    const scoringText = "Live updates are paused. Scoring still saves.";
    el.textContent = down ? (page === "viewer" ? viewerText : scoringText) : "";
  };

  // ---- ball tick ----
  let config = { live_delay_ms: 3000, tick_ms: 260, tick_stagger_ms: 80 };
  let penHeld = null;
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderScoreboard = (state) => {
    const el = document.getElementById("scoreboard");
    if (!el) return;
    el.dataset.runs = String(state.runs);
    el.dataset.wickets = String(state.wickets);
    el.dataset.legalBalls = String(state.legal_balls);
    el.dataset.innings = state.innings ?? "";
    const team = el.querySelector(".team-name");
    if (team) team.textContent = state.batting_team ? state.batting_team.name : "";
    tickDigits(el, String(state.runs), String(state.wickets), state.overs_text);
  };

  const setDigits = (container, text) => {
    const current = [...container.querySelectorAll(".digit")].map((d) => d.textContent);
    const target = [...text];
    const digits = [...container.querySelectorAll(".digit")];
    if (current.length === target.length && current.every((c, i) => c === target[i])) return;
    if (digits.length === target.length) {
      digits.forEach((d, i) => { d.textContent = target[i]; });
      return;
    }
    container.innerHTML = target.map((c) => '<span class="digit">' + c + "</span>").join("");
  };

  const tickDigits = (el, runs, wickets, oversText) => {
    if (!el) return;
    const runsEl = el.querySelector(".score-runs");
    const wkEl = el.querySelector(".score-wickets");
    const oversEl = el.querySelector(".overs-value");
    if (!runsEl || !wkEl) return;
    rollSet(runsEl, runs, 0);
    rollSet(wkEl, wickets, config.tick_stagger_ms);
    if (oversEl) rollSet(oversEl, oversText, 2 * config.tick_stagger_ms);
  };

  const rollSet = (container, text, delay) => {
    const target = [...text];
    const digits = [...container.querySelectorAll(".digit")];
    if (digits.length !== target.length) {
      container.innerHTML = target.map((c) => '<span class="digit">' + c + "</span>").join("");
      return;
    }
    digits.forEach((d, i) => {
      if (d.textContent === target[i]) return;
      d.textContent = target[i];
      if (reducedMotion()) return;
      d.setAttribute("data-ticking", "true");
      const anim = d.animate(
        [
          { transform: "translateY(-100%)", opacity: 0 },
          { transform: "translateY(0)", opacity: 1 },
        ],
        { id: "ball-tick", duration: config.tick_ms, delay, fill: "forwards", easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" }
      );
      anim.addEventListener("finish", () => { d.removeAttribute("data-ticking"); });
    });
  };

  const renderState = (state, opts) => {
    const o = opts || {};
    renderScoreboard(state);
    const batters = document.getElementById("batters");
    if (batters) {
      batters.innerHTML = (state.batters || []).map((b) =>
        '<span data-player="' + b.player + '" data-on-strike="' + b.on_strike + '">' + esc(b.text) + "</span>"
      ).join("");
    }
    const bowler = document.getElementById("bowler");
    if (bowler) bowler.textContent = state.bowler ? state.bowler.text : "";
    const rr = document.getElementById("run-rate");
    if (rr) rr.textContent = state.run_rate;
    const chase = document.getElementById("chase");
    if (chase) {
      if (state.chase) { chase.hidden = false; chase.textContent = state.chase.text; }
      else { chase.hidden = true; chase.textContent = ""; }
    }
    const fh = document.getElementById("free-hit");
    if (fh) {
      if (state.free_hit) { if (fh.hidden !== undefined) fh.hidden = false; fh.textContent = "FREE HIT"; }
      else { fh.remove(); }
    }
    const over = document.getElementById("this-over");
    if (over) {
      over.innerHTML = (state.this_over || []).map((c) => '<li class="chip">' + esc(c) + "</li>").join("");
    }
    const comm = document.getElementById("commentary");
    if (comm) {
      comm.innerHTML = (state.commentary || []).map((c) => {
        const attrs = [
          'data-kind="' + c.kind + '"',
          'data-over="' + (c.over ?? "") + '"',
          c.seq !== undefined ? 'data-seq="' + c.seq + '"' : "",
          c.ball !== undefined ? 'data-ball="' + c.ball + '"' : "",
          c.label !== undefined ? 'data-label="' + esc(c.label) + '"' : "",
          c.runs !== undefined ? 'data-runs="' + c.runs + '"' : "",
          c.bat_runs !== undefined ? 'data-bat-runs="' + c.bat_runs + '"' : "",
          c.extra !== undefined ? 'data-extra="' + c.extra + '"' : "",
          c.extra_runs !== undefined ? 'data-extra-runs="' + c.extra_runs + '"' : "",
          c.wicket !== undefined ? 'data-wicket="' + c.wicket + '"' : "",
          c.free_hit !== undefined ? 'data-free-hit="' + c.free_hit + '"' : "",
          c.striker !== undefined ? 'data-striker="' + c.striker + '"' : "",
          c.bowler !== undefined ? 'data-bowler="' + c.bowler + '"' : "",
        ].filter(Boolean).join(" ");
        const change = o.changeButtons && c.kind === "delivery"
          ? '<button type="button" class="change-delivery" data-seq="' + c.seq + '">Change delivery ' + c.seq + "</button>"
          : "";
        return "<li " + attrs + '><span class="line">' + esc(c.line) + "</span>" + change + "</li>";
      }).join("");
    }
    const brk = document.getElementById("innings-break");
    if (state.innings_break) {
      let el = brk;
      if (!el) {
        el = document.createElement("section");
        el.id = "innings-break";
        const main = document.querySelector("main");
        if (main) main.insertBefore(el, main.firstChild.nextSibling);
      }
      el.innerHTML = "<h2>" + esc(state.innings_break.heading) + "</h2><p>" + esc(state.innings_break.text) + "</p>";
    } else if (brk) brk.remove();

    const result = document.getElementById("result");
    if (result) {
      if (state.result) { result.hidden = false; result.textContent = state.result; }
      else { result.hidden = true; result.textContent = ""; }
    }
    updateStartButtons(state);
    if (o.announce) announce(o.announce);
  };

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const updateStartButtons = (state) => {
    const first = document.getElementById("start-first-innings");
    const second = document.getElementById("start-second-innings");
    const so = document.getElementById("start-super-over");
    if (first) first.hidden = state.match.status !== "ready";
    if (second) second.hidden = state.match.status !== "innings_break";
    if (so) so.hidden = state.match.status !== "super_over_break";
    const canScore = ["innings_1", "innings_2", "super_over"].includes(state.match.status);
    const atBreak = ["innings_break", "super_over_break"].includes(state.match.status);
    const over = state.match.status === "result" || state.match.status === "tied";
    if (!penHeld) {
      setPadDisabled("all");
      return;
    }
    setPadDisabled(atBreak || over ? "undo-only" : state.next_bowler_needed ? "bowler" : "none");
  };

  const padMode = () => window.__padMode || "none";
  const setPadDisabled = (mode) => {
    window.__padMode = mode;
    const pad = document.getElementById("pad");
    if (!pad) return;
    pad.querySelectorAll("button").forEach((b) => {
      if (mode === "none") b.disabled = false;
      else if (mode === "undo-only") b.disabled = b.dataset.key !== "undo";
      else if (mode === "bowler") b.disabled = b.dataset.key === "undo" ? false : true;
      else b.disabled = true;
    });
    const retire = document.getElementById("retire-batter");
    if (retire) retire.disabled = mode !== "none";
    document.querySelectorAll(".change-delivery").forEach((b) => { b.disabled = mode !== "none"; });
    pad.setAttribute("aria-busy", "false");
  };

  // ---- dialogs ----
  let dialogReturnFocus = null;
  const openDialog = (dialog) => {
    dialogReturnFocus = document.activeElement === document.body ? document.querySelector('#pad button[data-key="0"]') : document.activeElement;
    if (!dialog.showModal) return;
    dialog.showModal();
    const focusables = dialog.querySelectorAll("button, input, select, [tabindex]");
    if (focusables.length > 0) focusables[0].focus();
  };
  const closeDialog = (dialog) => {
    dialog.close();
    if (dialogReturnFocus && dialogReturnFocus.focus) dialogReturnFocus.focus();
  };
  document.querySelectorAll("dialog").forEach((d) => {
    d.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeDialog(d); }
    });
    d.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const focusables = [...d.querySelectorAll("button, input, select, [href]")].filter((el) => !el.disabled);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  });

  // ---- scoring page ----
  if (page === "scoring") {
    const matchId = body.dataset.match;
    let pen = null; // this page's pen id, mirrored in penHeld for the shared render path
    let expectedSeq = 0;
    let queue = [];
    let busy = false;
    let armed = null;

    const setState = (state) => {
      window.__state = state;
      expectedSeq = (state.last_seq || 0) + 1;
      renderState(state, { changeButtons: true });
      const fh = document.getElementById("free-hit");
      if (fh && state.free_hit) fh.hidden = false;
    };

    const api = async (path, opts) => {
      const options = Object.assign({}, opts);
      options.headers = Object.assign({ "Content-Type": "application/json" }, (opts && opts.headers) || {});
      options.credentials = "same-origin";
      const res = await fetch(path, options);
      const bodyText = await res.text();
      let json = {};
      try { json = JSON.parse(bodyText); } catch {}
      if (!res.ok) {
        const errObj = json.error || { code: "INTERNAL", message: "Something went wrong. Try again." };
        const e = new Error(errObj.message);
        e.code = errObj.code;
        e.body = errObj;
        throw e;
      }
      return json;
    };

    const sendDelivery = async (payload) => {
      const pad = document.getElementById("pad");
      pad.setAttribute("aria-busy", "true");
      try {
        const state = await api("/api/matches/" + matchId + "/deliveries", {
          method: "POST",
          headers: { "X-Pen": pen || "" },
          body: JSON.stringify(Object.assign({ expected_seq: expectedSeq }, payload)),
        });
        setState(state);
        const last = state.commentary.find((c) => c.kind === "delivery");
        if (last) {
          let line = last.line + ". " + state.batting_team.name + " " + state.runs + "/" + state.wickets + ".";
          const overEnd = state.commentary.find((c) => c.kind === "over-end");
          if (overEnd) line += " " + overEnd.line + ".";
          if (state.innings_break) line += " " + state.innings_break.text;
          if (state.result) line += " " + state.result + ".";
          announce(line);
        }
      } catch (e) {
        if (e.code === "STALE_DELIVERY") {
          alertMsg("The score has moved on. Showing the latest.");
          const state = await api("/api/matches/" + matchId + "/state");
          setState(state);
        } else if (e.code === "PEN_HELD") {
          alertMsg(e.message);
          showPen(null, e.body && e.body.holder);
        } else if (e.code) {
          alertMsg(e.message);
          const state = await api("/api/matches/" + matchId + "/state");
          setState(state);
        } else {
          alertMsg("That ball was not saved. Check your connection and try again.");
        }
      } finally {
        pad.setAttribute("aria-busy", "false");
        busy = false;
        flushQueue();
      }
    };

    const flushQueue = () => {
      if (busy || queue.length === 0) return;
      const next = queue.shift();
      busy = true;
      void sendDelivery(next);
    };

    const arm = (kind) => {
      if (armed === kind) { armed = null; }
      else { armed = kind; }
      document.querySelectorAll("#pad .extra").forEach((b) => {
        b.setAttribute("aria-pressed", armed === b.dataset.key ? "true" : "false");
      });
    };

    const record = (key) => {
      const state = window.__state;
      if (!state) return;
      if (state.next_bowler_needed) {
        alertMsg("Choose the next bowler first.");
        openNextBowler();
        return;
      }
      if (padMode() === "undo-only") {
        if (state.match.status === "result" || state.match.status === "tied") alertMsg("This match is over.");
        else alertMsg("This innings is over.");
        return;
      }
      const extraValue = armed === "wide" ? "wide" : armed === "no-ball" ? "no-ball" : armed === "bye" ? "bye" : armed === "leg-bye" ? "leg-bye" : "none";
      const runs = Number(key);
      if ((extraValue === "bye" || extraValue === "leg-bye") && runs < 1) {
        alertMsg("Byes need at least 1 run.");
        return;
      }
      queue.push({ extra: extraValue, runs, wicket: null });
      armed = null;
      document.querySelectorAll("#pad .extra").forEach((b) => b.setAttribute("aria-pressed", "false"));
      if (!busy) flushQueue();
    };

    document.addEventListener("keydown", (e) => {
      if (document.querySelector("dialog[open]")) return;
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
      const key = e.key.toLowerCase();
      const state = window.__state;
      if (!state) return;
      if (!pen) return;
      if (/^[0-6]$/.test(key)) { record(key); return; }
      if (key === "d") { arm("wide"); return; }
      if (key === "n") { arm("no-ball"); return; }
      if (key === "b") { arm("bye"); return; }
      if (key === "l") { arm("leg-bye"); return; }
      if (key === "w") {
        if (state.next_bowler_needed) { alertMsg("Choose the next bowler first."); openNextBowler(); return; }
        openWicket();
        return;
      }
      if (key === "u") { void undo(); return; }
      if (key === "r") { openRetire(); return; }
      if (key === "escape") {
        if (armed) {
          armed = null;
          document.querySelectorAll("#pad .extra").forEach((b) => b.setAttribute("aria-pressed", "false"));
        }
      }
    });

    document.querySelectorAll("#pad .key").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!pen) return;
        const key = btn.dataset.key;
        if (key === "undo") { void undo(); return; }
        if (key === "wicket") {
          const state = window.__state;
          if (state && state.next_bowler_needed) { alertMsg("Choose the next bowler first."); openNextBowler(); return; }
          openWicket();
          return;
        }
        if (["wide", "no-ball", "bye", "leg-bye"].includes(key)) { arm(key); return; }
        record(key);
      });
    });

    const undo = async () => {
      const btn = document.querySelector('#pad button[data-key="undo"]');
      btn.disabled = true;
      try {
        const state = await api("/api/matches/" + matchId + "/deliveries/last", {
          method: "DELETE",
          headers: { "X-Pen": pen || "" },
        });
        setState(state);
        announce("Undid delivery " + (state.last_seq + 1) + ".");
      } catch (e) {
        alertMsg(e.message || "Nothing to undo in this innings.");
      } finally {
        btn.disabled = false;
      }
    };

    const retireBtn = document.getElementById("retire-batter");
    if (retireBtn) retireBtn.addEventListener("click", () => { if (pen) openRetire(); });

    const startInnings = async (strikers) => {
      try {
        const state = await api("/api/matches/" + matchId + "/innings", {
          method: "POST",
          headers: { "X-Pen": pen || "" },
          body: JSON.stringify(strikers),
        });
        setState(state);
        announce("Start innings");
      } catch (e) { alertMsg(e.message); }
    };

    const nextBowlerDialog = () => {
      const d = document.createElement("dialog");
      d.id = "next-bowler-dialog";
      document.body.appendChild(d);
      return d;
    };

    function openNextBowler() {
      const state = window.__state;
      let d = document.getElementById("next-bowler-dialog");
      if (!d) d = nextBowlerDialog();
      const bowlingTeam = state.bowling_team;
      const options = (window.__bowlers && window.__bowlers[bowlingTeam.id]) || [];
      const barred = {};
      (state.barred_bowlers || []).forEach((b) => { barred[b.player] = b.reason; });
      d.innerHTML = '<form method="dialog" id="next-bowler-form"><h2>Next bowler</h2>' +
        '<label for="next-bowler-select">Bowler</label>' +
        '<select id="next-bowler-select" name="bowler">' +
        options.map((p) => '<option value="' + p.id + '" data-barred="' + (barred[p.id] || "none") + '">' + esc(p.short_name) + "</option>").join("") +
        "</select>" +
        '<p class="error" id="next-bowler-error" hidden></p>' +
        '<button type="submit" class="primary">Start over</button></form>';
      openDialog(d);
      const select = d.querySelector("select");
      if (select) select.focus();
      d.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const errEl = d.querySelector(".error");
        try {
          const state2 = await api("/api/matches/" + matchId + "/overs", {
            method: "POST",
            headers: { "X-Pen": pen || "" },
            body: JSON.stringify({ bowler: select.value }),
          });
          setState(state2);
          closeDialog(d);
          announce("Start over");
        } catch (err) {
          errEl.hidden = false;
          errEl.textContent = err.message;
          alertMsg(err.message);
        }
      });
    }
    const wicketDialog = () => {
      const d = document.createElement("dialog");
      d.id = "wicket-dialog";
      document.body.appendChild(d);
      return d;
    };

    function openWicket() {
      const state = window.__state;
      let d = document.getElementById("wicket-dialog");
      if (!d) d = wicketDialog();
      const armedExtra = armed;
      const freeHit = state.free_hit;
      const kinds = [
        ["Bowled", "bowled"], ["Caught", "caught"], ["LBW", "lbw"],
        ["Stumped", "stumped"], ["Hit wicket", "hit-wicket"], ["Run out", "run-out"],
      ];
      const allowed = freeHit ? ["run-out"]
        : armedExtra === "wide" ? ["stumped", "run-out"]
        : armedExtra === "none" ? ["bowled", "caught", "lbw", "stumped", "hit-wicket", "run-out"]
        : ["run-out"];
      const fielders = (window.__bowlers && window.__bowlers[state.bowling_team.id]) || [];
      const batters = state.batters || [];
      const waiting = (state.yet_to_bat || []);
      d.innerHTML = '<form id="wicket-form" method="dialog"><h2>Wicket</h2>' +
        (freeHit ? '<p class="error">Free hit: only a run out can dismiss a batter.</p>' : "") +
        '<fieldset><legend>How out</legend><div class="radios" role="radiogroup" aria-label="How out">' +
        kinds.map(([label, value]) =>
          '<label><input type="radio" name="kind" value="' + value + '"' + (allowed.includes(value) ? "" : " disabled") + (value === allowed[0] ? " checked" : "") + "> " + label + "</label>"
        ).join("") + "</div></fieldset>" +
        '<label for="wicket-fielder">Fielder</label><select id="wicket-fielder">' +
        fielders.map((p) => '<option value="' + p.id + '">' + esc(p.short_name) + "</option>").join("") + "</select>" +
        '<label for="wicket-batter-out">Batter out</label><select id="wicket-batter-out">' +
        '<option value="striker">' + esc(batters[0] ? batters[0].short_name : "Striker") + "</option>" +
        '<option value="non-striker">' + esc(batters[1] ? batters[1].short_name : "Non-striker") + "</option></select>" +
        '<label for="wicket-runs">Runs completed</label><select id="wicket-runs">' +
        [0, 1, 2, 3].map((r) => '<option value="' + r + '">' + r + "</option>").join("") + "</select>" +
        '<label for="wicket-new-batter">New batter</label><select id="wicket-new-batter">' +
        waiting.map((p) => '<option value="' + p.player + '">' + esc(p.short_name) + (p.retired_hurt ? " (retired hurt)" : "") + "</option>").join("") + "</select>" +
        '<p class="error" id="wicket-error" hidden></p>' +
        '<button type="submit" class="primary">Record wicket</button></form>';
      openDialog(d);
      const firstRadio = d.querySelector('input[name="kind"]:not([disabled])');
      if (firstRadio) firstRadio.focus();
      const form = d.querySelector("form");
      const updateFields = () => {
        const kind = d.querySelector('input[name="kind"]:checked').value;
        d.querySelector('#wicket-fielder').parentElement.hidden = !["caught", "stumped", "run-out"].includes(kind);
        d.querySelector('#wicket-batter-out').parentElement.hidden = kind !== "run-out";
        d.querySelector('#wicket-runs').parentElement.hidden = kind !== "run-out";
      };
      d.querySelectorAll('input[name="kind"]').forEach((r) => r.addEventListener("change", updateFields));
      updateFields();
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const kind = d.querySelector('input[name="kind"]:checked').value;
        const runs = Number(d.querySelector("#wicket-runs").value);
        const extraValue = armedExtra === "wide" ? "wide" : armedExtra === "no-ball" ? "no-ball" : armedExtra === "bye" ? "bye" : armedExtra === "leg-bye" ? "leg-bye" : "none";
        const payload = {
          extra: extraValue,
          runs: kind === "run-out" ? runs : 0,
          wicket: {
            kind,
            fielder: ["caught", "stumped", "run-out"].includes(kind) ? d.querySelector("#wicket-fielder").value : null,
            batter_out: kind === "run-out" ? d.querySelector("#wicket-batter-out").value : "striker",
            new_batter: d.querySelector("#wicket-new-batter").value || null,
          },
        };
        queue.push(payload);
        closeDialog(d);
        if (!busy) flushQueue();
      });
    }
    function openRetire() {
      const state = window.__state;
      let d = document.getElementById("retire-dialog");
      if (!d) {
        d = document.createElement("dialog");
        d.id = "retire-dialog";
        document.body.appendChild(d);
      }
      const batters = state.batters || [];
      const waiting = state.yet_to_bat || [];
      d.innerHTML = '<form id="retire-form" method="dialog"><h2>Retire batter</h2>' +
        '<fieldset><legend>Batter</legend><div class="radios" role="radiogroup" aria-label="Batter">' +
        batters.map((b, i) => '<label><input type="radio" name="batter" value="' + b.player + '"' + (i === 0 ? " checked" : "") + "> " + esc(b.short_name) + "</label>").join("") +
        "</div></fieldset>" +
        '<label for="retire-new-batter">New batter</label><select id="retire-new-batter">' +
        waiting.map((p) => '<option value="' + p.player + '">' + esc(p.short_name) + (p.retired_hurt ? " (retired hurt)" : "") + "</option>").join("") + "</select>" +
        '<p class="error" id="retire-error" hidden></p>' +
        '<button type="submit" class="primary">Retire</button></form>';
      openDialog(d);
      const firstRadio = d.querySelector('input[name="batter"]');
      if (firstRadio) firstRadio.focus();
      d.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const state2 = await api("/api/matches/" + matchId + "/retirements", {
            method: "POST",
            headers: { "X-Pen": pen || "" },
            body: JSON.stringify({
              batter: d.querySelector('input[name="batter"]:checked').value,
              new_batter: d.querySelector("#retire-new-batter").value,
            }),
          });
          setState(state2);
          closeDialog(d);
          const last = state2.commentary.find((c) => c.kind === "retirement");
          if (last) announce(last.line + ". " + state2.batting_team.name + " " + state2.runs + "/" + state2.wickets + ".");
        } catch (err) {
          const errEl = d.querySelector(".error");
          errEl.hidden = false;
          errEl.textContent = err.message;
          alertMsg(err.message);
        }
      });
    }

    document.addEventListener("click", async (e) => {
      const btn = e.target.closest(".change-delivery");
      if (!btn) return;
      const seq = btn.dataset.seq;
      const state = window.__state;
      let d = document.getElementById("change-dialog");
      if (!d) {
        d = document.createElement("dialog");
        d.id = "change-dialog";
        document.body.appendChild(d);
      }
      const item = state.commentary.find((c) => c.kind === "delivery" && String(c.seq) === String(seq));
      const currentExtra = item ? item.extra : "none";
      const currentRuns = item ? item.bat_runs : 0;
      let chosen = { extra: currentExtra, runs: currentExtra === "none" || currentExtra === "no-ball" ? currentRuns : (item ? item.runs - (currentExtra === "wide" || currentExtra === "no-ball" ? 1 : 0) : 0) };
      const previewOf = (choice) => {
        if (choice.extra === "none") return choice.runs === 0 ? "no run" : choice.runs === 4 ? "FOUR" : choice.runs === 6 ? "SIX" : choice.runs + " runs";
        if (choice.extra === "wide") return (1 + choice.runs) + " " + (choice.runs === 0 ? "wide" : "wides");
        if (choice.extra === "no-ball") return "no-ball, " + (choice.runs === 0 ? "no run" : choice.runs === 4 ? "FOUR" : choice.runs === 6 ? "SIX" : choice.runs + " runs");
        if (choice.extra === "bye") return choice.runs + (choice.runs === 1 ? " bye" : " byes");
        return choice.runs + (choice.runs === 1 ? " leg bye" : " leg byes");
      };
      const render = () => {
        d.innerHTML = '<form id="change-form" method="dialog"><h2>Change delivery ' + seq + '</h2>' +
          '<div role="group" aria-label="Change pad" id="change-pad" class="pad">' +
          [0,1,2,3,4,5,6].map((r) => '<button type="button" class="key" data-runs="' + r + '">' + r + "</button>").join("") +
          '<button type="button" class="key" data-extra="wide">Wide</button>' +
          '<button type="button" class="key" data-extra="no-ball">No-ball</button>' +
          '<button type="button" class="key" data-extra="bye">Bye</button>' +
          '<button type="button" class="key" data-extra="leg-bye">Leg bye</button>' +
          "</div>" +
          '<p id="change-preview">New: ' + esc(previewOf(chosen)) + "</p>" +
          '<p class="error" id="change-error" hidden></p>' +
          '<button type="submit" class="primary">Save change</button></form>';
        d.querySelectorAll("#change-pad .key").forEach((b) => {
          b.addEventListener("click", () => {
            if (b.dataset.runs !== undefined) chosen.runs = Number(b.dataset.runs);
            if (b.dataset.extra) chosen.extra = b.dataset.extra;
            d.querySelector("#change-preview").textContent = "New: " + previewOf(chosen);
          });
        });
        d.querySelector("form").addEventListener("submit", async (ev) => {
          ev.preventDefault();
          try {
            const state2 = await api("/api/matches/" + matchId + "/deliveries/" + seq, {
              method: "PUT",
              headers: { "X-Pen": pen || "" },
              body: JSON.stringify({ extra: chosen.extra, runs: chosen.runs }),
            });
            setState(state2);
            closeDialog(d);
            announce("Delivery " + seq + " changed. Innings recalculated.");
          } catch (err) {
            const errEl = d.querySelector(".error");
            errEl.hidden = false;
            errEl.textContent = err.message;
            alertMsg(err.message);
          }
        });
      };
      render();
      openDialog(d);
    });

    const showPen = (penId, holder) => {
      const el = document.getElementById("pen-notice");
      if (!el) return;
      if (penId) {
        pen = penId;
        penHeld = penId;
        el.textContent = "";
        setPadDisabled(window.__state && ["innings_1", "innings_2", "super_over"].includes(window.__state.match.status) ? (window.__state.next_bowler_needed ? "bowler" : "none") : "undo-only");
      } else {
        pen = null;
        penHeld = null;
        el.textContent = holder ? holder + " is scoring this match. You are viewing it read-only." : "No one is scoring this match.";
        setPadDisabled("all");
        const take = document.getElementById("take-pen");
        if (!take) {
          const btn = document.createElement("button");
          btn.id = "take-pen";
          btn.type = "button";
          btn.textContent = "Take the pen";
          btn.addEventListener("click", async () => {
            if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "take-pen", match: matchId }));
          });
          el.after(btn);
        }
      }
    };
    window.__takePen = showPen;

    // Load state, XI lists and the pen.
    const boot = async () => {
      setPadDisabled("all");
      const [state, match] = await Promise.all([
        api("/api/matches/" + matchId + "/state"),
        api("/api/matches/" + matchId),
      ]);
      const bowlers = {};
      const teams = [match.home, match.away];
      for (const t of teams) {
        try {
          const team = await api("/api/teams/" + t.id);
          bowlers[t.id] = team.players;
        } catch { bowlers[t.id] = []; }
      }
      window.__bowlers = bowlers;
      setState(state);
      connect((msg) => {
        if (msg.type === "state") { setState(msg.state); }
        else if (msg.type === "pen") { showPen(msg.pen, msg.holder); }
        else if (msg.type === "live" && msg.status === "paused") { liveStatus(true); }
      }, { type: "score", match: matchId });
    };
    void boot();

    const startButtons = [["start-first-innings", "first"], ["start-second-innings", "second"], ["start-super-over", "super"]];
    startButtons.forEach(([id]) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener("click", () => {
        const state = window.__state;
        const battingTeam = state.batting_team;
        const bowlingTeam = state.bowling_team;
        const battingPlayers = (window.__bowlers && window.__bowlers[battingTeam.id]) || [];
        const bowlingPlayers = (window.__bowlers && window.__bowlers[bowlingTeam.id]) || [];
        let d = document.getElementById("start-innings-dialog");
        if (!d) {
          d = document.createElement("dialog");
          d.id = "start-innings-dialog";
          document.body.appendChild(d);
        }
        d.innerHTML = '<form id="start-innings-form" method="dialog"><h2>Start innings</h2>' +
          '<label for="si-striker">Striker</label><select id="si-striker">' +
          battingPlayers.map((p, i) => '<option value="' + p.id + '"' + (i === 0 ? " selected" : "") + ">" + esc(p.short_name) + "</option>").join("") + "</select>" +
          '<label for="si-non-striker">Non-striker</label><select id="si-non-striker">' +
          battingPlayers.map((p, i) => '<option value="' + p.id + '"' + (i === 1 ? " selected" : "") + ">" + esc(p.short_name) + "</option>").join("") + "</select>" +
          '<label for="si-bowler">Bowler</label><select id="si-bowler">' +
          bowlingPlayers.map((p) => '<option value="' + p.id + '">' + esc(p.short_name) + "</option>").join("") + "</select>" +
          '<p class="error" id="si-error" hidden></p>' +
          '<button type="submit" class="primary">Start innings</button></form>';
        openDialog(d);
        d.querySelector("#si-striker").focus();
        d.querySelector("form").addEventListener("submit", async (e) => {
          e.preventDefault();
          try {
            const state2 = await api("/api/matches/" + matchId + "/innings", {
              method: "POST",
              headers: { "X-Pen": pen || "" },
              body: JSON.stringify({
                striker: d.querySelector("#si-striker").value,
                non_striker: d.querySelector("#si-non-striker").value,
                bowler: d.querySelector("#si-bowler").value,
              }),
            });
            setState(state2);
            closeDialog(d);
            announce("Start innings");
          } catch (err) {
            const errEl = d.querySelector(".error");
            errEl.hidden = false;
            errEl.textContent = err.message;
            alertMsg(err.message);
          }
        });
      });
    });
  }

  // ---- viewer page ----
  if (page === "viewer") {
    const code = body.dataset.code;
    let pending = [];
    let applied = false;
    const delay = () => config.live_delay_ms;
    fetch("/api/config").then((r) => r.json()).then((cfg) => { config = cfg; }).catch(() => {});

    const apply = (state, event) => {
      renderState(state, { announce: null });
      if (event && (event.kind === "change" || event.kind === "undo")) {
        const notice = document.getElementById("notice");
        const text = event.kind === "change"
          ? "The scorer changed delivery " + event.seq + "."
          : "The scorer undid delivery " + event.seq + ".";
        notice.textContent = text;
        announce(text);
      }
      const last = state.commentary[0];
      if (last && event && event.kind === "delivery") {
        let line = last.line + ". " + state.batting_team.name + " " + state.runs + "/" + state.wickets + ".";
        const overEnd = state.commentary.find((c) => c.kind === "over-end");
        if (overEnd) line += " " + overEnd.line + ".";
        if (state.innings_break) line += " " + state.innings_break.text;
        if (state.result) line += " " + state.result + ".";
        announce(line);
      }
    };

    const schedule = () => {
      if (applied || pending.length === 0) return;
      applied = true;
      const next = pending.shift();
      setTimeout(() => {
        apply(next.state, next.event);
        applied = false;
        schedule();
      }, delay());
    };

    connect((msg) => {
      if (msg.type === "state") {
        if (msg.event === null || msg.event === undefined) { apply(msg.state, null); return; }
        pending.push({ state: msg.state, event: msg.event });
        schedule();
      } else if (msg.type === "link-off") {
        const el = document.getElementById("live-status");
        if (el) el.textContent = "This match is no longer shared.";
      } else if (msg.type === "live" && msg.status === "paused") {
        liveStatus(true);
      }
    }, { type: "watch", code: code });
  }

  // ---- tournament page ----
  const tables = document.getElementById("tournament-tables");
  if (tables) {
    const tournamentId = tables.dataset.tournament;
    connect((msg) => {
      if (msg.type === "table" && msg.tournament === tournamentId) {
        const groups = msg.groups || [];
        tables.innerHTML = groups.map((g) =>
          '<section class="group" data-group="' + esc(g.name) + '">' +
          '<table class="points"><caption>' + esc(g.name) + "</caption>" +
          "<thead><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>T</th><th>Pts</th><th>NRR</th></tr></thead><tbody>" +
          g.table.map((r) => "<tr><td>" + esc(r.team.name) + "</td><td>" + r.p + "</td><td>" + r.w + "</td><td>" + r.l + "</td><td>" + r.t + "</td><td>" + r.pts + "</td><td>" + esc(r.nrr) + "</td></tr>").join("") +
          "</tbody></table></section>"
        ).join("");
        announce("Points table updated.");
      }
    }, { type: "watch", tournament: tournamentId });
    if (socket) {
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "watch", tournament: tournamentId }));
      });
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "watch", tournament: tournamentId }));
    }
  }

  // ---- forms ----
  const form = (id, handler) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("submit", async (e) => {
      e.preventDefault();
      await handler(el);
    });
  };

  form("signin-form", async (el) => {
    const res = await fetch("/api/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: el.email.value, password: el.password.value }),
    });
    if (res.ok) { location.href = "/matches"; return; }
    const json = await res.json().catch(() => ({}));
    alertMsg(json.error && json.error.fields && json.error.fields.email ? json.error.fields.email : "Email or password is wrong.");
  });

  form("signup-form", async (el) => {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: el.email.value, password: el.password.value, display_name: el.display_name.value }),
    });
    if (res.ok) { location.href = "/matches"; return; }
    const json = await res.json().catch(() => ({}));
    alertMsg("Check the highlighted fields.");
  });

  form("follow-form", async (el) => {
    const code = el.querySelector("#viewer-code").value.trim();
    if (!code) return;
    const res = await fetch("/api/live/" + encodeURIComponent(code) + "/state");
    if (res.ok) { location.href = "/live/" + encodeURIComponent(code); return; }
    alertMsg("Not found.");
  });

  form("invite-form", async (el) => {
    const email = el.querySelector("#scorer-email").value.trim();
    const status = document.getElementById("invite-status");
    const btn = el.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const res = await fetch("/api/matches/" + location.pathname.split("/")[2] + "/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (res.ok) {
        status.textContent = json.message;
        announce(json.message);
      } else if (res.status === 503) {
        alertMsg("The invitation could not be sent. Try again later.");
      } else {
        status.textContent = "Enter a valid email address.";
      }
    } finally {
      btn.disabled = false;
    }
  });

  const viewerLink = document.getElementById("viewer-link");
  if (viewerLink) {
    viewerLink.addEventListener("change", async () => {
      const matchId = location.pathname.split("/")[2];
      const res = await fetch("/api/matches/" + matchId + "/viewer-link", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: viewerLink.checked }),
      });
      const json = await res.json();
      const url = document.getElementById("viewer-url");
      if (json.viewer_link) url.innerHTML = '<a href="/live/' + json.viewer_code + '">/live/' + json.viewer_code + "</a>";
      else url.textContent = "";
    });
  }

  form("logo-form", async (el) => {
    const input = el.querySelector("#team-logo");
    const status = document.getElementById("logo-status");
    const btn = el.querySelector("button[type=submit]");
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > (window.__logoMaxBytes || 1048576)) {
      status.textContent = "Logo must be " + (window.__logoMaxBytes || 1048576).toLocaleString("en-US") + " bytes or smaller.";
      return;
    }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50;
    const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpeg) { status.textContent = "Logo must be a PNG or JPEG image."; return; }
    btn.disabled = true;
    status.textContent = "Uploading logo";
    const fd = new FormData();
    fd.append("logo", file);
    try {
      const res = await fetch(location.pathname + "/logo", { method: "POST", body: fd });
      if (res.ok) {
        const json = await res.json();
        const img = document.querySelector(".team-logo");
        if (img) { img.src = json.logo_url + "?t=" + Date.now(); }
        else {
          const el2 = document.createElement("img");
          el2.className = "team-logo";
          el2.alt = "logo";
          el2.src = json.logo_url + "?t=" + Date.now();
          document.querySelector("main").insertBefore(el2, el);
        }
        status.textContent = "";
        announce("Logo updated.");
      } else {
        status.textContent = "Logo storage is unavailable. The team keeps its previous logo.";
        alertMsg("Logo storage is unavailable. The team keeps its previous logo.");
      }
    } finally {
      btn.disabled = false;
    }
  });

  form("new-team-form", async (el) => {
    const players = [];
    el.querySelectorAll("#player-rows .player-row").forEach((row) => {
      const name = row.querySelector(".player-name").value.trim();
      const short = row.querySelector(".player-short").value.trim();
      if (name) players.push({ name, short_name: short || undefined });
    });
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: el.querySelector("#team-name").value, players }),
    });
    if (res.ok) { const json = await res.json(); location.href = "/teams/" + json.id; return; }
    alertMsg("Check the highlighted fields.");
  });

  const addPlayerBtn = document.getElementById("add-player");
  if (addPlayerBtn) {
    const rows = document.getElementById("player-rows");
    const addRow = () => {
      const row = document.createElement("div");
      row.className = "player-row";
      row.innerHTML = '<label>Player full name <input type="text" class="player-name"></label>' +
        '<label>Player short name <input type="text" class="player-short"></label>';
      row.querySelector(".player-name").addEventListener("input", (e) => {
        const parts = e.target.value.trim().split(/\\s+/);
        row.querySelector(".player-short").value = parts[parts.length - 1] || "";
      });
      rows.appendChild(row);
    };
    addPlayerBtn.addEventListener("click", addRow);
    addRow();
  }

  const newMatchForm = document.getElementById("new-match-form");
  if (newMatchForm) {
    const loadXi = async () => {
      const homeId = newMatchForm.querySelector("#home-team").value;
      const awayId = newMatchForm.querySelector("#away-team").value;
      const xiFields = newMatchForm.querySelector("#xi-fields");
      xiFields.innerHTML = "";
      for (const [teamId, label] of [[homeId, "Home"], [awayId, "Away"]]) {
        const res = await fetch("/api/teams/" + teamId);
        if (!res.ok) continue;
        const team = await res.json();
        const wrap = document.createElement("div");
        wrap.innerHTML = "<h2>" + esc(label) + "</h2>" + team.players.map((p) =>
          '<label><input type="checkbox" name="xi" value="' + p.id + '" data-team="' + teamId + '"> ' + esc(team.name) + ": " + esc(p.name) + "</label>"
        ).join("");
        xiFields.appendChild(wrap);
      }
    };
    newMatchForm.querySelector("#home-team").addEventListener("change", loadXi);
    newMatchForm.querySelector("#away-team").addEventListener("change", loadXi);
    newMatchForm.querySelector("#tournament").addEventListener("change", async () => {
      const t = newMatchForm.querySelector("#tournament").value;
      if (!t) return;
      const res = await fetch("/api/tournaments/" + t);
      if (!res.ok) return;
      const json = await res.json();
      newMatchForm.querySelector("#overs").value = json.overs;
      newMatchForm.querySelector("#overs").readOnly = true;
      newMatchForm.querySelector("#players-per-side").value = json.players_per_side;
      newMatchForm.querySelector("#players-per-side").readOnly = true;
      newMatchForm.querySelector("#super-over").checked = json.super_over;
    });
    void loadXi();
    newMatchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const xi = {};
      newMatchForm.querySelectorAll('input[name="xi"]:checked').forEach((c) => {
        const team = c.dataset.team;
        if (!xi[team]) xi[team] = [];
        xi[team].push(c.value);
      });
      const payload = {
        home: newMatchForm.querySelector("#home-team").value,
        away: newMatchForm.querySelector("#away-team").value,
        overs: Number(newMatchForm.querySelector("#overs").value),
        players_per_side: Number(newMatchForm.querySelector("#players-per-side").value),
        super_over: newMatchForm.querySelector("#super-over").checked,
        batting_first: newMatchForm.querySelector("#batting-first").value,
        tournament: newMatchForm.querySelector("#tournament").value || null,
        xi,
      };
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) { const json = await res.json(); location.href = "/matches/" + json.id; return; }
      alertMsg("Check the highlighted fields.");
    });
  }

  const newTournamentForm = document.getElementById("new-tournament-form");
  if (newTournamentForm) {
    let groups = [];
    const addGroup = document.getElementById("add-group");
    addGroup.addEventListener("click", () => {
      const name = newTournamentForm.querySelector("#group-name").value.trim() || "Group";
      const teams = [...newTournamentForm.querySelectorAll('input[name="team"]:checked')].map((c) => c.value);
      groups.push({ name, teams });
      newTournamentForm.querySelectorAll('input[name="team"]').forEach((c) => { c.checked = false; });
      newTournamentForm.querySelector("#group-name").value = "";
    });
    newTournamentForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        name: newTournamentForm.querySelector("#tournament-name").value,
        overs: Number(newTournamentForm.querySelector("#overs").value),
        players_per_side: Number(newTournamentForm.querySelector("#players-per-side").value),
        super_over: newTournamentForm.querySelector("#super-over").checked,
        groups,
      };
      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) { const json = await res.json(); location.href = "/tournaments/" + json.id; return; }
      alertMsg("Check the highlighted fields.");
    });
  }

  const acceptForm = document.getElementById("accept-form");
  if (acceptForm) {
    acceptForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const token = body.dataset.invite;
      const res = await fetch("/api/invitations/" + token + "/accept", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { location.href = "/matches/" + json.match_id + "/score"; return; }
      const status = document.getElementById("accept-status");
      if (status) status.textContent = json.error ? json.error.message : "Not found.";
    });
  }

  const signOut = document.getElementById("sign-out");
  if (signOut) {
    signOut.addEventListener("click", async () => {
      await fetch("/api/auth/signout", { method: "POST" });
      location.href = "/";
    });
  }
})();
`;

export const clientAssets = { css: CSS, js: CLIENT_JS };
