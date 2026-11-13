// The drawn pool table: canvas rendering, aiming, the Contact Loupe, and shot controls.

import { el, copy, POCKET_LABELS, fmt } from './ui.js';
import { state, reducedMotion } from './app-state.js';

const CUSHION = 4;
const BALL_R = 2.85;
const POCKETS = {
  'top-left': { x: 0, y: 100 },
  'top-right': { x: 100, y: 100 },
  'middle-left': { x: 0, y: 50 },
  'middle-right': { x: 100, y: 50 },
  'bottom-left': { x: 0, y: 0 },
  'bottom-right': { x: 100, y: 0 },
};

const BALL_COLORS = {
  1: '#f5d580', 2: '#3b6ea5', 3: '#c0392b', 4: '#6d4a9c', 5: '#c77b30',
  6: '#2e7d5b', 7: '#8a3324', 8: '#181818', 9: '#f5d580', 10: '#3b6ea5',
  11: '#c0392b', 12: '#6d4a9c', 13: '#c77b30', 14: '#2e7d5b', 15: '#8a3324', 0: '#f6f2e7',
};

export class PoolTable {
  constructor({ mode = 'eight-ball', balls = [], cueBall = { across: 50, along: 88 }, vertical = false, noGuidelines = false }) {
    this.mode = mode;
    this.vertical = vertical;
    this.noGuidelines = noGuidelines;
    this.balls = balls.map((b) => ({ ...b }));
    this.cueBall = { ...cueBall };
    this.aim = 0;
    this.fine = 0;
    this.power = 50;
    this.sideSpin = 0;
    this.topSpin = 0;
    this.locked = false;
    this.loupeOpen = false;
    this.loupeScale = reducedMotion() ? 1 : 0.6;
    this.tangentDraw = 0;
    this.listeners = {};
  }

  on(name, fn) { (this.listeners[name] ??= []).push(fn); }
  emit(name, detail) { for (const fn of this.listeners[name] ?? []) fn(detail); }

  aimAngle() { return ((this.aim + this.fine) % 360 + 360) % 360; }

  canvasSize(width) {
    const ratio = this.vertical ? 2 / 3 : 3 / 2;
    return { width, height: Math.round(width * ratio) };
  }

  toPx(point, size) {
    const pad = 8;
    const w = size.width - pad * 2;
    const h = size.height - pad * 2;
    const x = pad + (point.across / 100) * w;
    const y = this.vertical ? pad + (1 - point.along / 100) * h : pad + (point.along / 100) * h;
    if (this.vertical) return { x: pad + (point.across / 100) * w, y: pad + (1 - point.along / 100) * h };
    return { x, y };
  }

  fromPx(px, size) {
    const pad = 8;
    const w = size.width - pad * 2;
    const h = size.height - pad * 2;
    const across = ((px.x - pad) / w) * 100;
    const along = this.vertical ? (1 - (px.y - pad) / h) * 100 : ((px.y - pad) / h) * 100;
    return { across: Math.max(0, Math.min(100, across)), along: Math.max(0, Math.min(100, along)) };
  }

  firstHit() {
    const angle = (this.aimAngle() * Math.PI) / 180;
    const dirX = Math.sin(angle);
    const dirY = Math.cos(angle);
    const cue = this.cueBall;
    let best = null;
    for (const ball of this.balls) {
      if (ball.number === 0) continue;
      const rel = { across: ball.across - cue.across, along: ball.along - cue.along };
      const proj = rel.across * dirX + rel.along * dirY;
      if (proj <= 0) continue;
      const perp = Math.abs(rel.across * dirY - rel.along * dirX);
      if (perp > 2 * BALL_R) continue;
      const t = proj - Math.sqrt(Math.max(0, 4 * BALL_R * BALL_R - perp * perp));
      if (t < 0) continue;
      if (!best || t < best.t) best = { t, ball };
    }
    if (!best) return null;
    const contact = { across: cue.across + dirX * best.t, along: cue.along + dirY * best.t };
    const centres = { across: best.ball.across - contact.across, along: best.ball.along - contact.along };
    const len = Math.hypot(centres.across, centres.along) || 1;
    const dot = (dirX * centres.across + dirY * centres.along) / len;
    const cut = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
    return { ball: best.ball, contact, cut };
  }

