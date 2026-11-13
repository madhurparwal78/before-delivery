import { s } from "../dom";

/** The 24 avatars, drawn from their number: eight colour pairs in three designs. */

const PAIRS: readonly (readonly [string, string])[] = [
  ["#F2452B", "#14110F"],
  ["#1B45D7", "#FFFFFF"],
  ["#14110F", "#F2452B"],
  ["#F4EFE6", "#1B45D7"],
  ["#B88A2E", "#14110F"],
  ["#FFFFFF", "#F2452B"],
  ["#1B45D7", "#F4EFE6"],
  ["#14110F", "#FFFFFF"],
];

export function avatarArt(number: number, size?: number): SVGSVGElement {
  const index = Math.max(0, Math.min(23, number - 1));
  const [ground, mark] = PAIRS[index % 8] as readonly [string, string];
  const design = Math.floor(index / 8);
  const svg = s("svg", { viewBox: "0 0 100 100", "aria-hidden": "true", focusable: "false", class: "avatar-art", ...(size ? { width: size, height: size } : {}) });
  svg.append(s("rect", { width: 100, height: 100, fill: ground }));
  if (design === 0) {
    svg.append(
      s("circle", { cx: 50, cy: 50, r: 32, fill: mark }),
      s("circle", { cx: 50, cy: 50, r: 20, fill: ground }),
      s("circle", { cx: 50, cy: 50, r: 8, fill: mark }),
    );
  } else if (design === 1) {
    svg.append(
      s("path", { d: "M0 100 L100 0 L100 100 Z", fill: mark }),
      s("circle", { cx: 34, cy: 34, r: 14, fill: mark }),
      s("circle", { cx: 66, cy: 66, r: 14, fill: ground }),
    );
  } else {
    for (const [x, y] of [
      [26, 26],
      [74, 26],
      [26, 74],
      [74, 74],
    ] as const) {
      svg.append(s("circle", { cx: x, cy: y, r: 14, fill: mark }));
    }
    svg.append(s("circle", { cx: 50, cy: 50, r: 11, fill: mark }));
  }
  return svg;
}
