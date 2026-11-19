/* The scenario page: the flag form and stepping between scenarios. */

import {
  OUTAGE_COPY,
  announce,
  api,
  playCue,
  startChrome,
  stateWord,
} from "./core.js";

const KIND_LABELS = {
  "soc-sim": "SOC Sim Scenario",
  "th-sim": "Threat Hunting Sim Scenario",
  tabletop: "Tabletop Exercise",
  challenge: "Challenge",
};

const FLAG_ERRORS = {
  no_team: "Join or create a team first",
  validation: "Enter a flag",
  too_many_attempts: "Too many wrong flags. Try again in a minute.",
  unknown_scenario: OUTAGE_COPY,
};

const root = document.querySelector("[data-scenario-root]");
const field = document.querySelector("[data-flag-field]");
const form = document.querySelector("[data-flag-form]");
const badge = document.querySelector("[data-solved-badge]");
const stateLine = document.querySelector("[data-scenario-state]");
const previousButton = document.querySelector("[data-previous-scenario]");
const nextButton = document.querySelector("[data-next-scenario]");

let scenarios = [];
let shown = root.dataset.scenario;

function neighbours(slug) {
  const place = scenarios.findIndex((scenario) => scenario.slug === slug);
  return {
    previous: place > 0 ? scenarios[place - 1] : null,
    next: place >= 0 && place < scenarios.length - 1 ? scenarios[place + 1] : null,
  };
}

function paint(scenario, state) {
  shown = scenario.slug;
  root.dataset.scenario = scenario.slug;
  document.querySelector("[data-scenario-number]").textContent = String(
    scenario.number,
  ).padStart(2, "0");
  document.querySelector("[data-scenario-title]").textContent = scenario.title;
  document.querySelector("[data-scenario-kind]").textContent =
    KIND_LABELS[scenario.kind] || scenario.kind;
  document.querySelector("[data-scenario-description]").textContent =
    scenario.description;
  document.querySelector("[data-scenario-points]").textContent = String(
    scenario.points,
  );
  badge.hidden = !state.team_solved;
  if (state.solved_by_me) stateLine.innerHTML = stateWord("Solved by me", true);
  else if (state.team_solved)
    stateLine.innerHTML = stateWord("Solved by the team", true);
  else if (state.attempted_by_me)
    stateLine.innerHTML = stateWord("Attempted", false);
  else stateLine.innerHTML = stateWord("Not attempted", false);

  const step = neighbours(scenario.slug);
  previousButton.disabled = !step.previous;
  nextButton.disabled = !step.next;
  previousButton.dataset.target = step.previous ? step.previous.slug : "";
  nextButton.dataset.target = step.next ? step.next.slug : "";
  document.title = `${scenario.title} | Downtime | NightWard`;
}

async function show(slug) {
  const { status, data, outage } = await api("GET", `/api/scenarios/${slug}`);
  if (outage || status !== 200 || !data) {
    announce("Flag result", OUTAGE_COPY, "error");
    return false;
  }
  paint(data.scenario, data);
  return true;
}

async function step(slug) {
  if (!slug) return;
  field.value = "";
  announce("Flag result", "");
  const moved = await show(slug);
  if (moved) history.pushState({ slug }, "", `/downtime/scenarios/${slug}`);
}

function setUpSteps() {
  previousButton.addEventListener("click", () =>
    step(previousButton.dataset.target),
  );
  nextButton.addEventListener("click", () => step(nextButton.dataset.target));
  window.addEventListener("popstate", () => {
    const slug = location.pathname.split("/").pop();
    field.value = "";
    announce("Flag result", "");
    show(slug);
  });
}

function setUpFlagForm() {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    announce("Flag result", "Checking flag…");
    const { status, data, outage } = await api(
      "POST",
      `/api/scenarios/${shown}/flag`,
      { flag: field.value },
    );
    button.disabled = false;
    if (outage || status === 0) {
      announce("Flag result", OUTAGE_COPY, "error");
      return;
    }
    if (status === 200 && data.correct && data.already_completed) {
      announce("Flag result", "Already completed");
      await show(shown);
      return;
    }
    if (status === 200 && data.correct) {
      announce(
        "Flag result",
        `Solved! +${data.team_points_awarded} for your team and +1 raffle ticket`,
      );
      playCue("correct");
      field.value = "";
      await show(shown);
      return;
    }
    if (status === 200) {
      announce("Flag result", "That flag is not right", "error");
      playCue("wrong");
      await show(shown);
      return;
    }
    announce(
      "Flag result",
      FLAG_ERRORS[data && data.error] || OUTAGE_COPY,
      "error",
    );
  });
}

async function start() {
  await startChrome();
  const listed = await api("GET", "/api/scenarios");
  if (listed.data && listed.data.scenarios) scenarios = listed.data.scenarios;
  setUpSteps();
  setUpFlagForm();
  await show(shown);
  document.addEventListener("downtime:session", () => show(shown));
}

start();
