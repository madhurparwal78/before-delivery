import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { LEVELS, LEVEL_NAMES, type Level } from "../../shared/levels";
import type { LevelStatistics, Profile as ProfileData } from "../../shared/protocol";
import { get } from "../api";
import { formatClock } from "../format";
import { useLoad } from "../hooks";
import { failureSentence } from "../messages";
import { Voice } from "./NotFound";

const dash = (value: number | null, show: (value: number) => string): string => (value === null ? "-" : show(value));

function terms(stats: LevelStatistics): [string, string][] {
  return [
    ["Games started", String(stats.started)],
    ["Games won", String(stats.won)],
    ["Win rate", dash(stats.win_rate, (rate) => `${rate}%`)],
    ["Best time", dash(stats.best_seconds, formatClock)],
    ["Average time", dash(stats.average_seconds, formatClock)],
    ["Best score", dash(stats.best_score, String)],
  ];
}

export function Profile(): JSX.Element {
  const loaded = useLoad(() => get<ProfileData>("/api/profile"), "profile");
  const [selected, setSelected] = useState<Level>("easy");
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  if (loaded.status !== "ready") {
    return (
      <section class="profile">
        <h1 class="page-title">Profile</h1>
        <Voice sentence={loaded.status === "failed" ? failureSentence(loaded.error) : "The atelier is preparing your page."} />
      </section>
    );
  }
  const { levels, finished_games: finished } = loaded.value;
  const choose = (level: Level): void => {
    setSelected(level);
    tabs.current[level]?.focus();
  };
  const onKey = (event: KeyboardEvent): void => {
    const at = LEVELS.indexOf(selected);
    const target =
      event.key === "ArrowRight" ? at + 1 : event.key === "ArrowLeft" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? LEVELS.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    const level = LEVELS[(target + LEVELS.length) % LEVELS.length];
    if (level) choose(level);
  };
  return (
    <section class="profile">
      <h1 class="page-title">Profile</h1>
      <div class="tile">
        <div class="tabs" role="tablist" aria-label="Levels">
          {LEVELS.map((level) => (
            <button
              type="button"
              class="tab"
              role="tab"
              key={level}
              id={`tab-${level}`}
              aria-selected={selected === level ? "true" : "false"}
              aria-controls={`panel-${level}`}
              tabIndex={selected === level ? 0 : -1}
              ref={(element) => {
                tabs.current[level] = element;
              }}
              onClick={() => setSelected(level)}
              onKeyDown={onKey}
            >
              {LEVEL_NAMES[level]}
            </button>
          ))}
        </div>
        {LEVELS.map((level) => (
          <div role="tabpanel" id={`panel-${level}`} aria-labelledby={`tab-${level}`} hidden={selected !== level} key={level}>
            <dl class="stats">
              {terms(levels[level]).map(([term, value]) => (
                <div class="stat" key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      {finished.length === 0 ? (
        <Voice sentence="No finished games yet. The first one is waiting." />
      ) : (
        <div class="tile table-tile" tabIndex={0} role="region" aria-label="Finished games list">
          <table id="finished-games" class="rows" aria-label="Finished games">
            <thead>
              <tr>
                {["Date", "Level", "Result", "Time", "Score"].map((name) => (
                  <th scope="col" key={name}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {finished.map((game) => (
                <tr key={game.id}>
                  <td>{game.date}</td>
                  <td>{LEVEL_NAMES[game.level]}</td>
                  <td>{game.result === "won" ? "Won" : "Lost"}</td>
                  <td>{formatClock(game.seconds)}</td>
                  <td>{game.score === null ? "-" : game.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
