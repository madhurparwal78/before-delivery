/** Server-rendered HTML for every screen, from one shared layout. */

export interface LayoutOptions {
  title: string;
  page: string;
  body: string;
}

const NUMERALS: Record<number, string> = {
  1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII',
};

const RAIL_LINKS = [1, 2, 3, 4, 5, 6, 7, 8]
  .map((n) => {
    const numeral = NUMERALS[n]!;
    return `<a href="/chapters/${n}" data-rail-link="${n}" aria-label="Chapter ${numeral}">${numeral}</a>`;
  })
  .join('\n');

const SHARED_DIALOGS = `
<dialog id="dialog-menu" aria-label="Menu">
  <div class="dialog-body">
    <h2>Menu</h2>
    <nav aria-label="Main" class="stack">
      <a href="/">Chapters</a>
      <a href="/timeline">Timeline</a>
      <a href="/sources">Sources</a>
      <a href="/sessions">Sessions</a>
      <a href="/support">Support</a>
    </nav>
    <button data-close style="margin-top:14px">Close</button>
  </div>
</dialog>

<dialog id="dialog-sign-in" aria-label="Sign in">
  <div class="dialog-body">
    <div data-role="alert" class="alert" hidden></div>
    <h2>Sign in</h2>
    <form>
      <div class="field"><label for="si-email">Email</label><input id="si-email" data-field="email" type="email" autocomplete="email"></div>
      <div class="field"><label for="si-password">Password</label><input id="si-password" data-field="password" type="password" autocomplete="current-password"></div>
      <div class="row"><button type="submit">Sign in</button><button type="button" data-action="create-account">Create an account</button></div>
    </form>
    <button class="dialog-close" data-close aria-label="Close">✕</button>
  </div>
</dialog>

<dialog id="dialog-create-account" aria-label="Create an account">
  <div class="dialog-body">
    <div data-role="alert" class="alert" hidden></div>
    <h2>Create an account</h2>
    <form>
      <div class="field"><label for="ca-name">Name</label><input id="ca-name" data-field="name" type="text" autocomplete="name"></div>
      <div class="field"><label for="ca-email">Email</label><input id="ca-email" data-field="email" type="email" autocomplete="email"></div>
      <div class="field"><label for="ca-password">Password</label><input id="ca-password" data-field="password" type="password" autocomplete="new-password"></div>
      <button type="submit">Create account</button>
    </form>
    <button class="dialog-close" data-close aria-label="Close">✕</button>
  </div>
</dialog>

<dialog id="dialog-plan" aria-label="Supporter plan">
  <div class="dialog-body">
    <div data-role="alert" class="alert" hidden></div>
    <p data-role="plan-pending" class="muted"></p>
    <h2>Supporter plan</h2>
    <fieldset class="field">
      <legend>Tier</legend>
      <div class="row" role="radiogroup" aria-label="Tier">
        <label><input type="radio" name="plan-tier" data-role="plan-tier" value="reader"> Reader</label>
        <label><input type="radio" name="plan-tier" data-role="plan-tier" value="fellow" checked> Fellow</label>
        <label><input type="radio" name="plan-tier" data-role="plan-tier" value="patron"> Patron</label>
      </div>
    </fieldset>
    <fieldset class="field">
      <legend>Currency</legend>
      <div class="row" role="radiogroup" aria-label="Currency">
        <label data-currency-label="EUR"><input type="radio" name="plan-currency" data-role="plan-currency" value="EUR" checked> EUR</label>
        <label data-currency-label="GBP"><input type="radio" name="plan-currency" data-role="plan-currency" value="GBP"> GBP</label>
        <label data-currency-label="USD"><input type="radio" name="plan-currency" data-role="plan-currency" value="USD"> USD</label>
        <label data-currency-label="JPY"><input type="radio" name="plan-currency" data-role="plan-currency" value="JPY"> JPY</label>
      </div>
    </fieldset>
    <div class="status-line" role="status" data-role="plan-price" aria-live="polite"></div>
    <div class="field" data-role="plan-card"><label for="plan-card-input">Card number</label><input id="plan-card-input" data-role="plan-card-input" type="text" inputmode="numeric" autocomplete="cc-number"></div>
    <div class="row">
      <button data-role="plan-join" hidden>Join</button>
      <button data-role="plan-change" hidden>Change plan</button>
      <button data-role="plan-cancel" hidden>Cancel membership</button>
      <button data-role="plan-undo" hidden>Undo pending change</button>
      <button data-role="plan-sign-in">Sign in to join</button>
    </div>
    <button class="dialog-close" data-close aria-label="Close">✕</button>
  </div>
</dialog>

<dialog id="dialog-book" aria-label="Book a guided session">
  <div class="dialog-body">
    <div data-role="alert" class="alert" hidden></div>
    <div data-role="book-form-body">
      <h2>Book a guided session</h2>
      <p class="muted" data-role="book-title"></p>
      <div class="field"><label for="book-seats">Seats</label><input id="book-seats" data-role="book-seats" type="number" min="1" max="4" value="1"></div>
      <fieldset class="field">
        <legend>Currency</legend>
        <div class="row" role="radiogroup" aria-label="Currency">
          <label data-currency-label="EUR"><input type="radio" name="book-currency" data-role="book-currency" value="EUR" checked> EUR</label>
          <label data-currency-label="GBP"><input type="radio" name="book-currency" data-role="book-currency" value="GBP"> GBP</label>
          <label data-currency-label="USD"><input type="radio" name="book-currency" data-role="book-currency" value="USD"> USD</label>
          <label data-currency-label="JPY"><input type="radio" name="book-currency" data-role="book-currency" value="JPY"> JPY</label>
        </div>
      </fieldset>
      <div class="status-line" role="status" data-role="booking-price" aria-live="polite"></div>
      <div class="field"><label for="book-card">Card number</label><input id="book-card" data-role="book-card" type="text" inputmode="numeric" autocomplete="cc-number"></div>
      <button data-role="pay-and-book">Pay and book</button>
    </div>
    <div data-role="book-confirmation" hidden>
      <h2 tabindex="-1">You're booked</h2>
      <p data-role="confirmation-line"></p>
      <button data-role="book-done">Done</button>
    </div>
    <button class="dialog-close" data-close aria-label="Close">✕</button>
  </div>
</dialog>
`;

