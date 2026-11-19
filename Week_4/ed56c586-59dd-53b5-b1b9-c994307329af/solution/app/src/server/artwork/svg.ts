/** Tiny SVG string helpers for the procedural artwork. Every picture is drawn by this app; nothing is fetched. */

type Attributes = Readonly<Record<string, string | number>>;

function format(value: string | number): string {
  return typeof value === "number" ? String(Math.round(value * 10) / 10) : value;
}

export function tag(name: string, attributes: Attributes, ...children: readonly string[]): string {
  const rendered = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${format(value)}"`)
    .join("");
  return children.length === 0 ? `<${name}${rendered}/>` : `<${name}${rendered}>${children.join("")}</${name}>`;
}

export function rect(x: number, y: number, width: number, height: number, fill: string, extra: Attributes = {}): string {
  return tag("rect", { x, y, width, height, fill, ...extra });
}

export function line(x1: number, y1: number, x2: number, y2: number, stroke: string, strokeWidth: number, extra: Attributes = {}): string {
  return tag("line", { x1, y1, x2, y2, stroke, "stroke-width": strokeWidth, ...extra });
}

export function circle(cx: number, cy: number, r: number, fill: string, extra: Attributes = {}): string {
  return tag("circle", { cx, cy, r, fill, ...extra });
}

export function path(d: string, extra: Attributes): string {
  return tag("path", { d, ...extra });
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

export function svgDocument(width: number, height: number, ...children: readonly string[]): string {
  return tag(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", width, height, viewBox: `0 0 ${width} ${height}` },
    ...children,
  );
}

/** A document drawn on a `width` x `height` canvas but sized to `shownWidth` pixels: the picture's own size is the size it is shown at. */
export function scaledSvgDocument(shownWidth: number, width: number, height: number, ...children: readonly string[]): string {
  return tag(
    "svg",
    { xmlns: "http://www.w3.org/2000/svg", width: shownWidth, height: Math.round((shownWidth * height) / width), viewBox: `0 0 ${width} ${height}` },
    ...children,
  );
}
