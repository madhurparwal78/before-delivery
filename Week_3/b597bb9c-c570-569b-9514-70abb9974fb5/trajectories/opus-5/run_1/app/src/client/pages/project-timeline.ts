/**
 * The timeline canvas and the Frame Loupe. A block's left edge is its own start
 * frame minus the first drawn frame, at the canvas scale.
 */
import { el, prefersReducedMotion } from '../dom.js';
import {
  clipById,
  lastFrame,
  PX_PER_FRAME,
  rateOf,
  SNAP_FRAMES,
  stamp,
  timelineOrder,
  totalFrames,
  type PageState,
} from './project-state.js';
import { timecode } from '../../domain/rate.js';

export function pixelsPerFrame(state: PageState): number {
  return PX_PER_FRAME[state.zoom];
}

export function blockLeft(state: PageState, frame: number): number {
  return (frame - state.firstFrame) * pixelsPerFrame(state);
}

export function frameAtOffset(state: PageState, offsetX: number): number {
  return state.firstFrame + Math.floor(offsetX / pixelsPerFrame(state));
}

/** Zoom keeps the playhead frame centred on the canvas. */
export function centreOnPlayhead(state: PageState): void {
  state.firstFrame = Math.max(0, state.playhead - Math.floor(state.visibleFrames / 2));
}

export function snapTargets(state: PageState): number[] {
  const targets = new Set<number>([state.playhead]);
  for (const clip of state.detail.clips) {
    targets.add(clip.start_frame);
    targets.add(clip.end_frame);
  }
  for (const marker of state.detail.project.markers) targets.add(marker.frame);
  return [...targets].sort((a, b) => a - b);
}

/** The loupe snaps within two frames, to the nearest; the earlier frame wins a tie. */
export function snapFrame(state: PageState, frame: number): { frame: number; snapped: boolean } {
  let best: number | null = null;
  let bestDistance = SNAP_FRAMES + 1;
  for (const target of snapTargets(state)) {
    const distance = Math.abs(target - frame);
    if (distance <= SNAP_FRAMES && (distance < bestDistance || (distance === bestDistance && best !== null && target < best))) {
      best = target;
      bestDistance = distance;
    }
  }
  return best === null ? { frame, snapped: false } : { frame: best, snapped: true };
}

function loupeMarks(state: PageState, frame: number): { kind: string; frame: number }[] {
  const marks: { kind: string; frame: number }[] = [];
  for (const clip of state.detail.clips) {
    if (clip.start_frame === frame || clip.end_frame === frame) marks.push({ kind: 'clip-edge', frame });
    const relative = frame - clip.start_frame;
    for (const diamonds of Object.values(clip.keyframes)) {
      if ((diamonds ?? []).some((diamond) => diamond.frame === relative)) marks.push({ kind: 'keyframe', frame });
    }
  }
  for (const caption of state.detail.captions) {
    if (caption.start_frame === frame || caption.end_frame === frame) marks.push({ kind: 'caption-edge', frame });
  }
  for (const comment of state.comments) {
    if (comment.pin.live_frame === frame) marks.push({ kind: 'pin', frame });
  }
  return marks;
}

export function renderLoupe(state: PageState): HTMLElement | null {
  if (!state.loupe.visible) return null;
  const centre = state.loupe.frame;
  const cells: HTMLElement[] = [];
  for (let offset = -4; offset <= 4; offset += 1) {
    const frame = centre + offset;
    const marks = loupeMarks(state, frame);
    cells.push(
      el(
        'div',
        {
          class: 'loupe-cell',
          'data-loupe-frame': String(frame),
          ...(offset === 0 ? { 'data-loupe-centre': '' } : {}),
        },
        [
          offset === 0 ? el('span', { class: 'tabular loupe-stamp', text: stamp(state, frame) }) : null,
          ...marks.map((mark) =>
            el('span', { class: `loupe-mark mark-${mark.kind}`, 'data-loupe-mark': mark.kind, 'data-frame': String(mark.frame) }),
          ),
        ],
      ),
    );
  }
  const loupe = el(
    'div',
    {
      class: `loupe${prefersReducedMotion() ? ' no-motion' : ''}`,
      role: 'group',
      'aria-label': 'Frame Loupe',
      'data-loupe': '',
      'data-pinned': state.loupe.pinned ? 'true' : 'false',
      style: `left:${state.loupe.x}px; top:${state.loupe.y}px`,
    },
    cells,
  );
  if (state.loupe.snapped) {
    loupe.append(el('div', { class: 'snap-guide', 'data-snap-guide': '' }));
  }
  return loupe;
}

