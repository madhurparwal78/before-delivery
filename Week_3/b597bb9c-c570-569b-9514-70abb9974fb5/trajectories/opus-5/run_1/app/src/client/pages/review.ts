/** The client's review page: scrub, comment and approve from a link. */
import { ApiCallError, post } from '../api.js';
import { clear, el, find } from '../dom.js';
import { exactRate, timecode, type FrameRateName } from '../../domain/rate.js';
import { mount } from '../shell.js';
import { renderStage } from '../stage.js';
import type { ProjectDetail } from '../sheet.js';
import type { AspectRatio, CaptionRecord, ClipRecord, CommentRecord, RowRecord } from '../../shared/types.js';
import type { LayerBase } from '../../domain/layers.js';

interface ReviewPayload {
  project: { title: string; frame_rate: FrameRateName; aspect_ratio: AspectRatio; width: number; height: number };
  owner_name: string;
  cut: {
    id: string;
    name: string;
    total_frames: number;
    rows: RowRecord[];
    clips: (ClipRecord & { base: LayerBase })[];
    captions: CaptionRecord[];
  };
  comments: CommentRecord[];
  approvals: { name: string; at: string }[];
}

const media = new Map();

function layoutFor(width: number): 'review-list' | 'two-pane' {
  return width < 700 ? 'review-list' : 'two-pane';
}

function detailOf(payload: ReviewPayload): ProjectDetail {
  return {
    project: {
      id: 'review',
      title: payload.project.title,
      agency: '',
      description: '',
      frame_rate: payload.project.frame_rate,
      aspect_ratio: payload.project.aspect_ratio,
      width: payload.project.width,
      height: payload.project.height,
      time_unit: 'frames',
      version: 0,
      total_frames: payload.cut.total_frames,
      role: 'commenter',
      markers: [],
      last_cut: null,
    },
    rows: payload.cut.rows,
    clips: payload.cut.clips,
    captions: payload.cut.captions,
  };
}

