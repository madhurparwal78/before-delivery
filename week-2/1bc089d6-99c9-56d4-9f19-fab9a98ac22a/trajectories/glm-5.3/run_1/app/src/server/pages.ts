import { RITUAL_CATALOGUE } from '../shared/plan.js';

const ritualCards = RITUAL_CATALOGUE.map(
  (r) => `
      <div class="card" data-ritual="${r.id}">
        <video class="card-clip" muted playsinline preload="none" loop aria-hidden="true"
               poster="/media/clips/${r.id}-still.webp">
          <source src="/media/clips/${r.id}.webm" type="video/webm">
          <source src="/media/clips/${r.id}.mp4" type="video/mp4">
        </video>
        <h3 class="card-title">${r.title}</h3>
        <p class="card-minutes">${r.minutes} min</p>
        <button type="button" class="toggle" data-add="${r.id}" aria-pressed="false">Add ${r.title} to my hour</button>
      </div>`,
).join('');

const plannerRituals = RITUAL_CATALOGUE.map(
  (r) => `
        <div class="planner-ritual" data-ritual="${r.id}">
          <label class="check"><input type="checkbox" data-ritual-check="${r.id}"> <span>${r.title}</span></label>
          <label class="minutes"><span class="vh">${r.title} minutes</span>
            <input type="number" inputmode="numeric" min="5" max="30" step="5" value="${r.minutes}"
                   data-ritual-minutes="${r.id}" disabled aria-label="${r.title} minutes"> <span aria-hidden="true">min</span>
          </label>
        </div>`,
).join('');

const bedtimes = Array.from({ length: 288 }, (_, i) => {
  const h = Math.floor(i / 12);
  const m = (i % 12) * 5;
  const v = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `<option value="${v}"${v === '23:00' ? ' selected' : ''}>${v}</option>`;
}).join('');

