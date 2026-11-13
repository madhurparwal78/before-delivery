// Long Rail Headstring — routes and screens.

import { el, api, navigate, qs, fmt, copy, TIERS, POCKET_LABELS, PRESET_MESSAGES, AI_NAMES } from './ui.js';
import {
  state, loadMe, ensureMe, setChips, openLive, closeLive, onLive, reducedMotion,
  applyTheme, applyMotionPreference, markStoreDown, clearStoreDown, offlineMode, stashChips,
} from './app-state.js';
import { signUpDialog, openDialog, closeDialog } from './dialogs.js';
import { PoolTable, buildControls, buildScoreboard } from './pool.js';

const main = () => document.getElementById('app');

const TUTORIAL_KEY = 'headstring-tutorial-done';
const PRACTICE_KEY = 'headstring-practice-rack';

function scrollTarget() {
  window.scrollTo({ top: 0 });
}

function bannerOutage() {
  const bar = el('div', { class: 'notice-bar', role: 'region', 'aria-label': 'Connection' },
    el('span', { role: 'status', 'aria-label': 'Connection', text: copy.storeDown }),
    el('button', { id: 'retry-store', text: 'Retry', onclick: async (event) => {
      event.target.disabled = true;
      try {
        await loadMe();
        clearStoreDown();
        setChips();
        event.target.closest('.notice-bar')?.remove();
        await route();
      } catch {
        event.target.disabled = false;
      }
    } })
  );
  return bar;
}

// ---------- Tutorial (first shot) ----------

function tutorialBalls(step) {
  const number = step === 2 ? 9 : 1;
  return [
    { number: 0, across: 50, along: 25 },
    { number, across: 50, along: 88 },
  ];
}

