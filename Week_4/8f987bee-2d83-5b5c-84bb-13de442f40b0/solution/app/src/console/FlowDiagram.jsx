import { Braces, Discs } from "../components/Icons.jsx";
import { useMedia } from "../lib/media.js";
import { useReducedMotion } from "../lib/motion.js";

const TILE_W = 260;
const HUB = 88;
const LINK = 100;
const ONE_LINE = 21; // characters of Inter 600 at 17px that fit a tile's text width
const PER_LINE = 25; // characters at 15px, once a name wraps
const LINE_H = 18;
const DROP = 56; // the vertical link length when the tiles stack on a phone

// A tile name on one line when it fits, otherwise wrapped at word breaks; a word longer than a line is split.
function nameLines(name) {
  if (name.length <= ONE_LINE) return [name];
  const lines = [];
  let line = "";
  for (const word of name.split(/\s+/)) {
    for (let rest = word; rest; ) {
      const room = PER_LINE - (line ? line.length + 1 : 0);
      if (rest.length <= room) {
        line = line ? `${line} ${rest}` : rest;
        rest = "";
      } else if (line) {
        lines.push(line);
        line = "";
      } else {
        lines.push(rest.slice(0, PER_LINE));
        rest = rest.slice(PER_LINE);
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

function Tile({ x, y, height, kind, name, lines, Glyph }) {
  const wrapped = lines.length > 1;
  return (
    <g className="flow-node">
      <title>{name}</title>
      <rect x={x} y={y} width={TILE_W} height={height} rx="16" />
      <Glyph className="flow-glyph" x={x + 16} y={y + 13} width="24" height="24" />
      <text x={x + 50} y={y + 30} className="flow-kind">{kind}</text>
      <text x={x + 16} y={y + (wrapped ? 58 : 63)} className={`flow-name ${wrapped ? "flow-name-wrapped" : ""}`}>
        {lines.map((line, index) => <tspan key={index} x={x + 16} dy={index === 0 ? 0 : LINE_H}>{line}</tspan>)}
      </text>
    </g>
  );
}

// Side by side it reads left to right; below 600 CSS pixels the tiles stack so their names stay legible.
function layout(stacked, tileH) {
  if (stacked) {
    const x = TILE_W / 2 + 6;
    const hubY = 6 + tileH + DROP;
    const endY = hubY + HUB + DROP;
    const drop = (y1, y2) => `M ${x} ${y1} C ${x + 30} ${y1 + 20}, ${x - 30} ${y2 - 20}, ${x} ${y2}`;
    return {
      width: TILE_W + 12, height: endY + tileH + 6, source: { x: 6, y: 6 }, end: { x: 6, y: endY },
      hub: { x: x - HUB / 2, y: hubY }, inbound: drop(6 + tileH, hubY), outbound: drop(hubY + HUB, endY),
      ring: { x, y: endY + tileH / 2 },
    };
  }
  const height = tileH + 60;
  const cy = height / 2;
  const hubX = 6 + TILE_W + LINK;
  const endX = hubX + HUB + LINK;
  return {
    width: endX + TILE_W + 6, height, source: { x: 6, y: cy - tileH / 2 }, end: { x: endX, y: cy - tileH / 2 },
    hub: { x: hubX, y: cy - HUB / 2 },
    inbound: `M ${6 + TILE_W} ${cy} C ${6 + TILE_W + 34} ${cy - 39}, ${hubX - 34} ${cy - 39}, ${hubX} ${cy}`,
    outbound: `M ${hubX + HUB} ${cy} C ${hubX + HUB + 34} ${cy + 39}, ${endX - 34} ${cy + 39}, ${endX} ${cy}`,
    ring: { x: endX + TILE_W / 2, y: cy },
  };
}

// The connection's flow: source to hub to warehouse. Beams travel and the hub breathes only while a job runs;
// a finished run sends one ring from the end node. Still when idle or under reduced motion.
export default function FlowDiagram({ source, destination, running, ring }) {
  const reduced = useReducedMotion();
  const stacked = useMedia("(max-width: 599px)");
  const label = `Data flow from ${source} to ${destination}`;
  const sourceLines = nameLines(source);
  const destinationLines = nameLines(destination);
  const tileH = Math.max(80, ...[sourceLines, destinationLines].map((lines) => (lines.length > 1 ? 48 + lines.length * LINE_H : 80)));
  const at = layout(stacked, tileH);
  const { x: hx, y: hy } = at.hub;
  return (
    <svg viewBox={`0 0 ${at.width} ${at.height}`} role="img" aria-label={label}
      className={`flow ${stacked ? "flow-stacked" : ""} ${running && !reduced ? "is-running" : ""}`}>
      <defs>
        <linearGradient id="flow-hub" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b3abff" />
          <stop offset="1" stopColor="#4536c4" />
        </linearGradient>
      </defs>
      <g aria-hidden="true">
        <path className="flow-line" d={at.inbound} />
        <path className="flow-line" d={at.outbound} />
        <path className="flow-beam" d={at.inbound} pathLength="100" />
        <path className="flow-beam late" d={at.outbound} pathLength="100" />
        <Tile {...at.source} height={tileH} kind="SOURCE" name={source} lines={sourceLines} Glyph={Braces} />
        <g className="flow-hub">
          <rect x={hx} y={hy} width={HUB} height={HUB} rx="22" fill="url(#flow-hub)" />
          <path d={`M ${hx + 22} ${hy + HUB / 2 + 6} c 6 -19 13 -19 21 0 s 15 19 21 0`} fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        </g>
        <Tile {...at.end} height={tileH} kind="DESTINATION" name={destination} lines={destinationLines} Glyph={Discs} />
        {ring > 0 && !reduced && <circle key={ring} className="flow-ring" cx={at.ring.x} cy={at.ring.y} r="40" />}
      </g>
    </svg>
  );
}
