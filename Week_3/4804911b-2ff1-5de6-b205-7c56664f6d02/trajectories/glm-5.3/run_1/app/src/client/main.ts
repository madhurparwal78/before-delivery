/**
 * The public hoarding: five reels, the pinned stage, the lineup, the notices,
 * the marquee, the New day slip and the pack reader. Every control works by
 * keyboard and every async outcome is announced in its named live region.
 */
import { el, input, canvas, api, rupees, displayDate, setMirror, type PackFacts, type Catalogue, type NoticeVersion, type SearchEntry } from './lib.js';
import { stageFormulas, panelLines, geometryFor, type StageGeometry } from './stage.js';

const app = document.getElementById('app') as HTMLElement;

async function runHoarding(): Promise<void> {
  const cat = await api<Catalogue>('/api/catalogue');
  const params = new URLSearchParams(location.search);
  let selectedSku = 'KP-200-CTN';
  let drawnToday = cat.ok ? cat.body.today : '';
  let facts: PackFacts | null = null;
  let latestChoice = 0;

  app.textContent = '';

  const nav = el('nav', { 'aria-label': 'Reels', class: 'site-nav', id: 'site-nav' });
  const reelsButton = el('button', { 'aria-expanded': 'false', 'aria-controls': 'reels-panel', text: 'Reels', class: 'reels-button' });
  const panel = el('div', { id: 'reels-panel', class: 'reels-panel', role: 'menu' });
  const reels: Array<{ label: string; target: string }> = [
    { label: 'Now Showing', target: 'Now-Showing' },
    { label: 'The Pack', target: 'The-Pack' },
    { label: 'The Lineup', target: 'The-Lineup' },
    { label: 'Price Notices', target: 'Price-Notices' },
    { label: 'End Credits', target: 'End-Credits' },
  ];
  const links = reels.map((r) => {
    const a = el('a', { href: `#${r.target}`, text: r.label, role: 'menuitem' });
    a.dataset.target = r.target;
    panel.appendChild(a);
    return a;
  });
  if (window.matchMedia('(min-width: 768px)').matches) {
    for (const a of links) nav.appendChild(a);
  } else {
    nav.appendChild(reelsButton);
  }

  const jump = (target: string): void => {
    const region = document.getElementById(target);
    if (region) region.scrollIntoView({ behavior: 'auto', block: 'start' });
  };
  for (const a of links) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      jump(a.dataset.target ?? '');
      closePanel(true);
    });
  }
  function closePanel(returnFocus: boolean): void {
    panel.dataset.open = 'false';
    reelsButton.setAttribute('aria-expanded', 'false');
    if (returnFocus) reelsButton.focus();
  }
  reelsButton.addEventListener('click', () => {
    const open = panel.dataset.open === 'true';
    panel.dataset.open = open ? 'false' : 'true';
    reelsButton.setAttribute('aria-expanded', open ? 'false' : 'true');
    if (!open) links[0].focus();
  });

  const hero = el('section', { 'aria-label': 'Now Showing', class: 'reel reel--full hero', id: 'Now-Showing' });
  const heroField = el('div', { class: 'hero-field' });
  const shout = el('h1', { class: 'hero-shout' });
  shout.appendChild(el('span', { class: 'line', text: 'COLD DRINK' }));
  shout.appendChild(el('span', { class: 'line', text: 'HOUSE FULL' }));
  const arch = el('div', { class: 'hero-arch', 'data-arch-open': '1', id: 'hero-arch' });
  const heroCanvas = canvas({ role: 'img', 'aria-label': 'Pack under the lamp' });
  arch.appendChild(heroCanvas);
  heroField.append(shout, arch);
  const charcoalBand = el('div', { class: 'hero-charcoal' });
  charcoalBand.appendChild(el('p', { class: 'hero-sentence', text: `Nashik's Vasant Talkies bottled its interval soda in the lobby, and the house still prints every price where you can read it.` }));
  const readYourPack = el('a', { href: '#The-Pack', class: 'read-your-pack', text: 'Read your pack' });
  charcoalBand.appendChild(readYourPack);
  hero.append(heroField, charcoalBand);

  const packSection = el('section', { 'aria-label': 'The Pack', class: 'reel pack-section', id: 'The-Pack' });
  const pinned = el('div', { class: 'pinned-stage' });
  const stageWrap = el('div', { class: 'stage-wrap' });
  const stage = el('div', { class: 'stage', id: 'stage' });
  const stageCanvas = canvas({ role: 'img', 'aria-label': 'Pack stage' });
  stage.appendChild(stageCanvas);
  stageWrap.appendChild(stage);
  const mirror = el('div', { class: 'mirror', id: 'mirror' });
  const factsRegion = el('section', { 'aria-label': 'Pack facts' });
  factsRegion.dataset.mirrorSwap = '1';
  mirror.appendChild(factsRegion);
  const stillButtons = el('div', { class: 'still-buttons' });
  const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const searchWrap = el('div');
  const searchbox = input({ type: 'search', 'aria-label': 'Find a pack', maxlength: '80', class: 'form-input', id: 'find-pack' });
  const resultsList = el('ul', { 'aria-label': 'Pack results', id: 'pack-results', class: 'stack-records' });
  const searchStatus = el('div', { role: 'status', 'aria-live': 'polite', id: 'search-status', class: 'status-line live-region' });
  const readerForm = el('form');
  const batchField = input({ type: 'text', 'aria-label': 'Batch code', class: 'form-input', id: 'batch-code' });
  const readButton = el('button', { type: 'submit', class: 'rectangle-button', text: 'Read pack' });
  const readerStatus = el('div', { role: 'status', 'aria-live': 'polite', id: 'reader-status', class: 'status-line live-region' });
  readerForm.append(batchField, readButton);
  const searchLabel = el('label', { class: 'form-label', for: 'find-pack', text: 'Find a pack' });
  searchWrap.append(searchLabel, searchbox, resultsList, searchStatus);
  const readerLabel = el('label', { class: 'form-label', for: 'batch-code', text: 'Batch code' });
  packSection.append(pinned, searchWrap, readerLabel, readerForm, readerStatus);
  pinned.append(stageWrap, mirror);

  const lineup = el('section', { 'aria-label': 'The Lineup', class: 'reel lineup', id: 'The-Lineup' });
  const drinksList = el('ul', { 'aria-label': 'Drinks', id: 'drinks-list', class: 'drinks-list' });

  const notices = el('section', { 'aria-label': 'Price Notices', class: 'reel notices', id: 'Price-Notices' });

  const credits = el('section', { 'aria-label': 'End Credits', class: 'reel credits', id: 'End-Credits' });

  const marquee = el('div', { role: 'marquee', 'aria-label': 'Price changes', class: 'marquee', id: 'marquee' });
  const marqueeText = el('span', { class: 'marquee-text', id: 'marquee-text' });
  marquee.appendChild(marqueeText);
  let marqueePaused = false;
  const pauseButton = el('button', { class: 'rectangle-button', text: 'Pause price changes', id: 'marquee-pause' });
  pauseButton.addEventListener('click', () => {
    marqueePaused = !marqueePaused;
    marqueeText.style.animationPlayState = marqueePaused ? 'paused' : 'running';
    pauseButton.textContent = marqueePaused ? 'Play price changes' : 'Pause price changes';
  });

  const newDay = el('section', { 'aria-label': 'New day', class: 'new-day-slip', id: 'new-day' });
  const newDaySentence = el('span', { id: 'new-day-sentence' });
  const readToday = el('button', { class: 'rectangle-button', text: `Read today's prices`, id: 'read-today' });
  const dayStatus = el('div', { role: 'status', 'aria-live': 'polite', id: 'day-status', class: 'day-status' });
  dayStatus.tabIndex = -1;
  newDay.append(newDaySentence, readToday);

  app.append(nav, panel, hero, packSection, lineup, notices, credits, marquee, newDay, dayStatus, pauseButton);

  readYourPack.addEventListener('click', (e) => {
    e.preventDefault();
    jump('The-Pack');
    batchField.focus();
  });

  // ---- pack stage drawing ----
  let gl: WebGLRenderingContext | null = null;
  let usingSvg = false;
  let stillProgress = 0;
  let swapStart = 0;
  let swapProgress = 1;
  let marqueeEntries: string[] = [];

  function ensureRenderer(): void {
    if (usingSvg) return;
    if (!gl) {
      gl = stageCanvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
      if (!gl) {
        usingSvg = true;
        stageCanvas.style.display = 'none';
        return;
      }
      stageCanvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        usingSvg = true;
        stage.dataset.renderer = 'svg';
        stageCanvas.style.display = 'none';
        buildSvgNow();
      });
      stageCanvas.addEventListener('webglcontextrestored', () => {
        usingSvg = false;
        stage.dataset.renderer = 'webgl';
        stageCanvas.style.display = '';
        const old = stage.querySelector('svg');
        if (old) old.remove();
        gl = stageCanvas.getContext('webgl');
      });
    }
  }

  function buildSvgNow(): void {
    const old = stage.querySelector('svg');
    if (old) old.remove();
    const svg = buildSvgPanel(facts, currentProgress());
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Pack declaration panel');
    stage.appendChild(svg);
  }

  function currentProgress(): number {
    return reducedMotion() ? stillProgress : scrollProgress();
  }

  function scrollProgress(): number {
    const rect = stage.getBoundingClientRect();
    const vh = window.innerHeight;
    const past = -rect.top;
    return Math.max(0, Math.min(1, past / (4 * vh)));
  }

  function buildSvgPanel(f: PackFacts | null, progress: number): SVGElement {
    const { yaw, stickerT } = stageFormulas(progress, f?.stickerApplies ?? false);
    const lines = f ? panelLines(f) : null;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 600 600');
    const g = document.createElementNS(svgNS, 'g');
    const packW = 320 * Math.max(0.08, Math.abs(Math.cos((yaw * Math.PI) / 180)));
    const packX = 600 / 2 - packW / 2;
    const body = document.createElementNS(svgNS, 'rect');
    body.setAttribute('x', String(packX));
    body.setAttribute('y', '120');
    body.setAttribute('width', String(packW));
    body.setAttribute('height', '360');
    body.setAttribute('fill', 'rgb(138,16,28)');
    body.setAttribute('stroke', 'white');
    body.setAttribute('stroke-width', '3');
    g.appendChild(body);
    const mkText = (x: number, y: number, size: number, fill: string, text: string, anchor?: string): SVGElement => {
      const t = document.createElementNS(svgNS, 'text');
      t.setAttribute('x', String(x));
      t.setAttribute('y', String(y));
      t.setAttribute('fill', fill);
      t.setAttribute('font-size', String(size));
      if (anchor) t.setAttribute('text-anchor', anchor);
      t.textContent = text;
      return t;
    };
    if (f) {
      const variant = f.skuName.slice(f.drinkName.length).trim();
      if (yaw < 90) {
        g.appendChild(mkText(packX + 12, 210, 20, 'white', f.drinkName));
        g.appendChild(mkText(packX + 12, 240, 18, 'white', variant));
      }
      if (yaw >= 90 && lines) {
        const cx = 600 / 2;
        g.appendChild(mkText(cx, 250, 20, 'white', lines.printedMrp, 'middle'));
        g.appendChild(mkText(cx, 290, 18, 'white', `${lines.packed} · ${lines.bestBefore}`, 'middle'));
        if (lines.unit) g.appendChild(mkText(cx, 330, 16, 'white', lines.unit, 'middle'));
        if (lines.revised && stickerT > 0) {
          const sx = cx + (1 - stickerT) * 260;
          const st = document.createElementNS(svgNS, 'rect');
          st.setAttribute('x', String(sx - 90));
          st.setAttribute('y', '160');
          st.setAttribute('width', '180');
          st.setAttribute('height', '64');
          st.setAttribute('fill', 'rgb(255,217,220)');
          st.setAttribute('transform', `rotate(-4 ${sx} 192)`);
          g.appendChild(st);
          g.appendChild(mkText(sx, 198, 15, 'rgb(156,18,32)', lines.revised, 'middle'));
        }
      }
    }
    svg.appendChild(g);
    return svg;
  }

  function drawFrame(): void {
    if (app.dataset.route !== '/') return;
    const progress = currentProgress();
    const { yaw, cameraZ, stickerT, seated } = stageFormulas(progress, facts?.stickerApplies ?? false);
    stage.dataset.packProgress = String(Math.round(progress * 1000) / 1000);
    stage.dataset.packYaw = String(Math.round(yaw * 10) / 10);
    stage.dataset.cameraZ = String(Math.round(cameraZ * 100) / 100);
    stage.dataset.sticker = seated ? 'seated' : 'none';
    stage.dataset.renderer = usingSvg ? 'svg' : 'webgl';
    stage.dataset.format = facts?.format ?? 'carton';
    stage.dataset.sku = facts?.skuCode ?? '';
    stage.dataset.batch = facts?.batchCode ?? '';
    stage.dataset.swapProgress = String(swapProgress);
    const geo = geometryFor(facts?.format ?? 'carton');
    stage.dataset.mrpRect = geo.mrpRect.join(',');
    stage.dataset.stickerRect = geo.stickerRect.join(',');
    stage.dataset.panelText = panelTextNow();
    stage.dataset.frontText = facts ? `${facts.drinkName} | ${facts.skuName.slice(facts.drinkName.length).trim()}` : '';
    const mrpScreen = rectOnScreen(geo.mrpRect, yaw, cameraZ);
    stage.dataset.mrpScreenRect = mrpScreen.join(',');
    stage.dataset.stickerScreenQuad = stickerT > 0 ? stickerQuadOnScreen(geo.stickerRect, stickerT) : '';
    stage.dataset.panelScreenRect = yaw >= 90 ? geo.panelRect.join(',') : '';
    stage.dataset.frontScreenRect = yaw < 90 ? geo.frontRect.join(',') : '';
    stage.dataset.packScreenRect = packRectOnScreen(yaw).join(',');
    if (!usingSvg) drawWebgl(yaw, cameraZ, stickerT);
    else if (needsSvgRedraw(stickerT, yaw)) buildSvgNow();
    requestAnimationFrame(drawFrame);
  }

  let lastSvgT = -1;
  let lastSvgYaw = -1;
  function needsSvgRedraw(t: number, yaw: number): boolean {
    if (Math.abs(t - lastSvgT) > 0.04 || Math.abs(yaw - lastSvgYaw) > 15) {
      lastSvgT = t;
      lastSvgYaw = yaw;
      return true;
    }
    return false;
  }

  function panelTextNow(): string {
    if (!facts) return '';
    const l = panelLines(facts);
    const out = [l.printedMrp, l.packed, l.bestBefore];
    if (l.unit) out.push(l.unit);
    if (l.revised) out.push(l.revised);
    if (l.oldWrapper) out.push('Old wrapper');
    return out.join(' | ');
  }

  function rectOnScreen(rect: StageGeometry['mrpRect'], yaw: number, cameraZ: number): [number, number, number, number] {
    const stageBox = stage.getBoundingClientRect();
    const face = Math.abs(Math.cos((yaw * Math.PI) / 180));
    const packW = stageBox.width * 0.8 * face;
    const packH = stageBox.height * 0.7;
    const scale = 6 / cameraZ;
    const w = packW * rect[2] * scale;
    const h = packH * rect[3] * scale;
    const x = stageBox.left + (stageBox.width - packW * scale) / 2 + packW * rect[0] * scale;
    const y = stageBox.top + (stageBox.height - packH * scale) / 2 + packH * rect[1] * scale;
    return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
  }

  function stickerQuadOnScreen(rect: StageGeometry['stickerRect'], t: number): string {
    const [x, y, w, h] = rectOnScreen(rect, 180, 6);
    const offX = (1 - t) * (x + w + 400);
    const cx = x + w / 2 + offX;
    const cy = y + h / 2;
    const rad = (-4 * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const corners: Array<[number, number]> = [
      [cx - w / 2, cy - h / 2],
      [cx + w / 2, cy - h / 2],
      [cx + w / 2, cy + h / 2],
      [cx - w / 2, cy + h / 2],
    ];
    return corners
      .map(([px, py]) => {
        const rx = cx + (px - cx) * c - (py - cy) * s;
        const ry = cy + (px - cx) * s + (py - cy) * c;
        return `${Math.round(rx)},${Math.round(ry)}`;
      })
      .join(' ');
  }

  function packRectOnScreen(yaw: number): [number, number, number, number] {
    const stageBox = stage.getBoundingClientRect();
    const face = Math.max(0.08, Math.abs(Math.cos((yaw * Math.PI) / 180)));
    const w = stageBox.width * 0.8 * face;
    const h = stageBox.height * 0.7;
    return [Math.round(stageBox.left + (stageBox.width - w) / 2), Math.round(stageBox.top + (stageBox.height - h) / 2), Math.round(w), Math.round(h)];
  }

  function drawWebgl(yaw: number, cameraZ: number, stickerT: number): void {
    const c = gl;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = stageCanvas.clientWidth;
    const cssH = stageCanvas.clientHeight;
    const bw = Math.max(1, Math.floor(cssW * dpr));
    const bh = Math.max(1, Math.floor(cssH * dpr));
    if (stageCanvas.width !== bw || stageCanvas.height !== bh) {
      stageCanvas.width = bw;
      stageCanvas.height = bh;
    }
    c.viewport(0, 0, bw, bh);
    c.clearColor(0.541, 0.063, 0.11, 1);
    c.enable(c.DEPTH_TEST);
    c.clear(c.COLOR_BUFFER_BIT | c.DEPTH_BUFFER_BIT);
    const prog = compileProgram(c);
    if (!prog) return;
    c.useProgram(prog);
    c.uniform1f(c.getUniformLocation(prog, 'yaw'), yaw);
    const scale = 6 / cameraZ;
    c.uniform1f(c.getUniformLocation(prog, 'scale'), scale);
    const drawQuad = (col: [number, number, number], size: number, z: number, offX = 0): void => {
      const buffer = c.createBuffer();
      c.bindBuffer(c.ARRAY_BUFFER, buffer);
      c.bufferData(c.ARRAY_BUFFER, new Float32Array([
        -size + offX, size, z, -size + offX, -size, z, size + offX, -size, z, size + offX, size, z,
      ]), c.STATIC_DRAW);
      const loc = c.getAttribLocation(prog, 'p');
      c.enableVertexAttribArray(loc);
      c.vertexAttribPointer(loc, 3, c.FLOAT, false, 0, 0);
      c.uniform3f(c.getUniformLocation(prog, 'col'), col[0], col[1], col[2]);
      c.drawArrays(c.TRIANGLE_FAN, 0, 4);
    };
    drawQuad([0.541, 0.063, 0.11], 0.7, 1);
    if (yaw >= 90) drawQuad([0.165, 0.165, 0.165], 0.5, 1.01);
    if (stickerT > 0) {
      const s = 0.28;
      const offX = (1 - stickerT) * 1.5;
      drawQuad([1.0, 0.851, 0.863], s, 1.02, offX);
    }
  }

  function compileProgram(c: WebGLRenderingContext): WebGLProgram | null {
    const vs = `attribute vec3 p; uniform float yaw; uniform float scale; void main(){ float r = radians(yaw); vec3 q = vec3(p.x*cos(r)-p.z*sin(r), p.y, p.x*sin(r)+p.z*cos(r)); gl_Position = vec4(q.xy*scale, 0.0, 1.0); }`;
    const fs = `precision mediump float; uniform vec3 col; void main(){ gl_FragColor = vec4(col, 1.0); }`;
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = c.createShader(type);
      if (!sh) return null;
      c.shaderSource(sh, src);
      c.compileShader(sh);
      return sh;
    };
    const vsh = compile(c.VERTEX_SHADER, vs);
    const fsh = compile(c.FRAGMENT_SHADER, fs);
    if (!vsh || !fsh) return null;
    const prog = c.createProgram();
    if (!prog) return null;
    c.attachShader(prog, vsh);
    c.attachShader(prog, fsh);
    c.linkProgram(prog);
    return prog;
  }

  ensureRenderer();
  requestAnimationFrame(drawFrame);

  const front = el('button', { class: 'rectangle-button', text: 'Front' });
  const back = el('button', { class: 'rectangle-button', text: 'Back' });
  const stickerBtn = el('button', { class: 'rectangle-button', text: 'Sticker' });
  front.addEventListener('click', () => {
    stillProgress = 0;
  });
  back.addEventListener('click', () => {
    stillProgress = 0.55;
  });
  stickerBtn.addEventListener('click', () => {
    stillProgress = 1;
  });
  stillButtons.append(front, back, stickerBtn);
  mirror.appendChild(stillButtons);

  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyReduced = (): void => {
    stillButtons.style.display = reducedQuery.matches ? 'flex' : 'none';
  };
  reducedQuery.addEventListener('change', applyReduced);
  applyReduced();

  // ---- pack choice: every choice re-reads the server ----
  async function choose(skuCode: string, batchCode?: string, pushUrl?: string): Promise<void> {
    const choice = ++latestChoice;
    let f: PackFacts | null = null;
    if (batchCode) {
      const r = await api<PackFacts>(`/api/batches/${encodeURIComponent(batchCode)}`);
      if (choice !== latestChoice) return;
      if (r.status === 429) {
        showWait(r.body as { retryAfter?: number });
        return;
      }
      if (r.ok) f = r.body;
    } else {
      const r = await api<{ storyBatch: PackFacts | null }>(`/api/skus/${encodeURIComponent(skuCode)}`);
      if (choice !== latestChoice) return;
      if (r.status === 429) {
        showWait(r.body as { retryAfter?: number });
        return;
      }
      f = r.ok ? r.body.storyBatch : null;
    }
    if (f) {
      facts = f;
      setMirror(factsRegion, f);
      startSwap();
    }
    if (pushUrl) history.pushState(null, '', pushUrl);
    drawLineup();
  }

  function startSwap(): void {
    swapStart = performance.now();
    if (reducedMotion()) swapProgress = 1;
    else swapProgress = 0;
  }

  setInterval(() => {
    if (swapProgress < 1) {
      const t = (performance.now() - swapStart) / 320;
      swapProgress = Math.min(1, t);
    }
  }, 32);

  // ---- lineup ----
  function drawLineup(): void {
    if (!cat.ok) return;
    drinksList.textContent = '';
    const sel = facts?.skuCode ?? selectedSku;
    const selDrink = cat.body.drinks.find((d) => d.skus.some((s) => s.code === sel)) ?? cat.body.drinks[0];
    cat.body.drinks.forEach((d, idx) => {
      const li = el('li');
      const dist = Math.abs(cat.body.drinks.indexOf(selDrink) - idx);
      const shade = ['255', '230', '205', '185', '165', '150'][Math.min(dist, 5)];
      const btn = el('button', { class: 'drink-button', text: d.name, 'aria-pressed': d.id === selDrink.id ? 'true' : 'false' });
      btn.style.color = `rgb(${shade},${shade},${shade})`;
      btn.addEventListener('click', () => {
        const first = d.skus[0]?.code;
        if (first) {
          selectedSku = first;
          void choose(first, undefined, `/?sku=${first}`);
          readerStatus.textContent = '';
        }
      });
      li.appendChild(btn);
      if (d.id === selDrink.id) {
        const group = el('div', { role: 'radiogroup', 'aria-label': 'Packs', class: 'packs-group' });
        d.skus.forEach((s) => {
          const label = el('label');
          const radio = input({ type: 'radio', name: 'packs', value: s.code });
          radio.checked = s.code === sel;
          radio.addEventListener('change', () => {
            selectedSku = s.code;
            void choose(s.code, undefined, `/?sku=${s.code}`);
          });
          label.append(radio, el('span', { text: ` ${s.variant}` }));
          group.appendChild(label);
        });
        li.appendChild(group);
      }
      drinksList.appendChild(li);
    });
  }
  drawLineup();

  // ---- reader ----
  readerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (readButton.getAttribute('aria-disabled') === 'true') return;
    const code = batchField.value.trim().toUpperCase();
    if (!code) return;
    const choice = ++latestChoice;
    void (async () => {
      const r = await api<PackFacts>(`/api/batches/${encodeURIComponent(code)}`);
      if (choice !== latestChoice) return;
      if (r.status === 429) {
        showWait(r.body as { retryAfter?: number });
        return;
      }
      if (!r.ok) {
        readerStatus.textContent = (r.body as { message?: string }).message ?? '';
        return;
      }
      facts = r.body;
      setMirror(factsRegion, facts);
      startSwap();
      readerStatus.textContent = `Batch ${code} read.`;
      history.pushState(null, '', `/?batch=${encodeURIComponent(code)}`);
      drawLineup();
    })();
  });

  // ---- pack search ----
  let searchTimer: number | null = null;
  let searchSeq = 0;
  searchbox.addEventListener('input', () => {
    if (searchTimer) window.clearTimeout(searchTimer);
    const q = searchbox.value.trim();
    if (q === '') {
      resultsList.textContent = '';
      searchStatus.textContent = '';
      return;
    }
    searchTimer = window.setTimeout(async () => {
      const seq = ++searchSeq;
      const r = await api<{ searchState: string; results: SearchEntry[] }>(`/api/search?q=${encodeURIComponent(q)}`);
      if (seq !== searchSeq) return;
      resultsList.textContent = '';
      searchStatus.textContent = '';
      if (r.status === 429) {
        showWait(r.body as { retryAfter?: number });
        return;
      }
      if (!r.ok) return;
      const { searchState, results } = r.body;
      const stateSentence = searchState === 'behind' ? 'Search is catching up. Recent changes may be missing.' : searchState === 'down' ? 'Search is down. Exact codes still work.' : null;
      if (results.length === 0) {
        searchStatus.textContent = searchState === 'current' ? 'No pack matches that.' : stateSentence ?? '';
        return;
      }
      searchStatus.textContent = `${results.length === 1 ? '1 pack found.' : `${results.length} packs found.`}${stateSentence ? ` ${stateSentence}` : ''}`;
      results.forEach((res) => {
        const li = el('li');
        const label = res.kind === 'batch' ? `${res.batchCode} ${res.name} ${rupees(res.retailPricePaise)}` : `${res.name} ${rupees(res.retailPricePaise)}`;
        const btn = el('button', { class: 'rectangle-button', text: label });
        btn.addEventListener('click', () => {
          if (res.kind === 'batch' && res.batchCode) {
            void choose(res.skuCode, res.batchCode, `/?batch=${encodeURIComponent(res.batchCode)}`);
          } else {
            void choose(res.skuCode, undefined, `/?sku=${encodeURIComponent(res.skuCode)}`);
          }
        });
        li.appendChild(btn);
        const src = res.sourceNotice ? ` ${res.sourceNotice.number} v${res.sourceNotice.version}` : ' Launch print';
        li.appendChild(el('span', { class: 'sha-line', text: src }));
        resultsList.appendChild(li);
      });
    }, 250);
  });

  searchbox.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      const first = resultsList.querySelector('button');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === 'Escape') {
      searchbox.value = '';
      resultsList.textContent = '';
      searchStatus.textContent = '';
    }
  });
  resultsList.addEventListener('keydown', (e) => {
    const buttons = Array.from(resultsList.querySelectorAll('button'));
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' && idx < buttons.length - 1) {
      e.preventDefault();
      buttons[idx + 1].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx <= 0) {
        searchbox.focus();
        searchbox.setSelectionRange(searchbox.value.length, searchbox.value.length);
      } else buttons[idx - 1].focus();
    } else if (e.key === 'Escape') {
      searchbox.focus();
    }
  });

  // ---- notices and credits ----
  async function drawNotices(): Promise<void> {
    const r = await api<{ notices: Array<{ number: string; state: string; currentVersion: NoticeVersion }> }>('/api/notices');
    notices.textContent = '';
    if (r.ok) {
      for (const n of r.body.notices) {
        const v = n.currentVersion;
        const listing = el('article', { class: 'release-listing' });
        const head = el('div', { class: 'release-head' });
        head.append(el('h3', { class: 'release-title', text: `${v.title} — ${n.number}` }), el('span', { class: 'release-date', text: displayDate(v.effectiveDate) }));
        const body = el('div', { class: 'release-body' });
        const table = el('table', { 'aria-label': `Revised prices ${n.number}`, class: 'responsive' });
        const thead = el('thead');
        const headRow = el('tr');
        for (const col of ['Pack', 'Old MRP', 'Revised MRP', 'Kind']) headRow.appendChild(el('th', { text: col }));
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = el('tbody');
        for (const row of v.rows) {
          const tr = el('tr');
          tr.append(
            el('td', { text: row.name }),
            el('td', { text: rupees(row.oldMrpPaise) }),
            el('td', { text: rupees(row.revisedMrpPaise) }),
            el('td', { class: 'kind-label', text: row.kind === 'sticker' ? 'Sticker' : 'New print' })
          );
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        const stackList = el('ol', { 'aria-label': `Revised prices ${n.number}`, class: 'stack-records responsive-only' });
        for (const row of v.rows) {
          const li = el('li', { class: 'record' });
          li.append(el('div', { text: row.name }), el('div', { text: `${rupees(row.oldMrpPaise)} to ${rupees(row.revisedMrpPaise)}` }), el('div', { class: 'kind-label', text: row.kind === 'sticker' ? 'Sticker' : 'New print' }));
          stackList.appendChild(li);
        }
        body.append(table, stackList);
        if (v.runOutUntil) body.appendChild(el('p', { class: 'runout-line', text: `Old wrappers allowed until ${displayDate(v.runOutUntil)}` }));
        listing.append(head, body);
        notices.appendChild(listing);
      }

      const c = await api<Catalogue>('/api/catalogue');
      if (c.ok) {
        const current = el('div', { class: 'current-prices' });
        current.appendChild(el('h3', { text: 'Current prices' }));
        const table = el('table', { 'aria-label': 'Current prices', class: 'responsive' });
        const thead = el('thead');
        const hr = el('tr');
        for (const col of ['Pack', 'Print MRP', 'Source notice']) hr.appendChild(el('th', { text: col }));
        thead.appendChild(hr);
        table.appendChild(thead);
        const tbody = el('tbody');
        const stack = el('ol', { 'aria-label': 'Current prices', class: 'stack-records responsive-only' });
        for (const d of c.body.drinks) {
          for (const s of d.skus) {
            const src = await skuSource(s.code);
            const tr = el('tr');
            tr.append(el('td', { text: s.name }), el('td', { text: rupees(s.currentMrpPaise) }), el('td', { text: src }));
            tbody.appendChild(tr);
            const li = el('li', { class: 'record' });
            li.append(el('div', { text: s.name }), el('div', { text: `${rupees(s.currentMrpPaise)} — ${src}` }));
            stack.appendChild(li);
          }
        }
        table.appendChild(tbody);
        current.append(table, stack);
        notices.appendChild(current);
        drawCredits(c.body);
      }
    }
  }

  async function skuSource(code: string): Promise<string> {
    const r = await api<{ currentSource: { number: string; version: number } | null }>(`/api/skus/${encodeURIComponent(code)}`);
    if (!r.ok) return 'Launch print';
    return r.body.currentSource ? `${r.body.currentSource.number} v${r.body.currentSource.version}` : 'Launch print';
  }

  function drawCredits(c: Catalogue): void {
    credits.textContent = '';
    credits.appendChild(el('p', { class: 'counts-line', id: 'counts-line', text: `Drinks: ${c.counts.drinks}. Packs: ${c.counts.skus}. Notices: ${c.counts.notices}. Scheduled revisions: ${c.counts.scheduledRevisions}.` }));
    credits.appendChild(el('p', { class: 'legal-line', text: `Vasant Talkies Drinks is an invented house. Every price here is invented.` }));
    credits.appendChild(el('a', { href: '/sign-in', class: 'signin-link', text: 'Sign in' }));
    credits.appendChild(el('div', { class: 'wordmark', 'aria-hidden': 'true', text: 'VASANT TALKIES' }));
  }

  await drawNotices();

  function drawMarquee(): void {
    void api<{ notices: Array<{ currentVersion: NoticeVersion }> }>('/api/notices').then((r) => {
      if (!r.ok) return;
      const entries: string[] = [];
      for (const n of r.body.notices) {
        const v = n.currentVersion;
        if (v.state === 'scheduled') continue;
        for (const row of v.rows) {
          entries.push(`${row.name} Rs ${rupees(row.oldMrpPaise).replace('Rs ', '')} to Rs ${rupees(row.revisedMrpPaise).replace('Rs ', '')} from ${displayDate(v.effectiveDate)}`);
        }
      }
      marqueeEntries = entries;
      marqueeText.textContent = marqueeEntries.join(' · ');
    });
  }
  drawMarquee();

  // ---- new day slip ----
  let dayCheckSeq = 0;
  setInterval(async () => {
    const seq = ++dayCheckSeq;
    const r = await api<{ today: string }>('/api/catalogue');
    if (seq !== dayCheckSeq) return;
    if (!r.ok) return;
    if (r.body.today !== drawnToday) {
      newDay.dataset.show = 'true';
      newDaySentence.textContent = `The house date has changed. Prices here are for ${displayDate(r.body.today)}.`;
      dayStatus.textContent = newDaySentence.textContent;
    } else {
      newDay.dataset.show = 'false';
    }
  }, 30000);

  readToday.addEventListener('click', () => {
    if (readToday.getAttribute('aria-disabled') === 'true') return;
    readToday.setAttribute('aria-disabled', 'true');
    const seq = ++latestChoice;
    void (async () => {
      const c = await api<Catalogue>('/api/catalogue');
      if (c.ok) drawnToday = c.body.today;
      await drawNotices();
      drawMarquee();
      const url = new URL(location.href);
      const sku = url.searchParams.get('sku');
      const batch = url.searchParams.get('batch');
      if (batch) {
        const r = await api<PackFacts>(`/api/batches/${encodeURIComponent(batch)}`);
        if (seq === latestChoice && r.ok) {
          facts = r.body;
          setMirror(factsRegion, facts);
          startSwap();
        }
      } else if (sku) {
        const r = await api<{ storyBatch: PackFacts | null }>(`/api/skus/${encodeURIComponent(sku)}`);
        if (seq === latestChoice && r.ok && r.body.storyBatch) {
          facts = r.body.storyBatch;
          setMirror(factsRegion, facts);
          startSwap();
        }
      }
      if (c.ok) {
        dayStatus.textContent = `Prices read for ${displayDate(c.body.today)}.`;
        newDay.dataset.show = 'false';
        dayStatus.focus();
      }
      readToday.removeAttribute('aria-disabled');
    })();
  });

  // ---- wait timer ----
  const waitTimer = el('div', { role: 'timer', id: 'wait-timer', class: 'wait-timer' });
  app.appendChild(waitTimer);
  function showWait(body: { retryAfter?: number }): void {
    const seconds = Math.max(1, Math.min(60, body.retryAfter ?? 1));
    const message = `Too many tries. Wait ${seconds} seconds and try again.`;
    readerStatus.textContent = message;
    waitTimer.dataset.show = 'true';
    const waitUntil = performance.now() + seconds * 1000;
    const tick = (): void => {
      const left = Math.ceil((waitUntil - performance.now()) / 1000);
      if (left <= 0) {
        waitTimer.dataset.show = 'false';
        waitTimer.textContent = '';
        readerStatus.textContent = '';
        readButton.removeAttribute('aria-disabled');
        return;
      }
      waitTimer.textContent = left === 1 ? '1 second left.' : `${left} seconds left.`;
      setTimeout(tick, 1000);
    };
    readButton.setAttribute('aria-disabled', 'true');
    tick();
  }

  // ---- history ----
  window.addEventListener('popstate', () => {
    const url = new URL(location.href);
    const batch = url.searchParams.get('batch');
    const sku = url.searchParams.get('sku');
    if (batch) void choose('KP-200-CTN', batch);
    else if (sku) void choose(sku);
  });

  const batchParam = params.get('batch');
  const skuParam = params.get('sku');
  if (batchParam) await choose('KP-200-CTN', batchParam);
  else if (skuParam) await choose(skuParam);
  else await choose('KP-200-CTN');
}

