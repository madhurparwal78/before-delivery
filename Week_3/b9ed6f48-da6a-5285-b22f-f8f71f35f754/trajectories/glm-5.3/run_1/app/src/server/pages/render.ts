import { layout, escapeHtml, notFoundPage } from './layout.ts';

export { notFoundPage };
import type { App } from '../api/app.ts';
import { NUMERALS, SEED_CHAPTERS } from '../core/seed.ts';
import { viewpoints, angle, alignment } from '../../shared/sightline.ts';

/** Page renderers, all reading the live database. */

export async function renderIndexPage(app: App): Promise<string> {
  const res = await app.pool.query(
    `SELECT number, title, era, status FROM chapters WHERE status = 'published' ORDER BY number`,
  );
  const cards = res.rows
    .map((row) => {
      const number = Number(row['number']);
      const numeral = NUMERALS[number] ?? String(number);
      return `<a class="chapter-card" href="/chapters/${number}" aria-label="Chapter ${numeral}: ${escapeHtml(String(row['title']))}">
  <div class="cat-number">HRR-${numeral}</div>
  <div class="numeral">${numeral}</div>
  <h2>${escapeHtml(String(row['title']))}</h2>
  <div class="era">${escapeHtml(String(row['era']))}</div>
  <div class="resolved-mark" data-resolved-for="${number}" hidden>Resolved</div>
</a>`;
    })
    .join('\n');
  return layout({
    title: 'Eight rooms of machine thought',
    page: 'index',
    body: `
  <h1>Eight rooms of machine thought</h1>
  <p class="muted">Sightline is the online exhibition of the Halden Reading Room. Each room is a 3D sculpture of scattered shards that forms its numeral and title from one viewpoint. Find the sightline, enter the room, and use the exhibits.</p>
  <p data-role="continue" class="muted" hidden></p>
  <div class="grid grid-3" data-role="chapter-grid">
${cards}
  </div>`,
  });
}

