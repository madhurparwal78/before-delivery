/** The same six scenes as flat drawings, for browsers that cannot draw WebGL. */

const NIGHT = '#0b0914';
const EMBER = '#ff8a3d';
const MOONLIGHT = '#f5eee6';

const seeded = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
};

export class FlatStage {
  private readonly context: CanvasRenderingContext2D | null;
  private width = 1;
  private height = 1;
  private lit = 4096;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d');
  }

  get usable(): boolean {
    return this.context !== null;
  }

  resize(): void {
    const ratio = Math.min(window.devicePixelRatio, 2);
    this.width = this.canvas.clientWidth || window.innerWidth;
    this.height = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  setLitWindows(count: number): void {
    this.lit = count;
  }

  render(name: string, progress: number): void {
    const context = this.context;
    if (!context) return;
    const { width: w, height: h } = this;
    context.clearRect(0, 0, w, h);
    context.fillStyle = NIGHT;
    context.fillRect(0, 0, w, h);
    const sky = (top: string, bottom: string, until: number): void => {
      const gradient = context.createLinearGradient(0, 0, 0, until);
      gradient.addColorStop(0, top);
      gradient.addColorStop(1, bottom);
      context.fillStyle = gradient;
      context.fillRect(0, 0, w, until);
    };

    if (name === 'hero') {
      const horizon = h * 0.62;
      sky('#1a1230', progress > 0.5 ? '#3b2a4e' : '#6b4a6e', horizon);
      const sunY = h * (0.4 + 0.22 * progress);
      const halo = context.createRadialGradient(w / 2, sunY, 0, w / 2, sunY, h * 0.3);
      halo.addColorStop(0, 'rgba(255,214,170,0.85)');
      halo.addColorStop(1, 'rgba(255,138,61,0)');
      context.fillStyle = halo;
      context.fillRect(0, 0, w, horizon);
      context.beginPath();
      context.fillStyle = '#ffe2be';
      context.arc(w / 2, sunY, h * 0.075, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#120d20';
      context.fillRect(0, horizon, w, h - horizon);
      context.strokeStyle = EMBER;
      context.lineWidth = 1;
      for (let band = 0; band < 12; band += 1) {
        const at = horizon + ((band + 1) / 13) * (h - horizon);
        context.globalAlpha = (1 - band / 12) * (0.5 - progress * 0.2);
        context.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const y = at + Math.sin(x * 0.012 + band * 0.6) * h * 0.02 * (1 - band / 14);
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
      context.globalAlpha = 1;
      return;
    }

    if (name === 'city') {
      sky('#0b0914', '#2b1f45', h);
      const next = seeded(9731);
      const columns = 26;
      const share = this.lit / 4096;
      for (let column = 0; column < columns; column += 1) {
        const towerWidth = w / columns;
        const towerHeight = h * (0.2 + 0.45 * next());
        const x = column * towerWidth;
        const y = h * 0.86 - towerHeight;
        context.fillStyle = '#0e0a1a';
        context.fillRect(x, y, towerWidth * 0.88, towerHeight);
        const nearness = (column % 4) / 4;
        for (let row = 0; row < Math.floor(towerHeight / (h * 0.04)); row += 1) {
          for (let pane = 0; pane < 3; pane += 1) {
            const on = next();
            if (on < share * (0.55 + 0.45 * nearness)) {
              context.fillStyle = EMBER;
              context.fillRect(x + towerWidth * (0.14 + pane * 0.26), y + row * h * 0.04 + 4, towerWidth * 0.14, h * 0.018);
            }
          }
        }
      }
      context.fillStyle = NIGHT;
      context.fillRect(0, h * 0.86, w, h * 0.14);
      return;
    }

    if (name === 'water') {
      const horizon = h * 0.45;
      sky('#120d26', '#2c2050', horizon);
      context.beginPath();
      context.fillStyle = MOONLIGHT;
      context.arc(w * 0.68, horizon * 0.45, h * 0.06, 0, Math.PI * 2);
      context.fill();
      const deep = context.createLinearGradient(0, horizon, 0, h);
      deep.addColorStop(0, '#13102a');
      deep.addColorStop(1, '#070610');
      context.fillStyle = deep;
      context.fillRect(0, horizon, w, h - horizon);
      context.strokeStyle = 'rgba(190,200,230,0.5)';
      const choppiness = (1 - progress) * 10 + 0.6;
      for (let row = 0; row < 26; row += 1) {
        const y = horizon + ((row + 1) / 27) * (h - horizon);
        context.globalAlpha = Math.max(0, 0.5 - row / 40);
        context.beginPath();
        for (let x = w * 0.58; x <= w * 0.78; x += 6) {
          const wobble = Math.sin(x * 0.07 + row) * choppiness;
          if (x === w * 0.58) context.moveTo(x + wobble, y);
          else context.lineTo(x + wobble, y);
        }
        context.stroke();
      }
      context.globalAlpha = 1;
      const boatX = w * (0.25 + 0.25 * progress);
      const boatY = horizon + (h - horizon) * 0.45;
      context.fillStyle = '#e8e0ee';
      context.beginPath();
      context.moveTo(boatX - h * 0.03, boatY);
      context.lineTo(boatX + h * 0.03, boatY);
      context.lineTo(boatX, boatY + h * 0.016);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(boatX, boatY - h * 0.05);
      context.lineTo(boatX + h * 0.026, boatY - 2);
      context.lineTo(boatX, boatY - 2);
      context.closePath();
      context.fill();
      return;
    }

    if (name === 'flowers') {
      sky('#0d0a1c', '#362850', h);
      const next = seeded(13331);
      for (let index = 0; index < 34; index += 1) {
        const x = next() * w;
        const y = h * (0.45 + next() * 0.5);
        const size = h * (0.02 + next() * 0.03);
        const closed = Math.max(0, Math.min(1, (progress - (index / 34) * 0.55) / 0.45));
        context.strokeStyle = 'rgba(42,58,48,0.9)';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, y + size * 2);
        context.stroke();
        context.fillStyle = `rgba(233,226,242,${0.92 - closed * 0.2})`;
        for (let petal = 0; petal < 6; petal += 1) {
          const turn = (petal / 6) * Math.PI * 2;
          const reach = size * (1 - closed * 0.72);
          context.beginPath();
          context.ellipse(x + Math.cos(turn) * reach * 0.6, y + Math.sin(turn) * reach * 0.3, reach * 0.5, reach * 0.26, turn, 0, Math.PI * 2);
          context.fill();
        }
        context.fillStyle = '#ffd9a8';
        context.beginPath();
        context.arc(x, y, size * 0.22, 0, Math.PI * 2);
        context.fill();
      }
      return;
    }

    if (name === 'moon') {
      sky('#0a0814', '#241a3c', h);
      const radius = Math.min(w, h) * 0.2;
      context.save();
      context.beginPath();
      context.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
      context.clip();
      context.fillStyle = '#2a2140';
      context.fillRect(0, 0, w, h);
      const lit = Math.sin(Math.PI * progress);
      context.fillStyle = '#e8e2d6';
      context.beginPath();
      context.arc(w / 2 + radius * 2 * (1 - lit), h / 2, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
      return;
    }

    if (name === 'lantern') {
      sky('#080610', '#160f28', h);
      const life = 1 - progress;
      const cx = w / 2;
      const cy = h * 0.5;
      const halo = context.createRadialGradient(cx, cy, 0, cx, cy, h * 0.28 * (0.2 + life));
      halo.addColorStop(0, `rgba(255,170,110,${0.8 * life})`);
      halo.addColorStop(1, 'rgba(255,138,61,0)');
      context.fillStyle = halo;
      context.fillRect(0, 0, w, h);
      context.fillStyle = `rgb(${Math.round(72 + 183 * life)},${Math.round(56 + 120 * life)},${Math.round(88 + 24 * life)})`;
      context.beginPath();
      context.ellipse(cx, cy, h * 0.07, h * 0.1, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#6b5894';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(cx, 0);
      context.lineTo(cx, cy - h * 0.1);
      context.stroke();
      if (life > 0.02) {
        context.fillStyle = '#fff0d2';
        context.beginPath();
        context.arc(cx, cy, h * 0.016 * life, 0, Math.PI * 2);
        context.fill();
      }
      return;
    }
  }
}
