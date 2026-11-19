import type { StepJson } from "../../../server/changes.js";
import { get } from "../../lib/api.js";
import { useTopics } from "../../lib/live.js";
import { Link } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { loadingScreen, Page, Rest, StatusBlock, useLoad } from "../../lib/ui.js";
import { tallyText } from "./tally.js";
import { formatLocalIso } from "../../../shared/tz.js";

interface Item {
  number: string;
  title: string;
  planned_start: string;
  step: StepJson;
}

/** A board's agenda: the changes waiting for its vote, earliest first, each with its live tally. */
export function BoardAgenda({ board }: { board: string }): JSX.Element {
  const session = useSession();
  const { state, reload } = useLoad(() => get<{ items: Item[] }>(`/api/boards/${encodeURIComponent(board)}/agenda`), [board, session.accessVersion]);
  const items = state.status === "ready" ? state.data.items : [];
  useTopics(["list:change", ...items.map((item) => `votes:${item.number}`)], reload);
  const blocked = loadingScreen(state, board, reload);
  if (blocked) return blocked;
  const zone = session.user?.time_zone ?? "UTC";
  return (
    <Page subject={board}>
      <Rest narrow>
        {items.length === 0 ? <p>No change is waiting for this board.</p> : null}
        <ol className="ag-list" aria-label="Agenda">
          {items.map((item) => {
            const tally = tallyText(item.step);
            return (
              <li key={item.number} className="ag-item">
                <h3>
                  <Link to={`/desk/records/${item.number}`}>
                    {item.number}: {item.title}
                  </Link>
                </h3>
                <p className="muted">
                  Planned start {formatLocalIso(item.planned_start, zone)}. {item.step.name} closes {item.step.closes_at ? formatLocalIso(item.step.closes_at, zone) : ""}.
                </p>
                <p className="ag-tally">
                  {tally.counts}
                  {tally.closed ? <StatusBlock>{tally.closed}</StatusBlock> : null}
                </p>
              </li>
            );
          })}
        </ol>
      </Rest>
    </Page>
  );
}
