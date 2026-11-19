import { useEffect, useRef, useState } from "react";
import { useFrames } from "../lib/frames.js";

const SOURCES = ["CRM", "Billing", "Tickets", "Events", "Files"];
const OUTPUTS = [
  { label: "AI agents", note: "Query by meaning" },
  { label: "Warehouses", note: "Copy every row" },
];
const INCOMING_SHARE = 0.85;
const PULSE_MS = 2600;
const BREATHE_MS = 2000;
const clamp = (v) => Math.min(1, Math.max(0, v));

// Two drawings of one diagram: wide (tiles left, outputs right) and tall for phones (tiles above, outputs below).
const LAYOUTS = {
  wide: {
    viewBox: "0 0 960 500",
    hub: { x: 470, y: 250 },
    tiles: SOURCES.map((label, i) => ({ label, x: 40, y: 60 + i * 90, w: 156, h: 44 })),
    outputs: OUTPUTS.map((out, i) => ({ ...out, x: 760, y: 100 + i * 220, w: 170, h: 80 })),
    incoming: (t, hub) => `M ${t.x + t.w} ${t.y + 22} C 330 ${t.y + 22}, 330 ${hub.y}, ${hub.x - 62} ${hub.y}`,
    outgoing: (o, hub) => `M ${hub.x + 62} ${hub.y} C 640 ${hub.y}, 640 ${o.y + 40}, ${o.x} ${o.y + 40}`,
  },
  tall: {
    viewBox: "0 0 360 560",
    hub: { x: 180, y: 280 },
    tiles: SOURCES.map((label, i) => ({ label, x: i < 3 ? 10 + i * 118 : 69 + (i - 3) * 118, y: i < 3 ? 20 : 76, w: 104, h: 44 })),
    outputs: OUTPUTS.map((out, i) => ({ ...out, x: 10 + i * 180, y: 460, w: 160, h: 80 })),
    incoming: (t, hub) => `M ${t.x + t.w / 2} ${t.y + t.h} C ${t.x + t.w / 2} 200, ${hub.x} 180, ${hub.x} ${hub.y - 62}`,
    outgoing: (o, hub) => `M ${hub.x} ${hub.y + 62} C ${hub.x} 400, ${o.x + o.w / 2} 400, ${o.x + o.w / 2} ${o.y}`,
  },
};

