import {
  ANNOUNCE_COPY,
  BANNER_COPY,
  BOARD_COPY,
  GROUP_LABELS,
  MOVE_COPY,
  ROLE_LABELS,
  SORT_LABELS,
} from '../../shared/copy';
import { permissions } from '../../shared/permissions';
import type {
  BoardDto,
  BoardEvent,
  CommentDto,
  GroupMode,
  Layout,
  PostDto,
  PostsListing,
  ServiceStatus,
  SortMode,
  UserDto,
} from '../../shared/types';
import { api } from '../api';
import { clear, el, on } from '../dom';
import { applyFrameData, createFrame, renderClosedFrame } from '../frames';
import { grow, settle, takeRects } from '../motion';
import { signInLink, signOutButton } from '../shell';
import { addPostDialog, boardSettingsDialog, editPostDialog, membersDialog } from './dialogs';
import { closeLoupeContent, renderLoupe } from './loupe';
import { Mover } from './move';
import { openSlideshow } from './slideshow';

export type BoardMode =
  | { kind: 'board'; boardId: string }
  | { kind: 'share'; token: string }
  | { kind: 'embed'; token: string };

interface SectionNodes {
  section: HTMLElement;
  heading: HTMLElement;
  count: HTMLElement;
  frames: HTMLElement;
}

export interface PostPlace {
  sectionTitle: string;
  position: number;
  total: number;
}

export class BoardView {
  board!: BoardDto;
  listing!: PostsListing;
  display!: PostsListing;
  loupeId: string | null = null;
  readonly mover = new Mover(this);
  readonly announcer = el('div', {
    class: 'announce',
    role: 'status',
    'aria-live': 'polite',
    'aria-label': 'Board announcements',
  });

  private readonly shellNode = el('div', {});
  private readonly sheetNode = el('div', { class: 'sheet' });
  private readonly addPostHolder = el('div', {});
  private readonly sectionNodes = new Map<string, SectionNodes>();
  private readonly frameNodes = new Map<string, HTMLElement>();
  private readonly comments = new Map<string, CommentDto[]>();
  private readonly listeners = new Set<() => void>();
  private shellSignature = '';
  private leaving = false;

  constructor(
    private readonly root: HTMLElement,
    readonly mode: BoardMode,
    readonly me: UserDto | null,
    private services: ServiceStatus,
    readonly uploadMaxBytes: number,
  ) {}

  get embed(): boolean {
    return this.mode.kind === 'embed';
  }

  get role(): BoardDto['role'] {
    return this.board.role;
  }

  get boardPath(): string {
    return this.mode.kind === 'board' ? `/b/${this.mode.boardId}` : `/${this.mode.kind === 'share' ? 's' : 'embed'}/${this.mode.token}`;
  }

  canAddPost(): boolean {
    return !this.embed && this.me !== null && permissions.addPost(this.role);
  }

  canReact(): boolean {
    return !this.embed && this.me !== null && permissions.react(this.role);
  }

  canComment(): boolean {
    return !this.embed && this.me !== null && permissions.comment(this.role);
  }

  canEdit(post: PostDto): boolean {
    return !this.embed && this.me !== null && permissions.editPost(this.role, post.author.id === this.me.id);
  }

  canDelete(post: PostDto): boolean {
    return !this.embed && this.me !== null && permissions.deletePost(this.role, post.author.id === this.me.id);
  }

  canMove(post: PostDto): boolean {
    return !this.embed && this.me !== null && permissions.movePost(this.role, post.author.id === this.me.id);
  }

  canModerate(): boolean {
    return !this.embed && this.me !== null && permissions.moderate(this.role);
  }

  isOwner(): boolean {
    return !this.embed && this.role === 'owner';
  }

  announce(line: string): void {
    this.announcer.textContent = line;
  }

  /** Leaves the board on purpose, so a lost stream does not reload the page underneath. */
  leaveAfter(path: string, work: () => Promise<unknown>): void {
    this.leaving = true;
    void work().then(() => window.location.assign(path));
  }

  async start(): Promise<void> {
    this.root.append(this.shellNode, this.sheetNode, this.addPostHolder, this.announcer);
    await this.load();
    this.render();
    this.connect();
  }

  private async load(): Promise<void> {
    if (this.mode.kind === 'board') {
      const [board, listing] = await Promise.all([
        api.get<BoardDto>(`/api/boards/${this.mode.boardId}`),
        api.get<PostsListing>(`/api/boards/${this.mode.boardId}/posts`),
      ]);
      this.board = board;
      this.listing = listing;
    } else {
      const result = await api.get<{ board: BoardDto; posts: PostsListing }>(`/api/links/${this.mode.token}`);
      this.board = result.board;
      this.listing = result.posts;
    }
    this.display = structuredClone(this.listing);
  }

