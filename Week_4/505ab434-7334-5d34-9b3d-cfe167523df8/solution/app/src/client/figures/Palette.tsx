import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { FAMILIES, SWATCHES, type Family } from "./swatches.ts";

const TONES: Record<Family, [string, string]> = {
  Ember: ["#F2A08C", "#A3341F"],
  Saffron: ["#F7C266", "#9A5B00"],
  Meadow: ["#A9D99A", "#2F6B2A"],
  Lagoon: ["#7FD3D0", "#00666B"],
  Harbour: ["#9DBDF0", "#1F4E8C"],
  Iris: ["#C6B2F0", "#5B3A9E"],
  Orchid: ["#EDA8DC", "#8E2C77"],
  Clay: ["#E0B9A0", "#7A4A33"],
  Moss: ["#CFD88E", "#4F5A1E"],
  Stone: ["#C9C6CF", "#4D4A55"],
};

const RADIUS = 38;

/** Colour chapter: ten family discs on a wheel filter the swatch table. */
export function PaletteFigure(): ReactNode {
  const [selected, setSelected] = useState<Family | null>(null);
  const [roving, setRoving] = useState(0);
  const discs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + FAMILIES.length) % FAMILIES.length;
    setRoving(next);
    discs.current[next]?.focus();
  };

  const rows = selected ? SWATCHES.filter((s) => s.family === selected) : SWATCHES;
  return (
    <section className="figure-cell cell cell-pad" data-frame aria-labelledby="palette-title">
      <h2 id="palette-title" className="cell-label">
        Palette wheel
      </h2>
      <div className="wheel" role="group" aria-label="Palette wheel">
        {FAMILIES.map((family, i) => {
          const angle = (i * 360) / FAMILIES.length;
          const x = 50 + RADIUS * Math.sin((angle * Math.PI) / 180);
          const y = 50 - RADIUS * Math.cos((angle * Math.PI) / 180);
          return (
            <button
              key={family}
              type="button"
              ref={(el) => void (discs.current[i] = el)}
              className="disc"
              style={{ left: `${x}%`, top: `${y}%`, background: TONES[family][0], color: TONES[family][1] }}
              aria-label={`${family} family`}
              aria-pressed={selected === family}
              tabIndex={roving === i ? 0 : -1}
              onFocus={() => setRoving(i)}
              onKeyDown={(event) => move(event, i)}
              onClick={() => setSelected(family)}
            >
              <span className="disc-dot" />
            </button>
          );
        })}
        <p className="wheel-name" aria-hidden="true">
          {selected ?? "All"}
        </p>
      </div>
      <button type="button" className="btn" onClick={() => setSelected(null)}>
        Show all families
      </button>
      <p role="status" aria-label="Swatch filter" className="announcement">
        {selected ? `${rows.length} swatches in ${selected}` : `${rows.length} swatches`}
      </p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Swatch table scroll area">
        <table className="table swatch-table">
          <caption>Swatches</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Hex</th>
              <th scope="col">On white</th>
              <th scope="col">Rating</th>
              <th scope="col">On ink</th>
              <th scope="col">Rating</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.name}>
                <td>
                  <span className="chip" style={{ background: `#${s.hex}` }} aria-hidden="true" />
                  {s.name}
                </td>
                <td>#{s.hex}</td>
                <td>{s.onWhite}</td>
                <td>{s.onWhiteRating}</td>
                <td>{s.onInk}</td>
                <td>{s.onInkRating}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">Ratings are measured against White #FFFFFF and Ink #17161C.</p>
      <p className="prose muted">
        Ten colour families each come in a 700 and a 300 tone. Choose a family on the wheel with the arrow keys and Enter, or tap it, to list only its two swatches with their contrast against white and against ink. Show all families brings back every row.
      </p>
    </section>
  );
}
