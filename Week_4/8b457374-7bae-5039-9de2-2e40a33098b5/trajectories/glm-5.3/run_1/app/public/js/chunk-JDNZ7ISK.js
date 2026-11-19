// src/frontend/api.ts
async function apiFetch(input, init) {
  const key = loadKey();
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body !== void 0 && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (key !== null) {
    headers.set("Authorization", `Bearer ${key}`);
  }
  const response = await fetch(input, { ...init, headers });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { status: response.status, body };
}
function loadKey() {
  return window.localStorage.getItem("dotgain_key");
}
function storeKey(key) {
  window.localStorage.setItem("dotgain_key", key);
}
function formatPence(pence) {
  const negative = pence < 0;
  const abs = Math.abs(Math.trunc(pence));
  const pounds = Math.floor(abs / 100);
  const rest = abs % 100;
  const poundsText = pounds.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-\xA3" : "\xA3"}${poundsText}.${rest.toString().padStart(2, "0")}`;
}
function parsePoundsField(text) {
  const t = text.trim();
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cleaned = t.replace(/,/g, "");
  const [whole, fraction = ""] = cleaned.split(".");
  if (!/^\d+$/.test(whole)) return null;
  if (fraction !== "" && !/^\d{1,2}$/.test(fraction)) return null;
  const wholePence = Number(whole) * 100;
  const fractionPence = fraction === "" ? 0 : Number(fraction.padEnd(2, "0"));
  return wholePence + fractionPence;
}
function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor(s % 86400 / 3600);
  const minutes = Math.floor(s % 3600 / 60);
  const seconds = s % 60;
  const hhmmss = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (days >= 1) {
    return `${days} ${days === 1 ? "day" : "days"} ${hhmmss}`;
  }
  return hhmmss;
}
function pad(value) {
  return value.toString().padStart(2, "0");
}
var ServerCountdown = class {
  anchor;
  constructor(secondsLeft) {
    this.anchor = Date.now() + secondsLeft * 1e3;
  }
  secondsLeft() {
    return Math.max(0, Math.floor((this.anchor - Date.now()) / 1e3));
  }
  expired() {
    return this.secondsLeft() <= 0;
  }
};
var COUNTRIES = [
  { code: "AT", name: "Austria" },
  { code: "AU", name: "Australia" },
  { code: "BE", name: "Belgium" },
  { code: "BR", name: "Brazil" },
  { code: "CA", name: "Canada" },
  { code: "CH", name: "Switzerland" },
  { code: "DE", name: "Germany" },
  { code: "DK", name: "Denmark" },
  { code: "ES", name: "Spain" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GB", name: "United Kingdom" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "JP", name: "Japan" },
  { code: "MX", name: "Mexico" },
  { code: "NL", name: "Netherlands" },
  { code: "NZ", name: "New Zealand" },
  { code: "NO", name: "Norway" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "SE", name: "Sweden" },
  { code: "SG", name: "Singapore" },
  { code: "US", name: "United States" }
];
function countriesSorted() {
  return [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));
}
var ZONE_NAMES = {
  domestic: "Domestic",
  europe: "Europe",
  rest_of_world: "Rest of world"
};
var STATE_WORDS = {
  authorising: "Holding",
  authorised: "Held",
  captured: "Charged",
  errored: "Needs fixing",
  voided: "Released",
  dropped: "Dropped"
};
var SERVICE_BANNERS = {
  payments: "Payments are unavailable. New pledges and changes are paused; held cards are safe.",
  email: "Email is delayed. Notices are queued and will be sent when the mail service is back.",
  storage: "Media storage is unavailable. Uploads and statements are paused.",
  documents: "Statements are delayed. They will appear once they are rendered."
};
async function fetchServiceStatus() {
  try {
    const { body } = await apiFetch("/api/status");
    return body;
  } catch {
    return null;
  }
}
async function renderServiceBanners() {
  const region = document.querySelector('[role="region"][aria-label="Service notice"]');
  if (region === null) return;
  const status = await fetchServiceStatus();
  if (status === null) {
    region.innerHTML = "";
    return;
  }
  const banners = [];
  for (const [service, state] of Object.entries(status)) {
    if (state === "down") {
      banners.push(SERVICE_BANNERS[service] ?? "");
    }
  }
  region.innerHTML = banners.map((text) => `<div class="banner" role="note">${text}</div>`).join("");
}
function startBannerRefresh() {
  renderServiceBanners().catch(() => void 0);
  window.setInterval(() => {
    renderServiceBanners().catch(() => void 0);
  }, 15e3);
}
function mountHeader(active) {
  const element = document.querySelector("[data-header]");
  if (element !== null) {
    element.innerHTML = headerMarkup(active);
  }
}
function headerMarkup(active) {
  const link = (href, label) => `<a href="${href}"${active === label ? ' aria-current="page"' : ""}>${label}</a>`;
  return `
    <a class="wordmark" href="/" aria-label="Dotgain">DOTGAIN</a>
    <nav class="site-nav" aria-label="Site">
      ${link("/campaigns", "Campaigns")}
      ${link("/pledges", "My pledges")}
      ${link("/studio", "Studio")}
    </nav>`;
}
function loadingMarkup() {
  return `
    <div class="loading" role="status" aria-label="Loading">
      <span class="dots">
        <span class="dot" style="--delay:0s"></span>
        <span class="dot" style="--delay:0.2s; width:20px; height:20px; margin:-10px; opacity:0.5"></span>
        <span class="dot" style="--delay:0.4s; width:28px; height:28px; margin:-14px; opacity:0.3"></span>
      </span>
      Loading
    </div>`;
}

export {
  apiFetch,
  loadKey,
  storeKey,
  formatPence,
  parsePoundsField,
  formatCountdown,
  ServerCountdown,
  COUNTRIES,
  countriesSorted,
  ZONE_NAMES,
  STATE_WORDS,
  SERVICE_BANNERS,
  fetchServiceStatus,
  renderServiceBanners,
  startBannerRefresh,
  mountHeader,
  headerMarkup,
  loadingMarkup
};
