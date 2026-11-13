/** Home page effects: particle wordmark, scroll-scrubbed tiffin, deals rail, parallax, kinetic type. */

import { el, esc } from "./ui.ts";

const reduced = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = (): boolean => window.matchMedia("(pointer: fine)").matches;

/** Procedural vector tiffin stack, arch-clipped and tilted. */
export function tiffinSvg(openAmount: number): string {
  const tiers = 3;
  const parts: string[] = [];
  const openness = openAmount; // 0 closed, 1 fully open
  for (let i = 0; i < tiers; i++) {
    const baseY = 150 - i * 44;
    const lift = openness * (i + 1) * 16;
    const y = baseY - lift;
    const shade = i === tiers - 1 ? "#ffd23f" : i === 1 ? "#e8ecff" : "#c3ccff";
    parts.push(`<g>
      <path d="M40 ${y} a55 30 0 0 1 160 0 v14 h-160 z" fill="${shade}" stroke="#0b0b3a" stroke-width="5"/>
      <circle cx="120" cy="${y - 4}" r="7" fill="#ff4f9a" stroke="#0b0b3a" stroke-width="4"/>
    </g>`);
  }
  parts.push(`<rect x="52" y="196" width="136" height="16" rx="8" fill="#ff4f9a" stroke="#0b0b3a" stroke-width="5"/>`);
  return `<svg viewBox="0 0 240 230" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="steel tiffin stack">${parts.join("")}</svg>`;
}

/** Tiers open and close in step with scroll over the first 900px, reversing exactly. */
export function scrubTiffin(host: HTMLElement): void {
  host.innerHTML = tiffinSvg(0);
  if (reduced()) return;
  let ticking = false;
  const update = () => {
    const scroll = Math.min(900, Math.max(0, window.scrollY));
    host.innerHTML = tiffinSvg(scroll / 900);
    ticking = false;
  };
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
}

/** Particle wordmark: letters drawn from particles that scatter near the pointer. */
export function particleWordmark(canvas: HTMLCanvasElement, word: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (reduced()) {
    const span = el("span", { class: "wordmark", text: word });
    canvas.replaceWith(span);
    return;
  }
  const off = document.createElement("canvas");
  const offCtx = off.getContext("2d");
  if (!offCtx) return;
  off.width = 420;
  off.height = 120;
  offCtx.font = "900 96px 'Darker Grotesque', 'Arial Black', sans-serif";
  offCtx.fillStyle = "#fff";
  offCtx.textBaseline = "top";
  offCtx.fillText(word, 6, 8);
  const data = offCtx.getImageData(0, 0, off.width, off.height).data;
  const target: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < off.height; y += 3) {
    for (let x = 0; x < off.width; x += 3) {
      const alpha = data[(y * off.width + x) * 4 + 3];
      if (alpha > 128) target.push({ x, y });
    }
  }
  interface P { x: number; y: number; vx: number; vy: number; home: { x: number; y: number } }
  const scale = Math.min(1.15, (canvas.parentElement?.clientWidth ?? 380) / off.width);
  canvas.width = off.width * scale;
  canvas.height = off.height * scale;
  const particles: P[] = target.map((t) => ({
    x: t.x + (Math.random() - 0.5) * 260,
    y: t.y + (Math.random() - 0.5) * 260,
    vx: 0, vy: 0, home: t,
  }));
  let pointer = { x: -9999, y: -9999 };
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  });
  canvas.addEventListener("pointerleave", () => { pointer = { x: -9999, y: -9999 }; });
  let raf = 0;
  let running = true;
  const step = () => {
    if (!running) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 120) {
        const push = (120 - dist) / 120;
        p.vx += (dx / (dist || 1)) * push * 3.4;
        p.vy += (dy / (dist || 1)) * push * 3.4;
      }
      p.vx += (p.home.x - p.x) * 0.02;
      p.vy += (p.home.y - p.y) * 0.02;
      p.vx *= 0.9;
      p.vy *= 0.9;
      p.x += p.vx;
      p.y += p.vy;
      ctx.fillStyle = "#ffd23f";
      ctx.fillRect(p.x * scale, p.y * scale, 2.4, 2.4);
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  const stop = () => { running = false; cancelAnimationFrame(raf); };
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && !running) { running = true; raf = requestAnimationFrame(step); }
        else if (!entry.isIntersecting && running) stop();
      }
    });
    io.observe(canvas);
  }
  window.addEventListener("beforeunload", stop);
}