  async refresh(): Promise<void> {
    await this.load();
    this.render();
  }

  postById(id: string): PostDto | null {
    for (const section of this.listing.sections) {
      const found = section.posts.find((post) => post.id === id);
      if (found !== undefined) return found;
    }
    return this.listing.held.find((post) => post.id === id) ?? null;
  }

  placeOf(id: string): PostPlace | null {
    for (const section of this.display.sections) {
      const index = section.posts.findIndex((post) => post.id === id);
      if (index >= 0) return { sectionTitle: section.title, position: index + 1, total: section.posts.length };
    }
    return null;
  }

  frameFor(id: string): HTMLElement | null {
    return this.frameNodes.get(id) ?? null;
  }

  allFrames(): HTMLElement[] {
    return [...this.frameNodes.values()];
  }

  render(): void {
    this.renderShell();
    this.renderSheet();
    for (const listener of this.listeners) listener();
  }

  private shellKey(): string {
    return JSON.stringify([
      this.board.title,
      this.board.role,
      this.board.layout,
      this.board.sort,
      this.board.group,
      this.board.privacy,
      this.board.approval,
      this.board.link_access,
      this.services,
      this.listing.held.map((post) => [post.id, post.title, post.push]),
      this.canAddPost(),
    ]);
  }

  private renderShell(): void {
    const key = this.shellKey();
    if (key === this.shellSignature) return;
    this.shellSignature = key;
    clear(this.shellNode);
    clear(this.addPostHolder);
    if (this.embed) return;

    const header = el('header', { class: 'header' }, [
      el('a', { href: '/', text: 'Pinsheet' }),
      el('h1', { text: this.board.title }),
    ]);
    const present = el('button', { type: 'button', text: 'Present' });
    on(present, 'click', () => openSlideshow(this, present));
    header.append(present);

    if (this.canModerate()) {
      const exportButton = el('button', { type: 'button', text: 'Export CSV' });
      on(exportButton, 'click', () => {
        window.location.assign(`/api/boards/${this.board.id}/export.csv`);
      });
      header.append(exportButton);
    }
    if (this.isOwner()) {
      const settings = el('button', { type: 'button', text: 'Board settings' });
      on(settings, 'click', () => boardSettingsDialog(this, settings));
      const members = el('button', { type: 'button', text: 'Members' });
      on(members, 'click', () => membersDialog(this, members));
      header.append(settings, members);
    }
    header.append(this.me === null ? signInLink(this.boardPath) : signOutButton());
    this.shellNode.append(header);

    const notice = el('div', { class: 'notice', role: 'region', 'aria-label': 'Service notice' });
    if (!this.services.storage && this.canAddPost()) notice.append(el('p', { text: BANNER_COPY.storage }));
    if (!this.services.push && this.canModerate()) notice.append(el('p', { text: BANNER_COPY.push }));
    if (notice.childElementCount > 0) this.shellNode.append(notice);

    if (this.isOwner()) this.shellNode.append(this.viewToolbar());
    if (this.canModerate()) this.shellNode.append(this.approvalsRegion());
    else if (this.myHeldPosts().length > 0) this.shellNode.append(this.waitingRegion());

    if (this.canAddPost()) {
      const addPost = el('button', { type: 'button', class: 'add-post', text: 'Add post' });
      on(addPost, 'click', () => addPostDialog(this, addPost, null));
      this.addPostHolder.append(addPost);
    }
  }

  private myHeldPosts(): PostDto[] {
    return this.me === null ? [] : this.listing.held.filter((post) => post.author.id === this.me?.id);
  }

  private viewToolbar(): HTMLElement {
    const toolbar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Board view' });
    const layoutGroup = el('fieldset', { role: 'radiogroup', 'aria-label': 'Layout' });
    for (const [value, label] of [
      ['columns', 'Columns'],
      ['rows', 'Rows'],
    ] as Array<[Layout, string]>) {
      const input = el('input', {
        type: 'radio',
        name: 'layout',
        value,
        checked: this.board.layout === value,
        'aria-label': label,
      });
      on(input, 'change', () => void this.saveView({ layout: value }));
      layoutGroup.append(el('label', { class: 'radio-option' }, [input, label]));
    }

    const sort = el('select', { 'aria-label': 'Sort posts' });
    for (const [value, label] of Object.entries(SORT_LABELS)) {
      sort.append(el('option', { value, text: label, selected: this.board.sort === value }));
    }
    on(sort, 'change', () => void this.saveView({ sort: sort.value as SortMode }));

    const group = el('select', { 'aria-label': 'Group posts' });
    for (const [value, label] of Object.entries(GROUP_LABELS)) {
      group.append(el('option', { value, text: label, selected: this.board.group === value }));
    }
    on(group, 'change', () => void this.saveView({ group: group.value as GroupMode }));

    toolbar.append(layoutGroup, el('label', {}, ['Sort posts', sort]), el('label', {}, ['Group posts', group]));
    return toolbar;
  }

