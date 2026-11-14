import type { Colours } from "../shared/types";

const LABELS: { label: string; key: keyof Colours }[] = [
  { label: "Ground", key: "ground" },
  { label: "Ink", key: "ink" },
  { label: "Accent", key: "accent" },
];

/** The three colours of a world or project; each swatch is drawn in exactly the colour it names. */
export function Swatches({ colours }: { colours: Colours }) {
  return (
    <ul className="swatches">
      {LABELS.map(({ label, key }) => (
        <li key={key}>
          <span className="swatch-chip" aria-hidden="true" style={{ background: colours[key] }} />
          <span>{label} {colours[key]}</span>
        </li>
      ))}
    </ul>
  );
}
