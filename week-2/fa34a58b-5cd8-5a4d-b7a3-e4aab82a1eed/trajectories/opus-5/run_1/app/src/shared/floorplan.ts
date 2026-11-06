/** The fixed procedural floor plan layout, in plan order. */

export interface RoomShape {
  roomId: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PLAN_VIEWBOX = { width: 1040, height: 500 };

/** Twenty drawing units to the foot, so wall labels read as an architect's measurements. */
const UNITS_PER_FOOT = 20;

export const ROOM_SHAPES: readonly RoomShape[] = [
  { roomId: 'hall', name: 'Hall', x: 20, y: 20, width: 240, height: 230 },
  { roomId: 'kitchen', name: 'Kitchen', x: 260, y: 20, width: 260, height: 230 },
  { roomId: 'living', name: 'Living', x: 520, y: 20, width: 300, height: 230 },
  { roomId: 'study', name: 'Study', x: 820, y: 20, width: 200, height: 230 },
  { roomId: 'main-bedroom', name: 'Main bedroom', x: 20, y: 250, width: 280, height: 230 },
  { roomId: 'nursery', name: 'Nursery', x: 300, y: 250, width: 220, height: 230 },
  { roomId: 'spare-room', name: 'Spare room', x: 520, y: 250, width: 220, height: 230 },
  { roomId: 'bath', name: 'Bath', x: 740, y: 250, width: 140, height: 230 },
  { roomId: 'porch', name: 'Porch', x: 880, y: 250, width: 140, height: 230 },
];

export function measuredLength(units: number): string {
  const totalInches = Math.round((units / UNITS_PER_FOOT) * 12);
  return `${Math.floor(totalInches / 12)}'${totalInches % 12}`;
}

/** Perpendicular ticks at both ends of the top and left walls. */
export function dimensionTicks(shape: RoomShape): string {
  const tick = 7;
  const inset = 10;
  const { x, y, width, height } = shape;
  return [
    `M${x + inset} ${y + inset - tick} V${y + inset + tick}`,
    `M${x + width - inset} ${y + inset - tick} V${y + inset + tick}`,
    `M${x + inset - tick} ${y + inset} H${x + inset + tick}`,
    `M${x + inset - tick} ${y + height - inset} H${x + inset + tick}`,
  ].join(' ');
}