export function groupOutline(state: PageState): HTMLElement | null {
  const current = clipById(state, state.currentClipId);
  if (current === undefined || current.group_id === null) return null;
  const members = state.detail.clips.filter((clip) => clip.group_id === current.group_id);
  if (members.length === 0) return null;
  const positions = new Map(state.detail.rows.map((row) => [row.id, row.position]));
  const ordered = [...members].sort((a, b) => (positions.get(a.row_id) ?? 0) - (positions.get(b.row_id) ?? 0));
  const start = Math.min(...members.map((member) => member.start_frame));
  const end = Math.max(...members.map((member) => member.end_frame));
  const rowIndex = (rowId: string): number => state.detail.rows.findIndex((row) => row.id === rowId);
  const firstRow = ordered[0].row_id;
  const lastRow = ordered[ordered.length - 1].row_id;
  const top = Math.min(rowIndex(firstRow), rowIndex(lastRow));
  const span = Math.abs(rowIndex(lastRow) - rowIndex(firstRow)) + 1;
  return el('div', {
    class: 'group-outline',
    'data-group-outline': current.group_id,
    'data-group-first-row': firstRow,
    'data-group-last-row': lastRow,
    style: `left:${blockLeft(state, start)}px; width:${(end - start) * pixelsPerFrame(state)}px; top:${top * 36}px; height:${span * 36}px`,
  });
}

