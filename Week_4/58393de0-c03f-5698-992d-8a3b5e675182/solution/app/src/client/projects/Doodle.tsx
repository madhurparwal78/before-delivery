/** The empty-state doodle: a thin-stroke cylinder, a U-loop of wire and a dashed ground line, all generated from a few measures. */

const WIDTH = 240;
const HEIGHT = 120;
const GROUND = 102;

function cylinder(cx: number, top: number, rx: number, ry: number, height: number): string[] {
  const left = cx - rx;
  const bottom = top + height;
  return [
    `M${left} ${top}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`,
    `M${left} ${top}V${bottom}a${rx} ${ry} 0 0 0 ${2 * rx} 0V${top}`,
  ];
}

function uLoop(left: number, top: number, width: number, depth: number): string {
  const radius = width / 2;
  return `M${left} ${top}v${depth}a${radius} ${radius} 0 0 0 ${width} 0v${-depth}`;
}

export function Doodle() {
  const loopLeft = 142;
  const loopWidth = 36;
  const loopTop = 28;
  return (
    <svg className="doodle" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width={WIDTH} height={HEIGHT} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {cylinder(88, 32, 28, 9, 54).map((d) => <path key={d} d={d} />)}
        <path d={uLoop(loopLeft, loopTop, loopWidth, 36)} />
        <circle cx={loopLeft} cy={loopTop} r="3.5" />
        <circle cx={loopLeft + loopWidth} cy={loopTop} r="3.5" />
        <path d={`M16 ${GROUND}H${WIDTH - 16}`} strokeDasharray="4 7" />
      </g>
    </svg>
  );
}
