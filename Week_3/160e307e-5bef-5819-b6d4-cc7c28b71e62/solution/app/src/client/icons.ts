import { ArrowRight, Check, Copy, Menu, MessageCircle, TriangleAlert, WifiOff, X } from "lucide";
import { s } from "./dom";

type IconNode = readonly (readonly [string, Record<string, string>])[];

const ICONS = { arrowRight: ArrowRight, check: Check, copy: Copy, menu: Menu, message: MessageCircle, alert: TriangleAlert, wifiOff: WifiOff, close: X };
type IconName = keyof typeof ICONS;

/** Lucide line icons, inlined as decorative SVG. */
export function icon(name: IconName, size = 20): SVGSVGElement {
  const svg = s("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2.25,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
    class: "icon",
  });
  for (const [tag, attrs] of ICONS[name] as unknown as IconNode) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}