const SHARED_HEADER = `
<header class="site-header">
  <a class="brand" href="/">Halden Reading Room</a>
  <nav class="main-nav" aria-label="Main">
    <a href="/">Chapters</a>
    <a href="/timeline">Timeline</a>
    <a href="/sources">Sources</a>
    <a href="/sessions">Sessions</a>
    <a href="/support">Support</a>
  </nav>
  <div class="header-actions">
    <button class="switch" data-role="switch-motion" role="switch" aria-checked="true" aria-label="Motion"><span class="switch-knob"></span>Motion</button>
    <button class="switch" data-role="switch-sound" role="switch" aria-checked="false" aria-label="Sound"><span class="switch-knob"></span>Sound</button>
    <button data-action="support" aria-label="Support">Support</button>
    <button data-action="sign-in" aria-label="Sign in">Sign in</button>
    <a data-action="account" href="/account" hidden><span data-id="person-name"></span> Account</a>
    <button data-action="sign-out" hidden>Sign out</button>
    <button class="menu-button" data-action="menu" aria-label="Menu">Menu</button>
  </div>
</header>
`;

const SHARED_RAIL = `
<nav class="rail-desktop" aria-label="Chapters">
${RAIL_LINKS}
</nav>
<button class="rail-phone" data-action="chapters" hidden>Chapters</button>
<nav class="rail-tablet" aria-label="Chapters">
${RAIL_LINKS}
</nav>
<dialog id="dialog-chapters" aria-label="Chapters">
  <div class="dialog-body">
    <h2>Chapters</h2>
    <nav aria-label="Chapters" class="stack">
${RAIL_LINKS}
    </nav>
    <button data-close style="margin-top:14px">Close</button>
  </div>
</dialog>
`;

export function layout(opts: LayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} — Halden Reading Room</title>
<link rel="stylesheet" href="/main.css">
</head>
<body data-page="${escapeHtml(opts.page)}">
${SHARED_HEADER}
${SHARED_DIALOGS}
${SHARED_RAIL}
<main>
  <div class="service-notice" role="status" aria-live="polite" hidden></div>
  <p class="notice-region" role="status" aria-live="polite" aria-label="Notices"></p>
  ${opts.body}
</main>
<script type="module" src="/main.js"></script>
</body>
</html>`;
}

export function notFoundPage(): string {
  return layout({
    title: "We couldn't find that room",
    page: 'not-found',
    body: `
  <h1>We couldn't find that room</h1>
  <p class="muted">The page you asked for isn't part of this exhibition.</p>
  <p><a href="/">Back to the chapter index</a></p>`,
  });
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
