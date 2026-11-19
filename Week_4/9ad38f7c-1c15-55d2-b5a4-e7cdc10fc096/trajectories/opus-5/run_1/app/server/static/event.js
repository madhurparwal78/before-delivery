/* The event page: the live leaderboard, the trail, the webinar and the hero. */

import {
  OUTAGE_COPY,
  announce,
  api,
  connectStream,
  escapeText,
  prefersReducedMotion,
  refreshSoundToggles,
  session,
  startChrome,
  stateWord,
} from "./core.js";
import { openJoinDialog, setUpTeamActions } from "./teams.js";

const BOARD_LIMIT = 5;
const JOIN_EVENT_TARGET = "/signup?redirect=%2Fdowntime";
const WEBINAR_ERRORS = {
  already_claimed: "Already claimed",
  wrong_flag: "That flag is not right",
};

const rows = document.querySelector("[data-board-rows]");
const numbers = document.querySelector("[data-board-numbers]");
const line = document.querySelector("[data-board-line]");
const previous = document.querySelector("[data-board-previous]");
const next = document.querySelector("[data-board-next]");
const feed = document.querySelector("[data-feed]");

let shownPage = 1;
let pageCount = 1;
let scenarioTitles = new Map();

/* -- the leaderboard page in the address ------------------------------ */
function askedPage() {
  const raw = new URLSearchParams(location.search).get("board");
  if (raw === null) return { raw, page: null };
  return { raw, page: /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null };
}

function addressForPage(page) {
  const url = new URL(location.href);
  if (page === 1) url.searchParams.delete("board");
  else url.searchParams.set("board", String(page));
  return `${url.pathname}${url.search}${url.hash}`;
}

function positions() {
  const places = new Map();
  rows.querySelectorAll("tr[data-team]").forEach((row) => {
    places.set(row.dataset.team, row.getBoundingClientRect().top);
  });
  return places;
}

function slideRows(before) {
  if (prefersReducedMotion()) return;
  rows.querySelectorAll("tr[data-team]").forEach((row) => {
    const was = before.get(row.dataset.team);
    if (was === undefined) return;
    const shift = was - row.getBoundingClientRect().top;
    if (Math.abs(shift) < 1) return;
    row.animate(
      [{ transform: `translateY(${shift}px)` }, { transform: "translateY(0)" }],
      { duration: 320, easing: "linear" },
    );
  });
}

function drawRows(entries) {
  rows.innerHTML = entries
    .map(
      (entry) => `<tr data-team="${entry.team_id}">
<td>${entry.rank}</td>
<td class="team-cell">${escapeText(entry.team_name)}</td>
<td class="sim-cell">${stateWord(entry.soc_sim, entry.soc_sim === "Passed")}</td>
<td class="sim-cell">${stateWord(entry.th_sim, entry.th_sim === "Passed")}</td>
<td class="sim-cell">${stateWord(
        entry.tabletop,
        entry.tabletop === "Completed",
      )}</td>
<td>${entry.challenges_solved}/${entry.challenges_total}</td>
<td><span class="points-value">${entry.points}</span> XP</td>
</tr>`,
    )
    .join("");
}

function shownNumbers(page, pages) {
  if (pages <= 7) {
    return Array.from({ length: pages }, (unused, index) => index + 1);
  }
  const wanted = new Set([1, pages, page - 1, page, page + 1]);
  return [...wanted].filter((value) => value >= 1 && value <= pages).sort(
    (first, second) => first - second,
  );
}

function drawPages(page, pages) {
  const shown = shownNumbers(page, pages);
  const pieces = [];
  shown.forEach((value, index) => {
    const gap = index === 0 ? 0 : value - shown[index - 1] - 1;
    if (gap === 1) {
      pieces.push(numberButton(value - 1, page));
    } else if (gap > 1) {
      pieces.push('<span class="page-gap" aria-hidden="true">…</span>');
    }
    pieces.push(numberButton(value, page));
  });
  numbers.innerHTML = pieces.join("");
  numbers.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () =>
      goToPage(Number(button.dataset.page)),
    );
  });
  previous.disabled = page <= 1;
  next.disabled = page >= pages;
}

function numberButton(value, page) {
  const current = value === page ? ' aria-current="page"' : "";
  return `<button type="button" class="page-button" data-page="${value}"${current}>${value}</button>`;
}

function drawFeed(items) {
  if (!feed || !items) return;
  feed.innerHTML = items
    .map(
      (item) =>
        `<li><span class="feed-team">${escapeText(
          item.team_name,
        )}</span> solved ${escapeText(item.scenario_title)}</li>`,
    )
    .join("");
}

