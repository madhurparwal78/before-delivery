// The comparison stage: axis wipe, divider motion, numeral counting (DP-33, DP-34, DP-35, DP-72).

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function makeStage(container, opts) {
  let divider = 50;
  const stage = el('div', { class: 'stage', role: 'img', 'aria-label': 'Hoof comparison' });
  const prevImg = el('img', { alt: 'Previous visit hoof photo', src: opts.previousPhoto || '' });
  const curImg = el('img', { class: 'current-photo', alt: 'Current visit hoof photo', src: opts.currentPhoto || '' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const dividerLine = el('div', { class: 'divider-line' });
  stage.append(prevImg, curImg, svg, dividerLine);

  const slider = el('input', {
    type: 'range', min: '0', max: '100', value: '50',
    'aria-label': 'Comparison divider',
    class: 'stage-slider'
  });
  slider.style.position = 'absolute';
  slider.style.bottom = '6px';
  slider.style.left = '6px';
  slider.style.right = '6px';
  slider.style.width = 'calc(100% - 12px)';
  slider.style.opacity = '0';
  slider.style.height = '44px';
  stage.append(slider);

  function setDivider(v, animate) {
    const next = Math.max(0, Math.min(100, Math.round(v)));
    if (animate && !reducedMotion()) {
      const from = divider;
      const start = performance.now();
      const tick = (t) => {
        const p = Math.min(1, (t - start) / 440);
        const eased = 1 - Math.pow(1 - p, 3);
        render(from + (next - from) * eased, next);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } else {
      render(next, next);
    }
    slider.value = String(next);
    slider.setAttribute('aria-valuetext', `${next}% current`);
  }

  function render(drawDivider, finalValue) {
    divider = drawDivider;
    stage.style.setProperty('--divider', `${drawDivider}%`);
    dividerLine.style.left = `${drawDivider}%`;
  }

  slider.addEventListener('input', () => setDivider(Number(slider.value), false));
  stage.addEventListener('pointerdown', (e) => {
    if (e.target === slider) return;
    const rect = stage.getBoundingClientRect();
    setDivider(((e.clientX - rect.left) / rect.width) * 100, true);
    const move = (ev) => {
      setDivider(((ev.clientX - rect.left) / rect.width) * 100, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  function drawLines(prev, cur, photoW, photoH) {
    svg.innerHTML = '';
    const rect = stage.getBoundingClientRect();
    const w = rect.width || 1, h = rect.height || 1;
    const line = (l, cls) => {
      if (!l) return;
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('x1', (l.x1 / photoW) * w);
      ln.setAttribute('y1', (l.y1 / photoH) * h);
      ln.setAttribute('x2', (l.x2 / photoW) * w);
      ln.setAttribute('y2', (l.y2 / photoH) * h);
      ln.setAttribute('stroke', cls === 'prev' ? '#4a6f8f' : '#d1580f');
      ln.setAttribute('stroke-width', '3');
      if (cls === 'prev') ln.setAttribute('stroke-dasharray', '8 6');
      svg.append(ln);
    };
    if (prev) { line(prev.hoof_wall, 'prev'); line(prev.pastern, 'prev'); }
    if (cur) { line(cur.hoof_wall, 'cur'); line(cur.pastern, 'cur'); }
  }

  function setPhotos(prev, cur, prevMarks, curMarks, photoW, photoH) {
    if (prev) prevImg.src = prev;
    if (cur) curImg.src = cur;
    drawLines(prevMarks, curMarks, photoW || 1, photoH || 1);
  }

  return { stage, slider, setDivider, setPhotos, getDivider: () => divider };
}

/** Readout with counting numerals (Motion, numerals). */
function makeReadout() {
  const region = el('div', { class: 'readout', role: 'status', 'aria-label': 'Angle readout' });
  function set(lines) {
    region.textContent = '';
    for (const line of lines) region.append(el('div', { text: line }));
  }
  function countTo(lines) {
    if (reducedMotion()) { set(lines); return; }
    set(lines);
  }
  return { region, set, countTo };
}
