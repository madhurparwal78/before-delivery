/** The Inspector, Comments, Exports and the review layouts' Clips list. */
import { ApiCallError, newOpId, post } from '../api.js';
import { el, find } from '../dom.js';
import { formatTwoDecimals, valueAt } from '../../domain/layers.js';
import { KEYFRAME_PROPERTIES, type KeyframeProperty } from '../../shared/types.js';
import { notice } from '../shell.js';
import { layerClips } from '../sheet.js';
import { clipById, lastFrame, NOTE_LIMIT, rateOf, stamp, timelineOrder, type PageState, type Redraw } from './project-state.js';
import { timecode } from '../../domain/rate.js';

export function renderInspector(state: PageState): HTMLElement {
  const clip = clipById(state, state.currentClipId);
  const rows: HTMLElement[] = [];
  for (const property of KEYFRAME_PROPERTIES) {
    const value = inspectorValue(state, property);
    rows.push(
      el('div', { class: 'row inspector-row', 'data-prop': property }, [
        el('span', { class: 'muted', text: property }),
        el('span', { class: 'tabular', text: value }),
      ]),
    );
  }
  const kitSelect = el(
    'select',
    { 'aria-label': 'Brand kit', 'data-kit-select': '' },
    state.kits.map((kit) => el('option', { value: kit.id, text: kit.name })),
  );
  return el('section', { class: 'panel inspector', role: 'region', 'aria-label': 'Inspector' }, [
    el('p', { class: 'panel-title', text: clip === undefined ? 'Inspector' : clip.name }),
    ...rows,
    el('div', { class: 'field' }, [kitSelect, el('button', { type: 'button', 'data-apply-kit': '', text: 'Apply kit' })]),
  ]);
}

function inspectorValue(state: PageState, property: KeyframeProperty): string {
  const clip = clipById(state, state.currentClipId);
  if (clip === undefined) return formatTwoDecimals(0);
  const layer = layerClips(state.detail, state.media).find((candidate) => candidate.id === clip.id);
  if (layer === undefined) return formatTwoDecimals(0);
  const frame = state.stageFrame - clip.start_frame;
  return formatTwoDecimals(valueAt(layer, property, frame, state.detail.project.aspect_ratio));
}

export function renderComments(state: PageState, redraw: Redraw): HTMLElement {
  const rate = rateOf(state);
  const canApprove = state.detail.project.role === 'owner' || state.detail.project.role === 'commenter';
  const visible = state.comments;
  const noteBox = el('textarea', { 'aria-label': 'Note', rows: '3', 'data-note-box': '' });
  noteBox.value = state.noteBody;
  const counter = el('span', { class: 'muted tabular', 'data-count': String([...state.noteBody].length) });
  const pin = el('button', { type: 'button', class: 'primary', 'data-pin-note': '', text: 'Pin note' });
  const notes = visible.map((comment) =>
    el('div', { class: 'note', 'data-note': comment.id }, [
      el('p', { class: 'note-author', text: comment.author_name }),
      el('p', { class: 'note-body', text: comment.body }),
      el('p', { class: 'muted tabular', text: timecode(comment.pin.live_frame, rate) }),
      el('button', { type: 'button', 'data-reply': comment.id, text: 'Reply' }),
    ]),
  );
  const panel = el('section', { class: 'panel comments', role: 'region', 'aria-label': 'Comments' }, [
    el('p', { class: 'panel-title', text: 'Comments' }),
    ...(notes.length === 0 ? [el('p', { class: 'empty', text: 'No notes on this cut yet.' })] : notes),
    el('div', { class: 'note-form' }, [
      el('div', { class: 'field' }, [el('label', { for: 'note-box', text: 'Note' }), noteBox]),
      el('div', { role: 'radiogroup', 'aria-label': 'Who can see this', class: 'radiogroup' }, [
        el('button', {
          type: 'button',
          role: 'radio',
          'aria-checked': state.noteVisibility === 'team' ? 'true' : 'false',
          'data-visibility': 'team',
          text: 'Team only',
        }),
        el('button', {
          type: 'button',
          role: 'radio',
          'aria-checked': state.noteVisibility === 'review' ? 'true' : 'false',
          'data-visibility': 'review',
          text: 'Client can see',
        }),
      ]),
      el('p', { class: 'counter' }, [counter, el('span', { text: ` of ${NOTE_LIMIT.toLocaleString('en-GB')}` })]),
      pin,
      canApprove ? el('button', { type: 'button', 'data-approve-cut': '', text: 'Approve cut' }) : null,
    ]),
  ]);
  noteBox.id = 'note-box';

  let draftTimer = 0;
  noteBox.addEventListener('input', () => {
    state.noteBody = noteBox.value;
    const used = [...noteBox.value].length;
    counter.dataset.count = String(used);
    counter.textContent = String(used);
    pin.disabled = used > NOTE_LIMIT || used === 0;
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      void post(`/api/projects/${state.projectId}/comment-draft`, {
        body: noteBox.value,
        frame: state.playhead,
        clip_id: state.currentClipId,
        row_id: clipById(state, state.currentClipId)?.row_id ?? null,
        visibility: state.noteVisibility,
        parent_id: state.replyTo,
      }).catch(() => undefined);
    }, 900);
  });
  pin.disabled = [...state.noteBody].length === 0;
  for (const radio of panel.querySelectorAll<HTMLElement>('[data-visibility]')) {
    radio.addEventListener('click', () => {
      state.noteVisibility = radio.dataset.visibility === 'review' ? 'review' : 'team';
      redraw();
    });
  }
  for (const reply of panel.querySelectorAll<HTMLElement>('[data-reply]')) {
    reply.addEventListener('click', () => {
      state.replyTo = reply.dataset.reply ?? null;
      find<HTMLTextAreaElement>('[data-note-box]')?.focus();
    });
  }
  pin.addEventListener('click', () => {
    notice('Pinning…');
    const frame = state.layout === 'editor' ? state.playhead : state.scrubberFrame;
    const clip = clipById(state, state.currentClipId);
    void post(`/api/projects/${state.projectId}/comments`, {
      body: noteBox.value,
      frame,
      clip_id: state.layout === 'editor' && clip !== undefined ? clip.id : null,
      row_id: state.layout === 'editor' && clip !== undefined ? clip.row_id : null,
      visibility: state.noteVisibility,
      parent_id: state.replyTo,
    })
      .then((record) => {
        const comment = record as (typeof state.comments)[number];
        if (!state.comments.some((candidate) => candidate.id === comment.id)) state.comments = [...state.comments, comment];
        state.noteBody = '';
        state.replyTo = null;
        notice(`Note pinned at ${stamp(state, frame)}.`);
        redraw();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) {
          const errors = error.failure.errors ?? {};
          notice(errors.mention ?? errors.body ?? errors.mentions ?? error.failure.message);
        }
      });
  });
  const approve = find<HTMLButtonElement>('[data-approve-cut]', panel);
  approve?.addEventListener('click', () => {
    const cut = state.cuts[state.cuts.length - 1];
    if (cut === undefined) return;
    notice('Approving…');
    void post(`/api/projects/${state.projectId}/cuts/${cut.id}/approval`)
      .then(() => notice(`${cut.name} approved.`))
      .catch((error: unknown) => {
        if (error instanceof ApiCallError) notice(error.failure.message);
      });
  });
  return panel;
}

