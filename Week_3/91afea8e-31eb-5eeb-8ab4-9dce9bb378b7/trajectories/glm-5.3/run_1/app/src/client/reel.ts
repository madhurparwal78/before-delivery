/** Rupee Reel: the payable total rolls digit by digit to the server's value. */

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface DigitColumn {
  wrap: HTMLElement;
  column: HTMLElement;
  current: string;
}

export class Reel {
  private digits: DigitColumn[] = [];
  private target = "";
  private skewMs = 0;

  constructor(private readonly host: HTMLElement) {
    this.host.classList.add("reel-digits");
  }

  setSkew(ms: number): void {
    this.skewMs = ms;
  }

  /** Render the target value; under reduced motion the digits swap instantly. */
  roll(text: string): void {
    this.target = text;
    if (reducedMotion()) {
      this.host.textContent = text;
      return;
    }
    const chars = [...text];
    while (this.digits.length > chars.length) {
      const d = this.digits.pop();
      d?.wrap.remove();
    }
    chars.forEach((ch, i) => {
      if (this.digits.length <= i) {
        const wrap = document.createElement("span");
        wrap.className = "reel-digit";
        const column = document.createElement("span");
        column.className = "reel-column";
        const cell = document.createElement("span");
        cell.className = "reel-cell";
        cell.textContent = ch;
        column.append(cell);
        wrap.append(column);
        this.host.append(wrap);
        this.digits.push({ wrap, column, current: ch });
      }
      const digit = this.digits[i];
      if (digit.current !== ch) {
        this.spinTo(digit, ch, i);
      }
    });
  }

  private spinTo(digit: DigitColumn, to: string, index: number): void {
    // the whole 0-9 ladder once, so every digit passes under the window
    const ladder = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", to];
    const column = digit.column;
    column.textContent = "";
    for (const c of ladder) {
      const cell = document.createElement("span");
      cell.className = "reel-cell";
      cell.textContent = c;
      column.append(cell);
    }
    // each column starts about 40ms after its neighbour to the right
    const delay = (this.target.length - 1 - index) * 40;
    window.setTimeout(() => {
      column.style.transition = "transform 0.33s cubic-bezier(0.2, 0.7, 0.2, 1)";
      column.style.transform = `translateY(-${(ladder.length - 1) * 100}%)`;
    }, delay);
    window.setTimeout(() => {
      column.style.transition = "none";
      column.style.transform = "translateY(0)";
      column.textContent = "";
      const cell = document.createElement("span");
      cell.className = "reel-cell";
      cell.textContent = to;
      column.append(cell);
      digit.current = to;
    }, delay + 340);
  }

  destroy(): void {
    this.host.textContent = this.target;
  }
}

/** COD bar fills to the share of the cap the cash amount uses. */
export function setCodBar(bar: HTMLElement, cashPaise: number, capPaise: number, available: boolean): void {
  const fill = bar.querySelector<HTMLElement>(".fill");
  const label = bar.querySelector<HTMLElement>(".bar-label");
  if (!fill || !label) return;
  if (!available || cashPaise <= 0) {
    fill.style.width = "0%";
    label.textContent = "cash on delivery unavailable";
    return;
  }
  const share = Math.min(100, (cashPaise / capPaise) * 100);
  fill.style.width = `${share.toFixed(2)}%`;
  label.textContent = "cash on delivery limit";
}

/** Parcel strips slide along the marquee line to the new promise and fee. */
export function slideStrips(container: HTMLElement, getNewText: (strip: HTMLElement) => string): void {
  if (reducedMotion()) return;
  const strips = Array.from(container.querySelectorAll<HTMLElement>(".parcel-strip"));
  strips.forEach((strip, i) => {
    const inner = strip.querySelector<HTMLElement>(".strip-inner");
    if (!inner) return;
    const next = getNewText(strip);
    strip.style.transform = "translateY(8px)";
    window.setTimeout(() => {
      inner.textContent = next;
      strip.style.transform = "translateY(0)";
    }, 60 + i * 30);
  });
}

/** Confetti burst plays once when the placed heading first appears. */
export function orderPlacedBurst(host: HTMLElement): void {
  if (reducedMotion()) return;
  const canvas = document.createElement("canvas");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.pointerEvents = "none";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.zIndex = "90";
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const colors = ["#ffd23f", "#ff4f9a", "#12c48b", "#ffffff"];
  const pieces = Array.from({ length: 90 }, () => ({
    x: window.innerWidth / 2,
    y: window.innerHeight / 3,
    vx: (Math.random() - 0.5) * 14,
    vy: -(6 + Math.random() * 8),
    size: 6 + Math.random() * 8,
    color: colors[Math.floor(Math.random() * colors.length)],
    life: 0,
  }));
  let raf = 0;
  const step = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      p.life += 1;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.35;
      if (p.life < 80 && p.y < canvas.height + 20) {
        alive = true;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size * 0.6);
      }
    }
    if (alive) raf = requestAnimationFrame(step);
    else canvas.remove();
  };
  raf = requestAnimationFrame(step);
  void host;
  void raf;
}

/** A product chip drops into the cart drawer and stacks, settling within 1.5s. */
export function fallingChip(title: string): void {
  const drawer = document.querySelector<HTMLElement>(".cart-chip-drawer");
  if (!drawer) return;
  const chip = document.createElement("div");
  chip.className = "chip drop-chip";
  chip.textContent = title;
  chip.style.position = "absolute";
  chip.style.right = "12px";
  chip.style.top = "0";
  if (reducedMotion()) {
    chip.style.top = `${12 + drawer.children.length * 30}px`;
    drawer.append(chip);
    return;
  }
  drawer.append(chip);
  const settleY = 12 + (drawer.children.length - 1) * 30;
  let y = 0;
  let v = 0;
  let steps = 0;
  const step = () => {
    v += 1.6;
    y += v;
    if (y >= settleY) {
      y = settleY;
      v = -v * 0.35;
      if (Math.abs(v) < 1.2) {
        chip.style.top = `${settleY}px`;
        window.setTimeout(() => chip.remove(), 2500);
        return;
      }
    }
    chip.style.top = `${y}px`;
    steps += 1;
    if (steps < 140) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
