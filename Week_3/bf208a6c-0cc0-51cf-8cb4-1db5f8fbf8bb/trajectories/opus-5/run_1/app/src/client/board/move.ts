import { MOVE_COPY, SORT_LABELS } from '../../shared/copy';
import type { PostDto, PostsListing } from '../../shared/types';
import { RequestFailed, api } from '../api';
import { on } from '../dom';
import type { BoardView } from './view';

type Direction = 'up' | 'down' | 'left' | 'right';

interface Hold {
  postId: string;
  version: number;
  originSectionId: string;
  originPosition: number;
}

const DRAG_THRESHOLD = 8;
const LONG_PRESS_MS = 500;

export class Mover {
  holding: Hold | null = null;
  lastHeldId: string | null = null;
  private blockedReason: string | null = null;
  private aim: { sectionIndex: number; position: number } | null = null;

  constructor(private readonly view: BoardView) {}

  private sections(): PostsListing['sections'] {
    return this.view.display.sections;
  }

  private locate(postId: string): { sectionIndex: number; postIndex: number } | null {
    for (const [sectionIndex, section] of this.sections().entries()) {
      const postIndex = section.posts.findIndex((post) => post.id === postId);
      if (postIndex >= 0) return { sectionIndex, postIndex };
    }
    return null;
  }

  private announcePlace(line: (title: string, section: string, p: number, n: number) => string): void {
    const hold = this.holding;
    if (hold === null) return;
    const spot = this.locate(hold.postId);
    if (spot === null) return;
    const section = this.sections()[spot.sectionIndex];
    const post = section.posts[spot.postIndex];
    this.view.announce(line(post.title, section.title, spot.postIndex + 1, section.posts.length));
  }

  pickUp(postId: string, viaDrag = false): boolean {
    if (this.holding !== null) return false;
    const post = this.view.postById(postId);
    if (post === null || post.state !== 'published' || !this.view.canMove(post)) return false;
    if (this.view.board.group === 'author') {
      this.view.announce(MOVE_COPY.groupBlocked());
      return false;
    }
    this.view.display = structuredClone(this.view.listing);
    const spot = this.locate(postId);
    if (spot === null) return false;
    this.holding = {
      postId,
      version: post.version,
      originSectionId: this.sections()[spot.sectionIndex].id,
      originPosition: spot.postIndex + 1,
    };
    this.lastHeldId = postId;
    this.blockedReason = null;
    const frame = this.view.frameFor(postId);
    frame?.setAttribute('data-moving', 'true');
    if (!viaDrag) frame?.focus();
    this.announcePlace(MOVE_COPY.pickUp);
    return true;
  }

  step(direction: Direction): void {
    const hold = this.holding;
    if (hold === null) return;
    const withinSection =
      this.view.board.layout === 'columns' ? direction === 'up' || direction === 'down' : direction === 'left' || direction === 'right';
    const spot = this.locate(hold.postId);
    if (spot === null) return;

    if (withinSection) {
      if (this.view.board.sort !== 'by_hand') {
        this.view.announce(MOVE_COPY.sortBlocked(SORT_LABELS[this.view.board.sort]));
        return;
      }
      const forward = direction === 'down' || direction === 'right';
      const section = this.sections()[spot.sectionIndex];
      const target = Math.min(Math.max(spot.postIndex + (forward ? 1 : -1), 0), section.posts.length - 1);
      this.place(spot.sectionIndex, target + 1);
      return;
    }

    const forward = direction === 'right' || direction === 'down';
    const targetSection = Math.min(Math.max(spot.sectionIndex + (forward ? 1 : -1), 0), this.sections().length - 1);
    if (targetSection === spot.sectionIndex) {
      this.announcePlace(MOVE_COPY.step);
      return;
    }
    const room = this.sections()[targetSection].posts.length + 1;
    this.place(targetSection, Math.min(spot.postIndex + 1, room));
  }

  /** Puts the held post at a section and 1-based position in the displayed arrangement. */
  private place(sectionIndex: number, position: number): void {
    const hold = this.holding;
    if (hold === null) return;
    const spot = this.locate(hold.postId);
    if (spot === null) return;
    const from = this.sections()[spot.sectionIndex];
    const [post] = from.posts.splice(spot.postIndex, 1);
    from.count = from.posts.length;
    const to = this.sections()[sectionIndex];
    to.posts.splice(position - 1, 0, post);
    to.count = to.posts.length;
    this.view.render();
    this.view.frameFor(hold.postId)?.focus();
    this.announcePlace(MOVE_COPY.step);
  }

  /** A drag aims at a slot without reflowing the sheet; the drop settles it. */
  private aimAt(x: number, y: number): void {
    const hold = this.holding;
    if (hold === null) return;
    const node = document.elementFromPoint(x, y);
    if (node === null) return;
    const overSection = node.closest<HTMLElement>('.section');
    if (overSection === null) return;
    const sectionId = overSection.getAttribute('data-section-id');
    const sectionIndex = this.sections().findIndex((section) => section.id === sectionId);
    if (sectionIndex < 0) return;
    const spot = this.locate(hold.postId);
    if (spot === null) return;
    if (sectionIndex === spot.sectionIndex && this.view.board.sort !== 'by_hand') {
      this.blockedReason = MOVE_COPY.sortBlocked(SORT_LABELS[this.view.board.sort]);
      this.aim = null;
      return;
    }
    const overFrame = node.closest<HTMLElement>('.frame');
    let position = this.sections()[sectionIndex].posts.length + (sectionIndex === spot.sectionIndex ? 0 : 1);
    if (overFrame !== null && overFrame.getAttribute('data-post-id') !== hold.postId) {
      const target = Number(overFrame.getAttribute('data-position'));
      if (Number.isFinite(target) && target > 0) position = target;
    }
    this.aim = { sectionIndex, position };
  }

