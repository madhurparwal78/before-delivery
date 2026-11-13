export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

/**
 * A swipe that starts on the element, measured to wherever the pointer or finger is
 * released, so letting go outside the element still counts.
 */
export function onSwipe(
  element: HTMLElement,
  minimumPx: number,
  handle: (direction: SwipeDirection) => void,
): void {
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let tracking = false;

  const begin = (x: number, y: number) => {
    startX = x;
    startY = y;
    lastX = x;
    lastY = y;
    tracking = true;
  };

  const track = (x: number, y: number) => {
    if (!tracking) return;
    lastX = x;
    lastY = y;
  };

  let swallowClick = false;

  const finish = () => {
    if (!tracking) return;
    tracking = false;
    const dx = lastX - startX;
    const dy = lastY - startY;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const travelled = horizontal ? Math.abs(dx) : Math.abs(dy);
    if (travelled < minimumPx) return;
    swallowClick = true;
    handle(horizontal ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down');
  };

  // A native link drag would cancel the gesture, so dragging is refused here.
  element.addEventListener('dragstart', (event) => event.preventDefault());
  // A swipe across a list is not a press on the link it started from.
  element.addEventListener(
    'click',
    (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  element.addEventListener('pointerdown', (event) => {
    swallowClick = false;
    begin(event.clientX, event.clientY);
  });
  window.addEventListener('pointermove', (event) => track(event.clientX, event.clientY));
  // A cancel ends the gesture too, so a native link drag still reads as a swipe.
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
  element.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    if (touch) begin(touch.clientX, touch.clientY);
  });
  element.addEventListener('touchmove', (event) => {
    const touch = event.touches[0];
    if (touch) track(touch.clientX, touch.clientY);
  });
  element.addEventListener('touchend', (event) => {
    const touch = event.changedTouches[0];
    if (touch) track(touch.clientX, touch.clientY);
    finish();
  });
}
