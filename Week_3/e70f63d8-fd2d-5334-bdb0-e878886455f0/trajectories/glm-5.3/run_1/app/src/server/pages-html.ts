// The HTML fragments for every screen. One main landmark, one h1, the Main nav.

import { copy } from "./copy.js";

const esc = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface StateShape {
  match: { id: string; title: string; status: string; overs: number; players_per_side: number; super_over: boolean; home: TeamJson; away: TeamJson; played_on: string | null };
  innings: string | null;
  batting_team: TeamJson | null;
  bowling_team: TeamJson | null;
  runs: number;
  wickets: number;
  legal_balls: number;
  overs_text: string;
  scoreboard: string;
  batters: { player: string; short_name: string; runs: number; balls: number; on_strike: boolean; text: string }[];
  bowler: { player: string; short_name: string; figures: string; text: string } | null;
  next_bowler_needed: boolean;
  barred_bowlers: { player: string; reason: string }[];
  free_hit: boolean;
  run_rate: string;
  chase: { target: number; need: number; balls_left: number; required_rate: string; text: string } | null;
  this_over: string[];
  commentary: CommentaryShape[];
  yet_to_bat: { player: string; short_name: string; retired_hurt: boolean }[];
  innings_break: { heading: string; text: string } | null;
  result: string | null;
  last_seq: number;
}

export interface TeamJson {
  id: string;
  name: string;
  logo_url: string | null;
}

export interface CommentaryShape {
  kind: "delivery" | "over-end" | "retirement";
  seq?: number;
  over?: number;
  ball?: number;
  label?: string;
  runs?: number;
  bat_runs?: number;
  extra?: string;
  extra_runs?: number;
  wicket?: string | null;
  free_hit?: boolean;
  striker?: string;
  bowler?: string;
  player?: string;
  line: string;
}

const scoreboardHtml = (state: StateShape, withLogo = true): string => {
  const team = state.batting_team;
  const logo = withLogo && team?.logo_url ? `<img src="${esc(team.logo_url)}" alt="${esc(team.name)} logo" class="logo">` : "";
  const runsDigits = [...String(state.runs)].map((c) => `<span class="digit">${esc(c)}</span>`).join("");
  const wicketsDigits = [...String(state.wickets)].map((c) => `<span class="digit">${esc(c)}</span>`).join("");
  const oversDigits = [...state.overs_text].map((c) => `<span class="digit">${esc(c)}</span>`).join("");
  return `
<section id="scoreboard" class="scoreboard poster" data-runs="${state.runs}" data-wickets="${state.wickets}" data-legal-balls="${state.legal_balls}" data-innings="${state.innings ?? ""}">
  <span class="team-name">${esc(team?.name ?? "")}</span>
  <span class="score"><span class="score-runs">${runsDigits}</span><span class="slash">/</span><span class="score-wickets">${wicketsDigits}</span></span>
  <span class="overs">(<span class="overs-value">${oversDigits}</span> ov)</span>
  ${logo}
</section>`;
};

const thisOverHtml = (state: StateShape): string => `
<ol id="this-over" aria-label="This over">
  ${state.this_over.map((chip) => `<li class="chip">${esc(chip)}</li>`).join("")}
</ol>`;

const commentaryHtml = (state: StateShape, withChangeButtons: boolean): string => `
<ol id="commentary" aria-label="Commentary" reversed>
  ${state.commentary
    .map((c) => {
      const attrs = [
        `data-kind="${c.kind}"`,
        `data-over="${c.over ?? ""}"`,
        c.seq !== undefined ? `data-seq="${c.seq}"` : "",
        c.ball !== undefined ? `data-ball="${c.ball}"` : "",
        c.label !== undefined ? `data-label="${esc(c.label)}"` : "",
        c.runs !== undefined ? `data-runs="${c.runs}"` : "",
        c.bat_runs !== undefined ? `data-bat-runs="${c.bat_runs}"` : "",
        c.extra !== undefined ? `data-extra="${c.extra}"` : "",
        c.extra_runs !== undefined ? `data-extra-runs="${c.extra_runs}"` : "",
        c.wicket !== undefined ? `data-wicket="${c.wicket}"` : "",
        c.free_hit !== undefined ? `data-free-hit="${c.free_hit}"` : "",
        c.striker !== undefined ? `data-striker="${c.striker}"` : "",
        c.bowler !== undefined ? `data-bowler="${c.bowler}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const change = withChangeButtons && c.kind === "delivery" ? `<button type="button" class="change-delivery" data-seq="${c.seq}">Change delivery ${c.seq}</button>` : "";
      return `<li ${attrs}><span class="line">${esc(c.line)}</span>${change}</li>`;
    })
    .join("")}
