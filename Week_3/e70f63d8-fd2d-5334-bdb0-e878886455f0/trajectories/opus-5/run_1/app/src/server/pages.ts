import { MSG, didNotBatText, withThousands } from '../shared/messages.js';
import type { Scorecard, TournamentView } from '../shared/types.js';
import { config } from './config.js';
import { escapeHtml } from './http.js';

export interface LayoutOptions {
  title: string;
  page: string;
  signedIn: boolean;
  bootstrap: Record<string, unknown>;
  body: string;
  signedInName?: string;
}

const CLIENT_CONFIG = {
  live_delay_ms: config.liveDelayMs,
  tick_ms: config.tickMs,
  tick_stagger_ms: config.tickStaggerMs,
};

export function layout(options: LayoutOptions): string {
  const bootstrap = JSON.stringify({ ...options.bootstrap, page: options.page, config: CLIENT_CONFIG })
    .replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)} — Overcall</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body data-page="${escapeHtml(options.page)}">
<header class="topbar">
<a class="brand" href="/">Overcall</a>
<button type="button" class="menu-button" id="menu-button" aria-expanded="false">Menu</button>
<nav aria-label="Main" id="main-nav">
<a href="/matches">Matches</a>
<a href="/teams">Teams</a>
<a href="/tournaments">Tournaments</a>
</nav>
${options.signedIn ? '<button type="button" id="signout-button" class="signout">Sign out</button>' : ''}
</header>
<main>
${options.body}
</main>
<div id="announcer" role="status" aria-live="polite" class="visually-hidden"></div>
<div id="alert" role="alert" class="visually-hidden"></div>
<script type="application/json" id="bootstrap">${bootstrap}</script>
<script type="module" src="/js/client/main.js"></script>
</body>
</html>`;
}

export function notFoundPage(signedIn: boolean): string {
  return layout({
    title: MSG.notFound,
    page: 'not-found',
    signedIn,
    bootstrap: {},
    body: `<section class="band"><h1>${MSG.notFound}</h1><p><a href="/">Overcall</a></p></section>`,
  });
}

export function signInRequiredPage(): string {
  return layout({
    title: MSG.signInRequired,
    page: 'sign-in-required',
    signedIn: false,
    bootstrap: {},
    body: `<section class="band"><h1>${MSG.signInRequired}</h1><p><a href="/signin">Sign in</a></p></section>`,
  });
}

const PITCH_ART = `<svg class="pitch-art" viewBox="0 0 120 400" aria-hidden="true" focusable="false">
<rect x="0" y="0" width="120" height="400" fill="#17122b"></rect>
<rect x="30" y="20" width="60" height="360" fill="#2a2350"></rect>
<line x1="30" y1="60" x2="90" y2="60" stroke="#e9e4ff" stroke-width="2"></line>
<line x1="30" y1="340" x2="90" y2="340" stroke="#e9e4ff" stroke-width="2"></line>
<line x1="45" y1="50" x2="45" y2="70" stroke="#e9e4ff" stroke-width="2"></line>
<line x1="75" y1="330" x2="75" y2="350" stroke="#e9e4ff" stroke-width="2"></line>
<path d="M60 340 C 40 260, 86 150, 60 62" stroke="#c7f23f" stroke-width="2" fill="none"></path>
<circle cx="60" cy="62" r="5" fill="#c7f23f"></circle>
</svg>`;

const PAD_ART = `<svg class="panel-art" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
${[0, 1, 2, 3]
  .flatMap((row) =>
    [0, 1, 2, 3].map(
      (column) =>
        `<rect x="${column * 50 + 6}" y="${row * 50 + 6}" width="38" height="38" fill="#2a2350"></rect>`,
    ),
  )
  .join('')}
</svg>`;

const WHEEL_ART = `<svg class="panel-art" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
<circle cx="100" cy="100" r="92" fill="#17122b"></circle>
<circle cx="100" cy="100" r="6" fill="#e9e4ff"></circle>
${[20, 65, 110, 150, 200, 250, 300, 340]
  .map((angle, index) => {
    const radians = (angle * Math.PI) / 180;
    const length = 40 + index * 6;
    return `<line x1="100" y1="100" x2="${(100 + Math.cos(radians) * length).toFixed(1)}" y2="${(
      100 +
      Math.sin(radians) * length
    ).toFixed(1)}" stroke="#c7f23f" stroke-width="2"></line>`;
  })
  .join('')}