  loupeReading() {
    const hit = this.firstHit();
    if (!hit) return { label: 'Blocked', numeral: 'Cut --', firstBall: null, cut: 0, contact: null };
    let label = 'Legal';
    if (this.mode === 'nine-ball') {
      const lowest = Math.min(...this.balls.filter((b) => b.number !== 0).map((b) => b.number));
      if (hit.ball.number !== lowest) label = 'Wrong group';
    } else if (this.mode === 'eight-ball') {
      label = 'Legal';
    }
    return {
      label,
      numeral: `Cut ${hit.cut.toFixed(1)}°`,
      firstBall: hit.ball.number,
      cut: hit.cut,
      contact: hit.contact,
    };
  }

  draw(canvas) {
    const ctx = canvas.getContext('2d');
    const size = { width: canvas.width, height: canvas.height };
    ctx.clearRect(0, 0, size.width, size.height);

    // Lamp pool of light on the cloth.
    const lamp = ctx.createRadialGradient(size.width / 2, size.height / 2, 20, size.width / 2, size.height / 2, size.width * 0.7);
    lamp.addColorStop(0, 'rgba(30, 92, 140, 0.95)');
    lamp.addColorStop(1, 'rgba(10, 30, 48, 0.95)');

    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, size.width, size.height);

    // Wooden rail.
    ctx.strokeStyle = '#5a4326';
    ctx.lineWidth = 10;
    ctx.strokeRect(6, 6, size.width - 12, size.height - 12);

    ctx.fillStyle = lamp;
    ctx.fillRect(11, 11, size.width - 22, size.height - 22);