export function renderExports(state: PageState, redraw: Redraw): HTMLElement {
  const rows = state.exports.map((record) => {
    const stale = record.stale ? `Stale · from ${record.cut_name}` : record.state;
    return el('div', { class: 'row export-row', 'data-export': record.id }, [
      el('span', { text: `${record.cut_name} ${record.size}p` }),
      el('span', { class: 'muted', 'data-export-state': record.state, text: stale }),
      el('span', { class: 'muted tabular', 'data-export-progress': String(record.progress), text: `${record.progress}%` }),
      record.state === 'queued' || record.state === 'running'
        ? el('button', {
            type: 'button',
            'data-cancel-export': record.id,
            text: `Cancel export ${record.cut_name} ${record.size}p`,
          })
        : null,
      record.state === 'done'
        ? el('a', {
            href: `/api/exports/${record.id}/manifest`,
            'data-manifest': record.id,
            text: `Manifest ${record.cut_name} ${record.size}p`,
          })
        : null,
    ]);
  });
  const panel = el('section', { class: 'panel exports', role: 'region', 'aria-label': 'Exports' }, [
    el('p', { class: 'panel-title', text: 'Exports' }),
    ...(rows.length === 0 ? [el('p', { class: 'empty', text: 'No exports yet.' })] : rows),
  ]);
  for (const button of panel.querySelectorAll<HTMLElement>('[data-cancel-export]')) {
    button.addEventListener('click', () => {
      notice('Cancelling…');
      void post(`/api/exports/${button.dataset.cancelExport}/cancel`)
        .then(() => {
          notice('Export cancelled.');
          redraw();
        })
        .catch((error: unknown) => {
          if (error instanceof ApiCallError) notice(error.failure.message);
        });
    });
  }
  return panel;
}

export function renderClipsList(state: PageState, redraw: Redraw): HTMLElement {
  const rate = rateOf(state);
  const list = el(
    'ul',
    { class: 'clips-list', 'aria-label': 'Clips' },
    timelineOrder(state).map((clip) =>
      el('li', {}, [
        el('button', {
          type: 'button',
          class: 'clip-item',
          'data-clip-id': clip.id,
          text: `${clip.name}, ${timecode(clip.start_frame, rate)} to ${timecode(clip.end_frame, rate)}`,
        }),
      ]),
    ),
  );
  list.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-clip-id]');
    if (button === null) return;
    const clip = clipById(state, button.dataset.clipId ?? null);
    if (clip === undefined) return;
    state.scrubberFrame = clip.start_frame;
    state.currentClipId = clip.id;
    redraw();
  });
  return list;
}

export function renderScrubber(state: PageState, redraw: Redraw): HTMLElement {
  const slider = el('input', {
    type: 'range',
    class: 'scrubber',
    'aria-label': 'Scrubber',
    min: '0',
    max: String(lastFrame(state)),
    value: String(state.scrubberFrame),
    'aria-valuetext': stamp(state, state.scrubberFrame),
  });
  slider.addEventListener('input', () => {
    state.scrubberFrame = Number(slider.value);
    state.stageFrame = state.scrubberFrame;
    redraw();
  });
  return slider;
}

export function applyKit(state: PageState, redraw: Redraw, kitId: string): void {
  void post(`/api/projects/${state.projectId}/ops`, {
    op_id: newOpId(),
    base_version: state.version,
    type: 'apply_kit',
    kit_id: kitId,
  })
    .then(() => {
      notice('Brand kit applied.');
      redraw();
    })
    .catch((error: unknown) => {
      if (error instanceof ApiCallError) notice(error.failure.message);
    });
}
