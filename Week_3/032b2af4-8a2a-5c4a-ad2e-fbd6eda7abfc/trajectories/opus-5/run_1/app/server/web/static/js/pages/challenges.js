import { api, token } from "../api.js";
import { duration, element, thousands } from "../format.js";

const MEASURES = {
  distance: ["distance", "single_distance"],
  "elevation-gain": ["elevation"],
  "moving-time": ["moving_time"],
};

function matches(card, slug) {
  if (!slug) return true;
  if (slug in MEASURES) return MEASURES[slug].includes(card.dataset.dimension);
  return card.dataset.sports.split(",").includes(slug);
}

function applyFilter(slug) {
  document.querySelectorAll("[data-chip]").forEach((chip) =>
    chip.setAttribute("aria-pressed", String(chip.dataset.chip === slug))
  );
  document.querySelectorAll("[data-gallery]").forEach((gallery) => {
    let shown = 0;
    gallery.querySelectorAll("[data-challenge]").forEach((card) => {
      const keep = matches(card, slug);
      card.hidden = !keep;
      if (keep) shown += 1;
    });
    document.querySelector(`[data-empty="${gallery.dataset.gallery}"]`).hidden = shown > 0;
  });
}

function progressFigure(challenge) {
  if (challenge.dimension === "moving_time") return duration(challenge.progress);
  if (challenge.dimension === "elevation") return `${thousands(challenge.progress)} m`;
  return `${(challenge.progress / 1000).toFixed(2)} km`;
}

function ring(challenge) {
  const percent = Math.min(100, Math.floor((challenge.progress / challenge.goal) * 100));
  const wrapper = element("div", { class: "ring-wrap" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", "48");
  svg.setAttribute("height", "48");
  svg.setAttribute("role", "progressbar");
  svg.setAttribute("aria-label", challenge.name);
  svg.setAttribute("aria-valuenow", String(percent));
  svg.setAttribute("aria-valuemin", "0");
  svg.setAttribute("aria-valuemax", "100");
  const circumference = 2 * Math.PI * 20;
  svg.innerHTML =
    '<circle cx="24" cy="24" r="20" fill="none" stroke="var(--line)" stroke-width="6"></circle>' +
    `<circle cx="24" cy="24" r="20" fill="none" stroke="var(--orange)" stroke-width="6"
      stroke-linecap="round" transform="rotate(-90 24 24)"
      stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - percent / 100)}"></circle>`;
  wrapper.append(svg);
  wrapper.append(
    element("p", {
      class: "small",
      text: challenge.completed ? `Completed — ${progressFigure(challenge)} (${percent}%)` : `${progressFigure(challenge)} (${percent}%)`,
    })
  );
  return wrapper;
}

async function showProgress() {
  if (!token()) return;
  const { ok, data } = await api("/api/challenges");
  if (!ok) return;
  const status = document.querySelector("[data-challenge-status]");
  data.challenges.forEach((challenge) => {
    document.querySelectorAll(`[data-challenge="${challenge.id}"]`).forEach((card) => {
      const slot = card.querySelector("[data-challenge-progress]");
      const button = card.querySelector("[data-join]");
      const dates = card.querySelector("[data-challenge-dates]");
      if (dates) {
        dates.textContent = `${challenge.starts_at.slice(0, 10)} to ${challenge.ends_at.slice(0, 10)}`;
      }
      slot.textContent = "";
      if (challenge.joined) {
        slot.hidden = false;
        slot.replaceWith(ring(challenge));
        button.textContent = "Leave challenge";
        button.dataset.joined = "true";
      } else {
        slot.hidden = true;
        button.dataset.joined = "false";
      }
    });
  });
  if (status) status.textContent = "";
}

function joining() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-join]");
    if (!button) return;
    if (!token()) {
      window.location.href = "/login";
      return;
    }
    const id = button.dataset.join;
    const joined = button.dataset.joined === "true";
    await api(`/api/challenges/${id}/join`, { method: joined ? "DELETE" : "POST" });
    window.location.reload();
  });
}

export function init() {
  const start = new URLSearchParams(window.location.search).get("filter") || "";
  applyFilter(start);

  document.querySelectorAll("[data-chip]").forEach((chip) =>
    chip.addEventListener("click", () => {
      const pressed = chip.getAttribute("aria-pressed") === "true";
      const slug = pressed ? "" : chip.dataset.chip;
      applyFilter(slug);
      const url = slug ? `/challenges?filter=${slug}` : "/challenges";
      window.history.pushState({ filter: slug }, "", url);
    })
  );

  window.addEventListener("popstate", () => {
    applyFilter(new URLSearchParams(window.location.search).get("filter") || "");
  });

  joining();
  showProgress();
}
