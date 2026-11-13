import { VNode } from './jsx/jsx-runtime.js';
import { api, Part } from './api.js';

export interface PeelProps {
  partName: string;
  scoreTitle: string;
  partId: string;
  reducedMotion: boolean;
  onSettled(): void;
  onStatusChip(node: HTMLElement | null): void;
}

/**
 * The Helix peel: after Extract, the part's staves lift off the turning
 * cylinder in score order, unwind and settle onto a portrait page while the
 * rest of the score recedes into soft blur. Under reduced motion the whole
 * sequence is a short crossfade.
 */
export class HelixPeel {
  private host: HTMLDivElement | null = null;
  private strips: HTMLDivElement[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private rafs: number[] = [];
  private chip: HTMLSpanElement | null = null;

  constructor(private props: PeelProps) {}

  node(): VNode {
    const holderRef: { current: HTMLDivElement | null } = { current: null };
    setTimeout(() => void this.begin(holderRef.current), 0);
    return {
      type: 'div',
      props: { class: 'helix-peel', ref: holderRef, role: 'region', 'aria-label': `${this.props.partName} part` },
      children: [],
    };
  }

  private async begin(holder: HTMLDivElement | null): Promise<void> {
    if (!holder) return;
    this.host = holder;
    const scoreId = location.pathname.split('/')[2];
    const pages = await this.loadPageSvgs(scoreId);
    if (this.props.reducedMotion) {
      // a short crossfade of about a fifth of a second
      this.crossfade(pages, scoreId);
      return;
    }
    this.animatePeel(pages, scoreId);
  }

  private async loadPageSvgs(scoreId: string): Promise<string[]> {
    try {
      const res = await api.get<{ parts: Part[] }>(`/api/scores/${scoreId}/parts`);
      const part = res.parts.find((p) => p.id === this.props.partId);
      const pageCount = part?.pageCount ?? 1;
      const svgs: string[] = [];
      for (let page = 1; page <= pageCount; page++) {
        const res2 = await fetch(`/api/scores/${scoreId}/parts/${this.props.partId}/pages/${page}.svg`, {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('fairline-seat') ?? localStorage.getItem('fairline-seat')}` },
        });
        if (res2.ok) svgs.push(await res2.text());
      }
      return svgs;
    } catch {
      return [];
    }
  }

  private crossfade(pages: string[], scoreId: string): void {
    if (!this.host) return;
    const page = this.makePageWithToolbar(pages, scoreId);
    page.style.opacity = '0';
    this.host.appendChild(page);
    requestAnimationFrame(() => {
      page.style.transition = 'opacity 0.2s ease';
      page.style.opacity = '1';
    });
    this.props.onSettled();
  }

  private animatePeel(pages: string[], scoreId: string): void {
    if (!this.host) return;
    const host = this.host;
    host.style.position = 'relative';
    // dim and blur the receding score behind
    const scoreDim = document.createElement('div');
    scoreDim.style.position = 'absolute';
    scoreDim.style.inset = '0';
    scoreDim.style.background = 'rgba(13, 16, 23, 0.55)';
    scoreDim.style.opacity = '0';
    host.appendChild(scoreDim);
    requestAnimationFrame(() => {
      scoreDim.style.transition = 'opacity 0.4s ease';
      scoreDim.style.opacity = '1';
      scoreDim.style.filter = 'blur(3px)';
    });

    // the settling portrait page with its toolbar
    const page = this.makePageWithToolbar(pages, scoreId);
    page.style.position = 'absolute';
    page.style.left = '50%';
    page.style.top = '48%';
    page.style.transform = 'translate(-50%, -42%) scale(0.88)';
    page.style.opacity = '0';
    host.appendChild(page);

    // each staff strip lifts off, 40 ms apart, in score order
    const stripCount = 4;
    for (let i = 0; i < stripCount; i++) {
      const strip = document.createElement('div');
      strip.className = 'peel-strip';
      strip.textContent = `${this.props.partName} — staff ${i + 1}`;
      strip.style.position = 'absolute';
      strip.style.left = '14%';
      strip.style.right = '14%';
      strip.style.top = `${14 + i * 9}%`;
      strip.style.height = '6%';
      strip.style.background = '#faf6ec';
      strip.style.borderRadius = '3px';
      strip.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
      strip.style.fontFamily = "'IBM Plex Sans', sans-serif";
      strip.style.fontSize = '12px';
      strip.style.color = '#1b1613';
      strip.style.display = 'flex';
      strip.style.alignItems = 'center';
      strip.style.paddingLeft = '10px';
      strip.style.opacity = '0';
      host.appendChild(strip);
      this.strips.push(strip);
      // critically damped settle: no overshoot, at rest within about 0.9 s
      const delay = i * 40;
      this.timers.push(
        setTimeout(() => {
          const start = performance.now();
          const step = (now: number) => {
            const t = Math.min(1, (now - start) / 900);
            const eased = 1 - (1 + 6 * t) * Math.exp(-6 * t);
            strip.style.opacity = '1';
            strip.style.transform = `translateY(${(1 - eased) * 90}px) scale(${0.85 + eased * 0.15})`;
            if (t < 1) this.rafs.push(requestAnimationFrame(step));
          };
          this.rafs.push(requestAnimationFrame(step));
        }, delay),
      );
    }

    // the focus pull from cylinder to page
    this.timers.push(
      setTimeout(() => {
        page.style.transition = 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.2, 0.7, 0.2, 1)';
        page.style.opacity = '1';
        page.style.transform = 'translate(-50%, -50%) scale(1)';
        this.props.onSettled();
      }, 450),
    );
  }

  /** The settled page: the part's systems with the status chip and Back to score. */
  private makePageWithToolbar(pages: string[], scoreId: string): HTMLDivElement {
    const layer = document.createElement('div');
    layer.className = 'peel-page';
    layer.style.position = 'absolute';
    layer.style.left = '50%';
    layer.style.top = '50%';
    layer.style.transform = 'translate(-50%, -50%)';
    layer.style.width = 'min(72vw, 660px)';
    layer.style.maxHeight = '86vh';
    layer.style.overflowY = 'auto';
    layer.style.background = '#faf6ec';
    layer.style.borderRadius = '4px';
    layer.style.boxShadow = '0 24px 70px rgba(0,0,0,0.6)';
    layer.style.padding = '18px';
    layer.style.color = '#1b1613';

    const title = document.createElement('p');
    title.textContent = `${this.props.scoreTitle} — ${this.props.partName}`;
    title.style.fontFamily = "'Fraunces', serif";
    title.style.fontSize = '18px';
    title.style.marginBottom = '8px';
    layer.appendChild(title);

    const chip = document.createElement('span');
    chip.className = 'status-chip peel-chip';
    chip.setAttribute('role', 'status');
    chip.style.cssText = 'display:inline-block;padding:3px 10px;border-radius:999px;border:1px solid #b8ad99;font-size:12px;margin-bottom:10px;';
    chip.textContent = `${this.props.partName} PDF status: Rendering`;
    layer.appendChild(chip);
    this.chip = chip;

    for (const svg of pages) {
      const pageDiv = document.createElement('div');
      pageDiv.innerHTML = svg;
      pageDiv.querySelector('svg')?.setAttribute('style', 'width:100%;height:auto');
      layer.appendChild(pageDiv);
    }

    const back = document.createElement('button');
    back.className = 'btn secondary';
    back.style.marginTop = '12px';
    back.textContent = 'Back to score';
    back.addEventListener('click', () => {
      this.reverse(() => undefined);
    });
    layer.appendChild(back);
    void scoreId;
    return layer;
  }

  setChipStatus(text: string): void {
    if (this.chip) this.chip.textContent = text;
  }

  /** Back to score reverses the sequence step by step. */
  reverse(onDone: () => void): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const r of this.rafs) cancelAnimationFrame(r);
    this.rafs = [];
    if (this.props.reducedMotion) {
      onDone();
      return;
    }
    const host = this.host;
    if (!host) {
      onDone();
      return;
    }
    const strips = [...this.strips].reverse();
    strips.forEach((strip, i) => {
      this.timers.push(
        setTimeout(() => {
          strip.style.transition = 'transform 0.5s ease, opacity 0.5s ease';
          strip.style.transform = 'translateY(-140px) scale(0.7)';
          strip.style.opacity = '0';
        }, i * 40),
      );
    });
    this.timers.push(
      setTimeout(() => {
        host.querySelectorAll('.peel-page').forEach((el) => {
          (el as HTMLElement).style.transition = 'opacity 0.3s ease, transform 0.3s ease';
          (el as HTMLElement).style.opacity = '0';
          (el as HTMLElement).style.transform = 'translate(-50%, -46%) scale(0.88)';
        });
      }, 220),
    );
    this.timers.push(
      setTimeout(() => {
        host.replaceChildren();
        onDone();
      }, 520),
    );
  }
}
