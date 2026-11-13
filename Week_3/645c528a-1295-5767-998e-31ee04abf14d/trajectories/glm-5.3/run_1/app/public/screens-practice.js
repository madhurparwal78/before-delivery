// Practice screens: setup with resume prompt and the offline rack against the AI.

import { el, navigate, copy, AI_NAMES } from './ui.js';
import { state, reducedMotion } from './app-state.js';
import { PoolTable, buildControls, buildScoreboard } from './pool.js';

const PRACTICE_KEY = 'headstring-practice-rack';

export function practiceSetupScreen() {
  const title = el('h1', { text: 'Practice' });
  const container = el('div', {});
  main().replaceChildren(title, container);

  container.append(el('p', { class: 'mode-note', text: 'Practice runs entirely in your browser and earns nothing.' }));

  const difficulty = el('div', { role: 'radiogroup', 'aria-label': 'Difficulty' });
  const options = [['rookie', 'Rookie'], ['regular', 'Regular'], ['shark', 'Shark'], ['free', 'Free table']];
  const inputs = [];
  for (const [value, label] of options) {
    const input = el('input', { type: 'radio', name: 'difficulty', value, id: `diff-${value}` });
    const lab = el('label', { for: `diff-${value}`, text: label });
    input.addEventListener('change', () => { startBtn.disabled = false; });
    difficulty.append(el('div', {}, lab, input));
    inputs.push(input);
  }

  const startBtn = el('button', { class: 'primary', id: 'start-rack', text: 'Start rack', onclick: () => {
    const selected = inputs.find((input) => input.checked)?.value ?? 'rookie';
    navigate(`/practice/table?difficulty=${selected}`);
  } });

  const saved = readSavedRack();
  if (saved) {
    const region = el('section', { role: 'region', 'aria-label': 'Unfinished rack', class: 'panel' });
    region.append(
      el('h2', { text: 'Unfinished rack' }),
      el('p', { text: copy.practiceResume }),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'primary', text: 'Resume rack', onclick: () => navigate(`/practice/table?difficulty=${saved.difficulty}&resume=1`) }),
        el('button', { text: 'New rack', onclick: () => { localStorage.removeItem(PRACTICE_KEY); navigate(`/practice/table?difficulty=${saved.difficulty}`); } })
      )
    );
    container.append(region);
  }

  container.append(difficulty, startBtn);
}

function readSavedRack() {
  try {
    const raw = localStorage.getItem(PRACTICE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.difficulty) return null;
    return parsed;
  } catch {
    return null;
  }
}

function main() {
  return document.getElementById('app');
}

const PRACTICE_BALLS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 8];

