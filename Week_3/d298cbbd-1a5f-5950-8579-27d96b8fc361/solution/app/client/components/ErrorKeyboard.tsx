import type { JSX } from "preact";

const ROWS = ["1234567890-", "qwertyuiop", "asdfghjkl;'", "zxcvbnm,./"];
const ROW_OFFSETS = [0, 0.5, 0.75, 1.25];
const SHIFTED: Readonly<Record<string, string>> = { ":": ";", '"': "'", "<": ",", ">": ".", "?": "/", _: "-", "!": "1", "@": "2", "#": "3", $: "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0" };
const KEY = 30;
const GAP = 4;

/** The physical key a miskeyed character sits on. */
function keyOf(character: string): string {
  return SHIFTED[character] ?? character.toLowerCase();
}

/** A small keyboard drawn in thin strokes; every miskeyed key is filled solid. */
export function ErrorKeyboard({ errors }: { errors: readonly (readonly [string, number])[] }): JSX.Element {
  const missed = new Set(errors.map(([key]) => keyOf(key)));
  const width = 12 * (KEY + GAP);
  const height = 5 * (KEY + GAP);
  return (
    <svg class="keyboard" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Keyboard of miskeyed keys">
      {ROWS.map((row, r) =>
        [...row].map((key, c) => {
          const x = (c + ROW_OFFSETS[r]!) * (KEY + GAP);
          const y = r * (KEY + GAP);
          const filled = missed.has(key);
          return (
            <g key={key}>
              <rect x={x + 1} y={y + 1} width={KEY - 2} height={KEY - 2} rx={5} class={filled ? "key filled" : "key"} />
              <text x={x + KEY / 2} y={y + KEY / 2 + 5} text-anchor="middle" class={filled ? "key-label filled" : "key-label"}>
                {key}
              </text>
            </g>
          );
        }),
      )}
      <rect x={2.5 * (KEY + GAP)} y={4 * (KEY + GAP) + 1} width={6.5 * (KEY + GAP) - GAP} height={KEY - 2} rx={5} class={missed.has(" ") || missed.has("space") ? "key filled" : "key"} />
    </svg>
  );
}
