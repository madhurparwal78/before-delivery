// The landing page and its working demo panels.
import { el } from './dom';
import { createFollowLightStage } from './followlight';
import type { Person } from './types';

const EMBED_NAMES = [
  'Northwind Kiln hero',
  'Pell & Sorrel launch',
  'Quiet Orbit pricing',
  'Ferrous Lab intro',
  'Tallow Street drop',
  'Marrow FM teaser',
];

export function renderLanding(root: HTMLElement, person: Person | null): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.append(renderHeader(person));

  const stage = createFollowLightStage(reduced);

  const pill = el('a', {
    class: 'release-pill',
    href: '/#versions',
    'aria-label': 'New Republish any version as the next one',
  });
  pill.append(el('span', { class: 'dot' }));
  pill.append(el('strong', { text: 'New' }));
  pill.append(document.createTextNode(' Republish any version as the next one'));
  pill.classList.add('fade-in');

  const headline = el('h1', { class: 'headline' });
  const line1 = el('span', { style: 'display:block' }, 'Scenes that hold their ');
  const shapeWord = el('span', { class: 'h-serif' }, 'shape');
  line1.append(shapeWord);
  headline.append(line1);

  const sub = el(
    'p',
    { class: 'sub-line' },
    'Build a layered hero from 3D primitives, extruded type, models and light. Publish it as a numbered version, and your embed switches in place.',
  );

  const openBtn = el(
    'a',
    { class: 'open-editor-btn', href: person ? '/projects' : '/signin', 'aria-label': 'Open editor' },
    'Open editor',
  );

  const content = el('div', { class: 'stage-content' }, pill, headline, sub, openBtn);
  if (!reduced) {
    // The pill fades in first; the headline rises and fades in over 600 ms,
    // 60 ms after the previous line; the button arrives last.
    pill.style.animation = 'fadein 400ms ease';
    line1.style.animation = 'fadein 600ms ease';
    (line1.style as unknown as Record<string, string>).animationDelay = '80ms';
    line1.style.opacity = '0';
    line1.style.animationFillMode = 'forwards';
    sub.style.animation = 'fadein 600ms ease 140ms forwards';
    sub.style.opacity = '0';
    openBtn.style.animation = 'fadein 400ms ease 440ms forwards';
    openBtn.style.opacity = '0';
  } else {
    pill.style.animation = 'fadein 150ms ease';
    line1.style.animation = 'fadein 150ms ease';
    sub.style.animation = 'fadein 150ms ease';
    openBtn.style.animation = 'fadein 150ms ease';
  }
  stage.region.append(content);

  const stageWrap = el('div', { class: 'panel', style: 'padding:0' });
  stageWrap.append(stage.region);
  root.append(stageWrap);

  root.append(renderMarquee(reduced));
  root.append(renderKindTiles());
  root.append(renderTimelineDemo(reduced));
  root.append(renderVariablesDemo());
  root.append(renderReadoutDemo(reduced));
  root.append(renderVersionCard());
  root.append(renderMosaic());
  root.append(renderFooter());
}

export function renderHeader(person: Person | null): HTMLElement {
  const header = el('header', { class: 'workspace-header', role: 'banner' });
  const home = el('a', { class: 'wordmark', href: '/', 'aria-label': 'Halation Studio home' }, 'Halation Studio');
  header.append(home);
  const actions = el('div', { class: 'header-actions' });
  if (person) {
    actions.append(el('span', { class: 'muted' }, person.name));
    const out = el('button', { class: 'btn', 'aria-label': 'Sign out' }, 'Sign out');
    out.addEventListener('click', async () => {
      await fetch('/api/session', { method: 'DELETE' });
      window.location.href = '/';
    });
    actions.append(out);
  } else {
    actions.append(
      el('a', { class: 'btn', href: '/signin', 'aria-label': 'Sign in' }, 'Sign in'),
    );
  }
  header.append(actions);
  return header;
}

