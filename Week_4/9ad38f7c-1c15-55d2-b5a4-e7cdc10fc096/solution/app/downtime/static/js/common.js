// Shared browser code: the session, API calls, the header, consent, sound, live stream and small helpers.
import { openDialog } from "./dialog.js";

const TOKEN_KEY = "downtime.session";
const CONSENT_KEY = "downtime.consent";
export const OUTAGE = "The event server is not answering. Try again in a moment.";
export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/* Session ---------------------------------------------------------------------------------------- */

export function token() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function signedIn() {
  return token() !== null;
}

export function rememberSession(value) {
  localStorage.setItem(TOKEN_KEY, value);
  document.documentElement.setAttribute("data-session", "");
}

export function forgetSession() {
  localStorage.removeItem(TOKEN_KEY);
  document.documentElement.removeAttribute("data-session");
  $$("[data-display-name]").forEach((el) => { el.textContent = ""; });
  document.dispatchEvent(new CustomEvent("session-ended"));
}

/**
 * Call the API. Resolves to {status, data}; status 0 means the server did not answer. A 401 from a route that
 * needed the session forgets the token and shows the signed-out state.
 */
export async function api(path, { method = "GET", body } = {}) {
  const headers = {};
  const held = token();
  if (held) headers.Authorization = `Bearer ${held}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { status: 0, data: null };
  }
  const data = (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : null;
  if (response.status === 401 && held && data?.error === "unauthenticated") forgetSession();
  return { status: response.status, data };
}

/** True when the API answered with an outage (503) or not at all. */
export function isOutage(result) {
  return result.status === 0 || result.status === 503;
}

/* Formatting ------------------------------------------------------------------------------------- */

/** "23 October 2026, 07:30 UTC" whatever the browser's own time zone. */
export function utcText(iso) {
  const at = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
}

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

const STATE_CLASSES = { "Solved by me": "is-mine", "Solved by the team": "is-team", Attempted: "is-attempted" };

/** The player's state for one scenario: the first of the four words that applies. */
export function stateWord(state) {
  if (state.solved_by_me) return "Solved by me";
  if (state.team_solved) return "Solved by the team";
  if (state.attempted_by_me) return "Attempted";
  return "Not attempted";
}

/** Write a state word into `el`, with a decorative tick immediately before solved words. */
export function showState(el, word) {
  el.className = `state ${STATE_CLASSES[word] ?? ""}`.trim();
  el.replaceChildren(...(word.startsWith("Solved") ? [icon("tick"), word] : [word]));
}

function loginHref(path = window.location.pathname + window.location.search + window.location.hash) {
  return `/login?redirect=${encodeURIComponent(path)}`;
}

/* Header ------------------------------------------------------------------------------------------ */

async function showAccount() {
  $$("[data-login-link]").forEach((link) => { link.href = loginHref(); });
  if (!signedIn()) return;
  const { status, data } = await api("/api/me");
  if (status === 200) $$("[data-display-name]").forEach((el) => { el.textContent = data.user.display_name; });
}

function wireHeader() {
  $$("[data-logout]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    await api("/api/auth/logout", { method: "POST" });
    forgetSession();
    window.location.assign("/downtime");
  }));

  const menu = $("[data-menu]");
  const nav = $("#site-nav");
  const setMenu = (open) => {
    menu.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  };
  menu.addEventListener("click", () => setMenu(menu.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.getAttribute("aria-expanded") === "true") {
      setMenu(false);
      menu.focus();
    }
  });

  const search = $("[data-search]");
  search.addEventListener("click", () => search.parentElement.classList.toggle("is-open"));
  search.addEventListener("blur", () => search.parentElement.classList.remove("is-open"));
}

/* Consent ----------------------------------------------------------------------------------------- */

function wireConsent() {
  const panel = $("[data-consent]");
  const choose = (value) => {
    localStorage.setItem(CONSENT_KEY, value);
    document.documentElement.setAttribute("data-consent", value);
  };
  const keepClear = () => {
    document.documentElement.style.setProperty("--consent-space", `${panel.offsetHeight + 40}px`);
  };
  new ResizeObserver(keepClear).observe(panel);
  $("[data-allow-all]").addEventListener("click", () => choose("all"));
  const dialog = $("#cookie-dialog");
  $("[data-cookie-settings]").addEventListener("click", (event) => {
    const { close } = openDialog(dialog, event.currentTarget);
    $("[data-essential-only]", dialog).onclick = () => {
      choose("essential");
      close();
    };
  });
}

/* Sound -------------------------------------------------------------------------------------------- */

const SOUND_KEY = "downtime.sound";
const AMBIENT = "/assets/john-bartmann-breathing-down-my-neck-master-90c3b95a.ogg";
const AMBIENT_VOLUME = 0.22;
const FADE_MS = 900;
let ambient = null;
let fadeTimer = 0;
let cues = null;

export function soundOn() {
  return localStorage.getItem(SOUND_KEY) === "on";
}

function fadeTo(target, then) {
  clearInterval(fadeTimer);
  const start = ambient.volume;
  const began = performance.now();
  fadeTimer = setInterval(() => {
    const t = Math.min(1, (performance.now() - began) / FADE_MS);
    ambient.volume = start + (target - start) * t;
    if (t === 1) {
      clearInterval(fadeTimer);
      if (then) then();
    }
  }, 30);
}

function startAmbient() {
  if (!ambient) {
    ambient = new Audio(AMBIENT);
    ambient.loop = true;
    ambient.volume = 0;
  }
  ambient.play().then(() => fadeTo(AMBIENT_VOLUME), () => {});
}

function showSound(on) {
  $$("[data-sound]").forEach((button) => {
    button.setAttribute("aria-pressed", String(on));
    $("[data-sound-label]", button).textContent = on ? "Sound on" : "Sound off";
  });
}

export function wireSound(root = document) {
  $$("[data-sound]", root).forEach((button) => button.addEventListener("click", () => {
    const on = !soundOn();
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    showSound(on);
    if (on) startAmbient();
    else if (ambient) fadeTo(0, () => ambient.pause());
  }));
  showSound(soundOn());
}

function resumeSoundOnInteraction() {
  if (!soundOn()) return;
  const resume = () => {
    ["pointerdown", "keydown"].forEach((type) => window.removeEventListener(type, resume, true));
    if (soundOn()) startAmbient();
  };
  ["pointerdown", "keydown"].forEach((type) => window.addEventListener(type, resume, true));
}

/** A short synthesised cue: a rising two-note chime for a solve, a low buzz for a wrong flag. */
export function playCue(kind) {
  if (!soundOn()) return;
  cues ??= new AudioContext();
  const now = cues.currentTime;
  const notes = kind === "solved" ? [[660, 0, "triangle"], [990, 0.14, "triangle"]] : [[110, 0, "sawtooth"]];
  for (const [frequency, offset, type] of notes) {
    const oscillator = cues.createOscillator();
    const gain = cues.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + (kind === "solved" ? 0.32 : 0.26));
    oscillator.connect(gain).connect(cues.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + 0.35);
  }
}

/* Live stream ---------------------------------------------------------------------------------------- */

/**
 * Listen to /api/stream, reconnecting after any loss. `onEvent(name, data)` gets each score and team event;
 * `onState("open" | "lost")` reports the connection so views can reload or show the outage copy.
 */
export function listen(onEvent, onState) {
  let source = null;
  const connect = () => {
    source = new EventSource("/api/stream");
    source.onopen = () => onState("open");
    for (const name of ["score", "team"]) {
      source.addEventListener(name, (event) => onEvent(name, JSON.parse(event.data)));
    }
    source.onerror = () => {
      onState("lost");
      if (source.readyState === EventSource.CLOSED) setTimeout(connect, 1500);
    };
  };
  connect();
}

/* Entering content ------------------------------------------------------------------------------------ */

// Primed entrances hold at their first keyframe, the element's resting state, until they play.
const RISE = [
  { opacity: 1, transform: "none", offset: 0 },
  { opacity: 0, transform: "translateY(24px)", offset: 0.001 },
  { opacity: 1, transform: "none", offset: 1 },
];

/**
 * Rise elements into place as they first scroll into view. Each element below the fold gets its entrance
 * primed at its first frame (held at rate 0), then played when it enters; anything visible at load stays put.
 * Siblings entering together are staggered by a tenth of a second, in reading order.
 */
export function riseOnEnter() {
  if (reducedMotion.matches) return;
  const primed = new Map();
  for (const el of $$("[data-rise]")) {
    if (el.getBoundingClientRect().top < window.innerHeight) continue;
    const rise = el.animate(RISE, { duration: 420, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    rise.playbackRate = 0;
    primed.set(el, rise);
  }
  const observer = new IntersectionObserver((entries) => {
    const entering = entries.filter((entry) => entry.isIntersecting);
    const order = (entry) => [Math.round(entry.boundingClientRect.top), entry.boundingClientRect.left];
    entering.sort((a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1]);
    entering.forEach((entry, i) => {
      observer.unobserve(entry.target);
      const rise = primed.get(entry.target);
      rise.effect.updateTiming({ delay: i * 100 });
      rise.playbackRate = 1;
    });
  }, { rootMargin: "0px 0px -6% 0px" });
  primed.forEach((_, el) => observer.observe(el));
}

/** Pause endless loops inside `el` while it is off-screen. */
export function pauseOffscreen(el) {
  new IntersectionObserver(([entry]) => el.classList.toggle("is-offscreen", !entry.isIntersecting)).observe(el);
}

/* Page start ------------------------------------------------------------------------------------------- */

export function start() {
  wireHeader();
  wireConsent();
  wireSound();
  resumeSoundOnInteraction();
  showAccount();
}
