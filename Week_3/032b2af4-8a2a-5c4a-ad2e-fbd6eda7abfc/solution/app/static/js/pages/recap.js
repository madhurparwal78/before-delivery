import { api, requireMember } from "../core/api.js";
import { $, $$, h } from "../core/dom.js";
import { km, SPORT_NAMES, thousands } from "../core/format.js";
import { reducedMotion } from "../core/motion.js";

const SLIDES = 5;
const ADVANCE_MS = 5000;
const card = $("[data-recap-card]");
const status = $("[data-recap-status]");
const segments = $$(".recap-seg", $("[data-segments]"));
const audio = $("[data-audio]");
const playButton = $("[data-play]");
const muteButton = $("[data-mute]");
const previous = $("[data-prev]");
const next = $("[data-next]");

let recap = null;
let longest = null;
let index = 0;
let playing = false;
let timer = null;

function slideContent(i) {
  if (!recap) return { label: "Loading", figure: "", line: "" };
  const year = recap.year;
  if (i === 0) return { label: "Total distance", figure: `${thousands(recap.distance_m / 1000, 1)} km`, line: `covered in ${year}` };
  if (i === 1) return { label: "Activities", figure: thousands(recap.activity_count), line: `recorded in ${year}` };
  if (i === 2) return { label: "Elevation gain", figure: `${thousands(recap.elevation_gain_m)} m`, line: `climbed in ${year}` };
  if (i === 3) {
    return longest
      ? { label: "Longest activity", figure: `${km(longest.distance_m)} km`, line: longest.name }
      : { label: "Longest activity", figure: "None yet", line: `No activity recorded in ${year}` };
  }
  return recap.top_sport
    ? { label: "Top sport", figure: SPORT_NAMES[recap.top_sport], line: `Your most frequent sport in ${year}` }
    : { label: "Top sport", figure: "None yet", line: `No activity recorded in ${year}` };
}

function paint() {
  const { label, figure, line } = slideContent(index);
  card.className = `recap-card tone-${index}`;
  card.replaceChildren(h("p", { class: "recap-label", text: label }), h("h1", { text: figure }), h("p", { class: "recap-line", text: line }));
  status.textContent = `Slide ${index + 1} of ${SLIDES}`;
  segments.forEach((segment, i) => {
    segment.classList.toggle("is-done", i < index);
    segment.classList.toggle("is-current", i === index);
    segment.classList.toggle("is-running", i === index && playing && !reducedMotion());
  });
  previous.disabled = index === 0;
  next.disabled = index === SLIDES - 1;
}

function schedule() {
  clearTimeout(timer);
  if (playing && !reducedMotion()) timer = setTimeout(advance, ADVANCE_MS);
}

function go(i) {
  index = Math.max(0, Math.min(SLIDES - 1, i));
  paint();
  schedule();
}

function advance() {
  if (index < SLIDES - 1) go(index + 1);
  else setPlaying(false);
}

function setPlaying(value) {
  playing = value;
  clearTimeout(timer);
  playButton.firstChild.firstChild.setAttribute("href", playing ? "#i-pause" : "#i-play");
  $("span", playButton).textContent = playing ? "Pause recap" : "Play recap";
  if (playing) audio.play().catch(() => {});
  else audio.pause();
  paint();
  schedule();
}

playButton.addEventListener("click", () => setPlaying(!playing));
previous.addEventListener("click", () => go(index - 1));
next.addEventListener("click", () => go(index + 1));
muteButton.addEventListener("click", () => {
  audio.muted = !audio.muted;
  muteButton.firstChild.firstChild.setAttribute("href", audio.muted ? "#i-volume-off" : "#i-volume");
  $("span", muteButton).textContent = audio.muted ? "Unmute" : "Mute";
});

paint();
requireMember().then(async () => {
  const result = await api("/api/athletes/me/recap");
  if (!result.ok) return;
  recap = result.data;
  if (recap.longest_activity_id !== null) {
    const found = await api(`/api/activities/${recap.longest_activity_id}`);
    longest = found.ok ? found.data : null;
  }
  paint();
});
