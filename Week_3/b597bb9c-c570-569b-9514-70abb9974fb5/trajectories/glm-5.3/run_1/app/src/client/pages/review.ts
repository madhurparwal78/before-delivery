import { api } from '../api';
import { el, announce, copy, layoutMode } from '../ui';
import type { Clip, Comment, Approval, ReviewResponse } from '../../shared/types';
import { timecode } from '../../shared/frames';

/** The client review page: the token is the only credential. */
export async function renderReview(token: string, root: HTMLElement): Promise<HTMLElement> {
  const main = el('main', null);
  let review: ReviewResponse;
  try {
    const response = await fetch(`/api/review/${token}`, { credentials: 'same-origin' });
    if (response.status === 410 || response.status === 404) {
      const body = await response.json() as { message?: string };
      main.append(el('div', { role: 'status', 'aria-label': 'Review status', id: 'status-review-status', class: 'notices', text: body.message ?? '' }));
      return main;
    }
    review = await response.json() as ReviewResponse;
  } catch {
    main.append(el('p', { text: 'Nothing here. It may have been removed or you may not have access.' }));
    return main;
  }
  const statusStrip = el('div', { role: 'status', 'aria-label': 'Review status', id: 'status-review-status', class: 'notices' });
  const band = el('header', { class: 'band no-hero' });
  band.append(
    el('span', { class: 'brand', text: review.project.title }),
    el('span', { class: 'muted', text: `${review.project.frame_rate} · ${review.project.aspect_ratio} · ${review.cut.name}` }),
  );
  main.append(statusStrip, band);

  const reviewRegion = el('section', { role: 'region', 'aria-label': 'Review' });
  main.append(reviewRegion);
  let frame = 0;
  const total = review.cut.total_frames;
  const scrubber = el('input', { type: 'range', min: '0', max: String(Math.max(0, total - 1)), value: '0', 'aria-label': 'Scrubber' });
  const clipsList = el('ul', { class: 'list', role: 'list', 'aria-label': 'Clips' });
  const commentsPanel = el('section', { role: 'region', 'aria-label': 'Comments' });
  const name = el('input', { type: 'text', 'aria-label': 'Your name' });
  const commentBox = el('textarea', { 'aria-label': 'Comment', rows: '3' });
  const send = el('button', { class: 'btn primary', text: 'Send comment' });
  const approve = el('button', { class: 'btn', text: 'Approve this cut' });

  function tcNow(): string {
    return timecode(frame, review.project.frame_rate);
  }
  scrubber.setAttribute('aria-valuetext', tcNow());

  function draw(): void {
    const layout = layoutMode(window.innerWidth);
    reviewRegion.textContent = '';
    const grid = el('div', { class: layout === 'review-list' ? 'review-list' : 'two-pane' });
    const left = el('div');
    const stage = el('div', { class: 'stage', style: `aspect-ratio: ${review.project.width} / ${review.project.height}` });
    stage.setAttribute('data-stage-mode', 'playhead');
    stage.setAttribute('data-stage-frame', String(frame));
    for (const clip of review.cut.clips as Clip[]) {
      if (clip.hidden || frame < clip.start_frame || frame >= clip.end_frame) continue;
      const box = stageLayer(clip, review);
      stage.append(box);
    }
    left.append(stage, scrubber, clipsList);
    const right = el('div');
    right.append(commentsPanel);
    const form = el('div', { class: 'review-comment-box' });
    form.append(
      el('label', { class: 'field' }, el('span', { text: 'Your name' }), name),
      el('label', { class: 'field' }, el('span', { text: 'Comment' }), commentBox),
      el('div', { class: 'review-bar' }, send, approve),
    );
    if (layout === 'review-list') {
      grid.append(left, right, form);
    } else {
      grid.append(left, el('div', null, right, form));
    }
    reviewRegion.append(grid);
    main.setAttribute('data-layout', layout);
  }

  function drawClips(): void {
    clipsList.textContent = '';
    const ordered = [...review.cut.clips].sort((a, b) => a.start_frame - b.start_frame);
    for (const clip of ordered) {
      const button = el('button', {
        class: 'btn',
        text: `${clip.name}, ${timecode(clip.start_frame, review.project.frame_rate)} to ${timecode(clip.end_frame, review.project.frame_rate)}`,
      });
      button.addEventListener('click', () => {
        frame = clip.start_frame;
        scrubber.value = String(frame);
        scrubber.setAttribute('aria-valuetext', tcNow());
        draw();
      });
      clipsList.append(el('li', null, button));
    }
  }

  function drawComments(items: Comment[], approvals: Approval[]): void {
    commentsPanel.textContent = '';
    commentsPanel.append(el('h3', { text: 'Comments' }));
    if (approvals.length > 0) {
      commentsPanel.append(el('p', { class: 'muted', text: `Approved by ${approvals.map((a) => a.name).join(', ')}` }));
    }
    if (items.length === 0) {
      commentsPanel.append(el('p', { class: 'muted', text: 'No notes on this cut yet.' }));
      return;
    }
    const list = el('ul', { class: 'list' });
    for (const item of items) {
      list.append(el('li', { text: `${item.author_name} at ${timecode(item.pin.live_frame, review.project.frame_rate)}: ${item.body}` }));
    }
    commentsPanel.append(list);
  }

  scrubber.addEventListener('input', () => {
    frame = Number(scrubber.value);
    scrubber.setAttribute('aria-valuetext', tcNow());
    draw();
  });

  send.addEventListener('click', () => {
    void (async () => {
      announce('Review status', copy.sending());
      try {
        await api.sendReviewComment(token, name.value, commentBox.value, frame);
        announce('Review status', copy.commentSent());
        commentBox.value = '';
        const fresh = await api.review(token);
        review = fresh;
        drawComments(fresh.comments, fresh.approvals);
      } catch (err) {
        const body = (err as { body?: { message?: string } }).body;
        announce('Review status', body?.message ?? 'Check the highlighted fields.');
      }
    })();
  });

  approve.addEventListener('click', () => {
    void (async () => {
      announce('Review status', copy.approving());
      try {
        const result = await api.approveReview(token, name.value);
        drawComments(review.comments, result.approvals as Approval[]);
      } catch (err) {
        const body = (err as { body?: { message?: string } }).body;
        announce('Review status', body?.message ?? 'Check the highlighted fields.');
      }
    })();
  });

  drawClips();
  drawComments(review.comments, review.approvals as Approval[]);
  draw();
  void root;

  // One socket per review page; on revoke or expiry the server closes 4410.
  openReviewSocket(token, statusStrip, () => {
    window.location.reload();
  });
  return main;
}

