/* Pacely front-end: session, API client, and shared components. */
"use strict";

const Pacely = {
  token: localStorage.getItem("pacely_token") || "",
  athlete: JSON.parse(localStorage.getItem("pacely_athlete") || "null"),

  async api(method, path, body, extraHeaders) {
    const headers = Object.assign({}, extraHeaders || {});
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (Pacely.token) headers["Authorization"] = "Bearer " + Pacely.token;
    const res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return { ok: true, status: 204, data: {} };
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data };
  },

  signedIn() { return Boolean(Pacely.token); },

  saveSession(token, athlete) {
    Pacely.token = token;
    Pacely.athlete = athlete;
    localStorage.setItem("pacely_token", token);
    localStorage.setItem("pacely_athlete", JSON.stringify(athlete));
  },

  clearSession() {
    Pacely.token = "";
    Pacely.athlete = null;
    localStorage.removeItem("pacely_token");
    localStorage.removeItem("pacely_athlete");
  },

  async logout() {
    await Pacely.api("POST", "/api/auth/logout");
    Pacely.clearSession();
  },
};

/* ---------- formatting ---------- */
function fmtKm(metres, decimals = 2) {
  return (metres / 1000).toFixed(decimals);
}
function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtPace(secondsPerKm) {
  if (secondsPerKm == null) return "—";
  return fmtDuration(secondsPerKm) + " /km";
}
function fmtSpeed(kmh) {
  return Number(kmh).toFixed(1) + " km/h";
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) +
    " at " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtThousands(n) {
  return Number(n).toLocaleString("en-US");
}
function initials(name) {
  return name.split(/\s+/).slice(0, 2).map(w => w[0] ? w[0].toUpperCase() : "").join("") || "?";
}
function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ---------- shared markup ---------- */
const LOGO_SVG = `<svg width="30" height="24" viewBox="0 0 30 24" aria-hidden="true" focusable="false">
  <path d="M2 20 L11 4 L16 13 L19 8 L28 20 Z" fill="#fc5203"/>
  <path d="M6 23 L14 12 L18 17 L24 23 Z" fill="#d43d00"/>
</svg>`;

const THUMB_SVG = `<svg class="thumb" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path class="thumb-outline" d="M7 22V10l4.2-7c.8.4 1.3 1.3 1.2 2.2L11.8 10H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 21H7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <path d="M3 22h4V10H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
</svg>`;

const CROWN_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-1.6 10.5H4.6L3 8z" fill="currentColor" stroke="#7a5b00" stroke-width="1" stroke-linejoin="round"/></svg>`;