/** Deals rail pinned in place: vertical scroll becomes sideways travel. */
export function dealsRail(rail: HTMLElement): void {
  if (reduced()) return;
  let spacer: HTMLElement | null = null;
  const make = () => {
    if (spacer) return;
    const range = rail.scrollWidth - rail.clientWidth;
    if (range <= 0) return;
    spacer = el("div", { style: `height:${range}px` });
    rail.parentElement?.insertBefore(spacer, rail);
    rail.style.position = "sticky";
    rail.style.top = "80px";
  };
  const update = () => {
    if (!spacer) return;
    const range = rail.scrollWidth - rail.clientWidth;
    const progress = Math.min(1, spacer.offsetTop / Math.max(1, range));
    rail.scrollLeft = progress * range;
  };
  make();
  window.addEventListener("resize", () => { spacer?.remove(); spacer = null; make(); });
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(() => { update(); ticking = false; });
    }
  }, { passive: true });
}

/** Category banners split into three layers moving at 1/5, 1/2 and full scroll speed. */
export function parallaxLayers(banner: HTMLElement, layers: HTMLElement[]): void {
  if (reduced()) return;
  let ticking = false;
  const update = () => {
    const rect = banner.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.top < window.innerHeight;
    if (visible) {
      const offset = Math.max(0, rect.top);
      const speeds = [0.2, 0.5, 1];
      layers.forEach((layer, i) => {
        layer.style.transform = `translateY(${-offset * speeds[i]}px)`;
      });
    }
    ticking = false;
  };
  window.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
}

/** Kinetic type: the today-only label wraps around a slowly turning cylinder. */
export function cylinderLabel(host: HTMLElement): void {
  if (reduced()) { host.textContent = "today only"; return; }
  host.textContent = "today only today only ";
  host.style.whiteSpace = "nowrap";
  let offset = 0;
  const speed = 1.1;
  let raf = 0;
  const step = () => {
    offset += speed;
    host.style.transform = `translateX(${-offset % 220}px)`;
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  const stop = () => cancelAnimationFrame(raf);
  window.addEventListener("beforeunload", stop);
}

/** Category headings scatter into letters on hover and regroup. */
export function scatterHeading(heading: HTMLElement): void {
  if (reduced()) return;
  const text = heading.textContent ?? "";
  const letters = [...text].map((ch) => el("span", { class: "letter", text: ch }));
  heading.textContent = "";
  heading.append(...letters);
  heading.addEventListener("pointerenter", () => {
    letters.forEach((l) => {
      const dx = (Math.random() - 0.5) * 26;
      const dy = (Math.random() - 0.5) * 20;
      l.style.transition = "transform 0.3s ease-out";
      l.style.display = "inline-block";
      l.style.transform = `translate(${dx}px, ${dy}px) rotate(${(Math.random() - 0.5) * 18}deg)`;
    });
  });
  heading.addEventListener("pointerleave", () => {
    letters.forEach((l) => { l.style.transform = "translate(0,0) rotate(0deg)"; });
  });
}

/** Magnetic cursor grows over cards, reads drag over the viewer, and trails fade. */
export function magneticCursor(): void {
  if (!finePointer() || reduced()) return;
  const dot = el("div", { class: "cursor-dot", "aria-hidden": "true" });
  dot.style.cssText = "position:fixed;width:22px;height:22px;border-radius:50%;background:#ffd23f;pointer-events:none;z-index:99;transform:translate(-50%,-50%);transition:width 0.18s,height 0.18s,background 0.18s;mix-blend-mode:difference;";
  document.body.append(dot);
  const trail: Array<{ el: HTMLElement; at: number }> = [];
  let raf = 0;
  let last = 0;
  document.addEventListener("pointermove", (e) => {
    dot.style.left = `${e.clientX}px`;
    dot.style.top = `${e.clientY}px`;
    const now = performance.now();
    if (now - last > 40) {
      last = now;
      const ghost = el("div", { "aria-hidden": "true" });
      ghost.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;width:10px;height:10px;border-radius:50%;background:#ff4f9a;pointer-events:none;z-index:98;transform:translate(-50%,-50%);transition:opacity 0.4s;opacity:0.8`;
      document.body.append(ghost);
      trail.push({ el: ghost, at: now });
      window.setTimeout(() => {
        ghost.style.opacity = "0";
        window.setTimeout(() => ghost.remove(), 420);
      }, 120);
      if (trail.length > 14) {
        const old = trail.shift();
        old?.el.remove();
      }
    }
    const overCard = (e.target as HTMLElement)?.closest?.(".product-card, .deal-card");
    const overViewer = (e.target as HTMLElement)?.closest?.(".viewer-3d");
    const overField = (e.target as HTMLElement)?.closest?.("input, textarea, select");
    if (overField) {
      dot.style.width = "0px"; dot.style.height = "0px";
    } else if (overViewer) {
      dot.style.width = "46px"; dot.style.height = "46px";
      dot.style.background = "transparent";
      dot.style.border = "3px solid #ffd23f";
      dot.textContent = "";
    } else if (overCard) {
      dot.style.width = "40px"; dot.style.height = "40px";
      dot.style.background = "#12c48b";
      dot.style.border = "none";
    } else {
      dot.style.width = "22px"; dot.style.height = "22px";
      dot.style.background = "#ffd23f";
      dot.style.border = "none";
    }
    void raf;
  });
  // buttons pull toward the cursor by at most 8px within 60px
  const pullTargets = () => Array.from(document.querySelectorAll<HTMLElement>(".btn-primary"));
  document.addEventListener("pointermove", (e) => {
    for (const btn of pullTargets()) {
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < 60) {
        const pull = (1 - dist / 60) * 8;
        btn.style.transform = `translate(${(dx / dist) * pull}px, ${(dy / dist) * pull}px)`;
      } else {
        btn.style.transform = "";
      }
    }
  });
  document.addEventListener("keydown", () => {
    dot.style.display = "none";
    document.body.classList.add("keyboard-mode");
  });
  document.addEventListener("pointerdown", () => {
    dot.style.display = "";
  });
}