</svg>`;

const OVER_MAP_ART = `<svg class="panel-art" viewBox="0 0 240 120" aria-hidden="true" focusable="false">
<rect x="0" y="0" width="240" height="120" fill="#17122b"></rect>
<rect x="90" y="10" width="60" height="100" fill="#2a2350"></rect>
${[1, 2, 3, 4, 5, 6]
  .map((ball) => `<circle cx="${60 + ball * 20}" cy="${30 + (ball % 3) * 25}" r="${3 + ball}" fill="#c7f23f"></circle>`)
  .join('')}
</svg>`;

export function landingPage(signedIn: boolean): string {
  const body = `<div class="poster-pin">
<h1 class="hero-name"><span class="corner-over">OVER</span><span class="corner-call">CALL</span></h1>
<section class="hero">
<div class="hero-panel">
<p class="hero-line">Score every ball. Everyone sees it land.</p>
<p class="hero-cta"><a href="${signedIn ? '/matches' : '/signin'}">Start scoring →</a></p>
<ul class="hero-links">
<li><a href="/follow">Follow a match</a></li>
<li><a href="/tournaments">Tournaments</a></li>
<li><a href="/players">Careers</a></li>
</ul>
</div>
<div class="hero-pitch">${PITCH_ART}</div>
</section>
<section class="poster-panel"><h2>One tap a ball</h2>${PAD_ART}</section>
<section class="poster-panel"><h2>One over, mapped</h2>${OVER_MAP_ART}</section>
<section class="poster-panel band"><h2>Points table</h2>
<table class="slab"><caption>Group A</caption>
<thead><tr><th scope="col">Team</th><th scope="col">P</th><th scope="col">Pts</th><th scope="col">NRR</th></tr></thead>
<tbody>
<tr><td>Kestrels</td><td>2</td><td>4</td><td>+0.375</td></tr>
<tr><td>Herons</td><td>2</td><td>2</td><td>+1.250</td></tr>
</tbody></table>
</section>
<section class="poster-panel"><h2>Where the runs went</h2>${WHEEL_ART}</section>
</div>`;
  return layout({ title: 'Overcall', page: 'landing', signedIn, bootstrap: {}, body });
}

export function signUpPage(): string {
  return layout({
    title: 'Sign up',
    page: 'signup',
    signedIn: false,
    bootstrap: {},
    body: `<h1>Sign up</h1>
<form id="signup-form" class="column">
<p class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email"><span class="error" id="email-error"></span></p>
<p class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password"><span class="error" id="password-error"></span></p>
<p class="field"><label for="display_name">Display name</label><input id="display_name" name="display_name" type="text"><span class="error" id="display_name-error"></span></p>
<p><button type="submit">Create account</button></p>
</form>`,
  });
}

export function signInPage(): string {
  return layout({
    title: 'Sign in',
    page: 'signin',
    signedIn: false,
    bootstrap: {},
    body: `<h1>Sign in</h1>
<form id="signin-form" class="column">
<p class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email"><span class="error" id="email-error"></span></p>
<p class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password"><span class="error" id="password-error"></span></p>
<p><button type="submit">Sign in</button></p>
</form>`,
  });
}

export function followPage(signedIn: boolean): string {
  return layout({
    title: 'Follow a match',
    page: 'follow',
    signedIn,
    bootstrap: {},
    body: `<h1>Follow a match</h1>
