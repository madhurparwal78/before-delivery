import type { Geometry } from "./geometry.js";

/** How a table reads on the plan: by fill pattern, never by colour alone. */
export type Look = "outline" | "muted" | "hatched" | "solid" | "double" | "dotted";

const SEAT_RADIUS = 6;

export function PatternDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <defs>
        <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="var(--ground)" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--ink)" strokeWidth="2.5" />
        </pattern>
      </defs>
    </svg>
  );
}

function Body({ geometry, ...rest }: { geometry: Geometry } & React.SVGProps<SVGCircleElement & SVGRectElement>) {
  const { x, y, width, height } = geometry.body;
  return geometry.round ? (
    <circle cx={x + width / 2} cy={y + height / 2} r={width / 2} {...rest} />
  ) : (
    <rect x={x} y={y} width={width} height={height} {...rest} />
  );
}

/** `laying` marks a table whose hold was just granted: its outline fills with ink (Motion: Laying the table, step 1). */
export function TableGlyph({ geometry, look, seatsFaded, laying }: { geometry: Geometry; look: Look; seatsFaded: number; laying: boolean }) {
  const { x, y, width, height } = geometry.body;
  const grow = (by: number) => ({ x: x - by, y: y - by, width: width + by * 2, height: height + by * 2 });
  return (
    <svg className="table-glyph" width={geometry.box.width} height={geometry.box.height} viewBox={`0 0 ${geometry.box.width} ${geometry.box.height}`} aria-hidden="true" focusable="false">
      {geometry.seats.map((seat, index) => (
        <circle
          key={index}
          className={index >= geometry.seats.length - seatsFaded ? "seat fade-seat" : "seat"}
          cx={seat.x}
          cy={seat.y}
          r={SEAT_RADIUS}
          fill="none"
          stroke={look === "muted" ? "var(--wine)" : "var(--ink)"}
          strokeWidth="2"
        />
      ))}
      {look === "outline" && <Body geometry={geometry} fill="none" stroke="var(--ink)" strokeWidth="3" />}
      {look === "muted" && <Body geometry={geometry} fill="var(--wine)" fillOpacity="0.55" stroke="var(--wine)" strokeWidth="2" />}
      {look === "hatched" && <Body geometry={geometry} fill="url(#hatch)" stroke="var(--ink)" strokeWidth="3" />}
      {look === "solid" && <Body geometry={geometry} className={laying ? "ink-fill" : undefined} fill="var(--ink)" stroke="var(--ink)" strokeWidth="3" />}
      {look === "double" && (
        <>
          <Body geometry={geometry} fill="none" stroke="var(--ink)" strokeWidth="3" />
          {geometry.round ? (
            <circle cx={x + width / 2} cy={y + height / 2} r={width / 2 - 6} fill="none" stroke="var(--ink)" strokeWidth="3" />
          ) : (
            <rect {...grow(-6)} fill="none" stroke="var(--ink)" strokeWidth="3" />
          )}
        </>
      )}
      {look === "dotted" && (
        <>
          <Body geometry={geometry} fill="none" stroke="var(--ink)" strokeWidth="3" />
          {geometry.round ? (
            <circle cx={x + width / 2} cy={y + height / 2} r={width / 2 + 7} fill="none" stroke="var(--ink)" strokeWidth="3" strokeDasharray="1 7" strokeLinecap="round" />
          ) : (
            <rect {...grow(7)} fill="none" stroke="var(--ink)" strokeWidth="3" strokeDasharray="1 7" strokeLinecap="round" />
          )}
        </>
      )}
    </svg>
  );
}
