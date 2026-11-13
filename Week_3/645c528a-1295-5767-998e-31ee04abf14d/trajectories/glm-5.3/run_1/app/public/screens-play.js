// Play screens: tier picker, mode picker, and the live table screen.

import { el, api, navigate, fmt, copy, TIERS, POCKET_LABELS } from './ui.js';
import { state, loadMe, openLive, onLive, reducedMotion } from './app-state.js';
import { PoolTable, buildControls, buildScoreboard } from './pool.js';

// ---------- Tier picker ----------

export async function tierPickerScreen(mode = 'eight-ball') {
  const me = await loadMe().catch(() => state.me);
  const title = el('h1', { text: mode === 'special' ? 'Special modes' : 'Stake tiers' });
  const container = el('div', {});
  main().replaceChildren(title, container);

  if (mode === 'special') {
    container.append(el('p', { class: 'mode-note', text: 'Special modes use the same tier picker and rewards.' }));
    const grid = el('div', { class: 'card-grid' });
    const nine = el('button', { class: 'mode-card', text: '9-Ball', onclick: () => navigate('/play?mode=nine-ball') },
      el('span', { class: 'mode-note', text: 'Hit the lowest ball first. Pot the 9 legally to win.' }));
    const noGuide = el('button', { class: 'mode-card', text: 'No Guidelines', onclick: () => navigate('/play?mode=no-guidelines') },
      el('span', { class: 'mode-note', text: me && me.level >= 5 ? 'No aim line, no Contact Loupe.' : copy.modeLocked(5) }));
    grid.append(nine, noGuide);
    container.append(grid);
    return;
  }

  const modeParam = qsMode();
  const queueStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Queue', id: 'queue-status', text: '' });
  const selectedTier = el('p', { class: 'status', role: 'status', 'aria-label': 'Selected tier', id: 'selected-tier', text: TIERS[0].name });

  let selected = 0;
  const region = el('section', { class: 'tier-region', role: 'region', 'aria-label': 'Stake tiers', id: 'stake-tiers', tabindex: '0' });
  const track = el('div', { class: 'tier-track' });
  const cards = [];

  const joinButtons = [];

  function cardFor(index) {
    const tier = TIERS[index];
    const group = el('div', { role: 'group', 'aria-label': tier.name, class: 'tier-card' });
    group.dataset.index = String(index);
    const locked = me ? me.level < tier.minLevel : false;
    const short = me ? Math.max(0, tier.entry - me.coins) : tier.entry;
    const affordable = me ? me.coins >= tier.entry : false;
    group.append(el('div', { class: 'tier-name', text: tier.name }));
    group.append(el('div', { class: 'tier-meta', text: `Entry ${fmt(tier.entry)}` }));
    group.append(el('div', { class: 'tier-meta', text: `Pot ${fmt(tier.pot)}` }));
    if (locked) {
      group.append(el('div', { class: 'tier-lock', text: copy.lockedTier(tier.minLevel) }));
    } else if (!affordable) {
      group.append(el('div', { class: 'tier-lock', text: copy.shortBy(short) }));
      const links = el('div', { class: 'row-between' });
      if (me && me.coins < 100 && me.refillsLeft > 0) {
        links.append(el('a', { href: '/home', text: 'Refill' }));
      }
      if (index > 0) {
        const lower = highestAffordableBelow(index);
        if (lower !== null) {
          links.append(el('a', { href: '#', text: 'Lower tier', onclick: (event) => {
            event.preventDefault();
            select(lower);
          } }));
        }
      }
      group.append(links);
    } else {
      const join = el('button', { text: 'Join table', class: 'primary', onclick: () => joinQueue(tier) });
      group.append(join);
      joinButtons.push({ index, join });
    }
    return group;
  }

  function highestAffordableBelow(index) {
    for (let i = index - 1; i >= 0; i--) {
      const tier = TIERS[i];
      if (!me) return 0;
      if (me.level >= tier.minLevel && me.coins >= tier.entry) return i;
    }
    return null;
  }

  function select(index) {
    selected = Math.max(0, Math.min(TIERS.length - 1, index));
    cards.forEach((card, i) => {
      card.classList.toggle('selected', i === selected);
      if (i === selected) {
        const btn = card.querySelector('button');
        btn?.setAttribute('data-selected-join', 'true');
      } else {
        card.querySelector('button')?.removeAttribute('data-selected-join');
      }
    });
    selectedTier.textContent = TIERS[selected].name;
    const target = cards[selected];
    const regionEl = region;
    const offset = target.offsetLeft - regionEl.clientWidth / 2 + target.clientWidth / 2;
    if (reducedMotion()) {
      track.style.transition = 'none';
      track.style.transform = `translateX(${-offset}px)`;
    } else {
      track.style.transition = 'transform 0.33s ease';
      track.style.transform = `translateX(${-offset}px)`;
    }
  }

  for (let i = 0; i < TIERS.length; i++) {
    const card = cardFor(i);
    cards.push(card);
    track.append(card);
  }
  region.append(track);
  container.append(queueStatus, selectedTier, region);

  const cancelBtn = el('button', { id: 'queue-cancel', text: 'Cancel', hidden: true, onclick: async () => {
    try {
      await api('/api/queue', { method: 'DELETE' });
      queueStatus.textContent = copy.leftQueue;
      cancelBtn.hidden = true;
      region.focus();
    } catch (err) {
      queueStatus.textContent = err.message;
    }
  } });
  container.append(cancelBtn);

  region.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); select(selected - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); select(selected + 1); }
    else if (event.key === 'Enter') {
      const tier = TIERS[selected];
      const affordable = me ? me.level >= tier.minLevel && me.coins >= tier.entry : false;
      if (affordable) void joinQueue(tier);
    }
  });

  region.addEventListener('pointerdown', (event) => {
    region.dataset.swipeStart = String(event.clientX);
  });
  region.addEventListener('pointerup', (event) => {
    const start = Number(region.dataset.swipeStart ?? '0');
    const delta = event.clientX - start;
    const quarter = region.clientWidth / 4;
    if (Math.abs(delta) > quarter) {
      select(selected + (delta < 0 ? 1 : -1));
    }
  });

  async function joinQueue(tier) {
    cancelBtn.hidden = false;
    try {
      await api('/api/queue', { method: 'POST', body: { mode: modeParam, tier: tier.id } });
      queueStatus.textContent = copy.queueSearching(3);
      cancelBtn.focus();
      pollQueue();
    } catch (err) {
      queueStatus.textContent = err.code === 'insufficient_coins' ? copy.refusedCoins : err.message;
      cancelBtn.hidden = true;
    }
  }

  async function pollQueue() {
    try {
      const status = await api('/api/queue');
      if (status.status === 'paired' && status.tableUrl) {
        navigate(status.tableUrl);
        return;
      }
      if (status.status === 'queued') {
        queueStatus.textContent = copy.queueSearching(status.band ?? 3);
        setTimeout(pollQueue, 900);
      }
    } catch {
      setTimeout(pollQueue, 1500);
    }
  }

  // Live pairing: the SSE stream tells us when the table is ready.
  await openLive(['me']);
  onLive((event) => {
    if (event.type === 'me') {
      void (async () => {
        const status = await api('/api/queue').catch(() => null);
        if (status && status.status === 'paired' && status.tableUrl) navigate(status.tableUrl);
      })();
    }
  });

  select(0);
  region.focus();
}

