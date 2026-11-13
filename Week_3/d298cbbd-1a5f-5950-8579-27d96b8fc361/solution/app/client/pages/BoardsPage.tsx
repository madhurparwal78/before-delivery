import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { BoardKind, BoardLength, BoardRow, LivePush } from "../../shared/protocol";
import { twoDecimals, utcDate } from "../../shared/format";
import { api } from "../api";
import { live } from "../live";
import { navigate, useLocation } from "../router";

const BOARDS: readonly { value: BoardKind; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "alltime", label: "All-time" },
];
const LENGTHS: readonly { value: BoardLength; label: string }[] = [
  { value: 15, label: "15 seconds" },
  { value: 60, label: "60 seconds" },
];

/** A tab list: arrow keys move focus and selection together, wrapping at the ends; only the selected tab is in the Tab order. */
function Tabs<T extends string | number>({ label, tabs, value, onSelect }: { label: string; tabs: readonly { value: T; label: string }[]; value: T; onSelect: (value: T) => void }): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div class="tabs-list" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          type="button"
          role="tab"
          key={tab.value}
          class="board-tab"
          aria-selected={tab.value === value ? "true" : "false"}
          tabIndex={tab.value === value ? 0 : -1}
          ref={(element) => {
            refs.current[index] = element;
          }}
          onClick={() => onSelect(tab.value)}
          onKeyDown={(event) => {
            const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (step === 0) return;
            event.preventDefault();
            const target = (index + step + tabs.length) % tabs.length;
            onSelect(tabs[target]!.value);
            refs.current[target]?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function BoardsPage(): JSX.Element {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const kind: BoardKind = params.get("board") === "alltime" ? "alltime" : "daily";
  const length: BoardLength = params.get("length") === "60" ? 60 : 15;
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [mine, setMine] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useLayoutEffect(() => {
    let current = true;
    setRows(null);
    setMine(null);
    void api<{ rows: BoardRow[] }>("GET", `/api/boards?board=${kind}&length=${length}`).then((answer) => {
      if (current) setRows((before) => before ?? answer.rows);
    });
    const leave = live.subscribe({
      open: () => ({ type: "board", board: kind, length }),
      onPush: (push: LivePush) => {
        if (push.type !== "board" || push.board !== kind || push.length !== length) return;
        setRows(push.rows);
        setMine(push.mine);
        if (push.change) setAnnouncement(`${push.change.name} is now #${push.change.rank} with ${twoDecimals(push.change.speed)} wpm.`);
      },
    });
    return () => {
      current = false;
      leave();
    };
  }, [kind, length]);

  function select(change: { board?: BoardKind; length?: BoardLength }): void {
    navigate(`/boards?board=${change.board ?? kind}&length=${change.length ?? length}`, true);
  }

  return (
    <section class="paper boards-sheet">
      <h1 class="page-title">Boards</h1>
      <div class="board-tabs">
        <Tabs label="Board" tabs={BOARDS} value={kind} onSelect={(board) => select({ board })} />
        <Tabs label="Length" tabs={LENGTHS} value={length} onSelect={(next) => select({ length: next })} />
      </div>
      <p class="sr-only" role="status" aria-label="Board updates">{announcement}</p>
      <div class="table-wrap">
        <table class="data-table wide" aria-label="Leaderboard">
          <thead>
            <tr><th scope="col">Rank</th><th scope="col">Typist</th><th scope="col">Speed</th><th scope="col">Accuracy</th><th scope="col">Date</th></tr>
          </thead>
          <tbody>
            {rows?.map((row) => (
              <tr key={row.rank} aria-current={row.rank === mine ? "true" : undefined}>
                <td>{row.rank}</td>
                <td>{row.name}</td>
                <td>{twoDecimals(row.speed)}</td>
                <td>{twoDecimals(row.accuracy)}%</td>
                <td>{utcDate(row.finishedAt)}</td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr><td colSpan={5} class="empty-cell">No counted runs on this board yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