<form id="follow-form" class="column">
<p class="field"><label for="viewer-code">Viewer code</label><input id="viewer-code" name="code" type="text"></p>
<p><button type="submit">Follow</button></p>
</form>`,
  });
}

export function matchesPage(
  matches: { id: string; title: string; status: string; result: string | null; played_on: string | null }[],
): string {
  const list =
    matches.length === 0
      ? `<p class="empty">${MSG.emptyFixtures} <a href="/matches/new">New match</a></p>`
      : `<ul class="big-list">${matches
          .map(
            (match) =>
              `<li><a class="big-name" href="/matches/${match.id}">${escapeHtml(match.title)}</a><span class="facts">${escapeHtml(
                match.result ?? match.status,
              )}</span></li>`,
          )
          .join('')}</ul>`;
  return layout({
    title: 'Matches',
    page: 'matches',
    signedIn: true,
    bootstrap: {},
    body: `<h1>Matches</h1><p><a href="/matches/new">New match</a></p>${list}`,
  });
}

export function newMatchPage(
  teams: { id: string; name: string; players: { id: string; name: string }[] }[],
  tournaments: { id: string; name: string }[],
): string {
  const teamOptions = teams
    .map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`)
    .join('');
  const playerChecks = teams
    .map(
      (team) =>
        `<fieldset class="xi-group" data-team="${team.id}"><legend>${escapeHtml(team.name)}</legend>${team.players
          .map(
            (player) =>
              `<p class="check"><input type="checkbox" id="xi-${player.id}" data-team="${team.id}" data-player="${player.id}"><label for="xi-${player.id}">${escapeHtml(
                `${team.name}: ${player.name}`,
              )}</label></p>`,
          )
          .join('')}</fieldset>`,
    )
    .join('');
  return layout({
    title: 'New match',
    page: 'new-match',
    signedIn: true,
    bootstrap: {
      teams: teams.map((team) => ({ id: team.id, name: team.name })),
      tournaments,
    },
    body: `<h1>New match</h1>
<form id="match-form" class="column">
<p class="field"><label for="home">Home team</label><select id="home" name="home">${teamOptions}</select></p>
<p class="field"><label for="away">Away team</label><select id="away" name="away">${teamOptions}</select></p>
<p class="field"><label for="tournament">Tournament</label><select id="tournament" name="tournament"><option value="">No tournament</option>${tournaments
      .map((tournament) => `<option value="${tournament.id}">${escapeHtml(tournament.name)}</option>`)
      .join('')}</select><span class="error" id="tournament-error"></span></p>
<p class="field"><label for="overs">Overs per side</label><input id="overs" name="overs" type="number" value="20" min="1" max="50"><span class="error" id="overs-error"></span></p>
<p class="field"><label for="players_per_side">Players per side</label><input id="players_per_side" name="players_per_side" type="number" value="11" min="2" max="11"><span class="error" id="players_per_side-error"></span></p>
<p class="check"><input type="checkbox" id="super_over"><label for="super_over">Super over</label></p>
<p class="field"><label for="batting_first">Batting first</label><select id="batting_first" name="batting_first">${teamOptions}</select></p>
${playerChecks}
<span class="error" id="xi-error"></span>
<p><button type="submit">Create match</button></p>
</form>`,
  });
}

export function matchPage(match: {
  id: string;
  title: string;
  viewer_link: boolean;
  viewer_code: string | null;
  base_url: string;
}): string {
  return layout({
    title: match.title,
    page: 'match',
    signedIn: true,
    bootstrap: {
      match_id: match.id,
      viewer_link: match.viewer_link,
      viewer_code: match.viewer_code,
      base_url: match.base_url,
    },
    body: `<h1>${escapeHtml(match.title)}</h1>
<p class="field"><span id="viewer-link-label">Viewer link</span>
<button type="button" id="viewer-link" role="switch" aria-checked="${match.viewer_link}" aria-labelledby="viewer-link-label">Viewer link</button></p>
<p id="viewer-url">${match.viewer_link && match.viewer_code ? escapeHtml(`${match.base_url}/live/${match.viewer_code}`) : ''}</p>
<form id="invite-form" class="column">
<p class="field"><label for="scorer-email">Scorer email</label><input id="scorer-email" name="email" type="email"><span class="error" id="email-error"></span></p>
<p><button type="submit">Send invitation</button></p>
<p id="invite-sent" class="note"></p>
</form>
<p><a href="/matches/${match.id}/score">Score this match</a></p>
<p><a href="/matches/${match.id}/scorecard">Scorecard</a></p>`,
  });
}

