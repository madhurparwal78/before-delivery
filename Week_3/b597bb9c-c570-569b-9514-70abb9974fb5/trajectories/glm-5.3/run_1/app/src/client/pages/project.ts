import { api, type OpResponse, type ProjectBundle } from '../api';
import { el, announce, copy, activityFor, activity, layoutMode, reducedMotion } from '../ui';
import { renderBand, person } from '../main';
import type { Project, Row, Clip, Caption, Comment, Cut, ExportRecord, Allowance, Person } from '../../shared/types';
import { timecode, oneSecond } from '../../shared/frames';
import { propertyValue, baseDefaults, fittedBox, textBox, layerValuesAt, type Keyframe } from '../../shared/keyframes';

/** The project page: the full editor, the two-pane review, the review list. */
export async function renderProject(projectId: string, root: HTMLElement): Promise<HTMLElement> {
  const main = el('main', null);
  let bundle: ProjectBundle;
  try {
    bundle = await api.project(projectId);
  } catch {
    main.append(el('p', { text: 'Nothing here. It may have been removed or you may not have access.' }));
    return main;
  }
  let project = bundle.project;
  let rows = bundle.rows;
  let clips = bundle.clips;
  let captions = bundle.captions;
  const me = person();
  const role = project.role;
  const canEdit = role === 'owner' || role === 'editor';
  const isOwner = role === 'owner';

  // View state, carried by the address.
  const view = readAddress();
  let playhead = view.frame;
  let zoomLevel = view.zoom;
  let currentClipId: string | null = view.clip;
  const selection = new Set<string>();
  let panel: 'inspector' | 'comments' | 'exports' | 'none' = view.panel;
  let lastVersion = project.version;

  const notices = el('div', { role: 'status', 'aria-label': 'Notices', id: 'status-notices', class: 'notices' });
  const activityRegion = el('div', { role: 'status', 'aria-label': 'Project activity', id: 'status-project-activity', class: 'visually-hidden', 'aria-live': 'polite' });

  main.append(notices, activityRegion, renderBand(root));
  const band = main.querySelector('header')!;
  const projectBand = el('div', { style: 'display:flex; gap:14px; flex-wrap:wrap; align-items:center; padding: 6px 14px;' });
  const titleSpan = el('span', { text: project.title });
  const rateSpan = el('span', { class: 'muted', text: project.frame_rate });
  const aspectSpan = el('span', { class: 'muted', text: project.aspect_ratio });
  const playheadTc = el('span', { 'data-playhead-timecode': '' });
  main.append(projectBand);

  const layout = layoutMode(window.innerWidth);
  main.setAttribute('data-layout', layout);

  // ---- Timeline canvas ----
  const PX_PER_FRAME = [0.25, 0.5, 1, 2, 4, 8];
  let firstFrame = 0;

  const timeline = el('section', { role: 'region', 'aria-label': 'Timeline' });
  const zoomIn = el('button', { class: 'btn', text: 'Zoom in' });
  const zoomOut = el('button', { class: 'btn', text: 'Zoom out' });
  const canvasHolder = el('div', { class: 'timeline-canvas', tabindex: '0' });
  const canvasInner = el('div', { class: 'timeline-inner' });
  canvasHolder.append(canvasInner);
  timeline.append(zoomIn, zoomOut, canvasHolder);

  function totalFrames(): number {
    let total = 0;
    for (const clip of clips) total = Math.max(total, clip.end_frame);
    for (const cap of captions) total = Math.max(total, cap.end_frame);
    return total;
  }

  function pxPerFrame(): number {
    return PX_PER_FRAME[zoomLevel] ?? 1;
  }

  function visibleFrames(): number {
    return Math.max(1, Math.floor(canvasHolder.clientWidth / pxPerFrame()));
  }

  function drawTimeline(): void {
    canvasHolder.setAttribute('data-px-per-frame', String(pxPerFrame()));
    canvasHolder.setAttribute('data-first-frame', String(firstFrame));
    canvasHolder.setAttribute('data-zoom-level', String(zoomLevel));
    canvasHolder.setAttribute('data-visible-frames', String(visibleFrames()));
    const scale = pxPerFrame();
    const width = Math.max(canvasHolder.clientWidth, (totalFrames() + 40) * scale);
    canvasInner.style.width = `${width}px`;
    canvasInner.style.minHeight = `${rows.length * 44 + 20}px`;
    canvasInner.textContent = '';
    const rowPos = new Map(rows.map((r) => [r.id, r.position]));
    const sortedRows = [...rows].sort((a, b) => a.position - b.position);
    sortedRows.forEach((row, index) => {
      const top = index * 44;
      const label = el('button', { class: 'row-label', text: `Row ${row.name}`, style: `position:absolute; top:${top}px; left:0; background:none; border:none; color:inherit;` });
      canvasInner.append(label);
      for (const clip of clips.filter((c) => c.row_id === row.id)) {
        const left = (clip.start_frame - firstFrame) * scale;
        const blockWidth = Math.max(2, (clip.end_frame - clip.start_frame) * scale);
        const accessible = timecode(clip.start_frame, project.frame_rate) + ' to ' + timecode(clip.end_frame, project.frame_rate);
        const block = el('button', {
          class: `clip-block${clip.hidden ? ' hidden-clip' : ''}${selection.has(clip.id) ? ' pending' : ''}`,
          'data-clip-id': clip.id,
          'data-row-id': clip.row_id,
          'data-start-frame': String(clip.start_frame),
          'data-end-frame': String(clip.end_frame),
          'data-hidden': String(clip.hidden),
          'data-group-id': clip.group_id ?? '',
          style: `left:${left}px; top:${top + 18}px; width:${blockWidth}px; height:24px;`,
        });
        block.setAttribute('aria-label', `${clip.name}, ${accessible}`);
        block.append(el('span', { text: clip.name }));
        canvasInner.append(block);
      }
      for (const cap of captions.filter((c) => c.row_id === row.id)) {
        const left = (cap.start_frame - firstFrame) * scale;
        const blockWidth = Math.max(2, (cap.end_frame - cap.start_frame) * scale);
        const order = [...captions].sort((a, b) => a.start_frame - b.start_frame).findIndex((c) => c.id === cap.id) + 1;
        const capBlock = el('button', {
          class: 'caption-block',
          'data-caption-id': cap.id,
          style: `left:${left}px; top:${top + 18}px; width:${blockWidth}px; height:20px;`,
        });
        capBlock.setAttribute('aria-label', `Caption ${order}, ${timecode(cap.start_frame, project.frame_rate)} to ${timecode(cap.end_frame, project.frame_rate)}`);
        canvasInner.append(capBlock);
      }
      void rowPos;
    });
    for (const marker of project.markers) {
      const left = (marker.frame - firstFrame) * scale;
      canvasInner.append(el('div', { class: 'marker', 'data-marker-frame': String(marker.frame), style: `left:${left}px; top:0; height:100%;` }));
    }
    const playheadLine = el('div', { class: 'playhead', 'data-playhead-frame': String(playhead), style: `left:${(playhead - firstFrame) * scale}px; top:0; height:100%;` });
    canvasInner.append(playheadLine);
    for (const remote of remotePlayheads) {
      canvasInner.append(el('div', { class: 'remote-playhead', 'data-remote-playhead': remote.name, style: `left:${(remote.frame - firstFrame) * scale}px; top:0; height:100%;` }));
    }
    const group = currentGroup();
    if (group !== null) {
      const members = clips.filter((c) => c.group_id === group);
      if (members.length > 0) {
        const start = Math.min(...members.map((m) => m.start_frame));
        const end = Math.max(...members.map((m) => m.end_frame));
        const rowIds = members.map((m) => m.row_id);
        const topRow = rows.find((r) => r.id === rowIds[0]);
        const bottomRow = rows.find((r) => r.id === rowIds[rowIds.length - 1]);
        const topIndex = sortedRows.findIndex((r) => r.id === topRow?.id);
        const bottomIndex = sortedRows.findIndex((r) => r.id === bottomRow?.id);
        canvasInner.append(el('div', {
          class: 'group-outline',
          'data-group-outline': group,
          'data-group-first-row': topRow?.id ?? '',
          'data-group-last-row': bottomRow?.id ?? '',
          style: `left:${(start - firstFrame) * scale}px; top:${Math.max(0, topIndex) * 44}px; width:${(end - start) * scale}px; height:${(bottomIndex - Math.max(0, topIndex) + 1) * 44}px;`,
        }));
      }
    }
  }

  function currentGroup(): string | null {
    const clip = clips.find((c) => c.id === currentClipId);
    return clip?.group_id ?? null;
  }

  // ---- Stage ----
  const stage = el('section', { role: 'region', 'aria-label': 'Stage', class: 'stage' });

  interface RemotePlayhead { name: string; frame: number }
  const remotePlayheads: RemotePlayhead[] = [];

  /** The layer's fitted box in project pixels, by the one keyframe rule. */
  function layerBox(clip: Clip, frame: number): { x: number; y: number; width: number; height: number; scale: number; rotation: number; opacity: number } {
    const defaults = baseDefaults(project.width, project.height);
    const values = layerValuesAt(clip.keyframes, Math.max(0, frame - clip.start_frame), defaults);
    let boxW: number;
    let boxH: number;
    if (clip.kind === 'text') {
      const tb = textBox(project.width, project.height);
      boxW = tb.width;
      boxH = tb.height;
    } else if (clip.media_id !== null && mediaDims.has(clip.media_id)) {
      const dims = mediaDims.get(clip.media_id)!;
      const ratio = Math.min(project.width / dims.width, project.height / dims.height);
      boxW = ratio * dims.width;
      boxH = ratio * dims.height;
    } else {
      boxW = project.width;
      boxH = project.height;
    }
    const scaled = fittedBox(boxW, boxH, project.width, project.height, values.scale, values.x, values.y);
    return { x: scaled.x, y: scaled.y, width: scaled.width, height: scaled.height, scale: values.scale, rotation: values.rotation, opacity: values.opacity };
  }

  function drawStage(frame: number, mode: 'playhead' | 'skim'): void {
    stage.textContent = '';
    stage.setAttribute('data-stage-mode', mode);
    stage.setAttribute('data-stage-frame', String(frame));
    const drawn = clips
      .filter((clip) => !clip.hidden && frame >= clip.start_frame && frame < clip.end_frame)
      .sort((a, b) => (rows.find((r) => r.id === b.row_id)?.position ?? 0) - (rows.find((r) => r.id === a.row_id)?.position ?? 0));
    const editable = layout === 'editor' && mode === 'playhead' && canEdit;
    for (const clip of drawn) {
      const row = rows.find((r) => r.id === clip.row_id);
      const unlocked = row?.locked !== true;
      const box = el(editable && unlocked ? 'button' : 'div', {
        class: 'layer',
        'data-layer-box': clip.id,
      });
      const info = layerBox(clip, frame);
      box.setAttribute('data-x', info.x.toFixed(2));
      box.setAttribute('data-y', info.y.toFixed(2));
      box.setAttribute('data-width', info.width.toFixed(2));
      box.setAttribute('data-height', info.height.toFixed(2));
      box.setAttribute('data-scale', info.scale.toFixed(2));
      box.setAttribute('data-rotation', info.rotation.toFixed(2));
      box.setAttribute('data-opacity', info.opacity.toFixed(2));
      box.style.left = `${(info.x / project.width) * 100}%`;
      box.style.top = `${(info.y / project.height) * 100}%`;
      box.style.width = `${(info.width / project.width) * 100}%`;
      box.style.height = `${(info.height / project.height) * 100}%`;
      box.style.opacity = String(info.opacity / 100);
      if (clip.kind === 'text') {
        box.style.background = `#${clip.box_colour ?? '000000'}`;
        box.style.color = `#${clip.text_colour ?? 'ffffff'}`;
        box.style.fontWeight = String(clip.font_weight ?? 400);
        box.append(el('span', { text: clip.text ?? '' }));
      } else if (clip.media_id !== null) {
        box.style.background = `#${(mediaDims.get(clip.media_id)?.sha ?? '000000').slice(0, 6)}`;
      }
      if (editable && unlocked) {
        box.setAttribute('aria-label', `Layer ${clip.name}`);
        for (const handle of ['nw', 'ne', 'se', 'sw'] as const) {
          const corner = el('button', { class: 'handle', 'data-handle': handle });
          corner.setAttribute('aria-label', `${handle === 'nw' ? 'Top left' : handle === 'ne' ? 'Top right' : handle === 'se' ? 'Bottom right' : 'Bottom left'} handle ${clip.name}`);
          corner.style.position = 'absolute';
          corner.style.width = '12px';
          corner.style.height = '12px';
          corner.style.left = handle === 'nw' || handle === 'sw' ? '-6px' : 'auto';
          corner.style.right = handle === 'ne' || handle === 'se' ? '-6px' : 'auto';
          corner.style.top = handle === 'nw' || handle === 'ne' ? '-6px' : 'auto';
          corner.style.bottom = handle === 'sw' || handle === 'se' ? '-6px' : 'auto';
          corner.style.background = 'var(--ink)';
          corner.addEventListener('pointerdown', (event) => startScale(event, clip, corner));
          box.append(corner);
        }
        box.addEventListener('pointerdown', (event) => {
          if ((event.target as HTMLElement).hasAttribute('data-handle')) return;
          startMove(event as PointerEvent, clip, box);
        });
        (box as HTMLButtonElement).addEventListener('keydown', (keyEvent: KeyboardEvent) => {
          const step = keyEvent.shiftKey ? 10 : 1;
          if (keyEvent.key === 'ArrowLeft' || keyEvent.key === 'ArrowRight' || keyEvent.key === 'ArrowUp' || keyEvent.key === 'ArrowDown') {
            keyEvent.preventDefault();
            const info2 = layerBox(clip, playhead);
            const dx = keyEvent.key === 'ArrowLeft' ? -step : keyEvent.key === 'ArrowRight' ? step : 0;
            const dy = keyEvent.key === 'ArrowUp' ? -step : keyEvent.key === 'ArrowDown' ? step : 0;
            void sendOp({ type: 'set_layer', clip_id: clip.id, frame: playhead - clip.start_frame, x: info2.x + info2.width / 2 + dx, y: info2.y + info2.height / 2 + dy }).then(() => refreshAll());
            return;
          }
          if (keyEvent.key === '[' || keyEvent.key === ']') {
            keyEvent.preventDefault();
            const info2 = layerBox(clip, playhead);
            const delta = keyEvent.key === ']' ? step : -step;
            void sendOp({ type: 'set_layer', clip_id: clip.id, frame: playhead - clip.start_frame, scale: Math.max(1, Math.min(1000, info2.scale + delta)) }).then(() => refreshAll());
            return;
          }
          if (keyEvent.key === 'Escape') {
            keyEvent.preventDefault();
            const block = canvasInner.querySelector(`[data-clip-id="${clip.id}"]`) as HTMLElement | null;
            block?.focus();
          }
        });
      }
      stage.append(box);
    }
  }

  /** Dragging a layer body moves it; snapping near the centre and edges. */
  function startMove(event: PointerEvent, clip: Clip, box: HTMLElement): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const startInfo = layerBox(clip, playhead);
    const startX = event.clientX;
    const startY = event.clientY;
    const stageRect = stage.getBoundingClientRect();
    const projectPerPixel = project.width / stageRect.width;
    const centreX0 = startInfo.x + startInfo.width / 2;
    const centreY0 = startInfo.y + startInfo.height / 2;
    let guide: string | null = null;
    const onMove = (move: PointerEvent): void => {
      let x = centreX0 + (move.clientX - startX) * projectPerPixel;
      let y = centreY0 + (move.clientY - startY) * projectPerPixel;
      guide = null;
      const snap = (target: number, value: number, name: string): boolean => {
        if (Math.abs(target - value) <= 8) { value = target; guide = name; return true; }
        return false;
      };
      if (!snap(project.width / 2, x, 'centre-x')) {
        if (Math.abs(x - startInfo.width / 2) <= 8) { x = startInfo.width / 2; guide = 'left'; }
        else if (Math.abs(x + startInfo.width / 2 - project.width) <= 8) { x = project.width - startInfo.width / 2; guide = 'right'; }
      }
      if (!snap(project.height / 2, y, 'centre-y')) {
        if (Math.abs(y - startInfo.height / 2) <= 8) { y = startInfo.height / 2; guide = 'top'; }
        else if (Math.abs(y + startInfo.height / 2 - project.height) <= 8) { y = project.height - startInfo.height / 2; guide = 'bottom'; }
      }
      box.style.left = `${((x - startInfo.width / 2) / project.width) * 100}%`;
      box.style.top = `${((y - startInfo.height / 2) / project.height) * 100}%`;
      box.setAttribute('data-x', String(x - startInfo.width / 2));
      box.setAttribute('data-y', String(y - startInfo.height / 2));
      showStageGuide(guide);
      pendingLayer = { clip, x, y, scale: startInfo.scale };
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      hideStageGuide();
      if (pendingLayer !== null) {
        const info = layerBox(clip, playhead);
        const centreX = pendingLayer.x;
        const centreY = pendingLayer.y;
        const before = layerBox(clip, playhead);
        const beforeX = before.x + before.width / 2;
        const beforeY = before.y + before.height / 2;
        pendingLayer = null;
        if (Math.round(centreX) !== Math.round(beforeX) || Math.round(centreY) !== Math.round(beforeY)) {
          void sendOp({ type: 'set_layer', clip_id: clip.id, frame: playhead - clip.start_frame, x: Math.round(centreX), y: Math.round(centreY) }).then(() => refreshAll());
        }
        void info;
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /** Dragging a corner handle scales about the box centre. */
  function startScale(event: PointerEvent, clip: Clip, corner: HTMLElement): void {
    event.preventDefault();
    event.stopPropagation();
    const startInfo = layerBox(clip, playhead);
    const centreX = startInfo.x + startInfo.width / 2;
    const centreY = startInfo.y + startInfo.height / 2;
    const stageRect = stage.getBoundingClientRect();
    const toProject = (clientX: number, clientY: number): { x: number; y: number } => ({
      x: ((clientX - stageRect.left) / stageRect.width) * project.width,
      y: ((clientY - stageRect.top) / stageRect.height) * project.height,
    });
    const start = toProject(event.clientX, event.clientY);
    const startDistance = Math.max(1, Math.hypot(start.x - centreX, start.y - centreY));
    const onMove = (move: PointerEvent): void => {
      const now = toProject(move.clientX, move.clientY);
      const distance = Math.max(1, Math.hypot(now.x - centreX, now.y - centreY));
      let scale = (startInfo.scale * distance) / startDistance;
      scale = Math.max(1, Math.min(1000, Math.round(scale * 100) / 100));
      box_scale = scale;
      pendingLayer = { clip, x: centreX, y: centreY, scale };
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (pendingLayer !== null && Math.round(pendingLayer.scale * 100) !== Math.round(startInfo.scale * 100)) {
        void sendOp({ type: 'set_layer', clip_id: clip.id, frame: playhead - clip.start_frame, scale: pendingLayer.scale }).then(() => refreshAll());
      }
      pendingLayer = null;
      void corner;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  let pendingLayer: { clip: Clip; x: number; y: number; scale: number } | null = null;
  let box_scale = 100;

  function showStageGuide(name: string | null): void {
    const existing = stage.querySelector('[data-stage-guide]');
    existing?.remove();
    if (name === null) return;
    const guide = el('div', { class: 'guide', 'data-stage-guide': name });
    if (name === 'centre-x') {
      guide.style.left = '50%';
      guide.style.top = '0';
      guide.style.width = '1px';
      guide.style.height = '100%';
    } else if (name === 'centre-y') {
      guide.style.left = '0';
      guide.style.top = '50%';
      guide.style.height = '1px';
      guide.style.width = '100%';
    } else if (name === 'left' || name === 'right') {
      guide.style.left = name === 'left' ? '0' : '100%';
      guide.style.top = '0';
      guide.style.width = '1px';
      guide.style.height = '100%';
    } else {
      guide.style.top = name === 'top' ? '0' : '100%';
      guide.style.left = '0';
      guide.style.height = '1px';
      guide.style.width = '100%';
    }
    stage.append(guide);
  }

  function hideStageGuide(): void {
    stage.querySelector('[data-stage-guide]')?.remove();
  }

  // Media dimensions feed the fitted boxes; the checksum gives the colour.
  const mediaDims = new Map<string, { width: number; height: number; sha: string }>();
  void api.media('').then((media) => {
    for (const item of media.items) {
      if (item.width !== null && item.height !== null) {
        mediaDims.set(item.id, { width: item.width, height: item.height, sha: item.sha256 });
      }
    }
    draw();
  }).catch(() => undefined);

  // ---- Inspector ----
  const inspector = el('section', { role: 'region', 'aria-label': 'Inspector' });

  function drawInspector(frame: number): void {
    inspector.textContent = '';
    inspector.append(el('h3', { text: 'Inspector' }));
    const clip = clips.find((c) => c.id === currentClipId);
    if (clip === undefined) {
      inspector.append(el('p', { class: 'muted', text: 'No clip selected.' }));
      return;
    }
    const defaults = baseDefaults(project.width, project.height);
    const values = layerValuesAt(clip.keyframes, Math.max(0, frame - clip.start_frame), defaults);
    const table = el('table');
    for (const prop of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) {
      const row = el('tr');
      row.append(el('td', { class: 'muted', text: prop }), el('td', { 'data-prop': prop, text: values[prop].toFixed(2) }));
      table.append(row);
    }
    inspector.append(table);
    if (canEdit) {
      const kitSelect = el('select', { 'aria-label': 'Brand kit' });
      kitSelect.append(el('option', { value: '', text: 'Brand kit' }));
      const apply = el('button', { class: 'btn', text: 'Apply kit' });
      apply.addEventListener('click', () => {
        void (async () => {
          if (kitSelect.value === '') return;
          const kits = await api.kits();
          const kit = kits.items.find((k) => k.id === kitSelect.value);
          if (kit === undefined) return;
          await sendOp({ type: 'apply_kit', kit_id: kit.id, text_colour: kit.text_colour, box_colour: kit.box_colour, font_weight: kit.font_weight });
          await refreshAll();
        })();
      });
      void api.kits().then((kits) => {
        for (const kit of kits.items) {
          kitSelect.append(el('option', { value: kit.id, text: kit.name }));
        }
      });
      inspector.append(kitSelect, apply);
    }
  }

  // ---- Comments ----
  const commentsPanel = el('section', { role: 'region', 'aria-label': 'Comments' });
  const noteBox = el('textarea', { 'aria-label': 'Note', rows: '3' });
  const noteCount = el('span', { 'data-count': '0', class: 'muted' });
  const visibilityGroup = el('div', { role: 'radiogroup', 'aria-label': 'Who can see this' });
  const teamRadio = el('input', { type: 'radio', name: 'visibility', value: 'team' });
  const reviewRadio = el('input', { type: 'radio', name: 'visibility', value: 'review' });
  teamRadio.checked = true;
  visibilityGroup.append(
    el('label', null, teamRadio, document.createTextNode(' Team only')),
    el('label', null, reviewRadio, document.createTextNode(' Client can see')),
  );
  const pinNote = el('button', { class: 'btn', text: 'Pin note' });
  let replyTo: string | null = null;

  function noteCodePoints(): number {
    let n = 0;
    for (const _ of noteBox.value) n++;
    return n;
  }

  noteBox.addEventListener('input', () => {
    const used = noteCodePoints();
    noteCount.textContent = `${used} of 2,000`;
    pinNote.disabled = used > 2000 || used < 1;
    scheduleDraft();
  });

  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleDraft(): void {
    if (draftTimer !== null) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      void api.saveDraft(projectId, {
        body: noteBox.value,
        frame: playhead,
        row_id: clips.find((c) => c.id === currentClipId)?.row_id ?? null,
        clip_id: currentClipId,
        visibility: reviewRadio.checked ? 'review' : 'team',
        parent_id: replyTo,
      }).catch(() => undefined);
    }, 900);
  }

  pinNote.addEventListener('click', () => {
    void (async () => {
      announce('Notices', copy.pinning());
      try {
        const clip = clips.find((c) => c.id === currentClipId);
        const comment = await api.addComment(projectId, {
          body: noteBox.value,
          frame: playhead,
          row_id: clip?.row_id ?? null,
          clip_id: clip?.id ?? null,
          visibility: reviewRadio.checked ? 'review' : 'team',
          parent_id: replyTo,
        });
        noteBox.value = '';
        noteCount.textContent = '0 of 2,000';
        announce('Notices', copy.notePinned(timecode(comment.pin.live_frame, project.frame_rate)));
        await refreshComments();
      } catch (err) {
        const body = (err as { body?: { message?: string } }).body;
        announce('Notices', body?.message ?? 'Check the highlighted fields.');
      }
    })();
  });

  async function refreshComments(): Promise<void> {
    const { items } = await api.comments(projectId);
    commentsPanel.textContent = '';
    commentsPanel.append(el('h3', { text: 'Comments' }));
    if (items.length === 0) {
      commentsPanel.append(el('p', { class: 'muted', text: 'No notes on this cut yet.' }));
      return;
    }
    const list = el('ul', { class: 'list' });
    for (const item of items as Comment[]) {
      const li = el('li', null, el('span', { text: `${item.author_name} at ${timecode(item.pin.live_frame, project.frame_rate)}: ${item.body}` }));
      const reply = el('button', { class: 'btn', text: 'Reply' });
      reply.addEventListener('click', () => {
        replyTo = item.id;
        noteBox.focus();
      });
      li.append(reply);
      list.append(li);
    }
    commentsPanel.append(list);
  }

  // ---- Exports ----
  const exportsPanel = el('section', { role: 'region', 'aria-label': 'Exports' });
  async function refreshExports(): Promise<void> {
    const { items } = await api.exports(projectId);
    exportsPanel.textContent = '';
    exportsPanel.append(el('h3', { text: 'Exports' }));
    if (items.length === 0) {
      exportsPanel.append(el('p', { class: 'muted', text: 'No exports yet.' }));
      return;
    }
    const table = el('table');
    for (const item of items as ExportRecord[]) {
      const row = el('tr');
      const state = item.stale ? `Stale · from ${item.cut_name}` : item.state;
      row.append(el('td', { text: `${item.cut_name} ${item.size}p ${item.progress}%` }), el('td', { class: 'muted', text: state }));
      const cancel = el('td');
      if (item.state === 'queued' || item.state === 'running') {
        const cancelButton = el('button', { class: 'btn', text: `Cancel export ${item.cut_name} ${item.size}p` });
        cancelButton.addEventListener('click', () => {
          void (async () => {
            announce('Notices', copy.cancelling());
            await api.cancelExport(item.id);
            announce('Notices', copy.exportCancelled());
            await refreshExports();
          })();
        });
        cancel.append(cancelButton);
      }
      const manifest = el('td');
      if (item.state === 'done') {
        const link = el('a', { href: `/api/exports/${item.id}/manifest`, text: `Manifest ${item.cut_name} ${item.size}p` });
        manifest.append(link);
      }
      row.append(cancel, manifest);
      table.append(row);
    }
    exportsPanel.append(table);
  }

  // ---- Band controls ----
  const bandControls = el('div', { style: 'display:flex; gap:10px; flex-wrap:wrap;' });
  if (isOwner) {
    const exportBtn = el('button', { class: 'btn primary', text: 'Export' });
    const nameCutBtn = el('button', { class: 'btn', text: 'Name cut' });
    const shareBtn = el('button', { class: 'btn', text: 'Share' });
    const frameSizeBtn = el('button', { class: 'btn', text: 'Frame size' });
    const membersBtn = el('button', { class: 'btn', text: 'Members' });
    exportBtn.addEventListener('click', () => openExportDialog());
    nameCutBtn.addEventListener('click', () => openNameCutDialog());
    shareBtn.addEventListener('click', () => openShareDialog());
    frameSizeBtn.addEventListener('click', () => openFrameSizeDialog());
    membersBtn.addEventListener('click', () => openMembersDialog());
    bandControls.append(exportBtn, nameCutBtn, shareBtn, frameSizeBtn, membersBtn);
  }
  const compareBtn = el('button', { class: 'btn', text: 'Compare cuts' });
  compareBtn.addEventListener('click', () => openCompareDialog());
  bandControls.append(compareBtn);
  if (isOwner || canEdit) {
    const captionsBtn = el('button', { class: 'btn', text: 'Captions' });
    captionsBtn.addEventListener('click', () => openCaptionsDialog());
    const undoBtn = el('button', { class: 'btn', text: 'Undo' });
    const redoBtn = el('button', { class: 'btn', text: 'Redo' });
    undoBtn.addEventListener('click', () => { void doUndo(undoBtn); });
    redoBtn.addEventListener('click', () => { void doRedo(redoBtn); });
    bandControls.append(captionsBtn, undoBtn, redoBtn);
  }
  projectBand.append(titleSpan, rateSpan, aspectSpan, playheadTc, bandControls);

  // ---- Ops ----
  async function sendOp(body: Record<string, unknown>): Promise<OpResponse | null> {
    if (!canEdit) {
      announce('Notices', 'Your role on this project cannot do that.');
      return null;
    }
    const opId = `op-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const response = await api.sendOp(projectId, { ...body, op_id: opId, base_version: lastVersion });
    lastVersion = response.version;
    return response;
  }

  async function doUndo(button: HTMLElement): Promise<void> {
    try {
      const response = await api.undo(projectId, `undo-${Date.now().toString(36)}`);
      lastVersion = response.version;
      await refreshAll();
    } catch (err) {
      const body = (err as { body?: { error?: string; message?: string } }).body;
      announce('Notices', body?.message ?? 'Nothing to undo.');
      void button;
    }
  }

  async function doRedo(button: HTMLElement): Promise<void> {
    try {
      const response = await api.redo(projectId, `redo-${Date.now().toString(36)}`);
      lastVersion = response.version;
      await refreshAll();
    } catch (err) {
      const body = (err as { body?: { error?: string; message?: string } }).body;
      announce('Notices', body?.message ?? 'Nothing to redo.');
      void button;
    }
  }

  async function refreshAll(): Promise<void> {
    const fresh = await api.project(projectId);
    project = fresh.project;
    rows = fresh.rows;
    clips = fresh.clips;
    captions = fresh.captions;
    lastVersion = project.version;
    draw();
  }

  function draw(): void {
    playheadTc.textContent = timecode(playhead, project.frame_rate);
    playheadTc.setAttribute('data-playhead-timecode', timecode(playhead, project.frame_rate));
    rateSpan.textContent = project.frame_rate;
    aspectSpan.textContent = project.aspect_ratio;
    titleSpan.textContent = project.title;
    if (layout === 'editor') {
      drawTimeline();
      drawStage(playhead, 'playhead');
      drawInspector(playhead);
    }
  }

  // ---- Keyboard on the timeline ----
  canvasHolder.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const clip = clips.find((c) => c.id === currentClipId);
    const key = event.key;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) void doRedo(zoomOut);
      else void doUndo(zoomOut);
      return;
    }
    if (meta && key.toLowerCase() === 'g') {
      event.preventDefault();
      if (clip === undefined) return;
      if (event.shiftKey) {
        void sendOp({ type: 'ungroup', group_id: clip.group_id }).then(() => refreshAll());
      } else {
        const ids = [clip.id, ...selection];
        void sendOp({ type: 'group', clip_ids: ids }).then(() => refreshAll());
      }
      return;
    }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (loupePinned) {
        event.preventDefault();
        loupeFrame += (key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? oneSecond(project.frame_rate) : 1);
        showLoupe(loupeFrame, true);
        return;
      }
      if (clip === undefined) return;
      if (event.altKey) {
        event.preventDefault();
        const rowPosition = rows.find((r) => r.id === clip.row_id)?.position ?? 1;
        void sendOp({ type: 'reorder_row', row_id: clip.row_id, position: rowPosition - 1 }).then(() => refreshAll());
        return;
      }
      event.preventDefault();
      const step = event.shiftKey ? oneSecond(project.frame_rate) : 1;
      const start = clip.start_frame + (key === 'ArrowRight' ? step : -step);
      void sendOp({ type: 'move', clip_id: clip.id, start_frame: Math.max(0, start), row_id: clip.row_id })
        .then((response) => {
          if (response === null) return;
          if (response.stopped !== null) {
            announce('Notices', copy.stopped(timecode(response.stopped.at_frame, project.frame_rate), response.stopped.reason));
          }
          return refreshAll();
        });
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      const clip2 = clips.find((c) => c.id === currentClipId);
      if (clip2 === undefined) return;
      const sortedRows = [...rows].sort((a, b) => a.position - b.position);
      const index = sortedRows.findIndex((r) => r.id === clip2.row_id);
      const nextRow = key === 'ArrowUp' ? sortedRows[index - 1] : sortedRows[index + 1];
      if (nextRow === undefined) return;
      const candidates = clips.filter((c) => c.row_id === nextRow.id);
      let nearest: Clip | undefined = candidates[0];
      if (nearest !== undefined) {
        for (const candidate of candidates) {
          if (Math.abs(candidate.start_frame - clip2.start_frame) < Math.abs(nearest.start_frame - clip2.start_frame)) {
            nearest = candidate;
          }
        }
      }
      if (nearest !== undefined) setCurrentClip(nearest.id);
      return;
    }
    switch (key.toLowerCase()) {
      case 's': {
        if (clip === undefined) return;
        event.preventDefault();
        void sendOp({ type: 'split', clip_id: clip.id, at_frame: playhead }).then(() => refreshAll());
        return;
      }
      case 'h': {
        if (clip === undefined) return;
        event.preventDefault();
        void sendOp({ type: 'set_hidden', clip_id: clip.id, hidden: !clip.hidden }).then(() => refreshAll());
        return;
      }
      case 'l': {
        event.preventDefault();
        pinLoupe();
        return;
      }
      case 'm': {
        event.preventDefault();
        void sendOp({ type: 'add_marker', frame: playhead, label: '' }).then(() => refreshAll());
        return;
      }
      case 'i': {
        event.preventDefault();
        rangeIn = playhead;
        return;
      }
      case 'o': {
        event.preventDefault();
        if (rangeIn === playhead) {
          rangeIn = null;
          rangeOut = null;
        } else {
          rangeOut = playhead;
        }
        return;
      }
      case ' ': {
        event.preventDefault();
        playing = !playing;
        if (playing) startPlayback();
        return;
      }
      case ',': {
        event.preventDefault();
        setPlayhead(playhead - 1, false);
        return;
      }
      case '.': {
        event.preventDefault();
        setPlayhead(playhead + 1, false);
        return;
      }
      case '+': case '=': {
        event.preventDefault();
        setZoom(zoomLevel + 1);
        return;
      }
      case '-': {
        event.preventDefault();
        setZoom(zoomLevel - 1);
        return;
      }
      case 'enter': {
        if (loupeVisible) {
          event.preventDefault();
          setPlayhead(loupeFrame, false);
          closeLoupe();
          return;
        }
        if (clip !== undefined) {
          event.preventDefault();
          if (selection.has(clip.id)) selection.delete(clip.id);
          else selection.add(clip.id);
        }
        return;
      }
      case 'escape': {
        if (loupeVisible) {
          event.preventDefault();
          closeLoupe();
        }
        return;
      }
      case 'home': {
        event.preventDefault();
        setPlayhead(0, false);
        firstFrame = 0;
        const first = timelineOrder()[0];
        if (first !== undefined) setCurrentClip(first.id);
        draw();
        return;
      }
      case 'end': {
        event.preventDefault();
        const last = Math.max(0, totalFrames() - 1);
        setPlayhead(last, false);
        firstFrame = Math.max(0, last - visibleFrames() + 1);
        const ordered = timelineOrder();
        const lastClip = ordered[ordered.length - 1];
        if (lastClip !== undefined) setCurrentClip(lastClip.id);
        draw();
        return;
      }
      case 'delete': case 'backspace': {
        if (clip === undefined) return;
        event.preventDefault();
        void sendOp({ type: 'remove', clip_id: clip.id, ripple: event.shiftKey }).then(() => {
          const next = clipsOnRow(clip.row_id).find((c) => c.id !== clip.id);
          currentClipId = next?.id ?? null;
          return refreshAll();
        });
        return;
      }
      default:
        return;
    }
  });

  function timelineOrder(): Clip[] {
    const rowPos = new Map(rows.map((r) => [r.id, r.position]));
    return [...clips].sort((a, b) =>
      a.start_frame - b.start_frame ||
      (rowPos.get(a.row_id) ?? 0) - (rowPos.get(b.row_id) ?? 0) ||
      (a.id < b.id ? -1 : 1));
  }

  function clipsOnRow(rowId: string): Clip[] {
    return clips.filter((c) => c.row_id === rowId).sort((a, b) => a.start_frame - b.start_frame);
  }

  function setCurrentClip(clipId: string): void {
    currentClipId = clipId;
    writeAddress();
    const clip = clips.find((c) => c.id === clipId);
    const block = canvasInner.querySelector(`[data-clip-id="${clipId}"]`) as HTMLButtonElement | null;
    if (block !== null) {
      canvasInner.querySelectorAll('.clip-block').forEach((node) => node.setAttribute('tabindex', '-1'));
      block.removeAttribute('tabindex');
      block.focus();
    }
    void clip;
  }

  canvasInner.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const block = target.closest('[data-clip-id]') as HTMLElement | null;
    if (block !== null) {
      if (event.metaKey || event.ctrlKey) {
        const id = block.getAttribute('data-clip-id')!;
        if (selection.has(id)) selection.delete(id);
        else selection.add(id);
        draw();
        return;
      }
      setCurrentClip(block.getAttribute('data-clip-id')!);
      return;
    }
    if (target.closest('[data-caption-id]') !== null) return;
    // Clicking empty canvas moves the playhead.
    const rect = canvasHolder.getBoundingClientRect();
    const frame = firstFrame + Math.floor((event.clientX - rect.left) / pxPerFrame());
    setPlayhead(Math.max(0, frame), true);
  });

  function setPlayhead(frame: number, replace: boolean): void {
    playhead = Math.max(0, Math.min(Math.max(0, totalFrames() - 1), frame));
    playheadTc.textContent = timecode(playhead, project.frame_rate);
    playheadTc.setAttribute('data-playhead-timecode', timecode(playhead, project.frame_rate));
    if (layout === 'editor') {
      drawTimeline();
      drawStage(playhead, 'playhead');
      drawInspector(playhead);
    }
    writeAddress(replace);
    sendPlayhead();
  }

  function setZoom(level: number): void {
    const next = Math.max(0, Math.min(5, level));
    if (next === zoomLevel) return;
    zoomLevel = next;
    const half = Math.floor(visibleFrames() / 2);
    firstFrame = Math.max(0, playhead - half);
    zoomIn.disabled = zoomLevel === 5;
    zoomOut.disabled = zoomLevel === 0;
    draw();
    writeAddress();
  }

  zoomIn.addEventListener('click', () => setZoom(zoomLevel + 1));
  zoomOut.addEventListener('click', () => setZoom(zoomLevel - 1));

  // ---- The address carries the view ----
  function readAddress(): { frame: number; zoom: number; clip: string | null; panel: 'inspector' | 'comments' | 'exports' | 'none' } {
    const params = new URLSearchParams(window.location.search);
    const frame = Number(params.get('frame'));
    const zoom = Number(params.get('zoom'));
    const clip = params.get('clip');
    const panelParam = params.get('panel');
    return {
      frame: Number.isInteger(frame) && frame >= 0 ? frame : 0,
      zoom: Number.isInteger(zoom) && zoom >= 0 && zoom <= 5 ? zoom : 2,
      clip: clip,
      panel: panelParam === 'inspector' || panelParam === 'comments' || panelParam === 'exports' ? panelParam : 'none',
    };
  }

  function writeAddress(replace = false): void {
    const params = new URLSearchParams();
    if (playhead !== 0) params.set('frame', String(playhead));
    if (zoomLevel !== 2) params.set('zoom', String(zoomLevel));
    if (currentClipId !== null) params.set('clip', currentClipId);
    if (panel !== 'none') params.set('panel', panel);
    const query = params.toString();
    const url = `/projects/${projectId}${query === '' ? '' : `?${query}`}`;
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  }

  // ---- The Frame Loupe ----
  let loupeVisible = false;
  let loupePinned = false;
  let loupeFrame = 0;
  const loupe = el('div', { class: 'loupe', role: 'group', 'aria-label': 'Frame Loupe', 'data-loupe': '', style: 'display:none;' });

  function showLoupe(frame: number, pinned = false): void {
    loupeFrame = frame;
    loupeVisible = true;
    loupePinned = pinned;
    loupe.style.display = 'grid';
    loupe.textContent = '';
    for (let i = -4; i <= 4; i++) {
      const cellFrame = Math.max(0, frame + i);
      const cell = el('div', { class: i === 0 ? 'cell centre' : 'cell', 'data-loupe-frame': String(cellFrame) });
      if (i === 0) {
        cell.setAttribute('data-loupe-centre', '');
        cell.append(el('span', { class: 'tc', text: timecode(cellFrame, project.frame_rate) }));
      }
      for (const clip of clips) {
        if (cellFrame === clip.start_frame || cellFrame === clip.end_frame) {
          cell.append(el('span', { 'data-loupe-mark': 'clip-edge', 'data-frame': String(cellFrame), style: 'position:absolute; left:0; top:0; width:1px; height:100%; background:#fff;' }));
        }
        for (const [prop, list] of Object.entries(clip.keyframes)) {
          for (const diamond of list as Keyframe[]) {
            if (clip.start_frame + diamond.frame === cellFrame) {
              cell.append(el('span', { 'data-loupe-mark': 'keyframe', 'data-frame': String(cellFrame), style: 'position:absolute; right:2px; top:2px; width:4px; height:4px; background:#fff;' }));
            }
          }
        }
      }
      for (const cap of captions) {
        if (cellFrame === cap.start_frame || cellFrame === cap.end_frame) {
          cell.append(el('span', { 'data-loupe-mark': 'caption-edge', 'data-frame': String(cellFrame), style: 'position:absolute; left:0; bottom:0; width:100%; height:1px; background:#fff;' }));
        }
      }
      loupe.append(cell);
    }
    drawStage(frame, 'skim');
    drawInspector(frame);
  }

  function positionLoupe(event: PointerEvent): void {
    const rect = canvasHolder.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX, rect.left), rect.right);
    const y = event.clientY;
    let frame = firstFrame + Math.floor((event.clientX - rect.left) / pxPerFrame());
    // Snapping: within 2 frames of a clip edge, the playhead or a marker.
    const snapTargets: number[] = [playhead, ...project.markers.map((m) => m.frame)];
    for (const clip of clips) {
      snapTargets.push(clip.start_frame, clip.end_frame);
    }
    let snapped = false;
    for (const target of snapTargets) {
      if (Math.abs(frame - target) <= 2) {
        frame = target;
        snapped = true;
        break;
      }
    }
    showLoupe(frame);
    loupe.style.left = `${Math.min(window.innerWidth - 370, Math.max(0, x - 180))}px`;
    loupe.style.top = `${Math.max(0, y - 96 - 16)}px`;
    if (snapped) {
      const guide = el('div', { class: 'snap-guide', 'data-snap-guide': '', style: `position:fixed; left:${x}px; top:0; height:100vh;` });
      document.body.append(guide);
      setTimeout(() => guide.remove(), 120);
    }
  }

  function closeLoupe(): void {
    loupeVisible = false;
    lougePinnedSet(false);
    loupe.style.display = 'none';
    if (!reducedMotion()) {
      setTimeout(() => {
        drawStage(playhead, 'playhead');
        drawInspector(playhead);
      }, 200);
    } else {
      drawStage(playhead, 'playhead');
      drawInspector(playhead);
    }
    const clip = clips.find((c) => c.id === currentClipId);
    if (clip !== undefined) {
      const block = canvasInner.querySelector(`[data-clip-id="${clip.id}"]`) as HTMLElement | null;
      block?.focus();
    } else {
      canvasHolder.focus();
    }
  }

  function lougePinnedSet(value: boolean): void {
    loupePinned = value;
  }

  function pinLoupe(): void {
    if (loupePinned) {
      closeLoupe();
      return;
    }
    showLoupe(playhead, true);
  }

  let loupeTimer: ReturnType<typeof setTimeout> | null = null;
  canvasHolder.addEventListener('pointerenter', (event) => {
    if (loupeTimer !== null) clearTimeout(loupeTimer);
    loupeTimer = setTimeout(() => {
      document.body.append(loupe);
      positionLoupe(event as PointerEvent);
    }, reducedMotion() ? 0 : 40);
  });
  canvasHolder.addEventListener('pointermove', (event) => {
    if (loupePinned) return;
    positionLoupe(event);
  });
  canvasHolder.addEventListener('pointerleave', () => {
    if (loupePinned) return;
    if (loupeTimer !== null) clearTimeout(loupeTimer);
    closeLoupe();
  });

  // ---- Playback ----
  let playing = false;
  let rangeIn: number | null = null;
  let rangeOut: number | null = null;
  let playStart = 0;
  let playStartFrame = 0;
  let raf = 0;

  function startPlayback(): void {
    playStart = performance.now();
    playStartFrame = playhead;
    const step = (): void => {
      if (!playing) return;
      const elapsed = (performance.now() - playStart) / 1000;
      const rate = project.frame_rate === '23.976' ? 24000 / 1001 : Number(project.frame_rate);
      const next = playStartFrame + Math.floor(elapsed * rate);
      if (rangeIn !== null && rangeOut !== null && next >= rangeOut) {
        setPlayhead(rangeIn, true);
        playStart = performance.now();
        playStartFrame = rangeIn;
      } else if (next >= totalFrames()) {
        setPlayhead(Math.max(0, totalFrames() - 1), true);
        playing = false;
      } else {
        setPlayhead(next, true);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  // ---- Socket ----
  let socket: WebSocket | null = null;
  let lastPlayheadSend = 0;

  function sendPlayhead(): void {
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (now - lastPlayheadSend < 250) return;
    lastPlayheadSend = now;
    socket.send(JSON.stringify({ type: 'playhead', frame: playhead }));
  }

  function openSocket(): void {
    socket = new WebSocket(`/api/live?project=${projectId}`);
    socket.addEventListener('open', () => {
      socket?.send(JSON.stringify({ type: 'subscribe', project_id: projectId, after_version: lastVersion }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as Record<string, unknown>;
      if (message.type === 'op') {
        lastVersion = Number(message.version);
        void refreshAll();
        const author = (message.author as { name: string } | undefined)?.name ?? '';
        const op = (message.op as Record<string, unknown> | undefined) ?? {};
        const kind = String(op.type ?? 'edit');
        if (author !== me?.name) {
          announce('Project activity', activityFor(author, kind, op, project.frame_rate));
        }
      } else if (message.type === 'comment') {
        const comment = message.comment as Comment;
        const isMine = comment.author_name === me?.name;
        if (!isMine) {
          announce('Project activity', activity.note(comment.author_name, comment.pin.live_frame, project.frame_rate));
        }
        void refreshComments();
      } else if (message.type === 'export') {
        const item = message.export as ExportRecord;
        if (item.state === 'done') {
          announce('Project activity', activity.exportDone(item.cut_name, item.size));
        } else if (item.state === 'failed') {
          announce('Project activity', activity.exportFailed(item.cut_name, item.size));
        } else if (item.state === 'cancelled') {
          announce('Project activity', activity.exportCancelled(item.cut_name, item.size));
        }
        void refreshExports();
      } else if (message.type === 'allowance') {
        const allowance = message.allowance as Allowance;
        const node = document.querySelector('[data-allowance]');
        if (node !== null) node.textContent = allowance.text;
        announce('Project activity', activity.allowance(allowance));
      } else if (message.type === 'cut_shared') {
        announce('Project activity', activity.cutShared('The shared cut'));
      } else if (message.type === 'playhead') {
        const name2 = String(message.person);
        const frame = Number(message.frame);
        const existing = remotePlayheads.find((r) => r.name === name2);
        if (existing !== undefined) existing.frame = frame;
        else remotePlayheads.push({ name: name2, frame });
        if (layout === 'editor') drawTimeline();
      } else if (message.type === 'role_changed') {
        const newRole = message.role as string | null;
        if (newRole === null) {
          announce('Notices', copy.removedFromProject(project.title));
        } else {
          announce('Notices', copy.roleChanged(project.title, newRole));
        }
      }
    });
    socket.addEventListener('close', (event) => {
      if (event.code === 4401) {
        window.location.href = '/sign-in#signed-out';
        return;
      }
      if (event.code === 4403) {
        window.location.reload();
        return;
      }
      setTimeout(() => openSocket(), 1000);
    });
  }

  // ---- Dialogs ----
  function openNameCutDialog(): void {
    const opener = document.activeElement as HTMLElement | null;
    const overlay = el('div', { class: 'overlay' });
    const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Name cut' });
    dialog.append(el('h2', { text: 'Name cut' }));
    const input = el('input', { type: 'text', 'aria-label': 'Cut name' });
    const save = el('button', { class: 'btn primary', text: 'Save cut' });
    const cancel = el('button', { class: 'btn', text: 'Cancel' });
    const error = el('p', { class: 'muted' });
    dialog.append(el('label', { class: 'field' }, el('span', { text: 'Cut name' }), input), error, el('div', { class: 'row' }, save, cancel));
    overlay.append(dialog);
    document.body.append(overlay);
    input.focus();
    const close = (): void => {
      overlay.remove();
      opener?.focus();
    };
    cancel.addEventListener('click', close);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    save.addEventListener('click', () => {
      void (async () => {
        announce('Notices', copy.savingCut());
        try {
          const cut = await api.nameCut(projectId, input.value);
          announce('Notices', copy.cutSaved(cut.name));
          close();
        } catch (err) {
          const body = (err as { body?: { message?: string } }).body;
          error.textContent = body?.message ?? '';
          announce('Notices', body?.message ?? 'Check the highlighted fields.');
        }
      })();
    });
  }

  async function openExportDialog(): Promise<void> {
    const opener = document.activeElement as HTMLElement | null;
    const { items } = await api.cuts(projectId);
    const overlay = el('div', { class: 'overlay' });
    const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Export cut' });
    dialog.append(el('h2', { text: 'Export cut' }));
    const cutSelect = el('select', { 'aria-label': 'Cut' });
    for (const cut of items as Cut[]) cutSelect.append(el('option', { value: cut.id, text: cut.name }));
    const sizeGroup = el('div', { role: 'radiogroup', 'aria-label': 'Size' });
    const radios: HTMLInputElement[] = [];
    for (const size of ['2160', '1080', '720']) {
      const radio = el('input', { type: 'radio', name: 'size', value: size });
      if (size === '1080') radio.checked = true;
      radios.push(radio);
      sizeGroup.append(el('label', null, radio, document.createTextNode(` ${size}p`)));
    }
    const start = el('button', { class: 'btn primary', text: 'Start export' });
    const cancel = el('button', { class: 'btn', text: 'Cancel' });
    dialog.append(cutSelect, sizeGroup, el('div', { class: 'row' }, start, cancel));
    overlay.append(dialog);
    document.body.append(overlay);
    cutSelect.focus();
    const close = (): void => {
      overlay.remove();
      opener?.focus();
    };
    cancel.addEventListener('click', close);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    start.addEventListener('click', () => {
      void (async () => {
        const size = radios.find((r) => r.checked)?.value ?? '1080';
        announce('Notices', copy.startingExport());
        try {
          await api.startExport(projectId, cutSelect.value, Number(size));
          announce('Notices', copy.exportQueued(items.find((c) => c.id === cutSelect.value)?.name ?? '', size));
          close();
          await refreshExports();
        } catch (err) {
          const body = (err as { body?: { message?: string } }).body;
          announce('Notices', body?.message ?? 'Check the highlighted fields.');
        }
      })();
    });
  }

  async function openShareDialog(): Promise<void> {
    const opener = document.activeElement as HTMLElement | null;
    const cuts = await api.cuts(projectId);
    const overlay = el('div', { class: 'overlay' });
    const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share for review' });
    dialog.append(el('h2', { text: 'Share for review' }));
    const cutSelect = el('select', { 'aria-label': 'Cut' });
    for (const cut of cuts.items) cutSelect.append(el('option', { value: cut.id, text: cut.name }));
    const lasts = el('select', { 'aria-label': 'Link lasts' });
    for (const [label, seconds] of [['1 hour', 3600], ['1 day', 86400], ['7 days', 604800], ['30 days', 2592000]] as const) {
      lasts.append(el('option', { value: String(seconds), text: label }));
    }
    const create = el('button', { class: 'btn primary', text: 'Create link' });
    const linkField = el('input', { 'aria-label': 'Review link', readonly: 'readonly' });
    const share = el('button', { class: 'btn', text: 'Share this cut' });
    const regenerate = el('button', { class: 'btn', text: 'Regenerate link' });
    const revoke = el('button', { class: 'btn', text: 'Revoke link' });
    dialog.append(
      el('label', { class: 'field' }, el('span', { text: 'Cut' }), cutSelect),
      el('label', { class: 'field' }, el('span', { text: 'Link lasts' }), lasts),
      create,
      el('label', { class: 'field' }, el('span', { text: 'Review link' }), linkField),
      el('div', { class: 'row' }, share, regenerate, revoke),
    );
    overlay.append(dialog);
    document.body.append(overlay);
    cutSelect.focus();
    const close = (): void => {
      overlay.remove();
      opener?.focus();
    };
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    let linkId: string | null = null;
    create.addEventListener('click', () => {
      void (async () => {
        announce('Notices', copy.makingLink());
        const link = await api.createReviewLink(projectId, cutSelect.value, Number(lasts.value));
        linkId = String(link.id);
        linkField.value = String(link.url);
        announce('Notices', copy.linkReady(new Date(String(link.expires_at)).toLocaleString()));
      })();
    });
    revoke.addEventListener('click', () => {
      if (linkId === null) return;
      void (async () => {
        announce('Notices', copy.turningOffLink());
        await api.revokeReviewLink(linkId!);
        announce('Notices', copy.linkOff());
      })();
    });
    regenerate.addEventListener('click', () => {
      if (linkId === null) return;
      void (async () => {
        announce('Notices', copy.makingLink());
        const link = await api.regenerateReviewLink(linkId!);
        linkId = String(link.id);
        linkField.value = String(link.url);
        announce('Notices', copy.linkReady(new Date(String(link.expires_at)).toLocaleString()));
      })();
    });
    share.addEventListener('click', () => {
      if (linkField.value !== '') {
        void navigator.clipboard?.writeText(linkField.value);
        announce('Notices', 'Review link copied.');
      }
    });
  }

  async function openCompareDialog(): Promise<void> {
    const opener = document.activeElement as HTMLElement | null;
    const cuts = await api.cuts(projectId);
    const overlay = el('div', { class: 'overlay' });
    const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Compare cuts' });
    dialog.append(el('h2', { text: 'Compare cuts' }));
    const from = el('select', { 'aria-label': 'From cut' });
    const to = el('select', { 'aria-label': 'To cut' });
    for (const cut of cuts.items) {
      from.append(el('option', { value: cut.id, text: cut.name }));
      to.append(el('option', { value: cut.id, text: cut.name }));
    }
    const table = el('table');
    table.setAttribute('aria-label', 'Cut differences');
    const restore = isOwner ? el('button', { class: 'btn primary', text: `Restore cut ${to.value}` }) : null;
    const close = (): void => {
      overlay.remove();
      opener?.focus();
    };
    const cancel = el('button', { class: 'btn', text: 'Close' });
    cancel.addEventListener('click', close);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    dialog.append(from, to, table);
    if (restore !== null) dialog.append(restore);
    dialog.append(cancel);
    overlay.append(dialog);
    document.body.append(overlay);
    from.focus();
    async function refreshCompare(): Promise<void> {
      if (from.value === to.value) {
        table.textContent = '';
        return;
      }
      const diff = await api.compareCuts(projectId, from.value, to.value);
      table.textContent = '';
      const added = diff.added as string[];
      const removed = diff.removed as string[];
      const changed = diff.changed as { clip_id: string; from: { start_frame: number }; to: { start_frame: number } }[];
      table.append(el('tr', null, el('th', { text: 'Added' }), el('td', { text: added.join(', ') || '—' })));
      table.append(el('tr', null, el('th', { text: 'Removed' }), el('td', { text: removed.join(', ') || '—' })));
      table.append(el('tr', null, el('th', { text: 'Changed' }), el('td', { text: changed.map((c) => c.clip_id).join(', ') || '—' })));
      table.append(el('tr', null, el('th', { text: 'Frame delta' }), el('td', { text: String(diff.frame_delta) })));
      if (restore !== null) {
        const toName = cuts.items.find((c) => c.id === to.value)?.name ?? to.value;
        restore.textContent = `Restore cut ${toName}`;
      }
    }
    void refreshCompare();
    from.addEventListener('change', () => void refreshCompare());
    to.addEventListener('change', () => void refreshCompare());
    restore?.addEventListener('click', () => {
      void (async () => {
        announce('Notices', copy.restoring());
        try {
          const response = await api.restoreCut(projectId, to.value, `restore-${Date.now().toString(36)}`, lastVersion);
          lastVersion = response.version;
          const toName = cuts.items.find((c) => c.id === to.value)?.name ?? to.value;
          announce('Notices', copy.cutRestored(toName));
          await refreshAll();
          close();
        } catch (err) {
          const body = (err as { body?: { message?: string } }).body;
          announce('Notices', body?.message ?? 'Check the highlighted fields.');
        }
      })();
    });
  }

  async function openFrameSizeDialog(): Promise<void> {
    const opener = document.activeElement as HTMLElement | null;
    const overlay = el('div', { class: 'overlay' });
    const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Frame size' });
    dialog.append(el('h2', { text: 'Frame size' }));
    const aspect = el('select', { 'aria-label': 'Aspect ratio' });
    for (const ratio of ['16:9', '9:16', '1:1', '4:5']) {
      aspect.append(el('option', { value: ratio, text: ratio }));
    }
    aspect.value = project.aspect_ratio;
    const change = el('button', { class: 'btn primary', text: 'Change frame' });
    const cancel = el('button', { class: 'btn', text: 'Cancel' });
    dialog.append(aspect, el('div', { class: 'row' }, change, cancel));
    overlay.append(dialog);
    document.body.append(overlay);
    aspect.focus();
    const close = (): void => {
      overlay.remove();
      opener?.focus();
    };
    cancel.addEventListener('click', close);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });
    change.addEventListener('click', () => {
      void (async () => {
        announce('Notices', copy.changingFrame());
        try {
          const response = await api.setAspect(projectId, `aspect-${Date.now().toString(36)}`, lastVersion, aspect.value);
          lastVersion = response.version;
          announce('Notices', copy.frameChanged(aspect.value));
          await refreshAll();
          close();
        } catch (err) {
          const body = (err as { body?: { message?: string } }).body;
          announce('Notices', body?.message ?? 'Check the highlighted fields.');
        }
      })();
    });
  }

  async function openMembersDialog(): Promise<void> {
    const opener = document.activeElement as HTMLElement | null;
    const members = await api.members(projectId);
    const overlay = el('div', { class: 'overlay' });
    const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Project members' });
    dialog.append(el('h2', { text: 'Project members' }));
    for (const member of members.items) {
      if (member.role === 'owner') {
        dialog.append(el('p', { text: `${member.person.name} (owner)` }));
        continue;
      }
      const roleSelect = el('select', { 'aria-label': `Role for ${member.person.name}` });
      roleSelect.append(el('option', { value: 'editor', text: 'editor' }), el('option', { value: 'commenter', text: 'commenter' }));
      roleSelect.value = member.role;
      roleSelect.addEventListener('change', () => {
        void api.setMemberRole(projectId, member.person.id, roleSelect.value);
      });
      const remove = el('button', { class: 'btn', text: `Remove ${member.person.name}` });
      remove.addEventListener('click', () => {
        void api.removeMember(projectId, member.person.id).then(() => remove.closest('div')?.remove());
      });
      dialog.append(el('div', null, el('span', { text: member.person.name }), roleSelect, remove));
    }
    const email = el('input', { type: 'email', 'aria-label': 'Email' });
    const role = el('select', { 'aria-label': 'Role' });
    role.append(el('option', { value: 'editor', text: 'editor' }), el('option', { value: 'commenter', text: 'commenter' }));
    const add = el('button', { class: 'btn', text: 'Add member' });
    add.addEventListener('click', () => {
      void api.addMember(projectId, email.value, role.value).catch(() => undefined);
    });
    const close = el('button', { class: 'btn', text: 'Close' });
    dialog.append(el('label', { class: 'field' }, el('span', { text: 'Email' }), email), role, add, close);
    overlay.append(dialog);
    document.body.append(overlay);
    email.focus();
    const closeAll = (): void => {
      overlay.remove();
      opener?.focus();
    };
    close.addEventListener('click', closeAll);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAll();
      }
    });
  }

  async function openCaptionsDialog(): Promise<void> {
    const opener = document.activeElement as HTMLElement | null;
    const overlay = el('div', { class: 'overlay' });
    const dialog = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Captions', style: 'max-width:640px;' });
    dialog.append(el('h2', { text: 'Captions' }));
    const rowSelect = el('select', { 'aria-label': 'Caption row' });
    for (const row of rows.filter((r) => r.kind === 'caption')) {
      rowSelect.append(el('option', { value: row.id, text: row.name }));
    }
    const srtInput = el('input', { type: 'file', 'aria-label': 'SRT file' });
    const importBtn = el('button', { class: 'btn', text: 'Import captions' });
    const download = el('a', { class: 'btn', text: 'Download SRT', href: '#' });
    const cuesList = el('ul', { class: 'list', role: 'list', 'aria-label': 'Cues' });
    const cueText = el('textarea', { 'aria-label': 'Cue text', rows: '2' });
    const cueCount = el('span', { 'data-count': '42', class: 'muted' });
    const saveCue = el('button', { class: 'btn', text: 'Save cue' });
    const cancelCue = el('button', { class: 'btn', text: 'Cancel cue' });
    let editingCue: string | null = null;

    function refreshCues(): void {
      cuesList.textContent = '';
      const rowCaptions = captions.filter((c) => c.row_id === rowSelect.value).sort((a, b) => a.start_frame - b.start_frame);
      rowCaptions.forEach((caption, index) => {
        const edit = el('button', { class: 'btn', text: `Edit cue ${index + 1}` });
        edit.addEventListener('click', () => {
          editingCue = caption.id;
          cueText.value = caption.text;
          updateCueCount();
          cueText.focus();
          editButtonOf(edit);
        });
        cuesList.append(el('li', null,
          el('span', { text: `${timecode(caption.start_frame, project.frame_rate)} to ${timecode(caption.end_frame, project.frame_rate)} · ${caption.text}` }),
          edit));
      });
      download.setAttribute('href', api.exportSrtUrl(projectId, rowSelect.value));
    }

    function editButtonOf(button: HTMLElement): void {
      void button;
    }

    function updateCueCount(): void {
      const lines = cueText.value.split('\n');
      const longest = lines.reduce((max, line) => {
        let n = 0;
        for (const _ of line) n++;
        return Math.max(max, n);
      }, 0);
      cueCount.textContent = `${42 - longest} characters left`;
      cueCount.setAttribute('data-count', String(42 - longest));
      saveCue.disabled = lines.length > 2 || longest > 42;
    }
    cueText.addEventListener('input', updateCueCount);

    importBtn.addEventListener('click', () => {
      const file = srtInput.files?.[0];
      if (file === undefined) return;
      void (async () => {
        announce('Notices', copy.readingSrt(file.name));
        try {
          const text = await file.text();
          const result = await api.importSrt(projectId, rowSelect.value, text);
          const rowName = rows.find((r) => r.id === rowSelect.value)?.name ?? rowSelect.value;
          announce('Notices', copy.captionsImported(result.cues, rowName));
          await refreshAll();
          refreshCues();
        } catch (err) {
          const body = (err as { body?: { errors?: Record<string, string> } }).body;
          const message = body?.errors?.srt ?? 'Check the highlighted fields.';
          announce('Notices', message);
        }
      })();
    });

    saveCue.addEventListener('click', () => {
      if (editingCue === null) return;
      const caption = captions.find((c) => c.id === editingCue);
      if (caption === undefined) return;
      void (async () => {
        await sendOp({ type: 'caption_edit', caption_id: caption.id, start_frame: caption.start_frame, end_frame: caption.end_frame, text: cueText.value });
        await refreshAll();
        refreshCues();
        editingCue = null;
        cueText.value = '';
        updateCueCount();
      })();
    });
    cancelCue.addEventListener('click', () => {
      cueText.value = '';
      editingCue = null;
      updateCueCount();
    });

    rowSelect.addEventListener('change', refreshCues);
    const close = el('button', { class: 'btn', text: 'Close' });
    dialog.append(rowSelect, srtInput, importBtn, download, cuesList,
      cueText, cueCount, saveCue, cancelCue, close);
    overlay.append(dialog);
    document.body.append(overlay);
    rowSelect.focus();
    const closeAll = (): void => {
      overlay.remove();
      opener?.focus();
    };
    close.addEventListener('click', closeAll);
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAll();
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && document.activeElement === cueText) {
        e.preventDefault();
        saveCue.click();
      }
    });
    cueText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) {
        // Enter inserts a line break inside Cue text (default behaviour).
        return;
      }
    });
    refreshCues();
  }

  // ---- Layout assembly ----
  if (layout === 'editor') {
    const grid = el('div', { class: 'editor-grid' });
    const stageCol = el('div', { class: 'stage-col' });
    stageCol.append(stage);
    const inspectorCol = el('div', { class: 'inspector-col' });
    inspectorCol.append(inspector);
    const commentsCol = el('div', { class: 'comments-col' });
    commentsCol.append(commentsPanel, noteBox, noteCount, visibilityGroup, pinNote);
    const timelineCol = el('div', { class: 'timeline-col' });
    timelineCol.append(timeline, exportsPanel);
    grid.append(stageCol, inspectorCol, commentsCol, timelineCol);
    main.append(grid);
    if (role === 'commenter') {
      timeline.remove();
      zoomIn.remove();
      zoomOut.remove();
    }
  } else if (layout === 'two-pane') {
    const grid = el('div', { class: 'two-pane' });
    const left = el('div');
    const scrubber = el('input', { type: 'range', min: '0', max: String(Math.max(0, totalFrames() - 1)), value: String(playhead), 'aria-label': 'Scrubber' });
    const clipsList = el('ul', { class: 'list', role: 'list', 'aria-label': 'Clips' });
    for (const clip of timelineOrder()) {
      const button = el('button', { class: 'btn', text: `${clip.name}, ${timecode(clip.start_frame, project.frame_rate)} to ${timecode(clip.end_frame, project.frame_rate)}` });
      button.addEventListener('click', () => {
        scrubber.value = String(clip.start_frame);
      });
      clipsList.append(el('li', null, button));
    }
    scrubber.addEventListener('input', () => {
      playhead = Number(scrubber.value);
      scrubber.setAttribute('aria-valuetext', timecode(playhead, project.frame_rate));
      drawStage(playhead, 'playhead');
    });
    scrubber.setAttribute('aria-valuetext', timecode(playhead, project.frame_rate));
    left.append(stage, scrubber, clipsList);
    const right = el('div');
    right.append(commentsPanel, noteBox, noteCount, visibilityGroup, pinNote);
    grid.append(left, right);
    main.append(grid);
  } else {
    const scrubber = el('input', { type: 'range', min: '0', max: String(Math.max(0, totalFrames() - 1)), value: String(playhead), 'aria-label': 'Scrubber' });
    scrubber.setAttribute('aria-valuetext', timecode(playhead, project.frame_rate));
    const clipsList = el('ul', { class: 'list', role: 'list', 'aria-label': 'Clips' });
    for (const clip of timelineOrder()) {
      const button = el('button', {
        class: 'btn',
        text: `${clip.name}, ${timecode(clip.start_frame, project.frame_rate)} to ${timecode(clip.end_frame, project.frame_rate)}`,
        style: 'min-height:44px; min-width:44px;',
      });
      button.addEventListener('click', () => {
        scrubber.value = String(clip.start_frame);
        scrubber.dispatchEvent(new Event('input'));
      });
      clipsList.append(el('li', null, button));
    }
    scrubber.addEventListener('input', () => {
      playhead = Number(scrubber.value);
      scrubber.setAttribute('aria-valuetext', timecode(playhead, project.frame_rate));
      drawStage(playhead, 'playhead');
    });
    const bar = el('div', { class: 'review-bar' });
    bar.append(pinNote);
    if (role === 'owner' || role === 'commenter') {
      const approveBtn = el('button', { class: 'btn', text: 'Approve cut' });
      approveBtn.addEventListener('click', () => {
        void (async () => {
          announce('Notices', copy.approving());
          const cuts = await api.cuts(projectId);
          const lastCut = cuts.items[cuts.items.length - 1];
          if (lastCut === undefined) return;
          const result = await api.approveCut(projectId, lastCut.id);
          announce('Notices', copy.cutApproved(lastCut.name));
          void result;
        })();
      });
      bar.append(approveBtn);
    }
    const box = el('div', { class: 'review-comment-box' });
    box.append(stage, scrubber, clipsList, commentsPanel, noteBox, noteCount, visibilityGroup, bar);
    main.append(box);
  }

  // Restore the draft, refresh panels, open the socket and draw.
  void api.draft(projectId).then((result) => {
    if (result.draft !== null && typeof result.draft.body === 'string') {
      noteBox.value = result.draft.body;
      noteBox.dispatchEvent(new Event('input'));
    }
  });
  await refreshComments();
  await refreshExports();
  draw();
  openSocket();
  window.addEventListener('resize', () => {
    const next = layoutMode(window.innerWidth);
    if (next !== layout) {
      window.location.reload();
    }
  });
  void raf;
  return main;
}