function shell(title: string, body: string, extraHead = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="preload" href="/fonts/Fraunces.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/HankenGrotesk.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/styles.css">
${extraHead}
</head>
<body>
${body}
<script src="/app.js" defer></script>
</body>
</html>`;
}

export function storyPage(): string {
  return shell(
    'Stillhour — give your last hour a shape',
    `
<div id="gate" role="dialog" aria-modal="true" aria-label="Stillhour" aria-live="off">
  <div class="gate-inner">
    <svg class="mark" viewBox="0 0 120 120" aria-hidden="true">
      <circle class="mark-circle" cx="60" cy="60" r="54"/>
      <path class="mark-moon" d="M60 18 a42 42 0 1 0 0.01 0 Z M60 30 a30 30 0 1 1 -0.01 0 Z"/>
    </svg>
    <div class="gate-copy">
      <p id="gate-label" role="progressbar" aria-label="Gathering the evening" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <span class="gate-text">Gathering the evening</span>
        <span class="gate-percent" id="gate-percent">0%</span>
      </p>
      <p class="gate-buttons" id="gate-buttons" hidden>
        <button type="button" id="begin-hour" class="btn">Begin the hour</button>
        <button type="button" id="begin-silence" class="btn ghost">Begin in silence</button>
      </p>
    </div>
  </div>
</div>

<header class="topbar" role="banner" id="topbar" hidden>
  <a class="wordmark" href="/#top" id="wordmark-link">Stillhour</a>
  <p class="story-clock" id="story-clock" role="timer" aria-label="Story clock" aria-live="off">21:00</p>
  <button type="button" id="sound-switch" class="sound" role="switch" aria-checked="false" aria-label="Sound">
    <span class="vh">Sound</span><span class="speaker" aria-hidden="true"></span>
  </button>
</header>

<main id="story">
  <canvas id="scene" aria-hidden="true"></canvas>

  <section class="scene-window" id="hero-window" aria-label="21:00 hero scene">
    <div class="hero-title-wrap">
      <h1 id="hero-title" class="hero-title" data-text="Give your last hour a shape.">Give your last hour a shape.</h1>
    </div>
  </section>

  <section class="chapter" id="chapter-one" aria-labelledby="chapter-one-heading">
    <h2 id="chapter-one-heading">The hour nobody plans.</h2>
    <p>The day runs on until it runs out. One more episode, one more message, one more scroll — and the last hour is gone before it was ever decided.</p>
    <p>Sleep is not a switch you flip at midnight. It is an hour you shape on purpose, dim and slow, the same shape every night.</p>
    <p>Walk through one evening, from 21:00 to 22:00, and choose the rituals that suit you.</p>
  </section>

  <section class="numbers" id="numbers" aria-label="Tonight in numbers">
    <div class="number"><span class="numeral" data-final="60">60</span><span class="number-word">minutes</span></div>
    <div class="number"><span class="numeral" data-final="6">06</span><span class="number-word">rituals</span></div>
    <div class="number"><span class="numeral" data-final="1">01</span><span class="number-word">bedtime</span></div>
    <p class="live-count" id="live-count" role="status" aria-live="polite">Tonight, people everywhere are keeping a Stillhour.</p>
  </section>

  <section class="scene-window tall" id="city-window" aria-label="The city at night">
    <div class="city-copy">
      <p class="window-counter" id="window-counter">4,096 windows lit</p>
      <p class="city-caption" id="city-caption">The offices close.</p>
    </div>
  </section>

  <section class="chapter" id="chapter-two" aria-labelledby="chapter-two-heading">
    <h2 id="chapter-two-heading">Put the screen to bed.</h2>
    <p>The phone is a lamp that never dims. Put it in a drawer across the room an hour before bed, and let the room fall to a low ember.</p>
    <div class="dial-row">
      <div class="dial" id="brightness-dial" role="meter" aria-label="Screen brightness" aria-valuemin="5" aria-valuemax="100" aria-valuenow="100">
        <div class="dial-face"><div class="dial-glow" id="dial-glow"></div><span class="dial-value" id="dial-value">100%</span></div>
      </div>
    </div>
  </section>

  <section class="scene-window" id="water-window" aria-label="Still water">
  </section>

  <section class="chapter" id="chapter-three" aria-labelledby="chapter-three-heading">
    <h2 id="chapter-three-heading">Breathe in for four, hold for seven, out for eight.</h2>
    <p>Long, slow breaths tell the body the day is over. In through the nose for four. Hold for seven. Out through the mouth for eight.</p>
    <div class="breath-row">
      <div class="breath-circle" id="breath-circle" aria-hidden="true"></div>
      <p class="round-counter" id="round-counter" aria-hidden="true">Round 1 of 3</p>
      <button type="button" id="breathe-button" class="btn">Breathe with me</button>
      <p id="breathing-guide" class="status-text" role="status" aria-live="polite">Press the button to begin three rounds.</p>
    </div>
  </section>

  <section class="scene-window" id="flowers-window" aria-label="Moonflowers">
  </section>

  <section class="settle" id="settle" aria-label="Settle line">
    <p class="settle-line" id="settle-line" data-text="Let the day settle.">Let the day settle.</p>
  </section>

  <section class="chapter ritual-chapter" id="chapter-four" aria-labelledby="chapter-four-heading">
    <div class="pin">
      <div class="ritual-head">
        <h2 id="chapter-four-heading">Build your hour.</h2>
        <p>Choose the rituals that suit you. Add them up to sixty minutes.</p>
      </div>
      <div class="cards" id="cards">${ritualCards}
      </div>
      <p id="ritual-updates" class="status-text" role="status" aria-live="polite"></p>
    </div>
  </section>

  <section class="chapter" id="chapter-five" aria-labelledby="chapter-five-heading">
    <h2 id="chapter-five-heading">One still hour.</h2>
    <p>A short film about an evening that was planned: forty seconds, no noise, no hurry.</p>
    <div class="film-row">
      <img src="/media/film/poster.webp" alt="A still from the film One still hour: a dusk landscape with a low ember sun." class="film-poster" width="640" height="360">
      <button type="button" id="play-film" class="btn">Play the film</button>
    </div>
  </section>

  <section class="chapter planner-chapter" id="chapter-six" aria-labelledby="chapter-six-heading">
    <h2 id="chapter-six-heading">Plan your Stillhour.</h2>
    <div class="planner-grid">
      <form id="planner" novalidate>
        <p id="planner-status" class="status-text" role="status" aria-live="polite"></p>
        <div id="planner-alert" class="alert" role="alert" hidden></div>
        <div class="field">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" autocomplete="email">
          <p class="field-error" id="email-error" hidden></p>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="bedtime">Bedtime</label>
            <select id="bedtime" name="bedtime">${bedtimes}</select>
            <p class="field-error" id="bedtime-error" hidden></p>
          </div>
          <div class="field">
            <label for="time-zone">Time zone</label>
            <select id="time-zone" name="time_zone"></select>
            <p class="field-error" id="time-zone-error" hidden></p>
          </div>
        </div>
        <fieldset class="rituals-group" id="planner-rituals">
          <legend>Rituals</legend>
          ${plannerRituals}
          <p class="field-error" id="rituals-error" hidden></p>
        </fieldset>
        <div class="field">
          <label for="note">A note for tonight</label>
          <textarea id="note" name="note" rows="3"></textarea>
          <p class="char-count" id="char-count">0 of 280 characters</p>
          <p class="field-error" id="note-error" hidden></p>
        </div>
        <button type="submit" id="save-hour" class="btn">Save my hour</button>
      </form>
      <div class="summary">
        <h3>Your hour</h3>
        <p id="summary-line">Your hour starts at 22:00 and ends at 23:00, <span id="summary-zone">your time zone</span> time.</p>
        <p id="summary-total">0 of 60 minutes planned.</p>
      </div>
    </div>
  </section>

  <section class="scene-window" id="footer-window" aria-label="22:00 footer scene">
    <div class="goodnight">
      <p class="lantern-flame" id="lantern-flame" aria-hidden="true"></p>
      <p class="goodnight-word">Goodnight.</p>
      <nav class="footer-links">
        <a href="/manage">Manage my hour</a>
        <a href="/privacy">Privacy</a>
      </nav>
    </div>
  </section>
</main>

<div id="film-dialog" class="film-dialog" role="dialog" aria-modal="true" aria-label="One still hour" hidden>
  <div class="film-frame">
    <video id="film-video" preload="none" poster="/media/film/poster.webp" playsinline crossorigin="anonymous">
      <source src="/media/film/one-still-hour.webm" type="video/webm">
      <source src="/media/film/one-still-hour.mp4" type="video/mp4">
    </video>
    <p class="film-captions" id="film-captions" aria-hidden="true"></p>
    <div class="film-controls">
      <button type="button" id="film-play" class="film-btn">Play</button>
      <div class="seek-wrap">
        <input type="range" id="film-seek" class="seek" min="0" max="40" step="0.1" value="0"
               role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="40" aria-valuenow="0">
        <span class="film-time" id="film-time">0:00 of 0:40</span>
      </div>
      <button type="button" id="film-captions-btn" class="film-btn" aria-pressed="false">Captions</button>
      <button type="button" id="film-mute" class="film-btn" aria-pressed="false">Mute</button>
      <button type="button" id="film-full" class="film-btn">Full screen</button>
      <button type="button" id="film-close" class="film-btn">Close</button>
    </div>
    <p id="film-status" class="status-text" role="status" aria-live="polite"></p>
  </div>
</div>
`,
  );
}

export function managePage(): string {
  return shell(
    'Manage my hour — Stillhour',
    `
<main class="panel-page" id="manage">
  <h1 id="manage-heading" tabindex="-1">Manage my hour</h1>
  <p id="manage-status" class="status-text" role="status" aria-live="polite"></p>
  <div id="manage-signed-out">
    <p class="intro">Your hour lives here. We send a sign-in link to your email; it works once, for 15 minutes.</p>
    <form id="signin-form" novalidate>
      <div id="signin-alert" class="alert" role="alert" hidden></div>
      <div class="field">
        <label for="signin-email">Email</label>
        <input type="email" id="signin-email" autocomplete="email">
        <p class="field-error" id="signin-email-error" hidden></p>
      </div>
      <button type="submit" id="send-link" class="btn">Send me a sign-in link</button>
    </form>
  </div>
  <div id="manage-editor" hidden></div>
</main>
`,
  );
}

export function signinPage(): string {
  return shell(
    'Your Stillhour link',
    `
<main class="panel-page" id="signin">
  <h1>Your Stillhour link</h1>
  <p id="link-status" class="status-text" role="status" aria-live="polite">Checking your link…</p>
  <p><a href="/manage">Manage my hour</a></p>
</main>
`,
  );
}

export function partnerPage(): string {
  return shell(
    'A shared Stillhour',
    `
<main class="panel-page" id="partner">
  <h1 id="partner-heading">A shared Stillhour</h1>
  <p id="partner-status" class="status-text" role="status" aria-live="polite">Opening the shared hour…</p>
  <div id="partner-body" hidden></div>
</main>
`,
  );
}

export function privacyPage(): string {
  return shell(
    'Privacy — Stillhour',
    `
<main class="panel-page" id="privacy">
  <h1>Privacy</h1>
  <p>Stillhour keeps as little as possible, and lets go of all of it when you ask.</p>
  <h2>What we store</h2>
  <ul>
    <li>your email address;</li>
    <li>your bedtime and time zone;</li>
    <li>your rituals and their minutes;</li>
    <li>your note for tonight;</li>
    <li>the record of each reminder we send or skip;</li>
    <li>the one-time links we email you;</li>
    <li>your sign-in session.</li>
  </ul>
  <h2>What we never show</h2>
  <p>A partner opening a shared hour sees the bedtime, the time zone, the rituals and the total minutes — never your email and never your note.</p>
  <h2>Delete everything</h2>
  <p>On Manage my hour, Delete everything removes your hour, your drafts, your links, your session, your share link and every reminder we have not yet sent. Nothing more is ever sent.</p>
  <p><a href="/">Back to the evening</a></p>
</main>
`,
  );
}

export function notFoundPage(): string {
  return shell(
    'Stillhour',
    `
<main class="panel-page">
  <h1>This page is not here.</h1>
  <p><a href="/">Return to the evening</a></p>
</main>
`,
  );
}