// ---------- sign-in ----------

async function runSignIn(): Promise<void> {
  app.textContent = '';
  const block = el('div', { class: 'form-block' });
  const status = el('div', { role: 'status', 'aria-live': 'polite', id: 'sign-in-status', class: 'status-line live-region' });
  const emailLabel = el('label', { class: 'form-label', for: 'email', text: 'Email' });
  const email = input({ type: 'email', class: 'form-input', id: 'email', autocomplete: 'username' });
  const passLabel = el('label', { class: 'form-label', for: 'password', text: 'Password' });
  const password = input({ type: 'password', class: 'form-input', id: 'password', autocomplete: 'current-password' });
  const submit = el('button', { class: 'rectangle-button', text: 'Sign in', type: 'submit' });
  const form = el('form');
  form.append(emailLabel, email, passLabel, password, submit);
  block.append(form, status);
  app.appendChild(block);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submit.getAttribute('aria-disabled') === 'true') return;
    submit.setAttribute('aria-disabled', 'true');
    status.textContent = 'Signing in.';
    void (async () => {
      const r = await api<{ role: string }>('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), password: password.value }),
      });
      submit.removeAttribute('aria-disabled');
      if (r.status === 429) {
        const body = r.body as { retryAfter?: number; message?: string };
        status.textContent = body.message ?? 'Too many tries. Wait and try again.';
        return;
      }
      if (!r.ok) {
        status.textContent = (r.body as { message?: string }).message ?? '';
        return;
      }
      location.href = r.body.role === 'editor' ? '/editor' : '/stockist';
    })();
  });
}


export { runHoarding, runSignIn };