export async function renderChapterPage(app: App, number: number): Promise<string> {
  const res = await app.pool.query(
    `SELECT number, title, era, body, sightline_deg, exhibit, status FROM chapters WHERE number = $1`,
    [number],
  );
  const row = res.rows[0];
  if (!row || row['status'] !== 'published') return notFoundPage();
  const numeral = NUMERALS[number] ?? String(number);
  const catalogue = `HRR-${numeral}`;

  const eventsRes = await app.pool.query(
    `SELECT id, year, title, summary FROM events WHERE chapter = $1 AND status = 'published' ORDER BY year, title`,
    [number],
  );
  const eventsHtml = eventsRes.rows.length
    ? eventsRes.rows
        .map(
          (e) => `<article class="event-card">
  <div class="year">${e['year']}</div>
  <h4>${escapeHtml(String(e['title']))}</h4>
  <p class="muted">${escapeHtml(String(e['summary']))}</p>
</article>`,
        )
        .join('\n')
    : `<p class="muted">No timeline events in this chapter yet.</p>`;

  // Plates and narration from the media records.
  const platesRes = await app.pool.query(
    `SELECT id, transcript FROM media WHERE item_id = $1 AND kind = 'image' ORDER BY created_at ASC`,
    [`chapter-${number}`],
  );
  const plateImages = platesRes.rows
    .map(
      (p) =>
        `<img data-role="plate" src="/api/media/${String(p['id'])}" alt="${escapeHtml(String(p['transcript'] ?? 'Plate'))}" hidden>`,
    )
    .join('\n');
  const firstCaption = platesRes.rows[0] ? String(platesRes.rows[0]!['transcript'] ?? '') : '';
  const narrationRes = await app.pool.query(
    `SELECT id, transcript FROM media WHERE item_id = $1 AND kind = 'narration' ORDER BY created_at DESC LIMIT 1`,
    [`chapter-${number}`],
  );
  const narration = narrationRes.rows[0];
  const narrationUrl = narration ? `/api/media/${String(narration['id'])}` : '';
  const narrationTranscript = narration ? String(narration['transcript'] ?? '') : '';

  const exhibit = row['exhibit'] === null ? null : String(row['exhibit']);
  const exhibitHtml = exhibit ? exhibitMarkup(exhibit, number) : '';

  const nextNumber = number < 8 ? number + 1 : 1;
  const nextNumeral = NUMERALS[nextNumber] ?? String(nextNumber);
  const nextTitleRes = await app.pool.query(`SELECT title FROM chapters WHERE number = $1 AND status = 'published'`, [nextNumber]);
  const nextTitle = nextTitleRes.rows[0] ? String(nextTitleRes.rows[0]!['title']) : '';

  const sightlineDeg = Number(row['sightline_deg']);
  const viewList = viewpoints(sightlineDeg)
    .map((deg) => ({ deg, pct: alignment(deg, sightlineDeg) }))
    .map((v) => `<label class="viewpoint"><input type="radio" name="viewpoint" role="radio" aria-label="Viewpoint ${angle(v.deg)}, alignment ${v.pct}%" value="${v.deg}"><div class="angle">${angle(v.deg)} · ${v.pct}%</div></label>`)
    .join('\n');

  return layout({
    title: `${numeral} — ${String(row['title'])}`,
    page: 'chapter',
    body: `
  <section data-role="sightline-scene" aria-label="Sightline scene">
    <div class="scene-wrap">
      <div data-role="scene-container">
        <div class="overline-heading" data-role="chapter-heading"><h1>${escapeHtml(String(row['title']))}</h1></div>
      </div>
    </div>
    <div class="scene-label">
      <div class="mono">${catalogue}</div>
      <div class="muted">${escapeHtml(String(row['era']))}</div>
      <p class="muted" style="margin-top:10px">Turn the sculpture by dragging, scrolling or pressing the arrow keys. It forms ${numeral} from one viewpoint.</p>
      <input type="range" min="0" max="100" value="0" step="1" data-role="sightline-slider" role="slider" aria-label="Sightline" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="Yaw -60°, alignment 50%">
      <div class="row spread">
        <span class="readout" data-role="alignment-meter" role="meter" aria-label="Alignment">Alignment 50%</span>
        <div class="row">
          <button data-role="align">Align</button>
          <button data-role="enter-chapter" disabled>Enter chapter</button>
        </div>
      </div>
      <p class="status-line" role="status" data-role="sightline-status" aria-live="polite"></p>
      <div data-role="viewpoints" hidden>
        <p class="muted">Seven still viewpoints of the sculpture.</p>
        <div class="viewpoints" data-role="viewpoints-group" role="radiogroup" aria-label="Viewpoints">
${viewList}
        </div>
      </div>
    </div>
  </section>

  <section class="card" aria-label="Chapter text" style="margin-top:24px">
    <div class="cat-number">${catalogue}</div>
    <h2>${escapeHtml(String(row['title']))}</h2>
    <p class="muted">${escapeHtml(String(row['era']))}</p>
    <div class="row" style="margin-top:10px">
      <button data-role="bookmark-chapter" aria-pressed="false">Bookmark chapter</button>
    </div>
    <div class="stack" style="margin-top:16px">
      <div class="narration-row">
        <button data-role="play-narration">Play narration</button>
        <button data-role="transcript-toggle" aria-expanded="false">Transcript</button>
        ${narrationUrl ? `<audio data-role="narration-audio" src="${narrationUrl}" preload="none"></audio>` : ''}
      </div>
      <div class="transcript" data-role="transcript" hidden>${escapeHtml(narrationTranscript)}</div>
      <div>${String(row['body']).split('\n').map((p) => `<p>${escapeHtml(String(p))}</p>`).join('')}</div>
      <div class="plate-viewer" data-role="plates" aria-label="Plates">
        ${plateImages}
        <div class="plate-caption" data-role="plate-caption">${escapeHtml(firstCaption)}</div>
        <div class="row" style="margin-top:10px">
          <button data-role="pause-plates">Pause plates</button>
          <button data-role="next-plate">Next plate</button>
          <button data-role="previous-plate">Previous plate</button>
        </div>
      </div>
    </div>
  </section>

  <section data-role="exhibit-band" hidden style="margin-top:24px">
${exhibitHtml}
  </section>

  <section style="margin-top:24px">
    <h3>Timeline events</h3>
    <div class="stack">
${eventsHtml}
    </div>
  </section>

  <section class="threshold-band" data-role="threshold-band">
    <p class="muted">The next room</p>
    <div class="next-title" data-role="next-title">${escapeHtml(nextTitle)}</div>
    <a class="muted" href="/chapters/${nextNumber}">Enter chapter ${nextNumeral}</a>
  </section>`,
  });
}