async function loadBoard(page) {
  announce("Leaderboard updates", "Loading leaderboard…");
  const { data, outage } = await api(
    "GET",
    `/api/leaderboard?page=${page}&limit=${BOARD_LIMIT}&include_feed=1`,
  );
  if (!data || outage) {
    announce("Leaderboard updates", OUTAGE_COPY, "error");
    return null;
  }
  const before = positions();
  shownPage = data.page;
  pageCount = data.pages;
  drawRows(data.entries);
  slideRows(before);
  drawPages(data.page, data.pages);
  if (line) line.textContent = `${data.page} of ${data.pages} available pages`;
  drawFeed(data.feed);
  announce("Leaderboard updates", "");
  return data;
}

async function goToPage(page, push = true) {
  const data = await loadBoard(page);
  if (!data) return;
  if (push) history.pushState({ board: page }, "", addressForPage(page));
}

async function startBoard() {
  const { raw, page } = askedPage();
  const data = await loadBoard(page || 1);
  if (!data) return;
  if (page && page > data.pages) {
    await loadBoard(data.pages);
    history.replaceState({ board: data.pages }, "", addressForPage(data.pages));
    return;
  }
  if (raw !== null && (page === null || page === 1)) {
    history.replaceState({ board: 1 }, "", addressForPage(1));
  }
}

function setUpBoardControls() {
  previous.addEventListener("click", () => goToPage(Math.max(1, shownPage - 1)));
  next.addEventListener("click", () =>
    goToPage(Math.min(pageCount, shownPage + 1)),
  );
  window.addEventListener("popstate", () => {
    const { page } = askedPage();
    loadBoard(page || 1);
  });
}

/* -- the webinar ------------------------------------------------------ */
function setUpWebinar() {
  const copy = document.querySelector("[data-copy-webinar]");
  if (copy) {
    copy.addEventListener("click", async () => {
      const address = `${location.origin}/downtime#webinar`;
      try {
        await navigator.clipboard.writeText(address);
      } catch (error) {
        /* the clipboard is unavailable; the message still names the address */
      }
      announce("Webinar messages", "Link copied");
    });
  }
  const form = document.querySelector("[data-webinar-form]");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const field = form.querySelector("[data-webinar-flag]");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    announce("Webinar messages", "Claiming…");
    const { status, data, outage } = await api("POST", "/api/webinar/flag", {
      flag: field.value,
    });
    button.disabled = false;
    if (status === 200) {
      announce("Webinar messages", "+2 raffle tickets claimed");
      return;
    }
    announce(
      "Webinar messages",
      outage ? OUTAGE_COPY : WEBINAR_ERRORS[data && data.error] || OUTAGE_COPY,
      "error",
    );
  });
}

function paintSignedInParts(me) {
  const form = document.querySelector("[data-webinar-form]");
  const link = document.querySelector("[data-webinar-login]");
  if (form) form.hidden = !me;
  if (link) link.hidden = Boolean(me);
}

/* -- the trail -------------------------------------------------------- */
function paintTrailState(states) {
  states.forEach((state) => {
    const block = document.querySelector(
      `[data-block-state="${state.slug}"]`,
    );
    if (!block) return;
    if (state.solved_by_me) block.innerHTML = stateWord("Solved by me", true);
    else if (state.team_solved)
      block.innerHTML = stateWord("Solved by the team", true);
    else if (state.attempted_by_me) block.innerHTML = stateWord("Attempted", false);
    else block.innerHTML = stateWord("Not attempted", false);
  });
}

async function loadTrailState(me) {
  if (!me) {
    document
      .querySelectorAll("[data-block-state]")
      .forEach((block) => (block.innerHTML = ""));
    return;
  }
  if (me.team) {
    const { data } = await api("GET", "/api/teams/mine");
    if (data && data.scenarios) paintTrailState(data.scenarios);
    return;
  }
  paintTrailState(
    [...scenarioTitles.keys()].map((slug) => ({
      slug,
      solved_by_me: me.completions.includes(slug),
      team_solved: false,
      attempted_by_me: false,
    })),
  );
}

/* -- the event bar ---------------------------------------------------- */
function setUpEventBar() {
  const hero = document.querySelector("[data-hero]");
  if (!hero) return;
  let bar = null;
  const watcher = new IntersectionObserver(
    (entries) => {
      const heroShowing = entries[0].isIntersecting;
      if (heroShowing) {
        if (bar) {
          bar.remove();
          bar = null;
        }
        return;
      }
      if (bar) return;
      bar = document.createElement("div");
      bar.className = "event-bar";
      bar.setAttribute("role", "region");
      bar.setAttribute("aria-label", "Event bar");
      bar.innerHTML =
        "<strong>It's Downtime!</strong>" +
        `<a class="button button-lime" href="${JOIN_EVENT_TARGET}">Join event</a>` +
        '<button type="button" class="button button-dark" data-create-team>Create a team</button>' +
        '<button type="button" class="sound-toggle" data-sound-toggle aria-pressed="false" aria-label="Sound off">' +
        '<span class="sound-label" aria-hidden="true">Sound</span></button>';
      document.body.prepend(bar);
      refreshSoundToggles();
    },
    { threshold: 0 },
  );
  watcher.observe(hero);
}

