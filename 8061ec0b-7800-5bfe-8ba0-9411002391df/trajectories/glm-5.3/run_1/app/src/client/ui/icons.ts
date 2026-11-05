// Lucide icons, wrapped for aria-hidden decorative use (DP-31).
import {
  Music,
  Music2,
  Guitar,
  CircleHelp,
  Package,
  PackageCheck,
  PackageOpen,
  CircleCheckBig,
  type IconNode,
} from "lucide";

export type StatusIconName = "no_instrument" | "awaiting_agreement" | "scheduled" | "delivered" | "owned";

const STATUS_ICONS: Record<StatusIconName, IconNode> = {
  no_instrument: CircleHelp,
  awaiting_agreement: PackageOpen,
  scheduled: Package,
  delivered: PackageCheck,
  owned: CircleCheckBig,
};

const INSTRUMENT_ICONS: Record<string, IconNode> = {
  flute: Music,
  clarinet: Music2,
  trumpet: Guitar,
  violin: Music,
  cello: Music2,
};

export function statusIcon(name: StatusIconName): SVGSVGElement {
  return buildIcon(STATUS_ICONS[name] ?? CircleHelp);
}

export function instrumentIcon(name: string): SVGSVGElement {
  return buildIcon(INSTRUMENT_ICONS[name] ?? Music);
}

function buildIcon(node: IconNode): SVGSVGElement {
  const [tag, attrs, children] = node;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", tag) as unknown as SVGSVGElement;
  for (const [key, value] of Object.entries(attrs)) {
    svg.setAttribute(key, String(value));
  }
  for (const child of children ?? []) {
    const [childTag, childAttrs] = child;
    const el = document.createElementNS("http://www.w3.org/2000/svg", childTag);
    for (const [key, value] of Object.entries(childAttrs)) {
      el.setAttribute(key, String(value));
    }
    svg.appendChild(el);
  }
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  return svg;
}