  private settleAim(): void {
    const aim = this.aim;
    this.aim = null;
    if (aim === null) return;
    this.place(aim.sectionIndex, aim.position);
  }

  async drop(): Promise<void> {
    const hold = this.holding;
    if (hold === null) return;
    this.settleAim();
    const spot = this.locate(hold.postId);
    const frame = this.view.frameFor(hold.postId);
    frame?.removeAttribute('data-moving');
    if (spot === null) {
      this.endHold();
      return;
    }
    const section = this.sections()[spot.sectionIndex];
    const unchanged = section.id === hold.originSectionId && spot.postIndex + 1 === hold.originPosition;
    if (unchanged && this.blockedReason !== null) {
      const reason = this.blockedReason;
      this.endHold();
      await this.view.refresh();
      this.view.announce(reason);
      frame?.focus();
      return;
    }
    const title = section.posts[spot.postIndex].title;
    this.endHold();
    try {
      await api.patch(`/api/posts/${hold.postId}/move`, {
        section_id: section.id,
        position: spot.postIndex + 1,
        version: hold.version,
      });
      await this.view.refresh();
      const place = this.view.placeOf(hold.postId);
      if (place !== null) this.view.announce(MOVE_COPY.drop(title, place.sectionTitle, place.position, place.total));
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      await this.view.refresh();
      const place = this.view.placeOf(hold.postId);
      if (error.status === 409) {
        const movedBy = typeof error.body.moved_by === 'string' ? error.body.moved_by : '';
        if (place !== null) {
          this.view.announce(MOVE_COPY.lost(movedBy, title, place.sectionTitle, place.position, place.total));
        }
      } else if (error.status === 422) {
        this.view.announce(error.fieldError('position') ?? MOVE_COPY.groupBlocked());
      } else if (error.status === 404) {
        this.view.announce(`${title} was deleted.`);
      }
    }
    this.view.frameFor(hold.postId)?.focus();
  }

  cancel(): void {
    const hold = this.holding;
    if (hold === null) return;
    const frame = this.view.frameFor(hold.postId);
    frame?.removeAttribute('data-moving');
    this.view.display = structuredClone(this.view.listing);
    this.endHold();
    this.view.render();
    const place = this.view.placeOf(hold.postId);
    if (place !== null) {
      const post = this.view.postById(hold.postId);
      if (post !== null) {
        this.view.announce(MOVE_COPY.cancel(post.title, place.sectionTitle, place.position, place.total));
      }
    }
    this.view.frameFor(hold.postId)?.focus();
  }

  endHold(): void {
    const hold = this.holding;
    if (hold !== null) this.view.frameFor(hold.postId)?.removeAttribute('data-moving');
    this.holding = null;
    this.blockedReason = null;
  }

  bindFrame(frame: HTMLElement, postId: string): void {
    let start: { x: number; y: number } | null = null;
    let longPress: number | null = null;

    const isControl = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement && target.closest('button, a, input, textarea, select') !== null;

    on(frame, 'pointerdown', (event) => {
      if (event.pointerType === 'touch' || event.button !== 0 || isControl(event.target)) return;
      start = { x: event.clientX, y: event.clientY };
      const onMove = (move: PointerEvent): void => {
        if (start === null) return;
        if (this.holding === null) {
          if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < DRAG_THRESHOLD) return;
          if (!this.pickUp(postId, true)) {
            start = null;
            return;
          }
          frame.classList.add('dragging');
        }
        frame.style.transform = `translate(${move.clientX - start.x}px, ${move.clientY - start.y}px)`;
        this.aimAt(move.clientX, move.clientY);
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        start = null;
        frame.classList.remove('dragging');
        frame.style.transform = '';
        if (this.holding !== null) void this.drop();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    frame.addEventListener(
      'touchstart',
      (event) => {
        if (isControl(event.target)) return;
        const touch = event.touches[0];
        start = { x: touch.clientX, y: touch.clientY };
        longPress = window.setTimeout(() => {
          longPress = null;
          this.pickUp(postId, true);
        }, LONG_PRESS_MS);
      },
      { passive: false },
    );

    frame.addEventListener(
      'touchmove',
      (event) => {
        const touch = event.touches[0];
        if (this.holding !== null) {
          event.preventDefault();
          frame.classList.add('dragging');
          if (start !== null) {
            frame.style.transform = `translate(${touch.clientX - start.x}px, ${touch.clientY - start.y}px)`;
          }
          this.aimAt(touch.clientX, touch.clientY);
          return;
        }
        if (start !== null && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > DRAG_THRESHOLD && longPress !== null) {
          window.clearTimeout(longPress);
          longPress = null;
        }
      },
      { passive: false },
    );

    frame.addEventListener(
      'touchend',
      (event) => {
        if (longPress !== null) {
          window.clearTimeout(longPress);
          longPress = null;
          if (!isControl(event.target)) {
            event.preventDefault();
            if (this.view.loupeId === postId) this.view.closeLoupe();
            else this.view.openLoupe(postId);
          }
          start = null;
          return;
        }
        start = null;
        frame.classList.remove('dragging');
        frame.style.transform = '';
        if (this.holding !== null) {
          event.preventDefault();
          void this.drop();
        }
      },
      { passive: false },
    );
  }
}
