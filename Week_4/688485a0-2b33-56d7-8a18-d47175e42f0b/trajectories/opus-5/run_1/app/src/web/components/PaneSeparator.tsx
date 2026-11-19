import { useRef } from 'react';

const MIN = 20;
const MAX = 80;

function clamp(value: number): number {
  return Math.min(Math.max(Math.round(value), MIN), MAX);
}

/** A pane separator: 5 percent steps by keyboard, the same range by pointer. */
export function PaneSeparator({
  label,
  value,
  orientation,
  onChange,
}: {
  label: string;
  value: number;
  orientation: 'vertical' | 'horizontal';
  onChange: (value: number) => void;
}): JSX.Element {
  const element = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        onChange(clamp(value + 5));
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        onChange(clamp(value - 5));
        break;
      case 'Home':
        event.preventDefault();
        onChange(MIN);
        break;
      case 'End':
        event.preventDefault();
        onChange(MAX);
        break;
      default:
        break;
    }
  };

  const onPointerDown = (event: React.PointerEvent): void => {
    const parent = element.current?.parentElement;
    if (!parent) return;
    event.preventDefault();
    const rect = parent.getBoundingClientRect();
    const move = (pointer: PointerEvent): void => {
      const share =
        orientation === 'vertical'
          ? ((pointer.clientY - rect.top) / rect.height) * 100
          : ((pointer.clientX - rect.left) / rect.width) * 100;
      onChange(clamp(share));
    };
    const stop = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return (
    <div
      ref={element}
      role="separator"
      aria-label={label}
      aria-orientation={orientation === 'vertical' ? 'horizontal' : 'vertical'}
      aria-valuenow={value}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuetext={`${value}%`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    />
  );
}