</ol>`;

export const landingPage = (signedIn: boolean): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Overcall</title>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
</head>
<body data-page="landing">
<header class="topbar">
  <a class="brand" href="/">OVER<span>CALL</span></a>
  <button type="button" id="menu-button" aria-expanded="false" aria-controls="main-nav">Menu</button>
  <nav id="main-nav" aria-label="Main">
    <a href="/matches">Matches</a>
    <a href="/teams">Teams</a>
    <a href="/tournaments">Tournaments</a>
  </nav>
</header>
<main>
<h1 class="visually-hidden">Overcall</h1>
<div class="hero">
  <div class="hero-corner over" aria-hidden="false">OVER</div>
  <div class="hero-corner call" aria-hidden="false">CALL</div>
  <div class="hero-panel">
    <p class="hero-sentence">Score every ball. Everyone sees it land.</p>
    <a class="hero-link" href="${signedIn ? "/matches" : "/signin"}">Start scoring →</a>
    <div class="hero-links">
      <a href="/follow">Follow a match</a>
      <a href="/tournaments">Tournaments</a>
      <a href="/players">Careers</a>
    </div>
  </div>
  <div class="hero-pitch" aria-hidden="true">
    <svg viewBox="0 0 200 600" role="presentation">
      <rect x="20" y="20" width="160" height="560" fill="#3d2f56"/>
      <rect x="70" y="40" width="60" height="520" fill="#4a3a66"/>
      <path d="M70 90 h60 M70 100 h60 M70 500 h60 M70 510 h60" stroke="#efeaff" stroke-width="3"/>
      <path d="M100 110 q40 60 -20 120 q-50 80 30 150 q30 60 -10 120" stroke="#c7f94b" stroke-width="4" fill="none" stroke-dasharray="10 8"/>
    </svg>
  </div>
</div>
<section class="panels">
  <div class="panel">A close-up of the scoring pad
    <svg viewBox="0 0 200 200" role="presentation"><rect x="10" y="10" width="85" height="85" fill="#221a33" stroke="#efeaff"/><rect x="105" y="10" width="85" height="85" fill="#221a33" stroke="#efeaff"/><rect x="10" y="105" width="85" height="85" fill="#221a33" stroke="#efeaff"/><rect x="105" y="105" width="85" height="85" fill="#c7f94b"/></svg>
  </div>
  <div class="panel">One over's pitch map
    <svg viewBox="0 0 300 120" role="presentation"><rect x="0" y="0" width="300" height="120" fill="#221a33"/><circle cx="40" cy="90" r="5" fill="#efeaff"/><circle cx="90" cy="80" r="9" fill="#c7f94b"/><circle cx="140" cy="95" r="5" fill="#efeaff"/><circle cx="190" cy="70" r="14" fill="#c7f94b"/><circle cx="240" cy="85" r="5" fill="#efeaff"/></svg>
  </div>
  <div class="panel violet">The points table
    <svg viewBox="0 0 300 120" role="presentation"><rect x="0" y="0" width="300" height="120" fill="#4b1ec7"/><rect x="10" y="30" width="280" height="14" fill="#2a0f78"/><rect x="10" y="50" width="280" height="14" fill="#2a0f78"/><rect x="10" y="70" width="280" height="14" fill="#2a0f78"/></svg>
  </div>
  <div class="panel">A wagon wheel of shots
    <svg viewBox="0 0 200 200" role="presentation"><circle cx="100" cy="100" r="90" fill="#221a33" stroke="#efeaff"/><path d="M100 100 L100 20 M100 100 L170 60 M100 100 L180 120 M100 100 L40 160" stroke="#c7f94b" stroke-width="3"/><rect x="94" y="94" width="12" height="12" fill="#efeaff"/></svg>
  </div>
</section>
</main>
<div id="announcer" role="status" aria-live="polite" class="visually-hidden"></div>
<div id="alert" role="alert" aria-live="assertive" class="visually-hidden"></div>
<script src="/app.js" defer></script>
</body>
</html>`;

