/* Shared browser behaviour: session, chrome, dialogs, sound, consent, stream. */

const TOKEN_KEY = "downtime.token";
const CONSENT_KEY = "downtime.consent";
const SOUND_KEY = "downtime.sound";

export const OUTAGE_COPY =
  "The event server is not answering. Try again in a moment.";
export const SOUNDTRACK =
  "/assets/john-bartmann-breathing-down-my-neck-master-90c3b95a.ogg";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/* -- storage ---------------------------------------------------------- */
export function token() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (error) {
    return null;
  }
}

export function keepToken(value) {
  try {
    localStorage.setItem(TOKEN_KEY, value);
  } catch (error) {
    /* storage is unavailable; the session lasts for this page only */
  }
}

export function forgetToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (error) {
    /* nothing to forget */
  }
}

/* -- the API ---------------------------------------------------------- */
export async function api(method, path, body) {
  const headers = {};
  const carried = token();
  if (carried) headers.Authorization = `Bearer ${carried}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    return { status: 0, data: null, outage: true };
  }
  let data = null;
  if ((response.headers.get("Content-Type") || "").includes("application/json")) {
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
  }
  if (response.status === 401 && carried) {
    forgetToken();
    applySession(null);
  }
  return {
    status: response.status,
    data,
    outage: response.status === 503,
    retryAfter: response.headers.get("Retry-After"),
  };
}

/* -- session ---------------------------------------------------------- */
let currentSession = null;

export function session() {
  return currentSession;
}

export function applySession(me) {
  currentSession = me;
  const links = document.querySelector("[data-session-links]");
  const player = document.querySelector("[data-session-player]");
  const name = document.querySelector("[data-player-name]");
  if (links && player) {
    links.hidden = Boolean(me);
    player.hidden = !me;
    if (name) name.textContent = me ? me.user.display_name : "";
  }
  document.body.dataset.signedIn = me ? "yes" : "no";
  document.dispatchEvent(new CustomEvent("downtime:session", { detail: me }));
}

export async function loadSession() {
  if (!token()) {
    applySession(null);
    return null;
  }
  const { status, data } = await api("GET", "/api/me");
  if (status === 200) {
    applySession(data);
    return data;
  }
  if (status === 401) {
    applySession(null);
    return null;
  }
  return undefined;
}

/* -- live regions ----------------------------------------------------- */
export function announce(name, text, kind = "") {
  document.querySelectorAll(`[data-region="${name}"]`).forEach((region) => {
    region.textContent = text;
    region.classList.toggle("is-error", kind === "error");
  });
}

export function announceMarkup(name, markup) {
  document.querySelectorAll(`[data-region="${name}"]`).forEach((region) => {
    region.innerHTML = markup;
    region.classList.remove("is-error");
  });
}

/* -- times ------------------------------------------------------------ */
export function utcTime(iso) {
  const at = new Date(iso);
  const hours = String(at.getUTCHours()).padStart(2, "0");
  const minutes = String(at.getUTCMinutes()).padStart(2, "0");
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${hours}:${minutes} UTC`;
}