function exhibitMarkup(exhibit: string, number: number): string {
  const catalogue = `HRR-${NUMERALS[number] ?? number}-01`;
  if (exhibit === 'spring') {
    return `<div class="exhibit" data-exhibit="spring">
  <div class="cat-number">${catalogue}</div>
  <div class="exhibit-title">The plucked spring</div>
  <p class="muted">Change the stiffness and the damping and watch the regime change, then pluck the sculpture.</p>
  <div class="slider-row"><label for="spring-stiffness">Stiffness</label><input id="spring-stiffness" data-role="stiffness" type="range" min="50" max="300" step="10" value="170" aria-label="Stiffness"><span class="value" data-role="stiffness-value">170</span></div>
  <div class="slider-row"><label for="spring-damping">Damping</label><input id="spring-damping" data-role="damping" type="range" min="2" max="40" step="1" value="26" aria-label="Damping"><span class="value" data-role="damping-value">26</span></div>
  <div class="row"><button data-role="pluck">Pluck</button></div>
  <canvas data-role="spring-canvas" width="560" height="220" aria-hidden="true"></canvas>
  <p class="status-line" role="status" data-role="spring-status" aria-live="polite">Spring is underdamped.</p>
</div>`;
  }
  if (exhibit === 'rules') {
    return `<div class="exhibit" data-exhibit="rules">
  <div class="cat-number">${catalogue}</div>
  <div class="exhibit-title">The rule engine</div>
  <p class="muted">Write rules for the specimens. The first rule that matches wins.</p>
  <div data-role="rules-list"></div>
  <div class="row"><button data-role="add-rule">Add rule</button></div>
  <table aria-label="Specimens">
    <thead><tr><th>Specimen</th><th>Label</th></tr></thead>
    <tbody data-role="specimens-body"></tbody>
  </table>
  <p class="status-line" role="status" data-role="rules-status" aria-live="polite"></p>
</div>`;
  }
  if (exhibit === 'classifier') {
    return `<div class="exhibit" data-exhibit="classifier">
  <div class="cat-number">${catalogue}</div>
  <div class="exhibit-title">The perceptron</div>
  <p class="muted">Move a training point, or press Train. The boundary and the held-out score update at once.</p>
  <div class="row spread">
    <div data-role="training-points" class="point-grid" role="group" aria-label="Training points"></div>
    <canvas data-role="classifier-canvas" width="360" height="360" aria-hidden="true"></canvas>
  </div>
  <div class="move-row">
    <button data-role="move-left">Move point left</button>
    <button data-role="move-right">Move point right</button>
    <button data-role="move-up">Move point up</button>
    <button data-role="move-down">Move point down</button>
    <button data-role="train">Train</button>
  </div>
  <table aria-label="Confusion counts">
    <thead><tr><th></th><th>Predicted signal</th><th>Predicted noise</th></tr></thead>
    <tbody>
      <tr><th scope="row">Actual signal</th><td data-cell="signal-signal">0</td><td data-cell="signal-noise">0</td></tr>
      <tr><th scope="row">Actual noise</th><td data-cell="noise-signal">0</td><td data-cell="noise-noise">0</td></tr>
    </tbody>
  </table>
  <p data-role="held-out-accuracy">Held-out accuracy 0.0%</p>
  <p class="status-line" role="status" data-role="classifier-status" aria-live="polite"></p>
</div>`;
  }
  return `<div class="exhibit" data-exhibit="neighbours">
  <div class="cat-number">${catalogue}</div>
  <div class="exhibit-title">Words near words</div>
  <p class="muted">Choose a word and a context. The three nearest words recompute.</p>
  <div class="field-row">
    <div class="field"><label for="neighbours-word">Word</label><select id="neighbours-word" data-role="word"></select></div>
    <div class="field"><label for="neighbours-context">Context</label><select id="neighbours-context" data-role="context"></select></div>
  </div>
  <table aria-label="Neighbours">
    <thead><tr><th>Word</th><th>Similarity</th></tr></thead>
    <tbody data-role="neighbours-body"></tbody>
  </table>
  <p class="status-line" role="status" data-role="neighbours-status" aria-live="polite"></p>
</div>`;
}