export const signUpPage = (): string => pageShell({
  title: "Sign up",
  h1: "Sign up",
  signedIn: false,
  body: `
<form id="signup-form" class="form" novalidate>
  <label for="email">Email</label>
  <input type="email" id="email" name="email" autocomplete="email">
  <label for="password">Password</label>
  <input type="password" id="password" name="password" autocomplete="new-password">
  <label for="display_name">Display name</label>
  <input type="text" id="display_name" name="display_name">
  <button type="submit">Create account</button>
</form>`,
});

export const signInPage = (): string => pageShell({
  title: "Sign in",
  h1: "Sign in",
  signedIn: false,
  body: `
<form id="signin-form" class="form" novalidate>
  <label for="email">Email</label>
  <input type="email" id="email" name="email" autocomplete="email">
  <label for="password">Password</label>
  <input type="password" id="password" name="password" autocomplete="current-password">
  <button type="submit">Sign in</button>
</form>`,
});

export const followPage = (signedIn: boolean): string => pageShell({
  title: "Follow a match",
  h1: "Follow a match",
  signedIn,
  body: `
<form id="follow-form" class="form" novalidate>
  <label for="viewer-code">Viewer code</label>
  <input type="text" id="viewer-code" name="code">
  <button type="submit">Follow</button>
</form>`,
});

export const matchesPage = (rows: { id: string; title: string; status: string; result: string | null }[]): string => {
  const list =
    rows.length === 0
      ? `<p class="empty">${esc(copy.noFixtures)} <a href="/matches/new">New match</a></p>`
      : `<ul class="list">${rows
          .map((r) => `<li class="list-item"><a class="name" href="/matches/${r.id}">${esc(r.title)}</a> <span class="fact">${esc(r.result ?? r.status)}</span></li>`)
          .join("")}</ul>`;
  return pageShell({
    title: "Matches",
    h1: "Matches",
    signedIn: true,
    body: `${list}<p><a href="/matches/new">New match</a></p>`,
  });
};

export const newMatchPage = (
  teams: { id: string; name: string }[],
  tournaments: { id: string; name: string }[],
): string => pageShell({
  title: "New match",
  h1: "New match",
  signedIn: true,
  body: `
<form id="new-match-form" class="form" novalidate>
  <label for="home-team">Home team</label>
  <select id="home-team" name="home">${teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select>
  <label for="away-team">Away team</label>
  <select id="away-team" name="away">${teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select>
  <label for="tournament">Tournament</label>
  <select id="tournament" name="tournament"><option value="">No tournament</option>${tournaments.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select>
  <label for="overs">Overs per side</label>
  <input type="number" id="overs" name="overs" min="1" max="50" value="20">
  <label for="players-per-side">Players per side</label>
  <input type="number" id="players-per-side" name="players_per_side" min="2" max="11" value="11">
  <label for="super-over">Super over</label>
  <input type="checkbox" id="super-over" name="super_over">
  <label for="batting-first">Batting first</label>
  <select id="batting-first" name="batting_first">${teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select>
  <fieldset id="xi-fields"><legend>The XI</legend></fieldset>
  <button type="submit">Create match</button>
</form>`,
});

export const matchPage = (
  loaded: { match: { id: string; viewer_link: boolean; viewer_code: string; overs: number; players_per_side: number; super_over: boolean }; home: { name: string }; away: { name: string } },
  scorers: string[],
): string => {
  const viewerUrl = `/live/${loaded.match.viewer_code}`;
  return pageShell({
    title: `${loaded.home.name} v ${loaded.away.name}`,
    h1: `${esc(loaded.home.name)} v ${esc(loaded.away.name)}`,
    signedIn: true,
    body: `
<p><a href="/matches/${loaded.match.id}/score">Score this match</a> · <a href="/matches/${loaded.match.id}/scorecard">Scorecard</a></p>
<label for="viewer-link">Viewer link</label>
<input type="checkbox" role="switch" id="viewer-link" ${loaded.match.viewer_link ? "checked" : ""}>
<p id="viewer-url">${loaded.match.viewer_link ? `<a href="${viewerUrl}">${esc(viewerUrl)}</a>` : ""}</p>
<form id="invite-form" class="form" novalidate>
  <label for="scorer-email">Scorer email</label>
  <input type="email" id="scorer-email" name="email">
  <button type="submit">Send invitation</button>
  <p id="invite-status" aria-live="polite"></p>
</form>
<p>Scorers: ${scorers.map(esc).join(", ") || "none yet"}</p>`,
  });
};

