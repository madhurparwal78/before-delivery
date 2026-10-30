// Perforated paper: every card, sheet, dialog and drawer is drawn as an SVG stamp-card with a
// row of half-circle bites along all four edges (about ten per 100px) and quarter-circle corner
// bites, so whatever lies behind shows through. A faint printed grain sits on the paper.

const PITCH = 10;
const CHORD = 6;
const DEPTH = 2;
const CORNER = 8;
const NS = "http://www.w3.org/2000/svg";

let defsReady = false;

function ensureDefs(): void {
  if (defsReady) return;
  defsReady = true;
  const holder = document.createElementNS(NS, "svg");
  holder.setAttribute("aria-hidden", "true");
  holder.setAttribute("width", "0");
  holder.setAttribute("height", "0");
  holder.style.position = "absolute";
  holder.innerHTML = `<defs>
    <filter id="pm-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="7" result="noise"/>
      <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.17  0 0 0 0 0.13  0 0 0 0 0.25  0 0 0 -1.6 0.95" result="ink"/>
      <feComposite in="ink" in2="SourceGraphic" operator="in"/>
    </filter>
  </defs>`;
  document.body.prepend(holder);
}

/** The outline of a w×h stamp-card with its bites, as an SVG path. */
export function perforatedPath(w: number, h: number): string {
  const radius = (CHORD * CHORD) / 4 / (2 * DEPTH) + DEPTH / 2;
  const parts: string[] = [`M ${CORNER} 0`];
  const edge = (length: number, point: (s: number) => [number, number], sweepInward: 0 | 1): void => {
    const span = length - 2 * CORNER;
    const count = Math.max(1, Math.round(span / PITCH));
    const step = span / count;
    for (let i = 0; i < count; i++) {
      const centre = CORNER + step * (i + 0.5);
      const [ax, ay] = point(centre - CHORD / 2);
      const [bx, by] = point(centre + CHORD / 2);
      parts.push(`L ${ax.toFixed(2)} ${ay.toFixed(2)}`, `A ${radius} ${radius} 0 0 ${sweepInward} ${bx.toFixed(2)} ${by.toFixed(2)}`);
    }
  };
  edge(w, (s) => [s, 0], 0);
  parts.push(`L ${w - CORNER} 0`, `A ${CORNER} ${CORNER} 0 0 0 ${w} ${CORNER}`);
  edge(h, (s) => [w, s], 0);
  parts.push(`L ${w} ${h - CORNER}`, `A ${CORNER} ${CORNER} 0 0 0 ${w - CORNER} ${h}`);
  edge(w, (s) => [w - s, h], 0);
  parts.push(`L ${CORNER} ${h}`, `A ${CORNER} ${CORNER} 0 0 0 0 ${h - CORNER}`);
  edge(h, (s) => [0, h - s], 0);
  parts.push(`L 0 ${CORNER}`, `A ${CORNER} ${CORNER} 0 0 0 ${CORNER} 0`, "Z");
  return parts.join(" ");
}

const observer = new ResizeObserver((entries) => {
  for (const entry of entries) draw(entry.target as HTMLElement);
});

function draw(el: HTMLElement): void {
  const art = el.querySelector<SVGSVGElement>(":scope > svg.paper-art");
  if (!art) return;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!w || !h) return;
  const d = perforatedPath(w, h);
  art.setAttribute("viewBox", `0 0 ${w} ${h}`);
  art.setAttribute("width", String(w));
  art.setAttribute("height", String(h));
  for (const path of art.querySelectorAll("path")) path.setAttribute("d", d);
}

/** Gives an element its perforated paper ground. */
export function paper<T extends HTMLElement>(el: T): T {
  ensureDefs();
  el.classList.add("paper");
  const art = document.createElementNS(NS, "svg");
  art.setAttribute("class", "paper-art");
  art.setAttribute("aria-hidden", "true");
  art.innerHTML = `<path class="paper-fill"/><path class="paper-grain" filter="url(#pm-grain)"/>`;
  el.prepend(art);
  observer.observe(el);
  draw(el);
  return el;
}
