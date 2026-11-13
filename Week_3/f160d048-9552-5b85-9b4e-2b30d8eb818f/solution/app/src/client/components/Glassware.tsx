import type { ReactElement } from "react";

/** Procedural glassware: a pipette rack, an Erlenmeyer flask or a centrifuge rotor, chosen and varied by a hash of the name. */

function hash(seed: string): number {
  let value = 2166136261;
  for (const char of seed) {
    value ^= char.codePointAt(0) ?? 0;
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Draw = (random: () => number) => ReactElement;

const round = (value: number): number => Math.round(value * 10) / 10;

const pipetteRack: Draw = (random) => {
  const count = 5 + Math.floor(random() * 4);
  const left = 64;
  const gap = (336 - left) / (count - 1);
  const pipettes = Array.from({ length: count }, (_, index) => {
    const x = round(left + index * gap);
    const height = 150 + random() * 90;
    const top = round(292 - height);
    const bulb = random() > 0.35;
    const level = 0.35 + random() * 0.5;
    const ticks = Array.from({ length: 6 }, (__, tick) => {
      const y = round(292 - 30 - tick * ((height - 80) / 6));
      return `M${x - 6} ${y}h${tick % 2 === 0 ? 7 : 4}`;
    }).join(" ");
    return (
      <g key={index}>
        <path d={`M${x} 292 L${x - 2} 270 L${x - 6} ${round(top + 46)} L${x - 6} ${round(top + 20)} L${x + 6} ${round(top + 20)} L${x + 6} ${round(top + 46)} L${x + 2} 270 Z`} />
        {bulb ? <ellipse cx={x} cy={round(top + 8)} rx="9" ry="14" /> : <path d={`M${x - 6} ${round(top + 20)} L${x - 6} ${round(top)} L${x + 6} ${round(top)} L${x + 6} ${round(top + 20)}`} />}
        <path d={ticks} />
        <path d={`M${x - 4} ${round(292 - 30 - level * (height - 90))} h8`} strokeDasharray="2 3" />
      </g>
    );
  });
  const drop = 64 + Math.floor(random() * 4) * gap;
  return (
    <g>
      {pipettes}
      <path d="M44 296 L356 296 L356 346 L44 346 Z" />
      <path d="M44 296 L60 284 L340 284 L356 296" />
      {Array.from({ length: count }, (_, index) => (
        <ellipse key={index} cx={round(left + index * gap)} cy="292" rx="11" ry="4" />
      ))}
      <path d={`M${round(drop)} 312 q-5 8 0 12 q5 -4 0 -12`} />
      <path d="M60 346 v10 M340 346 v10" />
    </g>
  );
};

const flask: Draw = (random) => {
  const level = 210 + random() * 40;
  const wave = 5 + random() * 6;
  const bubbles = Array.from({ length: 4 }, (_, index) => ({
    x: 150 + random() * 100,
    y: level + 18 + index * 18 + random() * 8,
    r: 3 + random() * 5,
  }));
  const edge = (y: number) => {
    const t = (y - 140) / (328 - 140);
    return { left: 170 - t * 80, right: 230 + t * 80 };
  };
  const surface = edge(level);
  return (
    <g>
      <path d="M160 60 H240 M164 60 v-12 H236 v12" />
      <path d="M172 60 V140 L90 300 Q80 322 106 328 H294 Q320 322 310 300 L228 140 V60" />
      <path d={`M${round(surface.left)} ${round(level)} q${round((surface.right - surface.left) / 8)} ${-wave} ${round((surface.right - surface.left) / 4)} 0 t${round((surface.right - surface.left) / 4)} 0 t${round((surface.right - surface.left) / 4)} 0 t${round((surface.right - surface.left) / 4)} 0`} />
      {[0, 1, 2].map((tick) => {
        const y = 170 + tick * 36;
        const right = edge(y).right;
        return <path key={tick} d={`M${round(right - 14)} ${y} h${tick === 1 ? 20 : 12}`} />;
      })}
      {bubbles.map((bubble, index) => (
        <circle key={index} cx={round(bubble.x)} cy={round(bubble.y)} r={round(bubble.r)} />
      ))}
      <path d="M118 296 Q200 316 282 296" />
      <ellipse cx="200" cy="332" rx="112" ry="8" />
    </g>
  );
};

const rotor: Draw = (random) => {
  const slots = 8 + Math.floor(random() * 5);
  const tilt = random() * (360 / slots);
  return (
    <g>
      <circle cx="200" cy="200" r="150" />
      <circle cx="200" cy="200" r="138" />
      <circle cx="200" cy="200" r="30" />
      <circle cx="200" cy="200" r="9" />
      {Array.from({ length: slots }, (_, index) => {
        const long = random() > 0.45;
        return (
          <g key={index} transform={`rotate(${round(tilt + index * (360 / slots))} 200 200)`}>
            <rect x="190" y="62" width="20" height="62" rx="10" />
            <path d={`M193 ${long ? 74 : 86} h14`} />
            <path d="M200 124 V170" />
          </g>
        );
      })}
      <path d="M200 40 l-8 -12 h16 z" />
    </g>
  );
};

const OBJECTS: Draw[] = [pipetteRack, flask, rotor];

export function Glassware({ seed }: { seed: string }) {
  const value = hash(seed);
  const draw = OBJECTS[value % OBJECTS.length] ?? pipetteRack;
  return (
    <svg
      className="glassware"
      viewBox="0 0 400 400"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="var(--on-accent)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.9"
    >
      {draw(generator(value))}
    </svg>
  );
}