export const scoringPage = (state: StateShape, matchId: string): string => pageShell({
  title: `Score ${state.match.title}`,
  h1: `Score ${esc(state.match.title)}`,
  signedIn: true,
  extraClass: "scoring",
  extraAttrs: `data-match="${esc(matchId)}" data-page="scoring"`,
  body: `
<p id="pen-notice" aria-live="polite"></p>
<p id="live-status" aria-live="polite"></p>
${scoreboardHtml(state)}
<div id="batters" class="batters">
  ${state.batters.map((b) => `<span data-player="${b.player}" data-on-strike="${b.on_strike}">${esc(b.text)}</span>`).join("")}
</div>
<p id="bowler">${state.bowler ? esc(state.bowler.text) : ""}</p>
<p id="run-rate">${esc(state.run_rate)}</p>
${state.chase ? `<p id="chase">${esc(state.chase.text)}</p>` : `<p id="chase" hidden></p>`}
${state.free_hit ? `<p id="free-hit" class="free-hit">FREE HIT</p>` : ""}
${thisOverHtml(state)}
<div id="start-buttons">
  <button type="button" id="start-first-innings" ${state.match.status === "ready" ? "" : "hidden"}>Start first innings</button>
  <button type="button" id="start-second-innings" ${state.match.status === "innings_break" ? "" : "hidden"}>Start second innings</button>
  <button type="button" id="start-super-over" ${state.match.status === "super_over_break" ? "" : "hidden"}>Start super over</button>
</div>
<section id="pad-section">
  <div role="group" aria-label="Scoring pad" id="pad" class="pad">
    ${["0", "1", "2", "3", "4", "5", "6"].map((k) => `<button type="button" class="key" data-key="${k}">${k}<span class="hint" aria-hidden="true">${k}</span></button>`).join("")}
    <button type="button" class="key extra" data-key="wide" aria-pressed="false">Wide<span class="hint" aria-hidden="true">D</span></button>
    <button type="button" class="key extra" data-key="no-ball" aria-pressed="false">No-ball<span class="hint" aria-hidden="true">N</span></button>
    <button type="button" class="key extra" data-key="bye" aria-pressed="false">Bye<span class="hint" aria-hidden="true">B</span></button>
    <button type="button" class="key extra" data-key="leg-bye" aria-pressed="false">Leg bye<span class="hint" aria-hidden="true">L</span></button>
    <button type="button" class="key wicket" data-key="wicket">Wicket<span class="hint" aria-hidden="true">W</span></button>
    <button type="button" class="key undo" data-key="undo">Undo<span class="hint" aria-hidden="true">U</span></button>
  </div>
  <button type="button" id="retire-batter">Retire batter</button>
</section>
${state.innings_break ? `<section id="innings-break"><h2>${esc(state.innings_break.heading)}</h2><p>${esc(state.innings_break.text)}</p></section>` : ""}
${state.result ? `<p id="result" class="violet-band">${esc(state.result)}</p>` : ""}
<section id="commentary-section">
${commentaryHtml(state, true)}
</section>`,
});

export const viewerPage = (state: StateShape, code: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(state.match.title)}</title>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
</head>
<body data-page="viewer" data-code="${esc(code)}">
<header class="topbar">
  <a class="brand" href="/">OVER<span>CALL</span></a>
  <button type="button" id="menu-button" aria-expanded="false" aria-controls="main-nav">Menu</button>
  <nav id="main-nav" aria-label="Main">
    <a href="/matches">Matches</a>
    <a href="/teams">Teams</a>
    <a href="/tournaments">Tournaments</a>
  </nav>
</header>
<main class="viewer">
<p id="notice" aria-live="polite"></p>
<p id="live-status" aria-live="polite"></p>
${scoreboardHtml(state)}
<div id="batters" class="batters">
  ${state.batters.map((b) => `<span data-player="${b.player}" data-on-strike="${b.on_strike}">${esc(b.text)}</span>`).join("")}