// The home architecture: tiles pulse into the hub, which fans out to AI agents and warehouses.
// The lines draw with the scroll: undrawn as the diagram enters, fully drawn at mid-viewport.
export default function ArchitectureDiagram() {
  const [shape, setShape] = useState("wide");
  const root = useRef(null);
  const lines = useRef([]);
  const outs = useRef([]);
  const tiles = useRef([]);
  const pulses = useRef([]);
  const hub = useRef(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const pick = () => setShape(media.matches ? "tall" : "wide");
    pick();
    media.addEventListener("change", pick);
    return () => media.removeEventListener("change", pick);
  }, []);

  useFrames((now, reduced) => {
    const svg = root.current;
    if (!svg) return true;
    const rect = svg.getBoundingClientRect();
    const span = window.innerHeight / 2 + rect.height / 2;
    const progress = reduced ? 1 : clamp((window.innerHeight - rect.top) / span);
    const drawIn = clamp(progress / INCOMING_SHARE);
    const drawOut = clamp((progress - INCOMING_SHARE) / (1 - INCOMING_SHARE));
    const flowing = !reduced && progress >= 1;
    const draw = (path, fraction) => {
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length * (1 - fraction)}`;
    };
    lines.current.forEach((path) => draw(path, drawIn));
    outs.current.forEach((path) => draw(path, drawOut));
    tiles.current.forEach((tile) => { tile.style.opacity = String(0.45 + 0.55 * clamp(progress * 2)); });
    const paths = [...lines.current, ...outs.current];
    pulses.current.forEach((dot, index) => {
      dot.style.opacity = flowing ? "1" : "0";
      if (!flowing) return;
      const path = paths[index];
      const t = ((now + index * 430) % PULSE_MS) / PULSE_MS;
      const point = path.getPointAtLength(t * path.getTotalLength());
      dot.setAttribute("cx", point.x.toFixed(1));
      dot.setAttribute("cy", point.y.toFixed(1));
    });
    if (hub.current) {
      const breath = reduced ? 1 : 0.97 + 0.03 * Math.sin((now / BREATHE_MS) * Math.PI * 2);
      hub.current.style.transform = `scale(${breath.toFixed(4)})`;
    }
    // Under reduced motion one drawn frame is the whole story: lines fully drawn, no pulses, no loop.
    return !reduced;
  });

  const layout = LAYOUTS[shape];
  const { hub: center } = layout;
  return (
    <svg ref={root} viewBox={layout.viewBox} className={`architecture architecture-${shape}`} role="img"
      aria-label="Connector tiles send data through the Wayline hub to AI agents and warehouses">
      <defs>
        <linearGradient id="arch-hub" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b3abff" />
          <stop offset="1" stopColor="#4536c4" />
        </linearGradient>
        <radialGradient id="arch-glow">
          <stop offset="0" stopColor="#8f7bff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#8f7bff" stopOpacity="0" />
        </radialGradient>
        <filter id="arch-soft"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>
      {layout.tiles.map((tile) => <path key={`track-${tile.label}`} d={layout.incoming(tile, center)} className="arch-track" />)}
      {layout.outputs.map((out) => <path key={`track-${out.label}`} d={layout.outgoing(out, center)} className="arch-track" />)}
      {layout.tiles.map((tile, i) => (
        <path key={tile.label} ref={(el) => { lines.current[i] = el; }} d={layout.incoming(tile, center)}
          fill="none" stroke="#a299ff" strokeWidth="2.5" />
      ))}
      {layout.outputs.map((out, i) => (
        <path key={out.label} ref={(el) => { outs.current[i] = el; }} d={layout.outgoing(out, center)}
          fill="none" stroke="#6e4bea" strokeWidth="2.5" />
      ))}
      {layout.tiles.map((tile, i) => (
        <g key={tile.label} ref={(el) => { tiles.current[i] = el; }}>
          <rect x={tile.x} y={tile.y} width={tile.w} height={tile.h} rx="12" fill="#fff" stroke="#d0d0d0" />
          <rect x={tile.x + 10} y={tile.y + 10} width="24" height="24" rx="7" fill="#ecebfd" />
          <text x={tile.x + 22} y={tile.y + 27} textAnchor="middle" fontFamily="Fragment Mono, monospace" fontSize="12" fill="#5e3fd6">
            {tile.label[0]}
          </text>
          <text x={tile.x + 42} y={tile.y + 27} fontFamily="Inter, sans-serif" fontSize="14" fontWeight="500" fill="#0a0a0a">{tile.label}</text>
        </g>
      ))}
      {[...layout.tiles, ...layout.outputs].map((item, i) => (
        <circle key={`pulse-${item.label}`} ref={(el) => { pulses.current[i] = el; }} r="5" fill="#8f7bff"
          filter="url(#arch-soft)" style={{ opacity: 0 }} />
      ))}
      <circle cx={center.x} cy={center.y} r="110" fill="url(#arch-glow)" />
      <g ref={hub} style={{ transformOrigin: `${center.x}px ${center.y}px` }}>
        <rect x={center.x - 62} y={center.y - 62} width="124" height="124" rx="28" fill="url(#arch-hub)" />
        <path d={`M ${center.x - 30} ${center.y + 8} c 8 -26 18 -26 30 0 s 22 26 30 0`} fill="none" stroke="#fff"
          strokeWidth="6" strokeLinecap="round" />
        <text x={center.x} y={center.y + 44} textAnchor="middle" fontFamily="Fragment Mono, monospace" fontSize="11"
          fill="#fff" letterSpacing="0.5">WAYLINE</text>
      </g>
      {layout.outputs.map((out) => (
        <g key={out.label}>
          <rect x={out.x} y={out.y} width={out.w} height={out.h} rx="16" fill="#fff" stroke="#a299ff" />
          <text x={out.x + 18} y={out.y + 34} fontFamily="Inter, sans-serif" fontSize="17" fontWeight="600" fill="#0a0a0a">{out.label}</text>
          <text x={out.x + 18} y={out.y + 58} fontFamily="Inter, sans-serif" fontSize="13" fill="#5c5c5c">{out.note}</text>
        </g>
      ))}
    </svg>
  );
}