async function tutorialScreen() {
  const step = Number(sessionStorage.getItem('headstring-tutorial-step') ?? 1) || 1;
  const vertical = window.innerWidth < 700;

  const balls = tutorialBalls(step);
  const table = new PoolTable({ balls, cueBall: balls[0], vertical });
  const scoreboard = buildScoreboard({ leftName: 'You', rightName: null, pot: null });

  const stepStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Tutorial step', id: 'tutorial-step', text: `Step ${Math.min(step, 3)} of 3` });
  const log = el('div', { class: 'log', role: 'log', 'aria-label': 'Table announcements', 'aria-live': 'polite' });
  const receipt = el('section', { role: 'region', 'aria-label': 'Shot receipt', id: 'shot-receipt', class: 'mode-note', text: '' });
  const loupeText = el('p', { class: 'status', role: 'status', 'aria-label': 'Contact loupe', id: 'contact-loupe', text: 'Legal Cut 0.0°' });
  const tangent = el('div', {}, el('label', { for: 'tangent-draw', text: 'Tangent draw' }),
    el('progress', { id: 'tangent-draw', role: 'progressbar', 'aria-label': 'Tangent draw', max: '100', value: '0' }));

  const canvas = el('canvas', { id: 'table-canvas', role: 'img', 'aria-label': 'Table', width: 700, height: vertical ? 1050 : 467 });
  canvas.tabIndex = -1;

  const controls = buildControls({
    onAim: () => { drawLoupe(); },
    onStrike: (values) => takeTutorialShot(values),
  });

  const wrap = el('div', { class: `table-screen ${vertical ? 'vertical' : ''}` });
  const canvasWrap = el('div', { class: 'table-canvas-wrap' }, canvas,
    el('div', { class: 'loupe-text', id: 'loupe-text' }, loupeText));
  wrap.append(scoreboard.wrap, canvasWrap, controls.panel);

  const title = el('h1', { text: 'Long Rail Headstring' });
  const blurb = el('p', { class: 'mode-note', text: 'Aim with the sliders or by touching the table, hold Space to set power, then Strike.' });
  main().replaceChildren(bannerIfOutage(), title, blurb, stepStatus, wrap, tangent, log, receipt);

  function drawLoupe() {
    const values = controls.values();
    table.aim = values.aimDegrees;
    table.power = values.power;
    table.draw(canvas);
    const reading = table.loupeReading();
    loupeText.textContent = `${reading.label} ${reading.numeral}${reading.firstBall !== null ? ` First ball ${reading.firstBall}` : ''}`;
    receipt.textContent = '';
  }

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const size = { width: canvas.width, height: canvas.height };
    const target = table.fromPx({ x: ((event.clientX - rect.left) / rect.width) * size.width, y: ((event.clientY - rect.top) / rect.height) * size.height }, size);
    const angle = (Math.atan2(target.across - table.cueBall.across, target.along - table.cueBall.along) * 180) / Math.PI;
    const norm = ((angle % 360) + 360) % 360;
    table.aim = norm;
    controls.setAim(norm);
    table.loupeOpen = true;
    drawLoupe();
  });

  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect();
    const size = { width: canvas.width, height: canvas.height };
    const target = table.fromPx({ x: ((event.clientX - rect.left) / rect.width) * size.width, y: ((event.clientY - rect.top) / rect.height) * size.height }, size);
    const angle = (Math.atan2(target.across - table.cueBall.across, target.along - table.cueBall.along) * 180) / Math.PI;
    table.aim = ((angle % 360) + 360) % 360;
    controls.setAim(table.aim);
    table.loupeOpen = true;
    drawLoupe();
  });

  // Keyboard shortcuts for the table screen.
  const keydown = (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === 'text') return;
    if (event.target instanceof HTMLInputElement && event.target.type === 'password') return;
    if (event.target instanceof HTMLInputElement && event.target.type === 'email') return;
    if (event.target instanceof HTMLInputElement && event.target.name === 'called-pocket') return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const stepSize = event.shiftKey ? 0.1 : 1;
      const dir = event.key === 'ArrowRight' ? 1 : -1;
      const focused = document.activeElement;
      if (focused instanceof HTMLInputElement && ['range'].includes(focused.type) && focused.id !== 'aim-angle') {
        return; // native slider change handles Up/Down; arrows pass to slider natively
      }
      event.preventDefault();
      const next = ((table.aim + dir * stepSize) % 360 + 360) % 360;
      table.aim = next;
      controls.setAim(next);
      table.loupeOpen = true;
      drawLoupe();
    } else if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      cycleSpin();
    } else if (event.key === 'l' || event.key === 'L') {
      event.preventDefault();
      toggleLock();
    } else if (event.code === 'Space' && !event.repeat) {
      event.preventDefault();
      startHold();
    }
  };
  window.addEventListener('keydown', keydown);

  const keyup = (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      releaseHold();
    }
  };
  window.addEventListener('keyup', keyup);

  let holdTimer = null;
  let holdStart = 0;
  function startHold() {
    if (controls.strikeBtn.disabled) {
      postLog(copy.callPocket);
      return;
    }
    holdStart = Date.now();
    controls.setPower(0);
    holdTimer = setInterval(() => {
      const held = Date.now() - holdStart;
      const value = Math.min(100, Math.floor(((held - 500) / 1000) * 50));
      controls.setPower(Math.max(0, value));
    }, 100);
  }
  function releaseHold() {
    if (!holdTimer) return;
    clearInterval(holdTimer);
    holdTimer = null;
    const power = Number(controls.power.value);
    if (power <= 0) {
      controls.resetPower();
      postLog(copy.noPower);
      return;
    }
    takeTutorialShot({ ...controls.values(), power });
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && holdTimer) {
      clearInterval(holdTimer);
      holdTimer = null;
      controls.resetPower();
      postLog(copy.shotCancelled);
    }
  });

  function cycleSpin() {
    const order = [
      { side: 0, top: 0, text: 'Spin: none' },
      { side: 0, top: 50, text: 'Spin: top' },
      { side: 0, top: -50, text: 'Spin: back' },
      { side: 50, top: 0, text: 'Spin: left' },
      { side: -50, top: 0, text: 'Spin: right' },
    ];
    const current = order.findIndex((entry) => entry.side === Number(controls.side.value) && entry.top === Number(controls.top.value));
    const next = order[(current + 1) % order.length];
    controls.side.value = String(next.side);
    controls.top.value = String(next.top);
    controls.setSpinText(next.text);
  }

  let tangentTimer = null;
  function toggleLock() {
    table.locked = !table.locked;
    controls.lock(table.locked);
    const progress = document.getElementById('tangent-draw');
    if (reducedMotion()) {
      table.tangentDraw = table.locked ? 100 : 0;
      progress.value = String(table.tangentDraw);
    } else if (table.locked) {
      const start = Date.now();
      if (tangentTimer) clearInterval(tangentTimer);
      tangentTimer = setInterval(() => {
        const share = Math.min(100, ((Date.now() - start) / 330) * 100);
        table.tangentDraw = share;
        progress.value = String(Math.round(share));
        if (share >= 100) clearInterval(tangentTimer);
      }, 30);
    } else {
      const from = table.tangentDraw;
      const start = Date.now();
      const duration = (from / 100) * 330;
      if (tangentTimer) clearInterval(tangentTimer);
      tangentTimer = setInterval(() => {
        const share = Math.max(0, from - ((Date.now() - start) / duration) * from);
        table.tangentDraw = share;
        progress.value = String(Math.round(share));
        if (share <= 0) clearInterval(tangentTimer);
      }, 30);
    }
    drawLoupe();
  }

  function postLog(text) {
    if (!text) return;
    const line = el('p', { text });
    log.append(line);
  }

  function takeTutorialShot(values) {
    if (values.power <= 0) {
      postLog(copy.noPower);
      controls.resetPower();
      return;
    }
    const reading = table.loupeReading();
    receipt.textContent = reading.firstBall !== null
      ? `First ball ${reading.firstBall}. Cut ${reading.cut.toFixed(1)}°.`
      : 'No first ball.';
    postLog(reading.firstBall !== null ? `First ball ${reading.firstBall}. Cut ${reading.cut.toFixed(1)}°.` : 'No first ball.');
    const nextStep = Math.min(step + 1, 3);
    sessionStorage.setItem('headstring-tutorial-step', String(nextStep));
    stepStatus.textContent = `Step ${nextStep} of 3`;
    controls.resetPower();
    if (step + 1 > 3) {
      localStorage.setItem(TUTORIAL_KEY, '1');
      sessionStorage.removeItem('headstring-tutorial-step');
      openSavePrompt();
    } else {
      table.balls = tutorialBalls(nextStep);
      drawLoupe();
    }
  }

  function openSavePrompt() {
    const dialog = el('dialog', { 'aria-label': 'Save your progress', id: 'save-progress' });
    dialog.append(
      el('h2', { text: 'Save your progress' }),
      el('p', { class: 'mode-note', text: 'Create an account to keep your Coins and record.' }),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'primary', text: 'Create account', onclick: async () => {
          closeDialog(dialog);
          dialog.remove();
          await signUpDialog({});
        } }),
        el('button', { text: 'Skip for now', onclick: () => { closeDialog(dialog); dialog.remove(); navigate('/home'); } })
      )
    );
    document.body.append(dialog);
    openDialog(dialog, document.activeElement);
  }

  drawLoupe();
  window.addEventListener('resize', () => drawLoupe());

  return () => {
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keyup', keyup);
  };
}