export function renderTimeline(state: PageState): HTMLElement {
  const scale = pixelsPerFrame(state);
  const rate = rateOf(state);
  const rows = [...state.detail.rows].sort((a, b) => a.position - b.position);
  const canvas = el('div', {
    class: 'timeline-canvas',
    'data-timeline-canvas': '',
    'data-px-per-frame': String(scale),
    'data-first-frame': String(state.firstFrame),
    'data-zoom-level': String(state.zoom),
    'data-visible-frames': String(state.visibleFrames),
    tabindex: '-1',
  });
  const inner = el('div', {
    class: 'canvas-inner',
    style: `width:${Math.max(1, totalFrames(state) * scale)}px`,
  });

  for (const row of rows) {
    const rowNode = el('div', { class: 'timeline-row', role: 'group', 'aria-label': row.name, 'data-row': row.id }, [
      el('button', { type: 'button', class: 'row-button', 'data-row-button': row.id, text: `Row ${row.name}` }),
    ]);
    if (row.locked) rowNode.dataset.locked = 'true';
    const lane = el('div', { class: 'row-lane' });
    for (const clip of state.detail.clips.filter((candidate) => candidate.row_id === row.id)) {
      const winner = state.winners.get(clip.id);
      const block = el(
        'button',
        {
          type: 'button',
          class: `clip${state.selection.has(clip.id) ? ' selected' : ''}${clip.hidden ? ' hidden-clip' : ''}`,
          'aria-label': `${clip.name}, ${timecode(clip.start_frame, rate)} to ${timecode(clip.end_frame, rate)}`,
          'data-clip-id': clip.id,
          'data-row-id': clip.row_id,
          'data-start-frame': String(clip.start_frame),
          'data-end-frame': String(clip.end_frame),
          'data-hidden': clip.hidden ? 'true' : 'false',
          'data-group-id': clip.group_id ?? '',
          tabindex: state.currentClipId === clip.id ? '0' : '-1',
          style: `left:${blockLeft(state, clip.start_frame)}px; width:${(clip.end_frame - clip.start_frame) * scale}px`,
        },
        [
          el('span', { class: 'clip-name', text: clip.name }),
          el('span', { class: 'muted tabular clip-stamp', text: timecode(clip.start_frame, rate) }),
          winner === undefined ? null : el('span', { class: 'winner', text: winner }),
        ],
      );
      lane.append(block);
    }
    if (row.kind === 'caption') {
      for (const caption of state.detail.captions.filter((candidate) => candidate.row_id === row.id)) {
        const index = state.detail.captions
          .filter((candidate) => candidate.row_id === row.id)
          .sort((a, b) => a.start_frame - b.start_frame)
          .findIndex((candidate) => candidate.id === caption.id);
        lane.append(
          el('button', {
            type: 'button',
            class: 'caption-block',
            'aria-label': `Caption ${index + 1}, ${timecode(caption.start_frame, rate)} to ${timecode(caption.end_frame, rate)}`,
            'data-caption-id': caption.id,
            tabindex: '-1',
            style: `left:${blockLeft(state, caption.start_frame)}px; width:${(caption.end_frame - caption.start_frame) * scale}px`,
          }),
        );
      }
    }
    for (const comment of state.comments.filter((candidate) => candidate.pin.row_id === row.id)) {
      lane.append(
        el('button', {
          type: 'button',
          class: 'pin',
          'aria-label': `Note by ${comment.author_name} at ${timecode(comment.pin.live_frame, rate)}`,
          'data-comment-id': comment.id,
          'data-frame': String(comment.pin.live_frame),
          tabindex: '-1',
          style: `left:${blockLeft(state, comment.pin.live_frame)}px`,
        }),
      );
    }
    rowNode.append(lane);
    inner.append(rowNode);
  }

  for (const marker of state.detail.project.markers) {
    inner.append(
      el('div', {
        class: 'marker',
        'data-marker-frame': String(marker.frame),
        style: `left:${blockLeft(state, marker.frame)}px`,
      }),
    );
  }
  inner.append(
    el('div', {
      class: 'playhead',
      'data-playhead-frame': String(state.playhead),
      style: `left:${blockLeft(state, state.playhead)}px`,
    }),
  );
  for (const [person, frame] of state.remotePlayheads) {
    inner.append(
      el('div', { class: 'remote-playhead', 'data-remote-playhead': person, style: `left:${blockLeft(state, frame)}px` }, [
        el('span', { class: 'muted', text: person }),
      ]),
    );
  }
  const outline = groupOutline(state);
  if (outline !== null) inner.append(outline);
  if (state.loupe.snapped && state.loupe.visible) {
    inner.append(
      el('div', {
        class: 'snap-guide canvas-guide',
        'data-snap-guide': '',
        style: `left:${blockLeft(state, state.loupe.frame)}px`,
      }),
    );
  }
  canvas.append(inner);

  return el('section', { class: 'timeline', role: 'region', 'aria-label': 'Timeline' }, [
    el('div', { class: 'timeline-controls' }, [
      el('button', { type: 'button', 'data-zoom-in': '', text: 'Zoom in', disabled: state.zoom >= 5 }),
      el('button', { type: 'button', 'data-zoom-out': '', text: 'Zoom out', disabled: state.zoom <= 0 }),
      el('span', { class: 'muted tabular', text: `${stamp(state, state.playhead)} of ${stamp(state, lastFrame(state))}` }),
    ]),
    canvas,
  ]);
}

export function firstClip(state: PageState): string | null {
  const ordered = timelineOrder(state);
  return ordered.length > 0 ? ordered[0].id : null;
}

export function lastClip(state: PageState): string | null {
  const ordered = timelineOrder(state);
  return ordered.length > 0 ? ordered[ordered.length - 1].id : null;
}