</div>
<p id="bowler">${state.bowler ? esc(state.bowler.text) : ""}</p>
<p id="run-rate">${esc(state.run_rate)}</p>
${state.chase ? `<p id="chase">${esc(state.chase.text)}</p>` : `<p id="chase" hidden></p>`}
${state.free_hit ? `<p id="free-hit" class="free-hit">FREE HIT</p>` : ""}
${thisOverHtml(state)}
${state.innings_break ? `<section id="innings-break"><h2>${esc(state.innings_break.heading)}</h2><p>${esc(state.innings_break.text)}</p></section>` : ""}
${state.result ? `<p id="result" class="violet-band">${esc(state.result)}</p>` : `<p id="result" hidden></p>`}
<section id="commentary-section">
${commentaryHtml(state, false)}
</section>
<p><a href="/live/${esc(code)}/scorecard">Scorecard</a></p>
</main>
<div id="announcer" role="status" aria-live="polite" class="visually-hidden"></div>
<div id="alert" role="alert" aria-live="assertive" class="visually-hidden"></div>
<script src="/app.js" defer></script>
</body>
</html>`;

export const scorecardPage = (card: CardShape, backHref?: string): string => {
  const sections = card.innings
    .map(
      (inn) => `
<section class="innings-section">
  <h2>${esc(inn.heading)}</h2>
  <table class="batting">
    <caption>Batting</caption>
    <thead><tr><th scope="col">Batter</th><th scope="col">Dismissal</th><th scope="col">R</th><th scope="col">B</th><th scope="col">4s</th><th scope="col">6s</th><th scope="col">SR</th></tr></thead>
    <tbody>
      ${inn.batting
        .map(
          (b) =>
            `<tr><td>${esc(b.name)}</td><td>${esc(b.dismissal)}</td><td>${b.runs}</td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${esc(b.strike_rate)}</td></tr>`,
        )
        .join("")}
    </tbody>
  </table>
  <p class="extras">${esc(inn.extras.text)}</p>
  <p class="total">${esc(inn.total_text)}</p>
  ${inn.did_not_bat.length > 0 ? `<p class="did-not-bat">Did not bat: ${inn.did_not_bat.map(esc).join(", ")}</p>` : ""}
  <p class="fow">${esc(inn.fall_of_wickets)}</p>
  <table class="bowling">
    <caption>Bowling</caption>
    <thead><tr><th scope="col">Bowler</th><th scope="col">O</th><th scope="col">M</th><th scope="col">R</th><th scope="col">W</th><th scope="col">Wd</th><th scope="col">Nb</th><th scope="col">Econ</th></tr></thead>
    <tbody>
      ${inn.bowling
        .map(
          (b) =>
            `<tr><td>${esc(b.name)}</td><td>${esc(b.overs)}</td><td>${b.maidens}</td><td>${b.runs}</td><td>${b.wickets}</td><td>${b.wides}</td><td>${b.no_balls}</td><td>${esc(b.economy)}</td></tr>`,
        )
        .join("")}
    </tbody>
  </table>
</section>`,
    )
    .join("");
  return pageShell({
    title: `${card.match.title} scorecard`,
    h1: `${esc(card.match.title)} scorecard`,
    signedIn: !backHref,
    body: `${backHref ? `<p><a href="${esc(backHref)}">Back</a></p>` : ""}${sections}${
      card.result ? `<p id="result" class="violet-band">${esc(card.result)}</p>` : `<p id="result" hidden></p>`
    }`,
  });
};

export interface CardShape {
  match: { id: string; title: string; status: string };
  innings: {
    innings: string;
    heading: string;
    batting: { player: string; name: string; dismissal: string; runs: number; balls: number; fours: number; sixes: number; strike_rate: string }[];
    extras: { b: number; lb: number; w: number; nb: number; total: number; text: string };
    total_text: string;
    did_not_bat: string[];
    fall_of_wickets: string;
    bowling: { player: string; name: string; overs: string; maidens: number; runs: number; wickets: number; wides: number; no_balls: number; economy: string }[];
  }[];
  result: string | null;
}

export const teamsPage = (rows: { id: string; name: string }[]): string => {
  const list =
    rows.length === 0
      ? `<p class="empty">${esc(copy.noTeams)} <a href="/teams/new">New team</a></p>`
      : `<ul class="list">${rows.map((t) => `<li class="list-item"><a class="name" href="/teams/${t.id}">${esc(t.name)}</a></li>`).join("")}</ul>`;
  return pageShell({ title: "Teams", h1: "Teams", signedIn: true, body: `${list}<p><a href="/teams/new">New team</a></p>` });
};

export const newTeamPage = (): string => pageShell({
  title: "New team",
  h1: "New team",
  signedIn: true,
  body: `