export async function renderTimelinePage(app: App): Promise<string> {
  const chaptersRes = await app.pool.query(`SELECT number, title FROM chapters WHERE status = 'published' ORDER BY number`);
  const options = chaptersRes.rows
    .map((r) => {
      const n = Number(r['number']);
      return `<option value="${n}">Chapter ${NUMERALS[n] ?? n}</option>`;
    })
    .join('\n');
  return layout({
    title: 'Timeline archive',
    page: 'timeline',
    body: `
  <h1>Timeline archive</h1>
  <div class="timeline-controls">
    <input type="search" data-role="search-box" aria-label="Search the archive" placeholder="Search the archive">
    <select data-role="chapter-filter" aria-label="Chapter">
      <option value="">All chapters</option>
${options}
    </select>
  </div>
  <p class="status-line" role="status" data-role="search-status" aria-live="polite"></p>
  <div class="grid grid-3" data-role="search-results" aria-label="Search results"></div>`,
  });
}

export async function renderSourcesPage(app: App): Promise<string> {
  void app;
  return layout({
    title: 'Sources',
    page: 'sources',
    body: `
  <h1>Sources</h1>
  <div class="stack" data-role="sources"></div>`,
  });
}

export async function renderSessionsPage(app: App): Promise<string> {
  void app;
  return layout({
    title: 'Sessions',
    page: 'sessions',
    body: `
  <h1>Guided sessions</h1>
  <p class="muted">Every session is led by a guide of the Reading Room and starts in Lisbon time.</p>
  <div class="grid grid-2" data-role="sessions-grid"></div>`,
  });
}

export async function renderSupportPage(app: App): Promise<string> {
  void app;
  return layout({
    title: 'Support the Reading Room',
    page: 'support',
    body: `
  <h1>Support the Reading Room</h1>
  <p class="muted">Supporters keep the rooms open. Choose a tier in your own currency, or make a one-off donation.</p>
  <div class="grid grid-3" data-role="tiers">
    ${['reader', 'fellow', 'patron']
      .map(
        (tier) => `<div class="card" data-tier="${tier}">
      <div class="cat-number">tier</div>
      <h3>${tier === 'reader' ? 'Reader' : tier === 'fellow' ? 'Fellow' : 'Patron'}</h3>
      <div data-role="tier-price"></div>
      <div class="muted" data-role="tier-change"></div>
    </div>`,
      )
      .join('\n')}
  </div>
  <div class="row" style="margin-top:14px"><button data-action="choose-plan">Choose a plan</button></div>
  <form class="card" data-role="donate-form" style="margin-top:24px" aria-label="Donate">
    <div data-role="alert" class="alert" hidden></div>
    <h2 data-role="donate-thanks" hidden>Thank you for your donation</h2>
    <div class="field-row">
      <div class="field"><label for="donate-amount">Amount</label><input id="donate-amount" data-role="donate-amount" type="text" inputmode="decimal"></div>
    </div>
    <fieldset class="field">
      <legend>Currency</legend>
      <div class="row" role="radiogroup" aria-label="Currency">
        <label><input type="radio" name="donate-currency" data-role="donate-currency" value="EUR" checked> EUR</label>
        <label><input type="radio" name="donate-currency" data-role="donate-currency" value="GBP"> GBP</label>
        <label><input type="radio" name="donate-currency" data-role="donate-currency" value="USD"> USD</label>
        <label><input type="radio" name="donate-currency" data-role="donate-currency" value="JPY"> JPY</label>
      </div>
    </fieldset>
    <div class="field"><label for="donate-card">Card number</label><input id="donate-card" data-role="donate-card" type="text" inputmode="numeric" autocomplete="cc-number"></div>
    <div class="field"><label for="donate-note">Note to the curators</label><input id="donate-note" data-role="donate-note" type="text"></div>
    <button type="submit" data-role="donate-submit">Donate</button>
  </form>`,
  });
}