function qsMode() {
  const mode = new URLSearchParams(location.search).get('mode');
  if (mode === 'nine-ball' || mode === 'no-guidelines') return mode;
  return 'eight-ball';
}

function main() {
  return document.getElementById('app');
}

// ---------- Live table screen ----------

export async function tableScreen(tableId) {
  let body = null;
  let loadError = null;
  try {
    body = await api(`/api/tables/${tableId}`);
  } catch (err) {
    loadError = err;
  }

  const title = el('h1', { text: 'Table' });
  main().replaceChildren(title);

  if (loadError) {
    if (loadError.code === 'other_device') {
      main().replaceChildren(el('h1', { text: copy.secondDevice }));
      return;
    }
    if (loadError.code === 'not_seated') {
      main().replaceChildren(el('h1', { text: copy.tableNotYours }));
      return;
    }
    main().replaceChildren(el('h1', { text: copy.tableUnknown }));
    return;
  }

  const vertical = window.innerWidth < 700;
  const wrap = el('div', { class: `table-screen ${vertical ? 'vertical' : ''} ${state.settings.leftHanded ? 'left-handed' : ''}` });

  const meSeat = body.seats.findIndex((seat) => state.me && seat.playerId === state.me.id);
  const mySeatNumber = meSeat >= 0 ? meSeat + 1 : null;

  const names = body.seats.map((seat) => seat.displayName);
  const scoreboard = buildScoreboard({ leftName: names[0] ?? '', rightName: names[1] ?? '', pot: body.pot > 0 ? body.pot : null });
  scoreboard.turn.id = 'turn-status';

  const canvas = el('canvas', { id: 'table-canvas', role: 'img', 'aria-label': 'Table', width: 700, height: vertical ? 1050 : 467 });
  canvas.tabIndex = -1;

  const table = new PoolTable({
    mode: body.mode,
    noGuidelines: body.mode === 'no-guidelines',
    vertical,
    balls: body.balls.map((n) => ({ number: n, across: 50, along: 20 })),
    cueBall: { across: 50, along: 88 },
  });

  const log = el('div', { class: 'log', role: 'log', 'aria-label': 'Table announcements', 'aria-live': 'polite' });
  const receipt = el('section', { role: 'region', 'aria-label': 'Shot receipt', id: 'shot-receipt', class: 'mode-note', text: '' });
  const loupeText = el('p', { class: 'status', role: 'status', 'aria-label': 'Contact loupe', id: 'contact-loupe', text: 'Legal Cut 0.0°' });
  const tangent = el('div', {},
    el('label', { for: 'tangent-draw', text: 'Tangent draw' }),
    el('progress', { id: 'tangent-draw', role: 'progressbar', 'aria-label': 'Tangent draw', max: '100', value: '0' }));
  const backLink = el('a', { href: '/home', 'aria-label': 'Back to lobby', text: 'Back to lobby' });

  let resultDialog = null;

  const controls = buildControls({
    onAim: () => drawAll(),
    onStrike: (values) => strike(values),
    onPlace: async (across, along, confirm = true) => {
      if (!confirm) {
        table.cueBall = { across, along };
        drawAll();
        return;
      }
      try {
        body = await api(`/api/tables/${tableId}/place`, { method: 'POST', body: { across, along } });
        render();
      } catch (err) {
        if (err.fields?.along) toastish(err.fields.along);
        else toastish(err.message);
      }
    },
    onCalledPocket: () => controls.setStrikeDisabled(false),
  });

  wrap.append(scoreboard.wrap, el('div', { class: 'table-canvas-wrap' }, canvas, el('div', { class: 'loupe-text' }, loupeText)), controls.panel);
  main().replaceChildren(bannerIfOutageTable(), wrap, tangent, log, receipt, backLink);

  function toastish(message) {
    const line = el('p', { class: 'status', role: 'status', text: message });
    scoreboard.banner.textContent = message;
    log.append(el('p', { text: message }));
  }

  function drawAll() {
    table.aim = controls.values().aimDegrees;
    table.draw(canvas);
    if (body?.mode !== 'no-guidelines') {
      const reading = table.loupeReading();
      loupeText.textContent = `${reading.label} ${reading.numeral}${reading.firstBall !== null ? ` First ball ${reading.firstBall}` : ''}`;
    }
  }

  async function strike(values) {
    if (values.power <= 0) {
      log.append(el('p', { text: copy.noPower }));
      controls.resetPower();
      return;
    }
    if (body.calledPocketRequired && !controls.calledPocket()) {
      scoreboard.banner.textContent = copy.callPocket;
      log.append(el('p', { text: copy.callPocket }));
      return;
    }
    try {
      const result = await api(`/api/tables/${tableId}/shots`, {
        method: 'POST',
        body: { ...values, calledPocket: controls.calledPocket() },
      });
      body = result;
      const reading = table.loupeReading();
      receipt.textContent = reading.firstBall !== null
        ? `First ball ${reading.firstBall}. Cut ${reading.cut.toFixed(1)}°.`
        : 'No first ball.';
      if (reading.firstBall !== null) {
        log.append(el('p', { text: `First ball ${reading.firstBall}. Cut ${reading.cut.toFixed(1)}°.` }));
      } else {
        log.append(el('p', { text: 'No first ball.' }));
      }
      controls.resetPower();
      render();
    } catch (err) {
      if (err.code === 'shot_clock_expired') {
        toastish(copy.lateShot);
      } else if (err.code === 'called_pocket_required') {
        toastish(copy.callPocket);
      } else {
        toastish(err.message);
      }
    }
  }

  function render() {
    if (!body) return;
    const seatTexts = body.seats.map((seat) => `${seat.displayName} ${seat.group ? seat.group[0].toUpperCase() + seat.group.slice(1) : 'Open'} ${seat.ballsLeft} ${seat.ballsLeft === 1 ? 'ball left' : 'balls left'}`);
    scoreboard.leftRow.replaceChildren(el('span', { class: 'name', text: body.seats[0]?.displayName ?? '' }), el('span', { class: 'meta', text: groupText(body, 0) }));
    scoreboard.rightRow.replaceChildren(el('span', { class: 'name', text: body.seats[1]?.displayName ?? '' }), el('span', { class: 'meta', text: groupText(body, 1) }));
    scoreboard.potLine.textContent = body.pot > 0 ? `Pot ${fmt(body.pot)}` : (body.pot === -1 ? 'Pot Tournament' : '');
    scoreboard.banner.textContent = body.ruleBanner ?? '';

    const myTurn = body.status === 'in_play' && body.activeSeat === mySeatNumber && body.seatedHere;
    const iHoldBall = body.ballInHand && body.activeSeat === mySeatNumber && body.seatedHere;
    if (body.status !== 'in_play') {
      scoreboard.turn.textContent = copy.gameOver;
    } else if (iHoldBall) {
      scoreboard.turn.textContent = copy.turnBallInHand;
    } else if (body.activeSeat === mySeatNumber) {
      scoreboard.turn.textContent = copy.turnYours;
    } else {
      scoreboard.turn.textContent = copy.turnOther(body.seats[body.activeSeat - 1]?.displayName ?? '');
    }
    controls.setDisabled(!myTurn || body.status !== 'in_play');
    controls.showPockets(Boolean(body.calledPocketRequired && myTurn));
    controls.setStrikeDisabled(Boolean(body.calledPocketRequired && myTurn && !controls.calledPocket()));
    controls.showPlacement(Boolean(iHoldBall), 50, 25);

    table.balls = body.balls.map((n) => ({ number: n, across: 50, along: 20 }));
    drawAll();

    if (body.status !== 'in_play' && body.result && !resultDialog) {
      showResult(body.result);
    }
  }

  function groupText(body, index) {
    const seat = body.seats[index];
    if (!seat) return '';
    const group = seat.group ? seat.group[0].toUpperCase() + seat.group.slice(1) : 'Open';
    return `${group} ${seat.ballsLeft} ${seat.ballsLeft === 1 ? 'ball left' : 'balls left'}`;
  }

  function showResult(result) {
    const dialog = el('dialog', { 'aria-label': 'Match result', id: 'match-result' });
    const rematchBtn = el('button', { class: 'primary', text: 'Rematch' });
    const lines = el('div', { class: 'result-rows' },
      el('div', { class: 'line', text: result.line }),
      el('div', { role: 'status', 'aria-label': 'Coin change', text: result.coinChange }),
      el('div', { role: 'status', 'aria-label': 'XP gained', text: copy.xpGained(result.xpGained) })
    );
    for (const level of result.levelUps ?? []) {
      lines.append(el('div', { text: copy.levelReached(level, 5) }));
    }
    const backBtn = el('button', { text: 'Back to lobby', onclick: () => { closeDialog(dialog); dialog.remove(); navigate('/home'); } });
    rematchBtn.addEventListener('click', async () => {
      rematchBtn.disabled = true;
      try {
        const res = await api(`/api/tables/${tableId}/rematch`, { method: 'POST' });
        if (res.tableUrl) {
          closeDialog(dialog);
          dialog.remove();
          navigate(res.tableUrl);
        } else {
          const opponent = body.seats.find((s) => s.playerId !== state.me?.id);
          rematchBtn.textContent = copy.waitingRematch(opponent?.displayName ?? 'your opponent');
        }
      } catch (err) {
        rematchBtn.disabled = true;
        rematchBtn.textContent = copy.rematchShort;
      }
    });
    if (body.pot > 0 && state.me && state.me.coins < TIERS[body.tier - 1].entry) {
      rematchBtn.disabled = true;
      rematchBtn.textContent = copy.rematchShort;
      lines.append(el('div', { class: 'mode-note', text: copy.rematchShort }));
    }
    dialog.append(lines, el('div', { class: 'dialog-actions' }, rematchBtn, backBtn));
    document.body.append(dialog);
    openDialog(dialog, backLink);
    resultDialog = dialog;
  }

  // Clock ticks from the server.
  let clockTimer = null;
  async function tickClock() {
    try {
      const fresh = await api(`/api/tables/${tableId}/heartbeat`);
      if (fresh.status === 'in_play') {
        scoreboard.clock.textContent = `${fresh.shotClockSeconds}s`;
        if (fresh.reconnectSeconds !== null) {
          scoreboard.reconnect.hidden = false;
          scoreboard.reconnect.textContent = `${fresh.reconnectSeconds}s`;
        } else {
          scoreboard.reconnect.hidden = true;
        }
        if (body && fresh.status !== body.status) {
          body = fresh;
          render();
        } else if (body) {
          body.shotClockSeconds = fresh.shotClockSeconds;
          body.reconnectSeconds = fresh.reconnectSeconds;
          body.ballInHand = fresh.ballInHand;
          body.ruleBanner = fresh.ruleBanner;
          scoreboard.banner.textContent = fresh.ruleBanner ?? '';
          if (fresh.ballInHand !== body.ballInHand) render();
        }
      } else {
        scoreboard.clock.textContent = '';
      }
    } catch {
      scoreboard.clock.textContent = '';
    }
  }
  clockTimer = setInterval(tickClock, 1000);
  tickClock();

  await openLive([`table:${tableId}`, 'me']);
  onLive((event) => {
    if (event.type === 'table' || event.type === 'tick') {
      void (async () => {
        try {
          const fresh = await api(`/api/tables/${tableId}`);
          const changed = fresh.status !== body?.status || fresh.activeSeat !== body?.activeSeat || fresh.balls.length !== body?.balls.length;
          body = fresh;
          render();
          if (changed) {
            for (const seat of fresh.seats) {
              log.append(el('p', { text: `${seat.displayName} ${groupText(fresh, seat.seat - 1)}` }));
            }
          }
        } catch { /* the next tick retries */ }
      })();
    }
  });

  render();

  return () => {
    clearInterval(clockTimer);
  };
}

function bannerIfOutageTable() {
  return state.storeDown ? el('div', { class: 'notice-bar' }, el('span', { text: copy.storeDown }), el('button', { text: 'Retry', onclick: async () => { await loadMe().catch(() => undefined); await route?.(); } })) : el('span', { hidden: true });
}
