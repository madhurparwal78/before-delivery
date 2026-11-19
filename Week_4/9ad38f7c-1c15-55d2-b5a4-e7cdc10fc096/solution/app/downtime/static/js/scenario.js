// The scenario page: the player's state, the solved badge, the flag form and in-place stepping between scenarios.
import { $, $$, OUTAGE, api, icon, isOutage, playCue, reducedMotion, showState, signedIn, start, stateWord } from "./common.js";
import { announce } from "./dialog.js";

start();

const page = $("[data-scenario]");
let slug = page.dataset.scenario;
let loads = 0;
const stateEl = $("[data-state]", page);
const badgeSlot = $("[data-badge-slot]");
const form = $("[data-flag-form]");
const region = $("[data-flag-region]");
const ERRORS = {
  no_team: "Join or create a team first",
  too_many_attempts: "Too many wrong flags. Try again in a minute.",
  validation: "Enter a flag",
};
let state = { team_solved: false, solved_by_me: false, attempted_by_me: false };

function showBadge(pop) {
  if (badgeSlot.firstElementChild) return;
  const badge = document.createElement("span");
  badge.className = "solved-badge";
  badge.append(icon("tick"), "Solved");
  badgeSlot.append(badge);
  if (pop && !reducedMotion.matches) {
    badge.animate([
      { transform: "scale(0.6)", opacity: 0 },
      { transform: "scale(1.14)", opacity: 1, offset: 0.6 },
      { transform: "scale(1)", opacity: 1 },
    ], { duration: 320, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
  }
}

function render(pop = false) {
  showState(stateEl, stateWord(state));
  $("[data-orb]").classList.toggle("is-lit", state.team_solved);
  if (state.team_solved) showBadge(pop);
}

async function load() {
  if (!signedIn()) {
    stateEl.closest(".scenario-status").hidden = true; // a visitor has no state or badge to show
    return;
  }
  const ticket = ++loads;
  const result = await api(`/api/scenarios/${slug}`);
  if (ticket !== loads) return; // a newer scenario is on screen
  if (result.status === 200) {
    state = { team_solved: result.data.team_solved, solved_by_me: result.data.solved_by_me, attempted_by_me: result.data.attempted_by_me };
    render();
  } else if (isOutage(result)) {
    announce(region, OUTAGE, "outage");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const field = form.elements.flag;
  if (!field.value.trim()) {
    announce(region, "Enter a flag", "error");
    field.focus();
    return;
  }
  const submit = $("button[type='submit']", form);
  submit.disabled = true;
  announce(region, "Checking flag…");
  const target = slug;
  const result = await api(`/api/scenarios/${target}/flag`, { method: "POST", body: { flag: field.value } });
  submit.disabled = false;
  if (target !== slug) return; // the player stepped to another scenario meanwhile
  if (result.status !== 200) {
    announce(region, isOutage(result) ? OUTAGE : ERRORS[result.data?.error] ?? OUTAGE, "error");
    return;
  }
  const outcome = result.data;
  if (!outcome.correct) {
    state.attempted_by_me = true;
    announce(region, "That flag is not right", "error");
    playCue("wrong");
  } else if (outcome.already_completed) {
    announce(region, "Already completed", "success");
  } else {
    state = { ...state, solved_by_me: true, team_solved: true };
    announce(region, `Solved! +${outcome.team_points_awarded} for your team and +1 raffle ticket`, "success");
    playCue("solved");
  }
  render(true);
});

/* Scenario stepping: neighbours load in place with one history entry each; Back and Forward keep focus. */
const KIND_LABELS = { "soc-sim": "SOC Sim Scenario", "th-sim": "Threat Hunting Sim Scenario", tabletop: "Tabletop Exercise", challenge: "Challenge" };
const steps = $$("[data-step]");
let catalogue = null;

async function scenarios() {
  if (catalogue) return catalogue;
  const result = await api("/api/scenarios");
  if (result.status !== 200) return null;
  catalogue = result.data.scenarios;
  return catalogue;
}

function show(scenario) {
  const two = String(scenario.number).padStart(2, "0");
  slug = scenario.slug;
  page.dataset.scenario = scenario.slug;
  page.dataset.number = String(scenario.number);
  page.dataset.points = String(scenario.points);
  $("[data-kicker-number]").textContent = two;
  $("[data-orb]").textContent = two;
  $("[data-scenario-number]").textContent = `Scenario ${two}`;
  $("[data-scenario-title]").textContent = scenario.title;
  $("[data-scenario-kind]").textContent = KIND_LABELS[scenario.kind];
  $("[data-scenario-points]").textContent = String(scenario.points);
  $("[data-scenario-description]").textContent = scenario.description;
  const login = $("[data-scenario-login]");
  if (login) login.href = `/login?redirect=${encodeURIComponent(`/downtime/scenarios/${scenario.slug}`)}`;
  document.title = `${scenario.title} · Downtime · NightWard`;
  steps.forEach((button) => {
    const to = scenario.number + Number(button.dataset.step);
    button.disabled = to < 1 || to > 8;
  });
  form.reset();
  announce(region, "");
  badgeSlot.replaceChildren();
  state = { team_solved: false, solved_by_me: false, attempted_by_me: false };
  render();
  load();
}

steps.forEach((button) => button.addEventListener("click", async () => {
  const list = await scenarios();
  if (!list) return announce(region, OUTAGE, "outage");
  const to = list.find((s) => s.number === Number(page.dataset.number) + Number(button.dataset.step));
  if (!to) return;
  window.history.pushState(window.history.state, "", `/downtime/scenarios/${to.slug}`);
  show(to);
}));

window.addEventListener("popstate", async () => {
  const wanted = window.location.pathname.replace(/^\/downtime\/scenarios\//, "");
  if (wanted === slug) return;
  const list = await scenarios();
  const to = list?.find((s) => s.slug === wanted);
  if (to) show(to);
  else window.location.reload();
});

load();