    // Pockets.
    ctx.fillStyle = '#05070a';
    for (const pos of Object.values(POCKETS)) {
      const p = this.toPx({ across: pos.x, along: pos.y }, size);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cushion line.
    ctx.strokeStyle = 'rgba(217, 164, 65, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(12, 12, size.width - 24, size.height - 24);

    // Head string on practice/tutorial tables.
    if (this.mode !== 'nine-ball') {
      const headA = this.toPx({ across: 0, along: 25 }, size);
      const headB = this.toPx({ across: 100, along: 25 }, size);
      ctx.strokeStyle = 'rgba(243, 234, 216, 0.18)';
      ctx.beginPath();
      ctx.moveTo(headA.x, headA.y);
      ctx.lineTo(headB.x, headB.y);
      ctx.stroke();
    }

    // Aim guideline (not in No Guidelines).
    if (!this.noGuidelines) {
      const hit = this.firstHit();
      const cuePx = this.toPx(this.cueBall, size);
      ctx.strokeStyle = this.locked ? 'rgba(217, 164, 65, 0.9)' : 'rgba(243, 234, 216, 0.4)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cuePx.x, cuePx.y);
      if (hit) {
        const c = this.toPx(hit.contact, size);
        ctx.lineTo(c.x, c.y);
        // Ghost ball outline.
        ctx.save();
        ctx.strokeStyle = 'rgba(243, 234, 216, 0.7)';
        ctx.beginPath();
        ctx.arc(c.x, c.y, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else {
        const angle = (this.aimAngle() * Math.PI) / 180;
        const reach = Math.max(size.width, size.height);
        ctx.lineTo(cuePx.x + Math.sin(angle) * reach, cuePx.y + (this.vertical ? -Math.cos(angle) : Math.cos(angle)) * reach);
      }
      ctx.stroke();

      // Tangent line while locked.
      if (this.locked && hit) {
        const c = this.toPx(hit.contact, size);
        const centres = { across: hit.ball.across - hit.contact.across, along: hit.ball.along - hit.contact.along };
        const len = Math.hypot(centres.across, centres.along) || 1;
        const tangent = { across: -centres.along / len, along: centres.across / len };
        const end = this.toPx({ across: hit.contact.across + tangent.across * 30 * (this.tangentDraw / 100), along: hit.contact.along + tangent.along * 30 * (this.tangentDraw / 100) }, size);
        ctx.strokeStyle = 'rgba(217, 107, 58, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
    }

    // Balls.
    for (const ball of this.balls) {
      if (ball.number === 0) continue;
      const p = this.toPx(ball, size);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6.4, 0, Math.PI * 2);
      ctx.fillStyle = BALL_COLORS[ball.number] ?? '#f5d580';
      ctx.fill();
      if (ball.number > 8) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#101318';
      ctx.font = '7px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(ball.number), p.x, p.y + 0.5);
    }

    // Cue ball.
    const cuePx = this.toPx(this.cueBall, size);
    ctx.beginPath();
    ctx.arc(cuePx.x, cuePx.y, 6.4, 0, Math.PI * 2);
    ctx.fillStyle = '#f6f2e7';
    ctx.fill();

    // Contact loupe overlay.
    if (this.loupeOpen && !this.noGuidelines) {
      const reading = this.loupeReading();
      const cx = size.width / 2;
      const cy = size.height / 2;
      const r = Math.min(size.width, size.height) * 0.18 * this.loupeScale;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(8, 12, 18, 0.9)';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      if (reading.contact) {
        const c = this.toPx(reading.contact, size);
        ctx.strokeStyle = 'rgba(217, 164, 65, 0.9)';
        ctx.beginPath();
        ctx.arc(c.x, c.y, 14, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(217, 164, 65, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

export function buildControls({
  onStrike,
  onAim,
  showLock = true,
  onPlace = null,
  onCalledPocket = null,
  disabled = false,
}) {
  const panel = el('section', { class: 'controls-panel', role: 'region', 'aria-label': 'Shot controls' });
  panel.id = 'shot-controls';

  const aim = el('input', { type: 'range', min: '0.0', max: '359.9', step: '0.1', value: '0.0', id: 'aim-angle' });
  const fine = el('input', { type: 'range', min: '-1.0', max: '1.0', step: '0.1', value: '0.0', id: 'fine-aim' });
  const power = el('input', { type: 'range', min: '0', max: '100', step: '1', value: '50', id: 'shot-power' });
  const side = el('input', { type: 'range', min: '-100', max: '100', step: '1', value: '0', id: 'side-spin' });
  const top = el('input', { type: 'range', min: '-100', max: '100', step: '1', value: '0', id: 'top-spin' });

  const aimValue = el('span', { class: 'slider-value', 'aria-hidden': 'true' });
  const powerValue = el('span', { class: 'slider-value', 'aria-hidden': 'true' });
  const spinStatus = el('p', { class: 'status', role: 'status', 'aria-label': 'Spin', id: 'spin-status', text: 'Spin: none' });

  const lockBtn = el('button', { id: 'lock-aim', 'aria-pressed': 'false', text: 'Lock aim' });
  const strikeBtn = el('button', { class: 'primary', id: 'strike', text: 'Strike' });

  const sliderRow = (input, label, valueEl) => el('div', { class: 'slider-row' },
    el('label', { class: 'slider-label', for: input.id, text: label }),
    input,
    valueEl ?? el('span')
  );

  aim.setAttribute('aria-label', 'Aim angle');
  fine.setAttribute('aria-label', 'Fine aim');
  power.setAttribute('aria-label', 'Shot power');
  side.setAttribute('aria-label', 'Side spin');
  top.setAttribute('aria-label', 'Top spin');

  const pocketGroup = el('div', { role: 'radiogroup', 'aria-label': 'Called pocket', id: 'called-pocket', hidden: true });
  for (const [name, label] of POCKET_LABELS) {
    const input = el('input', { type: 'radio', name: 'called-pocket', value: name, id: `pocket-${name}` });
    const lab = el('label', { for: `pocket-${name}`, text: label });
    input.addEventListener('change', () => onCalledPocket?.(name));
    pocketGroup.append(el('div', {}, lab, input));
  }

  const placement = el('div', { role: 'group', 'aria-label': 'Ball placement', id: 'ball-placement', hidden: true });
  const across = el('input', { type: 'range', min: '0', max: '100', step: '1', value: '50', id: 'cue-across' });
  const along = el('input', { type: 'range', min: '0', max: '100', step: '1', value: '25', id: 'cue-along' });
  across.setAttribute('aria-label', 'Cue ball across');
  along.setAttribute('aria-label', 'Cue ball along');
  const placeBtn = el('button', { id: 'place-ball', text: 'Place ball' });
  placeBtn.addEventListener('click', () => onPlace?.(Number(across.value), Number(along.value)));
  across.addEventListener('input', () => onPlace?.(Number(across.value), Number(along.value), false));
  along.addEventListener('input', () => onPlace?.(Number(across.value), Number(along.value), false));
  placement.append(
    el('div', {}, el('label', { for: 'cue-across', text: 'Cue ball across' }), across),
    el('div', {}, el('label', { for: 'cue-along', text: 'Cue ball along' }), along),
    placeBtn
  );

  const actions = el('div', { class: 'controls-actions' }, showLock ? lockBtn : null, strikeBtn);

  panel.append(
    pocketGroup,
    placement,
    sliderRow(aim, 'Aim angle', aimValue),
    sliderRow(fine, 'Fine aim'),
    sliderRow(power, 'Shot power', powerValue),
    sliderRow(side, 'Side spin'),
    sliderRow(top, 'Top spin'),
    spinStatus,
    actions
  );

  const controls = {
    panel,
    aim, fine, power, side, top, lockBtn, strikeBtn, spinStatus,
    pocketGroup, placement, across, along,
    setAim(deg) { aim.value = String(deg); aimValue.textContent = `${Number(deg).toFixed(1)}°`; },
    setPower(v) { power.value = String(v); powerValue.textContent = `${v}%`; },
    resetPower() { power.value = '50'; powerValue.textContent = '50%'; },
    setSpinText(text) { spinStatus.textContent = text; },
    values() {
      return {
        aimDegrees: Number(aim.value) + Number(fine.value),
        power: Number(power.value),
        sideSpin: Number(side.value),
        topSpin: Number(top.value),
      };
    },
    setDisabled(value) {
      panel.hidden = value;
      panel.setAttribute('aria-hidden', value ? 'true' : 'false');
      for (const input of [aim, fine, power, side, top, lockBtn, strikeBtn]) {
        input.disabled = value;
        if (value) input.setAttribute('inert', '');
        else input.removeAttribute('inert');
      }
      if (value) panel.setAttribute('inert', '');
      else panel.removeAttribute('inert');
    },
    setStrikeDisabled(value) { strikeBtn.disabled = value; },
    showPockets(value) { pocketGroup.hidden = !value; },
    showPlacement(value, acrossStart = 50, alongStart = 25) {
      placement.hidden = !value;
      across.value = String(acrossStart);
      along.value = String(alongStart);
    },
    lock(value) {
      lockBtn.setAttribute('aria-pressed', value ? 'true' : 'false');
      lockBtn.textContent = value ? 'Locked' : 'Lock aim';
    },
    calledPocket() {
      const checked = pocketGroup.querySelector('input:checked');
      return checked ? checked.value : null;
    },
  };

  aim.addEventListener('input', () => {
    controls.setAim(Number(aim.value));
    onAim?.(controls.values());
  });
  fine.addEventListener('input', () => onAim?.(controls.values()));
  [power, side, top].forEach((input) => input.addEventListener('input', () => onAim?.(controls.values())));
  power.addEventListener('input', () => controls.setPower(Number(power.value)));
  lockBtn.addEventListener('click', () => {
    const next = lockBtn.getAttribute('aria-pressed') !== 'true';
    controls.lock(next);
    window.dispatchEvent(new CustomEvent('table:lock', { detail: { locked: next } }));
  });
  strikeBtn.addEventListener('click', () => onStrike(controls.values()));

  controls.setAim(0);
  controls.setPower(50);
  return controls;
}

export function buildScoreboard({ leftName, rightName, pot }) {
  const wrap = el('section', { class: 'scoreboard', role: 'region', 'aria-label': 'Scoreboard' });
  const leftRow = el('div', { class: 'score-row' }, el('span', { class: 'name', text: leftName ?? 'You' }), el('span', { class: 'meta', text: 'Open' }));
  const rightRow = el('div', { class: 'score-row' }, el('span', { class: 'name', text: rightName ?? 'Opponent' }), el('span', { class: 'meta', text: 'Open' }));
  const turn = el('p', { class: 'status', role: 'status', 'aria-label': 'Turn', id: 'turn-status', text: copy.turnYours });
  const banner = el('p', { class: 'rule-banner', role: 'status', 'aria-label': 'Rule banner', id: 'rule-banner', text: '' });
  const potLine = el('p', { class: 'pot-line', id: 'pot-line', text: pot !== null ? `Pot ${fmt(pot)}` : '' });
  const clock = el('span', { role: 'timer', 'aria-label': 'Shot clock', id: 'shot-clock', text: '' });
  const reconnect = el('span', { role: 'timer', 'aria-label': 'Reconnect', id: 'reconnect-timer', text: '', hidden: true });
  wrap.append(leftRow, rightRow, el('div', { class: 'clock-line' }, clock, reconnect), banner, turn, potLine);
  return { wrap, leftRow, rightRow, turn, banner, potLine, clock, reconnect };
}
