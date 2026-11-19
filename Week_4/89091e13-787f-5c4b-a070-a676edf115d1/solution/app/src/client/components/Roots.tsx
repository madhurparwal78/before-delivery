import type { RootJson } from "../../shared/api.ts";

/** Row roots or column roots: min, max and the full hash of each, wrapped inside the panel. */
export function RootsList({ name, word, roots }: { name: string; word: "Row" | "Column"; roots: RootJson[] }) {
  return (
    <ol aria-label={name} className="roots">
      {roots.map((root, index) => (
        <li key={index} data-min={root.min} data-max={root.max} data-hash={root.hash}>
          <span className="roots__label">{word} {index}</span>
          <code>{root.min}</code> <code>{root.max}</code> <code>{root.hash}</code>
        </li>
      ))}
    </ol>
  );
}