/* -- the briefing film ------------------------------------------------ */
function setUpFilm() {
  const film = document.querySelector("[data-film]");
  const button = document.querySelector("[data-film-toggle]");
  if (!film || !button) return;
  let wanted = !prefersReducedMotion();
  let showing = false;
  const paint = () => {
    button.textContent = wanted ? "Pause briefing" : "Play briefing";
  };
  const settle = () => {
    if (wanted && showing) {
      const playing = film.play();
      if (playing && playing.catch) playing.catch(() => {});
    } else {
      film.pause();
    }
  };
  paint();
  button.addEventListener("click", () => {
    wanted = !wanted;
    paint();
    settle();
  });
  new IntersectionObserver(
    (entries) => {
      showing = entries[0].isIntersecting;
      settle();
    },
    { threshold: 0.2 },
  ).observe(film);
}

/* -- the hero tail ---------------------------------------------------- */
function setUpTail() {
  const canvas = document.querySelector("[data-tail]");
  const hero = document.querySelector("[data-hero]");
  if (!canvas || !hero) return;
  const surface = canvas.getContext("2d");
  const segments = 26;
  let lean = 0;
  let wanted = 0;
  let running = true;
  let frame = null;

  hero.addEventListener("pointermove", (event) => {
    const box = hero.getBoundingClientRect();
    wanted = ((event.clientX - box.left) / box.width - 0.3) * 1.2;
  });

  const draw = () => {
    lean += (wanted - lean) * 0.18;
    surface.clearRect(0, 0, canvas.width, canvas.height);
    let x = 20;
    let y = canvas.height - 10;
    let angle = -Math.PI / 2.1;
    for (let index = 0; index < segments; index += 1) {
      const length = 26 - index * 0.5;
      const width = 30 - index * 0.9;
      const nextX = x + Math.cos(angle) * length;
      const nextY = y + Math.sin(angle) * length;
      surface.strokeStyle = index % 2 === 0 ? "#f4f7ff" : "#05070e";
      surface.lineWidth = Math.max(2, width);
      surface.lineCap = "round";
      surface.beginPath();
      surface.moveTo(x, y);
      surface.lineTo(nextX, nextY);
      surface.stroke();
      x = nextX;
      y = nextY;
      angle += 0.14 + lean * 0.05 + Math.sin(index * 0.6) * 0.02;
    }
    if (running && !prefersReducedMotion()) frame = requestAnimationFrame(draw);
  };

  new IntersectionObserver((entries) => {
    running = entries[0].isIntersecting;
    if (running && frame === null) draw();
    if (!running && frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  }).observe(hero);
}

/* -- invite links ----------------------------------------------------- */
function handleJoinParameter(me) {
  const parameters = new URLSearchParams(location.search);
  const raw = parameters.get("join");
  if (raw === null) return;
  parameters.delete("join");
  const query = parameters.toString();
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${query ? `?${query}` : ""}${location.hash}`,
  );
  if (!/^[A-Za-z0-9]{8}$/.test(raw)) return;
  const code = raw.toUpperCase();
  if (me) {
    openJoinDialog(code);
    return;
  }
  const back = `/downtime?join=${code}#registration`;
  location.assign(`/login?redirect=${encodeURIComponent(back)}`);
}

/* -- start ------------------------------------------------------------ */
async function start() {
  const me = await startChrome();
  const listed = await api("GET", "/api/scenarios");
  if (listed.data && listed.data.scenarios) {
    scenarioTitles = new Map(
      listed.data.scenarios.map((scenario) => [scenario.slug, scenario.title]),
    );
  }
  setUpTeamActions({ onJoined: () => location.assign("/downtime/team") });
  setUpWebinar();
  setUpBoardControls();
  setUpEventBar();
  setUpFilm();
  setUpTail();
  paintSignedInParts(me);
  handleJoinParameter(me);
  await startBoard();
  await loadTrailState(me);

  document.addEventListener("downtime:session", (event) => {
    paintSignedInParts(event.detail);
    loadTrailState(event.detail);
  });

  connectStream({
    onScore: (score) => {
      loadBoard(shownPage).then(() => {
        announce(
          "Leaderboard updates",
          `${score.team_name} solved ${
            scenarioTitles.get(score.scenario_slug) || score.scenario_slug
          }`,
        );
      });
      const current = session();
      if (current && current.team && current.team.id === score.team_id)
        loadTrailState(current);
    },
    onTeam: (team) => {
      const current = session();
      if (current && current.team && current.team.id === team.team_id)
        loadTrailState(current);
    },
    onOpen: () => loadBoard(shownPage),
    onDrop: () => announce("Leaderboard updates", OUTAGE_COPY, "error"),
  });
}

start();
