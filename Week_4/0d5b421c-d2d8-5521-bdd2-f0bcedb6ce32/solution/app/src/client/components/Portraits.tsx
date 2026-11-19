// Six flat elevations of the rooms, line-drawn in black and dark wine on pink. Two wide by three high.
import type { ReactNode } from "react";

const INK = "var(--ink)";
const WINE = "var(--wine)";

function Plate({ children }: { children: ReactNode }) {
  return (
    <svg className="portrait" viewBox="0 0 200 300" role="img" aria-hidden="true" fill="none" strokeLinecap="square" strokeLinejoin="miter">
      <rect x="6" y="6" width="188" height="288" stroke={INK} strokeWidth="4" />
      {children}
    </svg>
  );
}

function WindowRow() {
  return (
    <Plate>
      <path d="M6 232H194" stroke={INK} strokeWidth="3" />
      {[24, 78, 132].map((x) => (
        <g key={x}>
          <path d={`M${x} 232V92a22 22 0 0 1 44 0V232Z`} stroke={INK} strokeWidth="3" />
          <path d={`M${x + 22} 70V232M${x} 150H${x + 44}`} stroke={WINE} strokeWidth="2" />
          <path d={`M${x - 4} 232H${x + 48}V240H${x - 4}Z`} stroke={INK} strokeWidth="3" />
          <path d={`M${x + 8} 232c0-14 6-20 14-20s14 6 14 20`} stroke={WINE} strokeWidth="2" />
        </g>
      ))}
      <path d="M18 40H182M18 52H182" stroke={WINE} strokeWidth="2" />
      {[24, 58, 92, 126, 160].map((x) => (
        <path key={x} d={`M${x} 262h20l-3 22h-14z`} stroke={INK} strokeWidth="2" />
      ))}
    </Plate>
  );
}

function Hearth() {
  return (
    <Plate>
      <path d="M62 6V70M138 6V70" stroke={INK} strokeWidth="3" />
      <path d="M40 70H160V90H40Z" stroke={INK} strokeWidth="3" />
      <path d="M52 90V270M148 90V270" stroke={INK} strokeWidth="3" />
      <path d="M70 270V150a30 30 0 0 1 60 0V270Z" stroke={INK} strokeWidth="3" />
      <path d="M86 270c-10-22 2-34 8-48 2 12 8 14 8 14 4-10 10-18 6-34 18 18 22 46 8 68Z" stroke={WINE} strokeWidth="3" />
      <path d="M78 270H122M82 258L118 262" stroke={WINE} strokeWidth="3" />
      <path d="M56 70V50M144 70V50M52 50H60M140 50H148" stroke={WINE} strokeWidth="3" />
      {[0, 1, 2, 3].map((row) => (
        <path key={row} d={`M12 ${110 + row * 40}H46M154 ${130 + row * 40}H188`} stroke={WINE} strokeWidth="2" />
      ))}
    </Plate>
  );
}

function SlateRoom() {
  return (
    <Plate>
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <g key={row}>
          <path d={`M6 ${40 + row * 28}H194`} stroke={WINE} strokeWidth="2" />
          {[0, 1, 2, 3].map((col) => (
            <path key={col} d={`M${(row % 2 === 0 ? 30 : 6) + col * 48} ${40 + row * 28}v28`} stroke={WINE} strokeWidth="2" />
          ))}
        </g>
      ))}
      <path d="M40 206H160V216H40ZM52 216V270M148 216V270M52 250H148" stroke={INK} strokeWidth="3" />
      {[60, 100, 140].map((x) => (
        <g key={x}>
          <path d={`M${x} 6V30`} stroke={INK} strokeWidth="2" />
          <path d={`M${x - 14} 48a14 14 0 0 1 28 0Z`} stroke={INK} strokeWidth="3" />
        </g>
      ))}
    </Plate>
  );
}