export async function renderAccountPage(app: App): Promise<string> {
  void app;
  return layout({
    title: 'Your account',
    page: 'account',
    body: `
  <h1>Your account</h1>
  <div class="grid grid-2">
    <section class="card" data-role="membership" aria-label="Membership">
      <div class="cat-number">membership</div>
      <h2>Membership</h2>
      <p data-role="membership-status" class="status-line"></p>
      <p data-role="membership-detail" class="status-line"></p>
      <p data-role="membership-next" class="status-line"></p>
      <div class="row" data-role="membership-actions"></div>
    </section>
    <section class="card" aria-label="Orders">
      <div class="cat-number">orders</div>
      <h2>Orders</h2>
      <table aria-label="Orders">
        <thead><tr><th>Receipt</th><th>Item</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody data-role="orders-body"></tbody>
      </table>
    </section>
    <section class="card" data-role="path" aria-label="Your path">
      <div class="cat-number">path</div>
      <h2>Your path</h2>
      <p class="muted">Resolved chapters</p>
      <ul data-role="resolved-list"></ul>
      <p data-role="continue"></p>
    </section>
    <section class="card" aria-label="Bookmarks">
      <div class="cat-number">bookmarks</div>
      <h2>Bookmarks</h2>
      <ul class="stack" data-role="bookmarks-list"></ul>
    </section>
  </div>`,
  });
}