function stageLayer(clip: Clip, review: ReviewResponse): HTMLElement {
  const box = el('div', { class: 'layer', 'data-layer-box': clip.id });
  const sha = clip.media_id ?? '';
  box.style.background = `#${sha.slice(0, 6).padEnd(6, '0')}`;
  const width = review.project.width;
  const height = review.project.height;
  const ratio = clip.kind === 'text'
    ? { w: 0.6, h: 0.12 }
    : { w: 1, h: 1 };
  void ratio;
  const w = (width * 0.5) | 0;
  const h = (height * 0.28) | 0;
  box.style.width = `${(w / width) * 100}%`;
  box.style.height = `${(h / height) * 100}%`;
  box.style.left = '25%';
  box.style.top = '36%';
  if (clip.kind === 'text') box.append(el('span', { text: clip.text ?? '' }));
  return box;
}

function openReviewSocket(token: string, status: HTMLElement, onEnd: () => void): void {
  const socket = new WebSocket(`/api/live?review=${encodeURIComponent(token)}`);
  socket.addEventListener('close', (event) => {
    if (event.code === 4410) {
      status.textContent = 'This review link was turned off. Ask the owner for a new one.';
      onEnd();
    }
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data as string) as { type: string };
    if (message.type === 'cut_shared') {
      window.location.reload();
    }
  });
}