function renderMarquee(reduced: boolean): HTMLElement {
  const wrap = el('div', { class: 'panel', style: 'padding:12px 16px' });
  wrap.append(el('p', { class: 'caption-row' }, 'Published from Halation Studio'));
  const marquee = el('div', { class: 'marquee', role: 'region', 'aria-label': 'Published embeds' });
  const track = el('div', { class: 'marquee-track' });
  for (const name of EMBED_NAMES) {
    track.append(el('span', { class: 'marquee-item' }, name));
  }
  if (!reduced) {
    // The only continuous page motion: about 30 px per second, paused on
    // hover and while off-screen.
    let offset = 0;
    let last = performance.now();
    let paused = false;
    marquee.addEventListener('pointerenter', () => (paused = true));
    marquee.addEventListener('pointerleave', () => (paused = false));
    const step = (now: number): void => {
      const dt = now - last;
      last = now;
      const rect = marquee.getBoundingClientRect();
      const onScreen = rect.bottom > 0 && rect.top < window.innerHeight;
      if (!paused && onScreen) {
        offset -= (dt / 1000) * 30;
        const w = track.scrollWidth / 2;
        if (w > 0 && -offset >= w) offset += w;
        track.style.transform = `translateX(${offset}px)`;
      }
      raf = requestAnimationFrame(step);
    };
    let raf = requestAnimationFrame(step);
    void raf;
  }
  marquee.append(track);
  wrap.append(marquee);
  return wrap;
}

function renderKindTiles(): HTMLElement {
  const panel = el('div', { class: 'panel' });
  const region = el('div', { role: 'region', 'aria-label': 'Layer kinds' });
  const grid = el('div', { class: 'tile-grid' });
  const tiles: [string, string][] = [
    ['Primitives', 'Cube, sphere, cylinder, torus and plane, placed to the decimal.'],
    ['Extruded type', 'The built-in outline font, extruded with a bevel.'],
    ['Models', 'Small glTF files and preset models, with clip sampling.'],
    ['Particles', 'Seeded fields that emit or form into a shape.'],
    ['Cloth', 'Fixed-step cloth with pinned edges and wind.'],
    ['Effects', 'Gradients, grain, bloom and aberration over 2D layers.'],
  ];
  for (const [title, body] of tiles) {
    const tile = el('div', { class: 'panel kind-tile', title });
    tile.append(el('h3', {}, title));
    tile.append(el('p', {}, body));
    grid.append(tile);
  }
  region.append(grid);
  panel.append(region);
  return panel;
}

function renderTimelineDemo(reduced: boolean): HTMLElement {
  const panel = el('div', { class: 'panel demo-panel' });
  panel.append(el('h3', {}, 'Keyframe timeline'));
  const track = el('div', { class: 'timeline-track', role: 'region', 'aria-label': 'Timeline demo' });
  const playhead = el('div', { class: 'playhead' });
  const kf1 = el('div', {
    style: 'position:absolute;left:10%;top:12px;width:8px;height:8px;border-radius:2px;background:var(--accent-soft)',
  });
  const kf2 = el('div', {
    style: 'position:absolute;left:70%;top:12px;width:8px;height:8px;border-radius:2px;background:var(--accent-soft)',
  });
  track.append(kf1, kf2, playhead);
  panel.append(track);
  let raf = 0;
  const animate = (): void => {
    // The playhead sweeps across in about two seconds, once.
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / 2000);
      playhead.style.left = `${t * 100}%`;
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  void raf;
  if (!reduced) animate();
  else playhead.style.left = '0%';
  return panel;
}

function renderVariablesDemo(): HTMLElement {
  const panel = el('div', { class: 'panel demo-panel' });
  panel.append(el('h3', {}, 'Variables and presets'));
  const row = el('div', { class: 'field-row' });
  row.append(el('label', {}, 'spin'));
  const input = el('input', { type: 'text', value: '0, 45, 0', 'aria-label': 'spin value' });
  row.append(input);
  panel.append(row);
  const btnRow = el('div', { class: 'field-row' });
  for (const name of ['Calm', 'Lively']) {
    const b = el('button', { class: 'btn', 'aria-label': `Apply ${name}` }, `Apply ${name}`);
    b.addEventListener('click', () => {
      input.value = name === 'Calm' ? '0, 0, 0' : '0, 90, 15';
    });
    btnRow.append(b);
  }
  panel.append(btnRow);
  return panel;
}

function renderReadoutDemo(reduced: boolean): HTMLElement {
  const panel = el('div', { class: 'panel demo-panel' });
  panel.append(el('h3', {}, 'Inspector readouts'));
  const list = el('div', { class: 'readout-list', role: 'region', 'aria-label': 'Readout demo' });
  const rows: [string, string][] = [
    ['Screen point', '806.85, 231.29 px'],
    ['Triangles', '1536'],
    ['IOR', '1.250'],
    ['Live particles', '17'],
  ];
  for (const [label, value] of rows) {
    const row = el('div');
    row.append(el('span', {}, label));
    const val = el('span', { 'data-readout': 'demo' }, value);
    row.append(val);
    list.append(row);
  }
  panel.append(list);
  if (!reduced) {
    // Readout numbers count up over about 600 ms, once.
    const targets = [806.85, 1536, 1.25, 17];
    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / 600);
      const rows2 = list.querySelectorAll<HTMLElement>('[data-readout]');
      rows2[0]!.textContent = `${(targets[0]! * t).toFixed(2)}, ${(231.29 * t).toFixed(2)} px`;
      rows2[1]!.textContent = String(Math.round(targets[1]! * t));
      rows2[2]!.textContent = (targets[2]! * t).toFixed(3);
      rows2[3]!.textContent = String(Math.round(targets[3]! * t));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  return panel;
}