export function practiceTableScreen() {
  const params = new URLSearchParams(location.search);
  const difficulty = params.get('difficulty') ?? 'rookie';
  const resume = params.get('resume') === '1';
  const freeTable = difficulty === 'free';
  const opponentName = freeTable ? null : AI_NAMES[difficulty] ?? 'Rookie';

  const saved = resume ? readSavedRack() : null;
  const balls = saved?.balls ?? PRACTICE_BALLS.map((n, i) => ({ number: n, across: 44 + (i % 5) * 3, along: 12 + Math.floor(i / 5) * 5 }));

  const vertical = window.innerWidth < 700;
  const table = new PoolTable({ balls, cueBall: { across: 50, along: 88 }, vertical });
  const scoreboard = buildScoreboard({
    leftName: 'You',
    rightName: opponentName ?? '',
    pot: null,
  });

  const log = el('div', { class: 'log', role: 'log', 'aria-label': 'Table announcements', 'aria-live': 'polite' });
  const stepStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Turn', text: copy.turnYours });

  let myTurn = true;
  let aiShots = 0;

  const controls = buildControls({
    onAim: () => drawAll(),
    onStrike: (values) => strike(values),
  });

  const canvas = el('canvas', { id: 'table-canvas', role: 'img', 'aria-label': 'Table', width: 700, height: vertical ? 1050 : 467 });
  canvas.tabIndex = -1;

  const wrap = el('div', { class: `table-screen ${vertical ? 'vertical' : ''}` });
  wrap.append(scoreboard.wrap, el('div', { class: 'table-canvas-wrap' }, canvas), controls.panel);
  main().replaceChildren(el('h1', { text: 'Practice table' }), wrap, stepStatus, log);

  function drawAll() {
    table.aim = controls.values().aimDegrees;
    table.draw(canvas);
  }

  function saveRack() {
    localStorage.setItem(PRACTICE_KEY, JSON.stringify({ difficulty, balls: table.balls }));
  }

  function strike(values) {
    if (values.power <= 0) {
      log.append(el('p', { text: copy.noPower }));
      controls.resetPower();
      return;
    }
    const reading = table.loupeReading();
    if (reading.firstBall !== null) {
      log.append(el('p', { text: `First ball ${reading.firstBall}. Cut ${reading.cut.toFixed(1)}°.` }));
      const index = table.balls.findIndex((b) => b.number === reading.firstBall);
      if (index >= 0) table.balls.splice(index, 1);
    } else {
      log.append(el('p', { text: 'No first ball.' }));
    }
    controls.resetPower();
    myTurn = false;
    if (freeTable) {
      myTurn = true;
      stepStatus.textContent = copy.turnYours;
      saveRack();
      return;
    }
    saveRack();
    aiTurn();
  }

  function aiTurn() {
    stepStatus.textContent = copy.turnOther(opponentName ?? '');
    controls.setDisabled(true);
    log.append(el('p', { text: copy.aiThinking(opponentName ?? 'Rookie') }));
    const thinking = reducedMotion() ? 10 : 1200;
    setTimeout(() => {
      log.append(el('p', { text: copy.aiTurnDone(opponentName ?? 'Rookie') }));
      aiShots += 1;
      if (aiShots <= 3 && table.balls.some((b) => b.number !== 0)) {
        if (Math.random() < 0.55 && table.balls.length > 1) {
          const index = 1 + Math.floor(Math.random() * (table.balls.length - 1));
          const ball = table.balls[index];
          if (ball) {
            log.append(el('p', { text: copy.potted(ball.number, 'top-left') }));
            table.balls.splice(index, 1);
          }
        } else {
          log.append(el('p', { text: copy.legalNothing }));
        }
      }
      myTurn = true;
      aiShots = 0;
      stepStatus.textContent = copy.turnYours;
      controls.setDisabled(false);
      saveRack();
      drawAll();
    }, thinking);
  }

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const size = { width: canvas.width, height: canvas.height };
    const target = table.fromPx({ x: ((event.clientX - rect.left) / rect.width) * size.width, y: ((event.clientY - rect.top) / rect.height) * size.height }, size);
    const angle = (Math.atan2(target.across - table.cueBall.across, target.along - table.cueBall.along) * 180) / Math.PI;
    const norm = ((angle % 360) + 360) % 360;
    table.aim = norm;
    controls.setAim(norm);
    drawAll();
  });

  const keydown = (event) => {
    if (event.target instanceof HTMLInputElement && ['text', 'email', 'password'].includes(event.target.type)) return;
    if (event.target instanceof HTMLInputElement && event.target.name === 'called-pocket') return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const stepSize = event.shiftKey ? 0.1 : 1;
      const dir = event.key === 'ArrowRight' ? 1 : -1;
      const next = ((table.aim + dir * stepSize) % 360 + 360) % 360;
      table.aim = next;
      controls.setAim(next);
      drawAll();
      event.preventDefault();
    } else if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
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
    } else if (event.key === 'l' || event.key === 'L') {
      event.preventDefault();
      const locked = controls.lockBtn.getAttribute('aria-pressed') !== 'true';
      controls.lock(locked);
    }
  };
  window.addEventListener('keydown', keydown);

  drawAll();
}
