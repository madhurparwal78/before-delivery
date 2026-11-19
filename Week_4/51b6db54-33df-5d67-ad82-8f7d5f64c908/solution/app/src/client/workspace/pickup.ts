import { useRef, useState } from 'preact/hooks';
import type { Model } from './model';

export interface PickupItem {
  id: number;
  label: string;
}

export interface DragProps {
  draggable: boolean;
  onDragStart: () => void;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}

interface Lifted {
  id: number;
  from: number;
  to: number;
  label: string;
}

/**
 * Keyboard pick-up for a roving list: Space lifts, arrows move, Space drops, Escape cancels, each step announced.
 * `items` are in display order from the top; `onDrop` receives the new 1-based position.
 */
export function usePickup(m: Model, items: readonly PickupItem[], onDrop: (id: number, position: number) => void) {
  const [lifted, setLifted] = useState<Lifted | null>(null);
  const dragged = useRef<number | null>(null);
  const total = items.length;
  const say = (text: string): void => {
    m.listAnnouncement = text;
    m.changed();
  };

  /** The items as shown while one is lifted. */
  const shown = (): PickupItem[] => {
    if (!lifted) return [...items];
    const rest = items.filter((item) => item.id !== lifted.id);
    const item = items.find((candidate) => candidate.id === lifted.id);
    if (item) rest.splice(lifted.to - 1, 0, item);
    return rest;
  };

  /** Returns true when the key was consumed by pick-up. */
  const onKey = (event: KeyboardEvent, id: number): boolean => {
    const position = items.findIndex((item) => item.id === id) + 1;
    const label = items[position - 1]?.label ?? '';
    if (event.key === ' ' && !event.shiftKey) {
      event.preventDefault();
      if (!lifted) {
        setLifted({ id, from: position, to: position, label });
        say(`Lifted ${label}, position ${position} of ${total}`);
      } else {
        setLifted(null);
        say(`Dropped ${lifted.label}, position ${lifted.to} of ${total}`);
        if (lifted.to !== lifted.from) onDrop(lifted.id, lifted.to);
      }
      return true;
    }
    if (!lifted) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setLifted(null);
      say(`Cancelled, ${lifted.label} back at position ${lifted.from} of ${total}`);
      return true;
    }
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return false;
    event.preventDefault();
    const to = Math.max(1, Math.min(total, lifted.to + step));
    setLifted({ ...lifted, to });
    say(`Moved ${lifted.label}, position ${to} of ${total}`);
    return true;
  };

  const dragProps = (id: number, editable: boolean): DragProps => ({
    draggable: editable,
    onDragStart: () => {
      dragged.current = id;
      const position = items.findIndex((item) => item.id === id) + 1;
      say(`Lifted ${items[position - 1]?.label ?? ''}, position ${position} of ${total}`);
    },
    onDragOver: (event) => event.preventDefault(),
    onDrop: (event) => {
      event.preventDefault();
      const from = dragged.current;
      dragged.current = null;
      const to = items.findIndex((item) => item.id === id) + 1;
      const item = items.find((candidate) => candidate.id === from);
      if (!item || from === null) return;
      say(`Dropped ${item.label}, position ${to} of ${total}`);
      if (from !== id) onDrop(from, to);
    },
  });

  return { lifted, shown, onKey, dragProps };
}