/* -- markup helpers --------------------------------------------------- */
export function escapeText(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

export const TICK =
  '<svg class="icon icon-tick" viewBox="0 0 24 24" width="16" height="16"' +
  ' aria-hidden="true" focusable="false" fill="none" stroke="currentColor"' +
  ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 13l5 5L20 6"/></svg>';

export function stateWord(word, solved) {
  if (!solved) return `<span class="state-word">${escapeText(word)}</span>`;
  return (
    '<span class="state-word is-solved">' +
    TICK +
    `<span class="state-text">${escapeText(word)}</span></span>`
  );
}

/* -- the safe return address ------------------------------------------ */
export function returnAddress(raw) {
  const value =
    raw === undefined
      ? new URLSearchParams(location.search).get("redirect")
      : raw;
  const fallback = "/downtime";
  if (typeof value !== "string" || value === "") return fallback;
  if (value[0] !== "/") return fallback;
  if (value.length > 1 && (value[1] === "/" || value[1] === "\\")) return fallback;
  if (value.includes("\\")) return fallback;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return fallback;
  let resolved;
  try {
    resolved = new URL(value, location.href);
  } catch (error) {
    return fallback;
  }
  if (resolved.origin !== location.origin) return fallback;
  return resolved.pathname + resolved.search + resolved.hash;
}

/* -- dialogs ---------------------------------------------------------- */
const openers = new WeakMap();

export function dialog(name) {
  return document.querySelector(`[data-dialog="${name}"]`);
}

export function openDialog(name, opener) {
  const element = dialog(name);
  if (!element) return null;
  openers.set(element, opener || document.activeElement);
  element.showModal();
  const field = element.querySelector("input");
  if (field) field.focus();
  return element;
}

export function closeDialog(element) {
  if (element && element.open) element.close();
}

function setUpDialogs() {
  document.querySelectorAll("[data-dialog]").forEach((element) => {
    element.addEventListener("close", () => {
      const opener = openers.get(element);
      if (opener && document.contains(opener)) opener.focus();
    });
    element
      .querySelectorAll("[data-dialog-close]")
      .forEach((button) =>
        button.addEventListener("click", () => closeDialog(element)),
      );
  });
  document.querySelectorAll("[data-open-dialog]").forEach((button) => {
    button.addEventListener("click", () =>
      openDialog(button.dataset.openDialog, button),
    );
  });
}

/* -- consent ---------------------------------------------------------- */
function chosenConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch (error) {
    return "all";
  }
}

function setUpConsent() {
  const panel = document.querySelector("[data-consent-panel]");
  if (!panel) return;
  const settle = (choice) => {
    try {
      localStorage.setItem(CONSENT_KEY, choice);
    } catch (error) {
      /* the panel closes for this page only */
    }
    panel.hidden = true;
    closeDialog(dialog("cookies"));
  };
  if (!chosenConsent()) panel.hidden = false;
  panel
    .querySelector("[data-consent-allow]")
    .addEventListener("click", () => settle("all"));
  panel
    .querySelector("[data-consent-settings]")
    .addEventListener("click", (event) =>
      openDialog("cookies", event.currentTarget),
    );
  const essential = document.querySelector("[data-consent-essential]");
  if (essential) essential.addEventListener("click", () => settle("essential"));
}

/* -- sound ------------------------------------------------------------ */
const FADE_MILLISECONDS = 900;
const AMBIENT_VOLUME = 0.22;
let ambient = null;
let fading = null;
let cueContext = null;

export function soundIsOn() {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch (error) {
    return false;
  }
}

function fadeAmbient(to, then) {
  if (fading) cancelAnimationFrame(fading);
  const from = ambient.volume;
  const started = performance.now();
  const step = (now) => {
    const part = Math.min(1, (now - started) / FADE_MILLISECONDS);
    ambient.volume = Math.max(0, Math.min(1, from + (to - from) * part));
    if (part < 1) {
      fading = requestAnimationFrame(step);
    } else {
      fading = null;
      if (then) then();
    }
  };
  fading = requestAnimationFrame(step);
}

function startAmbient() {
  if (!ambient) {
    ambient = new Audio(SOUNDTRACK);
    ambient.loop = true;
    ambient.volume = 0;
  }
  const playing = ambient.play();
  if (playing && playing.catch) playing.catch(() => {});
  fadeAmbient(AMBIENT_VOLUME);
}

function stopAmbient() {
  if (!ambient) return;
  fadeAmbient(0, () => ambient.pause());
}

export function refreshSoundToggles() {
  const on = soundIsOn();
  document.querySelectorAll("[data-sound-toggle]").forEach((button) => {
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.setAttribute("aria-label", on ? "Sound on" : "Sound off");
  });
}

