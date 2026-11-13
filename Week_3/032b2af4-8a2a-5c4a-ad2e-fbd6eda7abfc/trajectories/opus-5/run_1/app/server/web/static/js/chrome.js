import { api, clearToken, setToken, token } from "./api.js";
import { reducedMotion } from "./format.js";

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

function headerBehaviour() {
  const header = document.querySelector("[data-header]");
  if (!header) return;
  let last = window.scrollY;
  window.addEventListener(
    "scroll",
    () => {
      const current = window.scrollY;
      header.classList.toggle("is-stuck", current > 8);
      if (reducedMotion()) {
        header.classList.remove("is-hidden");
      } else {
        header.classList.toggle("is-hidden", current > last && current > 120);
      }
      last = current;
    },
    { passive: true }
  );
}

function drawer() {
  const open = document.querySelector("[data-drawer-open]");
  const panel = document.querySelector("[data-drawer]");
  if (!open || !panel) return;
  const close = panel.querySelector("[data-drawer-close]");
  const overlay = panel.querySelector("[data-drawer-overlay]");

  const show = () => {
    panel.hidden = false;
    open.setAttribute("aria-expanded", "true");
    (panel.querySelector(FOCUSABLE) || panel).focus();
  };
  const hide = () => {
    panel.hidden = true;
    open.setAttribute("aria-expanded", "false");
    open.focus();
  };

  open.addEventListener("click", show);
  close.addEventListener("click", hide);
  overlay.addEventListener("click", hide);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hide();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

function dropdowns() {
  document.querySelectorAll("[data-dropdown]").forEach((wrapper) => {
    const toggle = wrapper.querySelector("[data-dropdown-toggle]");
    const panel = wrapper.querySelector("[data-dropdown-panel]");
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      panel.hidden = open;
    });
    wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
    document.addEventListener("click", (event) => {
      if (!wrapper.contains(event.target) && !panel.hidden) {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  });
}

function consentBar() {
  const bar = document.querySelector("[data-consent]");
  if (!bar) return;
  if (localStorage.getItem("pacely_consent") === "dismissed") return;
  bar.hidden = false;
  bar.querySelectorAll("[data-consent-dismiss]").forEach((button) =>
    button.addEventListener("click", () => {
      localStorage.setItem("pacely_consent", "dismissed");
      bar.hidden = true;
    })
  );
}

function socialNotes() {
  document.querySelectorAll("[data-social-signup]").forEach((button) =>
    button.addEventListener("click", () => {
      let host = button.parentElement;
      while (host && !host.querySelector("[data-social-note]")) host = host.parentElement;
      const note = host && host.querySelector("[data-social-note]");
      if (note) note.textContent = "Only email sign up is available on Pacely right now.";
    })
  );
}

function reveals() {
  const nodes = document.querySelectorAll("[data-reveal]");
  if (!nodes.length) return;
  if (reducedMotion() || !("IntersectionObserver" in window)) return;
  const watcher = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("reveal");
          watcher.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  nodes.forEach((node) => watcher.observe(node));
}

function heroVideo() {
  const video = document.querySelector("[data-hero-video]");
  const button = document.querySelector("[data-hero-play]");
  if (!video || !button) return;
  const play = () => {
    video.play().then(() => {
      button.textContent = "Pause video";
    });
  };
  if (!reducedMotion()) play();
  button.addEventListener("click", () => {
    if (video.paused) play();
    else {
      video.pause();
      button.textContent = "Play video";
    }
  });
}

function logout() {
  document.querySelectorAll("[data-logout]").forEach((button) =>
    button.addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" });
      clearToken();
      window.location.href = "/";
    })
  );
}

function segmentSearch() {
  const form = document.querySelector("[data-segment-search]");
  if (!form) return;
  const field = form.querySelector("input");
  const results = form.querySelector("[data-segment-results]");
  form.addEventListener("submit", (event) => event.preventDefault());
  field.addEventListener("input", async () => {
    const text = field.value.trim();
    if (!text) {
      results.hidden = true;
      results.textContent = "";
      return;
    }
    const { data } = await api(`/api/segments?q=${encodeURIComponent(text)}`);
    results.textContent = "";
    (data?.segments || []).slice(0, 6).forEach((segment) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.className = "nav-link";
      link.href = `/segments/${segment.id}`;
      link.textContent = segment.name;
      item.append(link);
      results.append(item);
    });
    results.hidden = false;
  });
}

async function syncSession() {
  const signedInServerSide = Boolean(document.body.dataset.athleteId);
  const session = token();
  if (Boolean(session) === signedInServerSide) return;
  if (!session) return;
  if (sessionStorage.getItem("pacely_synced") === session) return;
  sessionStorage.setItem("pacely_synced", session);
  const { ok } = await api("/api/me");
  if (!ok) {
    clearToken();
    return;
  }
  setToken(session);
  window.location.reload();
}

export function initChrome() {
  headerBehaviour();
  drawer();
  dropdowns();
  consentBar();
  socialNotes();
  reveals();
  heroVideo();
  logout();
  segmentSearch();
  syncSession();
}
