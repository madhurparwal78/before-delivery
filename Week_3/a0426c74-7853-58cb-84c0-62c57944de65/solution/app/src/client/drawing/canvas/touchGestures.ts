// Phone gestures (brief: Touch on a phone, Phone gestures): pinch and two-finger pan computed afresh from the values at the second finger's
// touch, a tap (one touch under 8 px lifted before the long press fires), and a long press (one touch held 500 ms on a page timer).
import { distance, midpoint, pinchView, screenToWorld } from '../../../shared/geometry/index.ts';
import type { PinchStart, View } from '../../../shared/geometry/index.ts';
import type { Point } from '../../../shared/types.ts';

const TAP_SLOP_PX = 8;
const LONG_PRESS_MS = 500;

interface GestureHost {
  view(): View;
  moveView(view: View): void;
  /** a tap at the world point */
  tap(world: Point): void;
  /** a long press at the world point and the screen point (px from the pane's top-left) */
  longPress(world: Point, screen: Point): void;
}

/** A finger in pane px. */
export type Finger = Point;

interface Press { start: Finger; held: boolean; moved: boolean; timer: ReturnType<typeof setTimeout> }

export class TouchGestures {
  private pinch: PinchStart | null = null;
  private press: Press | null = null;
  /** after a pinch one finger may stay down: it does nothing until every finger is up */
  private spent = false;

  constructor(private readonly host: GestureHost) {}

  /** `fingers` are all the touches now down, `touchstart` having just added one or more. */
  start(fingers: readonly Finger[]): void {
    if (fingers.length >= 2) {
      this.cancelPress();
      this.spent = true;
      this.pinch = { distance: distance(fingers[0], fingers[1]), midpoint: midpoint(fingers[0], fingers[1]), view: this.host.view() };
      return;
    }
    if (this.spent || fingers.length === 0) return;
    const start = fingers[0];
    const press: Press = {
      start, held: false, moved: false,
      timer: setTimeout(() => {
        if (this.press !== press || press.moved) return;
        press.held = true;
        this.host.longPress(screenToWorld(this.host.view(), press.start), press.start);
      }, LONG_PRESS_MS),
    };
    this.press = press;
  }

  move(fingers: readonly Finger[]): void {
    if (this.pinch && fingers.length >= 2) {
      this.host.moveView(pinchView(this.pinch, distance(fingers[0], fingers[1]), midpoint(fingers[0], fingers[1])));
      return;
    }
    const press = this.press;
    if (press && fingers.length === 1 && distance(press.start, fingers[0]) >= TAP_SLOP_PX) {
      press.moved = true;
      this.cancelPress();
    }
  }

  /** `fingers` are the touches still down after the lift, `lifted` the ones that just left. */
  end(fingers: readonly Finger[], lifted: Finger | null): void {
    if (this.pinch && fingers.length < 2) this.pinch = null;
    const press = this.press;
    if (press && fingers.length === 0) {
      this.cancelPress();
      const at = lifted ?? press.start;
      if (!press.held && !press.moved && distance(press.start, at) < TAP_SLOP_PX) this.host.tap(screenToWorld(this.host.view(), press.start));
    }
    if (fingers.length === 0) this.spent = false;
  }

  cancel(): void {
    this.cancelPress();
    this.pinch = null;
    this.spent = false;
  }

  private cancelPress(): void {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
  }
}