export function renderReview(token: string): void {
  let payload: ReviewPayload | null = null;
  let frame = 0;
  let etag: string | null = null;
  /** typed text and the last result survive every redraw */
  let reviewerName = '';
  let commentText = '';
  let statusLine = '';

  const state = (text: string): void => {
    statusLine = text;
    const node = find<HTMLElement>('[data-review-status]');
    if (node !== null) node.textContent = text;
  };

  const ended = (copy: string): void => {
    mount(
      el('header', { class: 'band' }, [el('p', { class: 'brand', text: 'Gatecut' })]),
      el('main', { class: 'sheet-area', 'data-layout': layoutFor(window.innerWidth) }, [
        el('p', { class: 'empty', 'data-review-ended': '', text: copy }),
      ]),
    );
  };

  const draw = (): void => {
    if (payload === null) return;
    const detail = detailOf(payload);
    const rate = exactRate(payload.project.frame_rate);
    const clips = [...payload.cut.clips].sort((a, b) => a.start_frame - b.start_frame || a.id.localeCompare(b.id));
    const scrubber = el('input', {
      type: 'range',
      class: 'scrubber',
      'aria-label': 'Scrubber',
      min: '0',
      max: String(Math.max(0, payload.cut.total_frames - 1)),
      value: String(frame),
      'aria-valuetext': timecode(frame, rate),
    });
    scrubber.addEventListener('input', () => {
      frame = Number(scrubber.value);
      scrubber.setAttribute('aria-valuetext', timecode(frame, rate));
      const stage = find<HTMLElement>('[data-stage-host]');
      if (stage !== null) {
        clear(stage);
        stage.append(
          renderStage(detail, media, { mode: 'playhead', frame, interactive: false, lockedRows: new Set(), guide: null }),
        );
      }
    });
    const clipList = el(
      'ul',
      { class: 'clips-list', 'aria-label': 'Clips' },
      clips.map((clip) =>
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
    clipList.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-clip-id]');
      if (button === null) return;
      const clip = clips.find((candidate) => candidate.id === button.dataset.clipId);
      if (clip === undefined) return;
      frame = clip.start_frame;
      scrubber.value = String(frame);
      scrubber.dispatchEvent(new Event('input'));
    });

    const name = el('input', { type: 'text', id: 'reviewer-name', 'aria-label': 'Your name', value: reviewerName });
    const comment = el('textarea', { id: 'reviewer-comment', 'aria-label': 'Comment', rows: '3' });
    comment.value = commentText;
    name.addEventListener('input', () => {
      reviewerName = name.value;
    });
    comment.addEventListener('input', () => {
      commentText = comment.value;
    });
    const send = el('button', { type: 'button', class: 'primary', 'data-send': '', text: 'Send comment' });
    const approve = el('button', { type: 'button', 'data-approve': '', text: 'Approve this cut' });
    const comments = el(
      'section',
      { class: 'panel comments', role: 'region', 'aria-label': 'Comments' },
      payload.comments.length === 0
        ? [el('p', { class: 'empty', text: 'No notes on this cut yet.' })]
        : payload.comments.map((note) =>
            el('div', { class: 'note' }, [
              el('p', { class: 'note-author', text: note.author_name }),
              el('p', { class: 'note-body', text: note.body }),
              el('p', { class: 'muted tabular', text: timecode(note.pin.live_frame, rate) }),
            ]),
          ),
    );

    const main = el('main', { class: 'review', 'data-layout': layoutFor(window.innerWidth), role: 'region', 'aria-label': 'Review' }, [
      el('div', { class: 'review-left' }, [
        el('div', { 'data-stage-host': '' }, [
          renderStage(detail, media, { mode: 'playhead', frame, interactive: false, lockedRows: new Set(), guide: null }),
        ]),
        scrubber,
        clipList,
      ]),
      el('div', { class: 'review-right' }, [
        comments,
        el('div', { class: 'comment-box' }, [
          el('div', { class: 'field' }, [el('label', { for: 'reviewer-name', text: 'Your name' }), name]),
          el('div', { class: 'field' }, [el('label', { for: 'reviewer-comment', text: 'Comment' }), comment]),
        ]),
      ]),
      el('div', { class: 'fixed-bar' }, [send, approve]),
      el('p', {
        class: 'visually-hidden',
        role: 'status',
        'aria-live': 'polite',
        'aria-label': 'Review status',
        'data-review-status': '',
        text: statusLine,
      }),
    ]);

    mount(
      el('header', { class: 'band' }, [
        el('p', { class: 'brand', text: 'Gatecut' }),
        el('p', { text: payload.project.title }),
        el('p', { class: 'muted tabular', text: payload.project.frame_rate }),
        el('p', { text: payload.cut.name }),
      ]),
      main,
    );

    send.addEventListener('click', () => {
      state('Sending…');
      void post<CommentRecord>(`/api/review/${token}/comments`, {
        name: name.value,
        body: comment.value,
        frame,
      })
        .then((record) => {
          commentText = '';
          if (payload !== null && !payload.comments.some((candidate) => candidate.id === record.id)) {
            payload.comments = [...payload.comments, record];
          }
          draw();
          state('Comment sent.');
        })
        .catch((error: unknown) => {
          if (error instanceof ApiCallError) {
            state(error.failure.errors?.name ?? error.failure.errors?.body ?? error.failure.message);
            if (error.failure.status === 410) ended(error.failure.message);
          }
        });
    });
    approve.addEventListener('click', () => {
      state('Approving…');
      void post(`/api/review/${token}/approve`, { name: name.value })
        .then(() => state(`${payload?.cut.name ?? 'This cut'} approved.`))
        .catch((error: unknown) => {
          if (error instanceof ApiCallError) {
            state(error.failure.errors?.name ?? error.failure.message);
            if (error.failure.status === 410) ended(error.failure.message);
          }
        });
    });
  };

  const fetchReview = async (): Promise<void> => {
    const response = await fetch(`/api/review/${token}`, {
      headers: etag === null ? {} : { 'if-none-match': etag },
    });
    if (response.status === 304) return;
    if (response.status === 410) {
      const body = (await response.json()) as { message: string };
      ended(body.message);
      return;
    }
    if (!response.ok) {
      ended('Nothing here. It may have been removed or you may not have access.');
      return;
    }
    etag = response.headers.get('etag');
    payload = (await response.json()) as ReviewPayload;
    frame = Math.min(frame, Math.max(0, payload.cut.total_frames - 1));
    draw();
  };

  void fetchReview();
  window.setInterval(() => void fetchReview().catch(() => undefined), 1000);
  window.addEventListener('resize', () => {
    const main = find<HTMLElement>('main');
    if (main !== null) main.dataset.layout = layoutFor(window.innerWidth);
  });

  const socket = new WebSocket(`${window.location.origin.replace(/^http/, 'ws')}/api/live?review=${encodeURIComponent(token)}`);
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'subscribe_review' })));
  socket.addEventListener('message', () => void fetchReview().catch(() => undefined));
  socket.addEventListener('close', (event) => {
    if (event.code === 4410) void fetchReview().catch(() => undefined);
  });
}
