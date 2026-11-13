import type { Solid } from "../shared/records.js";
import { formatBBoxTriple } from "../shared/numbers.js";

/** A three-quarter line drawing of the solid, with its bounding box as a text element. */
export function thumbnailSvg(solid: Solid): string {
  const body = solid.ops[0] as unknown as Record<string, number> | undefined;
  if (!body) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140" width="200" height="140"><rect x="80" y="60" width="40" height="30" fill="none" stroke="#9fd8e8" stroke-width="1.2" stroke-dasharray="3 3"/></svg>`;
  }
  const w = String(body.op) === "box" ? body.w! : body.dia!;
  const d = String(body.op) === "box" ? body.d! : body.dia!;
  const h = body.h!;
  // Bosses grow the drawn height.
  let top = h;
  for (const o of solid.ops as Array<Record<string, unknown>>) {
    if (o.op === "boss") top = Math.max(top, h + (o.h as number ?? 0));
  }
  const scale = 150 / Math.max(w, d, top, 1);
  const cos = Math.cos(Math.PI / 6);
  const sin = Math.sin(Math.PI / 6);
  const proj = (x: number, y: number, z: number): [number, number] => {
    const ix = (x - y) * cos * scale;
    const iy = ((x + y) * sin - z) * scale;
    return [100 + ix, 105 + iy];
  };
  const corners: Array<[number, number, number]> = [
    [-w / 2, -d / 2, 0], [w / 2, -d / 2, 0], [w / 2, d / 2, 0], [-w / 2, d / 2, 0],
    [-w / 2, -d / 2, top], [w / 2, -d / 2, top], [w / 2, d / 2, top], [-w / 2, d / 2, top],
  ];
  const p = corners.map(([x, y, z]) => proj(x, y, z));
  const edges: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  // Hidden edges (behind the solid) drawn fainter.
  const hidden = new Set([2, 6, 10].map((i) => edges[i]!));
  const visible = edges.filter((e) => !hidden.has(e));
  const path = (list: Array<[number, number]>): string =>
    list.map(([a, b], i) => `${i === 0 ? "M" : ""}${p[a]![0].toFixed(1)},${p[a]![1].toFixed(1)}L${p[b]![0].toFixed(1)},${p[b]![1].toFixed(1)}`).join("");
  const bboxText = formatBBoxTriple([w, d, top]);
  // Cut markers: faint circles at each hole position.
  const cutMarks: string[] = [];
  for (const o of solid.ops as Array<Record<string, unknown>>) {
    if (o.op === "hole") {
      const [cx, cy] = proj(o.x as number ?? 0, o.y as number ?? 0, h / 2);
      const r = Math.max(1.5, ((o.dia as number) ?? 0) / 2 * scale * 0.6);
      cutMarks.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="#6fa8b8" stroke-width="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140" width="200" height="140"><g fill="none" stroke="#6fa8b8" stroke-width="0.8" opacity="0.7"><path d="${path([...hidden])}"/></g><g fill="none" stroke="#9fd8e8" stroke-width="1.4"><path d="${path(visible)}"/></g>${cutMarks.join("")}<text x="6" y="132" font-size="11" fill="#9fd8e8" font-family="system-ui">${escapeXml(bboxText)}</text></svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