  private async saveView(change: Partial<Pick<BoardDto, 'layout' | 'sort' | 'group'>>): Promise<void> {
    await api.patch(`/api/boards/${this.board.id}`, change);
    await this.refresh();
  }

  private approvalsRegion(): HTMLElement {
    const held = this.listing.held;
    const region = el('div', { class: 'region', role: 'region', 'aria-label': 'Approvals' }, [
      el('h2', { text: `Approvals (${held.length})` }),
    ]);
    if (held.length === 0) {
      region.append(el('p', { class: 'empty-line', text: BOARD_COPY.approvalsEmpty }));
      return region;
    }
    const run = el('div', { class: 'held-run' });
    for (const post of held) {
      const frame = this.heldFrame(post);
      const approve = el('button', { type: 'button', 'aria-label': `Approve ${post.title}`, text: 'Approve' });
      const reject = el('button', { type: 'button', 'aria-label': `Reject ${post.title}`, text: 'Reject' });
      on(approve, 'click', () => void this.decide(post, 'approve'));
      on(reject, 'click', () => void this.decide(post, 'reject'));
      const item = el('div', { class: 'held-item' }, [frame, el('div', { class: 'row' }, [approve, reject])]);
      if (post.push === 'pending') item.append(el('p', { class: 'muted', text: BOARD_COPY.pushPending }));
      run.append(item);
    }
    region.append(run);
    return region;
  }

  private waitingRegion(): HTMLElement {
    const region = el('div', { class: 'region', role: 'region', 'aria-label': 'Waiting for approval' }, [
      el('h2', { text: 'Waiting for approval' }),
      el('p', { class: 'muted', text: BOARD_COPY.heldNote }),
    ]);
    const run = el('div', { class: 'held-run' });
    for (const post of this.myHeldPosts()) run.append(this.heldFrame(post));
    region.append(run);
    return region;
  }

  private heldFrame(post: PostDto): HTMLElement {
    const frame = createFrame(post);
    applyFrameData(frame, post, post.section_id, null);
    renderClosedFrame(frame, post);
    this.bindFrame(frame, post.id);
    this.frameNodes.set(post.id, frame);
    return frame;
  }

  private async decide(post: PostDto, action: 'approve' | 'reject'): Promise<void> {
    const held = this.listing.held;
    const index = held.findIndex((item) => item.id === post.id);
    await api.post(`/api/posts/${post.id}/${action}`);
    await this.refresh();
    const next = this.listing.held[index] ?? this.listing.held[index - 1] ?? null;
    if (next !== null) {
      this.shellNode.querySelector<HTMLElement>(`[aria-label="Approve ${next.title}"]`)?.focus();
    } else {
      const heading = this.shellNode.querySelector<HTMLElement>('[aria-label="Approvals"] h2');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus();
    }
  }