const DIALOGS = `<dialog id="wicket-dialog" aria-labelledby="wicket-title">
<h2 id="wicket-title">Wicket</h2>
<p id="wicket-note" class="note"></p>
<fieldset role="radiogroup" aria-labelledby="how-out-legend" id="how-out">
<legend id="how-out-legend">How out</legend>
<p class="check"><input type="radio" name="how-out" id="how-out-bowled" value="bowled"><label for="how-out-bowled">Bowled</label></p>
<p class="check"><input type="radio" name="how-out" id="how-out-caught" value="caught"><label for="how-out-caught">Caught</label></p>
<p class="check"><input type="radio" name="how-out" id="how-out-lbw" value="lbw"><label for="how-out-lbw">LBW</label></p>
<p class="check"><input type="radio" name="how-out" id="how-out-stumped" value="stumped"><label for="how-out-stumped">Stumped</label></p>
<p class="check"><input type="radio" name="how-out" id="how-out-hit-wicket" value="hit-wicket"><label for="how-out-hit-wicket">Hit wicket</label></p>
<p class="check"><input type="radio" name="how-out" id="how-out-run-out" value="run-out"><label for="how-out-run-out">Run out</label></p>
</fieldset>
<p class="field" id="fielder-field"><label for="fielder">Fielder</label><select id="fielder"></select></p>
<fieldset role="radiogroup" aria-labelledby="batter-out-legend" id="batter-out-field">
<legend id="batter-out-legend">Batter out</legend>
<div id="batter-out-options"></div>
</fieldset>
<p class="field" id="runs-completed-field"><label for="runs-completed">Runs completed</label><select id="runs-completed"><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></p>
<p class="field" id="new-batter-field"><label for="new-batter">New batter</label><select id="new-batter"></select></p>
<p class="error" id="wicket-error"></p>
<p><button type="button" id="record-wicket" class="primary">Record wicket</button></p>
</dialog>
<dialog id="bowler-dialog" aria-labelledby="bowler-title">
<h2 id="bowler-title">Next bowler</h2>
<p class="field"><label for="next-bowler">Bowler</label><select id="next-bowler"></select></p>
<p class="error" id="bowler-error"></p>
<p><button type="button" id="start-over" class="primary">Start over</button></p>
</dialog>
<dialog id="retire-dialog" aria-labelledby="retire-title">
<h2 id="retire-title">Retire batter</h2>
<fieldset role="radiogroup" aria-labelledby="retire-batter-legend">
<legend id="retire-batter-legend">Batter</legend>
<div id="retire-options"></div>
</fieldset>
<p class="field"><label for="retire-new-batter">New batter</label><select id="retire-new-batter"></select></p>
<p class="error" id="retire-error"></p>
<p><button type="button" id="retire-confirm" class="primary">Retire</button></p>
</dialog>
<dialog id="innings-dialog" aria-labelledby="innings-title">
<h2 id="innings-title">Start innings</h2>
<p class="field"><label for="striker">Striker</label><select id="striker"></select></p>
<p class="field"><label for="non-striker">Non-striker</label><select id="non-striker"></select></p>
<p class="field"><label for="innings-bowler">Bowler</label><select id="innings-bowler"></select></p>
<p class="error" id="innings-error"></p>
<p><button type="button" id="start-innings" class="primary">Start innings</button></p>
</dialog>
<dialog id="change-dialog" aria-label="Change delivery">
<h2 id="change-title">Change delivery</h2>
<div role="group" aria-label="Change pad" id="change-pad">
<button type="button" data-change="runs:0">0</button>
<button type="button" data-change="runs:1">1</button>
<button type="button" data-change="runs:2">2</button>
<button type="button" data-change="runs:3">3</button>
<button type="button" data-change="runs:4">4</button>
<button type="button" data-change="runs:5">5</button>
<button type="button" data-change="runs:6">6</button>
<button type="button" data-change="extra:wide">Wide</button>
<button type="button" data-change="extra:no-ball">No-ball</button>
<button type="button" data-change="extra:bye">Bye</button>
<button type="button" data-change="extra:leg-bye">Leg bye</button>
</div>
<p id="change-preview"></p>
<p class="error" id="change-error"></p>
<p><button type="button" id="save-change" class="primary">Save change</button></p>
</dialog>`;

