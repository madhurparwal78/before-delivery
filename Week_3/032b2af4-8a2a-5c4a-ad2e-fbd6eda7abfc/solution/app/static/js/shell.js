import { api, currentAthlete, logOut } from "./core/api.js";
import { $, $$, h, notice } from "./core/dom.js";
import { initials } from "./core/format.js";

const header = $("[data-site-header]");
const drawer = $("[data-drawer]");
const overlay = $("[data-drawer-overlay]");
const menuButton = $("[data-menu-button]");
const behindDrawer = ["header", "main", "footer", "[data-consent]"];

/* ---------- drawer: slides in from the left, keeps focus inside, closes on Escape ---------- */
function focusable() {
  return $$("a[href], button:not([disabled]), input, select, textarea", drawer).filter((el) => el.checkVisibility());
}

function setBackgroundInert(value) {
  for (const selector of behindDrawer) for (const el of $$(selector)) el.toggleAttribute("inert", value);
}

function openDrawer() {
  drawer.classList.add("is-open");
  overlay.classList.add("is-open");
  menuButton.setAttribute("aria-expanded", "true");
  setBackgroundInert(true);
  (focusable()[0] || drawer).focus();
}

function closeDrawer() {
  if (!drawer.classList.contains("is-open")) return;
  drawer.classList.remove("is-open");
  overlay.classList.remove("is-open");
  menuButton.setAttribute("aria-expanded", "false");
  setBackgroundInert(false);
  menuButton.focus();
}

menuButton.addEventListener("click", () => (drawer.classList.contains("is-open") ? closeDrawer() : openDrawer()));
$("[data-drawer-close]").addEventListener("click", closeDrawer);
overlay.addEventListener("click", closeDrawer);
drawer.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeDrawer();
  } else if (event.key === "Tab") {
    const items = focusable();
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});
addEventListener("resize", () => {
  if (innerWidth >= 900) closeDrawer();
});

/* ---------- dropdown menus (Activities, avatar) ---------- */
const menus = [];
function wireMenu(button) {
  const panel = document.getElementById(button.getAttribute("aria-controls"));
  const set = (open) => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  menus.push(() => set(false));
  button.addEventListener("click", () => {
    const open = panel.hidden;
    for (const closeOther of menus) closeOther();
    set(open);
  });
  document.addEventListener("click", (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) set(false);
  });
  panel.parentElement.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      set(false);
      button.focus();
    }
  });
}
for (const button of $$(".nav-menu-button, .avatar-button")) wireMenu(button);

/* ---------- header: hides on scroll down, returns on scroll up; turns solid past a dark hero ---------- */
const dark = header.classList.contains("on-dark");
let lastY = scrollY;
function setHidden(hidden) {
  header.classList.toggle("is-hidden", hidden);
  document.body.classList.toggle("header-hidden", hidden);
}
function watchScroll() {
  const y = scrollY;
  if (y !== lastY) {
    const delta = y - lastY;
    const busy = header.contains(document.activeElement) || drawer.classList.contains("is-open");
    if (y <= header.offsetHeight || delta < -4) setHidden(false);
    else if (delta > 4 && !busy) setHidden(true);
    if (dark) header.classList.toggle("is-solid", y > 80);
    lastY = y;
  }
  requestAnimationFrame(watchScroll);
}
requestAnimationFrame(watchScroll);
header.addEventListener("focusin", () => setHidden(false));
if (dark && scrollY > 80) header.classList.add("is-solid");

/* ---------- consent bar ---------- */
const consent = $("[data-consent]");
if (consent) {
  const reserve = () => document.documentElement.style.setProperty("--consent-h", consent.checkVisibility() ? `${consent.offsetHeight}px` : "0px");
  new ResizeObserver(reserve).observe(consent);
  reserve();
  for (const button of $$("[data-consent-dismiss]", consent)) {
    button.addEventListener("click", () => {
      localStorage.setItem("pacely-consent-dismissed", "1");
      document.documentElement.dataset.consent = "done";
      document.documentElement.style.setProperty("--consent-h", "0px");
    });
  }
}

/* ---------- Google and Apple: only email is available ---------- */
for (const button of $$("[data-social]")) {
  button.addEventListener("click", () => {
    const slot = $("[data-social-note]", button.closest("[data-social-area]"));
    const signIn = button.textContent.includes("Sign In");
    slot.replaceChildren(notice("info", signIn
      ? "Only email sign in is available on Pacely. Use your email and password below."
      : "Only email sign up is available on Pacely. Use Sign Up With Email to create your account."));
  });
}

/* ---------- signed-in chrome ---------- */
for (const button of $$("[data-logout]")) button.addEventListener("click", logOut);

async function initMember() {
  const me = await currentAthlete();
  if (me) {
    for (const el of $$("[data-initials]")) el.textContent = initials(me.name);
    for (const el of $$("[data-avatar-name]")) el.textContent = `Account menu for ${me.name}`;
    for (const link of $$("[data-profile-link]")) link.href = `/athletes/${me.id}`;
  } else {
    document.documentElement.dataset.auth = "guest";
  }

  /* ---------- header segment search ---------- */
  const searchForm = $("[data-segment-search]");
  if (searchForm && me) {
    const input = $("input", searchForm);
    const results = $(".search-results", searchForm);
    let latest = 0;
    const show = (items) => {
      results.replaceChildren(...(items.length
        ? items.map((s) => h("li", {}, h("a", { href: `/segments/${s.id}`, text: s.name })))
        : [h("li", {}, h("p", { text: "No segments found" }))]));
      results.hidden = false;
    };
    input.addEventListener("input", async () => {
      const query = input.value.trim();
      const ticket = ++latest;
      if (!query) {
        results.hidden = true;
        return;
      }
      const result = await api(`/api/segments?q=${encodeURIComponent(query)}`);
      if (ticket === latest && result.ok) show(result.data.segments.slice(0, 6));
    });
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const first = $("a", results);
      if (first) location.assign(first.href);
    });
    document.addEventListener("click", (event) => {
      if (!searchForm.contains(event.target)) results.hidden = true;
    });
    searchForm.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        results.hidden = true;
        input.focus();
      }
    });
  }

}
initMember();