function setUpSound() {
  refreshSoundToggles();
  if (soundIsOn()) {
    const resume = () => {
      startAmbient();
      ["click", "keydown", "touchstart"].forEach((kind) =>
        document.removeEventListener(kind, resume),
      );
    };
    ["click", "keydown", "touchstart"].forEach((kind) =>
      document.addEventListener(kind, resume),
    );
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sound-toggle]");
    if (!button) return;
    const turningOn = !soundIsOn();
    try {
      localStorage.setItem(SOUND_KEY, turningOn ? "on" : "off");
    } catch (error) {
      /* the choice lasts for this page only */
    }
    refreshSoundToggles();
    if (turningOn) startAmbient();
    else stopAmbient();
  });
}

export function playCue(kind) {
  if (!soundIsOn()) return;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  if (!cueContext) cueContext = new Context();
  const now = cueContext.currentTime;
  const notes = kind === "correct" ? [523.25, 783.99] : [110, 98];
  notes.forEach((frequency, index) => {
    const oscillator = cueContext.createOscillator();
    const gain = cueContext.createGain();
    oscillator.type = kind === "correct" ? "triangle" : "sawtooth";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + index * 0.12);
    gain.gain.exponentialRampToValueAtTime(0.18, now + index * 0.12 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.12 + 0.18);
    oscillator.connect(gain).connect(cueContext.destination);
    oscillator.start(now + index * 0.12);
    oscillator.stop(now + index * 0.12 + 0.2);
  });
}

/* -- header ----------------------------------------------------------- */
function setUpHeader() {
  const toggle = document.querySelector("[data-menu-toggle]");
  const navigation = document.getElementById("site-navigation");
  if (toggle && navigation) {
    toggle.addEventListener("click", () => {
      const open = navigation.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && navigation.classList.contains("is-open")) {
        navigation.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }
  const logout = document.querySelector("[data-logout]");
  if (logout) {
    logout.addEventListener("click", async () => {
      await api("POST", "/api/auth/logout");
      forgetToken();
      applySession(null);
      location.assign("/downtime");
    });
  }
}

/* -- the faq ---------------------------------------------------------- */
function setUpFaq() {
  document.querySelectorAll(".faq-question").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = document.getElementById(button.getAttribute("aria-controls"));
      const open = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", open ? "false" : "true");
      if (panel) panel.hidden = open;
    });
  });
}

/* -- entering content ------------------------------------------------- */
function setUpReveals() {
  const blocks = Array.from(
    document.querySelectorAll("main > section, .card, .trail-block, .faq-item"),
  );
  blocks.forEach((block) => block.classList.add("reveal"));
  const watcher = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        watcher.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -6% 0px" },
  );
  blocks.forEach((block, index) => {
    const place = block.parentElement
      ? Array.from(block.parentElement.children).indexOf(block)
      : index;
    block.style.setProperty("--stagger", `${Math.min(place, 6) * 0.1}s`);
    watcher.observe(block);
  });
}

/* -- the live stream -------------------------------------------------- */
export function connectStream({ onScore, onTeam, onOpen, onDrop }) {
  let source = null;
  let timer = null;
  const open = () => {
    source = new EventSource("/api/stream");
    source.addEventListener("open", () => {
      if (onOpen) onOpen();
    });
    source.addEventListener("score", (event) => {
      if (onScore) onScore(JSON.parse(event.data));
    });
    source.addEventListener("team", (event) => {
      if (onTeam) onTeam(JSON.parse(event.data));
    });
    source.addEventListener("error", () => {
      source.close();
      if (onDrop) onDrop();
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          open();
        }, 1500);
      }
    });
  };
  open();
}

/* -- start ------------------------------------------------------------ */
export function startChrome() {
  setUpDialogs();
  setUpConsent();
  setUpSound();
  setUpHeader();
  setUpFaq();
  setUpReveals();
  return loadSession();
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