function bannerIfOutage() {
  return state.storeDown ? bannerOutage() : el('span', { hidden: true });
}

// ---------- Home ----------

async function homeScreen() {
  let me = null;
  let down = false;
  try {
    me = await loadMe();
  } catch (err) {
    down = err.status === 503;
  }

  const title = el('h1', { text: 'Home' });
  const container = el('div', {});
  main().replaceChildren(title, container);

  if (down) {
    const chips = el('div', { class: 'chips' });
    const coins = state.lastCoins ?? null;
    const cash = state.lastCash ?? null;
    chips.append(
      el('span', { class: 'chip', role: 'status', 'aria-label': 'Coins', html: `<span class="num">${coins === null ? '' : fmt(coins)}</span> <span class="stale">${copy.stale}</span>` }),
      el('span', { class: 'chip', role: 'status', 'aria-label': 'Cash', html: `<span class="num">${cash === null ? '' : fmt(cash)}</span> <span class="stale">${copy.stale}</span>` })
    );
    const notice = el('p', { class: 'mode-note', role: 'status', 'aria-label': 'Connection', text: copy.storeDown });
    container.append(bannerOutage(), notice, chips);
    return;
  }

  if (!me) {
    // Guest lobby: same cards, Guest as the name, no chips or equipped cue.
    const guest = el('div', { class: 'identity' },
      el('span', { class: 'avatar', 'aria-hidden': 'true', text: 'G' }),
      el('h2', { text: 'Guest' })
    );
    const modes = buildModeCards(true);
    const secondary = buildSecondaryRow(true);
    container.append(guest, el('p', { class: 'mode-note', text: 'Create an account to play for Coins.' }), modes, secondary);
    return;
  }

  const identity = el('div', { class: 'identity' },
    el('a', { class: 'avatar', href: '/profile', 'aria-label': 'Profile', text: me.displayName.slice(0, 1).toUpperCase() }),
    el('div', {},
      el('a', { href: '/profile', 'aria-label': 'Profile', text: me.displayName }),
      el('p', { class: 'status', role: 'status', 'aria-label': 'Equipped cue', text: equippedName(me.equippedCueId) })
    )
  );

  const xpText = el('span', { class: 'num', text: `${fmt(me.xp)} / ${fmt(me.xpToNext)} XP` });
  const levelText = el('span', { text: `Level ${me.level}` });
  const xpBar = el('div', { class: 'progress-track', role: 'progressbar', 'aria-label': 'XP', 'aria-valuemin': '0', 'aria-valuemax': String(me.xpToNext), 'aria-valuenow': String(me.xp) },
    el('div', { class: 'progress-fill', style: { width: `${Math.min(100, (me.xp / me.xpToNext) * 100)}%` } }));
  const xpRow = el('div', { class: 'row-between' }, xpText, levelText, xpBar);

  const notice = el('p', { class: 'status', role: 'status', 'aria-label': 'Home notice', id: 'home-notice', text: '' });
  const mailNotice = el('p', { class: 'status', role: 'status', 'aria-label': 'Mail notice', id: 'mail-notice', text: me.mailDelayed ? copy.mailDelayed : '' });
  const connection = el('p', { class: 'status', role: 'status', 'aria-label': 'Connection', id: 'connection-status', text: '' });

  const dailyBtn = el('button', { id: 'daily-reward', text: 'Claim daily reward', disabled: me.dailyRewardClaimed, onclick: async () => {
    dailyBtn.disabled = true;
    try {
      await api('/api/wallet/daily-reward', { method: 'POST' });
      notice.textContent = copy.dailyClaimed;
      await loadMe();
    } catch (err) {
      notice.textContent = err.status === 409 ? copy.dailyAlready : err.message;
      dailyBtn.disabled = me.dailyRewardClaimed;
    }
  } });

  let refillRow = el('span', {});
  if (me.coins < 100) {
    const left = me.refillsLeft;
    const refillBtn = el('button', { id: 'refill', text: 'Refill', onclick: async () => {
      refillBtn.disabled = true;
      try {
        const res = await api('/api/wallet/refill', { method: 'POST' });
        notice.textContent = copy.refillAdded;
        await loadMe();
        refillRow.replaceChildren(el('span', { text: `${res.refillsLeft} left today` }));
      } catch (err) {
        notice.textContent = err.status === 409 && err.code === 'refill_limit' ? copy.refillNone
          : err.status === 409 && err.code === 'refill_not_needed' ? copy.refillNotNeeded
          : err.message;
        refillBtn.disabled = false;
      }
    } });
    refillRow = el('span', {}, refillBtn, el('span', { text: `${left} left today` }));
  }

  const modes = buildModeCards(false);
  const secondary = buildSecondaryRow(false);

  container.append(
    identity,
    xpRow,
    notice,
    connection,
    mailNotice,
    dailyBtn,
    refillRow,
    modes,
    secondary
  );

  if (me.activeTableUrl) {
    container.append(el('p', {}, el('a', { href: me.activeTableUrl, text: 'Back to table' })));
  }

  // Live updates for chips and queue transitions.
  await openLive(['me']);
  onLive((event) => {
    if (event.type === 'me') {
      void (async () => {
        try { await loadMe(); } catch { /* offline shows stale chips */ }
        const fresh = state.me;
        if (fresh) {
          identity.querySelector('a[aria-label="Profile"]').textContent = fresh.displayName;
        }
      })();
    }
  });

  if (qs('friends') === '1') {
    window.dispatchEvent(new CustomEvent('open-friends'));
  }
}