const PAD_KEYS: { label: string; action: string; hint: string }[] = [
  { label: '0', action: 'runs:0', hint: '0' },
  { label: '1', action: 'runs:1', hint: '1' },
  { label: '2', action: 'runs:2', hint: '2' },
  { label: '3', action: 'runs:3', hint: '3' },
  { label: '4', action: 'runs:4', hint: '4' },
  { label: '5', action: 'runs:5', hint: '5' },
  { label: '6', action: 'runs:6', hint: '6' },
  { label: 'Wide', action: 'extra:wide', hint: 'D' },
  { label: 'No-ball', action: 'extra:no-ball', hint: 'N' },
  { label: 'Bye', action: 'extra:bye', hint: 'B' },
  { label: 'Leg bye', action: 'extra:leg-bye', hint: 'L' },
  { label: 'Wicket', action: 'wicket', hint: 'W' },
  { label: 'Undo', action: 'undo', hint: 'U' },
];

export function scoringPage(args: {
  title: string;
  matchId: string;
  bootstrap: Record<string, unknown>;
}): string {
  const pad = PAD_KEYS.map(
    (key) =>
      `<button type="button" class="pad-key" disabled data-action="${key.action}"${
        key.label === 'Wide' || key.label === 'No-ball' || key.label === 'Bye' || key.label === 'Leg bye'
          ? ' aria-pressed="false"'
          : ''
      }><span class="key-label">${escapeHtml(key.label)}</span><span class="key-hint" aria-hidden="true">${key.hint}</span></button>`,
  ).join('');
  return layout({
    title: args.title,
    page: 'scoring',
    signedIn: true,
    bootstrap: args.bootstrap,
    body: `<h1>${escapeHtml(args.title)}</h1>
<p id="pen-notice" class="note"></p>
<p id="live-status" class="note"></p>
<div class="scoring-layout">
<section class="poster" aria-label="Scoreboard">
<div id="scoreboard"></div>
<ul id="batters"></ul>
<p id="bowler"></p>
<p id="run-rate"></p>
<p id="chase"></p>
<ol id="this-over" aria-label="This over"></ol>
<div id="free-hit-slot"></div>
<div id="innings-break-slot"></div>
<div id="result-slot"></div>
</section>
<div class="pad-column">
<div role="group" aria-label="Scoring pad" id="pad">${pad}</div>
<button type="button" id="retire-button" class="wide-button" disabled>Retire batter</button>
<div id="innings-actions"></div>
<p><a href="/matches/${args.matchId}/scorecard">Scorecard</a></p>
</div>
<ol id="commentary" aria-label="Commentary"></ol>
</div>
${DIALOGS}`,
  });
}

export function viewerPage(args: { title: string; code: string; bootstrap: Record<string, unknown> }): string {
  return layout({
    title: args.title,
    page: 'viewer',
    signedIn: false,
    bootstrap: args.bootstrap,
    body: `<h1>${escapeHtml(args.title)}</h1>
<p id="live-status" class="note"></p>
<p id="notice" class="note"></p>
<div class="viewer-layout">
<section class="poster pinned" aria-label="Scoreboard">
<div id="scoreboard"></div>
<ul id="batters"></ul>
<p id="bowler"></p>
<p id="run-rate"></p>
<p id="chase"></p>
<ol id="this-over" aria-label="This over"></ol>
<div id="free-hit-slot"></div>
<div id="innings-break-slot"></div>
<div id="result-slot"></div>
</section>
<ol id="commentary" aria-label="Commentary"></ol>
</div>
<p class="scorecard-link"><a href="/live/${escapeHtml(args.code)}/scorecard">Scorecard</a></p>`,
  });
}

