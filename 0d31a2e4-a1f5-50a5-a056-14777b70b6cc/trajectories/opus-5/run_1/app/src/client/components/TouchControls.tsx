import { useRef } from 'react';
import {
  BUTTON_BACK,
  BUTTON_DIVE,
  BUTTON_FORWARD,
  BUTTON_JUMP,
  BUTTON_LEFT,
  BUTTON_RIGHT,
} from '../../shared/sim/index.js';

interface Props {
  shown: boolean;
  onButtons: (buttons: number) => void;
}

/** The eight sectors of the move stick, from forward turning towards the screen's right. */
const SECTORS = [
  BUTTON_FORWARD,
  BUTTON_FORWARD | BUTTON_RIGHT,
  BUTTON_RIGHT,
  BUTTON_BACK | BUTTON_RIGHT,
  BUTTON_BACK,
  BUTTON_BACK | BUTTON_LEFT,
  BUTTON_LEFT,
  BUTTON_FORWARD | BUTTON_LEFT,
];

const DEAD_ZONE = 0.2;

export function TouchControls({ shown, onButtons }: Props) {
  const stickRef = useRef<HTMLDivElement | null>(null);
  const direction = useRef(0);
  const jump = useRef(false);
  const dive = useRef(false);

  if (!shown) return null;

  const publish = (): void => {
    onButtons(
      direction.current | (jump.current ? BUTTON_JUMP : 0) | (dive.current ? BUTTON_DIVE : 0),
    );
  };

  const readStick = (clientX: number, clientY: number): void => {
    const node = stickRef.current;
    if (node === null) return;
    const box = node.getBoundingClientRect();
    const radius = box.width / 2;
    const dx = clientX - (box.left + radius);
    const dy = clientY - (box.top + radius);
    const distance = Math.hypot(dx, dy) / radius;
    if (distance < DEAD_ZONE) {
      direction.current = 0;
      publish();
      return;
    }
    const angle = Math.atan2(dx, -dy);
    const sector = Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    direction.current = SECTORS[sector];
    publish();
  };

  const stopStick = (): void => {
    direction.current = 0;
    publish();
  };

  return (
    <div className="touch-controls" role="group" aria-label="Touch controls">
      <div
        className="move-stick"
        role="group"
        aria-label="Move stick"
        ref={stickRef}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          readStick(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0 && event.pointerType === 'mouse') return;
          readStick(event.clientX, event.clientY);
        }}
        onPointerUp={stopStick}
        onPointerCancel={stopStick}
      >
        <span className="stick-knob" aria-hidden="true" />
      </div>
      <div className="touch-buttons">
        <button
          type="button"
          className="touch-button"
          onPointerDown={() => {
            jump.current = true;
            publish();
          }}
          onPointerUp={() => {
            jump.current = false;
            publish();
          }}
          onPointerLeave={() => {
            jump.current = false;
            publish();
          }}
        >
          Jump
        </button>
        <button
          type="button"
          className="touch-button"
          onPointerDown={() => {
            dive.current = true;
            publish();
          }}
          onPointerUp={() => {
            dive.current = false;
            publish();
          }}
          onPointerLeave={() => {
            dive.current = false;
            publish();
          }}
        >
          Dive
        </button>
      </div>
    </div>
  );
}