export async function renderStudioPage(app: App): Promise<string> {
  void app;
  return layout({
    title: 'Studio',
    page: 'studio',
    body: `
  <h1>Studio</h1>
  <section class="panel">
    <h2>Items</h2>
    <div class="filters">
      <select data-role="filter-type" aria-label="Type">
        <option value="">All types</option>
        <option value="chapter">Chapter</option>
        <option value="event">Event</option>
      </select>
      <select data-role="filter-status" aria-label="Status">
        <option value="">All statuses</option>
        <option value="draft">Draft</option>
        <option value="review">Review</option>
        <option value="scheduled">Scheduled</option>
        <option value="published">Published</option>
        <option value="withdrawn">Withdrawn</option>
      </select>
      <button data-role="apply-filters">Apply</button>
    </div>
    <table data-role="items-table" aria-label="Items">
      <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Owner</th><th>Actions</th></tr></thead>
      <tbody data-role="items-body"></tbody>
    </table>
  </section>
  <section class="panel">
    <h2>Per-chapter events</h2>
    <select data-role="chapter-panel-select" aria-label="Chapter">
      ${SEED_CHAPTERS.map((c) => `<option value="${c.number}">Chapter ${c.numeral} — ${c.title}</option>`).join('')}
    </select>
    <div data-role="chapter-events" aria-label="Chapter events">
      <h3 data-role="chapter-events-title"></h3>
      <ul class="stack" data-role="chapter-events-list"></ul>
    </div>
    <button data-role="new-event">New event</button>
  </section>
  <section class="panel">
    <h2>Upload media</h2>
    <form data-role="upload-form" aria-label="Upload media">
      <div data-role="alert" class="alert" hidden></div>
      <div class="field-row">
        <div class="field"><label for="upload-kind">Kind</label>
          <select id="upload-kind" data-role="upload-kind">
            <option value="image">Image</option>
            <option value="scan">Scan</option>
            <option value="narration">Narration</option>
          </select>
        </div>
        <div class="field"><label for="upload-item">Item</label>
          <select id="upload-item" data-role="upload-item">
            ${SEED_CHAPTERS.map((c) => `<option value="chapter-${c.number}">Chapter ${c.numeral}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field"><label for="upload-file">File</label><input id="upload-file" data-role="upload-file" type="file"></div>
      <div class="field"><label for="upload-transcript">Transcript</label><input id="upload-transcript" data-role="upload-transcript" type="text"></div>
      <button type="submit">Upload</button>
    </form>
    <p class="status-line" role="status" data-role="upload-status" aria-live="polite"></p>
  </section>
  <section class="panel">
    <h2>New source</h2>
    <form data-role="source-form" aria-label="New source">
      <div class="field"><label for="source-citation">Citation</label><input id="source-citation" data-role="source-citation" type="text"></div>
      <button type="submit">Save</button>
    </form>
  </section>

  <dialog id="dialog-new-event" aria-label="New timeline event">
    <div class="dialog-body">
      <div data-role="alert" class="alert" hidden></div>
      <h2>New timeline event</h2>
      <form>
        <div class="field"><label for="ne-chapter">Chapter</label>
          <select id="ne-chapter" data-role="new-event-chapter">
            ${SEED_CHAPTERS.map((c) => `<option value="${c.number}">Chapter ${c.numeral}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label for="ne-year">Year</label><input id="ne-year" data-role="new-event-year" type="number" min="1600" max="2100"></div>
        <div class="field"><label for="ne-title">Title</label><input id="ne-title" data-role="new-event-title" type="text"></div>
        <div class="field"><label for="ne-summary">Summary</label><textarea id="ne-summary" data-role="new-event-summary"></textarea></div>
        <button type="submit">Save draft</button>
      </form>
      <button class="dialog-close" data-close aria-label="Close">✕</button>
    </div>
  </dialog>

  <dialog id="dialog-schedule" aria-label="Schedule">
    <div class="dialog-body">
      <div data-role="alert" class="alert" hidden></div>
      <h2>Schedule</h2>
      <div class="field"><label for="publish-at">Publish at (Lisbon time)</label><input id="publish-at" data-role="publish-at" type="text" placeholder="YYYY-MM-DD HH:MM:SS"></div>
      <button data-role="confirm-schedule">Schedule</button>
      <button class="dialog-close" data-close aria-label="Close">✕</button>
    </div>
  </dialog>

  <dialog id="dialog-withdraw" aria-label="Withdraw">
    <div class="dialog-body">
      <div data-role="alert" class="alert" hidden></div>
      <h2>Withdraw</h2>
      <div class="field"><label for="withdraw-reason">Reason</label><input id="withdraw-reason" data-role="withdraw-reason" type="text"></div>
      <button data-role="confirm-withdraw">Withdraw</button>
      <button class="dialog-close" data-close aria-label="Close">✕</button>
    </div>
  </dialog>`,
  });
}

export async function renderBoxOfficePage(app: App): Promise<string> {
  void app;
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return layout({
    title: 'Box office',
    page: 'box-office',
    body: `
  <h1>Box office</h1>
  <div class="grid grid-2">
    <section class="panel">
      <h2>Sessions</h2>
      <form data-role="new-session-form" aria-label="New session">
        <div data-role="alert" class="alert" hidden></div>
        <div class="field"><label for="session-title">Title</label><input id="session-title" data-role="session-title" type="text"></div>
        <div class="field"><label for="session-start">Starts at (Lisbon time)</label><input id="session-start" data-role="session-start" type="text" placeholder="YYYY-MM-DD HH:MM:SS"></div>
        <div class="field-row">
          <div class="field"><label for="session-duration">Duration in minutes</label><input id="session-duration" data-role="session-duration" type="number" min="15" max="240"></div>
          <div class="field"><label for="session-capacity">Capacity</label><input id="session-capacity" data-role="session-capacity" type="number" min="1" max="200"></div>
        </div>
        <button type="submit">Create session</button>
      </form>
      <div class="stack" data-role="manager-sessions" style="margin-top:16px"></div>
    </section>
    <section class="panel">
      <h2>Price change</h2>
      <form data-role="price-change-form" aria-label="Price change">
        <div data-role="alert" class="alert" hidden></div>
        <div class="field-row">
          <div class="field"><label for="price-tier">Tier</label>
            <select id="price-tier" data-role="price-tier">
              <option value="reader">Reader</option>
              <option value="fellow">Fellow</option>
              <option value="patron">Patron</option>
            </select>
          </div>
          <div class="field"><label for="price-currency">Currency</label>
            <select id="price-currency" data-role="price-currency">
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="USD">USD</option>
              <option value="JPY">JPY</option>
            </select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label for="price-amount">New price</label><input id="price-amount" data-role="price-amount" type="text"></div>
          <div class="field"><label for="price-effective">Effective from</label><input id="price-effective" data-role="price-effective" type="text" placeholder="YYYY-MM-DD"></div>
        </div>
        <button type="submit">Schedule price change</button>
      </form>
    </section>
    <section class="panel">
      <h2>Ledger</h2>
      <table data-role="ledger" aria-label="Ledger">
        <thead><tr><th>Receipt</th><th>Kind</th><th>Buyer</th><th>Amount</th><th>Refunded</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody data-role="ledger-body"></tbody>
      </table>
    </section>
    <section class="panel">
      <h2>Overdue supporters</h2>
      <table data-role="overdue" aria-label="Overdue supporters">
        <thead><tr><th>Email</th><th>Name</th><th>Tier</th><th>Due</th><th>Attempts</th><th>Next retry</th></tr></thead>
        <tbody data-role="overdue-body"></tbody>
      </table>
    </section>
    <section class="panel">
      <h2>Reconciliation</h2>
      <select data-role="reconciliation-month" aria-label="Month" value="${month}">
        <option value="${month}">${month}</option>
      </select>
      <table data-role="reconciliation" aria-label="Reconciliation">
        <thead><tr><th>Currency</th><th>Ledger net</th><th>Kill Bill net</th><th>Status</th></tr></thead>
        <tbody data-role="reconciliation-body"></tbody>
      </table>
    </section>
    <section class="panel">
      <h2>Staff actions</h2>
      <table data-role="audit" aria-label="Staff actions">
        <thead><tr><th>At</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody data-role="audit-body"></tbody>
      </table>
    </section>
  </div>

  <dialog id="dialog-refund" aria-label="Refund">
    <div class="dialog-body">
      <div data-role="alert" class="alert" hidden></div>
      <h2>Refund</h2>
      <div class="field"><label for="refund-amount">Amount</label><input id="refund-amount" data-role="refund-amount" type="text"></div>
      <div class="field"><label for="refund-reason">Reason</label><input id="refund-reason" data-role="refund-reason" type="text"></div>
      <button data-role="confirm-refund">Issue refund</button>
      <button class="dialog-close" data-close aria-label="Close">✕</button>
    </div>
  </dialog>

  <dialog id="dialog-note" aria-label="Add note">
    <div class="dialog-body">
      <div data-role="alert" class="alert" hidden></div>
      <h2>Add note</h2>
      <div class="field"><label for="note-text">Note</label><input id="note-text" data-role="note-text" type="text"></div>
      <button data-role="confirm-note">Save note</button>
      <button class="dialog-close" data-close aria-label="Close">✕</button>
    </div>
  </dialog>

  <dialog id="dialog-cancel-session" aria-label="Cancel session">
    <div class="dialog-body">
      <div data-role="alert" class="alert" hidden></div>
      <h2>Cancel session</h2>
      <div class="field"><label for="cancel-reason">Reason</label><input id="cancel-reason" data-role="cancel-reason" type="text"></div>
      <button data-role="confirm-cancel-session">Cancel session</button>
      <button class="dialog-close" data-close aria-label="Close">✕</button>
    </div>
  </dialog>`,
  });
}