function scorecardSections(card: Scorecard): string {
  const sections = card.innings
    .map(
      (innings) => `<section class="innings-card">
<h2>${escapeHtml(innings.heading)}</h2>
<div class="table-scroll">
<table>
<caption>Batting</caption>
<thead><tr><th scope="col">Batter</th><th scope="col">Dismissal</th><th scope="col">R</th><th scope="col">B</th><th scope="col">4s</th><th scope="col">6s</th><th scope="col">SR</th></tr></thead>
<tbody>${innings.batting
        .map(
          (row) =>
            `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.dismissal)}</td><td>${row.runs}</td><td>${row.balls}</td><td>${row.fours}</td><td>${row.sixes}</td><td>${escapeHtml(
              row.strike_rate,
            )}</td></tr>`,
        )
        .join('')}</tbody>
</table>
</div>
<p class="extras">${escapeHtml(innings.extras.text)}</p>
<p class="total">${escapeHtml(innings.total_text)}</p>
${innings.did_not_bat.length > 0 ? `<p class="did-not-bat">${escapeHtml(didNotBatText(innings.did_not_bat))}</p>` : ''}
<p class="fow">${escapeHtml(innings.fall_of_wickets)}</p>
<div class="table-scroll">
<table>
<caption>Bowling</caption>
<thead><tr><th scope="col">Bowler</th><th scope="col">O</th><th scope="col">M</th><th scope="col">R</th><th scope="col">W</th><th scope="col">Wd</th><th scope="col">Nb</th><th scope="col">Econ</th></tr></thead>
<tbody>${innings.bowling
        .map(
          (row) =>
            `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.overs)}</td><td>${row.maidens}</td><td>${row.runs}</td><td>${row.wickets}</td><td>${row.wides}</td><td>${row.no_balls}</td><td>${escapeHtml(
              row.economy,
            )}</td></tr>`,
        )
        .join('')}</tbody>
</table>
</div>
</section>`,
    )
    .join('');
  return `${sections}<p id="result">${escapeHtml(card.result ?? '')}</p>`;
}

export function scorecardPage(args: {
  card: Scorecard;
  signedIn: boolean;
  backLink: string;
}): string {
  return layout({
    title: `${args.card.match.title} scorecard`,
    page: 'scorecard',
    signedIn: args.signedIn,
    bootstrap: {},
    body: `<h1>${escapeHtml(args.card.match.title)}</h1>
<p><a href="${escapeHtml(args.backLink)}">Scoreboard</a></p>
${scorecardSections(args.card)}`,
  });
}

export function teamsPage(teams: { id: string; name: string }[]): string {
  const list =
    teams.length === 0
      ? `<p class="empty">${MSG.emptyTeams} <a href="/teams/new">New team</a></p>`
      : `<ul class="big-list">${teams
          .map((team) => `<li><a class="big-name" href="/teams/${team.id}">${escapeHtml(team.name)}</a></li>`)
          .join('')}</ul>`;
  return layout({
    title: 'Teams',
    page: 'teams',
    signedIn: true,
    bootstrap: {},
    body: `<h1>Teams</h1><p><a href="/teams/new">New team</a></p>${list}`,
  });
}

export function newTeamPage(): string {
  return layout({
    title: 'New team',
    page: 'new-team',
    signedIn: true,
    bootstrap: {},
    body: `<h1>New team</h1>
<form id="team-form" class="column">
<p class="field"><label for="team-name">Team name</label><input id="team-name" type="text"><span class="error" id="name-error"></span></p>
<p class="field"><label for="player-name">Player full name</label><input id="player-name" type="text"></p>
<p class="field"><label for="player-short">Player short name</label><input id="player-short" type="text"></p>
<p><button type="button" id="add-player">Add player</button></p>
<ul id="player-list"></ul>
<span class="error" id="players-error"></span>
<p><button type="submit">Create team</button></p>
</form>`,
  });
}