<form id="new-team-form" class="form" novalidate>
  <label for="team-name">Team name</label>
  <input type="text" id="team-name" name="name">
  <div id="player-rows"></div>
  <button type="button" id="add-player">Add player</button>
  <button type="submit">Create team</button>
</form>`,
});

export const teamPage = (
  team: { id: string; name: string; logo_url: string | null; players: { id: string; name: string; short_name: string }[]; matches: { id: string; line: string; scorecard_url: string | null }[] },
  isOrganiser: boolean,
): string => pageShell({
  title: team.name,
  h1: esc(team.name),
  signedIn: true,
  body: `
${team.logo_url ? `<img src="${esc(team.logo_url)}" alt="${esc(team.name)} logo" class="team-logo">` : ""}
${isOrganiser ? `<form id="logo-form" class="form" enctype="multipart/form-data">
  <label for="team-logo">Team logo</label>
  <input type="file" id="team-logo" name="logo" accept="image/png,image/jpeg">
  <button type="submit">Upload logo</button>
  <p id="logo-status" aria-live="polite"></p>
</form>` : ""}
<ul class="list">
  ${team.players.map((p) => `<li class="list-item"><span class="name">${esc(p.name)}</span> <span class="fact">${esc(p.short_name)}</span></li>`).join("")}
</ul>
<h2>Matches</h2>
<ul id="team-matches" class="list" aria-label="Matches">
  ${team.matches.length === 0 ? `<li class="list-item fact">No matches yet</li>` : team.matches.map((m) => `<li class="list-item"><span class="fact">${esc(m.line)}</span>${m.scorecard_url ? ` <a href="${esc(m.scorecard_url)}">Scorecard</a>` : ""}</li>`).join("")}
</ul>`,
});

export const tournamentsPage = (rows: { id: string; name: string }[]): string => {
  const list =
    rows.length === 0
      ? `<p class="empty">${esc(copy.noTournaments)} <a href="/tournaments/new">New tournament</a></p>`
      : `<ul class="list">${rows.map((t) => `<li class="list-item"><a class="name" href="/tournaments/${t.id}">${esc(t.name)}</a></li>`).join("")}</ul>`;
  return pageShell({ title: "Tournaments", h1: "Tournaments", signedIn: true, body: `${list}<p><a href="/tournaments/new">New tournament</a></p>` });
};

export const newTournamentPage = (teams: { id: string; name: string }[]): string => pageShell({
  title: "New tournament",
  h1: "New tournament",
  signedIn: true,
  body: `
<form id="new-tournament-form" class="form" novalidate>
  <label for="tournament-name">Tournament name</label>
  <input type="text" id="tournament-name" name="name">
  <label for="overs">Overs per side</label>
  <input type="number" id="overs" name="overs" min="1" max="50" value="20">
  <label for="players-per-side">Players per side</label>
  <input type="number" id="players-per-side" name="players_per_side" min="2" max="11" value="11">
  <label for="super-over">Super over</label>
  <input type="checkbox" id="super-over" name="super_over">
  <label for="group-name">Group name</label>
  <input type="text" id="group-name" name="group_name">
  <fieldset id="tournament-teams"><legend>Teams</legend>
    ${teams.map((t) => `<label><input type="checkbox" name="team" value="${t.id}"> ${esc(t.name)}</label>`).join("")}
  </fieldset>
  <button type="button" id="add-group">Add group</button>
  <button type="submit">Create tournament</button>
</form>`,
});

export const tournamentPage = (
  tournament: { id: string; name: string; groups: { name: string; table: { team: { id: string; name: string }; p: number; w: number; l: number; t: number; pts: number; nrr: string }[]; matches: { id: string; home: string; away: string; status: string; result: string | null }[] }[] },
  tournamentId: string,
): string => {
  const body = tournament.groups
    .map(
      (g) => `
<section class="group" data-group="${esc(g.name)}">
  <table class="points">
    <caption>${esc(g.name)}</caption>
    <thead><tr><th scope="col">Team</th><th scope="col">P</th><th scope="col">W</th><th scope="col">L</th><th scope="col">T</th><th scope="col">Pts</th><th scope="col">NRR</th></tr></thead>
    <tbody>
      ${g.table.map((row) => `<tr><td>${esc(row.team.name)}</td><td>${row.p}</td><td>${row.w}</td><td>${row.l}</td><td>${row.t}</td><td>${row.pts}</td><td>${esc(row.nrr)}</td></tr>`).join("")}
    </tbody>
  </table>
  <ul class="list">
    ${g.matches.map((m) => `<li class="list-item"><a class="fact" href="/matches/${m.id}">${esc(m.result ?? m.status)}</a></li>`).join("")}
  </ul>