function BarRail() {
  return (
    <Plate>
      <path d="M20 40H180M20 84H180M20 128H180" stroke={INK} strokeWidth="3" />
      {[34, 60, 86, 112, 138, 164].map((x, index) => (
        <path key={x} d={`M${x} ${index % 2 === 0 ? 40 : 84}v-18h8v18M${x + 4} ${index % 2 === 0 ? 48 : 92}`} stroke={WINE} strokeWidth="3" />
      ))}
      <path d="M6 176H194V190H6Z" stroke={INK} strokeWidth="3" />
      <path d="M20 190V270H180V190M20 220H180" stroke={INK} strokeWidth="3" />
      <path d="M12 168H188" stroke={WINE} strokeWidth="3" />
      {[40, 100, 160].map((x) => (
        <g key={x}>
          <path d={`M${x - 14} 262h28M${x} 262V284M${x - 10} 284h20`} stroke={WINE} strokeWidth="3" />
        </g>
      ))}
    </Plate>
  );
}

function Courtyard() {
  return (
    <Plate>
      <path d="M30 270V120a70 70 0 0 1 140 0V270" stroke={INK} strokeWidth="3" />
      <path d="M48 270V124a52 52 0 0 1 104 0V270" stroke={INK} strokeWidth="3" />
      <path d="M100 270V150M100 190c-16-4-24-14-24-26M100 210c16-4 24-14 24-26" stroke={WINE} strokeWidth="3" />
      {[0, 1, 2, 3, 4].map((index) => (
        <circle key={index} cx={34 + index * 33} cy={30 + (index % 2) * 10} r="5" stroke={WINE} strokeWidth="3" />
      ))}
      <path d="M12 38C60 62 140 62 188 38" stroke={INK} strokeWidth="2" />
      <path d="M6 270H194M6 284H194M40 270v14M100 270v14M160 270v14" stroke={INK} strokeWidth="2" />
      <path d="M62 100c10 14 10 30 0 44M138 100c-10 14-10 30 0 44" stroke={WINE} strokeWidth="3" />
    </Plate>
  );
}

function ChefsCounter() {
  return (
    <Plate>
      <path d="M6 44H194" stroke={INK} strokeWidth="3" />
      {[40, 100, 160].map((x) => (
        <g key={x}>
          <path d={`M${x} 44V70`} stroke={INK} strokeWidth="2" />
          <path d={`M${x - 18} 98a18 18 0 0 1 36 0Z`} stroke={INK} strokeWidth="3" />
          <path d={`M${x - 8} 70H${x + 8}`} stroke={INK} strokeWidth="2" />
        </g>
      ))}
      <path d="M20 150H180V160H20Z" stroke={INK} strokeWidth="3" />
      {[44, 80, 116, 152].map((x) => (
        <path key={x} d={`M${x - 10} 150c0-18 20-18 20 0`} stroke={WINE} strokeWidth="3" />
      ))}
      <path d="M12 196H188V212H12Z" stroke={INK} strokeWidth="3" />
      <path d="M24 212V270M176 212V270M24 244H176" stroke={INK} strokeWidth="3" />
      {[50, 100, 150].map((x) => (
        <path key={x} d={`M${x - 12} 276h24M${x} 276V288`} stroke={WINE} strokeWidth="3" />
      ))}
    </Plate>
  );
}

/** The six rooms in published order, so the run has its full height from the first paint. */
export const ROOM_PORTRAITS: { roomId: string; name: string; Portrait: () => ReactNode }[] = [
  { roomId: "window-row", name: "Window Row", Portrait: WindowRow },
  { roomId: "hearth", name: "Hearth", Portrait: Hearth },
  { roomId: "slate-room", name: "Slate Room", Portrait: SlateRoom },
  { roomId: "bar-rail", name: "Bar Rail", Portrait: BarRail },
  { roomId: "courtyard", name: "Courtyard", Portrait: Courtyard },
  { roomId: "chefs-counter", name: "Chef's Counter", Portrait: ChefsCounter },
];