/** Image ripple: liquid ripple centred on the pointer, with a 3% scale fallback. */
export function imageRipple(img: HTMLElement): void {
  if (reduced()) return;
  img.style.transition = "transform 0.5s ease";
  if (!finePointer()) {
    img.addEventListener("pointerenter", () => { img.style.transform = "scale(1.03)"; });
    img.addEventListener("pointerleave", () => { img.style.transform = "scale(1)"; });
    return;
  }
  let settleTimer = 0;
  img.addEventListener("pointermove", (e) => {
    const r = img.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    img.style.setProperty("--ripple-x", `${x}px`);
    img.style.setProperty("--ripple-y", `${y}px`);
    img.style.backgroundImage = `radial-gradient(circle at ${x}px ${y}px, rgba(255,210,63,0.35) 0px, rgba(255,79,154,0.22) 3px, rgba(195,204,255,0.16) 6px, transparent 40px), ${"var(--card-art)"}`;
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => { img.style.backgroundImage = "var(--card-art)"; }, 550);
    void r;
  });
  img.addEventListener("pointerleave", () => {
    img.style.backgroundImage = "var(--card-art)";
  });
}

export function noiseField(canvas: HTMLCanvasElement, seed: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = 900;
  canvas.height = 500;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let t = 0;
  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i < 26; i++) {
      const x = (Math.sin(t * 0.4 + i * 1.7 + seed) * 0.5 + 0.5) * canvas.width;
      const y = (Math.cos(t * 0.3 + i * 2.3 + seed * 2) * 0.5 + 0.5) * canvas.height;
      const r = 40 + Math.sin(t + i) * 26;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    t += 0.02;
  };
  draw();
  if (!reducedMotion) {
    const interval = window.setInterval(draw, 50);
    window.addEventListener("beforeunload", () => window.clearInterval(interval));
  }
  void esc;
}
