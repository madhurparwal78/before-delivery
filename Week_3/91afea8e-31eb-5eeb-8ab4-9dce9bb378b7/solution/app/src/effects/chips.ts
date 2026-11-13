/**
 * Falling chips: a tiny 2D physics world on a canvas. A chip drops in, falls under gravity, collides with the floor,
 * the walls and the other chips, and settles within 1.5 s. Under reduced motion the chip is placed already settled.
 */

const GRAVITY = 2400;
const RADIUS = 30;
const STEP = 1 / 120;
const REST_SPEED = 30;
const FORCE_REST_S = 1.4;
const FIELDS = ["#ffd60a", "#ff2d95", "#00e58a"];

interface Chip {
  x: number;
  y: number;
  vx: number;
  vy: number;
  field: string;
  art: HTMLImageElement | null;
  asleep: boolean;
}

export interface ChipWorld {
  drop: (art: HTMLImageElement | null) => void;
  /** Draws the current frame again, for art that finished loading after the chip settled. */
  repaint: () => void;
  destroy: () => void;
}

export function createChipWorld(canvas: HTMLCanvasElement, reduced: boolean): ChipWorld {
  const chips: Chip[] = [];
  let width = canvas.clientWidth;
  let height = canvas.clientHeight;
  let frame = 0;
  let last: number | null = null;
  let since = 0;

  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");

  const paint = (): void => {
    if (!context) return;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);
    for (const chip of chips) {
      context.beginPath();
      context.arc(chip.x, chip.y, RADIUS, 0, Math.PI * 2);
      context.fillStyle = chip.field;
      context.fill();
      if (chip.art?.complete && chip.art.naturalWidth > 0) {
        context.save();
        context.beginPath();
        context.arc(chip.x, chip.y, RADIUS - 4, 0, Math.PI * 2);
        context.clip();
        context.drawImage(chip.art, chip.x - RADIUS + 4, chip.y - RADIUS + 4, (RADIUS - 4) * 2, (RADIUS - 4) * 2);
        context.restore();
      }
    }
  };

  const simulate = (dt: number): boolean => {
    let moving = false;
    for (const chip of chips) {
      if (chip.asleep) continue;
      chip.vy += GRAVITY * dt;
      chip.x += chip.vx * dt;
      chip.y += chip.vy * dt;
      if (chip.x < RADIUS) {
        chip.x = RADIUS;
        chip.vx = Math.abs(chip.vx) * 0.4;
      } else if (chip.x > width - RADIUS) {
        chip.x = width - RADIUS;
        chip.vx = -Math.abs(chip.vx) * 0.4;
      }
      if (chip.y > height - RADIUS) {
        chip.y = height - RADIUS;
        chip.vy = -Math.abs(chip.vy) * 0.28;
        chip.vx *= 0.8;
      }
    }
    for (let a = 0; a < chips.length; a += 1) {
      for (let b = a + 1; b < chips.length; b += 1) {
        const one = chips[a] as Chip;
        const two = chips[b] as Chip;
        const dx = two.x - one.x;
        const dy = two.y - one.y;
        const gap = Math.hypot(dx, dy);
        if (gap >= RADIUS * 2) continue;
        const nx = gap === 0 ? 0 : dx / gap;
        const ny = gap === 0 ? -1 : dy / gap;
        const push = (RADIUS * 2 - gap) / 2;
        if (!one.asleep) {
          one.x -= nx * push;
          one.y -= ny * push;
        }
        if (!two.asleep) {
          two.x += nx * push;
          two.y += ny * push;
        }
        const approach = (two.vx - one.vx) * nx + (two.vy - one.vy) * ny;
        if (approach < 0) {
          const impulse = -approach * 0.65;
          one.vx -= impulse * nx;
          one.vy -= impulse * ny;
          two.vx += impulse * nx;
          two.vy += impulse * ny;
        }
        one.asleep = false;
        two.asleep = false;
      }
    }
    for (const chip of chips) {
      if (chip.asleep) continue;
      chip.vx *= 0.995;
      if (since > 1) {
        chip.vx *= 0.9;
        chip.vy *= 0.9;
      }
      const slow = Math.hypot(chip.vx, chip.vy) < REST_SPEED;
      if (since > FORCE_REST_S || (slow && (chip.y >= height - RADIUS - 1 || since > 0.9))) {
        chip.vx = 0;
        chip.vy = 0;
        chip.asleep = true;
      } else moving = true;
    }
    return moving;
  };

  const loop = (now: number): void => {
    const dt = last === null ? STEP : Math.min((now - last) / 1000, 0.05);
    last = now;
    since += dt;
    for (let spent = 0; spent < dt; spent += STEP) simulate(STEP);
    paint();
    const moving = chips.some((chip) => !chip.asleep);
    frame = moving ? requestAnimationFrame(loop) : 0;
    if (!moving) last = null;
  };

  return {
    drop(art) {
      const chip: Chip = {
        x: RADIUS + Math.random() * Math.max(1, width - RADIUS * 2),
        y: -RADIUS,
        vx: (Math.random() - 0.5) * 120,
        vy: 0,
        field: FIELDS[chips.length % FIELDS.length] as string,
        art,
        asleep: false,
      };
      chips.push(chip);
      if (reduced) {
        since = 0;
        for (let spent = 0; spent < 4 && chips.some((item) => !item.asleep); spent += STEP) {
          since += STEP;
          simulate(STEP);
        }
        for (const item of chips) item.asleep = true;
        paint();
        return;
      }
      since = 0;
      if (frame === 0) frame = requestAnimationFrame(loop);
    },
    repaint: paint,
    destroy() {
      cancelAnimationFrame(frame);
      chips.length = 0;
      width = 0;
      height = 0;
    },
  };
}
