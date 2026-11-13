import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { LEVELS, LEVEL_NAMES, type Level } from "../../shared/levels";
import { fixtureById, givensCount } from "../../shared/puzzles";
import { useStartGame } from "../hooks";
import { useMe } from "../me";
import { navigate } from "../router";

function Specimen({ level }: { level: Level }): JSX.Element {
  const { puzzle } = fixtureById(`${level}-1`);
  return (
    <svg id="specimen" class="specimen-grid" role="img" aria-label={`Specimen: ${LEVEL_NAMES[level]} puzzle`} data-level={level} viewBox="0 0 540 540">
      {[...puzzle].map((digit, index) => {
        const column = index % 9;
        const row = Math.floor(index / 9);
        return digit === "0" ? null : (
          <text key={index} x={column * 60 + 30} y={row * 60 + 32} class="specimen-digit" text-anchor="middle" dominant-baseline="central">
            {digit}
          </text>
        );
      })}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((line) => (
        <g key={line} class={line % 3 === 0 ? "specimen-stitches box" : "specimen-stitches"}>
          <line x1={line * 60} y1="0" x2={line * 60} y2="540" />
          <line x1="0" y1={line * 60} x2="540" y2={line * 60} />
        </g>
      ))}
    </svg>
  );
}

export function Home(): JSX.Element {
  const me = useMe();
  const [previewed, setPreviewed] = useState<Level>("easy");
  const { pending, failure, start: startGame } = useStartGame();
  const clues = givensCount(fixtureById(`${previewed}-1`));

  const start = (level: Level): void => {
    if (me) startGame(level);
    else navigate("/signin?next=%2F");
  };

  return (
    <section class="home">
      <h1 class="wordmark">Seam</h1>
      <ul class="name-list">
          {LEVELS.map((level) => (
            <li key={level}>
              <button
                type="button"
                class="level-name"
                aria-disabled={pending ? "true" : "false"}
                data-shown={previewed === level ? "true" : "false"}
                onMouseEnter={() => setPreviewed(level)}
                onFocus={() => setPreviewed(level)}
                onClick={() => start(level)}
              >
                <span class="level-caption">New </span>
                <span class="level-text">{LEVEL_NAMES[level]}</span>
                <span class="level-caption"> game</span>
              </button>
            </li>
          ))}
      </ul>
      <div class="specimen-tile" data-level={previewed}>
        <Specimen level={previewed} />
      </div>
      <p id="specimen-clues" class="fact">{`${clues} clues`}</p>
      {failure && <p class="form-note">{failure}</p>}
    </section>
  );
}
