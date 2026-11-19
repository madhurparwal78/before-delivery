// The event page: hero, event bar, case file, team band, trail, webinar, leaderboard and FAQ.
import {
  $, $$, OUTAGE, api, isOutage, listen, pauseOffscreen, playCue, reducedMotion, riseOnEnter, showState, signedIn,
  start, stateWord, wireSound,
} from "./common.js";
import { announce, openDialog } from "./dialog.js";
import { wireLeaderboard } from "./leaderboard.js";
import { wireTail } from "./tail.js";
import { acceptInviteLink, wireTeamBand } from "./teamband.js";
import { wireTrail } from "./trail.js";

start();
wireTeamBand();
acceptInviteLink();

const hero = $("[data-hero]");
wireTail($("[data-tail]"), hero);
[hero, $(".count-band"), $(".trust"), $(".details-card")].forEach(pauseOffscreen);
riseOnEnter();

/* Event bar: in the document only while no part of the hero is in view. */
const barTemplate = $("[data-event-bar]");
let bar = null;
new IntersectionObserver(([entry]) => {
  if (entry.isIntersecting) {
    bar?.remove();
    bar = null;
  } else if (!bar) {
    bar = barTemplate.content.firstElementChild.cloneNode(true);
    barTemplate.after(bar);
    wireSound(bar);
  }
}).observe(hero);

/* Briefing film: plays muted while wanted and on screen; reduced motion keeps it paused on its poster. */
const film = $("[data-film]");
const filmToggle = $("[data-film-toggle]");
let filmWanted = !reducedMotion.matches;
let filmVisible = false;
function syncFilm() {
  $("[data-film-label]", filmToggle).textContent = filmWanted ? "Pause briefing" : "Play briefing";
  filmToggle.classList.toggle("is-paused", !filmWanted);
  if (filmWanted && filmVisible) film.play().catch(() => {});
  else film.pause();
}
filmToggle.addEventListener("click", () => {
  filmWanted = !filmWanted;
  syncFilm();
});
new IntersectionObserver(([entry]) => {
  filmVisible = entry.isIntersecting;
  syncFilm();
}, { threshold: 0.25 }).observe(film);
syncFilm();

/* Prizes and FAQ */
$("[data-open-prizes]").addEventListener("click", (event) => openDialog($("#prizes-dialog"), event.currentTarget));
$$("[data-faq]").forEach((button) => button.addEventListener("click", () => {
  const open = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(open));
  document.getElementById(button.getAttribute("aria-controls")).hidden = !open;
}));

/* Webinar */
const webinarRegion = $("[data-webinar-region]");
$("[data-copy-link]").addEventListener("click", async () => {
  const link = `${window.location.origin}/downtime#webinar`;
  try {
    await navigator.clipboard.writeText(link);
    announce(webinarRegion, "Link copied", "success");
  } catch {
    announce(webinarRegion, `Copy this link: ${link}`);
  }
});
const webinarForm = $("[data-webinar-form]");
const WEBINAR_ERRORS = { already_claimed: "Already claimed", wrong_flag: "That flag is not right", validation: "Enter a flag" };
webinarForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("button[type='submit']", webinarForm);
  submit.disabled = true;
  announce(webinarRegion, "Claiming…");
  const result = await api("/api/webinar/flag", { method: "POST", body: { flag: webinarForm.elements.flag.value } });
  submit.disabled = false;
  if (result.status === 200) {
    announce(webinarRegion, "+2 raffle tickets claimed", "success");
    playCue("solved");
  } else {
    announce(webinarRegion, isOutage(result) ? OUTAGE : WEBINAR_ERRORS[result.data?.error] ?? OUTAGE, "error");
    if (result.data?.error === "wrong_flag") playCue("wrong");
  }
});

/* Trail and the signed-in player's states */
wireTrail();
const steps = $$(".trail-step");
let myTeam = null;
async function showTrailStates() {
  if (!signedIn()) return;
  const room = await api("/api/teams/mine");
  let states;
  if (room.status === 200) {
    myTeam = room.data.team.id;
    states = room.data.scenarios;
  } else if (room.status === 404) {
    myTeam = null;
    const each = await Promise.all(steps.map((step) => api(`/api/scenarios/${step.dataset.slug}`)));
    if (each.some((r) => r.status !== 200)) return;
    states = each.map((r, i) => ({ slug: steps[i].dataset.slug, ...r.data }));
  } else {
    return;
  }
  for (const state of states) showState($(`[data-slug="${state.slug}"] [data-state]`), stateWord(state));
}
showTrailStates();

/* Leaderboard and live updates */
const titles = new Map(steps.map((step) => [step.dataset.slug, $(".scenario-title a", step).textContent]));
const board = wireLeaderboard(titles);
let lost = false;
listen((name, data) => {
  if (name === "score") board.scored(data);
  if (data.team_id === myTeam) showTrailStates();
}, (state) => {
  if (state === "lost") {
    lost = true;
    board.lost();
  } else if (lost) {
    lost = false;
    board.reconnected();
    showTrailStates();
  }
});
document.addEventListener("session-ended", () => $$("[data-state]").forEach((el) => el.replaceChildren()));