  private renderSheet(): void {
    const before = takeRects(this.allFrames());
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.sheetNode.setAttribute('data-layout', this.board.layout);
    const seenSections = new Set<string>();
    const seenPosts = new Set<string>();
    const published = this.display.sections.reduce((total, section) => total + section.posts.length, 0);

    for (const [index, section] of this.display.sections.entries()) {
      seenSections.add(section.id);
      let nodes = this.sectionNodes.get(section.id);
      if (nodes === undefined) {
        const heading = el('h2', { text: section.title, id: `section-${section.id}` });
        const count = el('span', { class: 'muted' });
        const frames = el('div', { class: 'frames' });
        const sectionNode = el('section', {
          class: 'section',
          role: 'region',
          'aria-labelledby': heading.id,
          'data-section-id': section.id,
        });
        sectionNode.append(el('div', { class: 'section-head' }, [heading, count]), frames);
        on(frames, 'dblclick', (event) => {
          if ((event.target as HTMLElement).closest('.frame') !== null) return;
          if (this.canAddPost()) addPostDialog(this, frames, section.id);
        });
        nodes = { section: sectionNode, heading, count, frames };
        this.sectionNodes.set(section.id, nodes);
      }
      nodes.heading.textContent = section.title;
      nodes.count.textContent = String(section.count);
      nodes.section.setAttribute('data-count', String(section.count));
      if (this.sheetNode.children[index] !== nodes.section) this.sheetNode.insertBefore(nodes.section, this.sheetNode.children[index] ?? null);

      const wanted: HTMLElement[] = [];
      for (const [postIndex, post] of section.posts.entries()) {
        seenPosts.add(post.id);
        let frame = this.frameNodes.get(post.id);
        if (frame === undefined || !frame.classList.contains('frame')) {
          frame = createFrame(post);
          this.bindFrame(frame, post.id);
          this.frameNodes.set(post.id, frame);
        }
        applyFrameData(frame, post, section.id, postIndex + 1);
        if (this.loupeId === post.id) renderLoupe(this, frame, post);
        else renderClosedFrame(frame, post);
        frame.setAttribute('data-loupe', this.loupeId === post.id ? 'open' : 'closed');
        frame.classList.toggle('dimmed', this.loupeId !== null && this.loupeId !== post.id);
        wanted.push(frame);
      }
      if (published === 0 && index === 0) {
        nodes.frames.replaceChildren(el('p', { class: 'empty-line', text: BOARD_COPY.empty }));
      } else {
        const current = [...nodes.frames.children];
        const sameOrder = current.length === wanted.length && wanted.every((frame, slot) => current[slot] === frame);
        if (!sameOrder) nodes.frames.replaceChildren(...wanted);
      }
    }

    for (const [id, nodes] of this.sectionNodes) {
      if (!seenSections.has(id)) {
        nodes.section.remove();
        this.sectionNodes.delete(id);
      }
    }
    for (const [id, frame] of this.frameNodes) {
      if (!seenPosts.has(id) && !this.listing.held.some((post) => post.id === id)) {
        frame.remove();
        this.frameNodes.delete(id);
      }
    }
    if (active !== null && active.isConnected && document.activeElement !== active) active.focus();
    settle(before, this.allFrames());
  }

