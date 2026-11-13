import {
  ApiCallError,
  CommentResponse,
  KeyedAction,
  NoAnswerError,
  RoomResponse,
  Solid,
  appConfig,
  me,
  send,
} from '../api';
import { clear, el, find, on } from '../dom';
import { Epoch, Viewport } from '../viewport';
import { openLiveStream, showStorageBanner } from '../ui';
import { graphemeLength } from '../../shared/order';
import { boxOfBbox } from '../../shared/pose';

export async function mountRoom(host: HTMLElement): Promise<void> {
  const roomId = host.dataset.room ?? '';
  const settings = await appConfig();
  const viewer = await me();
  const answer = await send<{ room: RoomResponse; comments: CommentResponse[] }>(
    `/api/rooms/${roomId}`,
  );
  let room = answer.data.room;
  let comments = answer.data.comments;
  const owner = viewer !== null && viewer.id === room.createdBy;

  const heading = el('h1', {}, [room.title]);
  const leader = find('[data-ui="dimension-leader"]');
  if (leader) heading.append(leader);
  const reviewing = el('p', { class: 'muted', 'data-ui': 'reviewing' });
  const stateText = el('p', { 'data-ui': 'room-state' });
  const progress = el('p', { 'data-ui': 'room-progress' });
  const reasonLine = el('p', { class: 'muted', 'data-ui': 'room-reason' });
  const activity = el('p', { role: 'status', 'aria-label': 'Room activity', class: 'status-line' });

  const viewport = new Viewport({ epochKey: `tinework:epoch:room:${roomId}`, fallbackAlt: room.title });
  const threads = el('div', {
    role: 'listbox',
    'aria-label': 'Threads',
    tabindex: '0',
    class: 'threads',
    'data-epoch': '0',
  });
  const threadsEpoch = new Epoch(`tinework:epoch:threads:${roomId}`);
  threads.setAttribute('data-epoch', String(threadsEpoch.current()));

  const addComment = el('button', { type: 'button', 'aria-pressed': 'false' }, ['Add comment']);
  const commentOnView = el('button', { type: 'button' }, ['Comment on this view']);
  const commentBox = el('textarea', { 'aria-label': 'Comment', rows: '3', class: 'comment-box' });
  const counter = el('p', { class: 'muted', 'data-ui': 'comment-counter' });
  const commentNote = el('p', { class: 'field-error', 'data-ui': 'comment-note' });
  const post = el('button', { type: 'button', class: 'button-primary' }, ['Post comment']);
  const approveButton = el('button', { type: 'button', class: 'button-primary' }, ['Approve']);
  const closeButton = el('button', { type: 'button' }, ['Close room']);

  const side = el('div', { class: 'room-side' }, [
    threads,
    el('div', { class: 'composer' }, [addComment, commentOnView, commentBox, counter, commentNote, post]),
  ]);

  host.append(
    el('div', { class: 'room-head' }, [heading, reviewing, stateText, progress, reasonLine]),
    el('div', { class: 'room-actions' }, [approveButton, closeButton]),
    el('div', { class: 'room-layout' }, [el('div', { class: 'room-main' }, []), side]),
    activity,
  );
  const main = find<HTMLElement>('.room-main', host)!;
  viewport.mount(main);

  let anchor: { kind: 'point'; position: [number, number, number] } | { kind: 'none' } = { kind: 'none' };
  let selectedThread: string | null = null;

  function headLabel(): string {
    return host.dataset.headLabel ?? '';
  }

  async function paintHead(): Promise<void> {
    const revision = await send<{
      revision: { label: string; geometryDigest: string; id: string; bbox?: number[] };
      slug: string;
    }>(`/api/parts/${room.partSlug}?revision=${room.headRevisionId}`);
    host.dataset.headLabel = revision.data.revision.label;
    reviewing.textContent = `Reviewing ${revision.data.revision.label}`;
    approveButton.textContent = `Approve ${revision.data.revision.label}`;
    approveButton.setAttribute('aria-label', `Approve ${revision.data.revision.label}`);
    try {
      const solid = await send<Solid>(`/api/solids/${revision.data.revision.geometryDigest}`);
      const box = solid.data.ops.find((op) => op.op === 'box' || op.op === 'cylinder');
      viewport.setSolid(solid.data);
      if (box) {
        const bbox: [number, number, number] =
          box.op === 'box' ? [box.w, box.d, box.h] : [box.dia, box.dia, box.h];
        viewport.setDefaultPose(viewport.poseForBox(boxOfBbox(bbox)), true);
      }
      viewport.paint();
    } catch (error) {
      if (error instanceof ApiCallError && error.failure.code === 'storage_unavailable') {
        showStorageBanner();
        viewport.setOutage(true, 'Last good solid: none yet');
      }
    }
  }

  function paintState(): void {
    stateText.textContent =
      room.state === 'approved' ? 'Approved' : room.state === 'closed' ? 'Closed' : 'Open';
    progress.textContent = `Approvals ${room.approvals.length} of ${room.requiredApprovals}`;
    approveButton.hidden = owner;
    closeButton.hidden = !owner;
  }

  function paintThreads(): void {
    clear(threads);
    for (const comment of comments) {
      const option = el(
        'div',
        {
          role: 'option',
          id: `thread-${comment.id}`,
          'aria-selected': comment.id === selectedThread ? 'true' : 'false',
          class: 'thread-option',
        },
        [`${comment.author.displayName}: ${comment.body}`],
      );
      on(option, 'click', () => selectThread(comment));
      threads.append(option);
    }
  }

  function selectThread(comment: CommentResponse): void {
    selectedThread = comment.id;
    threads.setAttribute('aria-activedescendant', `thread-${comment.id}`);
    for (const node of threads.children) {
      node.setAttribute('aria-selected', node.id === `thread-${comment.id}` ? 'true' : 'false');
    }
    viewport.glideTo(comment.pose);
  }

  on(threads, 'keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    if (keyboard.isComposing || comments.length === 0) return;
    const index = comments.findIndex((comment) => comment.id === selectedThread);
    if (keyboard.key === 'ArrowDown') {
      keyboard.preventDefault();
      selectThread(comments[Math.min(comments.length - 1, index + 1)]);
    } else if (keyboard.key === 'ArrowUp') {
      keyboard.preventDefault();
      selectThread(comments[Math.max(0, index - 1)]);
    } else if (keyboard.key === 'Enter' && index >= 0) {
      keyboard.preventDefault();
      selectThread(comments[index]);
    }
  });

  function addCommentOption(comment: CommentResponse): void {
    if (comments.some((candidate) => candidate.id === comment.id)) return;
    comments = [...comments, comment];
    paintThreads();
    threads.setAttribute('data-epoch', String(threadsEpoch.advance()));
  }

  function paintCounter(): void {
    const left = settings.commentMaxChars - graphemeLength(commentBox.value);
    counter.textContent = left >= 0 ? `${left} characters left` : `${-left} characters over`;
    post.disabled = left < 0;
  }

  on(commentBox, 'input', () => paintCounter());
  paintCounter();

  on(addComment, 'click', () => {
    const pressed = addComment.getAttribute('aria-pressed') === 'true';
    addComment.setAttribute('aria-pressed', pressed ? 'false' : 'true');
  });

  on(viewport.canvas, 'click', () => {
    if (addComment.getAttribute('aria-pressed') !== 'true') return;
    const pose = viewport.getPose();
    anchor = { kind: 'point', position: pose.target };
    addComment.setAttribute('aria-pressed', 'false');
    commentBox.focus();
  });

  on(commentOnView, 'click', () => {
    anchor = { kind: 'none' };
    commentBox.focus();
  });

  const commentAction = new KeyedAction();

  on(post, 'click', async () => {
    const pose = viewport.getPose();
    const body = { body: commentBox.value, anchor, pose };
    commentNote.textContent = '';
    try {
      const result = await send<CommentResponse>(`/api/rooms/${roomId}/comments`, {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': commentAction.keyFor(body) },
      });
      commentAction.settled();
      addCommentOption(result.data);
      commentBox.value = '';
      anchor = { kind: 'none' };
      paintCounter();
    } catch (error) {
      if (error instanceof NoAnswerError) {
        commentNote.textContent = 'Not sent yet. Try again.';
        return;
      }
      commentAction.settled();
      if (error instanceof ApiCallError) commentNote.textContent = error.failure.message;
    }
  });

  const approveAction = new KeyedAction();

  on(approveButton, 'click', async () => {
    const body = { revisionId: room.headRevisionId };
    try {
      const result = await send<RoomResponse>(`/api/rooms/${roomId}/approvals`, {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': approveAction.keyFor(body) },
      });
      approveAction.settled();
      room = result.data;
      paintState();
    } catch (error) {
      if (error instanceof NoAnswerError) return;
      approveAction.settled();
      if (error instanceof ApiCallError) activity.textContent = error.failure.message;
    }
  });

  on(closeButton, 'click', async () => {
    try {
      const result = await send<RoomResponse>(`/api/rooms/${roomId}/close`, { method: 'POST', body: {} });
      room = result.data;
      paintState();
    } catch (error) {
      if (error instanceof ApiCallError) activity.textContent = error.failure.message;
    }
  });

  openLiveStream(room.partSlug, {
    comment: (data) => {
      const comment = (data.comment as CommentResponse);
      if (comment.roomId !== roomId) return;
      addCommentOption(comment);
      if (!viewer || comment.author.id !== viewer.id) {
        activity.textContent = `New comment from ${comment.author.displayName}.`;
      }
    },
    approvals: (data) => {
      const next = data.room as RoomResponse;
      if (next.id !== roomId) return;
      room = next;
      paintState();
      const label = String(data.label ?? '');
      const reason = String(data.reason ?? '');
      const displayName = data.displayName === null ? '' : String(data.displayName);
      let line = '';
      if (reason === 'approved') line = `${displayName} approved ${label}.`;
      else if (reason === 'reset') line = `Approvals reset: ${label} changed the part.`;
      else if (reason === 'carried') line = `${label} has the same geometry; approvals carried over.`;
      else if (reason === 'matched') line = `${label} matches approved geometry; approvals count again.`;
      if (line) {
        activity.textContent = line;
        if (reason !== 'approved') reasonLine.textContent = line;
      }
    },
    revision: (data) => {
      void data;
      void paintHead();
    },
  });

  paintState();
  paintThreads();
  await paintHead();
  void headLabel;
}
