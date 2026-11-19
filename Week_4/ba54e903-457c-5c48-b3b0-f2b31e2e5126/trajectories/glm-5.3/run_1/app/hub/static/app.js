/* Shared public-page behaviour: menu, consent, locale, trackers, fetch helpers. */
"use strict";

const HUB = (() => {
  const state = { token: sessionStorage.getItem("hub_token") || "" };

  function setToken(token, memberId) {
    state.token = token;
    if (token) sessionStorage.setItem("hub_token", token);
    else sessionStorage.removeItem("hub_token");
    if (memberId) sessionStorage.setItem("hub_member_id", String(memberId));
    else sessionStorage.removeItem("hub_member_id");
  }

  async function api(method, path, body, extra) {
    const headers = Object.assign({}, extra || {});
    if (state.token) headers["Authorization"] = "Bearer " + state.token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const resp = await fetch(path, opts);
    let data = null;
    if (resp.status !== 204) {
      try { data = await resp.json(); } catch (e) { data = null; }
    }
    return { status: resp.status, data, headers: resp.headers };
  }

  function cookieValue(name) {
    const parts = document.cookie ? document.cookie.split(";") : [];
    for (const part of parts) {
      const [k, ...rest] = part.trim().split("=");
      if (k === name) return rest.join("=");
    }
    return "";
  }

  function writeCookie(name, value, days) {
    const maxAge = Math.round(days * 86400);
    document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax`;
  }

  function randomId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  return { state, api, setToken, cookieValue, writeCookie, randomId };
})();

/* ---------- phone Menu (DP-91) ---------- */
function setupMenu() {
  const toggle = document.getElementById("menuToggle");
  const links = document.getElementById("primaryLinks");
  if (!toggle || !links) return;
  const setOpen = (open) => {
    if (open) {
      links.hidden = false;
      links.classList.add("open");
      toggle.setAttribute("aria-expanded", "true");
    } else {
      links.hidden = true;
      links.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  };
  const isPhone = () => window.matchMedia("(max-width: 767px)").matches;
  setOpen(false);
  if (isPhone()) links.hidden = true; else links.hidden = false;
  toggle.addEventListener("click", () => {
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      toggle.focus();
    }
  });
  links.addEventListener("click", (e) => {
    if (e.target.tagName === "A") setOpen(false);
  });
  window.matchMedia("(max-width: 767px)").addEventListener("change", (e) => {
    if (!e.matches) { links.hidden = false; links.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); }
    else setOpen(toggle.getAttribute("aria-expanded") === "true");
  });
}

/* ---------- consent and trackers (DP-49, DP-95) ---------- */
function parseConsent(raw) {
  const analytics = /analytics:1/.test(raw || "");
  const marketing = /marketing:1/.test(raw || "");
  return { analytics, marketing };
}

function setupConsent() {
  const dialog = document.getElementById("cookieDialog");
  const prefsBtn = document.getElementById("cookiePrefsBtn");
  const status = document.getElementById("cookieStatus");
  const analyticsBox = document.getElementById("consentAnalytics");
  const marketingBox = document.getElementById("consentMarketing");
  if (!dialog) return;
  const consent = HUB.cookieValue("hub_consent");
  const save = (analytics, marketing, note) => {
    HUB.writeCookie("hub_consent", `analytics:${analytics ? 1 : 0}|marketing:${marketing ? 1 : 0}`, 365);
    if (status) status.textContent = note;
    runTrackers(analytics, marketing);
  };
  if (!consent) {
    dialog.showModal();
    dialog.removeAttribute("hidden");
  } else {
    dialog.setAttribute("open", "");
    const { analytics, marketing } = parseConsent(consent);
    analyticsBox.checked = analytics;
    marketingBox.checked = marketing;
    dialog.close();
    runTrackers(analytics, marketing);
  }
  const acceptAll = document.getElementById("cookieAcceptAll");
  const rejectOptional = document.getElementById("cookieRejectOptional");
  const saveBtn = document.getElementById("cookieSave");
  acceptAll.addEventListener("click", () => {
    analyticsBox.checked = true; marketingBox.checked = true;
    save(true, true, "Cookie preferences saved.");
    dialog.close();
    focusOpener();
  });
  rejectOptional.addEventListener("click", () => {
    analyticsBox.checked = false; marketingBox.checked = false;
    save(false, false, "Cookie preferences saved.");
    dialog.close();
    focusOpener();
  });
  saveBtn.addEventListener("click", () => {
    save(analyticsBox.checked, marketingBox.checked, "Cookie preferences saved.");
    dialog.close();
    focusOpener();
  });
  let opener = null;
  dialog.addEventListener("close", () => { dialog.setAttribute("hidden", ""); });
  if (prefsBtn) {
    prefsBtn.addEventListener("click", () => {
      opener = prefsBtn;
      const { analytics, marketing } = parseConsent(HUB.cookieValue("hub_consent"));
      analyticsBox.checked = analytics;
      marketingBox.checked = marketing;
      dialog.showModal();
      analyticsBox.focus();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dialog.open) {
      e.preventDefault();
      dialog.close();
      focusOpener();
    }
  });
  function focusOpener() {
    if (opener) opener.focus();
    else {
      const skip = document.querySelector(".skip-link");
      if (skip) skip.focus();
    }
  }
}

function runTrackers(analytics, marketing) {
  if (analytics && !HUB.cookieValue("hub_aid")) {
    HUB.writeCookie("hub_aid", HUB.randomId(), 365);
  }
  if (marketing && !HUB.cookieValue("hub_mkt")) {
    HUB.writeCookie("hub_mkt", HUB.randomId(), 365);
  }
  if (analytics) {
    const visitor = HUB.cookieValue("hub_aid") || HUB.randomId();
    HUB.writeCookie("hub_aid", visitor, 365);
    const payload = { path: location.pathname, visitor_id: visitor };
    fetch("/api/analytics/pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }
}

/* ---------- locale (DP-49) ---------- */
function setupLocale() {
  const select = document.getElementById("localeSelect");
  if (!select) return;
  select.addEventListener("change", () => {
    HUB.writeCookie("hub_locale", select.value, 365);
    document.documentElement.lang = select.value;
  });
}

/* ---------- rising feature blocks (DP-62) ---------- */
function setupFeatureBlocks() {
  const blocks = document.querySelectorAll(".feature-block");
  if (!blocks.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const update = () => {
    const lowerThird = window.innerHeight * (2 / 3);
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, (lowerThird - rect.top) / (window.innerHeight / 3)));
      block.style.opacity = String(progress);
      block.style.transform = `translateY(${(1 - progress) * 1.2}em)`;
      block.classList.toggle("risen", progress >= 1);
    }
  };
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
}

document.addEventListener("DOMContentLoaded", () => {
  setupMenu();
  setupConsent();
  setupLocale();
  setupFeatureBlocks();
});
