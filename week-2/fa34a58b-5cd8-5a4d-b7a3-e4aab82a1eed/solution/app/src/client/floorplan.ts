// The floor plan drawing: nine rooms in a fixed procedural layout, drafted like an architect's sheet
// (1 px cyan walls, dimension chains with ticks and mono lengths, door swings). Rooms are in plan order.

import { s } from "./dom.ts";

interface Box { x: number; y: number; w: number; h: number }

/** Room boxes in drawing units (40 units = 1 m). */
const LAYOUT: Record<string, Box> = {
  hall: { x: 250, y: 150, w: 90, h: 140 },
  kitchen: { x: 340, y: 150, w: 150, h: 140 },
  living: { x: 40, y: 150, w: 210, h: 140 },
  study: { x: 490, y: 150, w: 110, h: 140 },
  "main-bedroom": { x: 40, y: 30, w: 170, h: 120 },
  nursery: { x: 210, y: 30, w: 120, h: 120 },
  "spare-room": { x: 420, y: 30, w: 180, h: 120 },
  bath: { x: 330, y: 30, w: 90, h: 120 },
  porch: { x: 250, y: 290, w: 90, h: 46 },
};
const FALLBACK: Box = { x: 40, y: 30, w: 80, h: 60 };
const UNIT_PER_M = 40;
const metres = (units: number): string => (units / UNIT_PER_M).toFixed(2);

export interface RoomShape {
  group: SVGGElement;
  fill: SVGRectElement;
  scene: SVGTextElement;
}

function chain(points: number[], fixed: number, horizontal: boolean, labelOffset: number): SVGGElement {
  const group = s("g", { class: "dim" });
  const first = points[0] as number;
  const last = points[points.length - 1] as number;
  group.append(horizontal
    ? s("line", { x1: first, y1: fixed, x2: last, y2: fixed })
    : s("line", { x1: fixed, y1: first, x2: fixed, y2: last }));
  points.forEach((point, index) => {
    group.append(horizontal
      ? s("line", { class: "tick", x1: point - 4, y1: fixed + 4, x2: point + 4, y2: fixed - 4 })
      : s("line", { class: "tick", x1: fixed - 4, y1: point + 4, x2: fixed + 4, y2: point - 4 }));
    const next = points[index + 1];
    if (next === undefined) return;
    const middle = (point + next) / 2;
    const text = metres(next - point);
    group.append(horizontal
      ? s("text", { class: "dim-label", x: middle, y: fixed + labelOffset, "text-anchor": "middle" }, text)
      : s("text", {
        class: "dim-label", x: fixed + labelOffset, y: middle, "text-anchor": "middle",
        transform: `rotate(-90 ${fixed + labelOffset} ${middle})`,
      }, text));
  });
  return group;
}

/** Corner ticks: a short stroke across each wall end, so every wall reads as measured. */
function cornerTicks(box: Box): SVGPathElement {
  const t = 5;
  const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]];
  const d = corners.map(([x, y]) => `M${(x as number) - t} ${y}h${t * 2}M${x} ${(y as number) - t}v${t * 2}`).join("");
  return s("path", { class: "corner", d });
}

/** A door swing: the open leaf from its hinge, and the arc back to where it closes along the wall. */
function door(hinge: [number, number], leaf: [number, number], closed: [number, number]): SVGPathElement {
  const [x, y] = hinge;
  const radius = Math.hypot(leaf[0] - x, leaf[1] - y);
  const cross = (leaf[0] - x) * (closed[1] - y) - (leaf[1] - y) * (closed[0] - x);
  return s("path", {
    class: "door",
    d: `M${x} ${y}L${leaf[0]} ${leaf[1]}A${radius} ${radius} 0 0 ${cross > 0 ? 1 : 0} ${closed[0]} ${closed[1]}`,
  });
}

export function drawFloorPlan(rooms: { room_id: string; name: string }[], onPick: (roomId: string) => void): {
  svg: SVGSVGElement;
  shapes: Map<string, RoomShape>;
} {
  const svg = s("svg", { class: "plan-drawing", viewBox: "0 0 640 372", role: "group", "aria-label": "House plan" });
  const shapes = new Map<string, RoomShape>();
  svg.append(s("defs", {}, s("radialGradient", { id: "lamp-glow", cx: "50%", cy: "45%", r: "65%" },
    s("stop", { offset: "0%", "stop-color": "#fff1d6", "stop-opacity": "0.2" }),
    s("stop", { offset: "100%", "stop-color": "#fff1d6", "stop-opacity": "0" }))));
  const drafting = s("g", { class: "drafting", "aria-hidden": "true" });
  drafting.append(
    chain([40, 210, 330, 420, 600], 12, true, -2),
    chain([40, 250, 340, 490, 600], 356, true, 14),
    chain([30, 150, 290], 18, false, -6),
    chain([30, 290], 622, false, 12),
    // Door swings: front door from the porch, the hall to living, kitchen and the bedrooms.
    door([268, 290], [268, 266], [292, 290]),
    door([250, 196], [272, 196], [250, 218]),
    door([340, 236], [318, 236], [340, 214]),
    door([262, 150], [262, 170], [282, 150]),
    door([412, 150], [412, 170], [392, 150]),
  );
  for (const room of rooms) {
    const box = LAYOUT[room.room_id] ?? FALLBACK;
    const fill = s("rect", { class: "room-fill", x: box.x, y: box.y, width: box.w, height: box.h });
    const glow = s("rect", { class: "room-glow", x: box.x, y: box.y, width: box.w, height: box.h, fill: "url(#lamp-glow)" });
    const outline = s("rect", { class: "room-wall", x: box.x, y: box.y, width: box.w, height: box.h });
    const centre = box.x + box.w / 2;
    const compact = box.h < 60;
    const name = s("text", { class: "room-name", x: centre, y: compact ? box.y + box.h / 2 + 5 : box.y + box.h / 2 - 2, "text-anchor": "middle" }, room.name);
    const scene = s("text", { class: `room-scene${compact ? " is-hidden" : ""}`, x: centre, y: box.y + box.h / 2 + 18, "text-anchor": "middle" });
    const group = s("g", { class: "room", role: "img", "data-room": room.room_id }, fill, glow, outline, cornerTicks(box), name, scene);
    group.addEventListener("click", () => onPick(room.room_id));
    shapes.set(room.room_id, { group, fill, scene });
    svg.append(group);
  }
  svg.append(drafting);
  return { svg, shapes };
}