</section>`,
    )
    .join("");
  return pageShell({
    title: tournament.name,
    h1: esc(tournament.name),
    signedIn: true,
    extraClass: "tournament-page",
    body: `<div id="tournament-tables" data-tournament="${tournamentId}">${body}</div>`,
  });
};

export const playersPage = (rows: { id: string; name: string; short_name: string; team_id: string; team_name: string }[]): string => {
  const list =
    rows.length === 0
      ? `<p class="empty">${esc(copy.noPlayers)} <a href="/teams/new">New team</a></p>`
      : `<ul class="list">${rows.map((p) => `<li class="list-item"><a class="name" href="/players/${p.id}">${esc(p.name)}</a> <span class="fact">${esc(p.team_name)}</span></li>`).join("")}</ul>`;
  return pageShell({ title: "Players", h1: "Players", signedIn: true, body: list });
};

export const careerPage = (career: Record<string, unknown>): string => {
  const player = career.player as { name: string; short_name: string; team: { name: string } };
  const batting = career.batting as Record<string, string | number>;
  const bowling = career.bowling as Record<string, string | number>;
  return pageShell({
    title: player.name,
    h1: esc(player.name),
    signedIn: true,
    body: `
<table class="batting">
  <caption>Batting</caption>
  <thead><tr><th scope="col">Mat</th><th scope="col">Inns</th><th scope="col">NO</th><th scope="col">Runs</th><th scope="col">HS</th><th scope="col">Avg</th><th scope="col">SR</th><th scope="col">4s</th><th scope="col">6s</th></tr></thead>
  <tbody><tr><td>${batting.matches}</td><td>${batting.innings}</td><td>${batting.not_outs}</td><td>${batting.runs}</td><td>${esc(String(batting.high_score))}</td><td>${esc(String(batting.average))}</td><td>${esc(String(batting.strike_rate))}</td><td>${batting.fours}</td><td>${batting.sixes}</td></tr></tbody>
</table>
<table class="bowling">
  <caption>Bowling</caption>
  <thead><tr><th scope="col">Overs</th><th scope="col">Runs</th><th scope="col">Wkts</th><th scope="col">Best</th><th scope="col">Econ</th></tr></thead>
  <tbody><tr><td>${esc(String(bowling.overs))}</td><td>${bowling.runs}</td><td>${bowling.wickets}</td><td>${esc(String(bowling.best))}</td><td>${esc(String(bowling.economy))}</td></tr></tbody>
</table>`,
  });
};

export const invitationPage = (title: string, token: string): string => pageShell({
  title: `Score ${title}`,
  h1: `Score ${esc(title)}`,
  signedIn: true,
  body: `<form id="accept-form"><button type="submit">Accept invitation</button><p id="accept-status" aria-live="polite"></p></form>`,
  extraAttrs: `data-invite="${esc(token)}"`,
});

export const notFoundPage = (): string => pageShell({
  title: copy.notFound,
  h1: esc(copy.notFound),
  signedIn: false,
  body: `<p class="violet-band">${esc(copy.notFound)}</p>`,
});

// Local copy of the shell so this module can be imported on its own.
function pageShell(opts: { title: string; h1: string; signedIn: boolean; body: string; extraClass?: string; extraAttrs?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<link rel="stylesheet" href="/styles.css">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
</head>
<body${opts.extraAttrs ? ` ${opts.extraAttrs}` : ""}>
<header class="topbar">
  <a class="brand" href="/">OVER<span>CALL</span></a>
  <button type="button" id="menu-button" aria-expanded="false" aria-controls="main-nav">Menu</button>
  <nav id="main-nav" aria-label="Main">
    <a href="/matches">Matches</a>
    <a href="/teams">Teams</a>
    <a href="/tournaments">Tournaments</a>
    ${opts.signedIn ? `<button type="button" id="sign-out">Sign out</button>` : ""}
  </nav>
</header>
<main class="${opts.extraClass ?? ""}">
<h1>${opts.h1}</h1>
${opts.body}
</main>
<div id="announcer" role="status" aria-live="polite" class="visually-hidden"></div>
<div id="alert" role="alert" aria-live="assertive" class="visually-hidden"></div>
<script src="/app.js" defer></script>
</body>
</html>`;
}