  private bindFrame(frame: HTMLElement, postId: string): void {
    on(frame, 'click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('button, a, input, textarea, select') !== null) return;
      if (this.loupeId === postId) this.closeLoupe();
      else this.openLoupe(postId);
    });
    on(frame, 'keydown', (event) => {
      this.onFrameKey(event, postId);
    });
    this.mover.bindFrame(frame, postId);
  }

  private onFrameKey(event: KeyboardEvent, postId: string): void {
    const target = event.target as HTMLElement;
    const inControl = target.closest('button, a, input, textarea, select') !== null;
    if (event.key === 'Escape') {
      if (this.mover.holding !== null) {
        event.preventDefault();
        this.mover.cancel();
        return;
      }
      if (this.loupeId === postId) {
        event.preventDefault();
        this.closeLoupe();
      }
      return;
    }
    if (inControl) return;
    if (event.key === 'Enter' && this.mover.holding === null) {
      event.preventDefault();
      this.openLoupe(postId);
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (this.mover.holding !== null) void this.mover.drop();
      else if (this.loupeId !== postId) this.mover.pickUp(postId);
      return;
    }
    if (this.mover.holding === null) return;
    const steps: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    this.mover.step(step);
  }

  openLoupe(postId: string, focusHeading = true): void {
    const post = this.postById(postId);
    if (post === null || post.state !== 'published') return;
    const previous = this.loupeId;
    this.loupeId = postId;
    const frame = this.frameFor(postId);
    const fromRect = frame?.getBoundingClientRect() ?? null;
    if (previous !== null && previous !== postId) {
      const previousFrame = this.frameFor(previous);
      if (previousFrame !== null) closeLoupeContent(previousFrame);
    }
    void this.loadComments(postId);
    this.renderSheet();
    const openFrame = this.frameFor(postId);
    if (openFrame !== null && fromRect !== null) grow(openFrame, fromRect);
    if (focusHeading) openFrame?.querySelector<HTMLElement>('h2')?.focus();
  }

  closeLoupe(focusFrame = true): void {
    const postId = this.loupeId;
    if (postId === null) return;
    this.loupeId = null;
    const frame = this.frameFor(postId);
    if (frame !== null) closeLoupeContent(frame);
    const before = takeRects(this.allFrames());
    this.renderSheet();
    settle(before, this.allFrames());
    if (focusFrame) this.frameFor(postId)?.focus();
  }

  commentsFor(postId: string): CommentDto[] {
    return this.comments.get(postId) ?? [];
  }

  addComment(postId: string, comment: CommentDto): void {
    const list = this.comments.get(postId) ?? [];
    if (!list.some((item) => item.id === comment.id)) list.push(comment);
    this.comments.set(postId, list);
  }

  private async loadComments(postId: string): Promise<void> {
    const result = await api.get<{ comments: CommentDto[] }>(`/api/posts/${postId}/comments`);
    this.comments.set(postId, result.comments);
    if (this.loupeId === postId) this.renderSheet();
  }

  onUpdate(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  editPost(post: PostDto, opener: HTMLElement): void {
    editPostDialog(this, post, opener);
  }

  async deletePost(post: PostDto): Promise<void> {
    const place = this.placeOf(post.id);
    await api.del(`/api/posts/${post.id}`);
    if (this.loupeId === post.id) this.loupeId = null;
    await this.refresh();
    this.announce(ANNOUNCE_COPY.youDeleted(post.title));
    if (place === null) return;
    const section = this.display.sections.find((candidate) => candidate.title === place.sectionTitle);
    const next = section?.posts[place.position - 1] ?? section?.posts[place.position - 2] ?? null;
    if (next !== null) this.frameFor(next.id)?.focus();
    else if (section !== undefined) {
      const heading = this.sectionNodes.get(section.id)?.heading;
      heading?.setAttribute('tabindex', '-1');
      heading?.focus();
    }
  }

  private connect(): void {
    const path =
      this.mode.kind === 'board' ? `/api/boards/${this.mode.boardId}/events` : `/api/links/${this.mode.token}/events`;
    const stream = new EventSource(path, { withCredentials: true });
    stream.addEventListener('access_lost', () => {
      stream.close();
      if (!this.leaving) window.location.reload();
    });
    stream.addEventListener('message', (event) => {
      const parsed = JSON.parse((event as MessageEvent<string>).data) as BoardEvent;
      void this.onEvent(parsed);
    });
  }

  private pending: BoardEvent[] = [];
  private refreshing: Promise<void> | null = null;

  private async onEvent(event: BoardEvent): Promise<void> {
    if (event.kind === 'services') {
      this.services = event.services;
      this.renderShell();
      return;
    }
    this.pending.push(event);
    if (this.refreshing !== null) return;
    this.refreshing = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const events = this.pending;
      this.pending = [];
      for (const item of events) {
        if (item.kind === 'comment') {
          const list = this.comments.get(item.post_id);
          if (list !== undefined && !list.some((comment) => comment.id === item.comment.id)) list.push(item.comment);
        }
      }
      const holding = this.mover.holding;
      const deletedHeld = events.some((item) => item.kind === 'post_deleted' && item.post_id === holding?.postId);
      const keepDisplay = holding !== null && !deletedHeld;
      const display = this.display;
      await this.load();
      if (deletedHeld) this.mover.endHold();
      if (keepDisplay) this.display = display;
      this.render();
      for (const item of events) this.speak(item);
      this.refreshing = null;
      if (this.pending.length > 0) {
        const queued = this.pending;
        this.pending = [];
        for (const item of queued) void this.onEvent(item);
      }
    })();
  }

  private speak(event: BoardEvent): void {
    const mine = this.me?.id ?? null;
    switch (event.kind) {
      case 'post_created':
        if (event.actor_id !== mine) this.announce(ANNOUNCE_COPY.newPost(event.actor_name, event.title));
        return;
      case 'post_moved': {
        if (event.actor_id === mine) return;
        if (this.loupeId !== event.post_id) return;
        const place = this.placeOf(event.post_id);
        if (place === null) return;
        this.announce(MOVE_COPY.loupeMove(event.title, place.sectionTitle, place.position, place.total));
        return;
      }
      case 'post_deleted':
        if (event.actor_id === mine) return;
        if (this.loupeId === event.post_id || this.mover.lastHeldId === event.post_id) {
          if (this.loupeId === event.post_id) this.loupeId = null;
          this.announce(ANNOUNCE_COPY.deletedElsewhere(event.title));
        }
        return;
      case 'post_approved':
        if (event.author_id === mine) this.announce(ANNOUNCE_COPY.approved(event.title));
        return;
      case 'post_rejected':
        if (event.author_id === mine) this.announce(ANNOUNCE_COPY.rejected(event.title));
        return;
      case 'role_changed':
        if (event.user_id === mine && event.role !== null && event.role !== 'owner') {
          this.announce(ANNOUNCE_COPY.roleChanged(event.board_title, ROLE_LABELS[event.role]));
        }
        return;
      case 'comment':
      case 'reaction':
      case 'post_updated':
      case 'post_push':
      case 'board_updated':
        return;
      default:
        return;
    }
  }
}
