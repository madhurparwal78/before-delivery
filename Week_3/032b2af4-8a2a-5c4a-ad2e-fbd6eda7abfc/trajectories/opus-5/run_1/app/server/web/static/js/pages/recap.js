import { api } from "../api.js";
import { reducedMotion, thousands } from "../format.js";

const CARD_SECONDS = 5;
const SPORT_NAMES = { run: "Running", ride: "Riding", walk: "Walking", hike: "Hiking" };

let cards = [];
let current = 0;
let timer = null;

function show(index) {
  current = (index + cards.length) % cards.length;
  const card = cards[current];
  document.querySelector("[data-recap-label]").textContent = card.label;
  document.querySelector("[data-recap-figure]").textContent = card.figure;
  document.querySelector("[data-recap-note]").textContent = card.note;
  document.querySelector("[data-recap-counter]").textContent = `Slide ${current + 1} of ${cards.length}`;
  document.querySelectorAll("[data-recap-progress] span").forEach((segment, position) => {
    segment.classList.toggle("done", position < current);
    segment.classList.toggle("active", position === current);
  });
}

function buildCards(recap, longestName) {
  return [
    {
      label: "Total distance",
      figure: `${thousands(recap.distance_m / 1000, 1)} km`,
      note: "Every kilometre you covered this year.",
    },
    { label: "Activities", figure: thousands(recap.activity_count), note: "Times you headed out." },
    {
      label: "Total elevation gain",
      figure: `${thousands(recap.elevation_gain_m)} m`,
      note: "Everything you climbed along the way.",
    },
    {
      label: "Longest activity",
      figure: longestName ? `${longestName.name} — ${(longestName.distance_m / 1000).toFixed(1)} km` : "None yet",
      note: "Your biggest single effort.",
    },
    {
      label: "Top sport",
      figure: recap.top_sport ? SPORT_NAMES[recap.top_sport] : "None yet",
      note: `${thousands(recap.kudos_received)} kudos received this year.`,
    },
  ];
}

function player() {
  const play = document.querySelector("[data-recap-play]");
  const mute = document.querySelector("[data-recap-mute]");
  const audio = document.querySelector("[data-recap-audio]");

  const stop = () => {
    clearInterval(timer);
    timer = null;
    audio.pause();
    play.textContent = "Play recap";
    play.setAttribute("aria-pressed", "false");
  };

  play.addEventListener("click", () => {
    if (timer) {
      stop();
      return;
    }
    audio.play().catch(() => {});
    play.textContent = "Pause recap";
    play.setAttribute("aria-pressed", "true");
    if (reducedMotion()) return;
    timer = setInterval(() => show(current + 1), CARD_SECONDS * 1000);
  });

  mute.addEventListener("click", () => {
    audio.muted = !audio.muted;
    mute.textContent = audio.muted ? "Unmute" : "Mute";
    mute.setAttribute("aria-pressed", String(audio.muted));
  });

  document.querySelector("[data-recap-next]").addEventListener("click", () => show(current + 1));
  document.querySelector("[data-recap-previous]").addEventListener("click", () => show(current - 1));
}

export async function init() {
  const { ok, data } = await api("/api/athletes/me/recap");
  if (!ok) {
    window.location.replace("/login");
    return;
  }
  let longest = null;
  if (data.longest_activity_id) {
    const activity = await api(`/api/activities/${data.longest_activity_id}`);
    if (activity.ok) longest = activity.data;
  }
  cards = buildCards(data, longest);
  document.querySelector("[data-recap-empty]").hidden = data.activity_count > 0;
  show(0);
  player();
}
