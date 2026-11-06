'use strict';

// The rollout console never works out a figure itself: it prints what the flag detail,
// evidence pack and promotion list routes last returned, and reloads them after every answer.
(() => {
  const OUTAGE = 'The rollout store did not answer. Check the promotion history before trying again.';
  const PENDING = 'Working…';
  const REGULAR_RELOAD_MS = 10000;
  const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

  const initial = JSON.parse(document.getElementById('console-data').textContent);
  const cohortByCode = new Map(initial.cohorts.map((cohort) => [cohort.cohort_code, cohort]));
  const flagOrder = initial.flags.map((flag) => flag.flag_code);
  const view = {
    flags: new Map(initial.flags.map((flag) => [flag.flag_code, flag])),
    packs: initial.packs,
    promotions: initial.promotions,
  };
  const statusLine = document.querySelector('[data-role="status"]');
  let pressesInFlight = 0;
  let reloadsStarted = 0;
  let reloadApplied = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const shown = (value) => (value === null || value === undefined ? 'none' : String(value));
  const stateClass = (state) => `state--${state.toLowerCase().replace(/\s+/g, '-')}`;
  const rungList = (rungs) => (rungs.length ? rungs.join(', ') : 'none');

  function tick() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '3');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
  }

  // One rung card, printed field by field from the rung detail of the flag detail route.
  function rungCard(rung) {
    const card = element('li', `rung ${stateClass(rung.state)}`);
    const head = element('div', 'rung__head');
    head.append(element('span', 'rung__title', `Rung ${rung.rung_index_count} · ${rung.cohort_label}`));
    const states = element('span', 'rung__states');
    states.append(element('span', `state ${stateClass(rung.state)}`, rung.state));
    if (rung.attested) {
      const attested = element('span', 'attested');
      attested.append(tick(), 'Attested');
      states.append(' ', attested);
    }
    head.append(' ', states);

    // The figures follow the brief's card list: promotion instants, soak, rate, attestation. The
    // instants and the soak share a row when the card is wide enough, and a figure never wraps
    // away from its phrase: "demoted at minute N" moves as one piece.
    const promoted = element('p', 'rung__line', `Promoted at minute ${shown(rung.promoted_at_minutes)}`);
    if (rung.demoted_at_minutes !== null) {
      promoted.append(', ', element('span', 'rung__phrase', `demoted at minute ${rung.demoted_at_minutes}`));
    }
    const instants = element('div', 'rung__row');
    instants.append(
      promoted, '\n',
      element('p', 'rung__line', `Soak ${shown(rung.soak_elapsed_minutes)} minutes of ${rung.min_soak_minutes} minutes`),
    );
    // Separators keep each line a separate phrase in the card's text, not only on screen.
    card.append(
      head, '\n',
      instants, '\n',
      element('p', 'rung__line',
        `Rate ${rung.rate_bp} basis points from ${rung.event_count} events on ${rung.device_count} devices, maximum ${rung.max_adverse_rate_bp} basis points`), '\n',
      element('p', 'rung__line', `Attestation ${shown(rung.attestation_reference)}`),
    );
    return card;
  }

  function regionOf(flagCode) {
    return document.querySelector(`section[data-flag="${flagCode}"]`);
  }

  function renderFlag(flagCode) {
    const detail = view.flags.get(flagCode);
    const region = regionOf(flagCode);
    region.querySelector('[data-role="maximum"]').textContent = `maximum ${detail.max_adverse_rate_bp} basis points`;
    region.querySelector('[data-role="ladder"]').replaceChildren(...detail.rungs.map(rungCard));
  }

  function renderPack() {
    const rows = flagOrder.map((flagCode) => {
      const pack = view.packs.find((entry) => entry.flag_code === flagCode);
      const row = element('tr');
      const flag = element('th', '', view.flags.get(flagCode).flag_label);
      flag.scope = 'row';
      row.append(
        flag,
        element('td', 'figure', String(pack.highest_rung_index_count)),
        element('td', pack.gap_rung_index_counts.length ? 'figure has-gap' : 'figure', rungList(pack.gap_rung_index_counts)),
        element('td', 'figure', rungList(pack.soak_satisfied_rung_index_counts)),
        element('td', 'figure', rungList(pack.rate_satisfied_rung_index_counts)),
      );
      return row;
    });
    document.querySelector('[data-role="pack"]').replaceChildren(...rows);
  }

  function renderHistory() {
    const rows = view.promotions.map((promotion) => {
      const cohort = cohortByCode.get(promotion.cohort_code);
      const row = element('tr');
      row.append(
        element('td', 'code', promotion.promotion_code),
        element('td', 'code', promotion.flag_code),
        element('td', '', `Rung ${cohort.rung_index_count} · ${cohort.cohort_label}`),
        element('td', 'figure', `minute ${promotion.promoted_at_minutes}`),
        element('td', 'figure', promotion.demoted_at_minutes === null ? 'none' : `minute ${promotion.demoted_at_minutes}`),
        element('td', 'reference', shown(promotion.attestation_reference)),
      );
      if (promotion.demoted_at_minutes !== null) row.className = 'is-demoted';
      return row;
    });
    document.querySelector('[data-role="history"]').replaceChildren(...rows);
  }

  async function getJSON(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
    return response.json();
  }

  // Reads the flags' detail, the evidence pack and the promotion history, and returns a
  // function that shows them all at once. An older reload never overwrites a newer one.
  async function reload(flagCodes) {
    const generation = ++reloadsStarted;
    try {
      const [details, packs, promotions] = await Promise.all([
        Promise.all(flagCodes.map((flagCode) => getJSON(`/api/capability_flag/${encodeURIComponent(flagCode)}`))),
        getJSON('/api/evidence_pack'),
        getJSON('/api/promotion'),
      ]);
      return () => {
        if (generation < reloadApplied) return;
        reloadApplied = generation;
        details.forEach((detail) => view.flags.set(detail.flag_code, detail));
        view.packs = packs;
        view.promotions = promotions;
        flagCodes.forEach(renderFlag);
        renderPack();
        renderHistory();
      };
    } catch {
      return () => {};
    }
  }

  // Sends one press. A press that gets no response at all is resent once with the same
  // idempotency key and body; null means the store did not answer.
  async function send(method, path, body, idempotencyKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const attempt = () => fetch(path, { method, headers, body, cache: 'no-store' });
    let response;
    try {
      response = await attempt();
    } catch {
      if (!idempotencyKey) return null;
      try {
        response = await attempt();
      } catch {
        return null;
      }
    }
    let answer = null;
    try {
      answer = await response.json();
    } catch {
      answer = null;
    }
    return { status: response.status, body: answer };
  }

  function freshIdempotencyKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return `console-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }

  // Shows a refusal, field error or outage in the alert of the region where the action started.
  function showProblem(alert, result) {
    if (result && result.status === 422 && result.body && result.body.errors) {
      const errors = result.body.errors;
      const list = element('ul', 'alert__lines');
      Object.keys(errors).sort().forEach((field) => list.append(element('li', '', `${field}: ${errors[field]}`), '\n'));
      alert.replaceChildren(element('p', 'alert__title', 'Not accepted:'), '\n', list);
    } else if (result && result.status !== 503 && result.body && typeof result.body.error === 'string') {
      alert.replaceChildren(element('p', 'alert__title', result.body.error));
    } else {
      alert.replaceChildren(element('p', 'alert__title', OUTAGE));
    }
  }

  // Runs one press: pending copy, the request, the alert or the success copy, then the reload.
  async function press({ button, focusAfter, alert, method, path, body, idempotent, reloadFlags, onSuccess }) {
    if (button.disabled) return;
    const label = button.textContent;
    pressesInFlight += 1;
    alert.replaceChildren();
    statusLine.textContent = '';
    button.disabled = true;
    // The control keeps its published name while its face reads the pending copy.
    button.setAttribute('aria-label', label);
    button.textContent = PENDING;

    const result = await send(method, path, body, idempotent ? freshIdempotencyKey() : null);
    const succeeded = result && (result.status === 200 || result.status === 201);
    if (!succeeded) showProblem(alert, result);
    const show = await reload(reloadFlags);
    show();
    if (succeeded) statusLine.textContent = onSuccess(result.body);

    button.textContent = label;
    button.removeAttribute('aria-label');
    button.disabled = false;
    pressesInFlight -= 1;
    // Focus stays where the operator left it: back on the pressed control when disabling it
    // dropped focus, and untouched when they have moved on to another control meanwhile.
    const active = document.activeElement;
    if (!active || active === document.body || active === button) focusAfter.focus({ preventScroll: true });
  }

  // A JSON field holding exactly what the operator typed: a number when the text is one.
  const numberField = (typed) => {
    const trimmed = typed.trim();
    if (JSON_NUMBER.test(trimmed)) return trimmed;
    return trimmed === '' ? 'null' : JSON.stringify(typed);
  };
  const jsonBody = (fields) => `{${fields.map(([name, value]) => `${JSON.stringify(name)}:${value}`).join(',')}}`;

  flagOrder.forEach((flagCode) => {
    const region = regionOf(flagCode);
    const target = region.querySelector('[data-role="target"]');
    const reference = region.querySelector('[data-role="reference"]');
    const alert = region.querySelector('[data-role="alert"]');
    const button = (action) => region.querySelector(`[data-action="${action}"]`);
    const label = () => view.flags.get(flagCode).flag_label;
    const rungOf = (promotion) => cohortByCode.get(promotion.cohort_code).rung_index_count;

    const promote = (focusAfter) => press({
      button: button('promote'), focusAfter, alert, method: 'POST', path: '/api/promotion', idempotent: true,
      body: jsonBody([['flag_code', JSON.stringify(flagCode)], ['cohort_code', JSON.stringify(target.value)],
        ['attestation_reference', JSON.stringify(reference.value)]]),
      reloadFlags: [flagCode],
      onSuccess: (promotion) => `Promoted ${label()} to rung ${rungOf(promotion)}.`,
    });
    const forceEnable = () => press({
      button: button('force-enable'), focusAfter: button('force-enable'), alert, method: 'POST',
      path: '/api/promotion/force-enable', idempotent: true,
      body: jsonBody([['flag_code', JSON.stringify(flagCode)], ['cohort_code', JSON.stringify(target.value)]]),
      reloadFlags: [flagCode],
      onSuccess: (promotion) => `Force enabled ${label()} at rung ${rungOf(promotion)}.`,
    });
    // The ladder stays contiguous, so the new highest active rung is the one below the demoted rung.
    const rollback = () => press({
      button: button('rollback'), focusAfter: button('rollback'), alert, method: 'POST',
      path: '/api/promotion/rollback', idempotent: true,
      body: jsonBody([['flag_code', JSON.stringify(flagCode)]]),
      reloadFlags: [flagCode],
      onSuccess: (promotion) => `Rolled back ${label()} to rung ${rungOf(promotion) - 1}.`,
    });

    button('promote').addEventListener('click', () => promote(button('promote')));
    button('force-enable').addEventListener('click', forceEnable);
    button('rollback').addEventListener('click', rollback);
    reference.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        promote(reference);
      }
    });
  });

  const eventForm = document.querySelector('[data-role="event-form"]');
  eventForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const field = (name) => eventForm.elements[name];
    const submitButton = eventForm.querySelector('button[type="submit"]');
    const focusAfter = event.submitter || document.activeElement || submitButton;
    press({
      button: submitButton, focusAfter, alert: eventForm.querySelector('[data-role="alert"]'),
      method: 'POST', path: '/api/adverse_event', idempotent: false,
      body: jsonBody([
        ['event_code', JSON.stringify(field('event_code').value)],
        ['device_code', JSON.stringify(field('device_code').value)],
        ['flag_code', JSON.stringify(field('flag_code').value)],
        ['occurred_at_minutes', numberField(field('occurred_at_minutes').value)],
        ['severity_band_code', JSON.stringify(field('severity_band_code').value)],
      ]),
      reloadFlags: flagOrder,
      onSuccess: (adverseEvent) => {
        field('event_code').value = '';
        return `Recorded adverse event ${adverseEvent.event_code}.`;
      },
    });
  });

  const settings = document.querySelector('[data-role="settings"]');
  settings.querySelectorAll('.setting').forEach((group) => {
    const input = group.querySelector('input');
    const saveButton = group.querySelector('[data-action="save"]');
    const forFlag = group.dataset.setting === 'flag';
    const save = (focusAfter) => press({
      button: saveButton, focusAfter, alert: settings.querySelector('[data-role="alert"]'), method: 'PATCH',
      path: forFlag ? `/api/capability_flag/${encodeURIComponent(group.dataset.code)}` : `/api/cohort/${encodeURIComponent(group.dataset.code)}`,
      idempotent: false,
      body: jsonBody([[forFlag ? 'max_adverse_rate_bp' : 'min_soak_minutes', numberField(input.value)]]),
      reloadFlags: flagOrder,
      onSuccess: () => 'Saved.',
    });
    saveButton.addEventListener('click', () => save(saveButton));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save(input);
      }
    });
  });

  flagOrder.forEach(renderFlag);
  renderPack();
  renderHistory();

  setInterval(async () => {
    if (pressesInFlight > 0) return;
    const show = await reload(flagOrder);
    show();
  }, REGULAR_RELOAD_MS);
})();