function equippedName(id) {
  const names = {
    'cue-starter': 'Starter Cue',
    'cue-ash-break': 'Ash Break',
    'cue-copper-ferrule': 'Copper Ferrule',
    'cue-night-maple': 'Night Maple',
    'cue-velvet-taper': 'Velvet Taper',
    'cue-long-rail-master': 'Long Rail Master',
    'cue-brass-inlay': 'Brass Inlay',
    'cue-lamp-black': 'Lamp Black',
  };
  return names[id] ?? 'Starter Cue';
}

function onlineCardDisabled() {
  return offlineMode();
}

function buildModeCards(guest) {
  const cards = [
    { label: 'Play 1-on-1', action: () => (guest ? signUpThen('play') : navigate('/play')), online: true },
    { label: 'Play Special', action: () => (guest ? signUpThen('special') : navigate('/play/special')), online: true },
    { label: 'Play with Friends', action: () => (guest ? signUpThen('friends') : window.dispatchEvent(new CustomEvent('open-friends'))), online: true },
    { label: 'Practice Offline', action: () => navigate('/practice'), online: false },
    { label: 'Shop', action: () => (guest ? signUpThen('shop') : navigate('/shop')), online: true },
    { label: 'Settings', action: () => navigate('/settings'), online: false },
  ];
  const region = el('section', { role: 'region', 'aria-label': 'Modes', id: 'modes', class: 'mode-section' });
  region.setAttribute('aria-label', 'Modes');
  region.tabIndex = -1;
  const grid = el('div', { class: 'card-grid' });
  const noNetwork = onlineCardDisabled();
  for (const card of cards) {
    const offlineTag = card.online && noNetwork ? el('span', { class: 'offline-tag', text: copy.offline }) : null;
    const btn = el('button', { class: 'mode-card', text: card.label, onclick: () => card.action(), disabled: card.online && noNetwork }, offlineTag);
    if (card.label === 'Play 1-on-1' && !guest && state.me && state.me.wins === 0 && state.me.losses === 0) {
      btn.append(el('span', { class: 'tag', text: copy.firstMatch }));
    }
    grid.append(btn);
  }
  region.append(grid);
  return region;
}

function buildSecondaryRow(guest) {
  const row = el('div', { class: 'secondary-row' });
  const items = [
    { label: 'Tournaments', action: () => (guest ? signUpThen('tournaments') : navigate('/tournaments')) },
    { label: 'Clubs', action: () => (guest ? signUpThen('clubs') : navigate('/clubs')) },
    { label: 'Leaderboards', action: () => (guest ? signUpThen('leaderboards') : navigate('/leaderboards')) },
  ];
  for (const item of items) {
    row.append(el('button', { text: item.label, onclick: item.action }));
  }
  return row;
}

async function signUpThen(kind) {
  await signUpDialog({ onDone: () => {
    if (kind === 'play') navigate('/play');
    else if (kind === 'special') navigate('/play/special');
    else if (kind === 'friends') navigate('/home?friends=1');
    else if (kind === 'shop') navigate('/shop');
    else if (kind === 'tournaments') navigate('/tournaments');
    else if (kind === 'clubs') navigate('/clubs');
    else if (kind === 'leaderboards') navigate('/leaderboards');
    else navigate('/home');
  } });
}

export { homeScreen, tutorialScreen };