const SPORT_GLYPHS = {
  run: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="14" cy="4.5" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 21l3-5-2-3 3-4 2 3 3 1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 13l-3 2M13 16l3 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  ride: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="17" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="17" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 17l4-6h5l3 6M10 11l3-4h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  swim: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 11c0-3 2.5-5 5-5 2 0 3 .8 3.6 1.8M17 9l-3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  walk: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4.5" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M11 21l2-5-1-4 2-4 1 3 2 2M14 8l-3 4-3 1M14 12l-1 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  hike: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20L9 8l4 7h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 20l3-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  workout: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v6a4 4 0 0 0 8 0V4M11 4v16M15 12h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};

const MEDALS = {
  1: { label: "Personal record", color: "var(--gold)" },
  2: { label: "2nd fastest", color: "var(--silver)" },
  3: { label: "3rd fastest", color: "var(--bronze)" },
};
const MEDAL_SVG = (color) => `<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="15" r="6" fill="${color}" stroke="#6c5518" stroke-width="1"/><path d="M8 9L5 3h5l2 4 2-4h5l-3 6" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;

function medalMarkup(prRank) {
  const m = MEDALS[prRank];
  if (!m) return "";
  return `<span class="medal">${MEDAL_SVG(m.color)}<span>${m.label}</span></span>`;
}
function crownMarkup() {
  return `<span class="medal crown">${CROWN_SVG}<span>First place</span></span>`;
}

function marketingHeader(opts = {}) {
  const onDark = opts.onDark ? " on-dark" : "";
  return `
  <header class="site-header${onDark}" id="siteHeader">
    <div class="container header-inner">
      <button class="btn btn-ghost menu-button" id="menuButton" aria-expanded="false" aria-controls="navDrawer">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
        <span class="visually-hidden-open">Open menu</span><span aria-hidden="true">Open menu</span>
      </button>
      <a class="brand" href="/">${LOGO_SVG}<span class="wordmark">Pacely</span></a>
      <nav aria-label="Main">
        <details class="nav-details">
          <summary class="nav-item">Top Sports</summary>
          <div class="nav-menu">
            <a href="/features">Running</a><a href="/features">Cycling</a><a href="/features">Walking</a>
          </div>
        </details>
        <a href="/features">Features</a>
        <a href="/maps">Maps</a>
        <a href="/challenges">Challenges</a>
        <a href="/subscribe">Subscription</a>
      </nav>
      <div class="nav-cta">
        <a class="btn btn-outline btn-sm" href="/login">Log In</a>
        <a class="btn btn-primary btn-sm" href="/signup">Sign Up</a>
      </div>
    </div>
  </header>
  <div class="drawer-overlay" id="drawerOverlay" hidden></div>
  <div class="drawer" id="navDrawer" role="dialog" aria-modal="true" aria-label="Menu" hidden>
    <button class="btn btn-ghost" id="drawerClose">Close menu</button>
    <a href="/features">Features</a>
    <a href="/maps">Maps</a>
    <a href="/challenges">Challenges</a>
    <a href="/subscribe">Subscription</a>
    <a href="/family">Family Plan</a>
    <a href="/student">Student Discount</a>
    <a href="/bulk-subscriptions">Bulk Subscriptions</a>
    <a href="/about">About Us</a>
    <a href="/whats-new">What's New</a>
    <hr>
    <a href="/login">Log In</a>
    <a href="/signup">Sign Up</a>
  </div>`;
}

const FOOTER_LINKS = [
  { title: "Features", links: [["What's New", "/whats-new"], ["Stories", "/about"], ["Routes", "/maps"], ["About", "/about"]] },
  { title: "Subscription", links: [["Family Plan", "/family"], ["Bulk Subscriptions", "/bulk-subscriptions"], ["Student Discount", "/student"], ["Send a Gift", "/gift"]] },
  { title: "Support", links: [["Business", "/bulk-subscriptions"], ["Partner Center", "/about"], ["Careers", "/about"], ["Press", "/about"]] },
  { title: "Privacy", links: [["Do Not Share My Personal Information", "/about"], ["Terms", "/about"]] },
];

function marketingFooter() {
  return `
  <footer class="site-footer">
    <div class="container">
      <div class="footer-grid">
        <div>
          <a class="brand" href="/" style="margin-bottom:10px">${LOGO_SVG}<span class="wordmark" style="color:#fff">Pacely</span></a>
          <p class="small">Community-Powered Motivation. Record. Sweat. Share. Kudos.</p>
        </div>
        ${FOOTER_LINKS.map(col => `
        <div>
          <h4>${col.title}</h4>
          <ul>${col.links.map(([label, href]) => `<li><a href="${href}">${label}</a></li>`).join("")}</ul>
        </div>`).join("")}
      </div>
      <p class="footer-note">© 2026 Pacely Labs</p>
    </div>
  </footer>`;
}

function consentBar() {
  return `
  <div class="consent-bar" id="consentBar" role="region" aria-label="Cookie consent" hidden>
    <span>This website uses cookies. Pacely keeps only the essential session that signs you in — nothing else is stored or shared.</span>
    <button class="btn btn-primary" id="consentAccept">Accept All</button>
    <button class="btn btn-outline" id="consentCustomize">Customize</button>
    <button class="btn btn-outline" id="consentReject">Reject Non-Essential</button>
  </div>`;
}

function appHeader(active) {
  const links = [["Dashboard", "/dashboard"], ["Upload", "/upload"], ["Maps", "/maps"], ["Challenges", "/challenges"]];
  const name = Pacely.athlete ? Pacely.athlete.name : "";
  return `
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="/dashboard">${LOGO_SVG}<span class="wordmark">Pacely</span></a>
      <nav aria-label="Main">
        ${links.map(([label, href]) => `<a href="${href}" ${href === active ? 'aria-current="page"' : ""}>${label}</a>`).join("")}
      </nav>
      <div class="nav-cta">
        <form class="header-search" id="segmentSearchForm" role="search">
          <label class="visually-hidden" for="segmentSearch">Search segments</label>
          <input id="segmentSearch" type="search" placeholder="Search segments" autocomplete="off">
        </form>
        <details class="avatar-menu">
          <summary class="avatar" aria-label="Account menu for ${name}">${initials(name)}</summary>
          <div class="avatar-dropdown">
            <a href="/athletes/${Pacely.athlete ? Pacely.athlete.id : ""}">My Profile</a>
            <a href="/settings/privacy">Settings</a>
            <button id="logoutButton">Log Out</button>
          </div>
        </details>
      </div>
    </div>
  </header>`;
}

const VISUALLY_HIDDEN_CSS = `
.visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.nav-details, .avatar-menu { position: relative; }
.nav-details summary::-webkit-details-marker, .avatar-menu summary { list-style: none; }
.avatar-menu summary::-webkit-details-marker { display: none; }
.nav-menu { position: absolute; top: 100%; left: 0; background: var(--card); border: 1px solid var(--hairline); border-radius: var(--radius-m); box-shadow: var(--shadow-card); padding: 8px; min-width: 160px; z-index: 60; }
.nav-menu a { display: block; min-height: 44px; padding: 10px 12px; }
.avatar-dropdown { position: absolute; right: 0; top: 100%; background: var(--card); border: 1px solid var(--hairline); border-radius: var(--radius-m); box-shadow: var(--shadow-card); padding: 8px; min-width: 180px; z-index: 60; }
.avatar-dropdown a, .avatar-dropdown button { display: block; width: 100%; min-height: 44px; padding: 10px 12px; text-align: left; font: inherit; font-weight: 700; color: var(--ink); background: none; border: none; cursor: pointer; }
.avatar-menu summary { list-style: none; cursor: pointer; display: inline-flex; }
details[open] .nav-menu, details[open] .avatar-dropdown { display: block; }
`;

function injectSharedCss() {
  const style = document.createElement("style");
  style.textContent = VISUALLY_HIDDEN_CSS;
  document.head.appendChild(style);
}

/* ---------- behaviours shared by every page ---------- */
function mountHeaderBehaviour() {
  const header = document.getElementById("siteHeader");
  const menuButton = document.getElementById("menuButton");
  const drawer = document.getElementById("navDrawer");
  const overlay = document.getElementById("drawerOverlay");
  const closeBtn = document.getElementById("drawerClose");
  if (header && !reducedMotion()) {
    let lastY = 0;
    window.addEventListener("scroll", () => {
      const y = window.scrollY;
      header.classList.toggle("hidden", y > lastY && y > 90);
      lastY = y;
    }, { passive: true });
  }
  if (menuButton && drawer) {
    const open = (focus) => {
      drawer.hidden = false;
      overlay.hidden = false;
      menuButton.setAttribute("aria-expanded", "true");
      const first = drawer.querySelector("button, a");
      if (focus && first) first.focus();
      drawer._trap = (e) => {
        if (e.key === "Escape") { close(); return; }
        if (e.key !== "Tab") return;
        const items = Array.from(drawer.querySelectorAll("button, a[href]"));
        const idx = items.indexOf(document.activeElement);
        if (e.shiftKey && idx <= 0) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && idx === items.length - 1) { e.preventDefault(); items[0].focus(); }
      };
      document.addEventListener("keydown", drawer._trap);
    };
    const close = () => {
      drawer.hidden = true;
      overlay.hidden = true;
      menuButton.setAttribute("aria-expanded", "false");
      document.removeEventListener("keydown", drawer._trap);
      menuButton.focus();
    };
    menuButton.addEventListener("click", () => {
      if (drawer.hidden) open(true); else close();
    });
    overlay.addEventListener("click", close);
    if (closeBtn) closeBtn.addEventListener("click", close);
  }
  const bar = document.getElementById("consentBar");
  if (bar) {
    const dismissed = localStorage.getItem("pacely_consent") === "dismissed";
    if (!dismissed) bar.hidden = false;
    const dismiss = () => { localStorage.setItem("pacely_consent", "dismissed"); bar.hidden = true; };
    ["consentAccept", "consentCustomize", "consentReject"].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.addEventListener("click", dismiss);
    });
  }
  const logout = document.getElementById("logoutButton");
  if (logout) logout.addEventListener("click", async () => {
    await Pacely.logout();
    window.location.href = "/";
  });
  const searchForm = document.getElementById("segmentSearchForm");
  if (searchForm) searchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = document.getElementById("segmentSearch").value.trim();
    const res = await Pacely.api("GET", "/api/segments?q=" + encodeURIComponent(q));
    if (res.ok && res.data.segments && res.data.segments.length) {
      window.location.href = "/segments/" + res.data.segments[0].id;
    } else {
      alert("No segment matches that name.");
    }
  });
}

function mountRiseIn() {
  if (reducedMotion()) {
    document.querySelectorAll(".rise-in").forEach(el => el.classList.add("shown"));
    return;
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add("shown"); io.unobserve(entry.target); }
    });
  }, { threshold: 0.2 });
  document.querySelectorAll(".rise-in").forEach(el => io.observe(el));
}

/* route thumbnail drawn from streams */
function routeThumbSvg(points, w = 84, h = 56) {
  if (!points || points.length < 2) return `<div class="route-thumb"></div>`;
  const lats = points.map(p => p[0]), lngs = points.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 0.0001, spanLng = maxLng - minLng || 0.0001;
  const pad = 6;
  const coords = points.map(p => [
    pad + (p[1] - minLng) / spanLng * (w - 2 * pad),
    h - pad - (p[0] - minLat) / spanLat * (h - 2 * pad),
  ]);
  const d = "M" + coords.map(c => c[0].toFixed(1) + " " + c[1].toFixed(1)).join(" L");
  return `<svg class="route-thumb" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">
    <path d="${d}" fill="none" stroke="var(--orange)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

async function feedCardHtml(activity) {
  let thumb = `<div class="route-thumb"></div>`;
  const streams = await Pacely.api("GET", `/api/activities/${activity.id}/streams`);
  if (streams.ok && streams.data.latlng) thumb = routeThumbSvg(streams.data.latlng);
  const pace = activity.sport_type === "ride"
    ? fmtSpeed(activity.avg_speed_kmh) : fmtPace(activity.avg_pace_s_per_km);
  const label = activity.sport_type === "ride" ? "Speed" : "Pace";
  return `
  <article class="card feed-card rise">
    <div class="feed-head">
      <a class="avatar" href="/athletes/${activity.athlete_id}" aria-label="${activity.athlete_name}">${initials(activity.athlete_name)}</a>
      <div>
        <div><strong>${activity.athlete_name}</strong> — <a href="/activities/${activity.id}">${activity.name}</a></div>
        <div class="small muted">${fmtDateTime(activity.start_time)}</div>
      </div>
    </div>
    <div class="spread">
      ${thumb}
      <div class="feed-stats">
        <div class="item"><span class="caps-label">Distance</span><b>${fmtKm(activity.distance_m)} km</b></div>
        <div class="item"><span class="caps-label">${label}</span><b>${pace}</b></div>
        <div class="item"><span class="caps-label">Elev Gain</span><b>${fmtThousands(activity.elevation_gain_m)} m</b></div>
      </div>
    </div>
    <div class="row">
      <button class="btn btn-quiet kudos-btn" data-activity="${activity.id}" data-given="false"
              aria-pressed="false" aria-label="Give kudos, ${activity.kudos_count}">
        ${THUMB_SVG}<span class="count">${activity.kudos_count}</span>
      </button>
      <a class="btn btn-ghost" href="/activities/${activity.id}">${activity.comment_count} comments</a>
    </div>
  </article>`;
}

function mountKudosButtons(root) {
  root.querySelectorAll(".kudos-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const given = btn.getAttribute("data-given") === "true";
      const countEl = btn.querySelector(".count");
      const prev = countEl.textContent;
      const newCount = given ? Number(prev) - 1 : Number(prev) + 1;
      countEl.textContent = newCount;
      btn.setAttribute("data-given", String(!given));
      btn.setAttribute("aria-pressed", String(!given));
      btn.setAttribute("aria-label", (given ? "Give kudos" : "Remove kudos") + ", " + newCount);
      if (!given && !reducedMotion()) { btn.classList.add("pop"); setTimeout(() => btn.classList.remove("pop"), 340); }
      const res = given
        ? await Pacely.api("DELETE", `/api/activities/${btn.dataset.activity}/kudos`)
        : await Pacely.api("POST", `/api/activities/${btn.dataset.activity}/kudos`);
      if (res.ok) {
        btn.dispatchEvent(new CustomEvent("pacely:kudos", { bubbles: true }));
      }
      if (!res.ok) {
        countEl.textContent = prev;
        btn.setAttribute("data-given", given ? "true" : "false");
        btn.setAttribute("aria-pressed", given ? "true" : "false");
        btn.setAttribute("aria-label", (given ? "Remove kudos" : "Give kudos") + ", " + prev);
        announce("Kudos could not be saved", "alert");
      }
    });
  });
}

function announce(message, role) {
  let live = document.getElementById("liveRegion");
  if (!live) {
    live = document.createElement("div");
    live.id = "liveRegion";
    live.setAttribute("aria-live", "polite");
    live.style.position = "absolute";
    live.style.width = "1px";
    live.style.height = "1px";
    live.style.overflow = "hidden";
    live.style.clip = "rect(0 0 0 0)";
    document.body.appendChild(live);
  }
  const node = document.createElement("p");
  node.setAttribute("role", role || "status");
  node.textContent = message;
  live.appendChild(node);
  setTimeout(() => node.remove(), 6000);
}