export function teamPage(args: {
  team: { id: string; name: string; logo_url: string | null };
  players: { id: string; name: string; short_name: string }[];
  matches: { id: string; line: string; scorecard_url: string | null }[];
  organiser: boolean;
}): string {
  return layout({
    title: args.team.name,
    page: 'team',
    signedIn: true,
    bootstrap: { team_id: args.team.id, logo_max_bytes: config.logoMaxBytes },
    body: `<h1>${escapeHtml(args.team.name)}</h1>
<p id="team-logo">${
      args.team.logo_url
        ? `<img src="${escapeHtml(args.team.logo_url)}" alt="${escapeHtml(args.team.name)} logo" class="logo">`
        : ''
    }</p>
${
  args.organiser
    ? `<form id="logo-form" class="column">
<p class="field"><label for="logo-input">Team logo</label><input id="logo-input" type="file" accept="image/png,image/jpeg"><span class="error" id="logo-error"></span></p>
<p><button type="submit">Upload logo</button><span id="logo-pending" class="note"></span></p>
<p class="note">Logos are at most ${withThousands(config.logoMaxBytes)} bytes.</p>
</form>`
    : ''
}
<ul class="big-list">${args.players
      .map(
        (player) =>
          `<li><a class="big-name" href="/players/${player.id}">${escapeHtml(player.name)}</a><span class="facts">${escapeHtml(
            player.short_name,
          )}</span></li>`,
      )
      .join('')}</ul>
<h2 id="matches-heading">Matches</h2>
<ul aria-label="Matches">${args.matches
      .map(
        (match) =>
          `<li>${escapeHtml(match.line)}${
            match.scorecard_url ? ` <a href="${escapeHtml(match.scorecard_url)}">Scorecard</a>` : ''
          }</li>`,
      )
      .join('')}</ul>`,
  });
}

export function tournamentsPage(tournaments: { id: string; name: string }[]): string {
  const list =
    tournaments.length === 0
      ? `<p class="empty">${MSG.emptyTournaments} <a href="/tournaments/new">New tournament</a></p>`
      : `<ul class="big-list">${tournaments
          .map(
            (tournament) =>
              `<li><a class="big-name" href="/tournaments/${tournament.id}">${escapeHtml(tournament.name)}</a></li>`,
          )
          .join('')}</ul>`;
  return layout({
    title: 'Tournaments',
    page: 'tournaments',
    signedIn: true,
    bootstrap: {},
    body: `<h1>Tournaments</h1><p><a href="/tournaments/new">New tournament</a></p>${list}`,
  });
}

export function newTournamentPage(teams: { id: string; name: string }[]): string {
  return layout({
    title: 'New tournament',
    page: 'new-tournament',
    signedIn: true,
    bootstrap: { teams },
    body: `<h1>New tournament</h1>
<form id="tournament-form" class="column">
<p class="field"><label for="tournament-name">Tournament name</label><input id="tournament-name" type="text"><span class="error" id="name-error"></span></p>
<p class="field"><label for="overs">Overs per side</label><input id="overs" type="number" value="20" min="1" max="50"><span class="error" id="overs-error"></span></p>
<p class="field"><label for="players_per_side">Players per side</label><input id="players_per_side" type="number" value="11" min="2" max="11"><span class="error" id="players_per_side-error"></span></p>
<p class="check"><input type="checkbox" id="super_over"><label for="super_over">Super over</label></p>
<p class="field"><label for="group-name">Group name</label><input id="group-name" type="text"></p>
<fieldset><legend>Teams</legend>${teams
      .map(
        (team) =>
          `<p class="check"><input type="checkbox" id="group-team-${team.id}" data-team="${team.id}"><label for="group-team-${team.id}">${escapeHtml(
            team.name,
          )}</label></p>`,
      )
      .join('')}</fieldset>
<p><button type="button" id="add-group">Add group</button></p>
<ul id="group-list"></ul>
<p><button type="submit">Create tournament</button></p>
</form>`,
  });
}

export function tournamentPage(view: TournamentView): string {
  return layout({
    title: view.name,
    page: 'tournament',
    signedIn: true,
    bootstrap: { tournament_id: view.id, groups: view.groups },
    body: `<h1>${escapeHtml(view.name)}</h1>
<div id="groups">${groupsHtml(view)}</div>`,
  });
}