function renderVersionCard(): HTMLElement {
  const panel = el('div', { class: 'panel' });
  const region = el('div', { role: 'region', 'aria-label': 'Every publish gets a number' });
  region.append(el('h3', {}, 'Every publish gets a number'));
  const numeral = el('div', {
    style: 'font-size:64px;font-weight:600;color:var(--accent-soft);font-variant-numeric:tabular-nums',
  }, '2');
  region.append(numeral);
  const code = el('pre', {
    class: 'panel',
    style: 'font-family:var(--mono);font-size:12px;overflow-x:auto;margin:8px 0',
  }, `<iframe src="/embed/your-project-id" width="100%" height="600" allowtransparency></iframe>`);
  region.append(code);
  panel.append(region);
  return panel;
}

function renderMosaic(): HTMLElement {
  const panel = el('div', { class: 'panel' });
  panel.append(el('p', { class: 'caption-row' }, 'Projects'));
  const mosaic = el('div', { class: 'mosaic' });
  for (const name of EMBED_NAMES.slice(0, 3)) {
    const tile = el('div', { class: 'thumb' });
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 320, 120);
    g.addColorStop(0, 'rgba(124,92,255,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = '#101014';
    ctx.fillRect(0, 0, 320, 120);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 320, 120);
    ctx.strokeStyle = 'rgba(164,143,255,0.4)';
    ctx.beginPath();
    ctx.arc(240, 90, 40, Math.PI, 0);
    ctx.stroke();
    tile.append(canvas);
    tile.append(el('div', { class: 'small muted', style: 'padding:8px 10px' }, name));
    mosaic.append(tile);
  }
  panel.append(mosaic);
  return panel;
}

export function renderFooter(): HTMLElement {
  const footer = el('footer', { role: 'contentinfo', class: 'footer' });
  const brand = el('div', {});
  brand.append(el('span', { class: 'wordmark' }, 'Tinderbox Optics'));
  brand.append(
    el('a', { class: 'btn', href: '/projects', 'aria-label': 'Open editor ↗', style: 'margin-top:8px' }, 'Open editor ↗'),
  );
  brand.append(el('div', { class: 'small', style: 'margin-top:8px' }, '© 2026 Tinderbox Optics'));
  footer.append(brand);

  const product = el('div', { class: 'footer-group' });
  product.append(el('strong', {}, 'Product'));
  product.append(el('a', { href: '/projects' }, 'Editor'));
  product.append(el('a', { href: '/#versions' }, 'Embeds'));
  product.append(el('a', { href: '/#versions' }, 'Versions'));
  footer.append(product);

  const studio = el('div', { class: 'footer-group' });
  studio.append(el('strong', {}, 'Studio'));
  studio.append(el('a', { href: '/#release-notes' }, 'Release notes'));
  footer.append(studio);

  const help = el('div', { class: 'footer-group' });
  help.append(el('strong', {}, 'Help'));
  const shortcuts = el('button', { class: 'btn', 'aria-label': 'Keyboard shortcuts' }, 'Keyboard shortcuts');
  shortcuts.addEventListener('click', () => {
    const dlg = el('dialog', { 'aria-label': 'Keyboard shortcuts' });
    dlg.append(el('h3', {}, 'Keyboard shortcuts'));
    const list = el('ul', { class: 'small' });
    for (const item of [
      'Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo',
      'Ctrl/Cmd+D duplicate the selected layer',
      'Ctrl/Cmd+G group, Ctrl/Cmd+Shift+G ungroup',
      'K adds a keyframe for the focused property',
      'Arrow keys move, Shift+Arrow takes the larger step',
      'Alt+ArrowUp/Down reorders the focused layer',
    ]) {
      list.append(el('li', {}, item));
    }
    dlg.append(list);
    const close = el('button', { class: 'btn', 'aria-label': 'Close' }, 'Close');
    dlg.append(close);
    document.body.append(dlg);
    dlg.showModal();
    close.addEventListener('click', () => dlg.close());
  });
  help.append(shortcuts);
  footer.append(help);
  return footer;
}
