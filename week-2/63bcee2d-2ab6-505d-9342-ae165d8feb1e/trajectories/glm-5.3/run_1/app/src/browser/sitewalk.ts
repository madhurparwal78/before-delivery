// The Intent seam: render and photo drawn into one frame, draggable seam,
// numbered snag markers, sticky action bar.

import { api, ApiError, refusalCopy } from './api.js';
import { announce, clear, dateText, h, hkToday, openDialog, reducedMotion, reportProblem, setFocusTarget } from './ui.js';
import { currentMember, panelTitleBlock } from './office.js';

interface ProjectData {
  id: string;
  reference: string;
  name: string;
  stores: { id: string; code: string; name: string }[];
}

interface Snag {
  id: string;
  number: number;
  s: number;
  y: number;
  title: string;
  note: string | null;
  observedOn: string;
  state: 'open' | 'fixed' | 'closed' | 'reopened';
  version: number;
}

interface Viewpoint {
  id: string;
  name: string;
  storeCode: string;
  hasRender: boolean;
  photoId: string | null;
}

export async function siteWalkPanel(panel: HTMLElement, project: ProjectData): Promise<void> {
  panel.append(panelTitleBlock('PL-07', 'Site walk'));
  const viewpoints = ((await api(`/api/projects/${project.id}/viewpoints`)).viewpoints ?? []) as Viewpoint[];
  const selector = h('select', { id: 'viewpoint', class: 'input' }) as HTMLSelectElement;
  selector.setAttribute('aria-label', 'Viewpoint');
  for (const viewpoint of viewpoints) {
    selector.append(h('option', { value: viewpoint.id, text: viewpoint.name }));
  }
  const frame = h('div', { class: 'seam-frame', role: 'group', 'aria-label': 'Intent seam' }) as HTMLElement;
  const canvas = h('canvas', { class: 'seam-canvas', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  frame.append(canvas);
  const handle = h('input', { type: 'range', min: '0', max: '100', step: '1', value: '50', class: 'seam-slider', 'aria-label': 'Seam' }) as HTMLInputElement;
  const snagRail = h('ul', { class: 'snag-rail', role: 'list', 'aria-label': 'Snags' });
  const stickyBar = h('div', { class: 'sticky-action-bar' });
  let snags: Snag[] = [];
  let activeSnagId = '';
  let seam = 50;
  let viewpoint: Viewpoint | null = viewpoints[0] ?? null;
  let renderImage: HTMLImageElement | null = null;
  let photoImage: HTMLImageElement | null = null;

  const canEdit = ['director', 'project_lead', 'designer'].includes(currentMember!.role);
  const canFix = canEdit || currentMember!.role === 'contractor';

  function setSeam(value: number, options: { glide?: boolean } = {}): void {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    if (reducedMotion() || !options.glide) {
      seam = clamped;
      paint();
    } else {
      animateSeam(clamped);
    }
  }

  let glideFrom = 0;
  let glideTo = 0;
  let glideStart = 0;
  let gliding = false;

  function animateSeam(target: number): void {
    glideFrom = seam;
    glideTo = target;
    glideStart = performance.now();
    if (!gliding) {
      gliding = true;
      requestAnimationFrame(stepGlide);
    }
  }

  function stepGlide(now: number): void {
    const progress = Math.min(1, (now - glideStart) / 420);
    const eased = easeOutQuintish(progress);
    seam = Math.round(glideFrom + (glideTo - glideFrom) * eased);
    paint();
    if (progress < 1) {
      requestAnimationFrame(stepGlide);
    } else {
      gliding = false;
    }
  }

  function easeOutQuintish(t: number): number {
    // The one easing: slow start, quick sweep, long gentle settle, no overshoot.
    return 1 - Math.pow(1 - t, 5);
  }

  function paint(): void {
    handle.value = String(seam);
    handle.setAttribute('aria-valuenow', String(seam));
    handle.setAttribute('aria-valuetext', `Render ${seam}%, photo ${100 - seam}%`);
    frame.setAttribute('data-seam', String(seam));
    frame.setAttribute('data-active-snag-id', activeSnagId);
    const context = canvas.getContext('2d');
    if (!context || !renderImage || !photoImage) return;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    // Photo: scaled to cover, centred. Render: same aspect frame.
    const renderAspect = renderImage.naturalWidth / renderImage.naturalHeight || 1.6;
    const targetHeight = height;
    const targetWidth = height * renderAspect;
    const renderX = (width - targetWidth) / 2;
    context.drawImage(renderImage, renderX, 0, targetWidth, targetHeight);
    const photoAspect = photoImage.naturalWidth / photoImage.naturalHeight || 1.6;
    let drawWidth = width;
    let drawHeight = width / photoAspect;
    if (drawHeight < height) {
      drawHeight = height;
      drawWidth = height * photoAspect;
    }
    const photoX = (width - drawWidth) / 2;
    const photoY = (height - drawHeight) / 2;
    const boundary = Math.round((seam / 100) * width);
    context.save();
    context.beginPath();
    context.rect(boundary, 0, width - boundary, height);
    context.clip();
    context.drawImage(photoImage, photoX, photoY, drawWidth, drawHeight);
    context.restore();
    // Snag markers.
    for (const snag of snags) {
      const x = (snag.s / 100) * width;
      const y = (snag.y / 100) * height;
      context.beginPath();
      context.arc(x, y, 13, 0, Math.PI * 2);
      context.fillStyle = snagStateStyle(snag.state);
      context.fill();
      context.strokeStyle = '#1b1b18';
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = '#f7f2e8';
      context.font = 'bold 12px Hanken Grotesk, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(snag.number), x, y);
    }
    // Update near flags and cards.
    for (const snag of snags) {
      const near = Math.abs(snag.s - seam) <= 2;
      const marker = snagRail.querySelector(`[data-snag-id="${snag.id}"]`);
      marker?.setAttribute('data-near', near ? 'true' : 'false');
      const card = snagRail.querySelector(`[data-snag-card="${snag.id}"]`);
      if (card) {
        const nearText = card.querySelector('.near-seam');
        if (nearText) nearText.textContent = near ? 'Near seam' : '';
      }
    }
  }

  function snagStateStyle(state: string): string {
    switch (state) {
      case 'open': return '#8a4a2b';
      case 'fixed': return '#7a8570';
      case 'closed': return '#3b3b35';
      default: return '#8a4a2b';
    }
  }

  async function loadViewpoint(id: string): Promise<void> {
    viewpoint = viewpoints.find((entry) => entry.id === id) ?? null;
    if (!viewpoint) return;
    snags = ((await api(`/api/viewpoints/${viewpoint.id}/snags`)).snags ?? []) as Snag[];
    const loadImage = (src: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
      });
    try {
      [renderImage, photoImage] = await Promise.all([
        loadImage(`/api/viewpoints/${viewpoint.id}/render`),
        loadImage(`/api/viewpoints/${viewpoint.id}/photo`),
      ]);
      canvas.width = 800;
      canvas.height = 500;
      paint();
    } catch {
      canvas.width = 800;
      canvas.height = 500;
      renderImage = null;
      photoImage = null;
      paint();
    }
    renderRail();
  }

  function renderRail(): void {
    clear(snagRail);
    for (const snag of snags) {
      const stateWord = { open: 'Open', fixed: 'Fixed', closed: 'Closed', reopened: 'Reopened' }[snag.state] ?? 'Open';
      const shape = { open: 'ring', fixed: 'square', closed: 'diamond', reopened: 'triangle' }[snag.state] ?? 'ring';
      const near = Math.abs(snag.s - seam) <= 2;
      const card = h(
        'button',
        {
          class: 'snag-card',
          'data-snag-card': snag.id,
          onclick: () => selectSnag(snag),
        },
        h('span', { class: 'snag-line', text: `Snag ${snag.number}` }),
        h('span', { class: 'snag-line small-caps', text: stateWord }),
        h('span', { class: 'snag-line', text: snag.title }),
        h('span', { class: 'near-seam', text: near ? 'Near seam' : '' }),
        h('span', { class: 'shape-badge', 'data-shape': shape, 'aria-hidden': 'true' }),
      );
      card.setAttribute('data-near', near ? 'true' : 'false');
      snagRail.append(card);
    }
    renderMarkers();
  }

  function renderMarkers(): void {
    for (const snag of snags) {
      const stateWord = { open: 'Open', fixed: 'Fixed', closed: 'Closed', reopened: 'Reopened' }[snag.state] ?? 'Open';
      const near = Math.abs(snag.s - seam) <= 2;
      const marker = h(
        'button',
        {
          class: 'snag-marker',
          'data-snag-id': snag.id,
          'data-state': snag.state,
          'data-near': near ? 'true' : 'false',
          style: `left:${snag.s}%; top:${snag.y}%`,
          'aria-label': `Snag ${snag.number} ${stateWord}`,
          text: `${snag.number}`,
        },
      );
      marker.addEventListener('click', () => selectSnag(snag));
      frame.append(marker);
    }
  }

  function selectSnag(snag: Snag): void {
    activeSnagId = snag.id;
    setSeam(snag.s, { glide: true });
    paint();
    // Marker focus and action buttons.
    clear(stickyBar);
    const bar = stickyBar;
    const actions = h('div', { class: 'snag-actions' });
    if (canFix && (snag.state === 'open' || snag.state === 'reopened')) {
      actions.append(
        h('button', {
          class: 'button-secondary',
          text: 'Mark fixed',
          onclick: () => transition(snag, 'fix', 'fixed'),
        }),
      );
    }
    if (canEdit && snag.state === 'fixed') {
      actions.append(
        h('button', { class: 'button-secondary', text: 'Close snag', onclick: () => transition(snag, 'close', 'closed') }),
        h('button', { class: 'button-quiet', text: 'Reopen snag', onclick: () => transition(snag, 'reopen', 'reopened') }),
      );
    }
    bar.append(actions);
    const heading = snagRail.querySelector<HTMLElement>(`[data-snag-card="${snag.id}"]`);
    setFocusTarget(heading);
  }

  async function transition(snag: Snag, action: string, stateWord: string): Promise<void> {
    try {
      await api(`/api/snags/${snag.id}/transitions`, { method: 'POST', body: JSON.stringify({ action }) });
      announce(`Snag ${snag.number} marked ${stateWord}.`);
      await loadViewpoint(viewpoint!.id);
    } catch (error) {
      if (error instanceof ApiError) reportProblem(refusalCopy(error, { number: String(snag.number) }));
    }
  }

  // Pointer behaviour decided by pointer type.
  frame.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      const rect = frame.getBoundingClientRect();
      setSeam(((event.clientX - rect.left) / rect.width) * 100);
      const move = (moveEvent: PointerEvent) => {
        setSeam(((moveEvent.clientX - rect.left) / rect.width) * 100);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    } else {
      // Touch: only after 8px of mostly-horizontal movement.
      const rect = frame.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      const move = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
          dragging = true;
        }
        if (dragging) {
          setSeam(((moveEvent.clientX - rect.left) / rect.width) * 100);
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
  });

  handle.addEventListener('input', () => {
    setSeam(parseInt(handle.value, 10));
  });
  handle.addEventListener('keydown', (event) => {
    const key = event.key;
    if (key === 'ArrowLeft' || key === 'ArrowDown') {
      event.preventDefault();
      setSeam(seam - (event.shiftKey ? 10 : 1));
    } else if (key === 'ArrowRight' || key === 'ArrowUp') {
      event.preventDefault();
      setSeam(seam + (event.shiftKey ? 10 : 1));
    } else if (key === 'Home') {
      event.preventDefault();
      setSeam(0);
    } else if (key === 'End') {
      event.preventDefault();
      setSeam(100);
    } else if (key === 'Enter') {
      event.preventDefault();
      dropSnag();
    }
  });

  function dropSnag(): void {
    if (!canEdit || !viewpoint) return;
    const across = h('input', { type: 'number', min: '0', max: '100', class: 'input', value: String(seam), id: 'field-s' }) as HTMLInputElement;
    across.setAttribute('aria-label', 'Across');
    const height = h('input', { type: 'number', min: '0', max: '100', class: 'input', value: '50', id: 'field-y' }) as HTMLInputElement;
    height.setAttribute('aria-label', 'Height');
    const title = h('input', { type: 'text', class: 'input', id: 'field-title' }) as HTMLInputElement;
    title.setAttribute('aria-label', 'Snag title');
    const note = h('input', { type: 'text', class: 'input', id: 'field-note' }) as HTMLInputElement;
    note.setAttribute('aria-label', 'Note');
    const observedOn = h('input', { type: 'date', class: 'input', value: hkToday(), id: 'field-observedOn' }) as HTMLInputElement;
    observedOn.setAttribute('aria-label', 'Observed on');
    const pin = h('button', { class: 'button-primary', type: 'submit', text: 'Pin snag' });
    const form = h('form', {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        pin.disabled = true;
        pin.textContent = 'Pinning snag…';
        try {
          const result = await api(`/api/viewpoints/${viewpoint!.id}/snags`, {
            method: 'POST',
            body: JSON.stringify({
              s: parseInt(across.value, 10),
              y: parseInt(height.value, 10),
              title: title.value,
              note: note.value,
              observedOn: observedOn.value,
            }),
          });
          const snag = result.snag as Snag;
          announce(`Snag ${snag.number} pinned at ${snag.s}% across, ${snag.y}% down.`);
          dialogHandle.close();
          await loadViewpoint(viewpoint!.id);
          const marker = document.querySelector<HTMLElement>(`[data-snag-id="${snag.id}"]`);
          setFocusTarget(marker);
        } catch (error) {
          pin.disabled = false;
          pin.textContent = 'Pin snag';
          if (error instanceof ApiError) {
            if (error.status === 422) {
              const errors = (error.body.errors ?? {}) as Record<string, string>;
              reportProblem(Object.values(errors)[0] ?? "We couldn't find that. It may have been removed, or you may not have access.");
              return;
            }
            reportProblem(refusalCopy(error));
          }
        }
      },
    });
    const dialogHandle = openDialog('Drop snag', (container) => {
      form.append(
        h('div', { class: 'two-col' },
          h('div', { class: 'field' }, h('label', { for: 'field-s', text: 'Across' }), across),
          h('div', { class: 'field' }, h('label', { for: 'field-y', text: 'Height' }), height)),
        h('div', { class: 'field' }, h('label', { for: 'field-title', text: 'Snag title' }), title),
        h('div', { class: 'field' }, h('label', { for: 'field-note', text: 'Note' }), note),
        h('div', { class: 'field' }, h('label', { for: 'field-observedOn', text: 'Observed on' }), observedOn),
        h('div', { class: 'form-actions' }, pin),
      );
      container.append(form);
    });
  }

  const dropButton = h('button', { class: 'button-primary', text: 'Drop snag here', onclick: () => dropSnag() });
  stickyBar.append(dropButton);
  if (reducedMotion()) {
    stickyBar.append(
      h('button', { class: 'button-quiet', text: 'Render', onclick: () => setSeam(100) }),
      h('button', { class: 'button-quiet', text: 'Split', onclick: () => setSeam(50) }),
      h('button', { class: 'button-quiet', text: 'Photo', onclick: () => setSeam(0) }),
    );
  }

  selector.addEventListener('change', () => loadViewpoint(selector.value));
  panel.append(h('div', { class: 'viewpoint-row' }, h('label', { for: 'viewpoint', text: 'Viewpoint' }), selector), frame, handle, snagRail, stickyBar);
  if (viewpoints.length > 0) {
    await loadViewpoint(viewpoints[0].id);
  } else if (canEdit) {
    panel.append(h('p', { text: 'No viewpoints yet. Create one to walk the site.' }));
  }
  void dateText;
}