export function groupsHtml(view: TournamentView): string {
  return view.groups
    .map(
      (group, index) => `<section class="group" data-group="${index}">
<div class="table-scroll">
<table>
<caption>${escapeHtml(group.name)}</caption>
<thead><tr><th scope="col">Team</th><th scope="col">P</th><th scope="col">W</th><th scope="col">L</th><th scope="col">T</th><th scope="col">Pts</th><th scope="col">NRR</th></tr></thead>
<tbody>${group.table
        .map(
          (row) =>
            `<tr data-team="${row.team.id}"><td>${escapeHtml(row.team.name)}</td><td>${row.p}</td><td>${row.w}</td><td>${row.l}</td><td>${row.t}</td><td>${row.pts}</td><td>${escapeHtml(
              row.nrr,
            )}</td></tr>`,
        )
        .join('')}</tbody>
</table>
</div>
<ul class="group-matches">${group.matches
        .map(
          (match) =>
            `<li><a href="/matches/${match.id}/scorecard">${escapeHtml(`${match.home} v ${match.away}`)}</a> <span class="facts">${escapeHtml(
              match.result ?? match.status,
            )}</span></li>`,
        )
        .join('')}</ul>
</section>`,
    )
    .join('');
}

export function playersPage(
  players: { id: string; name: string; short_name: string; team: string }[],
): string {
  const list =
    players.length === 0
      ? `<p class="empty">${MSG.emptyPlayers} <a href="/teams/new">New team</a></p>`
      : `<ul class="big-list">${players
          .map(
            (player) =>
              `<li><a class="big-name" href="/players/${player.id}">${escapeHtml(player.name)}</a><span class="facts">${escapeHtml(
                player.team,
              )}</span></li>`,
          )
          .join('')}</ul>`;
  return layout({ title: 'Players', page: 'players', signedIn: true, bootstrap: {}, body: `<h1>Players</h1>${list}` });
}

export function careerPage(career: {
  player: { name: string; team: { name: string } };
  batting: {
    matches: number;
    innings: number;
    not_outs: number;
    runs: number;
    high_score: string;
    average: string;
    strike_rate: string;
    fours: number;
    sixes: number;
  };
  bowling: { overs: string; runs: number; wickets: number; best: string; economy: string };
}): string {
  return layout({
    title: career.player.name,
    page: 'career',
    signedIn: true,
    bootstrap: {},
    body: `<h1>${escapeHtml(career.player.name)}</h1>
<p class="facts">${escapeHtml(career.player.team.name)}</p>
<div class="table-scroll">
<table><caption>Batting</caption>
<thead><tr><th scope="col">Mat</th><th scope="col">Inns</th><th scope="col">NO</th><th scope="col">Runs</th><th scope="col">HS</th><th scope="col">Avg</th><th scope="col">SR</th><th scope="col">4s</th><th scope="col">6s</th></tr></thead>
<tbody><tr><td>${career.batting.matches}</td><td>${career.batting.innings}</td><td>${career.batting.not_outs}</td><td>${career.batting.runs}</td><td>${escapeHtml(
      career.batting.high_score,
    )}</td><td>${escapeHtml(career.batting.average)}</td><td>${escapeHtml(career.batting.strike_rate)}</td><td>${career.batting.fours}</td><td>${career.batting.sixes}</td></tr></tbody>
</table>
</div>
<div class="table-scroll">
<table><caption>Bowling</caption>
<thead><tr><th scope="col">Overs</th><th scope="col">Runs</th><th scope="col">Wkts</th><th scope="col">Best</th><th scope="col">Econ</th></tr></thead>
<tbody><tr><td>${escapeHtml(career.bowling.overs)}</td><td>${career.bowling.runs}</td><td>${career.bowling.wickets}</td><td>${escapeHtml(
      career.bowling.best,
    )}</td><td>${escapeHtml(career.bowling.economy)}</td></tr></tbody>
</table>
</div>`,
  });
}

export function invitationPage(args: {
  token: string;
  title: string;
  status: 'open' | 'used' | 'expired';
}): string {
  const note =
    args.status === 'used' ? MSG.invitationUsed : args.status === 'expired' ? MSG.invitationExpired : '';
  return layout({
    title: 'Invitation',
    page: 'invitation',
    signedIn: true,
    bootstrap: { token: args.token, status: args.status },
    body: `<h1>Score ${escapeHtml(args.title)}</h1>
<p id="invitation-note" class="note">${escapeHtml(note)}</p>
<p><button type="button" id="accept-invitation">Accept invitation</button></p>`,
  });
}
