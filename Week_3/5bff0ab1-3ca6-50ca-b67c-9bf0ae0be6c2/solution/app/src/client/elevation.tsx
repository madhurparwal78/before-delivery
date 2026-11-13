import type { JSX } from "preact";
import { CHAPTERS, type ChapterId, type FinishId, type ModelId } from "../shared/catalogue.js";
import { displayText, lockedLock, needleAngle, tankHex, two } from "../shared/derive.js";
import type { Reading } from "../shared/types.js";

/** A side elevation of the machine for one chapter, carrying the live reading in its attributes even with scripts off. */
export function Elevation({ chapter, model, finish, reading, current }: { chapter: ChapterId; model: ModelId; finish: FinishId; reading: Reading | null; current: boolean }): JSX.Element {
  const name = (CHAPTERS.find((c) => c.id === chapter) as (typeof CHAPTERS)[number]).name;
  const twin = model === "desh-648";
  const frontX = twin ? 569 : 562;
  const deg = needleAngle(reading ? (lockedLock(reading)?.hoursLeft ?? 0) : 0);
  const lamp = reading?.stale === true;
  const units = reading ? two(reading.unitsLeft) : "--";
  const ride = reading ? displayText(reading).split("RIDE ")[1] : "--:--";
  const tank = reading ? tankHex(reading, finish) : "#9c9ea3";
  return (
    <svg
      class="elevation"
      role="img"
      aria-label={`Side elevation, ${name}`}
      viewBox="0 0 760 380"
      data-chapter={chapter}
      data-current={current ? "true" : "false"}
      data-needle-deg={String(deg)}
      data-lamp={lamp ? "true" : "false"}
      data-units={units}
      data-ride={ride}
      data-tank={tank}
    >
      <line class="ground" x1="40" y1="330" x2="720" y2="330" />
      <g class="line">
        <circle cx="130" cy="231" r="99" class="soft" style="stroke-width:12px" />
        <circle cx="130" cy="231" r="65" />
        <circle cx={frontX} cy="230" r="100" class="soft" style="stroke-width:12px" />
        <circle cx={frontX} cy="230" r="72" />
        <path d="M130 231 L232 228 L300 252" />
        <path d={`M${frontX - 42} 148 L${frontX} 230`} />
        <path d={`M${frontX - 52} 150 L360 192 L270 238`} />
        <path d="M300 252 L232 228" />
        <path d={`M${frontX - 62} 130 L${frontX - 80} 118 M${frontX - 62} 130 L${frontX - 56} 150`} />
        <circle cx={frontX - 20} cy="158" r="15" />
        <path d="M232 168 Q300 150 340 168 L330 182 L226 184 Z" />
        <path d="M150 168 L232 166 L236 182 L150 186 Z" />
        <rect x="290" y="214" width="84" height="72" />
        <path d={twin ? "M338 214 L360 160 L392 160 L370 214 M312 214 L332 168 L346 168 M372 214" : "M338 214 L362 156 L396 156 L372 214"} />
        <path d="M356 288 Q300 306 230 290 L150 276" />
        <rect x="145" y="268" width="150" height="22" />
        {twin ? <rect x="145" y="292" width="150" height="20" /> : null}
        <path d="M292 244 L342 244" />
      </g>
      <path class="tank-fill" style={`fill:${tank};stroke:var(--ink);stroke-width:2.2`} d="M300 150 Q372 126 460 150 Q470 168 440 178 L316 182 Q296 172 300 150 Z" />
      <circle cx={frontX - 78} cy="118" r="4" fill="var(--ink)" />
      <svg x={frontX - 50} y="104" width="1" height="1" viewBox="0 0 1 1" overflow="visible">
        <circle cx="0" cy="0" r="22" fill="#0b0c0d" stroke="var(--ink)" stroke-width="2" />
        <line class="needle line" x1="0" y1="0" x2="0" y2="-17" style={`transform:rotate(${deg}deg);stroke-width:3`} />
        <circle class="lamp" cx="-12" cy="-12" r="4" style={`fill:${lamp ? "var(--accent)" : "#2e2422"}`} />
      </svg>
      <text class="readout" x="40" y="44">{`UNITS ${units}`}</text>
      <text class="readout" x="40" y="68" style="fill:var(--muted)">{`RIDE ${ride}`}</text>
      <text class="readout" x="720" y="44" text-anchor="end">{name}</text>
    </svg>
  );
}
